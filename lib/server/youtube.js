// SERVER ONLY. YouTube Data API v3.
//
// Of the three social providers this is the one that can genuinely do the
// whole set: read channels and videos, CHANGE a video's title, description,
// tags, privacy and category, manage playlists, and reply to comments.
//
// THE TRAP, and the reason this file exists rather than raw fetch calls:
// `videos.update` REPLACES the part it is given. The docs say it plainly —
// "if your request does not specify a value for a property that already has a
// value, the property's existing value will be deleted". So a naive "change
// the title" call that sends only `snippet.title` silently wipes the
// description, the tags and the category of a published video. Every update
// here is therefore read-modify-write: fetch the current snippet, merge, send
// it back whole. `title` and `categoryId` are also required by the API, so a
// merge is the only shape that works at all.
//
// Quota is the other thing worth knowing: 10,000 units a day by default, where
// a list costs 1, an update costs 50, a search costs 100 and an upload costs
// 1600. Search is avoided here for that reason — six searches is the same
// budget as a whole upload.
const API = "https://www.googleapis.com/youtube/v3";

export class YouTubeError extends Error {
  constructor(message, { status, reason } = {}) {
    super(message);
    this.name = "YouTubeError";
    this.status = status;
    this.reason = reason;
  }
}

async function call(token, path, { method = "GET", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    throw new YouTubeError("YouTube rejected the connection. Reconnect that channel in the admin's Social tab.", {
      status: 401,
    });
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let reason = "";
    try {
      const j = await res.json();
      msg = j?.error?.message || msg;
      reason = j?.error?.errors?.[0]?.reason || "";
    } catch (_) {}
    // The one failure everyone hits eventually, and it reads as a generic 403
    // unless you look at `reason`.
    if (reason === "quotaExceeded") {
      throw new YouTubeError(
        "YouTube's daily quota is spent (10,000 units; an update costs 50 and an upload 1600). It resets at midnight Pacific.",
        { status: 403, reason }
      );
    }
    if (reason === "youtubeSignupRequired") {
      throw new YouTubeError(
        "That Google account has no YouTube channel. Create one, or connect a different account.",
        { status: 401, reason }
      );
    }
    throw new YouTubeError(`YouTube: ${msg}`, { status: res.status, reason });
  }
  return res.status === 204 ? null : res.json();
}

const q = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

/* ---------------- channel ---------------- */

export async function getChannel(token) {
  const d = await call(token, `/channels?${q({ part: "snippet,statistics,contentDetails", mine: "true" })}`);
  const c = d.items?.[0];
  if (!c) {
    throw new YouTubeError("This Google account has no YouTube channel.", { status: 404 });
  }
  return {
    id: c.id,
    title: c.snippet?.title || "",
    description: c.snippet?.description || "",
    customUrl: c.snippet?.customUrl || "",
    thumbnail: c.snippet?.thumbnails?.default?.url || "",
    subscribers: Number(c.statistics?.subscriberCount || 0),
    views: Number(c.statistics?.viewCount || 0),
    videos: Number(c.statistics?.videoCount || 0),
    uploadsPlaylist: c.contentDetails?.relatedPlaylists?.uploads || "",
    url: c.snippet?.customUrl
      ? `https://www.youtube.com/${c.snippet.customUrl}`
      : `https://www.youtube.com/channel/${c.id}`,
  };
}

// Channel configuration: the title, description and keywords a visitor reads
// before they watch anything.
//
// SAME FOOTGUN AS videos.update, and worse: `channels.update` replaces the
// whole part it is given, so sending brandingSettings with only a title wipes
// the description, the keywords and the country. So this is read-modify-write
// too, and it sends back every field it did not mean to change.
//
// `part=brandingSettings` is the only writable home for these: the snippet
// returned by channels.list is NOT writable, which is the usual reason a
// "successful" channel update changes nothing.
export async function updateChannel(token, patch = {}) {
  const current = await call(token, `/channels?${q({ part: "brandingSettings", mine: "true" })}`);
  const item = current.items?.[0];
  if (!item) throw new YouTubeError("This Google account has no YouTube channel.", { status: 404 });

  const channelPart = item.brandingSettings?.channel || {};
  const title = patch.title === undefined ? channelPart.title : String(patch.title);
  const description =
    patch.description === undefined ? channelPart.description : String(patch.description);

  // YouTube takes channel keywords as ONE space-separated string, and a
  // keyword containing a space must be quoted. Handing it an array, or a
  // comma-separated list, silently stores a single nonsense keyword.
  const keywords =
    patch.keywords === undefined
      ? channelPart.keywords
      : (Array.isArray(patch.keywords) ? patch.keywords : String(patch.keywords).split(","))
          .map((k) => String(k).trim())
          .filter(Boolean)
          .map((k) => (k.includes(" ") ? `"${k}"` : k))
          .join(" ");

  if (title !== undefined && title !== null && title.length > 100) {
    throw new YouTubeError(
      `A channel title is at most 100 characters; this is ${title.length}. YouTube rejects the whole update rather than truncating.`
    );
  }
  if (description && description.length > 1000) {
    throw new YouTubeError(
      `A channel description is at most 1000 characters; this is ${description.length}.`
    );
  }

  const body = {
    id: item.id,
    brandingSettings: {
      ...item.brandingSettings,
      channel: {
        ...channelPart,
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
        ...(keywords === undefined ? {} : { keywords }),
      },
    },
  };

  await call(token, `/channels?${q({ part: "brandingSettings" })}`, {
    method: "PUT",
    body,
  });
  return { ...(await getChannel(token)), keywords: body.brandingSettings.channel.keywords || "" };
}

