// SERVER ONLY. Mints and verifies the personal access tokens that AI clients
// paste into their MCP config.
//
// A token is self-contained: it carries your Firebase REFRESH token, encrypted
// with MCP_TOKEN_SECRET (AES-256-GCM). The server decrypts it, exchanges it for
// a short-lived ID token, and talks to Firestore over REST *as you*.
//
// Why this rather than a service-account key in the deployment:
//   - Firestore security rules stay in force. A service account bypasses them
//     entirely, which would make this file the only thing standing between an
//     MCP bug and the whole database.
//   - Nothing long-lived is stored server-side. There is no token table to
//     leak; the credential lives only in the client config you pasted it into.
//   - Revocation has two independent levers: rotate MCP_TOKEN_SECRET (kills
//     every token at once), or revoke a single `jti` (see the revocation list).
//
// The tradeoff, stated plainly: this token is powerful. Anyone holding it can
// act as the admin until it is revoked. It is shown once, at mint time.
import crypto from "crypto";

const VERSION = "rk1";
export const TOKEN_PREFIX = "rkmcp_";

export const SCOPES = {
  read: "Read site content, résumé metadata, jobs, posts, links, contacts and vault listings",
  write: "Create and update content, jobs, posts and links",
  vault: "Read vault document metadata and mint download links",
};

export const ALL_SCOPES = Object.keys(SCOPES);

function key() {
  const raw = process.env.MCP_TOKEN_SECRET;
  if (!raw) {
    const e = new Error(
      "MCP is not configured on this deployment (missing MCP_TOKEN_SECRET)."
    );
    e.code = "mcp/not-configured";
    throw e;
  }
  // Accept base64url or raw; normalise to exactly 32 bytes.
  const buf = Buffer.from(raw, "base64url");
  return buf.length === 32 ? buf : crypto.createHash("sha256").update(raw).digest();
}

export const isMcpConfigured = () => !!process.env.MCP_TOKEN_SECRET;

export function mintToken({ refreshToken, scopes, label }) {
  if (!refreshToken) throw new Error("A Firebase refresh token is required.");
  const clean = (scopes || []).filter((s) => ALL_SCOPES.includes(s));
  if (!clean.length) throw new Error("At least one scope is required.");

  const payload = JSON.stringify({
    v: VERSION,
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
    scopes: clean,
    label: String(label || "").slice(0, 60),
    rt: refreshToken,
  });

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const body = Buffer.concat([iv, tag, enc]).toString("base64url");

  const parsed = JSON.parse(payload);
  return { token: TOKEN_PREFIX + body, jti: parsed.jti, iat: parsed.iat, scopes: clean };
}

export function verifyToken(token) {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) {
    const e = new Error("Not an MCP token.");
    e.code = "mcp/bad-token";
    throw e;
  }
  let claims;
  try {
    const buf = Buffer.from(token.slice(TOKEN_PREFIX.length), "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    claims = JSON.parse(out);
  } catch (e) {
    if (e?.code === "mcp/not-configured") throw e;
    // A wrong secret, a tampered token and random bytes all land here — GCM
    // authentication failure is indistinguishable, which is what we want.
    const err = new Error("Token is invalid or was issued under a rotated secret.");
    err.code = "mcp/bad-token";
    throw err;
  }
  if (claims.v !== VERSION) {
    const e = new Error("Token version is no longer supported.");
    e.code = "mcp/bad-token";
    throw e;
  }
  return claims;
}

export const hasScope = (claims, scope) =>
  Array.isArray(claims?.scopes) && claims.scopes.includes(scope);
