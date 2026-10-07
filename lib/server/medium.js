// Medium, read-only — because that is all Medium still allows.
//
// Medium stopped issuing API integration tokens on 1 January 2025. Existing
// tokens keep working; nobody can obtain a new one. So there is no publishing
// client here and no MEDIUM_TOKEN to configure: posting through api.medium.com
// is simply not available to this account.
//
// What IS available, and is arguably better:
//
//   - the public RSS feed, which says what is already on Medium, and
//   - Medium's own "import a story" tool, which takes a URL, fetches the page,
//     converts it, and sets the canonical URL back to the source. That is the
//     right direction for this site: ravikishan.me stays canonical and Medium
//     carries the copy. The API would have required us to set canonicalUrl by
//     hand and could only ever CREATE a post — it has no update endpoint — so
//     a second push would have silently duplicated the article.
//
// The importer is behind a Cloudflare challenge, so it cannot be driven from a
// server. It opens in the author's own browser, one click per post.
const mediumUser = () => process.env.NEXT_PUBLIC_MEDIUM_USER || "ravikishan63392";

export const mediumProfileUrl = () => `https://medium.com/@${mediumUser()}`;

// Medium's importer. It reads the page at `url`, converts it, and stamps the
// canonical back to it.
export const mediumImportUrl = (canonicalUrl) =>
  `https://medium.com/p/import?url=${encodeURIComponent(canonicalUrl)}`;

/* ---------------- the feed ---------------- */

const unwrapCdata = (s) =>
  String(s || "")
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
    .trim();

const tag = (chunk, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(chunk);
  return m ? unwrapCdata(m[1]) : "";
};

// Exported for the tests: the parsing is the part that silently rots when
// Medium changes its feed, and it needs no network to check.
export function parseMediumFeed(xml) {
  const items = [...String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items
    .map((chunk) => {
      const link = tag(chunk, "link").split("?")[0];
      return {
        title: tag(chunk, "title"),
        url: link,
        // The last path segment carries Medium's own id.
        id: link.split("/").filter(Boolean).pop() || "",
        publishedAt: tag(chunk, "pubDate"),
      };
    })
    .filter((p) => p.title && p.url);
}

export async function fetchMediumPosts() {
  const res = await fetch(`https://medium.com/feed/@${mediumUser()}`, {
    headers: { "User-Agent": "ravikishan.me/1.0 (+https://ravikishan.me)" },
  });
  if (!res.ok) throw new Error(`Medium feed returned ${res.status}.`);
  return parseMediumFeed(await res.text());
}

/* ---------------- matching ---------------- */

// Titles are the only thing the two sides share — Medium's slugs carry a hash
// and bear no relation to ours. Normalising hard (case, punctuation, the
// em dashes Medium likes) is what makes the match reliable.
export const normaliseTitle = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Medium's RSS returns only the most recent ~10 stories. Anything older than
// that is simply absent from the feed, which is NOT the same as "not on
// Medium" — so the state is three-valued and the UI must say so rather than
// inviting a duplicate import.
export function mediumState(sitePosts, mediumPosts) {
  const byTitle = new Map(mediumPosts.map((m) => [normaliseTitle(m.title), m]));
  const oldest = mediumPosts
    .map((m) => Date.parse(m.publishedAt) || 0)
    .filter(Boolean)
    .sort((a, b) => a - b)[0];

  return sitePosts.map((p) => {
    const hit = byTitle.get(normaliseTitle(p.title));
    if (hit) return { slug: p.slug, title: p.title, state: "on-medium", mediumUrl: hit.url };

    const when = Date.parse(p.publishedAt || p.updatedAt || "") || 0;
    // Older than everything the feed still carries: we genuinely cannot tell.
    if (oldest && when && when < oldest)
      return { slug: p.slug, title: p.title, state: "unknown" };

    return { slug: p.slug, title: p.title, state: "not-on-medium" };
  });
}
