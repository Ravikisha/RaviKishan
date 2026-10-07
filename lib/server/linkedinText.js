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
  editPost: {
    available: true,
    how: "Posts API PARTIAL_UPDATE, w_member_social. The text only: visibility, link and media are fixed once published.",
  },
  comment: {
    available: true,
    how: "Comments API, w_member_social: comment, reply, edit and delete your own comments.",
  },
  react: {
    available: true,
    how: "Reactions API, w_member_social: like, celebrate, support, love, insightful, funny.",
  },
  readComments: {
    available: false,
    why: "Reading comments and reactions needs r_member_social, which LinkedIn grants to approved partners only.",
    instead: "Open the post on linkedin.com. A comment made from here returns its URN, which is all an edit or delete needs.",
  },
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
  editPost: "Edit a post's text",
  comment: "Comment and reply",
  react: "React to posts and comments",
  readComments: "Read comments and reactions",
  readBasicProfile: "Read name and email",
  readFullProfile: "Read headline, positions, skills",
  updateProfile: "Change the profile",
  searchJobs: "Search jobs",
  applyToJobs: "Apply to a job",
  listOwnPosts: "List your own posts",
};

export const VISIBILITIES = ["PUBLIC", "CONNECTIONS"];

/* ---------------- edit, comment, react ---------------- */

// Every /rest/ call names a version, and LinkedIn sunsets each one about a year
// after release — 202510 dies on 15 Oct 2026. The old "202405" was long dead,
// which never showed only because nothing here had called /rest/ yet; the /v2/
// endpoints ignore the header. One constant, bumped when LinkedIn warns.
export const LINKEDIN_API_VERSION = "202609";

// LinkedIn's comment box stops at 1250 characters.
export const MAX_COMMENT_CHARS = 1250;

