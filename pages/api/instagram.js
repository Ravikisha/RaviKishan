// Instagram feed — posts + reels for @ravikishan.404, fetched server-side so the
// long-lived access token never reaches the browser.
//
// Handles BOTH token types:
//   • Instagram-login token  (starts "IGAA…") → graph.instagram.com, reads /me
//     media directly. Simplest — no Facebook Page required. Scope:
//     instagram_business_basic.
//   • Facebook-login token   (starts "EAA…")  → graph.facebook.com. Requires a
//     Facebook Page with the IG Business/Creator account linked, and scopes
//     instagram_basic + pages_show_list. The IG business id is resolved from
//     /me/accounts (or set IG_USER_ID to skip the lookup).
//
// Env:
//   IG_ACCESS_TOKEN   required
//   IG_USER_ID        optional — IG user/business id; skips resolution
//
// No token → { configured: false }; any failure → { configured: true, error }.

const IG_USERNAME = "ravikishan.404";
const FIELDS =
  "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,children{media_url,media_type,thumbnail_url}";
const MAX = 120;

const cleanToken = (t) => (t || "").trim().replace(/^["']|["']$/g, "");

function normalize(m) {
  const isVideo = m.media_type === "VIDEO";
  const isReel = m.media_product_type === "REELS" || m.media_type === "VIDEO";
  const isAlbum = m.media_type === "CAROUSEL_ALBUM";
  let image = m.media_url || null;
  if (isVideo) image = m.thumbnail_url || m.media_url || null;
  if (isAlbum && m.children && m.children.data && m.children.data[0]) {
    const c = m.children.data[0];
    image = c.thumbnail_url || c.media_url || image;
  }
  return {
    id: m.id,
    type: isReel ? "reel" : isAlbum ? "album" : "post",
    isVideo,
    image,
    video: isVideo ? m.media_url || null : null,
    caption: m.caption || "",
    permalink: m.permalink || `https://instagram.com/${IG_USERNAME}`,
    timestamp: m.timestamp || null,
    likes: typeof m.like_count === "number" ? m.like_count : null,
    comments: typeof m.comments_count === "number" ? m.comments_count : null,
    childCount: isAlbum && m.children && m.children.data ? m.children.data.length : 0,
  };
}

// resolve the /media endpoint base for whichever token type we were given
async function resolveBase(token) {
  const isFb = token.startsWith("EAA");
  const explicitId = (process.env.IG_USER_ID || "").trim();

  if (!isFb) {
    // Instagram-login token
    return { base: `https://graph.instagram.com/v21.0/${explicitId || "me"}/media` };
  }

  // Facebook-login token — need the IG business account id behind a Page
  if (explicitId) return { base: `https://graph.facebook.com/v21.0/${explicitId}/media` };

  const r = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=instagram_business_account&access_token=${token}`
  );
  const j = await r.json();
  if (j.error) return { error: j.error.message };
  const page = (j.data || []).find((p) => p.instagram_business_account);
  if (!page) {
    return {
      error:
        "This Facebook token has no Page with a linked Instagram account. Link @" +
        IG_USERNAME +
        " (Business/Creator) to a Facebook Page and grant the instagram_basic scope — or use an Instagram-login token (IGAA…) instead.",
    };
  }
  return { base: `https://graph.facebook.com/v21.0/${page.instagram_business_account.id}/media` };
}

export default async function handler(req, res) {
  const token = cleanToken(process.env.IG_ACCESS_TOKEN);

  if (!token) {
    res.setHeader("Cache-Control", "public, s-maxage=60");
    return res.status(200).json({ configured: false, username: IG_USERNAME, media: [] });
  }

  const fail = (error) => {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ configured: true, username: IG_USERNAME, error, media: [] });
  };

  try {
    const { base, error } = await resolveBase(token);
    if (error) return fail(error);

    const out = [];
    let url = `${base}?fields=${encodeURIComponent(FIELDS)}&limit=50&access_token=${token}`;
    while (url && out.length < MAX) {
      const r = await fetch(url);
      const json = await r.json();
      if (json.error) return fail(json.error.message || "Instagram rejected the request.");
      (json.data || []).forEach((m) => out.push(normalize(m)));
      url = json.paging && json.paging.next ? json.paging.next : null;
    }

    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
    return res.status(200).json({
      configured: true,
      username: IG_USERNAME,
      count: out.length,
      posts: out.filter((m) => m.type !== "reel").length,
      reels: out.filter((m) => m.type === "reel").length,
      media: out,
    });
  } catch (e) {
    return fail("Could not reach Instagram. Try again shortly.");
  }
}
