// The feed is a mirror of the site's own library and nothing else. It used
// to fall back to a hardcoded dev.to snapshot whenever Firestore hiccuped,
// which published <link>s of the form ravikishan.me/blog/<dev.to slug> —
// URLs this site has never served. An empty channel is still valid RSS and
// a reader keeps the items it already has; dead links it would keep.

import { fetchPublishedPostsServer } from "../../../lib/server/publicPosts";
import { withEnv } from "../../../lib/server/envStore";

const site = () => process.env.NEXT_PUBLIC_SITE_URL || "https://ravikishan.me";

const escapeXml = (input) =>
  String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

async function handler(req, res) {
  let posts = [];
  let degraded = false;
  try {
    posts = await fetchPublishedPostsServer();
  } catch (_) {
    degraded = true;
  }

  const items = posts
    .filter((post) => post.title && post.slug)
    .map(
      (post) => `<item>
        <title>${escapeXml(post.title)}</title>
        <link>${escapeXml(`${site()}/blog/${post.slug}`)}</link>
        <guid isPermaLink="true">${escapeXml(`${site()}/blog/${post.slug}`)}</guid>
        <description>${escapeXml(post.excerpt)}</description>
        ${post.publishedAt ? `<pubDate>${escapeXml(new Date(post.publishedAt).toUTCString())}</pubDate>` : ""}
      </item>`
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Ravi Kishan — Writing</title>
    <link>${site()}/blog</link>
    <description>Essays on distributed systems, systems programming and applied AI.</description>
    <language>en</language>
    ${items}
  </channel>
</rss>`;

  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
  // Don't let a momentarily empty feed sit in the edge cache for 15 minutes.
  res.setHeader(
    "Cache-Control",
    degraded
      ? "public, s-maxage=30, stale-while-revalidate=300"
      : "public, s-maxage=900, stale-while-revalidate=3600"
  );
  res.status(200).send(xml);
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
