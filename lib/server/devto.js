// SERVER ONLY. dev.to (Forem) API client.
//
// Two directions:
//   import    — pull the 27 articles already on dev.to into Firestore so they
//               read on this site instead of only linking out
//   cross-post — push a post written here up to dev.to
//
// CANONICAL URLs matter here and are easy to get wrong. Publishing the same
// article in two places without telling search engines which is the original
// splits the ranking between them. The rule this follows:
//   - imported from dev.to  → dev.to is the original, our page points at it
//   - written here, pushed  → we are the original, the dev.to article carries
//                             canonical_url back to us
// So whichever copy came second defers to the first, in both directions.
const API = "https://dev.to/api";

export const isDevtoConfigured = () => !!process.env.DEVTO_API_KEY;

function headers() {
  const key = process.env.DEVTO_API_KEY;
  if (!key) {
    const e = new Error("dev.to is not configured (missing DEVTO_API_KEY).");
    e.code = "devto/not-configured";
    throw e;
  }
  return {
    "api-key": key,
    "Content-Type": "application/json",
    Accept: "application/vnd.forem.api-v1+json",
    "User-Agent": "ravikishan-portfolio",
  };
}

async function call(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    /* dev.to occasionally answers HTML on an error */
  }
  if (!res.ok) {
    const detail = json?.error || json?.errors || text.slice(0, 200);
    const e = new Error(`dev.to ${res.status}: ${detail}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

export const whoami = () => call("/users/me");

// Every article on the account, published and draft, with markdown bodies.
export async function listMine() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await call(`/articles/me/all?per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

// dev.to article → the shape stored in Firestore `posts/{slug}`.
export function toPost(a) {
  const words = String(a.body_markdown || "").split(/\s+/).filter(Boolean).length;
  return {
    slug: slugify(a.slug || a.title),
    title: a.title || "Untitled",
    body: a.body_markdown || "",
    excerpt: (a.description || "").slice(0, 200),
    cover: a.cover_image || a.social_image || "",
    tags: a.tag_list || [],
    readingTime: a.reading_time_minutes || Math.max(1, Math.round(words / 200)),
    published: !!a.published,
    publishedAt: a.published_at || a.created_at || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // Provenance. `source` drives the canonical tag on the reading page.
    source: "devto",
    devtoId: a.id,
    devtoUrl: a.url || "",
    canonicalUrl: a.canonical_url || a.url || "",
  };
}

// Push a locally-authored post to dev.to. Creates on first run, updates after.
export async function crossPost(post, siteUrl) {
  const ours = `${siteUrl}/blog/${post.slug}`;
  const article = {
    title: post.title,
    body_markdown: post.body,
    published: !!post.published,
    // We are the original, so the dev.to copy defers to this URL.
    canonical_url: ours,
    description: (post.excerpt || "").slice(0, 200),
    tags: (post.tags || [])
      // dev.to: max 4 tags, alphanumeric only.
      .map((t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, ""))
      .filter(Boolean)
      .slice(0, 4),
    ...(post.cover ? { main_image: post.cover } : {}),
  };

  if (post.devtoId) {
    const updated = await call(`/articles/${post.devtoId}`, {
      method: "PUT",
      body: JSON.stringify({ article }),
    });
    return { id: updated.id, url: updated.url, action: "updated" };
  }
  const created = await call("/articles", {
    method: "POST",
    body: JSON.stringify({ article }),
  });
  return { id: created.id, url: created.url, action: "created" };
}
