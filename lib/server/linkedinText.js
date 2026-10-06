// PURE. No network, no node built-ins, no credentials.
//
// Everything about LinkedIn that both the browser and the server need to agree
// on lives here, and both import it rather than keeping a copy. It sits in
// lib/server only because that is the one folder marked ESM, so plain node can
// import it without a module-type warning — which is what makes it testable
// without a browser. `lib/server/linkedin.js` re-exports the lot.
//
// This exists because the copies had already started: the 3000-character cap
// was written down twice, once for the composer's counter and once for the
// check that refuses an over-long post, and the capability labels three times.
// Two numbers that must be equal, maintained in two places, are one edit away
// from a composer that says "47 left" about a post the server will reject.

export class LinkedInError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "LinkedInError";
    this.status = status;
    this.code = code;
  }
}

// LinkedIn counts a post in UTF-16 code units, which is exactly what
// String.length measures — so this agrees with LinkedIn rather than
// approximating it.
export const MAX_POST_CHARS = 3000;

export const charsLeft = (text) => MAX_POST_CHARS - String(text || "").length;

// LinkedIn truncates past the cap with no error, so refusing here is the only
// way an author ever learns the end of their post was cut off.
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

// What LinkedIn allows, as DATA. The panel, the MCP tools and the tests all
// read this one object, so a capability cannot be described one way in the UI
// and another in a tool.
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

// Read by the panel AND the preview harness. Two copies of this is how a
// design reference quietly stops matching the thing it references.
export const CAPABILITY_LABELS = {
  post: "Publish a post",
  readBasicProfile: "Read name and email",
  readFullProfile: "Read headline, positions, skills",
  updateProfile: "Change the profile",
  searchJobs: "Search jobs",
  applyToJobs: "Apply to a job",
  listOwnPosts: "List your own posts",
};

export const VISIBILITIES = ["PUBLIC", "CONNECTIONS"];

// The post URN is what a permalink is built from, and LinkedIn returns it in a
// response header rather than the body.
export const postUrl = (urn) =>
  urn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/` : "";

export function buildPostBody({ authorUrn, text, link, image, visibility = "PUBLIC" }) {
  const vis = VISIBILITIES.includes(String(visibility).toUpperCase())
    ? String(visibility).toUpperCase()
    : null;
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

// There is no job search API, so this builds the search a human would run.
// Returning a URL is not a consolation prize: it is the only correct answer,
// and it keeps the tracker the source of truth for what was applied to.
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
  // LinkedIn's own filter ids. Getting one wrong silently returns the
  // UNFILTERED search, which looks like it worked.
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

// The profile can be neither read beyond name and email NOR written, so the
// useful thing is to show what SHOULD be on LinkedIn beside whatever is known,
// ready to paste across.
//
// Pure in both directions: the caller supplies both sides, which is what makes
// it testable with no network and no credentials.
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

// The one piece of real automation available here: the site already holds the
// writing, and a LinkedIn post about it is a link share with a lede.
export function draftFromPost({ title, excerpt, url, tags = [] } = {}) {
  if (!title || !url) throw new LinkedInError("A draft needs at least a title and a URL.");
  const hashtags = tags
    .slice(0, 4)
    // A hashtag with a space in it is not a hashtag.
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
