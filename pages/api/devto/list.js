// Returns every dev.to article as a ready-to-store post. Admin only — the
// API key is server-side, and `body_markdown` is only returned for your own
// articles, so this must not be public.
//
// It does NOT write to Firestore: the browser does that as you, so the
// security rules stay the boundary (same reason the vault importer works the
// way it does).
import { verifyAdmin, AuthError } from "../../../lib/server/verifyAdmin";
import { listMine, toPost, isDevtoConfigured } from "../../../lib/server/devto";

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
  if (!isDevtoConfigured())
    return res.status(503).json({ error: "dev.to is not configured (DEVTO_API_KEY)." });

  try {
    const articles = await listMine();
    const posts = articles.map(toPost);
    // A dev.to slug collision would silently overwrite a post, so surface it.
    const seen = new Set();
    const duplicates = [];
    for (const p of posts) {
      if (seen.has(p.slug)) duplicates.push(p.slug);
      seen.add(p.slug);
    }
    return res.status(200).json({ count: posts.length, duplicates, posts });
  } catch (e) {
    return res.status(e.status === 401 ? 401 : 502).json({ error: e.message });
  }
}

// 27 articles with full markdown bodies is comfortably over the default limit.
export const config = { api: { responseLimit: "8mb" } };