// What the channel currently says about itself, including the fields
// getChannel() does not carry because they live on brandingSettings.
export async function getChannelConfig(token) {
  const d = await call(token, `/channels?${q({ part: "brandingSettings,status", mine: "true" })}`);
  const item = d.items?.[0];
  if (!item) throw new YouTubeError("This Google account has no YouTube channel.", { status: 404 });
  const ch = item.brandingSettings?.channel || {};
  return {
    title: ch.title || "",
    description: ch.description || "",
    // Back to a list for the interface; the quoting is YouTube's storage
    // format, not something anyone should have to type.
    keywords: (ch.keywords || "")
      .match(/"[^"]*"|\S+/g)
      ?.map((k) => k.replace(/^"|"$/g, "")) || [],
    country: ch.country || "",
    madeForKids: item.status?.madeForKids ?? null,
    privacyStatus: item.status?.privacyStatus || "",
  };
}

/* ---------------- videos ---------------- */

const shapeVideo = (v) => ({
  id: v.id?.videoId || v.id,
  title: v.snippet?.title || "",
  description: v.snippet?.description || "",
  tags: v.snippet?.tags || [],
  categoryId: v.snippet?.categoryId || "",
  publishedAt: v.snippet?.publishedAt || "",
  thumbnail: v.snippet?.thumbnails?.medium?.url || "",
  privacy: v.status?.privacyStatus || "",
  views: v.statistics ? Number(v.statistics.viewCount || 0) : undefined,
  likes: v.statistics ? Number(v.statistics.likeCount || 0) : undefined,
  comments: v.statistics ? Number(v.statistics.commentCount || 0) : undefined,
  url: `https://www.youtube.com/watch?v=${v.id?.videoId || v.id}`,
});

