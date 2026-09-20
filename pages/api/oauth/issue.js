// Issues the authorization code, after the human approved on /oauth/authorize.
//
// Requires a verified Firebase ID token for an allow-listed admin — the same
// gate as every other privileged route — so a client cannot mint a code by
// calling this directly.
import { verifyAdmin, AuthError } from "../../../lib/server/verifyAdmin";
import { readClient, issueCode } from "../../../lib/server/oauth";
import { ALL_SCOPES, isMcpConfigured } from "../../../lib/server/mcpToken";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "invalid_request" });
  }
  if (!isMcpConfigured())
    return res.status(503).json({ error: "temporarily_unavailable", error_description: "OAuth is not configured." });

  try {
    await verifyAdmin(req);
  } catch (e) {
    if (e instanceof AuthError)
      return res.status(e.status).json({ error: "access_denied", error_description: e.message });
    return res.status(500).json({ error: "server_error" });
  }

  const { client_id, redirect_uri, code_challenge, scopes, refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: "invalid_request", error_description: "Missing session." });
  if (!code_challenge) return res.status(400).json({ error: "invalid_request", error_description: "Missing PKCE challenge." });

  let client;
  try {
    client = readClient(client_id);
  } catch (e) {
    return res.status(400).json({ error: "invalid_client", error_description: e.message });
  }
  if (!client.redirectUris.includes(redirect_uri))
    return res.status(400).json({ error: "invalid_request", error_description: "Unregistered redirect_uri." });

  const clean = (Array.isArray(scopes) ? scopes : []).filter((s) => ALL_SCOPES.includes(s));
  if (!clean.length)
    return res.status(400).json({ error: "invalid_scope", error_description: "No valid scopes requested." });

  const code = issueCode({
    clientId: client_id,
    redirectUri: redirect_uri,
    scopes: clean,
    codeChallenge: code_challenge,
    refreshToken,
  });
  return res.status(200).json({ code });
}
