// SERVER ONLY. Turns a stored connection into a usable access token.
//
// One place knows this, because three callers need it and they must not drift:
// the admin panel (through /api/integrations/[provider]/token), the MCP task
// tools, and anything added later. Every one of them reaches the provider the
// same way — read the admin-only document AS THE USER over the Firestore REST
// API, unseal the refresh token, and swap it for a short-lived access token.
import { getDocument, patchDocument } from "./firestoreRest.js";
import {
  accessTokenFromRefresh,
  docPathFor,
  getProvider,
  providerConfig,
  seal,
  unseal,
} from "./integrations.js";

export class ConnectionError extends Error {
  constructor(message, { provider, code = "integration/disconnected", oauthError = "" } = {}) {
    super(message);
    this.name = "ConnectionError";
    this.provider = provider;
    this.code = code;
    // The provider's own machine-readable error, kept so a caller can tell a
    // withdrawn permission from a misconfigured deployment without parsing
    // prose. Empty when the failure did not come from a token endpoint.
    this.oauthError = oauthError;
  }
}

const connectHint = (label) =>
  `Open the admin's Tasks tab and press Connect ${label}. ` +
  `The connection is held as a refresh token, so this is a one-time step — ` +
  `it does not need repeating every hour.`;

// Reads the raw connection document. Returns null when nothing is connected,
// which is a state rather than an error: the panel renders a Connect button
// for it and the tools report it plainly.
export async function readConnection(idToken, provider) {
  const doc = await getDocument(idToken, docPathFor(provider)).catch(() => null);
  if (!doc) return null;
  // The legacy shape: a bare hour-long access token parked by the browser,
  // from before connections were held as refresh tokens. Still honoured so an
  // existing setup keeps working until it is reconnected, but it cannot be
  // refreshed, so it is reported as what it is.
  if (!doc.secret && doc.accessToken) {
    return { legacy: true, accessToken: doc.accessToken, expiresAt: doc.expiresAt || "", email: doc.email || "" };
  }
  if (!doc.secret) return null;
  return { legacy: false, secret: doc.secret, email: doc.email || "", scope: doc.scope || "", connectedAt: doc.connectedAt || "" };
}

// What the Tasks panel and `list_task_providers` show: connected or not, which
// account, and — when it is not usable — exactly what to do about it.
export async function connectionStatus(idToken, provider) {
  const p = getProvider(provider);
  const cfg = providerConfig(provider);
  const base = { provider: p.id, label: p.label, configured: cfg.configured, missing: cfg.missing };

  if (!cfg.configured) {
    return {
      ...base,
      connected: false,
      detail: `${p.label} is not set up on this deployment. Missing: ${cfg.missing.join(", ")}.`,
    };
  }

  const conn = await readConnection(idToken, provider).catch(() => null);
  if (!conn) return { ...base, connected: false, detail: connectHint(p.label) };

  if (conn.legacy) {
    const live = Date.parse(conn.expiresAt || "") > Date.now() + 60_000;
    return {
      ...base,
      connected: live,
      email: conn.email,
      legacy: true,
      detail: live
        ? "Connected with a browser token, which expires within the hour. Press Connect to hold it properly."
        : `That browser token expired. ${connectHint(p.label)}`,
    };
  }

  const who = conn.email || "this account";
  const sealedKind = conn.kind || (p.longLived ? "access" : "refresh");
  const until = Date.parse(conn.expiresAt || "");

  // An access token with a stated expiry gets a countdown, because this one
  // genuinely runs out and cannot be renewed without the member sitting in
  // front of a consent screen. Saying "connected" and nothing else is how you
  // find out on the day a post fails.
  if (sealedKind === "access" && until) {
    const days = Math.floor((until - Date.now()) / 86400000);
    return {
      ...base,
      connected: days > 0,
      email: conn.email,
      connectedAt: conn.connectedAt,
      expiresAt: conn.expiresAt,
      expiresInDays: days,
      detail:
        days <= 0
          ? `The connection expired on ${conn.expiresAt.slice(0, 10)}. ${connectHint(p.label)}`
          : days <= 7
          ? `Connected as ${who}, but this token expires in ${days} day${days === 1 ? "" : "s"}. ${p.label} issues refresh tokens only to approved partners, so reconnecting by hand is the only way to extend it.`
          : `Connected as ${who}. This token expires in ${days} days — ${p.label} does not issue a refresh token to a self-serve app, so it has to be reconnected by hand.`,
    };
  }

  return {
    ...base,
    connected: true,
    email: conn.email,
    connectedAt: conn.connectedAt,
    detail:
      sealedKind === "access"
        ? `Connected as ${who}. The token does not expire; revoking it in the account's settings is what ends it.`
        : `Connected as ${who}.`,
  };
}

