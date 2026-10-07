// A short-lived provider access token for the admin panel.
//
// The panel talks to Google Tasks and Microsoft Graph straight from the
// browser (both allow CORS), so all it needs from the server is a credential —
// which means the panel no longer depends on Firebase handing it a Google
// token at sign-in, and no longer dies an hour later.
import { verifyAdmin, AuthError } from "../../../../lib/server/verifyAdmin";
import { ConnectionError } from "../../../../lib/server/connectedAccount";
import { tokenFor, ConnectedAuthError } from "../../../../lib/server/accountDirectory";
import { getProvider } from "../../../../lib/server/integrations";
import { withEnv } from "../../../../lib/server/envStore";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    await verifyAdmin(req);
    const p = getProvider(String(req.query.provider || ""));
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

    // Through the directory: the panel may be driving any one of several
    // accounts of this provider, and `accountId` is how it says which.
    const { token: accessToken, account } = await tokenFor(idToken, {
      provider: p.id,
      accountId: req.body?.accountId,
    });
    // Never cached, by the service worker or anything else: this is a bearer
    // credential with minutes of life.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ accessToken, provider: p.id, accountId: account.accountId });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (e instanceof ConnectedAuthError) {
      // `p` is scoped to the try block, so the provider is read back from the
      // request rather than from a variable that may not exist here.
      return res.status(409).json({ error: e.message, code: e.code, provider: String(req.query.provider || "") });
    }
    if (e instanceof ConnectionError) {
      return res.status(409).json({ error: e.message, code: e.code, provider: e.provider });
    }
    return res.status(e.status || 500).json({ error: e.message || "Could not get a token." });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
