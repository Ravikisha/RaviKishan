// SERVER ONLY. Connected third-party accounts — Google Tasks and Microsoft
// To Do — held as refresh tokens this deployment can use without a browser.
//
// WHY THIS EXISTS, and what changed
// --------------------------------
// The first version of Google Tasks here borrowed the access token Firebase
// hands the BROWSER at sign-in: the panel parked it in an admin-only document
// and the MCP tools read it from there. That works for about an hour and then
// an AI client is told to go and press Connect in a web page — which defeats
// the point of an AI client. The ask was explicit: the tools must come back
// authenticated, not come back with instructions.
//
// There is exactly one way to do that: hold a refresh token. So this file does
// what the old one refused to, and the refusal is answered rather than ignored:
//
//   - The refresh token is NEVER stored in plaintext. It is sealed with
//     AES-256-GCM under INTEGRATION_SECRET, which lives only in the
//     deployment's environment. The sealed blob is what sits in Firestore.
//   - The server never writes it. These API routes have no Firestore
//     credential of their own (the no-service-account rule), so the callback
//     hands the sealed blob back to the signed-in admin's BROWSER, which
//     stores it under the admin-only `integrations/` rules. The browser holds
//     a blob it cannot open; the server holds a key with nothing attached.
//   - Leaking the Firestore document gives an attacker ciphertext. Leaking
//     INTEGRATION_SECRET gives them a key to nothing. Both are needed.
//   - Revocation has two levers, like the MCP token: "Disconnect" deletes the
//     document, and rotating INTEGRATION_SECRET invalidates every connection
//     at once.
//
// The account is pinned: every consent URL carries `login_hint`, so the flow
// always offers the admin's own account rather than whichever one the browser
// happened to be signed into.
import crypto from "crypto";

// The one account these integrations may ever be connected to. A consent
// screen that quietly offers a different account is how you end up managing
// someone else's tasks and not noticing for a week.
//
// Written out rather than imported from lib/adminAllowlist.js on purpose:
// this folder is the one marked ESM so plain node can import it, and
// lib/ is not — importing across that line would mean the MCP registry
// could only be loaded by running the server, which is exactly what
// `npm run mcp:check` exists to avoid. Same reason firestore.rules and
// storage.rules each spell the address out. Keep all four in sync.
export const PINNED_EMAIL =
  process.env.INTEGRATION_ACCOUNT || "ravikishan63392@gmail.com";

// GitHub identifies an account by handle, not by address, so its consent URL
// is pinned with a different parameter and a different value.
export const PINNED_GITHUB_LOGIN =
  process.env.INTEGRATION_GITHUB_LOGIN || "Ravikisha";

// LinkedIn's consent screen takes no account hint at all — there is no
// `login_hint` equivalent on its authorization endpoint — so the account is
// confirmed AFTER the fact from /v2/userinfo rather than requested up front.
export const PINNED_LINKEDIN_EMAIL = PINNED_EMAIL;

/* ---------------- providers ---------------- */

