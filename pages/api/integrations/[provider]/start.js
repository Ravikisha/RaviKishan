// Step 1 of connecting an account: hand the admin a consent URL.
//
// It is a POST rather than a redirect because the admin check rides in an
// Authorization header, and a browser navigating to a URL cannot carry one.
// The panel calls this, gets the URL, and navigates there itself.
import { verifyAdmin, AuthError } from "../../../../lib/server/verifyAdmin";
import {
  authorizeUrl,
  challengeFor,
  getProvider,
  makeState,
  makeVerifier,
  providerConfig,
  redirectUriFor,
} from "../../../../lib/server/integrations";
import { withEnv } from "../../../../lib/server/envStore";
import { currentOrg, ensureOrgKnown } from "../../../../lib/server/orgContext";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    const claims = await verifyAdmin(req);
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    // The org the panel is acting in (x-org-id, laid down by withEnv). Checked
    // to exist BEFORE the consent screen: finding out afterwards would mean a
    // full round trip through Google that ends in "no such org".
    const orgId = await ensureOrgKnown(idToken).then(() => currentOrg());
    const provider = String(req.query.provider || "");
    const asked = getProvider(provider);
    if (asked.auth === "apiKey") {
      return res.status(400).json({
        error: `${asked.label} is connected by pasting a token in the Accounts tab, not through a consent screen.`,
      });
    }
    const cfg = providerConfig(provider);

    if (!cfg.configured) {
      return res.status(503).json({
        error: `${cfg.label} is not set up on this deployment.`,
        missing: cfg.missing,
      });
    }

    const redirectUri = redirectUriFor(req, cfg.id);

    // PKCE, for the providers that require it (X). The verifier is sealed into
    // the state rather than stored anywhere: it comes back with the state and
    // nothing server-side has to remember it between the two requests.
    const p = getProvider(cfg.id);
    const verifier = p.pkce ? makeVerifier() : "";

    const url = authorizeUrl({
      provider: cfg.id,
      clientId: cfg.clientId,
      redirectUri,
      challenge: verifier ? challengeFor(verifier) : "",
      // The state is sealed and carries the admin's uid, so a code delivered
      // to the callback cannot have been started by anyone else.
      state: makeState({
        provider: cfg.id,
        uid: claims.user_id || claims.sub,
        redirectUri,
        verifier,
        // Which panel started this, so consent returns to it. A GitHub
        // connection begun from the account list belongs back in the account
        // list, not on the GitHub tab.
        from: String(req.body?.from || "").slice(0, 24),
        // Sealed, so the account lands in the org that started the consent
        // even though the callback itself carries no header.
        orgId,
      }),
    });

    return res.status(200).json({ url, redirectUri, provider: cfg.id, orgId });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    return res.status(e.status || 500).json({ error: e.message || "Could not start the connection." });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