// Listed through the uploads PLAYLIST rather than search.list: a playlist page
// costs 1 unit where a search costs 100, and search does not reliably return a
// channel's own unlisted or very recent uploads.
export async function listVideos(token, { max = 25 } = {}) {
  const channel = await getChannel(token);
  if (!channel.uploadsPlaylist) return { channel, videos: [] };

  const page = await call(
    token,
    `/playlistItems?${q({
      part: "contentDetails",
      playlistId: channel.uploadsPlaylist,
      maxResults: Math.min(50, Math.max(1, max)),
    })}`
  );
  const ids = (page.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return { channel, videos: [] };

  const full = await call(
    token,
    `/videos?${q({ part: "snippet,status,statistics", id: ids.join(",") })}`
  );
  return { channel, videos: (full.items || []).map(shapeVideo) };
}

export async function getVideo(token, videoId) {
  const d = await call(token, `/videos?${q({ part: "snippet,status,statistics", id: videoId })}`);
  const v = d.items?.[0];
  if (!v) throw new YouTubeError(`No video ${videoId} on this channel.`, { status: 404 });
  return shapeVideo(v);
}

// READ-MODIFY-WRITE, deliberately. See the note at the top: sending a partial
// snippet deletes every field left out.
export async function updateVideo(token, videoId, patch) {
  const current = await call(token, `/videos?${q({ part: "snippet,status", id: videoId })}`);
  const v = current.items?.[0];
  if (!v) throw new YouTubeError(`No video ${videoId} on this channel.`, { status: 404 });

  const touchesSnippet =
    typeof patch.title === "string" ||
    typeof patch.description === "string" ||
    Array.isArray(patch.tags) ||
    typeof patch.categoryId === "string";
  const touchesStatus = typeof patch.privacy === "string";
  if (!touchesSnippet && !touchesStatus) {
    throw new YouTubeError(
      "Nothing to change — pass a title, description, tags, categoryId or privacy."
    );
  }

  // YouTube caps these and rejects the whole request over them.
  if (typeof patch.title === "string" && patch.title.length > 100) {
    throw new YouTubeError(`A YouTube title is capped at 100 characters; that one is ${patch.title.length}.`);
  }
  if (typeof patch.description === "string" && patch.description.length > 5000) {
    throw new YouTubeError(
      `A YouTube description is capped at 5000 characters; that one is ${patch.description.length}.`
    );
  }

  const parts = [];
  const body = { id: videoId };
  if (touchesSnippet) {
    parts.push("snippet");
    body.snippet = {
      // Merged from what is already there, so an unmentioned field survives.
      title: typeof patch.title === "string" ? patch.title : v.snippet.title,
      description:
        typeof patch.description === "string" ? patch.description : v.snippet.description || "",
      tags: Array.isArray(patch.tags) ? patch.tags : v.snippet.tags || [],
      // Required by the API whenever snippet is sent at all.
      categoryId:
        typeof patch.categoryId === "string" ? patch.categoryId : v.snippet.categoryId || "22",
      ...(v.snippet.defaultLanguage ? { defaultLanguage: v.snippet.defaultLanguage } : {}),
    };
  }
  if (touchesStatus) {
    const allowed = ["public", "unlisted", "private"];
    if (!allowed.includes(patch.privacy)) {
      throw new YouTubeError(`privacy must be one of ${allowed.join(", ")}.`);
    }
    parts.push("status");
    body.status = { ...v.status, privacyStatus: patch.privacy };
  }

  const out = await call(token, `/videos?${q({ part: parts.join(",") })}`, {
    method: "PUT",
    body,
  });
  return {
    ...shapeVideo(out),
    changed: Object.keys(patch),
    // Said out loud, because it is the thing that makes this safe.
    preserved: touchesSnippet
      ? "Unmentioned snippet fields were read back and resent, so nothing was wiped."
      : undefined,
  };
}

export async function deleteVideo(token, videoId) {
  await call(token, `/videos?${q({ id: videoId })}`, { method: "DELETE" });
  return { deleted: videoId };
}

/* ---------------- playlists ---------------- */

export async function listPlaylists(token, { max = 25 } = {}) {
  const d = await call(
    token,
    `/playlists?${q({ part: "snippet,status,contentDetails", mine: "true", maxResults: Math.min(50, max) })}`
  );
  return (d.items || []).map((p) => ({
    id: p.id,
    title: p.snippet?.title || "",
    description: p.snippet?.description || "",
    privacy: p.status?.privacyStatus || "",
    count: p.contentDetails?.itemCount ?? 0,
    url: `https://www.youtube.com/playlist?list=${p.id}`,
  }));
}

export async function createPlaylist(token, { title, description, privacy = "private" }) {
  const out = await call(token, `/playlists?${q({ part: "snippet,status" })}`, {
    method: "POST",
    body: { snippet: { title, description: description || "" }, status: { privacyStatus: privacy } },
  });
  return { id: out.id, title: out.snippet?.title, url: `https://www.youtube.com/playlist?list=${out.id}` };
}

export async function addToPlaylist(token, playlistId, videoId) {
  const out = await call(token, `/playlistItems?${q({ part: "snippet" })}`, {
    method: "POST",
    body: {
      snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } },
    },
  });
  return { id: out.id, playlistId, videoId };
}

/* ---------------- comments ---------------- */

export async function listComments(token, videoId, { max = 20 } = {}) {
  const d = await call(
    token,
    `/commentThreads?${q({ part: "snippet", videoId, maxResults: Math.min(50, max), order: "time" })}`
  );
  return (d.items || []).map((t) => {
    const c = t.snippet?.topLevelComment?.snippet || {};
    return {
      id: t.snippet?.topLevelComment?.id || t.id,
      threadId: t.id,
      author: c.authorDisplayName || "",
      text: c.textOriginal || c.textDisplay || "",
      likes: Number(c.likeCount || 0),
      publishedAt: c.publishedAt || "",
      replies: t.snippet?.totalReplyCount ?? 0,
    };
  });
}

export async function replyToComment(token, parentId, text) {
  const out = await call(token, `/comments?${q({ part: "snippet" })}`, {
    method: "POST",
    body: { snippet: { parentId, textOriginal: text } },
  });
  return { id: out.id, text: out.snippet?.textOriginal || text };
}

/* ---------------- uploading ---------------- */

// Uploading a video needs a resumable multipart session and the bytes
// themselves, which a Vercel function cannot hold for a file of any size —
// the request body limit makes it impossible for anything but a toy clip.
// Rather than ship a tool that works for 4 MB and fails for 400 MB, this is
// declared unavailable with the reason. The admin UI uploads to object storage
// and YouTube Studio remains the right tool for the actual publish.
export const UPLOAD_NOTE =
  "Uploading video is not offered here: it needs a resumable session carrying the file itself, which a serverless function cannot hold for a real video. Upload in YouTube Studio, then use update_youtube_video to set the title, description, tags and privacy from here.";