// Everything provider-specific lives here, so adding a third is a data change
// rather than a new code path. `env` names its two secrets; `scopes` is what
// the consent screen asks for.
export const PROVIDERS = {
  google: {
    id: "google",
    label: "Google Tasks",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/tasks", "openid", "email"],
    env: { id: "GOOGLE_TASKS_CLIENT_ID", secret: "GOOGLE_TASKS_CLIENT_SECRET" },
    // Written out rather than derived: these two documents already exist with
    // these names, and a scheme that renames them on a refactor would orphan
    // a live connection silently.
    docId: "googleTasks",
    // access_type=offline is what makes Google issue a refresh token at all,
    // and prompt=consent is what makes it issue one AGAIN on a reconnect —
    // without it a second authorisation returns an access token only and the
    // connection silently becomes an hour long.
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  microsoft: {
    id: "microsoft",
    label: "Microsoft To Do",
    // `common` accepts both a personal Microsoft account and a work/school
    // one; a tenant id can be pinned with MS_TASKS_TENANT.
    get authUrl() {
      return `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/authorize`;
    },
    get tokenUrl() {
      return `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/token`;
    },
    // offline_access is Microsoft's name for "give me a refresh token".
    scopes: ["Tasks.ReadWrite", "User.Read", "offline_access", "openid", "email"],
    env: { id: "MS_TASKS_CLIENT_ID", secret: "MS_TASKS_CLIENT_SECRET" },
    docId: "microsoftTasks",
    extraAuthParams: { prompt: "select_account" },
  },
  github: {
    id: "github",
    label: "GitHub",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    // public_repo covers description, topics, homepage and file contents on
    // public repositories; `user` is what allows the profile bio and links to
    // be edited, which is half the point of a presence hub. Widen to `repo`
    // only if private repositories need to be managed from here.
    scopes: ["public_repo", "user"],
    env: { id: "GITHUB_CLIENT_ID", secret: "GITHUB_CLIENT_SECRET" },
    docId: "github",
    extraAuthParams: {},
    // A classic GitHub OAuth app issues a token that does not expire and has
    // NO refresh token. So the access token itself is what gets sealed, and
    // there is nothing to refresh — see `longLived` in connectedAccount.js.
    longLived: true,
    // GitHub's token endpoint answers form-encoded unless asked otherwise.
    tokenHeaders: { Accept: "application/json" },
    // And it pins the account with `login`, not `login_hint`.
    loginParam: "login",
    pinnedAccount: () => PINNED_GITHUB_LOGIN,
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    // All three are SELF-SERVE products in the LinkedIn developer portal:
    // "Sign In with LinkedIn using OpenID Connect" grants openid/profile/email,
    // and "Share on LinkedIn" grants w_member_social. Nothing here needs a
    // partnership.
    //
    // What is deliberately NOT requested, because it cannot be had: r_fullprofile
    // (headline, positions, skills) is partner-only, and there is no profile
    // WRITE scope at any tier — LinkedIn removed profile editing from the API.
    // See lib/server/linkedin.js for what that means for "sync".
    scopes: ["openid", "profile", "email", "w_member_social"],
    env: { id: "LINKEDIN_CLIENT_ID", secret: "LINKEDIN_CLIENT_SECRET" },
    docId: "linkedin",
    extraAuthParams: {},
    // Hybrid, and this is the awkward bit. LinkedIn issues a refresh token
    // ONLY to approved Marketing Developer Platform partners. A self-serve app
    // gets a 60-day access token and nothing else, so the connection is sealed
    // as whichever one arrives — and when it is the access token, its expiry is
    // stored so the panel can say how long is left instead of discovering it
    // when a post fails.
    longLived: true,
    tokenHeaders: { Accept: "application/json" },
    // LinkedIn's authorization endpoint accepts no account hint.
    noAccountHint: true,
  },
};

const msTenant = () => process.env.MS_TASKS_TENANT || "common";

export const providerIds = () => Object.keys(PROVIDERS);

export function getProvider(id) {
  const p = PROVIDERS[String(id || "").toLowerCase()];
  if (!p) {
    const e = new Error(
      `Unknown provider "${id}". Known providers: ${providerIds().join(", ")}.`
    );
    e.status = 400;
    throw e;
  }
  return p;
}

// A provider is only usable if BOTH halves of its client credential are set.
// Half-configured is reported as not configured, because a consent screen that
// 400s on the redirect is worse than a button that says what is missing.
export function providerConfig(id) {
  const p = getProvider(id);
  const clientId = process.env[p.env.id] || "";
  const clientSecret = process.env[p.env.secret] || "";
  return {
    id: p.id,
    label: p.label,
    clientId,
    clientSecret,
    configured: !!(clientId && clientSecret && isSealConfigured()),
    missing: [
      clientId ? null : p.env.id,
      clientSecret ? null : p.env.secret,
      isSealConfigured() ? null : "INTEGRATION_SECRET",
    ].filter(Boolean),
  };
}

/* ---------------- sealing ---------------- */

export const isSealConfigured = () => !!process.env.INTEGRATION_SECRET;

function sealKey() {
  const raw = process.env.INTEGRATION_SECRET;
  if (!raw) {
    const e = new Error(
      "Connected accounts are not configured on this deployment (missing INTEGRATION_SECRET)."
    );
    e.status = 503;
    e.code = "integrations/not-configured";
    throw e;
  }
  // Accept base64url or any passphrase; normalise to exactly 32 bytes. Same
  // shape as MCP_TOKEN_SECRET so there is one thing to learn, but a SEPARATE
  // value on purpose: rotating the MCP secret should not silently drop every
  // connected account.
  const buf = Buffer.from(raw, "base64url");
  return buf.length === 32 ? buf : crypto.createHash("sha256").update(raw).digest();
}

// `purpose` is bound into the ciphertext as additional authenticated data, so
// a sealed OAuth state can never be opened as if it were a refresh token.
export function seal(value, purpose = "refresh") {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", sealKey(), iv);
  c.setAAD(Buffer.from(purpose, "utf8"));
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

export function unseal(blob, purpose = "refresh") {
  let buf;
  try {
    buf = Buffer.from(String(blob || ""), "base64url");
  } catch (_) {
    throw new Error("This connection is unreadable.");
  }
  if (buf.length < 29) throw new Error("This connection is unreadable.");
  const d = crypto.createDecipheriv("aes-256-gcm", sealKey(), buf.subarray(0, 12));
  d.setAAD(Buffer.from(purpose, "utf8"));
  d.setAuthTag(buf.subarray(12, 28));
  try {
    return JSON.parse(
      Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8")
    );
  } catch (_) {
    // Wrong key, wrong purpose, or a flipped byte. All three mean the same
    // thing to the caller and none of them should say which.
    throw new Error(
      "This connection could not be opened — reconnect the account in the admin's Tasks tab."
    );
  }
}

/* ---------------- the consent round trip ---------------- */

const STATE_TTL_MS = 10 * 60 * 1000;

export function makeState({ provider, uid, redirectUri }) {
  return seal(
    { provider, uid, redirectUri, nonce: crypto.randomUUID(), exp: Date.now() + STATE_TTL_MS },
    "state"
  );
}

export function readState(blob) {
  const s = unseal(blob, "state");
  if (!s?.exp || s.exp < Date.now()) {
    const e = new Error("This sign-in link expired. Start the connection again.");
    e.status = 400;
    throw e;
  }
  return s;
}

// The redirect URI must match what is registered with the provider EXACTLY,
// so it is derived from the request rather than guessed, and forced to https
// anywhere that is not localhost.
export function redirectUriFor(req, provider) {
  const envBase = process.env.NEXT_PUBLIC_SITE_URL || "";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const base = envBase && !local ? envBase.replace(/\/+$/, "") : `${local ? "http" : "https"}://${host}`;
  return `${base}/api/integrations/${provider}/callback`;
}

export function authorizeUrl({ provider, clientId, redirectUri, state }) {
  const p = getProvider(provider);
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: p.scopes.join(" "),
    state,
    // Pin the account. Google and Microsoft take `login_hint` and an address;
    // GitHub takes `login` and a handle. Offering whichever account the
    // browser happens to be signed into is how you connect the wrong one.
    // LinkedIn accepts neither, so it is checked after consent instead.
    ...(p.noAccountHint
      ? {}
      : { [p.loginParam || "login_hint"]: p.pinnedAccount ? p.pinnedAccount() : PINNED_EMAIL }),
    ...p.extraAuthParams,
  });
  return `${p.authUrl}?${q.toString()}`;
}

