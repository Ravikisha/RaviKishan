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

export const slugify = (s) =>
  (s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;

// Rough reading time, same convention dev.to uses (~200 wpm).
export const readingMinutes = (body) =>
  Math.max(1, Math.round((String(body || "").split(/\s+/).filter(Boolean).length || 0) / 200));

export const excerptFrom = (body, max = 170) => {
  const text = String(body || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
};

// Shape a native post like the entries /blog already renders, so the page needs
// no special case beyond the internal href.
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
  source: "ravikishan.me",
});

export async function fetchPublishedPosts() {
  try {
    const snap = await getDocs(
      query(
        collection(db, "posts"),
        where("published", "==", true),
        orderBy("publishedAt", "desc")
      )
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (_) {
    // Missing composite index, offline, or rules not yet published — the blog
    // still renders its external sources.
    return [];
  }
}
