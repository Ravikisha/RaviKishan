// What is actually in the bucket.
//
// The admin writes to storage from four places — résumé uploads, the vault
// importer, blog images, nightly backups — and nothing until now could answer
// "what is in there, and what is no longer referenced". This lists it and
// deletes on request.
//
// Admin only, and delete is confined to the three prefixes the app owns, so a
// crafted key cannot reach anything else in the bucket.
import { presign, isVaultConfigured, b2Config } from "../../../lib/server/b2";
import { verifyAdmin, AuthError } from "../../../lib/server/verifyAdmin";
// Listing lives in lib/server/objects so the MCP tools answer "what is in
// the bucket" with the same code this route does.
import { PREFIXES, inOwnedPrefix, listPrefix } from "../../../lib/server/objects";

export { PREFIXES };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
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
  if (!isVaultConfigured()) return res.status(503).json({ error: "Storage is not configured." });

  const { action, key } = req.body || {};

  // Short-lived signed links so the panel can open ANY stored file, not just
  // the blog media that has a public route. Batched because a listing wants a
  // thumbnail for every image at once, and fifty round trips is not a design.
  if (action === "urls") {
    const keys = Array.isArray(req.body?.keys) ? req.body.keys.slice(0, 60) : [];
    const out = {};
    for (const k of keys) {
      if (!inOwnedPrefix(k)) continue;
      out[k] = presign({ method: "GET", key: k, expiresIn: 600 });
    }
    return res.status(200).json({ urls: out, expiresInSeconds: 600 });
  }

  if (action === "delete") {
    if (!inOwnedPrefix(key))
      return res.status(400).json({ error: "That key is outside the prefixes this app manages." });
    try {
      const r = await fetch(presign({ method: "DELETE", key, expiresIn: 120 }), { method: "DELETE" });
      // S3 delete is idempotent: a missing object still reports success.
      if (!r.ok && r.status !== 404)
        return res.status(502).json({ error: `Storage refused the delete (HTTP ${r.status}).` });
      return res.status(200).json({ deleted: key });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  try {
    const groups = {};
    let total = 0;
    let bytes = 0;
    for (const p of PREFIXES) {
      const objects = await listPrefix(p);
      objects.sort((a, b) => String(b.lastModified).localeCompare(String(a.lastModified)));
      groups[p] = objects;
      total += objects.length;
      bytes += objects.reduce((n, o) => n + o.size, 0);
    }
    return res.status(200).json({ bucket: b2Config().bucket, total, bytes, groups });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