async function postForm(url, params, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json.error_description || json.error || `HTTP ${res.status}`;
    throw new Error(String(detail));
  }
  return json;
}

// The email is read from the id_token's payload rather than a second API call:
// both providers return one, and it is only used to show WHICH account is
// connected and to refuse the wrong one. The signature is not verified because
// the token came straight from the provider's own token endpoint over TLS, in
// response to a code we issued — there is no third party in the exchange.
// GitHub has no id_token; the handle comes from the API with the new token.
async function githubLogin(accessToken) {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) return "";
    return (await res.json())?.login || "";
  } catch (_) {
    return "";
  }
}

// LinkedIn's OIDC userinfo. This is also the ONLY profile read available
// without a partnership: name, picture, email and the person id (`sub`) that
// every post has to be authored by. Headline, positions and skills are not
// in it and cannot be fetched — see lib/server/linkedin.js.
async function linkedinIdentity(accessToken) {
  try {
    const res = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return "";
    const u = await res.json();
    return u.email || u.name || "";
  } catch (_) {
    return "";
  }
}

// Which "who is this" call to make for a provider that has no id_token.
const identityFor = (id, token) =>
  id === "github" ? githubLogin(token) : id === "linkedin" ? linkedinIdentity(token) : "";

function emailFromIdToken(idToken) {
  try {
    const part = String(idToken).split(".")[1];
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return payload.email || payload.preferred_username || payload.upn || "";
  } catch (_) {
    return "";
  }
}

