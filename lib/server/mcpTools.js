// SERVER ONLY. The tool surface exposed over MCP.
//
// Every handler runs against Firestore REST as the signed-in admin, so the
// security rules are the real boundary — a scope check here is defence in
// depth, not the only gate.
//
// Design notes:
//   - Vault tools return METADATA and, on request, a short-lived download URL.
//     They never return bytes, and there is no vault WRITE tool: uploading an
//     identity document requires the passphrase that only exists in the
//     browser, so doing it from an AI client would silently skip encryption.
//   - Contacts are other people's personal data, so reads cap what they
//     return; correcting or removing a row is allowed, importing is not.
//   - Two admin capabilities are deliberately absent and always will be:
//     minting or revoking an MCP token (a token that can mint tokens is a
//     privilege-escalation ladder), and uploading to the vault (encryption
//     happens in the browser with a passphrase that never leaves it).
//   - Google Tasks works by BORROWING the admin's short-lived access token
//     from an admin-only Firestore document (lib/server/googleTasksServer).
//     The refresh token is still never stored: these tools work while the
//     admin session is warm and say plainly when it is not.
// Explicit .js on every relative import: lib/server is marked ESM so plain
// node can import it, and node ESM does not guess extensions. Webpack is
// happy either way, so this costs nothing and keeps the registry testable.
import {
  getDocument,
  listDocuments,
  patchDocument,
  createDocument,
  deleteDocument,
} from "./firestoreRest.js";
import { presign, assertVaultKey, assertMediaKey, isVaultConfigured } from "./b2.js";
import { PREFIXES, inOwnedPrefix, listPrefix } from "./objects.js";
import { listMine, toPost, crossPost, isDevtoConfigured } from "./devto.js";
import { toPortableMarkdown, listPortableBlocks } from "./portableMarkdown.js";
import { fetchMediumPosts, mediumState, mediumImportUrl } from "./medium.js";
import { boardFor, adapterFor, moveAcrossProviders, DEFAULT_PROVIDER } from "./taskBoard.js";
import { connectionStatus, readConnection, accessTokenFor } from "./connectedAccount.js";
import {
  getViewer as ghViewer,
  updateProfile as ghUpdateProfile,
  listRepos as ghListRepos,
  getRepo as ghGetRepo,
  updateRepo as ghUpdateRepo,
  createRepo as ghCreateRepo,
  getReadme as ghGetReadme,
  writeReadme as ghWriteReadme,
  getFile as ghGetFile,
  putFile as ghPutFile,
  listPinned as ghListPinned,
  auditRepos as ghAuditRepos,
} from "./github.js";
import { providerIds, PINNED_GITHUB_LOGIN } from "./integrations.js";
import {
  CAPABILITIES as LI_CAPABILITIES,
  getProfile as liProfile,
  createPost as liCreatePost,
  deletePost as liDeletePost,
  jobSearchUrl as liJobSearchUrl,
  profileDrift as liProfileDrift,
  draftFromPost as liDraftFromPost,
  assertPostable as liAssertPostable,
  postUrl as liPostUrl,
  MAX_POST_CHARS as LI_MAX,
} from "./linkedin.js";
import {
  slugify,
  SLUG_RE,
  readingMinutes,
  excerptFrom,
  outlineOf,
  findSection,
  stripLeadingCover,
} from "./postText.js";

const nowISO = () => new Date().toISOString();
const str = { type: "string" };

// Shared by every task tool. Defaulted rather than required: the overwhelming
// majority of calls mean Google, and making a model name the provider on every
// call is friction that buys nothing.
const provider = {
  type: "string",
  enum: ["google", "microsoft"],
  description: "Which task account to act on. Defaults to google.",
};

// Every GitHub tool takes an optional owner and defaults to the connected
// account, so ordinary use never has to name it.
const ownerArg = {
  type: "string",
  description: "Defaults to the connected account",
};

// One place resolves the GitHub credential and whose account it is. The handle
// is read from the stored connection rather than fetched, so the common tools
// cost one API call instead of two.
// LinkedIn needs the person URN on every post, and it only comes from the
// profile call, so one place does both.
async function linkedinCtx(idToken) {
  const token = await accessTokenFor(idToken, "linkedin");
  const profile = await liProfile(token);
  return { token, profile };
}

// Posts cannot be read back from LinkedIn (r_member_social is restricted), so
// what this app wrote is the only history there is. Admin-only, like every
// other private collection.
const LINKEDIN_POSTS = "linkedinPosts";

async function githubCtx(idToken) {
  const token = await accessTokenFor(idToken, "github");
  const conn = await readConnection(idToken, "github").catch(() => null);
  return { token, owner: conn?.email || PINNED_GITHUB_LOGIN };
}
const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://ravikishan.me";


/* ---------- images ---------- */

const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

// Fetching a URL the model chose is a server-side request with the site's own
// network position, so it is confined to public https. Without this, a link
// picked up from a web page could be used to probe the deployment's private
// network.
function assertFetchableImageUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch (_) {
    throw new Error("sourceUrl is not a URL.");
  }
  if (u.protocol !== "https:") throw new Error("sourceUrl must be https.");
  const host = u.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith(".internal") ||
    host.endsWith(".local");
  if (blocked) throw new Error("sourceUrl must point at a public host.");
  return u;
}

// Bytes are handed to Backblaze exactly as received — nothing here resizes or
// re-encodes an image, so what is uploaded is what readers get.
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

// Base64 has to travel in the JSON-RPC body, and /api/mcp caps that. Keep the
// advertised number below the cap rather than letting the body parser reject
// the request before the tool can say anything useful.
const MAX_BASE64_IMAGE_BYTES = 3 * 1024 * 1024;

async function imageBytesFrom(args) {
  if (args.sourceUrl) {
    const u = assertFetchableImageUrl(args.sourceUrl);
    const res = await fetch(u, { redirect: "follow" });
    if (!res.ok) throw new Error(`Could not fetch sourceUrl (HTTP ${res.status}).`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) throw new Error("sourceUrl returned no bytes.");
    if (bytes.length > MAX_IMAGE_BYTES)
      throw new Error(`That image is ${Math.round(bytes.length / 1048576)} MB; the limit is 25 MB.`);
    const declared = String(res.headers.get("content-type") || "").split(";")[0].trim();
    return { bytes, declared, from: u.href };
  }

  if (!args.contentBase64) throw new Error("Pass either sourceUrl or contentBase64.");
  const bytes = Buffer.from(args.contentBase64, "base64");
  if (!bytes.length) throw new Error("contentBase64 decoded to nothing.");
  if (bytes.length > MAX_BASE64_IMAGE_BYTES)
    throw new Error(
      `That is ${Math.round(bytes.length / 1024)} KB of image. Inline base64 is capped at ` +
        `${MAX_BASE64_IMAGE_BYTES / 1048576} MB because it has to fit in the request body. ` +
        `For anything larger, put the file somewhere public and pass sourceUrl instead — ` +
        `that path fetches it server-side and has a 25 MB limit.`
    );
  return { bytes, declared: "", from: "inline" };
}

// The extension decides the stored content type, so it has to agree with what
// the bytes actually are; a .png that is really HTML must not be stored.
function imageTypeFor(filename, declared) {
  const ext = String(filename || "").split(".").pop().toLowerCase();
  const type = IMAGE_TYPES[ext];
  if (!type) throw new Error(`Unsupported image type: .${ext}`);
  if (declared && !declared.startsWith("image/"))
    throw new Error(`sourceUrl served ${declared}, which is not an image.`);
  return type;
}

async function storeImage({ bytes, type, key }) {
  assertMediaKey(key);
  const put = await fetch(presign({ method: "PUT", key, expiresIn: 300 }), {
    method: "PUT",
    body: bytes,
    headers: { "Content-Type": type },
  });
  if (!put.ok) throw new Error(`Storage rejected the upload (HTTP ${put.status}).`);
  return `${SITE}/api/media/${key.slice("media/".length)}`;
}

/* ---------- posts ---------- */

// Who is writing. The admin stamps `author` on every save; over MCP the only
// identity available is the ID token we are already calling Firestore with,
// so read the claim rather than leaving the field blank.
function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString());
    return payload?.email || "";
  } catch (_) {
    return "";
  }
}

const POST_VERSIONS_KEPT = 20;

// Site content snapshots itself before every edit; posts did not, so an AI
// asked to "tighten this up" could replace three thousand words with nothing
// and leave no way back. Every tool below that changes or removes a body
// takes one of these first and returns its id.
async function snapshotPost(idToken, slug, post, reason) {
  const id = `${slug}__${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    await patchDocument(idToken, `postVersions/${id}`, {
      slug,
      post,
      savedAt: nowISO(),
      note: reason || "before an MCP edit",
    });
    // Keep the history bounded; a long article is a large document and there
    // is no value in the fiftieth copy of it.
    const all = await listDocuments(idToken, "postVersions", { pageSize: 300 });
    const mine = all
      .filter((v) => v.slug === slug)
      .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
    for (const old of mine.slice(POST_VERSIONS_KEPT)) {
      await deleteDocument(idToken, `postVersions/${old.id}`);
    }
  } catch (_) {
    // A failed snapshot must not block the edit that was asked for.
  }
  return id;
}

// Every body-changing tool funnels through here so the snapshot, the reading
// time and the dev.to `editedHere` unlock can never be forgotten by one of
// them. Returns what the tool should hand back.
async function writeBody(idToken, slug, cur, body, reason, extra = {}) {
  const version = await snapshotPost(idToken, slug, cur, reason);
  const patch = {
    body,
    readingTime: readingMinutes(body),
    updatedAt: nowISO(),
    ...extra,
  };
  // An imported article, once edited here, may be pushed back to dev.to.
  if (cur.source === "devto") patch.editedHere = true;
  await patchDocument(idToken, `posts/${slug}`, patch);
  return {
    url: `/blog/${slug}`,
    words: body.split(/\s+/).filter(Boolean).length,
    readingTime: patch.readingTime,
    rollbackVersion: version,
  };
}

/* ---------- site content ---------- */

// Everything the Content tab edits lives in one document, `site/content`.
// These sections are addressable; the rest of the document (the résumé store
// and its variants) is owned by the résumé panel, which has to upload bytes
// and keep version history, so it is not editable field-by-field from here.
const CONTENT_SECTIONS = [
  "identity",
  "projects",
  "certificates",
  "experience",
  "education",
  "skills",
  "hobbies",
  "testimonials",
  "seo",
  "socials",
  "stats",
];

const RESERVED_SECTIONS = ["resume", "resumeVersions", "resumeByVariant"];

const assertSection = (name) => {
  if (RESERVED_SECTIONS.includes(name))
    throw new Error(
      `"${name}" is owned by the résumé store — it holds uploaded files and version history. Use the admin's Résumé panel.`
    );
  if (typeof name !== "string" || !/^[a-zA-Z][\w-]{0,40}$/.test(name))
    throw new Error("Section names are single identifiers, e.g. \"projects\".");
  return name;
};

