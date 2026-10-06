// SERVER ONLY. Instagram, through the Instagram Graph API with Instagram
// Login — no linked Facebook Page required.
//
// WHAT INSTAGRAM ALLOWS, checked against its own docs:
//
//   ACCOUNT TYPE    Professional (Business or Creator) ONLY. The Basic Display
//                   API that served personal accounts was shut down on
//                   4 December 2024, so a personal account cannot be connected
//                   at all — there is no API behind it any more.
//   PUBLISH         yes: image, video, reel, story, and carousels of up to 10.
//                   100 posts per rolling 24 hours.
//   READ            yes: your media, their comments, and insights.
//   EDIT A CAPTION  NO. There is no endpoint to change a published media
//                   object. The caption you publish is the caption forever.
//   DELETE A POST   not offered here — deleting is done in the app.
//   COMMENTS        yes: reply, hide and delete.
//
// Publishing is TWO steps and that is not an implementation detail: you create
// a container, then publish the container. Instagram also needs to FETCH the
// image from a public URL — it does not accept an upload — which is why media
// has to be in object storage with a reachable URL before any of this starts.
const API = "https://graph.instagram.com/v21.0";

export class InstagramError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "InstagramError";
    this.status = status;
    this.code = code;
  }
}

export const CAPABILITIES = {
  publish: { available: true, how: "Content Publishing API, 100 posts per 24 hours" },
  readMedia: { available: true, how: "GET /me/media" },
  readComments: { available: true, how: "GET /{media}/comments" },
  replyToComments: { available: true, how: "POST /{comment}/replies" },
  editCaption: {
    available: false,
    why: "Instagram has no endpoint to change a published media object.",
    instead: "Delete and repost in the app, or get the caption right before publishing — dryRun shows it first.",
  },
  personalAccounts: {
    available: false,
    why: "The Basic Display API that served personal accounts shut down on 4 December 2024.",
    instead: "Switch the account to Professional (Business or Creator) in the Instagram app; it is free.",
  },
};

async function call(token, path, { method = "GET", params = {} } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  url.searchParams.set("access_token", token);

  const res = await fetch(url.toString(), { method });
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const e = json?.error || {};
    // Instagram reports a spent publishing allowance as a plain 400.
    if (e.code === 4 || /limit/i.test(e.message || "")) {
      throw new InstagramError(
        `Instagram's publishing limit is spent (100 posts per rolling 24 hours). ${e.message || ""}`.trim(),
        { status: res.status, code: e.code }
      );
    }
    if (e.code === 190) {
      throw new InstagramError(
        "Instagram rejected the connection. Its long-lived token lasts 60 days — reconnect the account in the admin's Social tab.",
        { status: 401, code: 190 }
      );
    }
    throw new InstagramError(`Instagram: ${e.message || `HTTP ${res.status}`}`, {
      status: res.status,
      code: e.code,
    });
  }
  return json;
}

/* ---------------- account ---------------- */

export async function getAccount(token) {
  const u = await call(token, "/me", {
    params: {
      fields: "id,username,name,account_type,profile_picture_url,followers_count,media_count,biography,website",
    },
  });
  return {
    id: u.id,
    username: u.username || "",
    name: u.name || "",
    accountType: u.account_type || "",
    picture: u.profile_picture_url || "",
    followers: u.followers_count ?? null,
    mediaCount: u.media_count ?? null,
    biography: u.biography || "",
    website: u.website || "",
    url: u.username ? `https://www.instagram.com/${u.username}/` : "",
  };
}

// How much of the 24-hour allowance is left. Worth checking before a bulk run,
// because the failure arrives as a flat refusal with nothing published.
export async function publishingLimit(token) {
  const d = await call(token, "/me/content_publishing_limit", {
    params: { fields: "config,quota_usage" },
  });
  const row = d.data?.[0] || {};
  return {
    used: row.quota_usage ?? null,
    limit: row.config?.quota_total ?? 100,
    remaining:
      row.quota_usage != null ? Math.max(0, (row.config?.quota_total ?? 100) - row.quota_usage) : null,
  };
}

/* ---------------- media ---------------- */

