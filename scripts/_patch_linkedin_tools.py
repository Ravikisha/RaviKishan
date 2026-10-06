# -*- coding: utf-8 -*-
# One-shot patch: add the LinkedIn tool block to the MCP registry.
# Inserted immediately before list_medium_posts so it never touches the
# github block the forked session owns.
import io

p = "D:/personal_sync/RaviKishan/lib/server/mcpTools.js"
s = io.open(p, encoding="utf-8").read()

# ---------- imports ----------
old_imp = 'import { providerIds, PINNED_GITHUB_LOGIN } from "./integrations.js";'
if old_imp in s:
    s = s.replace(
        old_imp,
        'import { providerIds, PINNED_GITHUB_LOGIN } from "./integrations.js";\n'
        'import {\n'
        '  CAPABILITIES as LI_CAPABILITIES,\n'
        '  getProfile as liProfile,\n'
        '  createPost as liCreatePost,\n'
        '  deletePost as liDeletePost,\n'
        '  jobSearchUrl as liJobSearchUrl,\n'
        '  profileDrift as liProfileDrift,\n'
        '  draftFromPost as liDraftFromPost,\n'
        '  assertPostable as liAssertPostable,\n'
        '  postUrl as liPostUrl,\n'
        '  MAX_POST_CHARS as LI_MAX,\n'
        '} from "./linkedin.js";',
        1,
    )
else:
    raise SystemExit("integrations import line not found")

# ---------- helper next to githubCtx ----------
anchor_helper = "async function githubCtx(idToken) {"
assert anchor_helper in s, "githubCtx helper not found"
helper = '''// LinkedIn needs the person URN on every post, and it only comes from the
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

'''
s = s.replace(anchor_helper, helper + anchor_helper, 1)

# ---------- the tools ----------
anchor = '  {\n    name: "list_medium_posts",'
assert anchor in s, "medium anchor not found"

TOOLS = r'''  /* ---------- LinkedIn ---------- */
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

'''

s = s.replace(anchor, TOOLS + anchor, 1)
io.open(p, "w", encoding="utf-8").write(s)
print("linkedin tools added")
