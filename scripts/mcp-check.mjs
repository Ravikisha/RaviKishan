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
  const perAccount = TOOLS.filter(
    (t) => /^(get|list|update|delete|create|publish|reply|add)_(youtube|instagram|x)_/.test(t.name)
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
    tasks: [
      "list_task_providers", "list_task_groups", "create_task_group", "rename_task_group",
      "delete_task_group", "list_tasks", "create_task", "update_task", "move_task",
      "delete_task", "clear_completed_tasks",
    ],
    github: [
      "get_github_profile", "update_github_profile", "list_github_repos", "get_github_repo",
      "update_github_repo", "create_github_repo", "get_github_readme", "update_github_readme",
      "get_github_file", "update_github_file", "list_github_pinned", "audit_github_repos",
    ],
    notes: [
      "list_note_sources", "list_notebooks", "list_notes", "get_note", "create_note",
      "update_note", "append_to_note", "delete_note", "search_notes",
    ],
    linkedin: [
      "get_linkedin_capabilities", "get_linkedin_profile", "create_linkedin_post",
      "list_linkedin_posts", "delete_linkedin_post", "draft_linkedin_post",
      "get_linkedin_drift", "linkedin_job_search_url",
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
