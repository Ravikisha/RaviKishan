// SERVER ONLY. LinkedIn, for the admin panel and the MCP tools.
//
// WHAT LINKEDIN ACTUALLY ALLOWS — checked against its own docs, not assumed,
// because three of the four things usually wanted here do not exist and
// pretending otherwise would produce tools that fail at the worst moment.
//
//   POST to your feed        YES. `w_member_social`, from the self-serve
//                            "Share on LinkedIn" product. Text, link or image.
//                            150 member requests per day.
//   EDIT a post              YES, the text only. Posts API PARTIAL_UPDATE.
//   COMMENT / REPLY / REACT  YES. Same scope: LinkedIn's permissions page says
//                            w_member_social is "Post, comment and like posts on
//                            behalf of an authenticated member". (Its Comments
//                            and Reactions pages name w_member_social_feed, the
//                            Community Management product -- if LinkedIn ever
//                            enforces that, these answer 403 and say which
//                            product to add; posting is unaffected.)
//   READ comments/reactions  NO. r_member_social, partner-only.
//   READ your own profile    PARTIAL. OIDC `/v2/userinfo` gives name, picture,
//                            email and the person id every post is authored by.
//                            Headline, positions, skills and education need
//                            `r_fullprofile`, which is partner-only.
//   UPDATE your profile      NO. There is no profile write API at ANY tier.
//                            LinkedIn removed it. Headline and About are
//                            edited on linkedin.com, by a human, always.
//   SEARCH jobs              NO self-serve API. Job search sits inside Talent
//                            Solutions, which is partner-only and whose docs
//                            state new partnerships are closed.
//   APPLY to a job           NO API at any tier. "Apply Connect" is the
//                            opposite direction — it delivers applications TO
//                            an employer's ATS, it does not submit them.
//   READ your own posts      NO self-serve API. `r_member_social` is
//                            restricted, so the history this app shows is the
//                            one it wrote itself (see linkedinPosts).
//
// So: posting is real and complete. "Sync the profile" is answered from the
// LinkedIn data export already in this repo plus drift detection against the
// site, which is the honest version of a thing with no API. Job search is
// answered with deep links into LinkedIn's own search and the existing jobs/
// tracker, which is what a human would do anyway.
//
// Nothing in this file scrapes linkedin.com. It is against LinkedIn's User
// Agreement, it breaks without warning, and it puts a real account at risk of
// restriction — which is a bad trade for a convenience.
import {
  assertPostable,
  assertPostUrn,
  buildComment,
  buildPostBody,
  buildPostEdit,
  assertCommentText,
  CAPABILITIES,
  LINKEDIN_API_VERSION,
  LinkedInError,
  MAX_POST_CHARS,
  parseCommentUrn,
  postUrl,
  reactionType,
} from "./linkedinText.js";

// Re-exported so callers have ONE import for LinkedIn, exactly as lib/posts.js
// re-exports postText.js. The pure half lives in its own file because the
// browser needs it too and must not keep a second copy.
export {
  assertPostable,
  buildPostBody,
  canonicalHeadline,
  headlineDrift,
  MAX_HEADLINE_CHARS,
  RETIRED_PHRASES,
  CAPABILITIES,
  CAPABILITY_LABELS,
  charsLeft,
  draftFromPost,
  jobSearchUrl,
  LinkedInError,
  MAX_POST_CHARS,
  MAX_COMMENT_CHARS,
  buildPostEdit,
  assertCommentText,
  parseCommentUrn,
  postUrl,
  postUrnFrom,
  profileDrift,
  REACTIONS,
  VISIBILITIES,
} from "./linkedinText.js";

const API = "https://api.linkedin.com";

