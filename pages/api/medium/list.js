// What is already on Medium.
//
// Medium's RSS feed sends no CORS headers, so the browser cannot read it
// directly — this is the proxy. It carries no secret of its own (the feed is
// public) but stays admin-gated for the same reason the dev.to route is: it
// exists to serve one panel, and an open proxy is a thing to maintain rather
// than a thing to want.
//
// There is no companion publish route. Medium stopped issuing API integration
// tokens on 1 January 2025, so posting through api.medium.com is not available
// to this account. The admin opens Medium's own importer instead, which sets
// the canonical URL back to this site.
import { verifyAdmin, AuthError } from "../../../lib/server/verifyAdmin";
import { fetchMediumPosts, mediumProfileUrl } from "../../../lib/server/medium";
import { withEnv } from "../../../lib/server/envStore";

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    await verifyAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: "Auth check failed." });
  }

  try {
    const posts = await fetchMediumPosts();
    return res.status(200).json({
      count: posts.length,
      profile: mediumProfileUrl(),
      // Medium's feed only carries the most recent stories, which is why the
      // panel shows a third state rather than claiming an older post is absent.
      feedLimited: true,
      posts,
    });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
