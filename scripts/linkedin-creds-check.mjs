// Is the LinkedIn app set up, before anyone presses Connect?
//
//   npm run linkedin:creds
//
// Everything here asks LinkedIn itself, with NO user session, and prints no
// secret. Each failure on the consent screen is otherwise discovered one at a
// time, after a sign-in, as a LinkedIn error page with no route back:
//
//   - the client id        the authorize endpoint names an unknown one
//   - every redirect URL   "redirect_uri does not match the registered value"
//   - every scope          "invalid_scope_error" means the PRODUCT granting it
//                          is not active on the app yet
//   - the client secret    the token endpoint is sent a fake code: a good
//                          secret fails on the CODE, a bad one on the CLIENT
//
// Reads LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET from the environment, then
// .env.local.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { linkedinRedirectUris } from "../lib/server/linkedinText.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fromFile = (() => {
  try {
    return Object.fromEntries(
      fs
        .readFileSync(path.join(root, ".env.local"), "utf8")
        .split(/\r?\n/)
        .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l))
        .filter(Boolean)
        .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")])
    );
  } catch {
    return {};
  }
})();
const env = (k) => process.env[k] || fromFile[k] || "";
const ID = env("LINKEDIN_CLIENT_ID");
const SECRET = env("LINKEDIN_CLIENT_SECRET");

// Which product grants which scope, so a refusal names the fix.
const SCOPES = [
  ["openid", "Sign In with LinkedIn using OpenID Connect"],
  ["profile", "Sign In with LinkedIn using OpenID Connect"],
  ["email", "Sign In with LinkedIn using OpenID Connect"],
  ["w_member_social", "Share on LinkedIn"],
];

let pass = 0;
const fails = [];
const check = (ok, name, fix = "") => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(name);
    console.log(`  ✗ ${name}${fix ? `\n      → ${fix}` : ""}`);
  }
};

async function authorize({ scope = "openid", redirect = linkedinRedirectUris("")[0] } = {}) {
  const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: ID,
    redirect_uri: redirect,
    scope,
    state: "creds-check",
  }).toString();
  const html = await (await fetch(u, { redirect: "manual" })).text();
  if (/client_id is invalid/i.test(html)) return "bad-client";
  if (/redirect_uri does not match/i.test(html)) return "bad-redirect";
  if (/invalid_scope_error|unauthorized_scope_error/i.test(html)) return "bad-scope";
  return "ok";
}

console.log("LinkedIn app");
if (!ID) {
  check(false, "LINKEDIN_CLIENT_ID is set", "add it to .env.local (Auth tab of the app)");
} else {
  const first = await authorize();
  check(first !== "bad-client", `the client id is one LinkedIn knows (${ID})`, "copy it again from the app's Auth tab");

  if (first !== "bad-client") {
    console.log("\nredirect URLs (Auth tab → Authorized redirect URLs)");
    for (const uri of linkedinRedirectUris("http://localhost:3001")) {
      const r = await authorize({ redirect: uri });
      check(r !== "bad-redirect", uri, "add exactly this URL on the app's Auth tab");
    }

    console.log("\npermissions (Products tab)");
    for (const [scope, product] of SCOPES) {
      const r = await authorize({ scope });
      check(r !== "bad-scope", `${scope}`, `add the "${product}" product (or wait for it to finish activating)`);
    }
  }
}

console.log("\nclient secret");
if (!SECRET) {
  check(false, "LINKEDIN_CLIENT_SECRET is set", "add the Primary Client Secret to .env.local — it is never printed here");
} else if (ID) {
  // NOT a fake authorization code: LinkedIn checks the code before the client,
  // so a made-up code answers "authorization code not found" even for a client
  // id that does not exist — measured, and it is how the first version of this
  // check passed a wrong secret. The client_credentials grant authenticates the
  // CLIENT first: a wrong secret is "invalid_client / Client authentication
  // failed"; a right one gets past that and is refused for something else,
  // since a self-serve app may not mint app tokens. If one is ever issued, it
  // is discarded unread.
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: ID,
      client_secret: SECRET,
    }),
  });
  const j = await res.json().catch(() => ({}));
  const why = `${j.error || ""} ${j.error_description || ""}`.trim();
  // invalid_client = wrong secret; invalid_client_id = an id LinkedIn does not
  // know, so the secret was never even compared. Neither is a pass.
  const badClient = /^invalid_client/.test(j.error || "") || /client authentication failed/i.test(why);
  check(
    !badClient && (res.ok || !!j.error),
    "the secret matches the client id",
    `LinkedIn said: ${why || `HTTP ${res.status}`}. Copy the Primary Client Secret again (or generate a new one).`
  );
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
