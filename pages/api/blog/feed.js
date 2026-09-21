// The feed is a mirror of the site's own library and nothing else. It used
// to fall back to a hardcoded dev.to snapshot whenever Firestore hiccuped,
// which published <link>s of the form ravikishan.me/blog/<dev.to slug> —
// URLs this site has never served. An empty channel is still valid RSS and
// a reader keeps the items it already has; dead links it would keep.

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://ravikishan.me";
const PROJECT = "myportifilio-3ab5f";
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyDuDWdIMLs5CCRbPqMvwfxpbobsR4SO3w0";

const value = (field) => {
  if (!field) return "";
  return field.stringValue || field.timestampValue || String(field.integerValue || field.doubleValue || "");
};

const escapeXml = (input) =>
  String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

async function publishedPosts() {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "posts" }],
          where: { fieldFilter: { field: { fieldPath: "published" }, op: "EQUAL", value: { booleanValue: true } } },
          orderBy: [{ field: { fieldPath: "publishedAt" }, direction: "DESCENDING" }],
          limit: 100,
        },
      }),
    }
  );
  if (!response.ok) throw new Error(`Firestore feed request failed (${response.status}).`);
  const rows = await response.json();
  return rows
    .filter((row) => row.document)
    .map((row) => {
      const fields = row.document.fields || {};
      const slug = value(fields.slug) || row.document.name.split("/").pop();
      return {
        title: value(fields.title),
        slug,
        description: value(fields.excerpt),
        publishedAt: value(fields.publishedAt) || value(fields.updatedAt),
      };
    });
}

export default async function handler(req, res) {
  let posts = [];
  let degraded = false;
  try {
    posts = await publishedPosts();
  } catch (_) {
    degraded = true;
  }

  const items = posts
    .filter((post) => post.title && post.slug)
    .map(
      (post) => `<item>
        <title>${escapeXml(post.title)}</title>
        <link>${escapeXml(`${SITE}/blog/${post.slug}`)}</link>
        <guid isPermaLink="true">${escapeXml(`${SITE}/blog/${post.slug}`)}</guid>
        <description>${escapeXml(post.description)}</description>
        ${post.publishedAt ? `<pubDate>${escapeXml(new Date(post.publishedAt).toUTCString())}</pubDate>` : ""}
      </item>`
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Ravi Kishan — Writing</title>
    <link>${SITE}/blog</link>
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
