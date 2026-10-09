/* Verifies the remote MCP server.
 *
 *   node scripts/mcp-check.mjs
 *   MCP_TOKEN=rkmcp_… node scripts/mcp-check.mjs   # also exercises real tools
 *
 * Without a token this covers the protocol surface, the shape of the tool
 * registry, the capabilities that must stay absent from it, the guards that
 * refuse before touching anything, and every way of reaching
 * the endpoint WITHOUT valid credentials — which is the part that matters,
 * because a token here can read a private document vault and rewrite a public
 * website. With MCP_TOKEN set it additionally runs a live handshake and a
 * read-only tool call against Firestore.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const URL_MCP = `${BASE}/api/mcp`;

for (const line of (fs.existsSync(path.join(root, ".env.local"))
  ? fs.readFileSync(path.join(root, ".env.local"), "utf8")
  : ""
).split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

let pass = 0;
let fail = 0;
const check = (cond, name, detail) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const rpc = async (body, token) => {
  const res = await fetch(URL_MCP, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_) {}
  return { status: res.status, headers: res.headers, json };
};

console.log(`base: ${BASE}\n`);

console.log("transport");
{
  const get = await fetch(URL_MCP);
  check(get.status === 405, "GET is declined (no server-initiated stream)", `HTTP ${get.status}`);
  check(
    (get.headers.get("allow") || "").includes("POST"),
    "Allow header advertises POST",
    get.headers.get("allow")
  );
  const del = await fetch(URL_MCP, { method: "DELETE" });
  check(del.status === 204, "DELETE (session teardown) returns 204", `HTTP ${del.status}`);
  const cc = (await fetch(URL_MCP, { method: "DELETE" })).headers.get("cache-control") || "";
  check(/no-store/.test(cc), "responses are no-store", cc);
}

console.log("\nunauthenticated access is refused");
{
  const none = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  check(none.status === 401, "no token → 401", `HTTP ${none.status}`);
  const wa = none.headers.get("www-authenticate") || "";
  check(/^Bearer /.test(wa), "401 carries a Bearer challenge", wa);
  check(
    /resource_metadata=/.test(wa),
    "challenge points at RFC 9728 metadata (clients discover auth from this)",
    wa
  );

  for (const [label, tok] of [
    ["garbage", "not-a-token"],
    ["right prefix, random body", "rkmcp_" + Buffer.from(crypto.randomBytes(64)).toString("base64url")],
    ["empty bearer", ""],
  ]) {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, tok || undefined);
    check(r.status === 401, `${label} → 401`, `HTTP ${r.status}`);
  }

  // A token encrypted with a DIFFERENT secret must not validate. This is the
  // test that proves the AES-GCM tag is actually being checked rather than the
  // payload merely being decoded.
  const forged = (() => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    const payload = JSON.stringify({
      v: "rk1",
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      scopes: ["read", "write", "vault"],
      rt: "forged-refresh-token",
    });
    const enc = Buffer.concat([c.update(payload, "utf8"), c.final()]);
    return "rkmcp_" + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
  })();
  const f = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, forged);
  check(f.status === 401, "token encrypted under an attacker's key → 401", `HTTP ${f.status}`);
}

console.log("\ntoken minting is admin-only");
{
  const r = await fetch(`${BASE}/api/mcp/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: "x", scopes: ["read"] }),
  });
  check(r.status === 401, "minting without a Firebase ID token → 401", `HTTP ${r.status}`);
}

console.log("\ndiscovery document");
{
  const r = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
  check(r.ok, "RFC 9728 metadata is served", `HTTP ${r.status}`);
  if (r.ok) {
    const m = await r.json();
    check(typeof m.resource === "string" && m.resource.endsWith("/api/mcp"), "resource points at the MCP endpoint", m.resource);
    check(Array.isArray(m.bearer_methods_supported) && m.bearer_methods_supported.includes("header"), "advertises header bearer auth");
    check(Array.isArray(m.scopes_supported) && m.scopes_supported.length === 3, "advertises the three scopes", String(m.scopes_supported));
  }
}

console.log("\ntoken crypto (round trip, in-process)");
{
  const mod = await import("../lib/server/mcpToken.js");
  const { token, jti, scopes } = mod.mintToken({
    refreshToken: "test-refresh-token",
    scopes: ["read", "bogus"],
    label: "unit test",
  });
  check(token.startsWith("rkmcp_"), "minted token is prefixed");
  const claims = mod.verifyToken(token);
  check(claims.rt === "test-refresh-token", "refresh token round-trips");
  check(claims.jti === jti, "jti round-trips");
  check(scopes.length === 1 && scopes[0] === "read", "unknown scopes are dropped at mint", String(scopes));
  check(mod.hasScope(claims, "read") && !mod.hasScope(claims, "vault"), "scope check is exact");

  // Tamper with one byte of the ciphertext.
  const raw = Buffer.from(token.slice(6), "base64url");
  raw[raw.length - 1] ^= 0xff;
  let threw = false;
  try {
    mod.verifyToken("rkmcp_" + raw.toString("base64url"));
  } catch (_) {
    threw = true;
  }
  check(threw, "a single flipped byte invalidates the token");
}

console.log("\ntool registry contract");
{
  const { TOOLS, toolByName, listToolsFor } = await import("../lib/server/mcpTools.js");
  const names = TOOLS.map((t) => t.name);

  check(TOOLS.length > 0, `registry loads (${TOOLS.length} tools)`);
  check(
    names.filter((n, i) => names.indexOf(n) !== i).length === 0,
    "every tool name is unique",
    String(names.filter((n, i) => names.indexOf(n) !== i))
  );
  check(
    names.every((n) => /^[a-z][a-z0-9_]*$/.test(n)),
    "names are snake_case",
    String(names.filter((n) => !/^[a-z][a-z0-9_]*$/.test(n)))
  );

  // From the source of truth, not a literal. This list was hardcoded as
  // read/write/vault and went stale the moment `secrets` was added.
  const { ALL_SCOPES: SCOPES } = await import("../lib/server/mcpToken.js");
  check(
    TOOLS.every((t) => SCOPES.includes(t.scope)),
    "every tool declares a known scope",
    String(TOOLS.filter((t) => !SCOPES.includes(t.scope)).map((t) => t.name))
  );
  check(
    TOOLS.every((t) => typeof t.handler === "function"),
    "every tool has a handler",
    String(TOOLS.filter((t) => typeof t.handler !== "function").map((t) => t.name))
  );
  // The description is what the model reads to decide whether to call a tool;
  // a one-word one is how you get the wrong tool called.
  check(
    TOOLS.every((t) => typeof t.description === "string" && t.description.length > 30),
    "every tool describes itself in a sentence",
    String(TOOLS.filter((t) => (t.description || "").length <= 30).map((t) => t.name))
  );
  check(
    TOOLS.every((t) => t.inputSchema?.type === "object" && t.inputSchema.properties),
    "every inputSchema is an object schema",
    String(TOOLS.filter((t) => t.inputSchema?.type !== "object" || !t.inputSchema.properties).map((t) => t.name))
  );
  // A required field that is not declared is a schema a client cannot satisfy.
  const orphanRequired = TOOLS.filter((t) =>
    (t.inputSchema?.required || []).some((r) => !(r in (t.inputSchema.properties || {})))
  );
  check(orphanRequired.length === 0, "every required field is declared", String(orphanRequired.map((t) => t.name)));

  check(typeof toolByName(names[0]) === "object", "toolByName resolves a real tool");
  check(toolByName("no_such_tool") === undefined, "toolByName rejects an unknown name");

  // tools/list must not even mention what the token cannot do.
  const readOnly = listToolsFor(["read"]);
  check(
    readOnly.length > 0 && readOnly.every((t) => toolByName(t.name).scope === "read"),
    "a read-only token is offered read tools only",
    String(readOnly.filter((t) => toolByName(t.name).scope !== "read").map((t) => t.name))
  );
  check(
    !readOnly.some((t) => /^(create|update|delete|set|add|upload|restore|publish|import|crosspost|mark)_/.test(t.name)),
    "a read-only token is offered nothing that mutates",
    String(readOnly.filter((t) => /^(create|update|delete|set|add|upload|restore|publish|import|crosspost|mark)_/.test(t.name)).map((t) => t.name))
  );
  check(
    listToolsFor(SCOPES).length === TOOLS.length,
    "every scope together offers everything",
    `${listToolsFor(SCOPES).length} of ${TOOLS.length}`
  );
  check(listToolsFor([]).length === 0, "a token with no scopes is offered nothing");
}

console.log("\nevery task tool can be told WHICH account");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  // The two that span accounts rather than acting as one are excluded: a
  // discovery call and a cross-account read have no single account to name.
  const SPANS_ACCOUNTS = ["list_task_providers", "list_all_tasks"];
  const task = TOOLS.filter((t) => /task/.test(t.name) && !SPANS_ACCOUNTS.includes(t.name));
  check(task.length >= 10, "the task tools are there", String(task.length));

  // Several Google accounts can be connected, so `provider` alone no longer
  // says whose tasks these are. Every tool that acts must be able to be told,
  // or a second account is connectable and unusable - which is what shipped:
  // the handlers all passed args.accountId and only ONE schema declared it,
  // so a model could not supply it and a validating client would strip it.
  const missing = task.filter((t) => !(t.inputSchema?.properties || {}).accountId);
  check(missing.length === 0, "all of them accept accountId", missing.map((t) => t.name).join(", "));
  const noProvider = task.filter((t) => !(t.inputSchema?.properties || {}).provider);
  check(noProvider.length === 0, "and still accept provider", noProvider.map((t) => t.name).join(", "));

  // Optional, never required: one connected account is still the common case,
  // and making a model name an id every time is friction that buys nothing.
  const required = task.filter((t) => (t.inputSchema?.required || []).includes("accountId"));
  check(
    required.length === 0,
    "none REQUIRES it - the directory resolves it when omitted",
    required.map((t) => t.name).join(", ")
  );

  // Reading ACROSS accounts is its own tool, not a mode on list_tasks: a
  // groupId is only valid inside one account, so a cross-account flag would
  // make that argument meaningless half the time.
  const all = TOOLS.find((t) => t.name === "list_all_tasks");
  check(!!all, "list_all_tasks spans every connected account");
  check(all?.scope === "read", "and is a read", all?.scope);
  check(
    !(all?.inputSchema?.properties || {}).accountId && !(all?.inputSchema?.properties || {}).groupId,
    "taking neither accountId nor groupId, since it spans them"
  );

  const lister = TOOLS.find((t) => t.name === "list_task_providers");
  check(/account/i.test(lister.description), "list_task_providers is about accounts, not just services");
}


console.log("\nthe launch pipeline");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const { STEP_IDS, IRREVERSIBLE } = await import("../lib/server/launch.js");
  const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

  for (const n of [
    "start_launch", "get_launch", "list_launches",
    "claim_launch_step", "complete_launch_step",
    "commit_github_files", "create_github_release",
    "check_npm_version", "add_release_workflow",
    "link_vercel_project", "get_project_performance",
  ])
    check(!!byName[n], `${n} exists`);

  check(byName.check_npm_version?.scope === "read", "checking a version is a read");
  check(byName.get_launch?.scope === "read", "so is reading a launch");
  check(byName.get_project_performance?.scope === "read", "and so is measuring one");
  check(byName.claim_launch_step?.scope === "write", "claiming a step is a write");

  // The enum is generated from the same list the server enforces, so a model
  // cannot be offered a step name the guard would then reject.
  const claimEnum = byName.claim_launch_step?.inputSchema?.properties?.step?.enum || [];
  check(
    claimEnum.join() === STEP_IDS.join(),
    "the step enum is the server's own list, not a second copy",
    claimEnum.join()
  );
  check(IRREVERSIBLE.length === 3, "three steps are marked irreversible", String(IRREVERSIBLE.length));

  // The two descriptions that have to carry a warning, because the model reads
  // these and nothing else before acting.
  check(
    /never be reused|permanent/i.test(byName.check_npm_version?.description || ""),
    "check_npm_version says a version is permanent"
  );
  check(
    /Automation/.test(byName.add_release_workflow?.description || ""),
    "add_release_workflow names the Automation token, which is the 2FA trap"
  );
  check(
    /no tool that deploys|NO tool that deploys/i.test(byName.link_vercel_project?.description || ""),
    "link_vercel_project says there is deliberately no deploy tool"
  );
  check(
    /before every step|safe to resume/i.test(byName.get_launch?.description || ""),
    "get_launch tells the model to call it before each step"
  );
}

console.log("\nthe activity log is reachable and read-only");
{
  const { TOOLS, listToolsFor } = await import("../lib/server/mcpTools.js");
  const { NEVER_LOGGED } = await import("../lib/server/activityLog.js");
  const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

  for (const n of ["get_audit_log", "get_activity_summary"]) {
    check(!!byName[n], `${n} exists`);
    check(byName[n]?.scope === "read", `${n} is read scope`, byName[n]?.scope);
    // Reading the log must not grow the log, or one call adds an entry, the
    // next reports it, and the log fills with the history of being read.
    check(NEVER_LOGGED.has(n), `${n} is never itself recorded`);
  }
  // A read-only token must still be able to see what happened - that is the
  // whole point of handing someone a read token.
  const readOnly = listToolsFor(["read"]).map((t) => t.name);
  check(readOnly.includes("get_audit_log"), "a read-only token can read the log");
  check(readOnly.includes("get_activity_summary"), "and the summary");

  // Coverage is a property of the DISPATCHER, not of the tools. Assert that,
  // so nobody "fixes" it later by moving the call into the handlers - which
  // is exactly how the log came to cover the browser and miss the MCP server.
  const route = (await import("node:fs")).readFileSync(
    new URL("../pages/api/mcp/index.js", import.meta.url),
    "utf8"
  );
  check(/recordToolCall\(/.test(route), "the dispatcher records every tool call");
  // The CALL, not the import at the top of the file - which is what the first
  // version of this assertion measured, and why it failed against correct code.
  check(
    route.indexOf("recordToolCall(") > route.indexOf("tool.handler("),
    "after the handler runs, so the entry carries the outcome"
  );
}


console.log("\ncapabilities that must stay absent");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const names = TOOLS.map((t) => t.name);
  const has = (re) => names.filter((n) => re.test(n));

  // NOTHING SHIPS PRODUCTION ON A PROMPT. Vercel builds on push for a linked
  // project, so the capability worth having is "link this repo once", not
  // "deploy now" - which keeps the rule the rest of this codebase holds:
  // setting a variable and shipping the site are two decisions and should not
  // be made in one call.
  check(
    has(/^(deploy|redeploy|ship|rollback|promote)/).length === 0,
    "no tool deploys or rolls back a site",
    String(has(/^(deploy|redeploy|ship|rollback|promote)/))
  );
  // Publishing needs a build and a serverless function cannot build. A tool
  // that tried would fail at call time, which is worse than no tool because
  // the model only finds out after saying it was publishing.
  check(
    has(/^(npm_publish|publish_npm|publish_package)/).length === 0,
    "no tool publishes to npm directly - CI does, on a release",
    String(has(/^(npm_publish|publish_npm|publish_package)/))
  );
  // npm refuses to unpublish after 72 hours and refuses immediately once
  // anything depends on the package, so a tool for it would mostly be a way
  // to get a confusing error at the worst moment.
  check(
    has(/unpublish|yank|deprecate_package/).length === 0,
    "and none unpublishes one",
    String(has(/unpublish|yank|deprecate_package/))
  );

  // THE LOG IS EVIDENCE, so nothing may write an arbitrary entry into it and
  // nothing may remove one. A log anyone can append to says only that someone
  // appended; a log anyone can prune says nothing at all. Entries come from
  // the dispatcher recording what actually ran, and firestore.rules refuses
  // update and delete even to the admin.
  check(
    has(/^(log|write|create|add)_(activity|audit)/).length === 0,
    "no tool writes an arbitrary log entry",
    String(has(/^(log|write|create|add)_(activity|audit)/))
  );
  check(
    has(/(delete|clear|purge|prune|reset)_(activity|audit)/).length === 0,
    "and none deletes or prunes the log",
    String(has(/(delete|clear|purge|prune|reset)_(activity|audit)/))
  );

  // A token that can mint tokens is a privilege-escalation ladder.
  check(has(/mcp_?token|mint|revoke/).length === 0, "no tool mints or revokes an MCP token", String(has(/mcp_?token|mint|revoke/)));
  // Encryption happens in the browser under a passphrase that never leaves it.
  check(
    has(/^(upload|create|delete)_vault/).length === 0,
    "no tool uploads to or deletes from the vault",
    String(has(/^(upload|create|delete)_vault/))
  );
  // Tasks ARE served now, for both Google and Microsoft, from a refresh token
  // sealed under INTEGRATION_SECRET. What must stay absent is any tool that
  // CONNECTS or DISCONNECTS an account: consent happens in a browser, in front
  // of the person whose account it is, and a tool that could re-point the
  // connection would be a way to attach someone else's tasks from a chat
  // client. Reading and writing tasks is the capability; granting access is not.
  check(has(/task/).length > 0, "task tools exist", String(has(/task/).length));
  // Narrowed to ACCOUNTS. The first version matched any tool starting with
  // "link_", which caught link_vercel_project — a build hook, not a grant of
  // access to anybody's account. A guard that fires on the wrong thing gets
  // relaxed by whoever trips it next, which is how guards die.
  check(
    has(/^(connect|disconnect|authorize|unlink)_|^link_\w+_account$/).length === 0,
    "but nothing connects or disconnects an account",
    String(has(/^(connect|disconnect|authorize|unlink)_|^link_\w+_account$/))
  );
  check(
    has(/refresh_token|oauth_google|google_credential|set_integration/).length === 0,
    "and nothing mints or stores a provider credential",
    String(has(/refresh_token|oauth_google|google_credential|set_integration/))
  );

  // The account directory makes "which account" answerable, and that raises
  // two new ways to get it wrong. Both are checked rather than trusted.
  check(
    has(/^(forget_account|remove_account|delete_account)$/).length === 0,
    "no tool deletes a connected account",
    String(has(/^(forget_account|remove_account|delete_account)$/))
  );
  // A sign-in is the one thing here that is not an API credential, and it is
  // the one a leak would hurt most, so it sits behind `secrets` like every
  // other plaintext value and is never offered to a read or write token.
  const loginTool = TOOLS.find((t) => t.name === "get_account_login");
  check(!!loginTool && loginTool.scope === "secrets", "a saved sign-in is behind the secrets scope");
  check(
    /do not echo/i.test(loginTool?.description || ""),
    "and its description tells the model how to handle the value"
  );
  // Reading the roster must not be a way to read credentials: the list tool is
  // `read` scope, so it must never return a secret, a token or a password.
  const listTool = TOOLS.find((t) => t.name === "list_accounts");
  check(listTool?.scope === "read", "listing accounts is a read");
  check(
    !/password|secret|token/i.test(
      JSON.stringify(listTool?.inputSchema || {})
    ),
    "and it takes no credential of any kind"
  );

  // Vault tools never hand back bytes.
  const vaultTools = TOOLS.filter((t) => /vault/.test(t.name));
  check(
    vaultTools.length > 0 && vaultTools.every((t) => t.scope === "vault"),
    "every vault tool sits behind the vault scope",
    String(vaultTools.filter((t) => t.scope !== "vault").map((t) => t.name))
  );
}

console.log("\ntwo task providers, one set of tools");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const has = (re) => TOOLS.filter((t) => re.test(t.name)).map((t) => t.name);
  const taskTools = TOOLS.filter((t) => /_task/.test(t.name));

  // The alternative — nine google_* tools and nine microsoft_* tools — makes a
  // model choose a NAME to express which account it meant, and it will choose
  // wrong. One vocabulary, with the account as an argument.
  check(
    has(/^(google|microsoft|ms)_/).length === 0,
    "no provider-specific tool names",
    String(has(/^(google|microsoft|ms)_/))
  );
  check(
    TOOLS.some((t) => t.name === "list_task_providers"),
    "a tool reports which accounts are connected"
  );

  const needsProvider = taskTools.filter((t) => t.name !== "list_task_providers");
  const missing = needsProvider.filter((t) => !t.inputSchema?.properties?.provider);
  check(
    missing.length === 0,
    "every task tool takes a provider",
    String(missing.map((t) => t.name))
  );
  const badEnum = needsProvider.filter(
    (t) =>
      JSON.stringify(t.inputSchema.properties.provider.enum || []) !==
      JSON.stringify(["google", "microsoft"])
  );
  check(badEnum.length === 0, "and offers the same two everywhere", String(badEnum.map((t) => t.name)));
  // Defaulted, not required: the overwhelming majority of calls mean Google,
  // and a required argument on every call is friction that buys nothing.
  const required = needsProvider.filter((t) => (t.inputSchema.required || []).includes("provider"));
  check(required.length === 0, "and never requires it", String(required.map((t) => t.name)));

  // Deleting a group or clearing completed tasks has no undo on either service.
  for (const name of ["delete_task_group", "clear_completed_tasks"]) {
    const t = TOOLS.find((x) => x.name === name);
    check(
      !!t?.inputSchema?.properties?.confirm,
      `${name} asks for confirmation`,
      t ? "no confirm property" : "tool missing"
    );
  }
}

console.log("\nLinkedIn promises only what LinkedIn actually offers");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const names = TOOLS.map((t) => t.name);
  const has = (re) => names.filter((n) => re.test(n));

  check(has(/linkedin/).length > 0, "linkedin tools exist", String(has(/linkedin/).length));

  // These are the tools a model will go looking for, and every one of them
  // would be a lie: LinkedIn has no profile write API at any tier, no
  // self-serve job search, and no application-submission API at all. A tool
  // that existed and failed at call time is worse than no tool, because the
  // model only finds out after telling the user it is doing it.
  const forbidden = has(/^(update|set|edit)_linkedin_(profile|headline|about|experience)/);
  check(forbidden.length === 0, "nothing claims to edit the LinkedIn profile", String(forbidden));
  const applying = has(/linkedin.*appl|appl.*linkedin/);
  check(applying.length === 0, "nothing claims to apply to a job", String(applying));
  const searching = has(/^search_linkedin_jobs$|^find_linkedin_jobs$/);
  check(searching.length === 0, "nothing claims to search jobs through an API", String(searching));

  // The tool that makes the absences discoverable in one cheap call, so a
  // model asked to "update my headline" learns it must hand the text back.
  check(
    names.includes("get_linkedin_capabilities"),
    "a capabilities tool says what is impossible and what to do instead"
  );
  // Publishing is immediate and public, so it must be rehearsable.
  const post = TOOLS.find((t) => t.name === "create_linkedin_post");
  check(!!post?.inputSchema?.properties?.dryRun, "create_linkedin_post can be rehearsed with dryRun");
  const del = TOOLS.find((t) => t.name === "delete_linkedin_post");
  check(!!del?.inputSchema?.properties?.confirm, "delete_linkedin_post asks for confirmation");

  // Edit, comment and react are real (w_member_social) and public, so each is
  // write-scoped, the irreversible one confirms, and the public ones rehearse.
  const social = [
    "edit_linkedin_post", "comment_on_linkedin_post", "edit_linkedin_comment",
    "delete_linkedin_comment", "react_on_linkedin", "remove_linkedin_reaction",
  ].map((n) => TOOLS.find((t) => t.name === n));
  check(social.every((t) => t && t.scope === "write"), "every LinkedIn write tool needs the write scope");
  check(
    !!TOOLS.find((t) => t.name === "delete_linkedin_comment")?.inputSchema?.properties?.confirm,
    "delete_linkedin_comment asks for confirmation"
  );
  check(
    ["edit_linkedin_post", "comment_on_linkedin_post"].every(
      (n) => !!TOOLS.find((t) => t.name === n)?.inputSchema?.properties?.dryRun
    ),
    "editing a post and commenting can both be rehearsed with dryRun"
  );
  // The guards refuse before any credential is touched.
  const refuses = async (name, args, re) => {
    try {
      await TOOLS.find((t) => t.name === name).handler(args, { idToken: "x" });
      return false;
    } catch (e) {
      return re.test(e.message);
    }
  };
  check(
    await refuses("comment_on_linkedin_post", { post: "https://example.com/not-a-post", text: "hi" }, /not a LinkedIn post URN/),
    "a comment on something that is not a post is refused before any I/O"
  );
  check(
    await refuses("comment_on_linkedin_post", { post: "urn:li:share:1", text: "x".repeat(1251) }, /1250/),
    "an over-long comment is refused before any I/O"
  );
  check(
    await refuses("delete_linkedin_comment", { commentUrn: "urn:li:share:1", confirm: true }, /not a LinkedIn comment URN/),
    "a post URN passed as a comment is refused before any I/O"
  );
  check(
    await refuses("react_on_linkedin", { target: "urn:li:share:1", reaction: "curious" }, /Unknown reaction|curious/i)
      || !TOOLS.find((t) => t.name === "react_on_linkedin").inputSchema.properties.reaction.enum.includes("curious"),
    "the deprecated Curious reaction is not offered"
  );
  const dry = await TOOLS.find((t) => t.name === "edit_linkedin_post").handler(
    { urn: "urn:li:share:1", text: "Shipped (finally) a #rust tool_name", dryRun: true },
    { idToken: "x" }
  );
  check(
    dry.dryRun && dry.commentary === "Shipped \\(finally\\) a #rust tool\\_name",
    "an edit's dry run shows the text escaped for LinkedIn, hashtags kept",
    dry.commentary
  );
}

console.log("\nGitHub tools curate, and cannot destroy");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const gh = TOOLS.filter((t) => /github/.test(t.name));
  const names = gh.map((t) => t.name);

  check(gh.length >= 10, "the github tools exist", String(gh.length));

  // Several GitHub accounts can be connected. A tool without accountId can
  // only ever act as "the only one", and with two connected it is refused as
  // ambiguous — so every one of them must be able to name the account.
  const blind = gh.filter((t) => !t.inputSchema?.properties?.accountId).map((t) => t.name);
  check(blind.length === 0, "every github tool can name which account acts", blind.join(", "));

  // Deleting a repository is irreversible and GitHub gates it behind a scope
  // this app never requests (see integrations-check). There must be no tool
  // for it either, so the absence is a decision rather than an oversight.
  check(
    !names.some((n) => /delete_github|github_delete|transfer/.test(n)),
    "nothing deletes or transfers a repository",
    String(names.filter((n) => /delete|transfer/.test(n)))
  );
  // Making a repository private hides it from the profile, and making a
  // private one public is a disclosure. Neither belongs behind a chat prompt.
  const updater = TOOLS.find((t) => t.name === "update_github_repo");
  check(!!updater, "update_github_repo exists");
  check(
    !updater?.inputSchema?.properties?.private,
    "and it cannot flip a repository's visibility"
  );

  // Writes must be scoped as writes; a read-only token must get none of them.
  const writers = gh.filter((t) => /^(update|create)_/.test(t.name));
  check(writers.length > 0, "there are github write tools", String(writers.length));
  check(
    writers.every((t) => t.scope === "write"),
    "and every one is behind the write scope",
    String(writers.filter((t) => t.scope !== "write").map((t) => t.name))
  );
  const readers = gh.filter((t) => /^(get|list|audit)_/.test(t.name));
  check(
    readers.every((t) => t.scope === "read"),
    "every github read tool is behind the read scope",
    String(readers.filter((t) => t.scope !== "read").map((t) => t.name))
  );

  // owner is optional everywhere: it defaults to the connected account, and
  // making a model supply it on every call is friction that buys nothing.
  const withOwner = gh.filter((t) => t.inputSchema?.properties?.owner);
  check(
    withOwner.every((t) => !(t.inputSchema.required || []).includes("owner")),
    "owner is never required — it defaults to the connected account",
    String(withOwner.filter((t) => (t.inputSchema.required || []).includes("owner")).map((t) => t.name))
  );

  // A README write is a real commit on the default branch. The tool has to say
  // so, or a model will treat it as a draft.
  const readme = TOOLS.find((t) => t.name === "update_github_readme");
  check(
    /commit/i.test(readme?.description || ""),
    "update_github_readme says it makes a commit"
  );
  check(
    (readme?.inputSchema?.required || []).includes("content"),
    "and requires the full replacement content"
  );
}

console.log("\nNotes speak one vocabulary over four places");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const { NOTE_SOURCES, DEFAULT_SOURCE } = await import("../lib/server/noteSources.js");
  const noteTools = TOOLS.filter((t) => /note/.test(t.name));
  const names = noteTools.map((t) => t.name);

  check(noteTools.length >= 8, "the note tools exist", String(noteTools.length));

  // Four families of tool name would make a model express WHICH service it
  // meant by picking a name, and it would pick wrong.
  check(
    !names.some((n) => /^(notion|trello|obsidian|local|keep)_/.test(n)),
    "no source-specific tool names",
    String(names.filter((n) => /^(notion|trello|obsidian|local|keep)_/.test(n)))
  );

  const withSource = noteTools.filter((t) => t.inputSchema?.properties?.source);
  check(withSource.length >= 7, "the tools take a source", String(withSource.length));
  // Defaulted, never required: the built-in store is the one that always works.
  check(
    withSource.every((t) => !(t.inputSchema.required || []).includes("source")),
    "and never require it",
    String(withSource.filter((t) => (t.inputSchema.required || []).includes("source")).map((t) => t.name))
  );
  check(DEFAULT_SOURCE === "local", "the default source is the built-in store");

  // Google Keep must not be offerable. Its API is a Workspace admin/DLP API
  // that a personal account cannot reach, so a tool accepting it would be a
  // call that always fails.
  const enums = withSource.map((t) => t.inputSchema.properties.source.enum || []);
  check(
    enums.every((e) => !e.includes("keep")),
    "Google Keep is not selectable anywhere",
    JSON.stringify(enums.find((e) => e.includes("keep")) || [])
  );
  check(
    NOTE_SOURCES.keep.available === false && /enterprise|Workspace/i.test(NOTE_SOURCES.keep.reason),
    "but it is declared, with the reason, rather than quietly missing"
  );
  check(
    TOOLS.some((t) => t.name === "list_note_sources"),
    "and a tool reports which sources are usable"
  );

  // Deleting means four different things; the one with no undo is Trello.
  const del = TOOLS.find((t) => t.name === "delete_note");
  check(!!del?.inputSchema?.properties?.confirm, "delete_note asks for confirmation");
  check(
    !(del?.inputSchema?.required || []).includes("confirm"),
    "without making confirm required, so the dry run is the default"
  );

  const writers = noteTools.filter((t) => /^(create|update|append|delete)_/.test(t.name));
  check(writers.length >= 4, "there are note write tools", String(writers.length));
  check(
    writers.every((t) => t.scope === "write"),
    "and every one is behind the write scope",
    String(writers.filter((t) => t.scope !== "write").map((t) => t.name))
  );
  check(
    noteTools.filter((t) => /^(list|get|search)_/.test(t.name)).every((t) => t.scope === "read"),
    "every note read tool is behind the read scope"
  );

  // The reason append_to_note exists at all.
  check(
    /without sending its whole body/i.test(TOOLS.find((t) => t.name === "append_to_note")?.description || ""),
    "append_to_note says why it is not just update_note"
  );
}

console.log("\nsocial tools promise only what the services offer");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const names = TOOLS.map((t) => t.name);
  const has = (re) => names.filter((n) => re.test(n));

  check(has(/youtube|instagram|_x_|social/).length > 0, "social tools exist");

  // Each of these would be a tool that fails at call time, which is worse than
  // no tool: the model only finds out after telling the user it is doing it.
  check(
    has(/^(edit|update)_x_post$/).length === 0,
    "nothing claims to edit an X post — X has no edit endpoint at any tier",
    String(has(/^(edit|update)_x_post$/))
  );
  check(
    has(/^(edit|update)_instagram_(caption|media|post)$/).length === 0,
    "nothing claims to edit an Instagram caption",
    String(has(/^(edit|update)_instagram_(caption|media|post)$/))
  );
  check(
    has(/^upload_youtube/).length === 0,
    "nothing claims to upload a video — a resumable session cannot be held by a serverless function",
    String(has(/^upload_youtube/))
  );
  check(
    names.includes("get_social_capabilities"),
    "a capabilities tool reports all of that in one call"
  );
  check(names.includes("list_social_accounts"), "and the accounts are discoverable");

  // Multi-account: every social tool must accept an accountId, because with
  // two handles connected the alternative is posting to whichever one the
  // store happened to return first.
  // list_youtube_channels is the one exception, by name: like
  // list_social_accounts it reads EVERY account, so there is none to name.
  const SPANS_ALL = ["list_youtube_channels"];
  const perAccount = TOOLS.filter(
    (t) =>
      /^(get|list|update|delete|create|publish|reply|add)_(youtube|instagram|x)_/.test(t.name) &&
      !SPANS_ALL.includes(t.name)
  );
  const missing = perAccount.filter((t) => !t.inputSchema?.properties?.accountId);
  check(
    perAccount.length > 0 && missing.length === 0,
    "every per-account social tool takes an accountId",
    String(missing.map((t) => t.name))
  );
  // Never REQUIRED: with one account connected, naming it is friction.
  const required = perAccount.filter((t) => (t.inputSchema.required || []).includes("accountId"));
  check(required.length === 0, "and never requires it", String(required.map((t) => t.name)));

  // Anything public and irreversible is rehearsable or confirmed.
  for (const n of ["create_x_post", "create_x_thread", "publish_instagram_post"]) {
    const t = TOOLS.find((x) => x.name === n);
    check(!!t?.inputSchema?.properties?.dryRun, `${n} can be rehearsed with dryRun`);
  }
  for (const n of ["delete_x_post", "delete_youtube_video"]) {
    const t = TOOLS.find((x) => x.name === n);
    check(!!t?.inputSchema?.properties?.confirm, `${n} asks for confirmation`);
  }
}

console.log("\nthe registry survived however it was last merged");
{
  // This exists because a merge silently ATE a tool.
  //
  // Two sessions append tool blocks at the same anchor in mcpTools.js, so every
  // merge conflicts there, and resolving it by keeping both sides cut through
  // the middle of a tool object. That one happened to leave an unbalanced brace
  // and `node --check` caught it. A cut landing cleanly BETWEEN two objects
  // balances perfectly and simply loses tools.
  //
  // Nothing derived from the file can catch that: a whole object disappearing
  // takes its source text AND its registry entry with it, so the two still
  // agree. A first attempt at this guard compared them and passed happily with
  // a tool deleted — verified by deleting one. The only thing that catches it
  // is an expectation held OUTSIDE the file.
  //
  // So the names are pinned here. Adding a tool means adding a line, which is
  // the point: a tool should not appear or vanish without someone saying so.
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const loaded = new Set(TOOLS.map((t) => t.name));

  // One line per family, so a merge that drops a whole block is as loud as one
  // that drops a single tool.
  const EXPECTED = {
    // The authentication centre. Every other family that touches an outside
    // account depends on these being callable first, so losing one silently
    // would leave a model guessing which handle it is posting as.
    accounts: [
      "list_accounts", "whoami_for", "get_account_services", "set_default_account",
      "get_account_login",
    ],
    // Two of the five services genuinely cannot report, and list_insights is
    // what tells a model that in one call instead of leaving it to hunt.
    insights: [
      "list_insights", "get_youtube_insights", "get_instagram_insights", "get_github_traffic",
      // Several channels: list them, then the two questions a creator asks.
      "list_youtube_channels", "get_youtube_daily_growth", "get_youtube_top_videos",
    ],
    // The channel's own description is a WRITE that replaces the whole record;
    // losing the read half would leave only the destructive one registered.
    youtube: ["get_youtube_channel_config", "update_youtube_channel"],
    tasks: [
      "list_task_providers", "list_task_groups", "create_task_group", "rename_task_group",
      "delete_task_group", "list_tasks", "create_task", "update_task", "move_task",
      "delete_task", "clear_completed_tasks",
    ],
    github: [
      "get_github_profile", "update_github_profile", "list_github_repos", "get_github_repo",
      "update_github_repo", "create_github_repo", "get_github_readme", "update_github_readme",
      "get_github_file", "update_github_file", "list_github_pinned", "audit_github_repos",
      "get_github_analytics", "list_github_top_repos",
    ],
    notes: [
      "list_note_sources", "list_notebooks", "list_notes", "get_note", "create_note",
      "update_note", "append_to_note", "delete_note", "search_notes",
    ],
    linkedin: [
      "get_linkedin_capabilities", "get_linkedin_profile", "create_linkedin_post",
      "list_linkedin_posts", "delete_linkedin_post", "draft_linkedin_post",
      "get_linkedin_drift", "linkedin_job_search_url",
      "edit_linkedin_post", "comment_on_linkedin_post", "edit_linkedin_comment",
      "delete_linkedin_comment", "react_on_linkedin", "remove_linkedin_reaction",
    ],
    social: [
      "list_social_accounts", "get_social_capabilities",
      "get_youtube_channel", "list_youtube_videos", "get_youtube_video",
      "update_youtube_video", "delete_youtube_video", "list_youtube_playlists",
      "create_youtube_playlist", "add_video_to_youtube_playlist",
      "list_youtube_comments", "reply_to_youtube_comment",
      "get_instagram_account", "list_instagram_media", "publish_instagram_post",
      "list_instagram_comments", "reply_to_instagram_comment",
      "get_x_account", "list_x_posts", "create_x_post", "create_x_thread",
      "delete_x_post",
    ],
    analytics: [
      "list_analytics_properties", "get_analytics_fields", "get_analytics_summary",
      "get_analytics_report", "get_analytics_top_pages", "get_analytics_sources",
      "get_analytics_realtime",
    ],
    // The ML lab. Search is the point of half of these, so losing one quietly
    // would leave a model unable to find the dataset it was asked to train on.
    huggingface: [
      "hf_whoami", "hf_search", "hf_search_papers", "hf_daily_papers", "hf_semantic_search_spaces", "hf_search_docs",
      "hf_get_repo", "hf_list_files", "hf_read_file", "hf_list_commits", "hf_list_my_repos",
      "hf_list_collections", "hf_get_collection", "hf_create_repo", "hf_commit_files", "hf_delete_file",
      "hf_add_to_collection", "hf_space_status", "hf_restart_space", "hf_set_space_secret", "hf_inference",
      "hf_jobs_hardware", "hf_run_job", "hf_list_jobs", "hf_get_job", "hf_job_logs", "hf_cancel_job", "hf_usage",
    ],
    kaggle: [
      "kaggle_whoami", "kaggle_search_datasets", "kaggle_search_competitions", "kaggle_search_notebooks", "kaggle_search_models",
      "kaggle_get_dataset", "kaggle_list_dataset_files", "kaggle_get_competition", "kaggle_leaderboard", "kaggle_list_submissions",
      "kaggle_push_kernel", "kaggle_kernel_status", "kaggle_kernel_output", "kaggle_get_kernel", "kaggle_cancel_kernel",
      "kaggle_quota", "kaggle_create_dataset_version", "kaggle_submit",
    ],
    env: [
      "get_env_status", "set_env_var", "import_env_vars", "delete_env_var",
      "get_runtime_config",
    ],
    // Reading mail is the most sensitive thing this server does and sending it
    // is the most dangerous: a sent message is irreversible, outward-facing,
    // reaches a real person and arrives wearing the owner's name. Nothing else
    // here has all four at once.
    mail: [
      "list_mail_accounts", "read_mail", "read_all_mail", "get_mail_message",
      "send_mail", "reply_to_mail", "update_mail", "list_mail_folders",
      "get_mail_analytics",
    ],
  };

  const byName = new Map(TOOLS.map((t) => [t.name, t]));

  for (const [family, names] of Object.entries(EXPECTED)) {
    const gone = names.filter((n) => !loaded.has(n));
    check(gone.length === 0, `every ${family} tool is still registered`, gone.join(", "));

    // The OTHER half of the same corruption: a tool whose body was cut but
    // whose opening lines survived. The object still parses and the name is
    // still there, so a presence check passes — but the handler is gone, which
    // is the one field that cannot be faked by a half-eaten object.
    const hollow = names
      .filter((n) => byName.has(n))
      .filter((n) => {
        const t = byName.get(n);
        return (
          typeof t.handler !== "function" ||
          !t.scope ||
          !t.inputSchema ||
          t.inputSchema.type !== "object" ||
          !t.description
        );
      });
    check(hollow.length === 0, `and every ${family} tool still has a body`, hollow.join(", "));
  }

  // The other half of a bad merge: both sides' copy of one tool surviving.
  // toolByName would silently resolve to whichever came first.
  const all = TOOLS.map((t) => t.name);
  const dupes = all.filter((n, i) => all.indexOf(n) !== i);
  check(dupes.length === 0, "and no tool was duplicated by one", dupes.join(", "));
}

console.log("\nMail: the guards that make sending survivable");
{
  const { TOOLS, listToolsFor } = await import("../lib/server/mcpTools.js");
  const mail = TOOLS.filter((t) => /mail/.test(t.name));

  // Both outward-facing verbs must be able to show the message WITHOUT sending
  // it. A model that can only send has no way to put the text in front of the
  // person before it goes, and the person is the only one who can catch a
  // wrong recipient.
  for (const n of ["send_mail", "reply_to_mail"]) {
    const t = TOOLS.find((x) => x.name === n);
    check(!!t?.inputSchema?.properties?.dryRun, `${n} takes dryRun, so it can be shown before it is sent`);
    check(/CANNOT BE UNDONE/i.test(t?.description || ""), `and ${n} says in its own description that it cannot be undone`);
    check(t?.scope === "write", `and ${n} is behind the write scope`, t?.scope);
  }

  // A reply that names no message arrives as a brand-new mail to somebody
  // expecting an answer, which LOOKS like it worked -- the worst failure shape
  // there is. The schema must require the target rather than hope for it.
  const reply = TOOLS.find((t) => t.name === "reply_to_mail");
  check(
    (reply?.inputSchema?.required || []).includes("messageId"),
    "reply_to_mail REQUIRES the message it answers"
  );

  // Deliberate absences. The scope that would allow a permanent delete
  // (https://mail.google.com/) is never requested, so a tool for it could not
  // work even if somebody wrote one -- and a tool that fails at call time is
  // worse than no tool, because the model only finds out after telling the
  // user it is doing it.
  check(
    !mail.some((t) => /permanent|purge|empty_trash|^delete_mail/.test(t.name)),
    "no tool permanently deletes mail",
    mail.map((t) => t.name).join(", ")
  );
  check(
    !mail.some((t) => /connect|disconnect|authori[sz]e/.test(t.name)),
    "and none connects or disconnects a mailbox"
  );
  // A forwarding address or a server-side rule outlives the conversation that
  // made it and keeps sending mail somewhere after nobody is watching. That is
  // the same class as a standing credential, and it is not on offer.
  check(
    !mail.some((t) => /forward|filter|rule|vacation|auto_?reply/.test(t.name)),
    "and none creates a forwarding address, a filter or an auto-reply"
  );

  // read_all_mail spans every mailbox, so naming one would be meaningless --
  // the same exemption list_all_tasks has.
  const all = TOOLS.find((t) => t.name === "read_all_mail");
  check(!all?.inputSchema?.properties?.accountId, "read_all_mail takes no accountId: it spans every mailbox");
  const perBox = [
    "read_mail", "get_mail_message", "send_mail", "reply_to_mail", "update_mail",
    "list_mail_folders", "get_mail_analytics",
  ];
  const missing = perBox.filter((n) => !TOOLS.find((t) => t.name === n)?.inputSchema?.properties?.accountId);
  check(missing.length === 0, "and every per-mailbox tool declares accountId", missing.join(", "));
  const required = perBox.filter((n) =>
    (TOOLS.find((t) => t.name === n)?.inputSchema?.required || []).includes("accountId")
  );
  check(required.length === 0, "while none REQUIRES it, since one mailbox is still the common case", required.join(", "));

  // A read-only token must not be offered a way to send. This is the check
  // that would have caught send_mail being given the wrong scope on a merge.
  const readOnly = listToolsFor(["read"]).map((t) => t.name);
  check(
    !readOnly.some((n) => ["send_mail", "reply_to_mail", "update_mail"].includes(n)),
    "a read-only token is offered nothing that sends or changes a message"
  );
  check(readOnly.includes("read_all_mail"), "but it can still read the inbox");
}

console.log("\nML lab: what must stay absent");
{
  const { TOOLS, listToolsFor } = await import("../lib/server/mcpTools.js");
  const ml = TOOLS.filter((t) => /^(hf|kaggle)_/.test(t.name) || t.name === "get_ml_credentials");
  check(
    !ml.some((t) => /delete_(repo|dataset|kernel)|make_public|set_visibility/.test(t.name)),
    "no ML tool deletes a repo/dataset/kernel or flips visibility"
  );
  const cred = TOOLS.find((t) => t.name === "get_ml_credentials");
  check(cred?.scope === "secrets", "get_ml_credentials needs the secrets scope", String(cred?.scope));
  check(/HANDLING/.test(cred?.description || ""), "and carries the handling rule");
  const offered = listToolsFor(["read", "write", "vault"]).map((t) => t.name);
  check(!offered.includes("get_ml_credentials"), "read+write+vault tokens are not offered it");
  const create = TOOLS.find((t) => t.name === "hf_create_repo");
  check(/PRIVATE by default/.test(create?.description || ""), "hf_create_repo says private by default");
  for (const n of ["hf_delete_file", "kaggle_submit"]) {
    const out = await TOOLS.find((t) => t.name === n).handler(
      { id: "a/b", paths: ["x"], competition: "c", fileName: "f" },
      { idToken: "" }
    );
    check(out?.isError === true && /confirm/.test(out.error), `${n} refuses without confirm, before any I/O`);
  }
}

console.log("\nGoogle Analytics is read-only by construction");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const ga = TOOLS.filter((t) => /^(list|get)_analytics_/.test(t.name));

  check(ga.length > 0, "analytics tools exist", String(ga.length));
  // The connection holds analytics.readonly, so a write tool could not work
  // even if it existed — but it must not exist, because a tool that fails at
  // call time is worse than no tool.
  const writes = ga.filter((t) => t.scope !== "read");
  check(writes.length === 0, "every analytics tool is read scope", String(writes.map((t) => t.name)));
  const mutators = TOOLS.filter((t) =>
    /^(create|update|delete|set)_analytics_|_analytics_(property|stream|account)$/.test(t.name)
  );
  check(
    mutators.length === 0,
    "nothing creates, edits or deletes a property or data stream",
    String(mutators.map((t) => t.name))
  );
  // Every report needs a property, and one Google account commonly owns
  // several — so the list has to be discoverable before anything else.
  check(
    TOOLS.some((t) => t.name === "list_analytics_properties"),
    "the properties are discoverable"
  );
  check(
    TOOLS.some((t) => t.name === "get_analytics_fields"),
    "and so is the metric and dimension vocabulary"
  );
  const needProp = ga.filter((t) => /summary|report|top_pages|sources|realtime/.test(t.name));
  const missing = needProp.filter((t) => !(t.inputSchema.required || []).includes("propertyId"));
  check(
    needProp.length > 0 && missing.length === 0,
    "every reporting tool requires a propertyId",
    String(missing.map((t) => t.name))
  );
}

console.log("\nthe secret store is fenced off from every other scope");
{
  const { TOOLS, listToolsFor } = await import("../lib/server/mcpTools.js");
  const secretTools = TOOLS.filter((t) => /_secret/.test(t.name));

  check(secretTools.length > 0, "secret tools exist", String(secretTools.length));
  // The whole containment argument rests on this: a token holding `secrets` is
  // equivalent to the passwords it can read, so nothing else may imply it.
  const leaked = secretTools.filter((t) => t.scope !== "secrets");
  check(leaked.length === 0, "every secret tool sits behind the secrets scope", String(leaked.map((t) => t.name)));

  for (const combo of [["read"], ["write"], ["vault"], ["read", "write", "vault"]]) {
    const offered = listToolsFor(combo).filter((t) => /_secret/.test(t.name));
    check(
      offered.length === 0,
      `a token with ${combo.join("+")} is offered no secret tool`,
      String(offered.map((t) => t.name))
    );
  }
  check(
    listToolsFor(["secrets"]).filter((t) => /_secret/.test(t.name)).length === secretTools.length,
    "and a secrets token is offered all of them"
  );

  // Listing must never be able to carry a value, however it is called.
  const list = TOOLS.find((t) => t.name === "list_secrets");
  check(!/value/i.test(JSON.stringify(list.inputSchema)), "list_secrets takes no value-revealing option");
  const get = TOOLS.find((t) => t.name === "get_secret");
  check(
    (get.inputSchema.required || []).includes("name"),
    "get_secret reads ONE secret by name, never in bulk"
  );
  const del = TOOLS.find((t) => t.name === "delete_secret");
  check(!!del.inputSchema.properties.confirm, "delete_secret asks for confirmation");

  // The store's own guards, called directly — they must refuse before any I/O.
  // Sealing needs a key; the value of it does not matter to these assertions.
  process.env.SECRETS_KEY ||= "test-key-for-the-suite";
  const store = await import("../lib/server/secretStore.js");
  let threw = "";
  try {
    store.readValue({ value: "x", agentReadable: false }, { forAgent: true, name: "aws" });
  } catch (e) {
    threw = e.message;
  }
  check(
    /not marked readable by an agent/.test(threw),
    "a secret not marked agent-readable is refused to an agent",
    threw.slice(0, 80)
  );
  check(
    store.buildRecord({ name: "a", value: "b" }).record.agentReadable === false,
    "and agentReadable is FALSE by default, so saving never exposes"
  );
  // A listing row must not be able to contain the sealed value either.
  const shaped = store.publicShape("x", { name: "x", value: "SEALED", agentReadable: true });
  check(!("value" in shaped), "a listing row carries no value field at all");
  check(shaped.hasValue === true, "only whether there is one");
}

console.log("\nenvironment tools cannot reach the keys that decrypt everything");
{
  const { TOOLS, listToolsFor } = await import("../lib/server/mcpTools.js");
  const reg = await import("../lib/server/envRegistry.js");
  const envTools = TOOLS.filter((t) => /_env_|_env$|runtime_config/.test(t.name));

  check(envTools.length > 0, "env tools exist", String(envTools.length));
  // A deployment variable is a credential, so these live with the secrets.
  const loose = envTools.filter((t) => t.scope !== "secrets");
  check(loose.length === 0, "every env tool sits behind the secrets scope", String(loose.map((t) => t.name)));
  for (const combo of [["read"], ["write"], ["vault"], ["read", "write", "vault"]]) {
    const offered = listToolsFor(combo).filter((t) => /_env_|_env$|runtime_config/.test(t.name));
    check(offered.length === 0, `a token with ${combo.join("+")} is offered no env tool`, String(offered.map((t) => t.name)));
  }

  // THE containment claim, now that every variable lives in the database:
  // ENV_KEY is refused everywhere, and the keyring keys (which seal other data
  // or decide where the vault's files go) are refused to an MCP token through
  // the ACTUAL tool handlers, before any I/O — a token able to set
  // MCP_TOKEN_SECRET could mint itself any scope.
  {
    let status = 0;
    try {
      reg.assertManageable("ENV_KEY");
    } catch (e) {
      status = e.status;
    }
    check(status === 403, "ENV_KEY is refused with 403 before any I/O", String(status));
  }
  const setTool = TOOLS.find((t) => t.name === "set_env_var");
  const delTool = TOOLS.find((t) => t.name === "delete_env_var");
  for (const key of ["ENV_KEY", "SECRETS_KEY", "MCP_TOKEN_SECRET", "INTEGRATION_SECRET", "B2_APP_KEY", "B2_ENDPOINT"]) {
    let msg = "";
    try {
      await setTool.handler({ key, value: "attacker-chosen" }, { idToken: "x" });
    } catch (e) {
      msg = e.message;
    }
    check(/admin's Environment tab|opens the store|cannot be/.test(msg), `set_env_var refuses ${key} before any I/O`, msg.slice(0, 60));
  }
  {
    let msg = "";
    try {
      await delTool.handler({ key: "MCP_TOKEN_SECRET", confirm: true }, { idToken: "x" });
    } catch (e) {
      msg = e.message;
    }
    check(/admin's Environment tab/.test(msg), "delete_env_var refuses a keyring key too", msg.slice(0, 60));
  }
  {
    const imp = TOOLS.find((t) => t.name === "import_env_vars");
    check(!!imp && imp.scope === "secrets", "bulk import exists and sits behind the secrets scope");
  }
  // Vercel is reachable again, but only to LINK a repository so that pushes
  // deploy themselves. The rule this file used to enforce as "no Vercel at
  // all" is really two narrower rules, and these are the ones worth keeping:
  // nothing ships production on a prompt, and the platform's own environment
  // is not a second place credentials can be written or read.
  {
    const v = TOOLS.filter((t) => /vercel/i.test(t.name)).map((t) => t.name);
    check(v.length === 1 && v[0] === "link_vercel_project", "the only Vercel tool links a repo", v.join(", "));
    check(
      !TOOLS.some((t) => /vercel/i.test(t.name) && /^(deploy|redeploy|promote|rollback)/.test(t.name)),
      "nothing deploys, promotes or rolls back"
    );
    check(
      !TOOLS.some((t) => /vercel/i.test(t.name) && /env/i.test(t.name)),
      "and no tool reads or writes Vercel's own environment — variables live in the sealed store"
    );
  }

  // No tool may return a value. Presence is the whole contract.
  const reader = TOOLS.filter((t) => /^get_env|^list_env/.test(t.name));
  check(
    reader.every((t) => !/\breveal\b|\bdecrypt\b|\bvalue\b/i.test(JSON.stringify(t.inputSchema))),
    "no env tool takes an option that would return a value",
    String(reader.map((t) => t.name))
  );
  const del = TOOLS.find((t) => t.name === "delete_env_var");
  check(!!del.inputSchema.properties.confirm, "delete_env_var asks for confirmation");

  // Nothing may redeploy: setting a variable and shipping the site are two
  // different decisions and should not be made in one call.
  const deployers = TOOLS.filter((t) => /redeploy|trigger_deploy|create_deployment/.test(t.name));
  check(deployers.length === 0, "nothing triggers a deployment", String(deployers.map((t) => t.name)));
}

console.log("\nguards refuse before they touch anything");
{
  const { toolByName } = await import("../lib/server/mcpTools.js");
  const refuses = async (tool, args, name, expect) => {
    let message = "";
    try {
      await toolByName(tool).handler(args, { idToken: "not-a-token" });
    } catch (e) {
      message = e?.message || "";
    }
    check(expect.test(message), name, message || "did NOT throw");
  };

  // Deleting a résumé or a vault object from a chat client is not recoverable.
  await refuses("delete_asset", { key: "vault/aadhaar.pdf.enc" }, "delete_asset refuses a vault key", /media\/|not configured/i);
  await refuses("delete_asset", { key: "resumes/cv.pdf" }, "delete_asset refuses a résumé key", /media\/|not configured/i);
  await refuses("delete_asset", { key: "../../etc/passwd" }, "delete_asset refuses a traversal key", /owns|not configured/i);
  await refuses("list_assets", { prefix: "secrets/" }, "list_assets refuses an unknown prefix", /prefix|not configured/i);

  // The résumé store owns its own document keys — they hold uploaded files and
  // version history, so they are not editable field-by-field from here.
  for (const section of ["resume", "resumeVersions", "resumeByVariant"]) {
    await refuses(
      "set_content_section",
      { section, value: {} },
      `set_content_section refuses "${section}"`,
      /résumé store|resume store/i
    );
  }
  await refuses("get_content_section", { section: "resume" }, "get_content_section refuses the résumé store", /résumé store|resume store/i);
  await refuses("add_content_item", { section: "a b", item: {} }, "add_content_item refuses a malformed section name", /identifier/i);
  await refuses("delete_content_item", { section: "../other", match: "x" }, "delete_content_item refuses a path-shaped section", /identifier/i);

  await refuses("mark_message_replied", { box: "nope", id: "1" }, "mark_message_replied refuses an unknown box", /mail, contact or chat/i);
  await refuses("list_messages", { box: "nope" }, "list_messages refuses an unknown box", /mail, contact or chat/i);

  await refuses("search_posts", { q: "a" }, "search_posts refuses a one-character query", /at least two/i);
  await refuses("replace_in_post", { slug: "x", find: "", replace: "y" }, "replace_in_post refuses an empty search", /text to find/i);
  await refuses(
    "edit_post_section",
    { slug: "x", heading: "h", body: "b", mode: "sideways" },
    "edit_post_section refuses an unknown mode",
    /mode must be/i
  );

  // Both validate before reaching for the Google token, so a malformed call
  // fails on its own terms instead of "reconnect in the admin".
  await refuses("update_task", { groupId: "g", taskId: "t" }, "update_task refuses an empty change", /nothing to change/i);
  await refuses(
    "move_task",
    { groupId: "g", taskId: "t" },
    "move_task refuses a move with no destination",
    /toGroupId, parent, or both/i
  );

  await refuses("update_contact", { id: "someone" }, "update_contact refuses an empty change", /nothing to change|no such contact/i);
  await refuses("update_vault_document", { id: "x" }, "update_vault_document refuses an empty change", /nothing to change|no such vault/i);
}

if (process.env.MCP_TOKEN) {
  console.log("\nlive session (MCP_TOKEN supplied)");
  const tok = process.env.MCP_TOKEN;

  const init = await rpc(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-check", version: "1" } },
    },
    tok
  );
  check(init.status === 200 && init.json?.result?.protocolVersion, "initialize handshake", JSON.stringify(init.json).slice(0, 160));
  check(!!init.json?.result?.serverInfo?.name, "serverInfo returned", init.json?.result?.serverInfo?.name);
  check(!!init.json?.result?.instructions, "instructions returned (clients show these to the model)");

  const notif = await fetch(URL_MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  check(notif.status === 202, "a bare notification gets 202 with no body", `HTTP ${notif.status}`);

  const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, tok);
  const tools = list.json?.result?.tools || [];
  check(tools.length > 0, `tools/list returned ${tools.length} tools`);
  check(
    tools.every((t) => t.name && t.description && t.inputSchema),
    "every tool has a name, description and input schema"
  );

  const call = await rpc(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_profile", arguments: {} } },
    tok
  );
  const isErr = call.json?.result?.isError;
  check(call.status === 200 && !isErr, "get_profile succeeded", JSON.stringify(call.json?.result?.content?.[0]?.text || call.json).slice(0, 200));
  if (!isErr) {
    const profile = call.json?.result?.structuredContent;
    check(!!profile?.name, "profile has a name", profile?.name);
  }

  const bad = await rpc(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "no_such_tool" } },
    tok
  );
  check(bad.json?.error?.code === -32602, "unknown tool → JSON-RPC invalid params", JSON.stringify(bad.json?.error));

  const unknown = await rpc({ jsonrpc: "2.0", id: 5, method: "does/not/exist" }, tok);
  check(unknown.json?.error?.code === -32601, "unknown method → method not found");
} else {
  console.log("\nlive session: skipped (set MCP_TOKEN to run it)");
}

console.log("\ncontacts hold other people's personal data");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const contact = TOOLS.filter((t) => /contact/.test(t.name));
  const names = contact.map((t) => t.name);

  check(contact.length >= 7, "the contact tools exist", String(contact.length));
  // There used to be no way to add one at all: the only route in was a
  // LinkedIn CSV import through the admin.
  check(names.includes("create_contact"), "a contact can be created, not only imported");
  check(names.includes("merge_contacts"), "and two records for one person can be joined");
  check(names.includes("find_duplicate_contacts"), "with a tool that finds them");

  // This is the whole "in any form" requirement.
  const create = TOOLS.find((t) => t.name === "create_contact");
  check(!!create.inputSchema.properties.text, "create_contact accepts free-form text");
  check(!!create.inputSchema.properties.channels, "and structured channels");
  check(
    !(create.inputSchema.required || []).length,
    "with neither required, so either route works",
    JSON.stringify(create.inputSchema.required || [])
  );
  const kinds = create.inputSchema.properties.channels.items.properties.kind.enum;
  check(
    ["email", "phone", "url", "handle", "address"].every((k) => kinds.includes(k)),
    "covering e-mail, phone, url, handle and address",
    JSON.stringify(kinds)
  );

  // Deleting a person and merging two records are both unrecoverable.
  for (const name of ["delete_contact", "merge_contacts"]) {
    const t = TOOLS.find((x) => x.name === name);
    check(!!t?.inputSchema?.properties?.confirm, `${name} asks for confirmation`);
    check(
      !(t.inputSchema.required || []).includes("confirm"),
      `and ${name} does not require it, so the dry run is the default`
    );
  }

  const writers = contact.filter((t) => /^(create|update|merge|delete)_/.test(t.name));
  check(writers.every((t) => t.scope === "write"), "every contact write is behind the write scope",
    String(writers.filter((t) => t.scope !== "write").map((t) => t.name)));
  check(
    contact.filter((t) => /^(list|get|search|find)_/.test(t.name)).every((t) => t.scope === "read"),
    "and every read behind read"
  );

  // The address book is admin-only in firestore.rules; nothing here should
  // suggest otherwise, because it is other people's personal data.
  check(
    /admin-only|private/i.test(TOOLS.find((t) => t.name === "list_contacts").description),
    "list_contacts says the book is private"
  );
}

console.log("\nWhatsApp: one chat at a time, and nothing automatic");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const wa = TOOLS.filter((t) => /whatsapp/.test(t.name));
  const names = wa.map((t) => t.name);

  check(wa.length >= 6, "the whatsapp tools exist", String(wa.length));
  check(names.includes("whatsapp_status"), "a tool reports whether the session is live");

  // THE deliberate absences. Each of these is a capability that is both what
  // gets an account banned and what reaches people who did not ask to hear
  // from you. They are missing on purpose, and this is where that is recorded.
  const banned = /broadcast|bulk|blast|mass|campaign|autoreply|auto_reply|schedule_message/i;
  check(
    !names.some((n) => banned.test(n)),
    "nothing broadcasts, bulk-sends or auto-replies",
    String(names.filter((n) => banned.test(n)))
  );

  const send = TOOLS.find((t) => t.name === "whatsapp_send");
  check(!!send, "whatsapp_send exists");
  // A list-typed recipient is how a single-send tool becomes a bulk-send tool.
  check(
    send.inputSchema.properties.to.type === "string",
    "it takes ONE recipient, not a list",
    JSON.stringify(send.inputSchema.properties.to)
  );
  check(
    /cannot be unsent|real message to a real person/i.test(send.description),
    "and says that a sent message is real and not easily undone"
  );
  check(
    /country code/i.test(send.description),
    "and that a number without a country code is refused rather than guessed"
  );

  // Reading someone's chats is reading other people's words. It must not be
  // available to a token that was only granted read of the site's content...
  // but it IS a read, so read is correct — what matters is that writes are not.
  const writers = wa.filter((t) => /send|mark_read/.test(t.name));
  check(writers.every((t) => t.scope === "write"), "sending and marking read are writes",
    String(writers.filter((t) => t.scope !== "write").map((t) => t.name)));
  check(
    wa.filter((t) => !writers.includes(t)).every((t) => t.scope === "read"),
    "and everything else is a read",
    String(wa.filter((t) => !writers.includes(t) && t.scope !== "read").map((t) => t.name))
  );

  // Marking read shows blue ticks to the other person. That is a visible act
  // and the description has to say so.
  const mark = TOOLS.find((t) => t.name === "whatsapp_mark_read");
  check(/blue tick|visible/i.test(mark.description), "marking read admits it is visible to the other person");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