// The one call everything else makes. Throws ConnectionError with an actionable
// message when there is nothing usable, so an AI client is told what is wrong
// rather than being handed an HTTP status.
export async function accessTokenFor(idToken, provider) {
  const p = getProvider(provider);
  const cfg = providerConfig(provider);
  if (!cfg.configured) {
    throw new ConnectionError(
      `${p.label} is not configured on this deployment (missing ${cfg.missing.join(", ")}).`,
      { provider: p.id, code: "integration/not-configured" }
    );
  }

  const conn = await readConnection(idToken, provider);
  if (!conn) throw new ConnectionError(`${p.label} is not connected. ${connectHint(p.label)}`, { provider: p.id });

  if (conn.legacy) {
    if (Date.parse(conn.expiresAt || "") > Date.now() + 60_000) return conn.accessToken;
    throw new ConnectionError(
      `The stored ${p.label} browser token expired. ${connectHint(p.label)}`,
      { provider: p.id, code: "integration/expired" }
    );
  }

  let opened;
  try {
    opened = unseal(conn.secret, "refresh");
  } catch (e) {
    throw new ConnectionError(e.message, { provider: p.id, code: "integration/unreadable" });
  }

  // A long-lived provider issues a token with no refresh token at all, so the
  // sealed value IS the credential and there is nothing to exchange — asking
  // its token endpoint for a refresh would fail on a grant type it never
  // issued.
  //
  // `kind` decides this, not the provider, because LinkedIn is both: an
  // approved Marketing Developer Platform partner gets a refresh token and
  // behaves like Google, while a self-serve app gets a 60-day access token.
  const sealedKind = conn.kind || (p.longLived ? "access" : "refresh");
  if (sealedKind === "access") {
    const token = opened.accessToken;
    if (!token) {
      throw new ConnectionError(
        `The stored ${p.label} connection is not in the expected shape. ${connectHint(p.label)}`,
        { provider: p.id, code: "integration/unreadable" }
      );
    }
    // GitHub's token has no expiry; LinkedIn's dies at 60 days and cannot be
    // renewed without the member. Refuse a dead one here with the date, rather
    // than letting the provider answer 401 and sending the caller hunting.
    const until = Date.parse(conn.expiresAt || "");
    if (until && until < Date.now()) {
      throw new ConnectionError(
        `The ${p.label} connection expired on ${new Date(until).toISOString().slice(0, 10)}. ${connectHint(p.label)}`,
        { provider: p.id, code: "integration/expired" }
      );
    }
    return token;
  }

  const refreshToken = opened.refreshToken;

  let out;
  try {
    out = await accessTokenFromRefresh({ provider: p.id, refreshToken });
  } catch (e) {
    // A refresh token is revoked by changing the account password, by removing
    // the app in the account's security settings, by rotating the client
    // secret, by 6 months of disuse — and, on Google, by having been issued
    // while the OAuth app was still in "Testing", which caps it at 7 days.
    // All of them land here as invalid_grant, and all need the same one-time
    // fix, so the message says what happened rather than quoting a status.
    throw new ConnectionError(
      e.oauthError === "invalid_grant"
        ? `The stored ${p.label} connection is no longer accepted — the saved ` +
          `permission was withdrawn or has expired. ${connectHint(p.label)}`
        : `${p.label} refused the stored connection (${e.message}). ${connectHint(p.label)}`,
      { provider: p.id, code: "integration/rejected", oauthError: e.oauthError || "" }
    );
  }

  // Microsoft hands back a NEW refresh token on every refresh and expects the
  // old one to be dropped. Miss this and the connection works until the first
  // one ages out, then dies for no visible reason.
  if (out.rotatedRefreshToken && out.rotatedRefreshToken !== refreshToken) {
    await patchDocument(idToken, docPathFor(p.id), {
      secret: seal({ refreshToken: out.rotatedRefreshToken }, "refresh"),
      rotatedAt: new Date().toISOString(),
    }).catch(() => {
      // A failed write costs nothing this call — the token in hand is already
      // valid. The next refresh will rotate again from the stored one, which
      // Microsoft keeps usable until it is actually replaced.
    });
  }

  return out.accessToken;
}
