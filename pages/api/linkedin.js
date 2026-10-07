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
import { ConnectionError } from "../../lib/server/connectedAccount";
import { tokenFor } from "../../lib/server/accountDirectory";
import { linkedinTraffic, AnalyticsError } from "../../lib/server/googleAnalytics";
import linkedinProfile from "../../lib/linkedinProfile";
import {
  CAPABILITIES,
  getProfile,
  createPost,
  deletePost,
  editPost,
  jobSearchUrl,
  assertPostable,
  LinkedInError,
  MAX_POST_CHARS,
} from "../../lib/server/linkedin";
import { withEnv } from "../../lib/server/envStore";

async function handler(req, res) {
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
    // The profile LinkedIn's API will not return, from the data export.
    // Answerable with no connection at all, which is the point: it is the only
    // way to see the headline 1,148 people actually read.
    if (action === "exportProfile") {
      return res.status(200).json({ profile: linkedinProfile });
    }

    // What LinkedIn was worth. LinkedIn will not report a member's own post
    // performance without a partnership, so this reads the traffic it SENT,
    // out of the Google Analytics account already connected here. Different
    // question, honestly labelled, and the only one with a real answer.
    if (action === "reach") {
      try {
        const { token, account } = await tokenFor(idToken, {
          service: "siteAnalytics",
          accountId: req.body.analyticsAccountId,
        });
        if (!req.body.propertyId) {
          return res.status(200).json({
            available: false,
            why: "No Analytics property chosen yet. Pick one in the Analytics tab and it will be used here too.",
          });
        }
        const out = await linkedinTraffic(token, req.body.propertyId, { range: req.body.range });
        return res.status(200).json({ available: true, account: { accountId: account.accountId, label: account.label }, ...out });
      } catch (e) {
        if (e instanceof AnalyticsError || e?.code) {
          // Not an error the panel should shout about: no Analytics account is
          // a perfectly ordinary state, and the section says so rather than
          // rendering a failure.
          return res.status(200).json({ available: false, why: e.message });
        }
        throw e;
      }
    }

    if (action === "jobSearchUrl") {
      return res.status(200).json({
        url: jobSearchUrl(req.body),
        note: CAPABILITIES.searchJobs.why,
      });
    }

    // Through the directory so a LinkedIn account connected since this became
    // multi-account is found at all; the legacy single connection is still in
    // the pool, so nothing that worked before stops.
    const { token } = await tokenFor(idToken, {
      provider: "linkedin",
      service: "professional",
      accountId: req.body.accountId,
    });

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

    if (action === "edit") {
      return res.status(200).json(await editPost(token, req.body.urn, req.body.text));
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

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
