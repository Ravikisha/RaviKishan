/** @type {import('next-sitemap').IConfig} */

// The sitemap used to list eight static routes and not one post, because every
// post is a dynamic route fetched from Firestore — next-sitemap only sees
// files on disk. Twenty-nine articles were invisible to it.
//
// It also listed /admin and /oauth/authorize, which are explicitly noindex:
// a sitemap is an invitation to crawl, so advertising a private console in one
// works against the headers set in next.config.js.
module.exports = {
  siteUrl: process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://ravikishan.me",
  generateRobotsTxt: true,

  exclude: ["/admin", "/oauth/*", "/__*", "/l/*"],

  robotsTxtOptions: {
    policies: [
      {
        userAgent: "*",
        allow: "/",
        // Belt and braces alongside the noindex headers. /l/ is the short-link
        // redirector — the destination deserves the ranking, not the hop.
        disallow: ["/admin", "/api/", "/oauth/", "/l/"],
      },
    ],
  },

  // NO custom transform. One that rebuilt every entry stamped `lastmod` with
  // the build time, overwriting each post's real updatedAt — so all 29 posts
  // claimed to have changed at the same millisecond on every deploy, which is
  // precisely the signal lastmod exists to give honestly.

  additionalPaths: async () => {
    try {
      // Imported here rather than at the top so a Firestore outage cannot stop
      // `next build` — the sitemap simply falls back to the static routes.
      const { fetchPublishedPostsServer } = await import("./lib/server/publicPosts.js");
      const posts = await fetchPublishedPostsServer();
      console.log(`[next-sitemap] adding ${posts.length} blog posts`);
      return posts.map((p) => ({
        loc: `/blog/${p.slug}`,
        changefreq: "monthly",
        priority: 0.8,
        lastmod: p.updatedAt || p.publishedAt || undefined,
      }));
    } catch (e) {
      console.warn(`[next-sitemap] could not list posts: ${e.message}`);
      return [];
    }
  },
};
