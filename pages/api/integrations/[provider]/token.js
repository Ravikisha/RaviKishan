// A short-lived provider access token for the admin panel.
//
// The panel talks to Google Tasks and Microsoft Graph straight from the
// browser (both allow CORS), so all it needs from the server is a credential —
// which means the panel no longer depends on Firebase handing it a Google
// token at sign-in, and no longer dies an hour later.
import { verifyAdmin, AuthError } from "../../../../lib/server/verifyAdmin";
import { accessTokenFor, ConnectionError } from "../../../../lib/server/connectedAccount";
import { getProvider } from "../../../../lib/server/integrations";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    await verifyAdmin(req);
    const p = getProvider(String(req.query.provider || ""));
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

    const accessToken = await accessTokenFor(idToken, p.id);
    // Never cached, by the service worker or anything else: this is a bearer
    // credential with minutes of life.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ accessToken, provider: p.id });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (e instanceof ConnectionError) {
      return res.status(409).json({ error: e.message, code: e.code, provider: e.provider });
    }
    return res.status(e.status || 500).json({ error: e.message || "Could not get a token." });
  }
}
