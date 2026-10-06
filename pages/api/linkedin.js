// The admin panel's LinkedIn route.
//
// This exists because api.linkedin.com sends no CORS headers — unlike Google
// Tasks and Microsoft Graph, the browser cannot call it directly, so the one
// place that already holds the credential does it instead.
//
// Admin-gated on every action. The actions are an allow-list rather than a
// pass-through path, so this can never become a general proxy to LinkedIn
// with the owner's token on it.
import { verifyAdmin, AuthError } from "../../lib/server/verifyAdmin";
import { accessTokenFor, ConnectionError } from "../../lib/server/connectedAccount";
import {
  CAPABILITIES,
  getProfile,
  createPost,
  deletePost,
  jobSearchUrl,
  assertPostable,
  LinkedInError,
  MAX_POST_CHARS,
} from "../../lib/server/linkedin";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    await verifyAdmin(req);
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const { action } = req.body || {};
    res.setHeader("Cache-Control", "no-store");

    // Answerable with no credential at all, so it works before connecting —
    // which is exactly when the panel needs to explain what is possible.
    if (action === "capabilities") {
      return res.status(200).json({ capabilities: CAPABILITIES, maxPostChars: MAX_POST_CHARS });
    }
    if (action === "jobSearchUrl") {
      return res.status(200).json({
        url: jobSearchUrl(req.body),
        note: CAPABILITIES.searchJobs.why,
      });
    }

    const token = await accessTokenFor(idToken, "linkedin");

    if (action === "profile") {
      return res.status(200).json(await getProfile(token));
    }

    if (action === "publish") {
      const text = assertPostable(req.body.text);
      const profile = await getProfile(token);
      const out = await createPost(token, {
        authorUrn: profile.authorUrn,
        text,
        link: req.body.linkUrl
          ? {
              url: req.body.linkUrl,
              title: req.body.linkTitle,
              description: req.body.linkDescription,
            }
          : undefined,
        visibility: req.body.visibility,
      });
      return res.status(200).json({ ...out, chars: text.length });
    }

    if (action === "delete") {
      return res.status(200).json(await deletePost(token, req.body.urn));
    }

    return res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (e instanceof ConnectionError) {
      return res.status(409).json({ error: e.message, code: e.code });
    }
    if (e instanceof LinkedInError) {
      return res.status(e.status || 400).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: e.message || "That did not work." });
  }
}
