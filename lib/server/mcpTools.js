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
//   - Three admin capabilities are deliberately absent and always will be:
//     minting or revoking an MCP token (a token that can mint tokens is a
//     privilege-escalation ladder), uploading to the vault (encryption
//     happens in the browser with a passphrase that never leaves it), and
//     Google Tasks (its access token is issued to the browser; serving it
//     from here would mean storing a Google refresh token, a far worse
//     secret than anything else in this deployment).
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
      "Create a blog post from Markdown. Saved as a draft unless publish is true. The slug becomes the URL at /blog/<slug> and cannot be changed later.",
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
      "Edit an existing post: title, body, excerpt, tags or cover. Only the fields you pass change. The slug cannot be changed - it is the URL.",
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
      const out = await crossPost({ ...post, slug: args.slug }, "https://www.ravikishan.me");
      await patchDocument(idToken, `posts/${args.slug}`, {
        devtoId: out.id,
        devtoUrl: out.url,
        crossPostedAt: nowISO(),
      });
      return out;
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
      "Rewrite the text under one heading, leaving the rest of the article untouched. Identify the section by its heading text; matching ignores case and punctuation. This is the cheap way to fix a long post — the alternative is resending the whole body.",
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
