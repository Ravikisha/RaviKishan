// SERVER ONLY. Verifies a Firebase ID token on the API side.
//
// Deliberately does NOT use firebase-admin: that needs a service-account
// private key in the deployment, which is a much worse secret to hold than a
// bucket-scoped storage key. Instead it does what firebase-admin does
// internally — fetch Google's public signing certificates and verify the
// RS256 signature and claims. `jsonwebtoken` is already a dependency.
//
// Without this, /api/vault/sign would be an open upload endpoint on the
// production domain: anyone could mint a presigned PUT into the private bucket.
import jwt from "jsonwebtoken";
import { isAdminEmail } from "../adminAllowlist";

const PROJECT_ID = "myportifilio-3ab5f";
const CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

// Google rotates these roughly daily and the response carries a max-age; an
// hour of caching keeps a warm lambda from refetching on every request.
let cache = { fetchedAt: 0, certs: null };

async function getCerts() {
  if (cache.certs && Date.now() - cache.fetchedAt < 3600_000) return cache.certs;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`Could not fetch Google signing certs (${res.status})`);
  const certs = await res.json();
  cache = { fetchedAt: Date.now(), certs };
  return certs;
}

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Resolves to the verified token payload, or throws AuthError.
export async function verifyAdmin(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new AuthError(401, "Missing bearer token.");

  const decoded = jwt.decode(token, { complete: true });
  const kid = decoded?.header?.kid;
  if (!kid) throw new AuthError(401, "Malformed token.");

  const certs = await getCerts();
  const cert = certs[kid];
  if (!cert) throw new AuthError(401, "Unknown token signing key.");

  let payload;
  try {
    payload = jwt.verify(token, cert, {
      algorithms: ["RS256"],
      audience: PROJECT_ID,
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    });
  } catch (e) {
    throw new AuthError(401, `Token rejected: ${e.message}`);
  }

  // Same two gates the Firestore rules apply, enforced again here because this
  // route hands out storage credentials rather than reading a document.
  if (payload.email_verified !== true)
    throw new AuthError(403, "Email is not verified.");
  if (!isAdminEmail(payload.email))
    throw new AuthError(403, "Not an authorized admin account.");

  return payload;
}
