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
//   - Contacts are other people's personal data, so they are read-only here
//     and the tool caps what it returns.
import {
  getDocument,
  listDocuments,
  patchDocument,
  createDocument,
  deleteDocument,
} from "./firestoreRest";
import { presign, assertVaultKey, assertMediaKey, isVaultConfigured } from "./b2";
import { listMine, toPost, crossPost, isDevtoConfigured } from "./devto";

const nowISO = () => new Date().toISOString();
const str = { type: "string" };
const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://ravikishan.me";

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
      const slug =
        (args.slug || args.title)
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60) || "untitled";
      const existing = await getDocument(idToken, `posts/${slug}`);
      if (existing) throw new Error(`/blog/${slug} already exists — choose another slug.`);

      const words = String(args.body).split(/\s+/).filter(Boolean).length;
      const published = !!args.publish;
      const doc = {
        title: args.title,
        slug,
        body: args.body,
        excerpt: args.excerpt || String(args.body).replace(/[#>*_`~\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 170),
        cover: args.cover || "",
        tags: Array.isArray(args.tags) ? args.tags : [],
        readingTime: Math.max(1, Math.round(words / 200)),
        published,
        publishedAt: published ? nowISO() : "",
        updatedAt: nowISO(),
      };
      await createDocument(idToken, "posts", slug, doc);
      return { url: `/blog/${slug}`, ...doc };
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
      if (patch.body) {
        const words = patch.body.split(/\s+/).filter(Boolean).length;
        patch.readingTime = Math.max(1, Math.round(words / 200));
      }
      // An imported article, once edited here, may be pushed back to dev.to.
      if (cur.source === "devto") patch.editedHere = true;
      return patchDocument(idToken, `posts/${args.slug}`, patch);
    },
  },
  {
    name: "delete_post",
    description: "Delete a post permanently. Anyone linking to its URL will get a 404.",
    scope: "write",
    inputSchema: { type: "object", required: ["slug"], properties: { slug: str } },
    handler: async (args, { idToken }) => {
      await deleteDocument(idToken, `posts/${args.slug}`);
      return { deleted: `/blog/${args.slug}` };
    },
  },
  {
    name: "upload_blog_image",
    description:
      "Upload an image for a post and get back the Markdown to paste. Send the file base64-encoded. Returns a permanent URL on ravikishan.me.",
    scope: "write",
    inputSchema: {
      type: "object",
      required: ["filename", "contentBase64"],
      properties: {
        filename: { type: "string", description: "e.g. diagram.png" },
        contentBase64: { type: "string", description: "Raw file bytes, base64" },
        alt: str,
        cover: { type: "boolean", description: "Mark the uploaded image as a post cover instead of an inline image" },
      },
    },
    handler: async (args) => {
      if (!isVaultConfigured()) throw new Error("Storage is not configured.");
      const bytes = Buffer.from(args.contentBase64, "base64");
      if (!bytes.length) throw new Error("contentBase64 decoded to nothing.");
      if (bytes.length > 8 * 1024 * 1024) throw new Error("Images must be under 8 MB.");

      const ext = String(args.filename).split(".").pop().toLowerCase();
      const types = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
      };
      if (!types[ext]) throw new Error(`Unsupported image type: .${ext}`);

      const safe = String(args.filename).replace(/[^\w.-]+/g, "_").slice(-60);
      const key = `media/blog/${Date.now()}-${safe}`;
      assertMediaKey(key);

      const put = await fetch(presign({ method: "PUT", key, expiresIn: 300 }), {
        method: "PUT",
        body: bytes,
        headers: { "Content-Type": types[ext] },
      });
      if (!put.ok) throw new Error(`Storage rejected the upload (HTTP ${put.status}).`);

      const url = `${SITE}/api/media/${key.slice("media/".length)}`;
      return {
        url,
        cover: !!args.cover,
        markdown: `![${args.alt || ""}](${url})`,
        bytes: bytes.length,
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
];

export const toolByName = (name) => TOOLS.find((t) => t.name === name);

export const listToolsFor = (scopes) =>
  TOOLS.filter((t) => scopes.includes(t.scope)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
