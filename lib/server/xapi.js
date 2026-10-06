// SERVER ONLY. X (Twitter) API v2.
//
// TWO THINGS TO KNOW BEFORE USING ANY OF THIS:
//
// 1. X IS NOT FREE ANY MORE. On 6 February 2026 X moved to pay-per-usage
//    credits; there is no free tier for new developers, and legacy free
//    accounts are write-only with roughly 1,500 posts a month and NO read
//    access. So reads here can fail on billing rather than on anything wrong
//    with the code, and the error says so rather than reporting an empty
//    timeline.
//
// 2. THERE IS NO EDIT ENDPOINT. Editing a post is an in-app feature for paid
//    accounts — five edits within thirty minutes — and it was never exposed
//    through the API. The v2 endpoints only READ edit history
//    (`edit_history_tweet_ids`). A tool that claimed to edit a post would be
//    a lie that fails at call time, so the only write verbs here are create
//    and delete.
const API = "https://api.x.com/2";

export class XError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "XError";
    this.status = status;
    this.code = code;
  }
}

export const MAX_POST_CHARS = 280;

export const CAPABILITIES = {
  createPost: { available: true, how: "POST /2/tweets — billed per request since 6 Feb 2026" },
  deletePost: { available: true, how: "DELETE /2/tweets/:id" },
  readOwnPosts: {
    available: true,
    how: "GET /2/users/:id/tweets — needs a paid tier; legacy free accounts are write-only",
  },
  editPost: {
    available: false,
    why: "X has no edit endpoint at any tier. Editing is an in-app feature for paid accounts; the API only reads edit history.",
    instead: "Delete and repost. create_x_post takes dryRun so the text can be checked first.",
  },
  freeTier: {
    available: false,
    why: "X ended its free tier for new developers on 6 February 2026; access is pay-per-usage credits.",
    instead: "Expect reads to fail on billing, not on a bug. The error says which.",
  },
};

// X counts a post in weighted units, not characters: a URL always counts as 23
// whatever its length, and most CJK characters count as 2. Counting
// String.length would let a post through that X then rejects, which is the
// failure this avoids.
const URL_RE = /https?:\/\/\S+/g;
const URL_WEIGHT = 23;

export function weightedLength(text) {
  const s = String(text || "");
  const urls = s.match(URL_RE) || [];
  const withoutUrls = s.replace(URL_RE, "");
  let n = urls.length * URL_WEIGHT;
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0);
    // The ranges X weights as 2: CJK, Hiragana, Katakana and Hangul.
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0x303e) ||
      (cp >= 0x3041 && cp <= 0x33ff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xa000 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6);
    n += wide ? 2 : 1;
  }
  return n;
}

export const charsLeft = (text) => MAX_POST_CHARS - weightedLength(text);

export function assertPostable(text) {
  const t = String(text || "").trim();
  if (!t) throw new XError("A post needs some text.");
  const n = weightedLength(t);
  if (n > MAX_POST_CHARS) {
    throw new XError(
      `An X post is capped at ${MAX_POST_CHARS} weighted characters; that one is ${n}. A URL counts as ${URL_WEIGHT} whatever its length.`
    );
  }
  return t;
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
    throw new XError("X rejected the connection. Reconnect that account in the admin's Social tab.", {
      status: 401,
    });
  }
  if (res.status === 403) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.detail || j?.title || "";
    } catch (_) {}
    throw new XError(
      `X refused that${detail ? ` (${detail})` : ""}. Since 6 February 2026 access is pay-per-usage — a 403 here is usually the plan, not the code.`,
      { status: 403 }
    );
  }
  if (res.status === 429) {
    const reset = res.headers.get("x-rate-limit-reset");
    throw new XError(
      `X's rate limit is spent${reset ? `; it resets at ${new Date(Number(reset) * 1000).toISOString()}` : ""}.`,
      { status: 429 }
    );
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.detail || j?.title || j?.errors?.[0]?.message || msg;
    } catch (_) {}
    throw new XError(`X: ${msg}`, { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}

/* ---------------- account ---------------- */

export async function getAccount(token) {
  const d = await call(
    token,
    "/users/me?user.fields=name,username,description,profile_image_url,public_metrics,verified"
  );
  const u = d?.data || {};
  return {
    id: u.id,
    username: u.username || "",
    handle: u.username ? `@${u.username}` : "",
    name: u.name || "",
    description: u.description || "",
    picture: u.profile_image_url || "",
    followers: u.public_metrics?.followers_count ?? null,
    following: u.public_metrics?.following_count ?? null,
    posts: u.public_metrics?.tweet_count ?? null,
    url: u.username ? `https://x.com/${u.username}` : "",
  };
}

/* ---------------- posts ---------------- */

export const postUrl = (username, id) =>
  username && id ? `https://x.com/${username}/status/${id}` : "";

export async function createPost(token, { text, replyTo, quoteId }) {
  const body = { text: assertPostable(text) };
  if (replyTo) body.reply = { in_reply_to_tweet_id: replyTo };
  if (quoteId) body.quote_tweet_id = quoteId;
  const out = await call(token, "/tweets", { method: "POST", body });
  const id = out?.data?.id;
  if (!id) throw new XError("X did not return a post id.");
  return { id, text: out.data.text || body.text };
}

// A thread is just replies chained to the previous id. Posted in order and
// stopped at the first failure, so a half-thread is reported rather than
// silently continued from the wrong parent.
export async function createThread(token, texts) {
  const parts = (texts || []).map((t) => assertPostable(t));
  if (!parts.length) throw new XError("A thread needs at least one post.");
  const posted = [];
  let parent = null;
  for (const text of parts) {
    try {
      const out = await createPost(token, { text, replyTo: parent });
      posted.push(out);
      parent = out.id;
    } catch (e) {
      throw new XError(
        `The thread stopped after ${posted.length} of ${parts.length} posts: ${e.message}`,
        { status: e.status }
      );
    }
  }
  return { count: posted.length, posts: posted };
}

export async function deletePost(token, id) {
  const out = await call(token, `/tweets/${encodeURIComponent(id)}`, { method: "DELETE" });
  return { deleted: !!out?.data?.deleted, id };
}

export async function listPosts(token, userId, { max = 10 } = {}) {
  const d = await call(
    token,
    `/users/${encodeURIComponent(userId)}/tweets?max_results=${Math.min(
      100,
      Math.max(5, max)
    )}&tweet.fields=created_at,public_metrics,edit_history_tweet_ids`
  );
  return (d?.data || []).map((t) => ({
    id: t.id,
    text: t.text || "",
    createdAt: t.created_at || "",
    likes: t.public_metrics?.like_count ?? null,
    reposts: t.public_metrics?.retweet_count ?? null,
    replies: t.public_metrics?.reply_count ?? null,
    // Present because X exposes edit HISTORY while offering no way to edit.
    edits: Array.isArray(t.edit_history_tweet_ids) ? t.edit_history_tweet_ids.length : 1,
  }));
}