export async function exchangeCode({ provider, code, redirectUri }) {
  const cfg = providerConfig(provider);
  if (!cfg.configured) {
    throw new Error(`${cfg.label} is not configured here (missing ${cfg.missing.join(", ")}).`);
  }
  const p = getProvider(provider);
  const json = await postForm(
    p.tokenUrl,
    {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    },
    p.tokenHeaders
  );

  // A provider whose token does not expire has nothing to refresh: the access
  // token IS the durable credential, so that is what gets sealed. Demanding a
  // refresh token here would reject GitHub outright.
  //
  // LinkedIn lands here too, and it is the awkward case — it returns a refresh
  // token only for approved Marketing Developer Platform partners. So take
  // whichever arrives: a refresh token if there is one (and then it behaves
  // like Google), otherwise the access token plus the expiry LinkedIn states,
  // so the panel can count down rather than find out when a post fails.
  if (p.longLived) {
    if (!json.access_token) {
      throw new Error(
        json.error_description || `${cfg.label} returned no access token.`
      );
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || null,
      expiresAt: json.expires_in
        ? new Date(Date.now() + Number(json.expires_in) * 1000).toISOString()
        : "",
      email: await identityFor(p.id, json.access_token),
      scope: json.scope || p.scopes.join(" "),
    };
  }

  if (!json.refresh_token) {
    // Google does this on a repeat authorisation without prompt=consent, and
    // the result is a connection that dies in an hour and looks fine until it
    // does. Fail loudly instead.
    throw new Error(
      `${cfg.label} returned no refresh token. Remove this app's access in the account's security settings and connect again.`
    );
  }

  const email = emailFromIdToken(json.id_token);
  return {
    refreshToken: json.refresh_token,
    email,
    scope: json.scope || p.scopes.join(" "),
  };
}

// Swaps a stored refresh token for a short-lived access token. Called by the
// panel (through /api/integrations/[provider]/token) and by the MCP tools, so
// there is one place that knows how a connection becomes a credential.
export async function accessTokenFromRefresh({ provider, refreshToken }) {
  const cfg = providerConfig(provider);
  if (!cfg.configured) {
    throw new Error(`${cfg.label} is not configured here (missing ${cfg.missing.join(", ")}).`);
  }
  const p = getProvider(provider);
  const json = await postForm(
    p.tokenUrl,
    {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      // Microsoft requires the scope on a refresh; Google ignores it.
      scope: p.scopes.filter((s) => s !== "offline_access").join(" "),
    },
    p.tokenHeaders
  );
  if (!json.access_token) throw new Error(`${cfg.label} returned no access token.`);
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + (Number(json.expires_in) || 3600) * 1000).toISOString(),
    // Microsoft rotates the refresh token on every use and expects the caller
    // to keep the new one. Google returns none and the old one stays valid.
    rotatedRefreshToken: json.refresh_token || null,
  };
}

/* ---------------- what the stored document looks like ---------------- */

export const docPathFor = (provider) => `integrations/${getProvider(provider).docId}`;

// Built on the server, written by the browser. `secret` is the sealed refresh
// token: opaque to everything except this deployment's INTEGRATION_SECRET.
export function connectionRecord({ provider, sealed, email, scope, kind, expiresAt }) {
  const p = getProvider(provider);
  return {
    provider: p.id,
    secret: sealed,
    // For GitHub this is the handle rather than an address; the panel just
    // shows it, so one field carries either.
    email: email || "",
    scope: scope || "",
    // What is actually sealed inside. Passed in rather than inferred from the
    // provider table, because LinkedIn is BOTH: a refresh token if the app is
    // an approved partner, a 60-day access token if it is not, and the reader
    // must not have to guess which.
    kind: kind || (p.longLived ? "access" : "refresh"),
    // Only meaningful for a sealed access token. A sealed refresh token has no
    // useful expiry to show.
    expiresAt: expiresAt || "",
    connectedAt: new Date().toISOString(),
  };
}