const shapeMedia = (m) => ({
  id: m.id,
  type: m.media_type || "",
  caption: m.caption || "",
  url: m.permalink || "",
  thumbnail: m.thumbnail_url || m.media_url || "",
  timestamp: m.timestamp || "",
  likes: m.like_count ?? null,
  comments: m.comments_count ?? null,
});

export async function listMedia(token, { max = 25 } = {}) {
  const d = await call(token, "/me/media", {
    params: {
      fields:
        "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
      limit: Math.min(50, Math.max(1, max)),
    },
  });
  return (d.data || []).map(shapeMedia);
}

export async function getMedia(token, mediaId) {
  const m = await call(token, `/${encodeURIComponent(mediaId)}`, {
    params: {
      fields:
        "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
    },
  });
  return shapeMedia(m);
}

export const MAX_CAPTION = 2200;

export function assertCaption(caption) {
  const c = String(caption || "");
  if (c.length > MAX_CAPTION) {
    throw new InstagramError(
      `An Instagram caption is capped at ${MAX_CAPTION} characters; that one is ${c.length}.`
    );
  }
  // There is no edit endpoint, so a caption cannot be fixed after the fact.
  // Hashtags past 30 are silently dropped by Instagram rather than rejected.
  const tags = (c.match(/#[\wÀ-ɏ]+/g) || []).length;
  if (tags > 30) {
    throw new InstagramError(
      `Instagram allows 30 hashtags; that caption has ${tags}. It would publish with the extras silently dropped, and a caption cannot be edited afterwards.`
    );
  }
  return c;
}

// Step one of two. Instagram FETCHES the file from this URL, so it must be
// publicly reachable — a signed URL that expires, or anything behind auth,
// fails here with a message about the media rather than the URL.
export async function createContainer(token, { imageUrl, videoUrl, caption, isReel, isStory }) {
  if (!imageUrl && !videoUrl) {
    throw new InstagramError("A post needs an imageUrl or a videoUrl that Instagram can fetch.");
  }
  const params = { caption: assertCaption(caption) };
  if (videoUrl) {
    params.video_url = videoUrl;
    params.media_type = isStory ? "STORIES" : isReel ? "REELS" : "VIDEO";
  } else {
    params.image_url = imageUrl;
    if (isStory) params.media_type = "STORIES";
  }
  const out = await call(token, "/me/media", { method: "POST", params });
  if (!out.id) throw new InstagramError("Instagram did not return a media container id.");
  return { containerId: out.id };
}

// A video container is not ready the instant it is created; publishing too
// early fails with a container-not-ready error that reads like a bad id.
export async function containerStatus(token, containerId) {
  const d = await call(token, `/${encodeURIComponent(containerId)}`, {
    params: { fields: "status_code,status" },
  });
  return { code: d.status_code || "", detail: d.status || "" };
}

export async function publishContainer(token, containerId) {
  const out = await call(token, "/me/media_publish", {
    method: "POST",
    params: { creation_id: containerId },
  });
  if (!out.id) throw new InstagramError("Instagram did not return a published media id.");
  return { id: out.id };
}

/* ---------------- comments ---------------- */

export async function listComments(token, mediaId, { max = 25 } = {}) {
  const d = await call(token, `/${encodeURIComponent(mediaId)}/comments`, {
    params: { fields: "id,text,username,timestamp,like_count", limit: Math.min(50, max) },
  });
  return (d.data || []).map((c) => ({
    id: c.id,
    text: c.text || "",
    username: c.username || "",
    timestamp: c.timestamp || "",
    likes: c.like_count ?? null,
  }));
}

export async function replyToComment(token, commentId, message) {
  if (!String(message || "").trim()) throw new InstagramError("A reply needs some text.");
  const out = await call(token, `/${encodeURIComponent(commentId)}/replies`, {
    method: "POST",
    params: { message },
  });
  return { id: out.id };
}

export async function hideComment(token, commentId, hide = true) {
  await call(token, `/${encodeURIComponent(commentId)}`, {
    method: "POST",
    params: { hide: hide ? "true" : "false" },
  });
  return { id: commentId, hidden: !!hide };
}
