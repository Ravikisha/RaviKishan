// SERVER ONLY. OAuth 2.1 pieces for MCP clients that will not accept a pasted
// bearer token (ChatGPT connectors, and anything else following the MCP
// authorization spec end to end).
//
// Everything here is STATELESS by construction — client registrations and
// authorization codes are encrypted blobs rather than database rows. That is
// not cleverness for its own sake: the API routes have no Firestore
// credentials of their own (by design — see lib/server/mcpToken.js), so there
// is nowhere for them to write. Encrypting the state into the value itself
// keeps the no-service-account property intact.
//
// The one thing statelessness cannot give us is single-use codes. That is
// handled at redemption time instead: the code carries the user's refresh
// token, so the token endpoint can authenticate AS the user and claim the code
// in Firestore before issuing anything. Second redemption finds it claimed.
import crypto from "crypto";

const CLIENT_V = "rkc1";
const CODE_V = "rkg1";

export const CLIENT_PREFIX = "rkclient_";
export const CODE_PREFIX = "rkcode_";
export const ACCESS_TOKEN_TTL = 3600;
export const CODE_TTL = 120; // seconds — long enough for a redirect, no longer

function key() {
  const raw = process.env.MCP_TOKEN_SECRET;
  if (!raw) {
    const e = new Error("OAuth is not configured (missing MCP_TOKEN_SECRET).");
    e.code = "oauth/not-configured";
    throw e;
  }
  const buf = Buffer.from(raw, "base64url");
  return buf.length === 32 ? buf : crypto.createHash("sha256").update(raw).digest();
}

function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}

function open(blob) {
  const buf = Buffer.from(blob, "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
}

/* ---------- dynamic client registration (RFC 7591) ---------- */

// The client_id IS the registration. Nothing to store, nothing to look up, and
// a client_id cannot be forged into one with different redirect URIs.
export function registerClient({ redirect_uris, client_name, scope }) {
  if (!Array.isArray(redirect_uris) || !redirect_uris.length)
    throw Object.assign(new Error("redirect_uris is required."), { code: "invalid_client_metadata" });

  for (const u of redirect_uris) {
    let parsed;
    try {
      parsed = new URL(u);
    } catch (_) {
      throw Object.assign(new Error(`Not a valid redirect_uri: ${u}`), { code: "invalid_redirect_uri" });
    }
    // Loopback is allowed over http for native clients; everything else must
    // be https, so an authorization code is never sent in the clear.
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback))
      throw Object.assign(new Error(`redirect_uri must be https (or loopback): ${u}`), {
        code: "invalid_redirect_uri",
      });
    if (parsed.hash)
      throw Object.assign(new Error("redirect_uri must not contain a fragment."), {
        code: "invalid_redirect_uri",
      });
  }

  return {
    client_id:
      CLIENT_PREFIX +
      seal({
        v: CLIENT_V,
        n: String(client_name || "").slice(0, 80),
        r: redirect_uris.slice(0, 5),
        s: String(scope || "read").slice(0, 60),
        iat: Math.floor(Date.now() / 1000),
      }),
    client_name: String(client_name || "").slice(0, 80),
    redirect_uris: redirect_uris.slice(0, 5),
    // Public client: no secret, PKCE is the proof. OAuth 2.1 requires PKCE
    // for every client anyway, so a secret would add ceremony, not security.
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

export function readClient(client_id) {
  if (typeof client_id !== "string" || !client_id.startsWith(CLIENT_PREFIX))
    throw Object.assign(new Error("Unknown client_id."), { code: "invalid_client" });
  let c;
  try {
    c = open(client_id.slice(CLIENT_PREFIX.length));
  } catch (_) {
    throw Object.assign(new Error("Unknown client_id."), { code: "invalid_client" });
  }
  if (c.v !== CLIENT_V) throw Object.assign(new Error("Unknown client_id."), { code: "invalid_client" });
  return { name: c.n, redirectUris: c.r, scope: c.s };
}

/* ---------- authorization codes ---------- */

export function issueCode({ clientId, redirectUri, scopes, codeChallenge, refreshToken }) {
  return (
    CODE_PREFIX +
    seal({
      v: CODE_V,
      jti: crypto.randomUUID(),
      cid: clientId,
      ru: redirectUri,
      sc: scopes,
      cc: codeChallenge,
      rt: refreshToken,
      exp: Math.floor(Date.now() / 1000) + CODE_TTL,
    })
  );
}

export function readCode(code) {
  if (typeof code !== "string" || !code.startsWith(CODE_PREFIX))
    throw Object.assign(new Error("Invalid authorization code."), { code: "invalid_grant" });
  let c;
  try {
    c = open(code.slice(CODE_PREFIX.length));
  } catch (_) {
    throw Object.assign(new Error("Invalid authorization code."), { code: "invalid_grant" });
  }
  if (c.v !== CODE_V || c.exp < Math.floor(Date.now() / 1000))
    throw Object.assign(new Error("Authorization code has expired."), { code: "invalid_grant" });
  return c;
}

// PKCE S256 only. OAuth 2.1 drops `plain`, and accepting it would let anyone
// who intercepts the code redeem it.
export function verifyPkce(codeChallenge, codeVerifier) {
  if (typeof codeVerifier !== "string" || codeVerifier.length < 43 || codeVerifier.length > 128)
    return false;
  const hash = crypto.createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
  // Constant-time compare so a mismatch cannot be probed byte by byte.
  const a = Buffer.from(hash);
  const b = Buffer.from(String(codeChallenge || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
