// Mints short-lived presigned URLs for the private Backblaze vault bucket.
//
// The browser never sees the B2 key, and the bucket has no public access, so
// this route is the only door. It is therefore gated twice: a verified Firebase
// ID token, and the admin allow-list.
//
// Bytes never pass through Vercel — the browser PUTs straight to Backblaze with
// the URL this returns. That keeps uploads off the serverless body-size limit.
import { presign, assertVaultKey, b2Config } from "../../../lib/server/b2";
import { verifyAdmin, AuthError } from "../../../lib/server/verifyAdmin";

const OPS = {
  put: { method: "PUT", ttl: 300 },
  get: { method: "GET", ttl: 300 },
  delete: { method: "DELETE", ttl: 120 },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    await verifyAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: "Auth check failed." });
  }

  const { op, key } = req.body || {};
  const spec = OPS[op];
  if (!spec) return res.status(400).json({ error: "op must be put, get or delete." });

  try {
    b2Config();
    assertVaultKey(key);
  } catch (e) {
    const status = e.code === "vault/not-configured" ? 503 : 400;
    return res.status(status).json({ error: e.message });
  }

  const url = presign({ method: spec.method, key, expiresIn: spec.ttl });
  // A presigned URL is a bearer credential — keep it out of every cache.
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ url, expiresIn: spec.ttl });
}
