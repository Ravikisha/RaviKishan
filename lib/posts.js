// Natively-authored blog posts.
//
// /blog already aggregates dev.to + Medium. This adds posts written in the
// admin and stored in Firestore, merged into that same list, so the blog index
// stays one place rather than splitting into "mine" and "elsewhere".
//
// Visibility: firestore.rules allows a read only when `published == true` (or
// you are the admin), so the public list MUST query on that field — an
// unconstrained list of the collection is rejected outright rather than
// silently returning drafts.
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "./firebase";
// slugify / SLUG_RE / readingMinutes / excerptFrom are defined once, in a
// dependency-free module the MCP tool registry can also import under plain
// node. They are re-exported here because every existing caller imports them
// from "lib/posts".
import { slugify, SLUG_RE, readingMinutes, excerptFrom } from "./server/postText";

export { slugify, SLUG_RE, readingMinutes, excerptFrom };

// Shape a stored post like the entries /blog already renders, preserving
// provenance so imported or cross-posted articles can link back to dev.to.
export const toListItem = (p) => ({
  title: p.title,
  url: `/blog/${p.slug}`,
  internal: true,
  medium: null,
  description: p.excerpt || excerptFrom(p.body),
  cover: p.cover || null,
  publishedAt: p.publishedAt || p.updatedAt || null,
  tags: p.tags || [],
  readingTime: p.readingTime || readingMinutes(p.body),
  reactions: 0,
  comments: 0,
  source: p.source || "ravikishan.me",
  devtoUrl: p.devtoUrl || null,
  canonicalUrl: p.canonicalUrl || null,
});

export async function fetchPublishedPosts() {
  const base = [collection(db, "posts"), where("published", "==", true)];
  try {
    const snap = await getDocs(query(...base, orderBy("publishedAt", "desc")));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (orderedError) {
    // Keep the public blog usable while a newly deployed project is still
    // waiting for its ordered Firestore index to become available.
    try {
      const snap = await getDocs(query(...base));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (fallbackError) {
      const error = new Error("Could not load published posts.");
      error.cause = fallbackError || orderedError;
      throw error;
    }
  }
}
