// Authorization server metadata (RFC 8414), served at
// /.well-known/oauth-authorization-server via a rewrite.
//
// This server is deliberately minimal: authorization_code + PKCE (S256 only)
// and refresh_token, public clients, dynamic registration. No implicit grant,
// no password grant, no client secrets — all of which OAuth 2.1 removes.
export default function handler(req, res) {
  const host = req.headers.host || "";
  const proto =
    req.headers["x-forwarded-proto"] ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const base = `${proto}://${host}`;

  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    scopes_supported: ["read", "write", "vault"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    service_documentation: `${base}/admin`,
  });
}
