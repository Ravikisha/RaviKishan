// What the Tasks panel asks on load: which accounts are connected, as whom,
// and — when one is not — exactly what is missing.
//
// Both providers in one round trip, because the panel renders them side by
// side and two sequential requests would make one column appear late.
import { verifyAdmin, AuthError } from "../../../lib/server/verifyAdmin";
import { connectionStatus } from "../../../lib/server/connectedAccount";
import { providerIds } from "../../../lib/server/integrations";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    await verifyAdmin(req);
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

    const providers = await Promise.all(
      providerIds().map((id) =>
        connectionStatus(idToken, id).catch((e) => ({
          provider: id,
          connected: false,
          detail: e?.message || "This account could not be checked.",
        }))
      )
    );

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ providers });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: e.message || "Could not read the connections." });
  }
}
