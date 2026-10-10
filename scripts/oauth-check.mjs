/* Verifies the OAuth 2.1 authorization server.
 *
 *   node scripts/oauth-check.mjs
 *
 * The parts that can be checked without a human at the consent screen: both
 * discovery documents, dynamic client registration and its redirect_uri
 * validation, the authorization-request validator, PKCE enforcement, and every
 * way of reaching the token endpoint with something it should refuse.
 *
 * The consent step itself needs a real sign-in, so the end-to-end code
 * exchange is exercised by hand — see the report at the end for the command.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const BASE = process.env.BASE_URL || "http://localhost:3000";

for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
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

const post = async (p, body, headers = {}) => {
  const res = await fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

console.log(`base: ${BASE}\n`);

console.log("discovery");
let meta = null;
const scopeMeta = {};
{
  const r = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
  check(r.ok, "authorization server metadata served", `HTTP ${r.status}`);
  if (r.ok) {
    meta = await r.json();
    check(!!meta.issuer, "has an issuer", meta.issuer);
    check(/\/oauth\/authorize$/.test(meta.authorization_endpoint || ""), "authorization endpoint", meta.authorization_endpoint);
    check(/\/api\/oauth\/token$/.test(meta.token_endpoint || ""), "token endpoint", meta.token_endpoint);
    check(/\/api\/oauth\/register$/.test(meta.registration_endpoint || ""), "registration endpoint (dynamic client registration)");
    check(
      (meta.code_challenge_methods_supported || []).length === 1 &&
        meta.code_challenge_methods_supported[0] === "S256",
      "advertises S256 PKCE only (2.1 drops `plain`)",
      String(meta.code_challenge_methods_supported)
    );
    check(
      !(meta.grant_types_supported || []).includes("implicit") &&
        !(meta.grant_types_supported || []).includes("password"),
      "does not advertise the grants OAuth 2.1 removed"
    );
  }

  const pr = await fetch(`${BASE}/.well-known/oauth-protected-resource`);
  const prj = pr.ok ? await pr.json() : {};
  check(
    Array.isArray(prj.authorization_servers) && prj.authorization_servers.length === 1,
    "protected-resource metadata now points at the authorization server",
    JSON.stringify(prj.authorization_servers)
  );
  scopeMeta.pr = prj.scopes_supported;
}

// One scope catalogue (lib/server/mcpScopes.js) feeds the server, both
// discovery documents and the consent screen. A client that reads
// scopes_supported must be told about agent and secrets too, or it can never
// ask for them; the consent screen must offer them but never tick them.
console.log("\nscopes");
{
  const { ALL_SCOPES, DANGEROUS_SCOPES, consentDefaults } = await import("../lib/server/mcpScopes.js");
  const { ALL_SCOPES: TOKEN_SCOPES } = await import("../lib/server/mcpToken.js");
  const same = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
  check(same(ALL_SCOPES, TOKEN_SCOPES), "mcpToken honours exactly the catalogue's scopes", TOKEN_SCOPES.join(","));
  for (const s of ["read", "write", "vault", "secrets", "agent"]) check(ALL_SCOPES.includes(s), `the catalogue has ${s}`);
  check(same(meta?.scopes_supported, ALL_SCOPES), "authorization server advertises every scope", JSON.stringify(meta?.scopes_supported));
  check(same(scopeMeta.pr, ALL_SCOPES), "protected-resource metadata advertises every scope", JSON.stringify(scopeMeta.pr));
  check(
    Object.keys(DANGEROUS_SCOPES).sort().join(",") === "agent,secrets" &&
      Object.values(DANGEROUS_SCOPES).every((w) => w.length > 10),
    "agent and secrets are the dangerous ones, each with a stated reason"
  );
  const d = (q) => consentDefaults(q).sort().join(",");
  check(d(undefined) === "read", "consent ticks read when nothing is asked for", d(undefined));
  check(d("read write") === "read,write", "consent ticks the safe scopes a client asked for", d("read write"));
  check(d("read+vault") === "read,vault", "and reads a +-joined scope list", d("read+vault"));
  check(d("agent secrets") === "read", "never ticks agent or secrets, even when asked", d("agent secrets"));
  check(d("write agent") === "write", "drops the dangerous half of a mixed request", d("write agent"));
  check(d("admin root") === "read", "ignores scopes that do not exist", d("admin root"));

  // The consent page is a client component; prove from its source that it
  // offers the whole catalogue and pre-ticks only through consentDefaults.
  const page = fs.readFileSync(path.join(root, "pages/oauth/authorize.js"), "utf8");
  check(
    /ALL_SCOPES\.map\(/.test(page) && page.includes('from "../../lib/server/mcpScopes"'),
    "the consent screen offers every scope from the catalogue"
  );
  check(page.includes("consentDefaults(q.scope)"), "and pre-ticks only what consentDefaults allows");
  check(
    page.includes('type="checkbox"') && page.includes("dangerous") && page.includes("DANGEROUS_SCOPES[s]"),
    "each scope is a checkbox; the dangerous ones say so and why"
  );
  check(!page.includes('["read", "write", "vault"]'), "no hard-coded three-scope list survives on the page");
  for (const f of ["pages/api/well-known/oauth-authorization-server.js", "pages/api/well-known/oauth-protected-resource.js"]) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    check(src.includes("scopes_supported: ALL_SCOPES"), `${path.basename(f)} derives scopes_supported`);
  }
  const issue = fs.readFileSync(path.join(root, "pages/api/oauth/issue.js"), "utf8");
  check(/filter\(\(s\) => ALL_SCOPES\.includes\(s\)\)/.test(issue), "issuing a code accepts exactly the catalogue's scopes");
}

console.log("\ndynamic client registration");
let client = null;
{
  const good = await post("/api/oauth/register", {
    client_name: "oauth-check",
    redirect_uris: ["https://chat.example.com/callback"],
  });
  check(good.status === 201, "registers a client", `HTTP ${good.status} ${JSON.stringify(good.json)}`);
  client = good.json;
  check(typeof client.client_id === "string" && client.client_id.startsWith("rkclient_"), "issues a client_id");
  check(client.token_endpoint_auth_method === "none", "public client (PKCE instead of a secret)");

  for (const [label, uris] of [
    ["http (non-loopback)", ["http://evil.example.com/cb"]],
    ["fragment in the uri", ["https://ok.example.com/cb#frag"]],
    ["not a url", ["notaurl"]],
    ["empty list", []],
  ]) {
    const r = await post("/api/oauth/register", { client_name: "x", redirect_uris: uris });
    check(r.status === 400, `rejects ${label}`, `HTTP ${r.status}`);
  }

  const loop = await post("/api/oauth/register", {
    client_name: "native",
    redirect_uris: ["http://127.0.0.1:8976/cb"],
  });
  check(loop.status === 201, "allows http on loopback (native clients)", `HTTP ${loop.status}`);
}

console.log("\nauthorization request validation");
{
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
  const ok = {
    client_id: client.client_id,
    redirect_uri: "https://chat.example.com/callback",
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
  };

  const good = await post("/api/oauth/validate", ok);
  check(good.status === 200, "accepts a well-formed request", JSON.stringify(good.json));
  check(good.json.client_name === "oauth-check", "returns the client name for the consent screen");

  const noPkce = await post("/api/oauth/validate", { ...ok, code_challenge: "", code_challenge_method: "" });
  check(noPkce.status === 400, "rejects a request without PKCE");

  const plain = await post("/api/oauth/validate", { ...ok, code_challenge_method: "plain" });
  check(plain.status === 400, "rejects code_challenge_method=plain");

  const badRedirect = await post("/api/oauth/validate", {
    ...ok,
    redirect_uri: "https://chat.example.com/callback/../evil",
  });
  check(badRedirect.status === 400, "rejects an unregistered redirect_uri (exact match only)");

  const prefix = await post("/api/oauth/validate", {
    ...ok,
    redirect_uri: "https://chat.example.com/callback.evil.com",
  });
  check(prefix.status === 400, "rejects a redirect_uri that merely starts with a registered one");

  const token = await post("/api/oauth/validate", { ...ok, response_type: "token" });
  check(token.status === 400, "rejects the implicit flow");

  const forgedClient = await post("/api/oauth/validate", { ...ok, client_id: "rkclient_" + crypto.randomBytes(40).toString("base64url") });
  check(forgedClient.status === 400, "rejects a forged client_id");
}

console.log("\nissuing a code requires the signed-in owner");
{
  const r = await post("/api/oauth/issue", {
    client_id: client.client_id,
    redirect_uri: "https://chat.example.com/callback",
    code_challenge: "x".repeat(43),
    scopes: ["read"],
    refreshToken: "attacker-supplied",
  });
  check(r.status === 401, "no Firebase ID token → 401", `HTTP ${r.status}`);

  const r2 = await post(
    "/api/oauth/issue",
    { client_id: client.client_id, redirect_uri: "https://chat.example.com/callback", scopes: ["read"] },
    { Authorization: "Bearer not.a.jwt" }
  );
  check(r2.status === 401, "bogus ID token → 401", `HTTP ${r2.status}`);
}

console.log("\ntoken endpoint");
{
  const form = async (body) => {
    const res = await fetch(`${BASE}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    return { status: res.status, json: await res.json().catch(() => ({})), headers: res.headers };
  };

  const get = await fetch(`${BASE}/api/oauth/token`);
  check(get.status === 405, "GET is refused", `HTTP ${get.status}`);

  const noGrant = await form({ code: "x" });
  check(noGrant.status === 400 && noGrant.json.error === "unsupported_grant_type", "missing grant_type rejected", JSON.stringify(noGrant.json));

  const pw = await form({ grant_type: "password", username: "a", password: "b" });
  check(pw.status === 400, "password grant rejected (removed in 2.1)");

  const junk = await form({
    grant_type: "authorization_code",
    code: "rkcode_" + crypto.randomBytes(60).toString("base64url"),
    client_id: client.client_id,
    redirect_uri: "https://chat.example.com/callback",
    code_verifier: "x".repeat(50),
  });
  check(junk.status === 400 && junk.json.error === "invalid_grant", "a forged authorization code is rejected", JSON.stringify(junk.json));

  const cc = (await form({ grant_type: "x" })).headers.get("cache-control") || "";
  check(/no-store/.test(cc), "token responses are no-store", cc);
}

console.log("\ncode crypto + PKCE (in-process)");
{
  const oauth = await import("../lib/server/oauth.js");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");

  const code = oauth.issueCode({
    clientId: "rkclient_test",
    redirectUri: "https://x.example/cb",
    scopes: ["read"],
    codeChallenge: challenge,
    refreshToken: "rt",
  });
  const read = oauth.readCode(code);
  check(read.rt === "rt" && read.ru === "https://x.example/cb", "code round-trips its binding");
  check(oauth.verifyPkce(challenge, verifier), "correct verifier passes PKCE");
  check(!oauth.verifyPkce(challenge, crypto.randomBytes(48).toString("base64url")), "wrong verifier fails PKCE");
  check(!oauth.verifyPkce(challenge, "short"), "a too-short verifier fails PKCE");

  const raw = Buffer.from(code.slice("rkcode_".length), "base64url");
  raw[raw.length - 1] ^= 0xff;
  let threw = false;
  try {
    oauth.readCode("rkcode_" + raw.toString("base64url"));
  } catch (_) {
    threw = true;
  }
  check(threw, "a tampered code is rejected");

  const expired = oauth.issueCode({
    clientId: "c",
    redirectUri: "https://x.example/cb",
    scopes: ["read"],
    codeChallenge: challenge,
    refreshToken: "rt",
  });
  check(oauth.readCode(expired).exp > Math.floor(Date.now() / 1000), "codes carry a short expiry");
  check(oauth.CODE_TTL <= 300, `code TTL is ${oauth.CODE_TTL}s`);
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(
  "\nThe consent step needs a human. To exercise it end to end, open:\n" +
    `  ${BASE}/oauth/authorize?client_id=${encodeURIComponent(client?.client_id || "")}` +
    `&redirect_uri=${encodeURIComponent("https://chat.example.com/callback")}` +
    `&response_type=code&code_challenge=<S256>&code_challenge_method=S256&scope=read&state=abc`
);
process.exit(fail ? 1 : 0);
