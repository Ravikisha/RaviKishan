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
const API = "https://api.linkedin.com";

export class LinkedInError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "LinkedInError";
    this.status = status;
    this.code = code;
  }
}

// Capabilities as DATA, so the panel, the tools and the tests all answer the
// same way and a reader never has to take a comment's word for it.
export const CAPABILITIES = {
  post: { available: true, how: "w_member_social, self-serve" },
  readBasicProfile: { available: true, how: "OIDC /v2/userinfo" },
  readFullProfile: {
    available: false,
    why: "r_fullprofile (headline, positions, skills) is partner-only.",
    instead: "The LinkedIn data export in linkedin/ carries all of it.",
  },
  updateProfile: {
    available: false,
    why: "LinkedIn has no profile write API at any tier.",
    instead: "Edit on linkedin.com. get_linkedin_drift shows exactly what to paste.",
  },
  searchJobs: {
    available: false,
    why: "Job search is Talent Solutions, partner-only, and new partnerships are closed.",
    instead: "linkedin_job_search_url builds the search; save what you find to the jobs tracker.",
  },
  applyToJobs: {
    available: false,
    why: "No application-submission API exists at any tier. Apply Connect delivers applications to employers, it does not send them.",
    instead: "Apply on linkedin.com, then record it with create_job so the tracker stays true.",
  },
  listOwnPosts: {
    available: false,
    why: "r_member_social is restricted, so posts cannot be read back.",
    instead: "Every post made through here is recorded in linkedinPosts, which is what the history shows.",
  },
};

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

export const MAX_POST_CHARS = 3000;

// LinkedIn counts a post in UTF-16 code units and truncates past 3000 with no
// error, so the check is here rather than in the caller.
export function assertPostable(text) {
  const t = String(text || "").trim();
  if (!t) throw new LinkedInError("A post needs some text.");
  if (t.length > MAX_POST_CHARS) {
    throw new LinkedInError(
      `A LinkedIn post is capped at ${MAX_POST_CHARS} characters; that one is ${t.length}. Shorten it rather than letting LinkedIn cut it.`
    );
  }
  return t;
}

const VISIBILITY = { PUBLIC: "PUBLIC", CONNECTIONS: "CONNECTIONS" };

export function buildPostBody({ authorUrn, text, link, image, visibility = "PUBLIC" }) {
  const vis = VISIBILITY[String(visibility).toUpperCase()];
  if (!vis) throw new LinkedInError('visibility must be "PUBLIC" or "CONNECTIONS".');
  if (link && image) {
    throw new LinkedInError(
      "A post carries either a link preview or an image, not both — LinkedIn renders only one."
    );
  }

  const content = {
    shareCommentary: { text },
    shareMediaCategory: image ? "IMAGE" : link ? "ARTICLE" : "NONE",
  };
  if (link) {
    content.media = [
      {
        status: "READY",
        originalUrl: link.url,
        ...(link.title ? { title: { text: link.title } } : {}),
        ...(link.description ? { description: { text: link.description } } : {}),
      },
    ];
  }
  if (image) {
    content.media = [
      {
        status: "READY",
        media: image.asset,
        ...(image.title ? { title: { text: image.title } } : {}),
        ...(image.description ? { description: { text: image.description } } : {}),
      },
    ];
  }

  return {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: { "com.linkedin.ugc.ShareContent": content },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": vis },
  };
}

// The post URN is what a permalink is built from, and LinkedIn returns it in a
// header rather than the body.
export const postUrl = (urn) =>
  urn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/` : "";

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

/* ---------------- jobs, honestly ---------------- */

// There is no job search API, so this builds the search a human would run.
// Returning a URL is not a consolation prize: it is the only correct answer,
// and it keeps the tracker the source of truth for what was actually applied to.
export function jobSearchUrl({
  keywords = "",
  location = "",
  remote = false,
  postedWithinDays = 0,
  experience = "",
} = {}) {
  const q = new URLSearchParams();
  if (keywords) q.set("keywords", keywords);
  if (location) q.set("location", location);
  // LinkedIn's own filter ids. f_WT=2 is "Remote".
  if (remote) q.set("f_WT", "2");
  if (postedWithinDays > 0) q.set("f_TPR", `r${Math.round(postedWithinDays * 86400)}`);
  const levels = {
    internship: "1",
    entry: "2",
    associate: "3",
    "mid-senior": "4",
    director: "5",
    executive: "6",
  };
  if (experience && levels[experience]) q.set("f_E", levels[experience]);
  return `https://www.linkedin.com/jobs/search/?${q.toString()}`;
}

/* ---------------- the profile this site claims ---------------- */

// Since the profile cannot be read OR written through the API, the useful
// thing is to show exactly what should be on LinkedIn and what is on the site,
// so the difference can be pasted across in one go.
//
// Pure: the caller supplies both sides. That makes it testable with no network
// and no credentials, which is the whole point.
export function profileDrift({ site = {}, linkedin = {} } = {}) {
  const fields = [
    ["headline", "Headline", 220],
    ["about", "About", 2600],
    ["location", "Location", 0],
    ["website", "Website", 0],
  ];

  const rows = [];
  for (const [key, label, cap] of fields) {
    const want = String(site[key] || "").trim();
    const have = String(linkedin[key] || "").trim();
    const known = have !== "";
    rows.push({
      field: key,
      label,
      canonical: want,
      onLinkedIn: have,
      // Three-valued on purpose. Without a full-profile read most fields are
      // genuinely UNKNOWN, and reporting unknown as "drift" would cry wolf on
      // every row — the same mistake the Medium integration avoided.
      state: !want ? "unset" : !known ? "unknown" : want === have ? "match" : "drift",
      ...(cap && want.length > cap
        ? { warning: `LinkedIn caps ${label} at ${cap} characters; this is ${want.length}.` }
        : {}),
    });
  }

  return {
    rows,
    drifting: rows.filter((r) => r.state === "drift").length,
    unknown: rows.filter((r) => r.state === "unknown").length,
    note:
      "LinkedIn has no profile read beyond name and email, and no profile write at all. Anything marked unknown was not readable; copy the canonical value into linkedin.com by hand.",
  };
}

/* ---------------- turning a blog post into a LinkedIn post ---------------- */

// The one piece of real automation available here: the site already holds the
// writing, and a LinkedIn post about it is a link share with a lede.
export function draftFromPost({ title, excerpt, url, tags = [] } = {}) {
  if (!title || !url) throw new LinkedInError("A draft needs at least a title and a URL.");
  const hashtags = tags
    .slice(0, 4)
    .map((t) => `#${String(t).replace(/[^A-Za-z0-9]/g, "")}`)
    .filter((t) => t.length > 1);

  const body = [String(excerpt || "").trim(), "", url, "", hashtags.join(" ")]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n")
    .trim();

  const text = `${title}\n\n${body}`.trim();
  return {
    text: text.slice(0, MAX_POST_CHARS),
    link: { url, title },
    overLimit: text.length > MAX_POST_CHARS,
    chars: Math.min(text.length, MAX_POST_CHARS),
  };
}
