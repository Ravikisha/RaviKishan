// RFC 9728 protected-resource metadata, served at
// /.well-known/oauth-protected-resource via a rewrite in next.config.js.
//
// The MCP authorization spec expects a 401 from the resource to carry a
// WWW-Authenticate header pointing here, so a compliant client can discover
// how to authenticate. This server does not run an OAuth authorization server:
// tokens are minted by hand in the admin UI, so `authorization_servers` is
// empty and the documentation URL says where to get one. Publishing accurate
// metadata that says "no AS" is better than publishing none, and better than
// advertising an endpoint that does not exist.
export default function handler(req, res) {
  const host = req.headers.host || "";
  const proto =
    req.headers["x-forwarded-proto"] ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const base = `${proto}://${host}`;
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: ["read", "write", "vault"],
    resource_name: "Ravi Kishan — identity control plane",
    resource_documentation: `${base}/admin`,
    // Non-standard, but the only thing a human reading this actually needs.
    token_issuance: {
      type: "oauth2_or_manual",
      description:
        "Either run the OAuth 2.1 flow against this issuer (dynamic client " +
        "registration is open, PKCE S256 required), or sign in at /admin and " +
        "mint a personal access token by hand from the MCP tab.",
    },
  });
}