async function call(token, path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      // Required on every UGC call; without it LinkedIn answers 400 with a
      // message that does not mention the header.
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": LINKEDIN_API_VERSION,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    throw new LinkedInError(
      "LinkedIn rejected the connection. Its tokens last 60 days and cannot be refreshed by a self-serve app, so this needs reconnecting in the admin's LinkedIn tab.",
      { status: 401, code: "linkedin/expired" }
    );
  }
  if (res.status === 403) {
    let detail = "";
    try {
      detail = (await res.json())?.message || "";
    } catch (_) {}
    const social = /socialActions|reactions/.test(path);
    throw new LinkedInError(
      `LinkedIn refused that${detail ? ` (${detail})` : ""}. ` +
        (social
          ? 'Comments and reactions run on w_member_social. If the app has "Share on LinkedIn" and this still refuses, LinkedIn is enforcing w_member_social_feed: add the "Community Management API" product to the app (LinkedIn reviews it).'
          : 'This usually means the app is missing a product: "Share on LinkedIn" grants w_member_social, "Sign In with LinkedIn using OpenID Connect" grants the profile read.'),
      { status: 403, code: "linkedin/scope" }
    );
  }
  if (res.status === 429) {
    throw new LinkedInError(
      "LinkedIn's rate limit is spent. A member may make 150 requests a day, and it resets at midnight UTC.",
      { status: 429, code: "linkedin/rate-limit" }
    );
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.message || j?.error_description || msg;
    } catch (_) {}
    if (res.status === 404) {
      throw new LinkedInError(
        `LinkedIn has no such ${/comments/.test(path) ? "comment" : "post"}: it was deleted, or the URN is wrong. (${msg})`,
        { status: 404, code: "linkedin/not-found" }
      );
    }
    throw new LinkedInError(`LinkedIn: ${msg}`, { status: res.status });
  }
  if (res.status === 204) return { id: res.headers.get("x-restli-id") || "" };

  const text = await res.text();
  const out = text ? JSON.parse(text) : {};
  // A created post's URN comes back in a header, not the body.
  const created = res.headers.get("x-restli-id");
  return created ? { ...out, id: out.id || created } : out;
}

/* ---------------- identity ---------------- */

// The whole of the readable profile. `sub` is the person id every post must be
// authored by, which is the real reason this is called before posting.
export async function getProfile(token) {
  const u = await call(token, "/v2/userinfo");
  return {
    personId: u.sub,
    authorUrn: `urn:li:person:${u.sub}`,
    name: u.name || "",
    givenName: u.given_name || "",
    familyName: u.family_name || "",
    email: u.email || "",
    picture: u.picture || "",
    locale: typeof u.locale === "string" ? u.locale : u.locale?.language || "",
    // Said plainly rather than left as a surprising absence.
    note:
      "This is everything LinkedIn's self-serve API exposes. Headline, About, positions and skills are not readable without a partnership — read them from the LinkedIn data export instead.",
  };
}

/* ---------------- posting ---------------- */

export async function createPost(token, { authorUrn, text, link, image, visibility }) {
  const body = buildPostBody({
    authorUrn,
    text: assertPostable(text),
    link,
    image,
    visibility,
  });
  const out = await call(token, "/v2/ugcPosts", { method: "POST", body });
  const urn = out.id || "";
  return { urn, url: postUrl(urn) };
}

// Deleting is allowed with the same scope that created it.
export async function deletePost(token, urn) {
  if (!String(urn || "").startsWith("urn:li:")) {
    throw new LinkedInError(`"${urn}" is not a LinkedIn post URN.`);
  }
  await call(token, `/v2/ugcPosts/${encodeURIComponent(urn)}`, { method: "DELETE" });
  return { deleted: urn };
}

/* ---------------- images ---------------- */

// Three steps, and the middle one does not go through `call`: the upload is a
// binary PUT to a URL LinkedIn hands back, not a JSON API request.
export async function uploadImage(token, { authorUrn, bytes, contentType = "image/png" }) {
  const reg = await call(token, "/v2/assets?action=registerUpload", {
    method: "POST",
    body: {
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        owner: authorUrn,
        serviceRelationships: [
          { relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" },
        ],
      },
    },
  });

  const uploadUrl =
    reg?.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]
      ?.uploadUrl;
  const asset = reg?.value?.asset;
  if (!uploadUrl || !asset) {
    throw new LinkedInError("LinkedIn did not return an upload URL for the image.");
  }

  const put = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: bytes,
  });
  if (!put.ok) {
    throw new LinkedInError(`LinkedIn refused the image upload (HTTP ${put.status}).`);
  }
  return { asset };
}