// The Posts API stores commentary in LinkedIn's "little" format, where
// | { } @ [ ] ( ) < > # \ * _ ~ are syntax and MUST be backslash-escaped,
// "even if those characters are not used in one of the supported elements".
// An edit saying "(see below)" sent raw is malformed little. The one exception
// kept bare is #word, which little reads as a hashtag — what the author meant.
export function escapeLittle(text) {
  return String(text)
    .replace(/[|{}@[\]()<>\\*_~]/g, "\\$&")
    .replace(/#(?![\p{L}\p{N}])/gu, "\\#");
}

// Friendly names, because LinkedIn's enum is not what its own UI says:
// "Celebrate" is PRAISE, "Love" is EMPATHY, "Insightful" is INTEREST.
// MAYBE ("Curious") is deprecated and answers 400, so it is not offered.
export const REACTIONS = {
  like: "LIKE",
  celebrate: "PRAISE",
  support: "APPRECIATION",
  love: "EMPATHY",
  insightful: "INTEREST",
  funny: "ENTERTAINMENT",
};

export function reactionType(name = "like") {
  const t = REACTIONS[String(name).toLowerCase()];
  if (!t) {
    throw new LinkedInError(
      `Unknown reaction "${name}". Use one of: ${Object.keys(REACTIONS).join(", ")}.`
    );
  }
  return t;
}

const POST_URN = /^urn:li:(share|ugcPost|activity):\d+$/;
const COMMENT_URN = /^urn:li:comment:\((urn:li:(?:activity|share|ugcPost):\d+),(\d+)\)$/;

export function assertPostUrn(urn) {
  const u = String(urn || "").trim();
  if (!POST_URN.test(u)) {
    throw new LinkedInError(
      `"${urn}" is not a LinkedIn post URN. Expected urn:li:share:…, urn:li:ugcPost:… or urn:li:activity:… — the number in a post's linkedin.com/feed/update/ link.`
    );
  }
  return u;
}

// A comment URN embeds its thread: urn:li:comment:(urn:li:activity:1,2).
export function parseCommentUrn(urn) {
  const m = COMMENT_URN.exec(String(urn || "").trim());
  if (!m) {
    throw new LinkedInError(
      `"${urn}" is not a LinkedIn comment URN. Expected urn:li:comment:(urn:li:activity:…,…), as returned when the comment was made.`
    );
  }
  return { urn: m[0], thread: m[1], id: m[2] };
}

// A link pasted from the browser is the commonest way to name a post, so
// accept it: linkedin.com/feed/update/urn:li:activity:123/ carries the URN.
export function postUrnFrom(input) {
  const s = decodeURIComponent(String(input || "").trim());
  const m = /urn:li:(share|ugcPost|activity):\d+/.exec(s);
  return assertPostUrn(m ? m[0] : s);
}

export function assertCommentText(text) {
  const t = String(text || "").trim();
  if (!t) throw new LinkedInError("A comment needs some text.");
  if (t.length > MAX_COMMENT_CHARS) {
    throw new LinkedInError(
      `A LinkedIn comment is capped at ${MAX_COMMENT_CHARS} characters; that one is ${t.length}.`
    );
  }
  return t;
}

// Only `commentary` is editable on a published post. Visibility, the link
// preview and media are fixed at creation — LinkedIn's own UI says the same.
export function buildPostEdit(text) {
  return { patch: { $set: { commentary: escapeLittle(assertPostable(text)) } } };
}

export function buildComment({ actorUrn, postUrn, text, parentCommentUrn }) {
  const body = {
    actor: actorUrn,
    object: assertPostUrn(postUrn),
    message: { text: assertCommentText(text) },
  };
  if (parentCommentUrn) body.parentComment = parseCommentUrn(parentCommentUrn).urn;
  return body;
}

// Where the feed cuts a post off behind "…see more". LinkedIn does not publish
// the number and it shifts with line breaks and screen width; about three
// lines, ~210 characters on desktop, is the commonly measured figure. The
// composer uses it to show the opening a reader actually sees, and says it is
// approximate rather than pretending to a precision LinkedIn does not offer.
export const FEED_FOLD = 210;
// The fold is also a LINE count: a post that opens with three short lines and
// a blank one folds long before 210 characters, and a blank line costs a line.
export const FEED_LINES = 3;

export function feedOpening(text, fold = FEED_FOLD, maxLines = FEED_LINES) {
  const all = String(text || "").trim();
  const lines = all.split("\n");
  const s = lines.length > maxLines ? lines.slice(0, maxLines).join("\n").trimEnd() : all;
  if (s.length <= fold) return { shown: s, cut: s.length < all.length };
  // Break on a word, not mid-word: the real feed never shows half a word.
  const head = s.slice(0, fold);
  const space = head.lastIndexOf(" ");
  return { shown: (space > fold * 0.6 ? head.slice(0, space) : head).trimEnd(), cut: true };
}

// LinkedIn matches a redirect URL EXACTLY — scheme, host, port and path — and
// ravikishan.me answers on www (the apex 308s there), so registering only the
// apex is the classic way to get "redirect_uri does not match" on the very
// first click. The panel lists every URL the app can send, plus the one it is
// running on right now.
export const LINKEDIN_CALLBACK_PATH = "/api/integrations/linkedin/callback";
export const LINKEDIN_PROD_ORIGINS = ["https://www.ravikishan.me", "https://ravikishan.me"];

export function linkedinRedirectUris(currentOrigin = "") {
  const origins = [...LINKEDIN_PROD_ORIGINS, "http://localhost:3000"];
  const here = String(currentOrigin || "").replace(/\/+$/, "");
  if (/^https?:\/\/[^/]+$/.test(here) && !origins.includes(here)) origins.push(here);
  return origins.map((o) => o + LINKEDIN_CALLBACK_PATH);
}

/* ---------------- the headline, which is the whole point ---------------- */

// A LinkedIn headline is the single most-read string this person owns: it sits
// under their name in every search result, every connection request and every
// comment. It is also the one field LinkedIn offers NO WAY to write -- no
// scope, no endpoint, at any tier. So the only thing software can do is notice
// when it disagrees with the canonical positioning and hand over the text.
//
// Phrases the positioning deliberately moved away from. Data, not a regex
// buried in a component, so the panel and any future audit read the same list.
export const RETIRED_PHRASES = [
  {
    match: /full[\s-]?stack\s+developer/i,
    says: "Full Stack Developer",
    why: "The positioning leads with systems work — a UI runtime, an interpreter, a container runtime, a datastore — and 'Full Stack Developer' buries all of it under the commonest title on the platform.",
  },
  {
    match: /\bfreelancer\b/i,
    says: "Freelancer",
    why: "Reads as availability rather than as expertise, and competes with the role for the first thing a recruiter sees.",
  },
];

// Everything LinkedIn allows a headline to be. Past it, LinkedIn truncates
// silently, which is how a carefully built line loses its last clause.
export const MAX_HEADLINE_CHARS = 220;

// What the headline SHOULD say, built from the canonical identity rather than
// written out again here — two copies of a positioning statement drift the
// moment one is edited.
export function canonicalHeadline({ role, focus = [], now } = {}) {
  const parts = [role, focus.join(", "), now].filter(Boolean);
  return parts.join(" | ");
}

// Compare what LinkedIn shows against what the site leads with.
//
// Three-valued like get_linkedin_drift, and for the same reason: the headline
// is only readable from a data export, so "we have no export" is `unknown`,
// not `match`. Reporting an unread field as agreeing is how a drift detector
// becomes a thing you stop believing.
export function headlineDrift(onLinkedIn, canonical) {
  const live = String(onLinkedIn || "").replace(/\s+/g, " ").trim();
  const want = String(canonical || "").replace(/\s+/g, " ").trim();

  if (!live) {
    return {
      state: "unknown",
      live: "",
      canonical: want,
      retired: [],
      note: "No LinkedIn export has been snapshotted, so the live headline cannot be read. Run `npm run linkedin:snapshot` after downloading your data from LinkedIn.",
    };
  }

  const retired = RETIRED_PHRASES.filter((r) => r.match.test(live)).map(({ says, why }) => ({ says, why }));
  // Same leading clause, give or take spacing and case: the headline may carry
  // extra clauses and still lead correctly, which is what actually matters.
  const leads = (t) => t.split("|")[0].replace(/[^a-z0-9 ]/gi, "").trim().toLowerCase();
  const leadsRight = !!want && leads(live) === leads(want);

  return {
    state: retired.length || !leadsRight ? "drift" : "match",
    live,
    canonical: want,
    retired,
    leadsRight,
    overLength: live.length > MAX_HEADLINE_CHARS,
    length: live.length,
    note: retired.length
      ? `The headline still carries ${retired.map((r) => `"${r.says}"`).join(" and ")}.`
      : leadsRight
      ? "The headline leads the way the site does."
      : "The headline opens with something other than the canonical role.",
  };
}

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
