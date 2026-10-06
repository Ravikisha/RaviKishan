// Step 1 of connecting an account: hand the admin a consent URL.
//
// It is a POST rather than a redirect because the admin check rides in an
// Authorization header, and a browser navigating to a URL cannot carry one.
// The panel calls this, gets the URL, and navigates there itself.
import { verifyAdmin, AuthError } from "../../../../lib/server/verifyAdmin";
import {
  authorizeUrl,
  makeState,
  providerConfig,
  redirectUriFor,
} from "../../../../lib/server/integrations";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    const claims = await verifyAdmin(req);
    const provider = String(req.query.provider || "");
    const cfg = providerConfig(provider);

    if (!cfg.configured) {
      return res.status(503).json({
        error: `${cfg.label} is not set up on this deployment.`,
        missing: cfg.missing,
      });
    }

    const redirectUri = redirectUriFor(req, cfg.id);
    const url = authorizeUrl({
      provider: cfg.id,
      clientId: cfg.clientId,
      redirectUri,
      // The state is sealed and carries the admin's uid, so a code delivered
      // to the callback cannot have been started by anyone else.
      state: makeState({ provider: cfg.id, uid: claims.user_id || claims.sub, redirectUri }),
    });

    return res.status(200).json({ url, redirectUri, provider: cfg.id });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    return res.status(e.status || 500).json({ error: e.message || "Could not start the connection." });
  }
}