/* ---------------- editing ---------------- */

// Only the text of a published post can change. The URN may be a share or a
// ugcPost (/v2/ugcPosts returns either) and /rest/posts takes both.
export async function editPost(token, urn, text) {
  const u = assertPostUrn(urn);
  if (u.startsWith("urn:li:activity:")) {
    throw new LinkedInError(
      "An activity URN names the feed item, not the post. Editing needs the urn:li:share:... or urn:li:ugcPost:... returned when it was published (list_linkedin_posts has it)."
    );
  }
  await call(token, `/rest/posts/${encodeURIComponent(u)}`, {
    method: "POST",
    body: buildPostEdit(text),
    headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
  });
  return { edited: u, url: postUrl(u), chars: String(text).trim().length };
}

/* ---------------- comments ---------------- */

// A reply is posted to the PARENT comment's thread; a top-level comment to the
// post. Both carry `object` = the post, which is what LinkedIn keys them by.
export async function createComment(token, { actorUrn, postUrn, text, parentCommentUrn }) {
  const body = buildComment({ actorUrn, postUrn, text, parentCommentUrn });
  const target = parentCommentUrn ? parseCommentUrn(parentCommentUrn).urn : body.object;
  const out = await call(token, `/rest/socialActions/${encodeURIComponent(target)}/comments`, {
    method: "POST",
    body,
  });
  const id = String(out.id || "");
  // LinkedIn's own composite key, built from the comment's thread and id.
  const commentUrn =
    out.commentUrn || (id && out.object ? `urn:li:comment:(${out.object},${id})` : "");
  return { commentUrn, commentId: id, postUrn: body.object, url: postUrl(body.object) };
}

// Edit and delete address the comment through the post it sits on. LinkedIn
// says the reliable key is the comment's `object` plus its id, so the post URN
// is used when known and the comment's own thread is the fallback.
function commentPath(commentUrn, postUrn) {
  const c = parseCommentUrn(commentUrn);
  const thread = postUrn ? assertPostUrn(postUrn) : c.thread;
  return `/rest/socialActions/${encodeURIComponent(thread)}/comments/${c.id}`;
}

export async function editComment(token, { commentUrn, postUrn, text }) {
  await call(token, commentPath(commentUrn, postUrn), {
    method: "POST",
    body: { patch: { message: { $set: { text: assertCommentText(text) } } } },
    headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
  });
  return { edited: parseCommentUrn(commentUrn).urn };
}

export async function deleteComment(token, { commentUrn, postUrn }) {
  await call(token, commentPath(commentUrn, postUrn), { method: "DELETE" });
  return { deleted: parseCommentUrn(commentUrn).urn };
}

/* ---------------- reactions ---------------- */

// A post or a comment can be reacted to. Reacting again replaces the reaction.
function reactionTarget(urn) {
  const s = String(urn || "").trim();
  return s.startsWith("urn:li:comment:") ? parseCommentUrn(s).urn : assertPostUrn(s);
}

export async function react(token, { actorUrn, urn, reaction = "like" }) {
  const root = reactionTarget(urn);
  const type = reactionType(reaction);
  await call(token, `/rest/reactions?actor=${encodeURIComponent(actorUrn)}`, {
    method: "POST",
    body: { root, reactionType: type },
  });
  return { reacted: root, reaction: type };
}

export async function unreact(token, { actorUrn, urn }) {
  const root = reactionTarget(urn);
  // Rest.li compound key: the parentheses and comma are syntax, the URNs are
  // encoded inside them.
  const key = `(actor:${encodeURIComponent(actorUrn)},entity:${encodeURIComponent(root)})`;
  await call(token, `/rest/reactions/${key}`, { method: "DELETE" });
  return { removed: root };
}
