// SERVER ONLY. LinkedIn, for the admin panel and the MCP tools.
//
// WHAT LINKEDIN ACTUALLY ALLOWS — checked against its own docs, not assumed,
// because three of the four things usually wanted here do not exist and
// pretending otherwise would produce tools that fail at the worst moment.
//
//   POST to your feed        YES. `w_member_social`, from the self-serve
//                            "Share on LinkedIn" product. Text, link or image.
//                            150 member requests per day.
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
  buildPostBody,
  CAPABILITIES,
  LinkedInError,
  MAX_POST_CHARS,
  postUrl,
} from "./linkedinText.js";

// Re-exported so callers have ONE import for LinkedIn, exactly as lib/posts.js
// re-exports postText.js. The pure half lives in its own file because the
// browser needs it too and must not keep a second copy.
export {
  assertPostable,
  buildPostBody,
  CAPABILITIES,
  CAPABILITY_LABELS,
  charsLeft,
  draftFromPost,
  jobSearchUrl,
  LinkedInError,
  MAX_POST_CHARS,
  postUrl,
  profileDrift,
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
      "LinkedIn-Version": "202405",
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
    throw new LinkedInError(
      `LinkedIn refused that${detail ? ` (${detail})` : ""}. This usually means the app is missing a product: "Share on LinkedIn" grants w_member_social, "Sign In with LinkedIn using OpenID Connect" grants the profile read.`,
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
