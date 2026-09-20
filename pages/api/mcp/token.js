// Mints an MCP personal access token. Admin-only.
//
// The caller proves who they are with a Firebase ID token (verified against
// Google's certs, same as the vault route) and hands over the REFRESH token
// from that same session. The refresh token is encrypted into the returned
// access token and is never stored here — see lib/server/mcpToken.js for why.
import { verifyAdmin, AuthError } from "../../../lib/server/verifyAdmin";
import { mintToken, ALL_SCOPES, isMcpConfigured } from "../../../lib/server/mcpToken";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!isMcpConfigured())
    return res.status(503).json({ error: "MCP is not configured (missing MCP_TOKEN_SECRET)." });

  try {
    await verifyAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: "Auth check failed." });
  }

  const { refreshToken, scopes, label } = req.body || {};
  if (!refreshToken || typeof refreshToken !== "string")
    return res.status(400).json({ error: "refreshToken is required." });

  const wanted = Array.isArray(scopes) ? scopes.filter((s) => ALL_SCOPES.includes(s)) : [];
  if (!wanted.length)
    return res.status(400).json({ error: `scopes must include at least one of: ${ALL_SCOPES.join(", ")}` });

  try {
    const { token, jti, iat } = mintToken({ refreshToken, scopes: wanted, label });
    // The token itself is returned exactly once and never persisted.
    return res.status(200).json({ token, jti, iat, scopes: wanted });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Could not mint a token." });
  }
}