// Mirror what the admin's Publish does: snapshot the currently-live content
// before overwriting it, so a bad edit made from an AI client is recoverable
// exactly the same way one made by hand is.
async function snapshotContent(idToken, content, reason) {
  const id = `v_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    await patchDocument(idToken, `siteDrafts/${id}`, {
      content,
      savedAt: nowISO(),
      note: reason || "before an MCP edit",
    });
  } catch (_) {
    // A failed snapshot must not block the edit the user asked for; it is a
    // safety net, and the audit log still records what happened.
  }
  return id;
}

// An item in a content array is identified by whichever of these it carries —
// the same keys the admin's row editor uses to title a row.
const IDENTITY_KEYS = ["id", "slug", "name", "title", "company", "label", "role", "cmd"];

const itemMatches = (item, needle) => {
  const q = String(needle).trim().toLowerCase();
  return IDENTITY_KEYS.some((k) => String(item?.[k] ?? "").trim().toLowerCase() === q);
};

const findItem = (list, needle) => {
  const i = list.findIndex((it) => itemMatches(it, needle));
  if (i < 0)
    throw new Error(
      `Nothing in that section matches "${needle}". Items are matched on ${IDENTITY_KEYS.join(", ")}.`
    );
  return i;
};

// A tool: { name, description, scope, inputSchema, handler(args, ctx) }
export const TOOLS = [
  {
    name: "get_profile",
    description:
      "Get the canonical professional identity: name, role, focus areas, location, current position, contact links, tagline and intro. This is the source of truth every surface copies from.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, { idToken }) => {
      const c = await getDocument(idToken, "site/content");
      return c?.identity || {};
    },
  },
  {
    name: "update_profile",
    description:
      "Update one or more fields of the canonical identity. Only the fields you pass are changed. Publishes immediately to the live site.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        role: str,
        location: str,
        now: { type: "string", description: "Current position, e.g. 'Agentic AI Engineer @ Zimyo'" },
        tagline: str,
        intro: str,
        email: str,
      },
    },
    handler: async (args, { idToken }) => {
      const c = await getDocument(idToken, "site/content");
      const identity = { ...(c?.identity || {}) };
      for (const [k, v] of Object.entries(args || {})) {
        if (typeof v === "string" && v.trim()) identity[k] = v.trim();
      }
      await patchDocument(idToken, "site/content", { identity });
      return { updated: Object.keys(args || {}), identity };
    },
  },
  {
    name: "get_metrics",
    description:
      "Live proof-point numbers: GitHub stars, original repo count, followers, and npm downloads. Refreshed nightly — use these rather than quoting a number from memory.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, { idToken }) => {
      const c = await getDocument(idToken, "site/content");
      return { github: c?.github || {}, resumeUpdated: c?.resume?.updated || null };
    },
  },
  {
    name: "get_resume",
    description:
      "Get the live résumé entry, all published variants (ai, backend, systems…) and the recent upload history.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, { idToken }) => {
      const c = await getDocument(idToken, "site/content");
      return {
        live: c?.resume || null,
        variants: c?.resumeByVariant || {},
        history: (c?.resumeVersions || []).slice(0, 10),
      };
    },
  },
  {
    name: "list_jobs",
    description:
      "List tracked job applications with company, role, stage, dates, the résumé variant sent, and the pasted job description.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        stage: { type: "string", description: "Filter by stage: saved, applied, screen, interview, offer, rejected, withdrawn" },
        openOnly: { type: "boolean", description: "Only applications still in play" },
      },
    },
    handler: async (args, { idToken }) => {
      const OPEN = new Set(["saved", "applied", "screen", "interview", "offer"]);
      let rows = await listDocuments(idToken, "jobs", { pageSize: 300 });
      if (args?.stage) rows = rows.filter((r) => r.stage === args.stage);
      if (args?.openOnly) rows = rows.filter((r) => OPEN.has(r.stage));
      rows.sort((a, b) => String(b.appliedAt || "").localeCompare(String(a.appliedAt || "")));
      return { count: rows.length, jobs: rows };
    },
  },
  {
    name: "create_job",
    description:
      "Track a new job application. Paste the full job description into jdText so it can be used for résumé tailoring later.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["company", "role"],
      properties: {
        company: str,
        role: str,
        url: str,
        location: str,
        salary: str,
        variant: { type: "string", description: "Résumé variant sent: default, ai, backend, systems, frontend" },
        stage: { type: "string", description: "Default: applied" },
        appliedAt: { type: "string", description: "YYYY-MM-DD" },
        nextFollowUp: { type: "string", description: "YYYY-MM-DD" },
        jdText: str,
        notes: str,
      },
    },
    handler: async (args, { idToken }) => {
      const doc = {
        company: String(args.company).trim(),
        role: String(args.role).trim(),
        url: args.url || "",
        location: args.location || "",
        salary: args.salary || "",
        variant: args.variant || "default",
        stage: args.stage || "applied",
        appliedAt: args.appliedAt || nowISO().slice(0, 10),
        nextFollowUp: args.nextFollowUp || "",
        jdText: args.jdText || "",
        notes: args.notes || "",
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      const created = await createDocument(idToken, "jobs", null, doc);
      return { id: created.id, ...doc };
    },
  },
  {
    name: "update_job",
    description: "Move an application to a new stage, set a follow-up date, or append notes.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: str,
        stage: str,
        nextFollowUp: str,
        notes: str,
      },
    },
    handler: async (args, { idToken }) => {
      const patch = { updatedAt: nowISO() };
      for (const k of ["stage", "nextFollowUp", "notes"]) {
        if (typeof args[k] === "string") patch[k] = args[k];
      }
      return patchDocument(idToken, `jobs/${args.id}`, patch);
    },
  },
  {
    name: "list_posts",
    description: "List blog posts written on ravikishan.me, published and draft.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { publishedOnly: { type: "boolean" } },
    },
    handler: async (args, { idToken }) => {
      let rows = await listDocuments(idToken, "posts", { pageSize: 200 });
      if (args?.publishedOnly) rows = rows.filter((r) => r.published);
      // Bodies can be long; summarise unless a single post is asked for.
      return {
        count: rows.length,
        posts: rows.map((r) => ({
          slug: r.id,
          title: r.title,
          published: !!r.published,
          publishedAt: r.publishedAt || null,
          tags: r.tags || [],
          readingTime: r.readingTime || null,
          excerpt: r.excerpt || "",
        })),
      };
    },
  },
  {
    name: "get_post",
    description: "Get one blog post including its full Markdown body.",
    scope: "read",
    inputSchema: { type: "object", required: ["slug"], properties: { slug: str } },
    handler: async (args, { idToken }) => getDocument(idToken, `posts/${args.slug}`),
  },
  {
    name: "create_post",
    description:
      "Create a blog post from Markdown. Saved as a draft unless publish is true. The slug becomes the URL at /blog/<slug> and cannot be changed later. This blog renders maths, mermaid diagrams and runnable p5/d3 sketches — call get_writing_guide before writing so the piece uses them, and survives being cross-posted to dev.to.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["title", "body"],
      properties: {
        title: str,
        body: { type: "string", description: "Markdown" },
        slug: { type: "string", description: "Derived from the title if omitted" },
        excerpt: str,
        cover: { type: "string", description: "Cover image URL, usually returned by upload_blog_image" },
        tags: { type: "array", items: { type: "string" } },
        publish: { type: "boolean", description: "Default false — save as a draft" },
      },
    },
    handler: async (args, { idToken }) => {
      const slug = slugify(args.slug || args.title);
      // The admin enforces the same rule. A one-character or empty slug used
      // to fall through to "untitled", which silently collides on the second
      // post that did it.
      if (!SLUG_RE.test(slug))
        throw new Error(
          `"${slug}" is not a usable address. It must be 2–60 characters of lowercase letters, numbers or dashes.`
        );
      const existing = await getDocument(idToken, `posts/${slug}`);
      if (existing) throw new Error(`/blog/${slug} already exists — choose another slug.`);

      const published = !!args.publish;
      const cover = args.cover || "";
      // A body that opens with the cover renders it twice — once above the
      // title, once as the first thing in the article.
      const { body, removed } = stripLeadingCover(args.body, cover);
      const doc = {
        title: args.title,
        slug,
        body,
        // Shared with the site and the admin, so an MCP-written post gets the
        // same clean excerpt: fenced code, images and link syntax stripped.
        excerpt: args.excerpt || excerptFrom(body),
        cover,
        tags: Array.isArray(args.tags) ? args.tags : [],
        readingTime: readingMinutes(body),
        published,
        publishedAt: published ? nowISO() : "",
        updatedAt: nowISO(),
        author: emailFromIdToken(idToken),
      };
      await createDocument(idToken, "posts", slug, doc);
      return {
        url: `/blog/${slug}`,
        ...doc,
        ...(removed
          ? {
              removedDuplicateCover:
                "The body opened with the cover image, which the page already renders above the title. That copy was dropped.",
            }
          : {}),
      };
    },
  },
  {
    name: "publish_post",
    description: "Publish or unpublish an existing post.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["slug", "published"],
      properties: { slug: str, published: { type: "boolean" } },
    },
    handler: async (args, { idToken }) => {
      const cur = await getDocument(idToken, `posts/${args.slug}`);
      if (!cur) throw new Error(`No post at /blog/${args.slug}.`);
      return patchDocument(idToken, `posts/${args.slug}`, {
        published: !!args.published,
        publishedAt: args.published ? cur.publishedAt || nowISO() : cur.publishedAt || "",
        updatedAt: nowISO(),
      });
    },
  },
  {
    name: "update_post",
    description:
      "Edit an existing post: title, body, excerpt, tags or cover. Only the fields you pass change. The slug cannot be changed - it is the URL. This blog renders maths, mermaid diagrams and runnable p5/d3 sketches — call get_writing_guide before writing so the piece uses them, and survives being cross-posted to dev.to.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: str,
        title: str,
        body: { type: "string", description: "Full Markdown, replaces the current body" },
        excerpt: str,
        cover: str,
        tags: { type: "array", items: { type: "string" } },
      },
    },
    handler: async (args, { idToken }) => {
      const cur = await getDocument(idToken, `posts/${args.slug}`);
      if (!cur) throw new Error(`No post at /blog/${args.slug}.`);
      const patch = { updatedAt: nowISO() };
      for (const k of ["title", "body", "excerpt", "cover"])
        if (typeof args[k] === "string") patch[k] = args[k];
      if (Array.isArray(args.tags)) patch.tags = args.tags;

      // Against whichever cover the post will have once this patch lands.
      let deduped = false;
      if (typeof patch.body === "string") {
        const cover = typeof patch.cover === "string" ? patch.cover : cur.cover;
        const out = stripLeadingCover(patch.body, cover);
        patch.body = out.body;
        deduped = out.removed;
        patch.readingTime = readingMinutes(patch.body);
      }
      if (cur.source === "devto") patch.editedHere = true;
      // Only a body change needs a way back; retitling is cheap to undo.
      const version = patch.body
        ? await snapshotPost(idToken, args.slug, cur, "before update_post")
        : null;
      await patchDocument(idToken, `posts/${args.slug}`, patch);
      return {
        url: `/blog/${args.slug}`,
        changed: Object.keys(patch),
        rollbackVersion: version,
        ...(deduped
          ? {
              removedDuplicateCover:
                "The body opened with the cover image, which the page already renders above the title. That copy was dropped.",
            }
          : {}),
      };
    },
  },
  {
    name: "delete_post",
    description: "Delete a post permanently. Anyone linking to its URL will get a 404.",
    scope: "write",
    inputSchema: { type: "object", required: ["slug"], properties: { slug: str } },
    handler: async (args, { idToken }) => {
      const cur = await getDocument(idToken, `posts/${args.slug}`);
      if (!cur) throw new Error(`No post at /blog/${args.slug}.`);
      const version = await snapshotPost(idToken, args.slug, cur, "before delete_post");
      await deleteDocument(idToken, `posts/${args.slug}`);
      return { deleted: `/blog/${args.slug}`, title: cur.title, rollbackVersion: version };
    },
  },
  {
    name: "upload_blog_image",
    description:
      "Put an image into the site's own storage and get back a permanent URL on ravikishan.me. Prefer sourceUrl — it fetches the file server-side, keeps the original at full resolution and allows 25 MB; inline base64 has to fit in the request body and is capped at 3 MB. Nothing is resized or re-encoded.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["filename"],
      properties: {
        filename: { type: "string", description: "e.g. diagram.png — the extension sets the stored type" },
        sourceUrl: {
          type: "string",
          description: "Public https URL to fetch the image from. Preferred for anything large.",
        },
        contentBase64: { type: "string", description: "Raw file bytes, base64. Only for small images." },
        alt: { type: "string", description: "Alt text, used when the image goes inline in the body" },
        cover: {
          type: "boolean",
          description:
            "True if this is the post's cover. A cover is NOT part of the body — pass the returned url as `cover` on create_post or update_post and do not also write it into the Markdown.",
        },
      },
    },
    handler: async (args) => {
      if (!isVaultConfigured()) throw new Error("Storage is not configured.");
      const { bytes, declared, from } = await imageBytesFrom(args);
      const type = imageTypeFor(args.filename, declared);

      const safe = String(args.filename).replace(/[^\w.-]+/g, "_").slice(-60);
      const url = await storeImage({
        bytes,
        type,
        key: `media/blog/${Date.now()}-${safe}`,
      });

      // The duplicate-cover bug lived here. This used to return `markdown`
      // even when cover:true, so a model was handed a cover URL and a ready
      // made inline image in the same payload and did both — the image then
      // rendered above the title AND again as the first thing in the article.
      // A cover response now carries no Markdown to paste.
      if (args.cover) {
        return {
          url,
          cover: true,
          bytes: bytes.length,
          source: from,
          usage:
            "Pass this url as `cover` on create_post or update_post. Do not put it in the body — " +
            "the reading page already renders the cover above the title, so adding it to the " +
            "Markdown shows the same image twice.",
        };
      }

      return {
        url,
        cover: false,
        bytes: bytes.length,
        source: from,
        markdown: `![${args.alt || ""}](${url})`,
        usage: "Insert `markdown` into the post body where the image belongs.",
      };
    },
  },
  {
    name: "import_devto_posts",
    description:
      "Pull every article from the connected dev.to account into this site. Imported articles keep dev.to as their canonical URL. Safe to re-run - it refreshes rather than duplicates.",
    scope: "write",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, { idToken }) => {
      if (!isDevtoConfigured()) throw new Error("dev.to is not configured.");
      const articles = await listMine();
      let written = 0;
      for (const a of articles) {
        const post = toPost(a);
        if (!post.slug) continue;
        await patchDocument(idToken, `posts/${post.slug}`, post);
        written++;
      }
      return { imported: written, of: articles.length };
    },
  },
  {
    name: "crosspost_to_devto",
    description:
      "Publish a post written here to dev.to, or update the copy already there. The dev.to article gets a canonical URL pointing back at this site.",
    scope: "write",
    inputSchema: { type: "object", required: ["slug"], properties: { slug: str } },
    handler: async (args, { idToken }) => {
      if (!isDevtoConfigured()) throw new Error("dev.to is not configured.");
      const post = await getDocument(idToken, `posts/${args.slug}`);
      if (!post) throw new Error(`No post at /blog/${args.slug}.`);
      if (post.source === "devto" && !post.editedHere)
        throw new Error(
          "This article came FROM dev.to, so dev.to is the original. Edit it here first."
        );
      // dev.to renders none of the rich blocks, so the body is converted on
      // the way out. Maths becomes dev.to's native katex tag here and now.
      // Images and video cannot be made server-side — rendering a diagram
      // needs a DOM and running a sketch needs a browser — so this reuses
      // whatever a previous cross-post from the admin rendered, and anything
      // missing travels as a line pointing at the original.
      const canonical = `${SITE}/blog/${args.slug}`;
      const portable = toPortableMarkdown(post.body || "", {
        assets: post.devtoAssets || {},
        canonicalUrl: canonical,
      });
      const out = await crossPost(
        { ...post, slug: args.slug, body: portable.markdown },
        "https://www.ravikishan.me"
      );
      await patchDocument(idToken, `posts/${args.slug}`, {
        devtoId: out.id,
        devtoUrl: out.url,
        crossPostedAt: nowISO(),
      });
      return {
        ...out,
        mathConverted: /\{% katex/.test(portable.markdown),
        imagesReused: portable.used.length,
        ...(portable.missing.length
          ? {
              linkedInsteadOfRendered: portable.missing,
              note:
                "These blocks have no rendered image yet and travelled as a link to the original. " +
                "Rendering one needs a browser: push from the admin's Writing tab once and the " +
                "images are cached on the post for every cross-post after that.",
            }
          : {}),
      };
    },
  },
  {
    name: "get_analytics",
    description:
      "First-party counters by day: visits, resume views, PDF downloads, link copies, contact submissions. Browser-counted, so indicative rather than exact.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number", description: "How many days back, default 30" } },
    },
    handler: async (args, { idToken }) => {
      const n = Math.min(120, Math.max(1, Number(args?.days) || 30));
      const rows = await listDocuments(idToken, "stats", { pageSize: 200 });
      const wanted = new Set();
      for (let i = 0; i < n; i++) {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - i);
        wanted.add(d.toISOString().slice(0, 10));
      }
      const days = rows.filter((r) => wanted.has(r.id)).sort((a, b) => a.id.localeCompare(b.id));
      const totals = {};
      for (const d of days)
        for (const [k, v] of Object.entries(d))
          if (typeof v === "number") totals[k] = (totals[k] || 0) + v;
      return { days: days.length, totals, series: days };
    },
  },
  {
    name: "get_audit_log",
    description: "Recent admin actions - what changed and when.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 30, max 100" } },
    },
    handler: async (args, { idToken }) => {
      const rows = await listDocuments(idToken, "auditLog", { pageSize: 300 });
      rows.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
      const n = Math.min(100, Math.max(1, Number(args?.limit) || 30));
      return {
        entries: rows.slice(0, n).map((r) => ({
          at: r.at, action: r.action, target: r.target, detail: r.detail,
        })),
      };
    },
  },
  {
    name: "update_short_link",
    description: "Retarget a short link, rename it, or enable/disable it.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: { slug: str, url: str, title: str, active: { type: "boolean" } },
    },
    handler: async (args, { idToken }) => {
      const cur = await getDocument(idToken, `links/${args.slug}`);
      if (!cur) throw new Error(`No short link at /l/${args.slug}.`);
      const patch = {};
      if (typeof args.url === "string") {
        if (!/^https?:\/\//i.test(args.url)) throw new Error("url must start with http(s)://");
        patch.url = args.url;
      }
      if (typeof args.title === "string") patch.title = args.title;
      if (typeof args.active === "boolean") patch.active = args.active;
      return patchDocument(idToken, `links/${args.slug}`, patch);
    },
  },
  {
    name: "delete_short_link",
    description: "Delete a short link. Anyone who saved the URL will get a not-found page.",
    scope: "write",
    inputSchema: { type: "object", required: ["slug"], properties: { slug: str } },
    handler: async (args, { idToken }) => {
      await deleteDocument(idToken, `links/${args.slug}`);
      return { deleted: `/l/${args.slug}` };
    },
  },
  {
    name: "list_short_links",
    description: "List ravikishan.me/l/<slug> short links with their click counts.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, { idToken }) => {
      const rows = await listDocuments(idToken, "links", { pageSize: 200 });
      rows.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
      return { count: rows.length, links: rows };
    },
  },
  {
    name: "create_short_link",
    description: "Create a short link at ravikishan.me/l/<slug>.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["slug", "url"],
      properties: { slug: str, url: str, title: str },
    },
    handler: async (args, { idToken }) => {
      const slug = String(args.slug).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) throw new Error("Invalid slug.");
      if (!/^https?:\/\//i.test(args.url)) throw new Error("url must start with http:// or https://");
      const existing = await getDocument(idToken, `links/${slug}`);
      if (existing) throw new Error(`/l/${slug} already exists.`);
      const doc = {
        url: args.url,
        title: args.title || "",
        clicks: 0,
        active: true,
        createdAt: nowISO(),
      };
      await createDocument(idToken, "links", slug, doc);
      return { shortUrl: `https://ravikishan.me/l/${slug}`, ...doc };
    },
  },
  {
    name: "list_gallery",
    description:
      "List the photo wall: title, category, caption and public URL, in display order.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, { idToken }) => {
      const rows = await listDocuments(idToken, "gallery", { pageSize: 300 });
      rows.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
      return {
        count: rows.length,
        photos: rows.map((r) => ({
          id: r.id,
          title: r.title,
          category: r.category,
          note: r.note,
          url: r.url,
          order: r.order,
        })),
      };
    },
  },
  {
    name: "update_gallery_photo",
    description: "Retitle, recategorise, recaption or reorder one gallery photo.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: str,
        title: str,
        category: str,
        note: str,
        order: { type: "number" },
      },
    },
    handler: async (args, { idToken }) => {
      const cur = await getDocument(idToken, `gallery/${args.id}`);
      if (!cur) throw new Error("No such gallery photo.");
      const patch = {};
      for (const k of ["title", "category", "note"])
        if (typeof args[k] === "string") patch[k] = args[k];
      if (typeof args.order === "number") patch.order = args.order;
      return patchDocument(idToken, `gallery/${args.id}`, patch);
    },
  },
  {
    name: "list_vault_documents",
    description:
      "List private vault documents — filename, category, tags, issue and expiry dates. Returns metadata only, never file contents.",
    scope: "vault",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "identity, income, employment, education, certificate, other" },
        expiringWithinDays: { type: "number" },
      },
    },
    handler: async (args, { idToken }) => {
      let rows = await listDocuments(idToken, "vault", { pageSize: 300 });
      if (args?.category) rows = rows.filter((r) => r.category === args.category);
      if (typeof args?.expiringWithinDays === "number") {
        const limit = Date.now() + args.expiringWithinDays * 86400000;
        rows = rows.filter((r) => r.expiresAt && Date.parse(r.expiresAt) <= limit);
      }
      return {
        count: rows.length,
        documents: rows.map((r) => ({
          id: r.id,
          filename: r.filename,
          category: r.category,
          tags: r.tags || [],
          size: r.size,
          encrypted: !!r.encrypted,
          issuedAt: r.issuedAt || null,
          expiresAt: r.expiresAt || null,
          note: r.note || "",
        })),
      };
    },
  },
  {
    name: "get_vault_download_url",
    description:
      "Mint a short-lived (5 minute) download URL for one vault document. Encrypted documents come back as ciphertext — they can only be opened in the admin UI with the passphrase.",
    scope: "vault",
    inputSchema: { type: "object", required: ["id"], properties: { id: str } },
    handler: async (args, { idToken }) => {
      if (!isVaultConfigured()) throw new Error("Vault storage is not configured on this deployment.");
      const d = await getDocument(idToken, `vault/${args.id}`);
      if (!d) throw new Error("No such vault document.");
      assertVaultKey(d.key);
      return {
        filename: d.filename,
        encrypted: !!d.encrypted,
        expiresInSeconds: 300,
        url: presign({ method: "GET", key: d.key, expiresIn: 300 }),
        note: d.encrypted
          ? "This file is AES-GCM encrypted in the browser. The bytes at this URL are ciphertext."
          : undefined,
      };
    },
  },
  {
    name: "search_contacts",
    description:
      "Search the imported LinkedIn network by name, company or role. Returns at most 50 people.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { query: str, company: str },
    },
    handler: async (args, { idToken }) => {
      const rows = await listDocuments(idToken, "contacts", { pageSize: 300 });
      const q = String(args?.query || "").toLowerCase();
      const co = String(args?.company || "").toLowerCase();
      const hits = rows.filter((r) => {
        if (co && !String(r.company || "").toLowerCase().includes(co)) return false;
        if (!q) return true;
        return [r.name, r.company, r.position].filter(Boolean).join(" ").toLowerCase().includes(q);
      });
      return {
        matched: hits.length,
        returned: Math.min(50, hits.length),
        contacts: hits.slice(0, 50).map((r) => ({
          name: r.name,
          company: r.company,
          position: r.position,
          url: r.url,
          connectedOn: r.connectedOn,
        })),
      };
    },
  },
  {
    name: "list_content_sections",
    description:
      "List the editable sections of the site's content document — projects, certificates, experience and the rest — with how many items each holds. Start here before editing content.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, { idToken }) => {
      const c = (await getDocument(idToken, "site/content")) || {};
      const sections = Object.keys(c)
        .filter((k) => !RESERVED_SECTIONS.includes(k))
        .map((k) => ({
          section: k,
          kind: Array.isArray(c[k]) ? "list" : typeof c[k] === "object" && c[k] ? "record" : "value",
          items: Array.isArray(c[k]) ? c[k].length : undefined,
        }));
      return { sections, known: CONTENT_SECTIONS };
    },
  },
  {
    name: "get_content_section",
    description:
      "Read one section of the site content in full, e.g. every project or every certificate.",
    scope: "read",
    inputSchema: { type: "object", required: ["section"], properties: { section: str } },
    handler: async (args, { idToken }) => {
      const section = assertSection(args.section);
      const c = (await getDocument(idToken, "site/content")) || {};
      if (!(section in c)) throw new Error(`No section called "${section}".`);
      return { section, value: c[section] };
    },
  },
  {
    name: "add_content_item",
    description:
      "Append an item to a list section — a project, a certificate, a job. Pass the item as an object with the same shape as its siblings; read the section first to see that shape.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["section", "item"],
      properties: {
        section: str,
        item: { type: "object", description: "The new item" },
        position: { type: "number", description: "Insert at this index instead of appending" },
      },
    },
    handler: async (args, { idToken }) => {
      const section = assertSection(args.section);
      const c = (await getDocument(idToken, "site/content")) || {};
      const list = Array.isArray(c[section]) ? [...c[section]] : [];
      const at = Number.isInteger(args.position)
        ? Math.max(0, Math.min(list.length, args.position))
        : list.length;
      list.splice(at, 0, args.item || {});
      const version = await snapshotContent(idToken, c, `before adding to ${section}`);
      await patchDocument(idToken, "site/content", { [section]: list });
      return { section, added: args.item, at, count: list.length, rollbackVersion: version };
    },
  },
  {
    name: "update_content_item",
    description:
      "Change fields on one item in a list section. Identify the item by its name, title, slug or id; only the fields you pass are touched.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["section", "match", "fields"],
      properties: {
        section: str,
        match: { type: "string", description: "The item's name, title, slug or id" },
        fields: { type: "object", description: "Fields to merge into the item" },
      },
    },
    handler: async (args, { idToken }) => {
      const section = assertSection(args.section);
      const c = (await getDocument(idToken, "site/content")) || {};
      if (!Array.isArray(c[section])) throw new Error(`"${section}" is not a list section.`);
      const list = [...c[section]];
      const i = findItem(list, args.match);
      list[i] = { ...list[i], ...(args.fields || {}) };
      const version = await snapshotContent(idToken, c, `before editing ${section}`);
      await patchDocument(idToken, "site/content", { [section]: list });
      return { section, at: i, item: list[i], rollbackVersion: version };
    },
  },
  {
    name: "delete_content_item",
    description: "Remove one item from a list section. Identify it by name, title, slug or id.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["section", "match"],
      properties: { section: str, match: str },
    },
    handler: async (args, { idToken }) => {
      const section = assertSection(args.section);
      const c = (await getDocument(idToken, "site/content")) || {};
      if (!Array.isArray(c[section])) throw new Error(`"${section}" is not a list section.`);
      const list = [...c[section]];
      const i = findItem(list, args.match);
      const [gone] = list.splice(i, 1);
      const version = await snapshotContent(idToken, c, `before deleting from ${section}`);
      await patchDocument(idToken, "site/content", { [section]: list });
      return { section, removed: gone, count: list.length, rollbackVersion: version };
    },
  },
  {
    name: "set_content_section",
    description:
      "Replace a whole section at once. Use this for the record-shaped sections a per-item edit cannot reach, such as the per-path SEO overrides. The live content is snapshotted first.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["section", "value"],
      properties: {
        section: str,
        value: { description: "The replacement value — a list or an object" },
      },
    },
    handler: async (args, { idToken }) => {
      const section = assertSection(args.section);
      const c = (await getDocument(idToken, "site/content")) || {};
      const version = await snapshotContent(idToken, c, `before replacing ${section}`);
      await patchDocument(idToken, "site/content", { [section]: args.value });
      return { section, replaced: true, rollbackVersion: version };
    },
  },
  {
    name: "list_content_versions",
    description:
      "List the snapshots of the site content, newest first. Every publish and every content edit made here takes one, so a bad change can be undone.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, { idToken }) => {
      const rows = await listDocuments(idToken, "siteDrafts", { pageSize: 60 });
      const versions = rows
        .filter((r) => r.id !== "draft")
        .map((r) => ({ id: r.id, savedAt: r.savedAt, note: r.note || "" }))
        .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
      return { count: versions.length, versions };
    },
  },
  {
    name: "restore_content_version",
    description:
      "Roll the whole site content back to a snapshot. The content being replaced is snapshotted first, so a rollback is itself reversible.",
    scope: "write",
    inputSchema: { type: "object", required: ["id"], properties: { id: str } },
    handler: async (args, { idToken }) => {
      const snap = await getDocument(idToken, `siteDrafts/${args.id}`);
      if (!snap?.content) throw new Error(`No snapshot called "${args.id}".`);
      const current = (await getDocument(idToken, "site/content")) || {};
      const version = await snapshotContent(idToken, current, `before restoring ${args.id}`);
      await patchDocument(idToken, "site/content", snap.content);
      return { restored: args.id, rollbackVersion: version };
    },
  },

  /* ---------- jobs ---------- */
  {
    name: "delete_job",
    description: "Remove an application from the job tracker.",
    scope: "write",
    inputSchema: { type: "object", required: ["id"], properties: { id: str } },
    handler: async (args, { idToken }) => {
      await deleteDocument(idToken, `jobs/${args.id}`);
      return { deleted: args.id };
    },
  },

  /* ---------- gallery ---------- */
  {
    name: "upload_gallery_photo",
    description:
      "Add a photo to the site's photo wall. Prefer sourceUrl (fetched server-side, 25 MB, full resolution) over inline base64 (3 MB). It goes to the same storage as blog images and appears on the site straight away.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["filename"],
      properties: {
        filename: str,
        sourceUrl: {
          type: "string",
          description: "Public https URL to fetch the image from. Preferred — keeps the original at full size.",
        },
        contentBase64: { type: "string", description: "Raw file bytes, base64. Small images only." },
        title: str,
        category: str,
        note: { type: "string", description: "Caption shown in the lightbox" },
        order: { type: "number", description: "Display position; defaults to the end of the wall" },
      },
    },
    handler: async (args, { idToken }) => {
      if (!isVaultConfigured()) throw new Error("Storage is not configured.");
      const { bytes, declared } = await imageBytesFrom(args);
      const type = imageTypeFor(args.filename, declared);

      const safe = String(args.filename).replace(/[^\w.-]+/g, "_").slice(-60);
      const key = `media/gallery/${Date.now()}-${safe}`;
      const url = await storeImage({ bytes, type, key });

      const existing = await listDocuments(idToken, "gallery", { pageSize: 300 });
      const order = Number.isFinite(args.order)
        ? args.order
        : existing.reduce((m, r) => Math.max(m, r.order ?? 0), 0) + 1;

      const id = key.replace(/[^\w.-]+/g, "_");
      const record = {
        key,
        url,
        title: args.title || safe.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
        category: args.category || "Other",
        note: args.note || "",
        order,
        uploadedAt: nowISO(),
        uploadedBy: "mcp",
      };
      await patchDocument(idToken, `gallery/${id}`, record);
      return { id, ...record, bytes: bytes.length };
    },
  },
  {
    name: "delete_gallery_photo",
    description:
      "Remove a photo from the wall. The image file is deleted from storage too, so nothing is orphaned.",
    scope: "write",
    inputSchema: { type: "object", required: ["id"], properties: { id: str } },
    handler: async (args, { idToken }) => {
      const row = await getDocument(idToken, `gallery/${args.id}`);
      if (!row) throw new Error("No such gallery photo.");
      await deleteDocument(idToken, `gallery/${args.id}`);
      // Row first, then bytes: a failed object delete leaves an orphan the
      // Assets tab surfaces, which beats a row pointing at nothing.
      let fileDeleted = false;
      if (row.key && isVaultConfigured()) {
        assertMediaKey(row.key);
        const res = await fetch(presign({ method: "DELETE", key: row.key, expiresIn: 120 }), {
          method: "DELETE",
        });
        fileDeleted = res.ok;
      }
      return { deleted: args.id, title: row.title || "", fileDeleted };
    },
  },

  /* ---------- object storage ---------- */
  {
    name: "list_assets",
    description:
      "List what is actually in object storage under the prefixes this site owns — blog and gallery media, vault objects, résumé PDFs — with size and date.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        prefix: { type: "string", description: `One of ${PREFIXES.join(", ")}; omit for all three` },
      },
    },
    handler: async (args) => {
      if (!isVaultConfigured()) throw new Error("Storage is not configured.");
      const wanted = args.prefix ? [args.prefix] : PREFIXES;
      for (const pre of wanted)
        if (!PREFIXES.includes(pre)) throw new Error(`Unknown prefix "${pre}".`);
      const objects = [];
      for (const pre of wanted) objects.push(...(await listPrefix(pre)));
      objects.sort((a, b) => String(b.lastModified).localeCompare(String(a.lastModified)));
      return {
        count: objects.length,
        bytes: objects.reduce((n, o) => n + o.size, 0),
        objects: objects.slice(0, 500),
      };
    },
  },
  {
    name: "delete_asset",
    description:
      "Delete one stored file. Limited to media/ — blog and gallery images. Vault documents and résumé PDFs are refused here: deleting either from an AI client is not recoverable and the admin has a confirmation step for exactly that reason.",
    scope: "write",
    inputSchema: { type: "object", required: ["key"], properties: { key: str } },
    handler: async (args) => {
      if (!isVaultConfigured()) throw new Error("Storage is not configured.");
      if (!inOwnedPrefix(args.key)) throw new Error("That key is not one this site owns.");
      if (!args.key.startsWith("media/"))
        throw new Error(
          "Only media/ objects can be deleted here. Use the admin's Assets tab for vault or résumé files."
        );
      assertMediaKey(args.key);
      const res = await fetch(presign({ method: "DELETE", key: args.key, expiresIn: 120 }), {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404)
        throw new Error(`Storage refused the delete (HTTP ${res.status}).`);
      return { deleted: args.key };
    },
  },

  /* ---------- inbox ---------- */
  {
    name: "list_messages",
    description:
      "Read the inbox: messages from the contact form, direct mail and the lobby chat, newest first, with whether each has been answered.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        box: { type: "string", description: "mail, contact or chat; omit for all three" },
        unansweredOnly: { type: "boolean" },
      },
    },
    handler: async (args, { idToken }) => {
      const boxes = { mail: "mail", contact: "myportifilio", chat: "chat" };
      const wanted = args.box ? [args.box] : Object.keys(boxes);
      const out = [];
      for (const box of wanted) {
        const coll = boxes[box];
        if (!coll) throw new Error(`Unknown box "${box}". Use mail, contact or chat.`);
        const rows = await listDocuments(idToken, coll, { pageSize: 100 });
        for (const r of rows) {
          if (args.unansweredOnly && r.repliedAt) continue;
          out.push({
            box,
            id: r.id,
            from: r.name || r.from || r.email || "",
            email: r.email || "",
            subject: r.subject || "",
            message: String(r.message || r.body || "").slice(0, 600),
            repliedAt: r.repliedAt || null,
          });
        }
      }
      return { count: out.length, messages: out.slice(0, 100) };
    },
  },
  {
    name: "mark_message_replied",
    description:
      "Stamp a message as answered. The message body itself is immutable — the rules only allow the answered marker and a private note to change.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["box", "id"],
      properties: { box: str, id: str, note: str },
    },
    handler: async (args, { idToken }) => {
      const boxes = { mail: "mail", contact: "myportifilio", chat: "chat" };
      const coll = boxes[args.box];
      if (!coll) throw new Error(`Unknown box "${args.box}". Use mail, contact or chat.`);
      const patch = { repliedAt: nowISO() };
      if (typeof args.note === "string") patch.replyNote = args.note;
      await patchDocument(idToken, `${coll}/${args.id}`, patch);
      return { box: args.box, id: args.id, ...patch };
    },
  },

  /* ---------- contacts ---------- */
  {
    name: "update_contact",
    description:
      "Correct a stored contact — their company, position or a private note. Identify them by the LinkedIn slug that is their record id.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: str, name: str, company: str, position: str, note: str },
    },
    handler: async (args, { idToken }) => {
      // Shape the patch before fetching: a call with nothing in it should be
      // refused on its own terms, not after a round-trip to Firestore.
      const patch = {};
      for (const k of ["name", "company", "position", "note"])
        if (typeof args[k] === "string") patch[k] = args[k];
      if (!Object.keys(patch).length)
        throw new Error("Nothing to change — pass at least one of name, company, position or note.");
      const cur = await getDocument(idToken, `contacts/${args.id}`);
      if (!cur) throw new Error("No such contact.");
      await patchDocument(idToken, `contacts/${args.id}`, patch);
      return { id: args.id, ...patch };
    },
  },
  {
    name: "delete_contact",
    description:
      "Remove one contact record from the private address book imported from LinkedIn. Identify them by the LinkedIn slug that is their record id.",
    scope: "write",
    inputSchema: { type: "object", required: ["id"], properties: { id: str } },
    handler: async (args, { idToken }) => {
      await deleteDocument(idToken, `contacts/${args.id}`);
      return { deleted: args.id };
    },
  },

  /* ---------- vault metadata ---------- */
  {
    name: "update_vault_document",
    description:
      "Edit a vault document's metadata — tags, note, issue and expiry dates. Metadata only: the encrypted bytes are never touched from here, and there is still no way to upload or delete a vault document over MCP.",
    scope: "vault",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: str,
        note: str,
        issuedAt: { type: "string", description: "YYYY-MM-DD" },
        expiresAt: { type: "string", description: "YYYY-MM-DD" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
    handler: async (args, { idToken }) => {
      const patch = {};
      for (const k of ["note", "issuedAt", "expiresAt"])
        if (typeof args[k] === "string") patch[k] = args[k];
      if (Array.isArray(args.tags)) patch.tags = args.tags.map(String);
      if (!Object.keys(patch).length)
        throw new Error("Nothing to change — pass a note, tags, or an issue or expiry date.");
      const cur = await getDocument(idToken, `vault/${args.id}`);
      if (!cur) throw new Error("No such vault document.");
      await patchDocument(idToken, `vault/${args.id}`, patch);
      return { id: args.id, filename: cur.filename, ...patch };
    },
  },

  /* ---------- résumé ---------- */
  {
    name: "list_resume_versions",
    description:
      "List the résumé files in the store — the default, every named variant, and the upload history. Uploading a new PDF is a browser job, so this is read-only.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, { idToken }) => {
      const c = (await getDocument(idToken, "site/content")) || {};
      const byVariant = c.resumeByVariant || {};
      return {
        current: c.resume || null,
        variants: Object.entries(byVariant).map(([variant, entry]) => ({
          variant,
          url: `${SITE}/resume?v=${variant}`,
          filename: entry?.filename,
          updated: entry?.updated,
        })),
        history: (c.resumeVersions || []).map((v) => ({
          filename: v.filename,
          uploadedAt: v.uploadedAt,
          variant: v.variant || "default",
        })),
      };
    },
  },
  /* ---------- post history ---------- */
  {
    name: "get_writing_guide",
    description:
      "What this blog can render, and what happens to each of those things when a post is cross-posted to dev.to. Read this BEFORE writing or editing a post — it is the difference between a piece that renders here and travels, and one that has to be rewritten by hand.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async () => ({
      renders: {
        maths:
          "Inline $E = mc^2$ and display $$...$$. A dollar must hug its content, so \"it cost $5 and $10\" stays money and dollars inside code are untouched.",
        mermaid:
          "A ```mermaid fence. Flowcharts, sequence, state, ER, gantt — whatever mermaid v12 parses. Themed to the site automatically; do not set colours in the diagram.",
        p5: "A ```p5 fence, global mode (define setup() and draw()). Add height=260 to the fence to size the frame. Runs in a sandboxed iframe.",
        d3: "A ```d3 fence. The container element is already in scope as `el`; d3 v7 is loaded. Add height=300 to size the frame.",
        code: "Ordinary fenced code highlights as usual — ```js, ```go, ```rust and the rest.",
      },
      crossPostingToDevto: {
        maths: "Travels losslessly — converted to dev.to's native {% katex %} tag. Costs nothing.",
        mermaid: "dev.to cannot render it. The diagram is rendered to a WebP on push and travels as an image, with a line back to the original.",
        p5: "Travels as a short WebM recorded from the running sketch, plus a line back to the interactive version.",
        d3: "Travels as a WebP of the finished chart, plus a line back.",
        rawHtml: "Never use raw HTML or <script> in a post body: dev.to strips both, and this site does not execute them either.",
        nothingIsStoredEarly:
          "Images and video are generated ONLY when a cross-post actually happens, from the admin. Writing a post with ten diagrams costs no storage until it is pushed.",
      },
      howToWriteWell: [
        "Prefer a diagram over a paragraph describing a diagram.",
        "A sketch should show something a still image cannot — motion, or a parameter changing.",
        "Give every image real alt text; audit_posts flags empty alt.",
        "Headings become the article's contents rail, so write them as a reader would scan them.",
        "Link to earlier pieces with search_posts rather than guessing a slug.",
      ],
    }),
  },
  /* ---------- Tasks: Google Tasks and Microsoft To Do ---------- */
  //
  // One set of tools over both services. Every one takes `provider`, so a
  // model never has to pick between two parallel families of tool names, and
  // the two places the services genuinely differ -- nested subtasks, and
  // whether a move keeps the task's id -- are reported in the result rather
  // than left to be discovered.
  {
    name: "list_task_providers",
    description:
      "Which task accounts are connected (Google Tasks, Microsoft To Do), as which address, and what each one can do. Call this first if a task tool reports a connection problem: it says whether the account is unconnected, unconfigured on this deployment, or rejected.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, { idToken }) => {
      const providers = await Promise.all(
        providerIds().map(async (id) => {
          const status = await connectionStatus(idToken, id).catch((e) => ({
            provider: id,
            connected: false,
            detail: e?.message || "This account could not be checked.",
          }));
          return { ...status, capabilities: adapterFor(id).can };
        })
      );
      return {
        default: DEFAULT_PROVIDER,
        usable: providers.filter((p) => p.connected).map((p) => p.provider),
        providers,
      };
    },
  },
  {
    name: "list_task_groups",
    description:
      "List the task groups (lists) in an account, with how many tasks are open in each. Start here: every other task tool needs a groupId, and a groupId is only valid within its own provider.",
    scope: "read",
    inputSchema: { type: "object", properties: { provider } },
    handler: async (args, { idToken }) => {
      const { api, token } = await boardFor(idToken, args.provider);
      const groups = await api.listGroups(token);
      const withCounts = await Promise.all(
        groups.map(async (g) => ({
          ...g,
          open: (await api.listTasks(token, g.id)).filter((t) => !t.completed && !t.isStep).length,
        }))
      );
      return { provider: api.id, count: withCounts.length, groups: withCounts };
    },
  },
  {
    name: "create_task_group",
    description:
      "Create a new task group (a list) in the chosen account. The new group comes back with the id every other task tool needs.",
    scope: "write",
    inputSchema: { type: "object", required: ["title"], properties: { title: str, provider } },
    handler: async (args, { idToken }) => {
      const { api, token } = await boardFor(idToken, args.provider);
      const g = await api.createGroup(token, String(args.title).trim());
      return { provider: api.id, ...g };
    },
  },
  {
    name: "rename_task_group",
    description:
      "Rename a task group. The group keeps its id, so every task in it is untouched. Microsoft's built-in lists (Tasks, Flagged, Planned) cannot be renamed.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["groupId", "title"],
      properties: { groupId: str, title: str, provider },
    },
    handler: async (args, { idToken }) => {
      const { api, token } = await boardFor(idToken, args.provider);
      const g = await api.renameGroup(token, args.groupId, String(args.title).trim());
      return { provider: api.id, ...g };
    },
  },
  {
    name: "delete_task_group",
    description:
      "Delete a task group AND every task inside it. Neither service has an undo, so the tool refuses unless confirm is true and first reports what would be lost.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["groupId"],
      properties: {
        groupId: str,
        confirm: { type: "boolean", description: "Must be true; without it the tool only reports" },
        provider,
      },
    },
    handler: async (args, { idToken }) => {
      const { api, token } = await boardFor(idToken, args.provider);
      const tasks = (await api.listTasks(token, args.groupId, { showCompleted: true })).filter(
        (t) => !t.isStep
      );
      if (!args.confirm) {
        return {
          provider: api.id,
          deleted: false,
          wouldDelete: tasks.length,
          titles: tasks.slice(0, 10).map((t) => t.title),
          note: "Nothing was deleted. Call again with confirm: true if that is really the intent.",
        };
      }
      await api.deleteGroup(token, args.groupId);
      return { provider: api.id, deleted: true, tasksDeleted: tasks.length };
    },
  },
  {
    name: "list_tasks",
    description:
      "List tasks. Give a groupId for one group, or omit it for every group in that provider. Returns titles, details, due dates, completion and subtask parentage. A Microsoft row with isStep:true is a step inside a task -- it has a title and a tick and nothing else.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "Omit to read every group" },
        includeCompleted: { type: "boolean" },
        provider,
      },
    },
    handler: async (args, { idToken }) => {
      const { api, token } = await boardFor(idToken, args.provider);
      const groups = args.groupId
        ? [{ id: args.groupId, title: args.groupId }]
        : await api.listGroups(token);

      const out = [];
      for (const g of groups) {
        const rows = await api.listTasks(token, g.id, { showCompleted: !!args.includeCompleted });
        for (const t of rows) out.push({ ...t, groupId: g.id, group: g.title });
      }
      return { provider: api.id, count: out.length, tasks: out };
    },
  },
  {
    name: "create_task",
    description:
      "Add a task to a group: title, details, a due date, and a parent task to nest it under. On Google a nested task is a real subtask; on Microsoft it becomes a step, which holds a title and a tick but not its own details or due date -- the tool says which it made.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["groupId", "title"],
      properties: {
        groupId: str,
        title: str,
        notes: { type: "string", description: "The details field" },
        due: { type: "string", description: "YYYY-MM-DD" },
        parent: { type: "string", description: "Task id to nest this under" },
        provider,
      },
    },
    handler: async (args, { idToken }) => {
      const api = adapterFor(args.provider);
      // Validated before reaching for a credential, so a malformed call fails
      // on its own terms instead of "reconnect the account".
      if (args.parent && !api.can.subtaskDetails && (args.notes || args.due)) {
        throw new Error(
          `${api.label} stores a subtask as a step, which cannot hold details or a due date. Create it as a task of its own, or drop those fields.`
        );
      }
      const { token } = await boardFor(idToken, args.provider);
      const t = await api.createTask(token, args.groupId, {
        title: String(args.title).trim(),
        notes: args.notes || "",
        due: args.due || "",
        parent: args.parent || "",
      });
      return { provider: api.id, groupId: args.groupId, ...t };
    },
  },
  {
    name: "update_task",
    description:
      "Change a task's title, details, due date, or completion. Only the fields you pass change. Clear a due date by passing an empty string.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["groupId", "taskId"],
      properties: {
        groupId: str,
        taskId: str,
        title: str,
        notes: str,
        due: { type: "string", description: "YYYY-MM-DD, or empty string to clear it" },
        completed: { type: "boolean" },
        provider,
      },
    },
    handler: async (args, { idToken }) => {
      const patch = {};
      if (typeof args.title === "string") patch.title = args.title.trim();
      if (typeof args.notes === "string") patch.notes = args.notes;
      if (typeof args.due === "string") patch.due = args.due;
      if (typeof args.completed === "boolean") patch.completed = args.completed;
      if (!Object.keys(patch).length)
        throw new Error("Nothing to change -- pass a title, notes, due or completed.");

      const { api, token } = await boardFor(idToken, args.provider);
      const t = await api.patchTask(token, args.groupId, args.taskId, patch);
      return { provider: api.id, ...t, changed: Object.keys(patch) };
    },
  },
  {
    name: "move_task",
    description:
      "Move a task to another group, to another task as a subtask, or to the OTHER account entirely with toProvider. Within Google the task keeps its id, details and subtasks. Microsoft Graph has no move operation and neither service can move to the other, so those cases recreate the task and delete the original -- the id CHANGES, and the result says so with idChanged and previousId.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["groupId", "taskId"],
      properties: {
        groupId: { type: "string", description: "The group the task is in now" },
        taskId: str,
        toGroupId: { type: "string", description: "The group to move it to" },
        parent: { type: "string", description: "Task id to nest it under (Google only)" },
        toProvider: {
          type: "string",
          enum: ["google", "microsoft"],
          description: "Move to the other account. Needs toGroupId, and the task is recreated there.",
        },
        provider,
      },
    },
    handler: async (args, { idToken }) => {
      if (!args.toGroupId && !args.parent)
        throw new Error("Give toGroupId, parent, or both -- otherwise nothing would move.");

      // Crossing services is a different operation from moving within one, and
      // it is destructive on the way out, so it is spelled separately rather
      // than hidden behind the same call shape.
      const here = adapterFor(args.provider).id;
      if (args.toProvider && adapterFor(args.toProvider).id !== here) {
        if (!args.toGroupId)
          throw new Error("Moving to the other account needs toGroupId — a group id in that account.");
        return moveAcrossProviders(idToken, {
          from: { provider: here, groupId: args.groupId },
          to: { provider: args.toProvider, groupId: args.toGroupId },
          taskId: args.taskId,
        });
      }

      const api = adapterFor(args.provider);
      if (args.parent && !api.can.nestedTasks)
        throw new Error(
          `${api.label} has no nested tasks, so a task cannot be re-parented. Move it to another list instead, or add it as a step with create_task.`
        );

      const { token } = await boardFor(idToken, args.provider);
      const t = await api.moveTask(token, args.groupId, args.taskId, {
        toListId: args.toGroupId,
        parent: args.parent,
      });
      return { provider: api.id, groupId: args.toGroupId || args.groupId, ...t };
    },
  },
  {
    name: "delete_task",
    description:
      "Delete one task permanently. Its subtasks or steps go with it, and neither service has an undo.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["groupId", "taskId"],
      properties: { groupId: str, taskId: str, provider },
    },
    handler: async (args, { idToken }) => {
      const { api, token } = await boardFor(idToken, args.provider);
      await api.deleteTask(token, args.groupId, args.taskId);
      return { provider: api.id, deleted: args.taskId, groupId: args.groupId };
    },
  },
  {
    name: "clear_completed_tasks",
    description:
      "Delete every completed task in a group. Reports the count first unless confirm is true.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["groupId"],
      properties: {
        groupId: str,
        confirm: { type: "boolean", description: "Must be true; without it the tool only reports" },
        provider,
      },
    },
    handler: async (args, { idToken }) => {
      const { api, token } = await boardFor(idToken, args.provider);
      const done = (await api.listTasks(token, args.groupId, { showCompleted: true })).filter(
        (t) => t.completed && !t.isStep
      );
      if (!args.confirm) {
        return {
          provider: api.id,
          cleared: false,
          wouldDelete: done.length,
          titles: done.slice(0, 10).map((t) => t.title),
          note: "Nothing was deleted. Call again with confirm: true.",
        };
      }
      const n = await api.clearCompleted(token, args.groupId);
      return { provider: api.id, cleared: true, deleted: n };
    },
  },

  /* ---------- GitHub ---------- */
  //
  // The repository IS the product on a profile like this one. A repo with no
  // description and no topics is invisible in GitHub search and reads as
  // abandoned next to the ones that have them, so these tools exist to curate,
  // not just to read: `audit_github_repos` is the one to start from.
  //
  // `owner` defaults to the connected account on every tool, so ordinary use
  // never has to name it.
  {
    name: "get_github_profile",
    description:
      "The connected GitHub account's profile: name, bio, blog link, company, location, follower counts and public repo count. Start here to see which account is connected.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, { idToken }) => {
      const { token } = await githubCtx(idToken);
      return ghViewer(token);
    },
  },
  {
    name: "update_github_profile",
    description:
      "Change the GitHub profile: name, bio, blog, company, location, twitter, hireable. Only the fields passed change. The bio is capped at 160 characters and the tool refuses a longer one rather than letting GitHub truncate it silently.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        name: str,
        bio: { type: "string", description: "160 characters maximum" },
        blog: str,
        company: str,
        location: str,
        twitter: str,
        hireable: { type: "boolean" },
      },
    },
    handler: async (args, { idToken }) => {
      const { token } = await githubCtx(idToken);
      return ghUpdateProfile(token, args);
    },
  },
  {
    name: "list_github_repos",
    description:
      "Every repository the account owns, with stars, topics, description, homepage, language and flags. Forks are excluded unless includeForks is true, because the profile's story is the original work.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        includeForks: { type: "boolean" },
        sort: { type: "string", enum: ["stars", "pushed", "name"], description: "Default stars" },
      },
    },
    handler: async (args, { idToken }) => {
      const { token, owner } = await githubCtx(idToken);
      const repos = await ghListRepos(token, { includeForks: !!args.includeForks });
      const sort = args.sort || "stars";
      repos.sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name)
          : sort === "pushed"
          ? String(b.pushedAt).localeCompare(String(a.pushedAt))
          : b.stars - a.stars
      );
      return {
        owner,
        count: repos.length,
        totalStars: repos.reduce((n, r) => n + r.stars, 0),
        repos,
      };
    },
  },
  {
    name: "get_github_repo",
    description: "One repository in full: description, homepage, topics, stars, default branch and flags.",
    scope: "read",
    inputSchema: {
      type: "object",
      required: ["repo"],
      properties: { repo: str, owner: ownerArg },
    },
    handler: async (args, { idToken }) => {
      const { token, owner } = await githubCtx(idToken);
      return ghGetRepo(token, args.owner || owner, args.repo);
    },
  },
  {
    name: "update_github_repo",
    description:
      "Change a repository's description, homepage, topics or flags. Topics REPLACE the existing set (they live on their own endpoint, not in the repository body) and are validated before sending: lowercase letters, digits and hyphens, 20 maximum. Renaming via `name` changes the URL — GitHub redirects the old one, but anything hardcoded elsewhere will not follow.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["repo"],
      properties: {
        repo: str,
        owner: ownerArg,
        description: { type: "string", description: "350 characters maximum" },
        homepage: str,
        topics: { type: "array", items: { type: "string" }, description: "Replaces all topics" },
        name: { type: "string", description: "Rename the repository — changes its URL" },
        archived: { type: "boolean" },
        hasIssues: { type: "boolean" },
        hasWiki: { type: "boolean" },
        defaultBranch: str,
      },
    },
    handler: async (args, { idToken }) => {
      const { token, owner } = await githubCtx(idToken);
      const { repo, owner: who, ...patch } = args;
      return ghUpdateRepo(token, who || owner, repo, patch);
    },
  },
  {
    name: "create_github_repo",
    description:
      "Create a repository. It is initialised with a first commit by default, because without one there is no default branch and every later file write fails on a branch that does not exist.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: str,
        description: str,
        homepage: str,
        private: { type: "boolean", description: "Default false" },
        autoInit: { type: "boolean", description: "Default true — creates the first commit" },
      },
    },
    handler: async (args, { idToken }) => {
      const { token } = await githubCtx(idToken);
      return ghCreateRepo(token, {
        name: String(args.name).trim(),
        description: args.description,
        homepage: args.homepage,
        private: !!args.private,
        autoInit: args.autoInit !== false,
      });
    },
  },
  {
    name: "get_github_readme",
    description:
      "A repository's README, decoded, with the blob sha needed to write it back. Whatever the file is actually called — README.md, README.rst, readme — GitHub resolves it.",
    scope: "read",
    inputSchema: {
      type: "object",
      required: ["repo"],
      properties: { repo: str, owner: ownerArg },
    },
    handler: async (args, { idToken }) => {
      const { token, owner } = await githubCtx(idToken);
      return ghGetReadme(token, args.owner || owner, args.repo);
    },
  },
  {
    name: "update_github_readme",
    description:
      "Replace a repository's README with a commit. Reads the current file first to get its sha, so an edit cannot silently overwrite a newer commit, and creates the README if there is not one yet. This writes to the default branch — it is a real commit, not a draft.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["repo", "content"],
      properties: {
        repo: str,
        owner: ownerArg,
        content: { type: "string", description: "The whole README, in Markdown" },
        message: { type: "string", description: "Commit message" },
      },
    },
    handler: async (args, { idToken }) => {
      const { token, owner } = await githubCtx(idToken);
      if (!String(args.content).trim()) {
        throw new Error("Refusing to commit an empty README. Pass the full replacement content.");
      }
      return ghWriteReadme(token, args.owner || owner, args.repo, args.content, {
        message: args.message,
      });
    },
  },
  {
    name: "get_github_file",
    description:
      "Any file in a repository, decoded, with its sha. Use this to read a workflow, a package.json or a docs page before changing it.",
    scope: "read",
    inputSchema: {
      type: "object",
      required: ["repo", "path"],
      properties: { repo: str, owner: ownerArg, path: str, ref: { type: "string", description: "Branch or commit" } },
    },
    handler: async (args, { idToken }) => {
      const { token, owner } = await githubCtx(idToken);
      return ghGetFile(token, args.owner || owner, args.repo, args.path, { ref: args.ref });
    },
  },
  {
    name: "update_github_file",
    description:
      "Create or replace a file in a repository, as a commit. Pass the sha from get_github_file to replace an existing file; omit it only when creating a new one — GitHub refuses rather than overwriting blindly, which is the behaviour you want.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["repo", "path", "content"],
      properties: {
        repo: str,
        owner: ownerArg,
        path: str,
        content: str,
        message: str,
        sha: { type: "string", description: "Required when replacing an existing file" },
        branch: str,
      },
    },
    handler: async (args, { idToken }) => {
      const { token, owner } = await githubCtx(idToken);
      return ghPutFile(token, args.owner || owner, args.repo, args.path, args.content, {
        message: args.message,
        sha: args.sha,
        branch: args.branch,
      });
    },
  },
  {
    name: "list_github_pinned",
    description:
      "The repositories pinned to the profile. READ ONLY, and not by choice: GitHub's API exposes pinned items through GraphQL but offers no mutation to change them, so re-pinning is done on the profile page by hand.",
    scope: "read",
    inputSchema: { type: "object", properties: { owner: ownerArg } },
    handler: async (args, { idToken }) => {
      const { token, owner } = await githubCtx(idToken);
      const pinned = await ghListPinned(token, args.owner || owner);
      return {
        count: pinned.length,
        pinned,
        note: "GitHub has no API for changing pinned repositories; set them on the profile page.",
      };
    },
  },
  {
    name: "audit_github_repos",
    description:
      "Which repositories are letting the profile down: no description, no topics, a description over GitHub's 350-character cap, a well-starred repo with no homepage link, and — when checkReadmes is on — a missing or thin README. Every rule is something GitHub search or a visitor actually reacts to. Start here before editing anything.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        checkReadmes: {
          type: "boolean",
          description: "Also fetch every README — one request per repo, so slower",
        },
        includeForks: { type: "boolean" },
      },
    },
    handler: async (args, { idToken }) => {
      const { token, owner } = await githubCtx(idToken);
      const repos = await ghListRepos(token, { includeForks: !!args.includeForks });

      const readmes = {};
      if (args.checkReadmes) {
        for (const r of repos) {
          try {
            readmes[r.name] = (await ghGetReadme(token, owner, r.name)).content;
          } catch (e) {
            // 404 means there is no README, which is the finding itself.
            readmes[r.name] = e.status === 404 ? null : undefined;
          }
        }
      }
      return { owner, reposChecked: repos.length, ...ghAuditRepos(repos, { readmes }) };
    },
  },

  /* ---------- LinkedIn ---------- */
  //
  // Read lib/server/linkedin.js before adding anything here. LinkedIn allows
  // far less than people assume, and the useful behaviour of these tools is
  // that they say so precisely rather than failing late:
  //
  //   posting            yes, fully
  //   basic profile      yes (name, email, person id)
  //   full profile       no  — partner-only
  //   profile WRITE      no  — does not exist at any tier
  //   job search         no  — partner-only, partnerships closed
  //   job apply          no  — does not exist at any tier
  //
  // `get_linkedin_capabilities` exists so a model asked to "update my LinkedIn
  // headline" finds out in one cheap call that it must hand the text back to a
  // human, instead of hunting for a tool that was never built.
  {
    name: "get_linkedin_capabilities",
    description:
      "What LinkedIn's API does and does not allow from here, and what to do instead for each thing it does not. Call this FIRST for any LinkedIn request that is not posting — profile edits, job search and job applications have no API at any tier, and this says so with the alternative, rather than letting you search for a tool that cannot exist.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async () => ({
      capabilities: LI_CAPABILITIES,
      maxPostChars: LI_MAX,
      dailyPostLimit: "150 member requests per day, resetting at midnight UTC",
    }),
  },
  {
    name: "get_linkedin_profile",
    description:
      "The connected LinkedIn account: name, email, person id and the author URN posts are made under. This is EVERYTHING the self-serve API exposes — headline, About, positions and skills are not readable without a partnership, so read those from the LinkedIn data export instead.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, { idToken }) => (await linkedinCtx(idToken)).profile,
  },
  {
    name: "create_linkedin_post",
    description:
      "Publish a post to the connected LinkedIn feed: text, optionally with a link preview. Capped at 3000 characters, and the tool refuses a longer one rather than letting LinkedIn truncate it. Use dryRun to see exactly what would be published without publishing it. Every post is recorded locally, because LinkedIn cannot be asked for them back.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "The post body, 3000 characters maximum" },
        linkUrl: { type: "string", description: "A URL to attach as a link preview" },
        linkTitle: str,
        linkDescription: str,
        visibility: {
          type: "string",
          enum: ["PUBLIC", "CONNECTIONS"],
          description: "Default PUBLIC",
        },
        dryRun: {
          type: "boolean",
          description: "Validate and return the post without publishing it",
        },
      },
    },
    handler: async (args, { idToken }) => {
      // Validated before reaching for a credential, so a too-long post fails on
      // its own terms rather than "reconnect the account".
      const text = liAssertPostable(args.text);
      if (args.dryRun) {
        return {
          published: false,
          dryRun: true,
          chars: text.length,
          text,
          link: args.linkUrl ? { url: args.linkUrl, title: args.linkTitle || "" } : null,
          visibility: args.visibility || "PUBLIC",
        };
      }

      const { token, profile } = await linkedinCtx(idToken);
      const out = await liCreatePost(token, {
        authorUrn: profile.authorUrn,
        text,
        link: args.linkUrl
          ? { url: args.linkUrl, title: args.linkTitle, description: args.linkDescription }
          : undefined,
        visibility: args.visibility,
      });

      // The local record IS the history; a failed write here must not look
      // like a failed post, because the post is already public.
      let recorded = true;
      try {
        await createDocument(idToken, LINKEDIN_POSTS, null, {
          urn: out.urn,
          url: out.url,
          text,
          linkUrl: args.linkUrl || "",
          visibility: args.visibility || "PUBLIC",
          postedAt: new Date().toISOString(),
          source: "mcp",
        });
      } catch (_) {
        recorded = false;
      }

      return {
        published: true,
        ...out,
        chars: text.length,
        ...(recorded ? {} : { warning: "The post went out but could not be recorded locally." }),
      };
    },
  },
  {
    name: "list_linkedin_posts",
    description:
      "The posts published through this app, newest first. NOT a read of your LinkedIn feed — r_member_social is restricted, so LinkedIn cannot be asked what you have posted. Anything posted directly on linkedin.com will not appear here.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 25" } },
    },
    handler: async (args, { idToken }) => {
      const rows = await listDocuments(idToken, LINKEDIN_POSTS, { pageSize: 200 });
      const posts = rows
        .map((r) => ({
          id: r.__name || r.id || "",
          urn: r.urn || "",
          url: r.url || liPostUrl(r.urn),
          text: r.text || "",
          postedAt: r.postedAt || "",
          source: r.source || "",
        }))
        .sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)))
        .slice(0, Math.max(1, Number(args.limit) || 25));
      return {
        count: posts.length,
        posts,
        note: "Posts made outside this app are not listed — LinkedIn has no self-serve API to read them back.",
      };
    },
  },
  {
    name: "delete_linkedin_post",
    description:
      "Delete a post from LinkedIn by its URN. Permanent, and LinkedIn has no undo. The local record is kept and marked deleted, so the history stays honest about what was published.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["urn"],
      properties: {
        urn: { type: "string", description: "The post URN, from list_linkedin_posts" },
        confirm: { type: "boolean", description: "Must be true" },
      },
    },
    handler: async (args, { idToken }) => {
      if (!args.confirm) {
        return {
          deleted: false,
          note: "Nothing was deleted. Call again with confirm: true — LinkedIn has no undo.",
        };
      }
      const { token } = await linkedinCtx(idToken);
      await liDeletePost(token, args.urn);
      return { deleted: true, urn: args.urn };
    },
  },
  {
    name: "draft_linkedin_post",
    description:
      "Turn a published blog post into a LinkedIn post: a lede from its excerpt, the canonical link and its tags as hashtags. Returns the draft WITHOUT publishing — pass it to create_linkedin_post when it reads right. This is the one piece of real automation here, because the writing already exists on the site.",
    scope: "read",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: { slug: { type: "string", description: "The blog post's slug" } },
    },
    handler: async (args, { idToken }) => {
      const post = await getDocument(idToken, `posts/${args.slug}`);
      if (!post) throw new Error(`No post "${args.slug}".`);
      if (!post.published) {
        throw new Error(
          `"${args.slug}" is still a draft. Publish it before linking to it from LinkedIn — the URL would 404 for everyone else.`
        );
      }
      const draft = liDraftFromPost({
        title: post.title,
        excerpt: post.excerpt,
        url: `https://ravikishan.me/blog/${args.slug}`,
        tags: post.tags || [],
      });
      return { slug: args.slug, ...draft };
    },
  },
  {
    name: "get_linkedin_drift",
    description:
      "What the site says your headline, About, location and website are, against whatever is known about the LinkedIn profile. Because LinkedIn exposes no profile read beyond name and email and NO write at all, most rows come back as 'unknown' and the output is text to paste into linkedin.com by hand — that is the real workflow, not a limitation being worked around.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        headline: { type: "string", description: "What LinkedIn currently shows, if you know it" },
        about: str,
        location: str,
        website: str,
      },
    },
    handler: async (args, { idToken }) => {
      const c = await getDocument(idToken, "site/content");
      const id = c?.identity || {};
      return liProfileDrift({
        site: {
          headline: id.role || id.tagline || "",
          about: id.intro || "",
          location: id.location || "",
          website: "https://ravikishan.me",
        },
        linkedin: {
          headline: args.headline || "",
          about: args.about || "",
          location: args.location || "",
          website: args.website || "",
        },
      });
    },
  },
  {
    name: "linkedin_job_search_url",
    description:
      "Build a LinkedIn job search URL from keywords, location, remote, recency and experience level. LinkedIn has NO self-serve job search API and NO application API at any tier, so this returns the search a human opens — then record what you actually applied to with create_job, which is what keeps the tracker true.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        keywords: str,
        location: str,
        remote: { type: "boolean" },
        postedWithinDays: { type: "number" },
        experience: {
          type: "string",
          enum: ["internship", "entry", "associate", "mid-senior", "director", "executive"],
        },
      },
    },
    handler: async (args) => ({
      url: liJobSearchUrl(args),
      note: LI_CAPABILITIES.searchJobs.why,
      next: "Open it, then use create_job to record anything you apply to.",
    }),
  },

  {
    name: "list_medium_posts",
    description:
      "Which published posts are already on Medium, and which are not. Medium stopped issuing API tokens on 1 Jan 2025, so nothing can be posted programmatically — each missing post comes back with an importUrl the author opens in a browser, which makes Medium fetch the page and set its canonical URL back to this site.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        missingOnly: { type: "boolean", description: "Only the posts that are not on Medium yet" },
      },
    },
    handler: async (_args, { idToken }) => {
      const [onMedium, rows] = await Promise.all([
        fetchMediumPosts(),
        listDocuments(idToken, "posts", { pageSize: 300 }),
      ]);
      const live = rows
        .filter((r) => r.published)
        .map((r) => ({
          slug: r.id,
          title: r.title,
          publishedAt: r.publishedAt,
          updatedAt: r.updatedAt,
        }));

      const state = mediumState(live, onMedium).map((m) => ({
        ...m,
        url: `${SITE}/blog/${m.slug}`,
        ...(m.state === "on-medium" ? {} : { importUrl: mediumImportUrl(`${SITE}/blog/${m.slug}`) }),
      }));

      const wanted = _args?.missingOnly ? state.filter((m) => m.state !== "on-medium") : state;
      return {
        mediumStories: onMedium.length,
        counts: {
          onMedium: state.filter((m) => m.state === "on-medium").length,
          notOnMedium: state.filter((m) => m.state === "not-on-medium").length,
          unknown: state.filter((m) => m.state === "unknown").length,
        },
        // Medium's feed carries only the most recent stories, so an older post
        // is "unknown" rather than missing — importing one of those blindly is
        // how a duplicate article appears.
        note:
          "state unknown means the post predates everything Medium's feed still lists; check on Medium before importing it.",
        posts: wanted,
      };
    },
  },

  {
    name: "list_post_versions",
    description:
      "List saved snapshots of a post, newest first. One is taken automatically before every edit or delete, so a rewrite that went wrong can be undone.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string", description: "Omit to list snapshots of every post" } },
    },
    handler: async (args, { idToken }) => {
      const rows = await listDocuments(idToken, "postVersions", { pageSize: 300 });
      const versions = rows
        .filter((v) => !args.slug || v.slug === args.slug)
        .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")))
        .map((v) => ({
          id: v.id,
          slug: v.slug,
          savedAt: v.savedAt,
          note: v.note || "",
          title: v.post?.title || "",
          words: String(v.post?.body || "").split(/\s+/).filter(Boolean).length,
        }));
      return { count: versions.length, versions };
    },
  },
  {
    name: "restore_post_version",
    description:
      "Put a post back to one of its snapshots. The version being replaced is snapshotted first, so a restore is itself reversible. Restoring a snapshot of a deleted post recreates it at its old address.",
    scope: "write",
    inputSchema: { type: "object", required: ["id"], properties: { id: str } },
    handler: async (args, { idToken }) => {
      const snap = await getDocument(idToken, `postVersions/${args.id}`);
      if (!snap?.post) throw new Error(`No snapshot called "${args.id}".`);
      const slug = snap.slug || snap.post.slug;
      if (!slug) throw new Error("That snapshot has no address to restore to.");
      const cur = await getDocument(idToken, `posts/${slug}`);
      const version = cur
        ? await snapshotPost(idToken, slug, cur, `before restoring ${args.id}`)
        : null;
      await patchDocument(idToken, `posts/${slug}`, { ...snap.post, updatedAt: nowISO() });
      return {
        restored: args.id,
        url: `/blog/${slug}`,
        recreated: !cur,
        rollbackVersion: version,
      };
    },
  },

  /* ---------- editing a post in place ---------- */
  {
    name: "get_post_outline",
    description:
      "List a post's headings with the word count under each. Read this before editing a long article — it tells you which section to change without pulling the whole body into context.",
    scope: "read",
    inputSchema: { type: "object", required: ["slug"], properties: { slug: str } },
    handler: async (args, { idToken }) => {
      const post = await getDocument(idToken, `posts/${args.slug}`);
      if (!post) throw new Error(`No post at /blog/${args.slug}.`);
      const outline = outlineOf(post.body).map((h) => ({
        heading: h.heading,
        level: h.level,
        words: h.text.split(/\s+/).filter(Boolean).length,
      }));
      return {
        slug: args.slug,
        title: post.title,
        words: String(post.body || "").split(/\s+/).filter(Boolean).length,
        sections: outline,
      };
    },
  },
  {
    name: "edit_post_section",
    description:
      "Rewrite the text under one heading, leaving the rest of the article untouched. Identify the section by its heading text; matching ignores case and punctuation. This is the cheap way to fix a long post — the alternative is resending the whole body. This blog renders maths, mermaid diagrams and runnable p5/d3 sketches — call get_writing_guide before writing so the piece uses them, and survives being cross-posted to dev.to.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["slug", "heading", "body"],
      properties: {
        slug: str,
        heading: { type: "string", description: "The heading text, without the #s" },
        body: { type: "string", description: "Markdown that replaces the section's content" },
        mode: {
          type: "string",
          description: "replace (default), append to the section, or prepend to it",
        },
      },
    },
    handler: async (args, { idToken }) => {
      // Validate the arguments before spending a round-trip on the lookup.
      const mode = args.mode || "replace";
      if (!["replace", "append", "prepend"].includes(mode))
        throw new Error('mode must be "replace", "append" or "prepend".');
      const cur = await getDocument(idToken, `posts/${args.slug}`);
      if (!cur) throw new Error(`No post at /blog/${args.slug}.`);

      const src = String(cur.body || "");
      const sec = findSection(src, args.heading);
      const was = sec.text;
      const next =
        mode === "append"
          ? `${was.replace(/\s+$/, "")}\n\n${args.body.trim()}\n`
          : mode === "prepend"
          ? `\n\n${args.body.trim()}\n${was.replace(/^\s+/, "\n")}`
          : `\n\n${args.body.trim()}\n\n`;

      const body = src.slice(0, sec.bodyStart) + next + src.slice(sec.end);
      const out = await writeBody(idToken, args.slug, cur, body, `before editing "${sec.heading}"`);
      return {
        ...out,
        section: sec.heading,
        mode,
        wordsBefore: was.split(/\s+/).filter(Boolean).length,
        wordsAfter: next.split(/\s+/).filter(Boolean).length,
      };
    },
  },
  {
    name: "replace_in_post",
    description:
      "Replace an exact string everywhere it appears in a post — a renamed function, a corrected figure, a stale link. Refuses if the text is not found, so a silent no-op is impossible.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["slug", "find", "replace"],
      properties: {
        slug: str,
        find: { type: "string", description: "Exact text to look for; not a regular expression" },
        replace: str,
        expectedCount: {
          type: "number",
          description: "Refuse unless it appears exactly this many times — use it when you mean to change one of several",
        },
      },
    },
    handler: async (args, { idToken }) => {
      if (!args.find) throw new Error("Give the text to find.");
      const cur = await getDocument(idToken, `posts/${args.slug}`);
      if (!cur) throw new Error(`No post at /blog/${args.slug}.`);
      const src = String(cur.body || "");
      const count = src.split(args.find).length - 1;
      if (count === 0) throw new Error(`"${args.find}" does not appear in this post.`);
      if (Number.isInteger(args.expectedCount) && count !== args.expectedCount)
        throw new Error(
          `"${args.find}" appears ${count} times, not ${args.expectedCount}. Nothing was changed.`
        );
      const body = src.split(args.find).join(args.replace);
      const out = await writeBody(
        idToken,
        args.slug,
        cur,
        body,
        `before replacing "${String(args.find).slice(0, 40)}"`
      );
      return { ...out, replacements: count };
    },
  },
  {
    name: "append_to_post",
    description:
      "Add Markdown to the end of a post — a closing section, an update note, a further-reading list.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["slug", "markdown"],
      properties: { slug: str, markdown: str },
    },
    handler: async (args, { idToken }) => {
      const cur = await getDocument(idToken, `posts/${args.slug}`);
      if (!cur) throw new Error(`No post at /blog/${args.slug}.`);
      const body = `${String(cur.body || "").replace(/\s+$/, "")}\n\n${args.markdown.trim()}\n`;
      return writeBody(idToken, args.slug, cur, body, "before append_to_post");
    },
  },

  /* ---------- finding things to write about, and link to ---------- */
  {
    name: "search_posts",
    description:
      "Search the full text of every post, not just titles. Use it to check whether something has already been covered, and to find the earlier piece a new one should link to.",
    scope: "read",
    inputSchema: {
      type: "object",
      required: ["q"],
      properties: {
        q: { type: "string", description: "Text to look for; case-insensitive" },
        publishedOnly: { type: "boolean" },
        limit: { type: "number", description: "Default 10" },
      },
    },
    handler: async (args, { idToken }) => {
      const needle = String(args.q || "").trim().toLowerCase();
      if (needle.length < 2) throw new Error("Search for at least two characters.");
      let rows = await listDocuments(idToken, "posts", { pageSize: 300 });
      if (args.publishedOnly) rows = rows.filter((r) => r.published);

      const hits = [];
      for (const r of rows) {
        const body = String(r.body || "");
        const hay = body.toLowerCase();
        const where = [];
        if (String(r.title || "").toLowerCase().includes(needle)) where.push("title");
        if ((r.tags || []).some((t) => String(t).toLowerCase().includes(needle))) where.push("tags");

        // A few windows of surrounding text, so the model can judge relevance
        // without being handed the whole article.
        const contexts = [];
        let at = hay.indexOf(needle);
        while (at !== -1 && contexts.length < 3) {
          contexts.push(
            `…${body.slice(Math.max(0, at - 70), at + needle.length + 70).replace(/\s+/g, " ").trim()}…`
          );
          at = hay.indexOf(needle, at + needle.length);
        }
        if (contexts.length) where.push("body");
        if (!where.length) continue;

        hits.push({
          slug: r.id,
          title: r.title,
          url: `/blog/${r.id}`,
          published: !!r.published,
          matchedIn: where,
          occurrences: body ? hay.split(needle).length - 1 : 0,
          contexts,
        });
      }
      hits.sort((a, b) => b.occurrences - a.occurrences);
      const limit = Number.isInteger(args.limit) ? args.limit : 10;
      return { query: args.q, matched: hits.length, results: hits.slice(0, limit) };
    },
  },
  {
    name: "list_tags",
    description:
      "The tag vocabulary already in use, with how many posts carry each. Read it before tagging a new post so the same subject does not end up under three spellings.",
    scope: "read",
    inputSchema: { type: "object", properties: {} },
    handler: async (_a, { idToken }) => {
      const rows = await listDocuments(idToken, "posts", { pageSize: 300 });
      const counts = new Map();
      for (const r of rows)
        for (const t of r.tags || []) counts.set(t, (counts.get(t) || 0) + 1);

      const tags = [...counts.entries()]
        .map(([tag, posts]) => ({ tag, posts }))
        .sort((a, b) => b.posts - a.posts || a.tag.localeCompare(b.tag));

      // Spellings that differ only in case, spacing or punctuation are the
      // same subject split across two tag pages.
      const groups = new Map();
      for (const { tag } of tags) {
        const k = tag.toLowerCase().replace(/[^a-z0-9]+/g, "");
        groups.set(k, [...(groups.get(k) || []), tag]);
      }
      const nearDuplicates = [...groups.values()].filter((g) => g.length > 1);

      return { count: tags.length, tags, nearDuplicates };
    },
  },
  {
    name: "audit_posts",
    description:
      "Check every post for the things that quietly degrade a blog: no excerpt, no cover image, images with no alt text, internal links pointing at posts that do not exist, untagged posts, forgotten drafts, duplicate titles, and documents approaching Firestore's 1 MiB ceiling.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        publishedOnly: { type: "boolean", description: "Only audit what is live" },
        staleDraftDays: { type: "number", description: "Flag drafts untouched this long. Default 30" },
      },
    },
    handler: async (args, { idToken }) => {
      let rows = await listDocuments(idToken, "posts", { pageSize: 300 });
      const slugs = new Set(rows.map((r) => r.id));
      if (args.publishedOnly) rows = rows.filter((r) => r.published);

      const staleDays = Number.isInteger(args.staleDraftDays) ? args.staleDraftDays : 30;
      const staleBefore = Date.now() - staleDays * 86400000;

      const titleSeen = new Map();
      for (const r of rows) {
        const k = String(r.title || "").trim().toLowerCase();
        if (k) titleSeen.set(k, (titleSeen.get(k) || 0) + 1);
      }

      const findings = [];
      for (const r of rows) {
        const body = String(r.body || "");
        const issues = [];

        if (!String(r.excerpt || "").trim())
          issues.push("no excerpt — the blog index and the social preview fall back to stripped body text");
        if (!String(r.cover || "").trim())
          issues.push("no cover image — the link preview will be the site default");
        if (!(r.tags || []).length) issues.push("no tags — it will not appear under any subject");

        if (r.cover && stripLeadingCover(body, r.cover).removed)
          issues.push("the body opens with the cover image, so it renders twice");

        const noAlt = [...body.matchAll(/!\[[ \t]*\]\(/g)].length;
        if (noAlt) issues.push(`${noAlt} image${noAlt === 1 ? "" : "s"} with no alt text`);

        // Internal links are the ones this site is responsible for.
        const dead = [];
        for (const m of body.matchAll(/\]\(\/blog\/([a-z0-9-]+)\)/g))
          if (!slugs.has(m[1])) dead.push(`/blog/${m[1]}`);
        if (dead.length) issues.push(`links to ${[...new Set(dead)].join(", ")} which do not exist`);

        if (!r.published) {
          const touched = Date.parse(r.updatedAt || r.publishedAt || "") || 0;
          if (touched && touched < staleBefore)
            issues.push(`draft untouched since ${String(r.updatedAt || "").slice(0, 10)}`);
        }

        if ((titleSeen.get(String(r.title || "").trim().toLowerCase()) || 0) > 1)
          issues.push("another post has the same title");

        // Firestore refuses a document over 1 MiB, and the failure arrives at
        // save time with the writing already done.
        const bytes = Buffer.byteLength(JSON.stringify(r), "utf8");
        if (bytes > 700 * 1024)
          issues.push(`document is ${Math.round(bytes / 1024)} KB — Firestore refuses one over 1024 KB`);

        if (issues.length)
          findings.push({ slug: r.id, title: r.title, published: !!r.published, url: `/blog/${r.id}`, issues });
      }

      findings.sort((a, b) => b.issues.length - a.issues.length);
      return {
        audited: rows.length,
        clean: rows.length - findings.length,
        needsWork: findings.length,
        findings,
      };
    },
  },
];

export const toolByName = (name) => TOOLS.find((t) => t.name === name);

export const listToolsFor = (scopes) =>
  TOOLS.filter((t) => scopes.includes(t.scope)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
