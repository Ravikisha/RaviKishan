/* Verifies the remote MCP server.
 *
 *   node scripts/mcp-check.mjs
 *   MCP_TOKEN=rkmcp_… node scripts/mcp-check.mjs   # also exercises real tools
 *
 * Without a token this covers the protocol surface and every way of reaching
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
