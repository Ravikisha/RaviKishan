// Cross-posts a locally-authored article to dev.to, or updates the copy that
// is already there. Admin only.
//
// The dev.to copy is given canonical_url pointing back at this site, because
// for a post written here we are the original.
import { verifyAdmin, AuthError } from "../../../lib/server/verifyAdmin";
import { crossPost, isDevtoConfigured } from "../../../lib/server/devto";
import { withEnv } from "../../../lib/server/envStore";
import { currentOrg } from "../../../lib/server/orgContext";
import { assertDeploymentScope, deploymentScopedFamily } from "../../../lib/server/orgShape";

const SITE = "https://www.ravikishan.me";

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

  // dev.to's key is the deployment's, which is Relax's (orgShape.DEPLOYMENT_SCOPED).
  // The admin sends x-org-id on every request, so in another org this refuses
  // with the same sentence the MCP tools give rather than acting as Relax.
  try {
    assertDeploymentScope(deploymentScopedFamily("devto"), currentOrg());
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.message, code: e.code });
  }
  if (!isDevtoConfigured())
    return res.status(503).json({ error: "dev.to is not configured (DEVTO_API_KEY)." });

  const { post } = req.body || {};
  if (!post?.slug || !post?.title || !post?.body)
    return res.status(400).json({ error: "post needs at least slug, title and body." });

  // An article imported FROM dev.to must not be pushed back — that would
  // overwrite the original with our copy and flip the canonical the wrong way.
  if (post.source === "devto" && !post.editedHere)
    return res.status(409).json({
      error:
        "This post was imported from dev.to, so dev.to is the original. Edit it there, or re-import.",
    });

  try {
    const out = await crossPost(post, SITE);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(e.status === 401 ? 401 : 502).json({ error: e.message });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
