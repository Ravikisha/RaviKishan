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

// Every prefix the app writes to. Listing is scoped to these, so a stray
// object elsewhere in the bucket is simply invisible rather than deletable.
export const PREFIXES = ["media/", "vault/", "resumes/"];

const inOwnedPrefix = (key) =>
  typeof key === "string" &&
  !key.includes("..") &&
  PREFIXES.some((p) => key.startsWith(p)) &&
  !key.endsWith("/");

// Minimal XML pluck — S3 ListObjectsV2 is a fixed, flat shape, and a parser
// dependency for four tag names is not worth the install.
function parseList(xml) {
  const out = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const chunk = m[1];
    const pick = (tag) => (chunk.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
    const key = pick("Key")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    if (!key || key.endsWith("/")) continue;
    out.push({
      key,
      size: Number(pick("Size") || 0),
      lastModified: pick("LastModified"),
      etag: pick("ETag").replace(/&quot;|"/g, ""),
    });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1] || null;
  return { objects: out, truncated, next };
}

async function listPrefix(prefix) {
  const all = [];
  let token = null;
  // Bounded: 10 pages × 1000 keys is far more than this bucket will ever hold,
  // and an unbounded loop against a paid API is how you get a surprise bill.
  for (let page = 0; page < 10; page++) {
    const query = { "list-type": "2", prefix, "max-keys": "1000" };
    if (token) query["continuation-token"] = token;
    const res = await fetch(presign({ method: "GET", key: "", expiresIn: 120, query }));
    if (!res.ok) throw new Error(`Storage list failed (HTTP ${res.status}) for ${prefix}`);
    const { objects, truncated, next } = parseList(await res.text());
    all.push(...objects);
    if (!truncated || !next) break;
    token = next;
  }
  return all;
}

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
