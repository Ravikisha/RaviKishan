// Aggregates blog posts from dev.to + Medium, de-duplicates cross-posts
// (same article published on both), and returns one clean unified list.
// Server-side so Medium's RSS (no CORS, XML) can be fetched + parsed.

const DEVTO_USER = "ravikishan";
const MEDIUM_USER = "ravikishan63392";

const decode = (s = "") =>
  s
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "…")
    .trim();

// normalized title → dedupe key
const key = (t = "") => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function fetchDevto() {
  try {
    const r = await fetch(
      `https://dev.to/api/articles?username=${DEVTO_USER}&per_page=100`
    );
    if (!r.ok) return [];
    const data = await r.json();
    return data.map((a) => ({
      title: a.title,
      url: a.url,
      description: a.description || "",
      cover: a.cover_image || a.social_image || null,
      publishedAt: a.published_at,
      tags: a.tag_list || [],
      readingTime: a.reading_time_minutes || null,
      reactions: a.positive_reactions_count || 0,
      comments: a.comments_count || 0,
      source: "dev.to",
    }));
  } catch {
    return [];
  }
}

function parseMedium(xml) {
  const out = [];
  const blocks = xml.split("<item>").slice(1);
  for (const raw of blocks) {
    const item = raw.split("</item>")[0];
    const pick = (tag) => {
      const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? decode(m[1]) : "";
    };
    const title = pick("title");
    if (!title) continue;
    const content = pick("content:encoded") || pick("description");
    const cats = [...item.matchAll(/<category>([\s\S]*?)<\/category>/g)].map((m) =>
      decode(m[1])
    );
    const img = content.match(/<img[^>]+src=["']([^"']+)["']/);
    const excerpt = decode(content.replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 170);
    out.push({
      title,
      url: (pick("link") || "").split("?")[0],
      description: excerpt ? excerpt + "…" : "",
      cover: img ? img[1] : null,
      publishedAt: pick("pubDate"),
      tags: cats.slice(0, 4),
      readingTime: null,
      reactions: 0,
      comments: 0,
      source: "Medium",
    });
  }
  return out;
}

async function fetchMedium() {
  try {
    const r = await fetch(`https://medium.com/feed/@${MEDIUM_USER}`, {
      headers: { "User-Agent": "Mozilla/5.0 (portfolio blog aggregator)" },
    });
    if (!r.ok) return [];
    return parseMedium(await r.text());
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  const [devto, medium] = await Promise.all([fetchDevto(), fetchMedium()]);

  // dev.to first so its richer metadata wins on a cross-post collision.
  // Cross-posts often differ slightly (edited subtitle, truncation), so treat
  // two posts as the same when one normalized title is a prefix of the other
  // and the shared prefix is long enough to be unambiguous.
  const posts = [];
  const matchIdx = (k) =>
    posts.findIndex((e) => {
      const ek = key(e.title);
      if (ek === k) return true;
      const [short, long] = ek.length < k.length ? [ek, k] : [k, ek];
      return short.length >= 25 && long.startsWith(short);
    });
  for (const p of [...devto, ...medium]) {
    const k = key(p.title);
    if (!k) continue;
    const idx = matchIdx(k);
    if (idx >= 0) {
      // cross-post: keep the richer dev.to entry, but remember the Medium link
      if (p.source === "Medium" && !posts[idx].medium) posts[idx].medium = p.url;
      continue;
    }
    posts.push(p.source === "Medium" ? { ...p, medium: p.url } : p);
  }
  posts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  res.setHeader(
    "Cache-Control",
    "public, s-maxage=3600, stale-while-revalidate=86400"
  );
  res.status(200).json({
    count: posts.length,
    sources: { devto: devto.length, medium: medium.length },
    duplicatesRemoved: devto.length + medium.length - posts.length,
    posts,
  });
}
