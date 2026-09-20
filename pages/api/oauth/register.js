// Dynamic Client Registration (RFC 7591). Unauthenticated by spec — a public
// client registers itself before any user is involved.
//
// Nothing is stored: the returned client_id is an encrypted record of the
// metadata, so it cannot be forged into one with different redirect URIs, and
// there is no registration table to grow or leak.
import { registerClient } from "../../../lib/server/oauth";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "invalid_request", error_description: "POST only." });
  }
  try {
    const out = registerClient(req.body || {});
    return res.status(201).json({ ...out, client_id_issued_at: Math.floor(Date.now() / 1000) });
  } catch (e) {
    return res.status(400).json({
      error: e.code || "invalid_client_metadata",
      error_description: e.message,
    });
  }
}
