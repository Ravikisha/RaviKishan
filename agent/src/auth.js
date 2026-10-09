// Who is allowed to drive this server.
//
// Same technique as the site's lib/server/verifyAdmin.js — verify the Firebase
// ID token against Google's published certificates — and deliberately NOT
// firebase-admin, which would need a service-account private key sitting on a
// box that already runs arbitrary code.
//
// It is reimplemented here rather than imported because `agent/` is a separate
// package with its own dependencies and deploy, and reaching across into the
// Next.js app's module graph would mean the daemon could only run from inside
// a checkout of the whole site. The LOGIC is small; the thing that must not
// drift is the allow-list, and that comes from configuration.
import jwt from "jsonwebtoken";

const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

export const projectId = () => process.env.FIREBASE_PROJECT_ID || "myportifilio-3ab5f";

export const allowedEmails = () =>
  (process.env.AGENT_ADMIN_EMAILS || "ravikishan63392@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

let cache = { at: 0, certs: null };

async function certs() {
  if (cache.certs && Date.now() - cache.at < 3600_000) return cache.certs;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new AuthError(`Could not fetch Google signing certificates (${res.status}).`, 503);
  cache = { at: Date.now(), certs: await res.json() };
  return cache.certs;
}

// Resolves to the token's claims, or throws. Every property checked here is
// one that a forged or borrowed token would fail.
export async function verifyToken(token) {
  if (!token) throw new AuthError("No token.");

  const decoded = jwt.decode(token, { complete: true });
  if (!decoded?.header?.kid) throw new AuthError("That token is not a Firebase ID token.");

  const all = await certs();
  const pem = all[decoded.header.kid];
  if (!pem) throw new AuthError("That token was signed by a key Google does not publish.");

  let claims;
  try {
    claims = jwt.verify(token, pem, {
      algorithms: ["RS256"],
      audience: projectId(),
      issuer: `https://securetoken.google.com/${projectId()}`,
    });
  } catch (e) {
    throw new AuthError(`That token did not verify (${e.message}).`);
  }

  const email = String(claims.email || "").toLowerCase();
  if (!claims.email_verified) throw new AuthError("That account's e-mail is not verified.", 403);
  if (!allowedEmails().includes(email)) {
    throw new AuthError(`${email || "that account"} is not allowed to drive this server.`, 403);
  }

  return claims;
}

// A WebSocket authenticates on connect, but a socket opened an hour ago is not
// proof of anything now — so anything that ACTS re-checks. The token's own
// expiry is what makes this meaningful.
export function assertFresh(claims, { maxAgeSec = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  if (!claims?.exp || claims.exp < now) {
    throw new AuthError("That session's token expired. The panel will fetch a new one — try again.");
  }
  if (claims.auth_time && now - claims.auth_time > maxAgeSec * 24) {
    throw new AuthError("That sign-in is too old for this. Sign in again.", 403);
  }
  return true;
}
