// Published posts, read on the SERVER with no credentials.
//
// firestore.rules makes a post world-readable once `published == true`, so the
// REST API with the public web API key is enough — there is no service account
// here and there does not need to be. /api/blog/feed has worked this way for a
// while; this is that query, shared, so the article page and the sitemap can
// be rendered server-side too.
//
// Why that matters: /blog/[slug] used to fetch in the browser only, which
// meant the HTML served to a crawler — or to LinkedIn, Slack and WhatsApp,
// none of which run JavaScript — carried the HOMEPAGE's title, description and
// og:url. Every post unfurled as the same page.
const PROJECT = "myportifilio-3ab5f";
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyDuDWdIMLs5CCRbPqMvwfxpbobsR4SO3w0";

const value = (f) => {
  if (!f) return undefined;
  if (f.stringValue !== undefined) return f.stringValue;
  if (f.booleanValue !== undefined) return f.booleanValue;
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (f.doubleValue !== undefined) return Number(f.doubleValue);
  if (f.timestampValue !== undefined) return f.timestampValue;
  if (f.arrayValue !== undefined) return (f.arrayValue.values || []).map(value);
  if (f.mapValue !== undefined) return fromFields(f.mapValue.fields || {});
  if (f.nullValue !== undefined) return null;
  return undefined;
};

const fromFields = (fields) =>
  Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, value(v)]));

// Firestore hands back undefined for an absent field; Next refuses to
// serialise undefined into props, so every post is normalised to JSON-safe
// values here rather than at four call sites.
function normalise(doc, id) {
  return {
    slug: doc.slug || id,
    title: doc.title || "Untitled",
    excerpt: doc.excerpt || "",
    body: doc.body || "",
    cover: doc.cover || "",
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    publishedAt: doc.publishedAt || doc.updatedAt || "",
    updatedAt: doc.updatedAt || doc.publishedAt || "",
    readingTime: Number(doc.readingTime) || 0,
    source: doc.source || "",
    canonicalUrl: doc.canonicalUrl || "",
    devtoUrl: doc.devtoUrl || "",
    published: true,
  };
}

export async function fetchPublishedPostsServer({ limit = 200 } = {}) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Deliberately NO orderBy. Firestore needs a composite index for
        // `published == true` ordered by publishedAt, and without it the whole
        // query answers 400 — which is exactly how /feed.xml came to serve an
        // empty channel while 29 posts sat published. Sorting a few dozen
        // posts in JS costs nothing and needs no index to be deployed first.
        structuredQuery: {
          from: [{ collectionId: "posts" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "published" },
              op: "EQUAL",
              value: { booleanValue: true },
            },
          },
          limit,
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Firestore query failed (${res.status}).`);
  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => normalise(fromFields(r.document.fields), r.document.name.split("/").pop()))
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

export async function fetchPublishedPostServer(slug) {
  if (!slug || !/^[a-z0-9][a-z0-9-]{1,59}$/.test(slug)) return null;
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/posts/${encodeURIComponent(
      slug
    )}?key=${API_KEY}`
  );
  // A draft is not world-readable, so the rules answer 403 — indistinguishable
  // from "no such post" out here, and both mean "nothing to prerender".
  if (!res.ok) return null;
  const doc = await res.json();
  const data = fromFields(doc.fields);
  if (!data.published) return null;
  return normalise(data, slug);
}
