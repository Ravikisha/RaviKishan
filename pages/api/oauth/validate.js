// Validates an authorization request before the consent screen renders
// anything. An invalid request must never show an "Approve" button.
import { readClient } from "../../../lib/server/oauth";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "invalid_request" });
  }
  const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method } =
    req.body || {};

  if (response_type !== "code")
    return res.status(400).json({
      error: "unsupported_response_type",
      error_description: "Only the authorization code flow is supported.",
    });
  // OAuth 2.1: PKCE is mandatory, and `plain` is gone.
  if (!code_challenge || code_challenge_method !== "S256")
    return res.status(400).json({
      error: "invalid_request",
      error_description: "PKCE with code_challenge_method=S256 is required.",
    });

  let client;
  try {
    client = readClient(client_id);
  } catch (e) {
    return res.status(400).json({ error: "invalid_client", error_description: e.message });
  }
  // Exact match only — no prefix matching, which is how redirect_uri
  // validation usually gets broken.
  if (!client.redirectUris.includes(redirect_uri))
    return res.status(400).json({
      error: "invalid_request",
      error_description: "redirect_uri is not registered for this client.",
    });

  return res.status(200).json({ client_name: client.name, redirect_uri });
}
