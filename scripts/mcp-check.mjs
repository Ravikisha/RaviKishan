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

  const SCOPES = ["read", "write", "vault"];
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
    listToolsFor(["read", "write", "vault"]).length === TOOLS.length,
    "all three scopes together offer everything"
  );
  check(listToolsFor([]).length === 0, "a token with no scopes is offered nothing");
}

console.log("\ncapabilities that must stay absent");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const names = TOOLS.map((t) => t.name);
  const has = (re) => names.filter((n) => re.test(n));

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
  check(
    has(/^(connect|disconnect|authorize|link|unlink)_/).length === 0,
    "but nothing connects or disconnects an account",
    String(has(/^(connect|disconnect|authorize|link|unlink)_/))
  );
  check(
    has(/refresh_token|oauth_google|google_credential|set_integration/).length === 0,
    "and nothing mints or stores a provider credential",
    String(has(/refresh_token|oauth_google|google_credential|set_integration/))
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

console.log("\nGitHub tools curate, and cannot destroy");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const gh = TOOLS.filter((t) => /github/.test(t.name));
  const names = gh.map((t) => t.name);

  check(gh.length >= 10, "the github tools exist", String(gh.length));

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
