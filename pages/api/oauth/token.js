// OAuth token endpoint. Exchanges an authorization code (with PKCE) for an
// access token, and refreshes one.
//
// The access token it returns is exactly the same self-contained format the
// MCP tab mints by hand, so /api/mcp needs no second code path — one verifier,
// one revocation mechanism, one thing to reason about.
//
// SINGLE USE. The code carries the user's Firebase refresh token, so this
// route can authenticate AS the user and claim the code in Firestore before
// issuing anything. A replayed code finds its claim already present and is
// rejected. That is what makes a stateless code safe to hand out.
import { readCode, verifyPkce, readClient, ACCESS_TOKEN_TTL } from "../../../lib/server/oauth";
import { mintToken, isMcpConfigured, ALL_SCOPES } from "../../../lib/server/mcpToken";
import { idTokenFor, getDocument, createDocument } from "../../../lib/server/firestoreRest";

const bad = (res, status, error, description) =>
  res.status(status).json({ error, error_description: description });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, 405, "invalid_request", "POST only.");
  }
  if (!isMcpConfigured()) return bad(res, 503, "temporarily_unavailable", "OAuth is not configured.");

  // Token endpoints take form encoding; accept JSON too since some clients send it.
  const body =
    typeof req.body === "string"
      ? Object.fromEntries(new URLSearchParams(req.body))
      : req.body || {};

  const grant = body.grant_type;

  /* ---- refresh_token ---- */
  if (grant === "refresh_token") {
    // Our access tokens already carry the Firebase refresh token and are
    // re-mintable from themselves, so a refresh is a re-issue of the same
    // grant with a fresh expiry.
    const { verifyToken } = await import("../../../lib/server/mcpToken");
    let claims;
    try {
      claims = verifyToken(String(body.refresh_token || ""));
    } catch (_) {
      return bad(res, 400, "invalid_grant", "Refresh token is not valid.");
    }
    const minted = mintToken({
      refreshToken: claims.rt,
      scopes: claims.scopes,
      label: claims.label || "oauth",
    });
    return res.status(200).json({
      access_token: minted.token,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token: minted.token,
      scope: claims.scopes.join(" "),
    });
  }

  if (grant !== "authorization_code")
    return bad(res, 400, "unsupported_grant_type", "Use authorization_code or refresh_token.");

  /* ---- authorization_code ---- */
  let code;
  try {
    code = readCode(String(body.code || ""));
  } catch (e) {
    return bad(res, 400, e.code || "invalid_grant", e.message);
  }

  // The redirect_uri must match the one the code was bound to, and the client
  // must be the one it was issued to.
  if (body.client_id !== code.cid)
    return bad(res, 400, "invalid_grant", "client_id does not match the authorization code.");
  if (body.redirect_uri !== code.ru)
    return bad(res, 400, "invalid_grant", "redirect_uri does not match the authorization request.");

  try {
    const client = readClient(code.cid);
    if (!client.redirectUris.includes(code.ru))
      return bad(res, 400, "invalid_grant", "redirect_uri is not registered to this client.");
  } catch (e) {
    return bad(res, 400, "invalid_client", e.message);
  }

  if (!verifyPkce(code.cc, body.code_verifier))
    return bad(res, 400, "invalid_grant", "PKCE verification failed.");

  // Claim the code so it cannot be redeemed twice.
  let idToken;
  try {
    idToken = await idTokenFor(code.rt);
  } catch (e) {
    return bad(res, 400, "invalid_grant", "The underlying session has been revoked.");
  }
  try {
    const already = await getDocument(idToken, `oauthCodes/${code.jti}`);
    if (already) return bad(res, 400, "invalid_grant", "This authorization code has already been used.");
    await createDocument(idToken, "oauthCodes", code.jti, {
      redeemedAt: new Date().toISOString(),
      clientId: code.cid,
      scopes: code.sc,
    });
  } catch (e) {
    // A code that cannot be claimed must not be honoured — failing closed is
    // the only safe direction here.
    return bad(res, 400, "invalid_grant", `Could not claim the authorization code: ${e.message}`);
  }

  const scopes = (code.sc || []).filter((s) => ALL_SCOPES.includes(s));
  const minted = mintToken({ refreshToken: code.rt, scopes, label: readClientName(code.cid) });

  return res.status(200).json({
    access_token: minted.token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: minted.token,
    scope: scopes.join(" "),
  });
}

function readClientName(clientId) {
  try {
    return `oauth: ${readClient(clientId).name || "client"}`.slice(0, 60);
  } catch (_) {
    return "oauth client";
  }
}
