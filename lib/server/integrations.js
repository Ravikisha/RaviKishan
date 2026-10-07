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
    // Several Google accounts, like every other provider here. The consent
    // screen must therefore be allowed to offer a different account each time,
    // so no login_hint is pinned — see `noAccountHint` below.
    multi: true,
    identityFromIdToken: true,
    noAccountHint: true,
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
    multi: true,
    identityFromIdToken: true,
    noAccountHint: true,
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
    multi: true,
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    // Full management of the owner's own accounts (owner's decision, 7 Oct
    // 2026): `repo` reaches private repositories and their traffic, `user`
    // edits the profile, `workflow` lets a file write touch .github/workflows
    // (GitHub refuses that path without it), `read:org` lists organisations,
    // `gist` and `notifications` round out what the account can do.
    //
    // Still deliberately ABSENT: `delete_repo` and `admin:org`. A deleted
    // repository is gone with its stars and issues, and nothing here should be
    // able to do that from a chat client. Add it here if that ever changes —
    // `mcp:check` asserts no tool deletes a repository either way.
    scopes: ["repo", "user", "workflow", "read:org", "gist", "notifications"],
    env: { id: "GITHUB_CLIENT_ID", secret: "GITHUB_CLIENT_SECRET" },
    docId: "github",
    // GitHub's account chooser. Without it, consent silently authorises
    // whichever account the browser is signed into — so connecting a SECOND
    // account would just reconnect the first.
    extraAuthParams: { prompt: "select_account" },
    // A classic GitHub OAuth app issues a token that does not expire and has
    // NO refresh token. So the access token itself is what gets sealed, and
    // there is nothing to refresh — see `longLived` in connectedAccount.js.
    longLived: true,
    // GitHub's token endpoint answers form-encoded unless asked otherwise.
    tokenHeaders: { Accept: "application/json" },
    // And it pins the account with `login`, not `login_hint`. The pin is OFF
    // now that several GitHub accounts can be held: a consent screen that
    // always offers one handle cannot connect the second.
    loginParam: "login",
    noAccountHint: true,
    pinnedAccount: () => PINNED_GITHUB_LOGIN,
  },
  // ---- the social providers ----
  //
  // These three differ from the four above in one structural way: you can be
  // signed in to SEVERAL of each. So they are `multi`, and their connections
  // live one-per-account in the connectedAccounts collection rather than one
  // per provider in integrations/. See lib/server/connectedStore.js.
  youtube: {
    id: "youtube",
    label: "YouTube",
    multi: true,
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // force-ssl is what allows writes (video metadata, playlists, comments);
    // readonly alone cannot update a thing.
    scopes: [
      "https://www.googleapis.com/auth/youtube.force-ssl",
      "https://www.googleapis.com/auth/youtube.readonly",
      // Channel reporting lives behind its own API and its own scope. A
      // connection made before this was added still works for everything else
      // and reports `scope` without it, which is what the panel reads to say
      // "reconnect to see analytics" rather than failing a report with 403.
      "https://www.googleapis.com/auth/yt-analytics.readonly",
      "openid",
      "email",
    ],
    env: { id: "YOUTUBE_CLIENT_ID", secret: "YOUTUBE_CLIENT_SECRET" },
    borrowsFrom: { id: "GOOGLE_TASKS_CLIENT_ID", secret: "GOOGLE_TASKS_CLIENT_SECRET" },
    docId: "youtube",
    // Same two load-bearing parameters as the Google Tasks provider: without
    // offline there is no refresh token at all, and without consent a repeat
    // authorisation silently returns an access token only.
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    // Several channels means the consent screen must be allowed to offer a
    // different account each time, so no login_hint is pinned here.
    noAccountHint: true,
  },
  instagram: {
    id: "instagram",
    label: "Instagram",
    multi: true,
    // Instagram Login (business), not Facebook Login: it needs no linked
    // Facebook Page. Personal accounts cannot be used at all — the Basic
    // Display API that served them was shut down on 4 December 2024, so this
    // only works with a Professional (Business or Creator) account.
    authUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    scopes: [
      "instagram_business_basic",
      "instagram_business_content_publish",
      // Reach, impressions and profile views. Read-only, and the only way to
      // answer "how did that post do" without a Facebook Page.
      "instagram_business_manage_insights",
    ],
    env: { id: "INSTAGRAM_CLIENT_ID", secret: "INSTAGRAM_CLIENT_SECRET" },
    docId: "instagram",
    extraAuthParams: {},
    noAccountHint: true,
    // The token endpoint is form-POSTed and answers a SHORT-lived token that
    // must then be exchanged for a 60-day one. `postExchange` does that second
    // leg; without it the connection would die in an hour.
    tokenPostStyle: "instagram",
    longLived: true,
  },
  x: {
    id: "x",
    label: "X",
    multi: true,
    authUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    // offline.access is what makes X issue a refresh token.
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    env: { id: "X_CLIENT_ID", secret: "X_CLIENT_SECRET" },
    docId: "x",
    extraAuthParams: {},
    noAccountHint: true,
    // X requires PKCE on every authorization code flow, and authenticates the
    // client with HTTP Basic rather than a body parameter.
    pkce: true,
    basicAuth: true,
  },
  // Google Analytics. Multi-account like the social three — you can hold GA
  // under more than one Google account — and the PROPERTY is chosen inside an
  // account rather than being a connection of its own, because one account
  // commonly owns several properties.
  //
  // GA4 only. Universal Analytics stopped collecting in July 2023 and its data
  // was deleted in July 2024, so there is nothing behind a UA property id.
  analytics: {
    id: "analytics",
    label: "Google Analytics",
    multi: true,
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // readonly deliberately: this section REPORTS. Nothing here should be able
    // to edit a property, change a data stream or delete an account, and the
    // cheapest way to guarantee that is to never hold the scope that could.
    scopes: [
      "https://www.googleapis.com/auth/analytics.readonly",
      "openid",
      "email",
    ],
    env: { id: "ANALYTICS_CLIENT_ID", secret: "ANALYTICS_CLIENT_SECRET" },
    borrowsFrom: { id: "GOOGLE_TASKS_CLIENT_ID", secret: "GOOGLE_TASKS_CLIENT_SECRET" },
    docId: "analytics",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    noAccountHint: true,
    // The account here IS the Google account, and openid+email already carry
    // it. Reading a YouTube channel instead (what the other multi providers
    // do) would refuse a perfectly good Analytics account for not having one.
    identityFromIdToken: true,
  },

  // Added for the Notes integration built in parallel. Notion's token endpoint
  // authenticates the client with HTTP Basic rather than body parameters,
  // which `basicAuth` already handles — it was added for X.
  notion: {
    id: "notion",
    label: "Notion",
    multi: true,
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    // Notion grants capability through the pages the user picks on the consent
    // screen, not through scopes, so it asks for none.
    scopes: [],
    env: { id: "NOTION_CLIENT_ID", secret: "NOTION_CLIENT_SECRET" },
    docId: "notion",
    // Notion's access token does not expire and it issues no refresh token.
    longLived: true,
    basicAuth: true,
    tokenHeaders: { Accept: "application/json" },
    noAccountHint: true,
    extraAuthParams: { owner: "user" },
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    multi: true,
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
  // API-key providers. Neither platform needs an OAuth app for this: a
  // personal token is the documented way in, it is scoped on the provider's
  // own settings page, and pasting it costs no client registration. They are
  // multi-account like everything else; the account is identified by asking
  // the provider who the token belongs to, at connect time.
  huggingface: {
    id: "huggingface",
    label: "Hugging Face",
    multi: true,
    auth: "apiKey",
    noAccountHint: true,
    docId: "huggingface",
    scopes: [],
    env: null,
    keyHint: "hf_… — a write or fine-grained token",
    tokenPage: "https://huggingface.co/settings/tokens",
  },
  kaggle: {
    id: "kaggle",
    label: "Kaggle",
    multi: true,
    auth: "apiKey",
    noAccountHint: true,
    docId: "kaggle",
    scopes: [],
    env: null,
    keyHint: "API token, or the whole kaggle.json",
    tokenPage: "https://www.kaggle.com/settings",
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
  // A pasted-token provider has no client to configure: the only thing it
  // needs from the deployment is the key that seals what is pasted.
  if (p.auth === "apiKey") {
    return {
      id: p.id,
      label: p.label,
      clientId: "",
      clientSecret: "",
      borrowed: "",
      auth: "apiKey",
      configured: isSealConfigured(),
      missing: isSealConfigured() ? [] : ["INTEGRATION_SECRET"],
    };
  }
  let clientId = process.env[p.env.id] || "";
  let clientSecret = process.env[p.env.secret] || "";

  // One Google Cloud OAuth client can serve several Google APIs — the client
  // identifies the APP, while the SCOPES decide what it may reach. So a
  // Google-backed provider falls back to the Google client already configured
  // here rather than demanding a second, identical one.
  //
  // What this does NOT do is grant anything extra: the scope still has to be
  // on the consent screen and the provider's own callback URL still has to be
  // registered, or Google refuses at the consent step. `borrowed` is reported
  // so the panel can say which client it is using instead of leaving someone
  // to wonder why it works without the variable they expected to set.
  let borrowed = "";
  if ((!clientId || !clientSecret) && p.borrowsFrom) {
    const fid = process.env[p.borrowsFrom.id] || "";
    const fsec = process.env[p.borrowsFrom.secret] || "";
    if (fid && fsec) {
      clientId = clientId || fid;
      clientSecret = clientSecret || fsec;
      borrowed = p.borrowsFrom.id;
    }
  }

  return {
    id: p.id,
    label: p.label,
    clientId,
    clientSecret,
    borrowed,
    auth: "oauth",
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

// PKCE. X requires it; anything else that wants it only has to set `pkce`.
// The verifier is sealed INTO the state rather than stored, which keeps the
// no-server-state rule — the state comes back from the provider and the
// verifier comes back with it.
export function makeVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}

export const challengeFor = (verifier) =>
  crypto.createHash("sha256").update(verifier).digest("base64url");

export function makeState({ provider, uid, redirectUri, verifier = "" }) {
  return seal(
    {
      provider,
      uid,
      redirectUri,
      // Sealed, so the browser never sees it and nothing is stored server-side.
      verifier,
      nonce: crypto.randomUUID(),
      exp: Date.now() + STATE_TTL_MS,
    },
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

export function authorizeUrl({ provider, clientId, redirectUri, state, challenge = "" }) {
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
    ...(p.pkce ? { code_challenge: challenge, code_challenge_method: "S256" } : {}),
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
    // BOTH halves, because either one alone can be the useless one. Google
    // answers a dead refresh token with {error: "invalid_grant",
    // error_description: "Bad Request"} — preferring the description threw
    // away the only word that says what happened and left the panel reporting
    // "Bad Request", which sends you auditing the request instead of the
    // token. Microsoft is the mirror image: its error is a generic
    // "invalid_grant" and the description carries the AADSTS code.
    const code = json.error ? String(json.error) : "";
    const desc = json.error_description ? String(json.error_description) : "";
    const detail =
      code && desc && desc !== code ? `${code}: ${desc}` : code || desc || `HTTP ${res.status}`;
    const err = new Error(detail);
    err.oauthError = code;
    throw err;
  }
  return json;
}

// The email is read from the id_token's payload rather than a second API call:
// both providers return one, and it is only used to show WHICH account is
// connected and to refuse the wrong one. The signature is not verified because
// the token came straight from the provider's own token endpoint over TLS, in
// response to a code we issued — there is no third party in the exchange.
// GitHub has no id_token; the handle comes from the API with the new token.
async function githubIdentity(accessToken) {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) return { id: "", label: "" };
    const u = await res.json();
    // The LOGIN is the id, not the numeric one, because every GitHub call in
    // this codebase addresses an account by `owner` — a numeric key would have
    // to be translated back on every use.
    return { id: u?.login || "", label: u?.login ? `@${u.login}` : "" };
  } catch (_) {
    return { id: "", label: "" };
  }
}

const githubLogin = async (t) => (await githubIdentity(t)).id;

// LinkedIn's OIDC userinfo. This is also the ONLY profile read available
// without a partnership: name, picture, email and the person id (`sub`) that
// every post has to be authored by. Headline, positions and skills are not
// in it and cannot be fetched — see lib/server/linkedin.js.
async function linkedinWho(accessToken) {
  try {
    const res = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { id: "", label: "" };
    const u = await res.json();
    // `sub` is the member id every post must be authored by, and it is stable;
    // the address is only what a human reads.
    return { id: u.sub || u.email || "", label: u.email || u.name || "" };
  } catch (_) {
    return { id: "", label: "" };
  }
}

const linkedinIdentity = async (t) => (await linkedinWho(t)).label;

// YouTube: which channel this is. A Google account can own several, and the
// one the consent screen picked is the one that matters.
async function youtubeIdentity(accessToken) {
  try {
    const res = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return { id: "", label: "" };
    const ch = (await res.json())?.items?.[0];
    return { id: ch?.id || "", label: ch?.snippet?.title || "" };
  } catch (_) {
    return { id: "", label: "" };
  }
}

// Instagram hands the user id back with the token itself, so this only needs
// to turn it into a username.
async function instagramIdentity(accessToken, userId) {
  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`
    );
    if (!res.ok) return { id: String(userId || ""), label: "" };
    const u = await res.json();
    return { id: u.id || String(userId || ""), label: u.username ? `@${u.username}` : "" };
  } catch (_) {
    return { id: String(userId || ""), label: "" };
  }
}

async function xIdentity(accessToken) {
  try {
    const res = await fetch("https://api.x.com/2/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { id: "", label: "" };
    const u = (await res.json())?.data;
    return { id: u?.id || "", label: u?.username ? `@${u.username}` : "" };
  } catch (_) {
    return { id: "", label: "" };
  }
}

// Which "who is this" call to make for a provider that has no id_token.
// Who the connected social account is. Returns { id, label }; the id is what
// makes two connections of the same provider distinguishable.
async function socialIdentity(providerId, accessToken, userId, tokenJson = {}) {
  if (providerId === "youtube") return youtubeIdentity(accessToken);
  if (providerId === "instagram") return instagramIdentity(accessToken, userId);
  if (providerId === "x") return xIdentity(accessToken);
  if (providerId === "github") return githubIdentity(accessToken);
  if (providerId === "linkedin") return linkedinWho(accessToken);
  // Notion names the WORKSPACE, not a person: one Notion login can be
  // connected to several workspaces and they are genuinely different
  // connections, so the workspace is the account.
  if (providerId === "notion") {
    return {
      id: String(tokenJson.workspace_id || tokenJson.bot_id || ""),
      label: tokenJson.workspace_name || tokenJson.owner?.user?.name || "",
    };
  }
  return { id: "", label: "" };
}

const identityFor = (id, token) =>
  id === "github" ? githubLogin(token) : id === "linkedin" ? linkedinIdentity(token) : "";

function idTokenPayload(idToken) {
  try {
    const part = String(idToken).split(".")[1];
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch (_) {
    return {};
  }
}

function emailFromIdToken(idToken) {
  const payload = idTokenPayload(idToken);
  return payload.email || payload.preferred_username || payload.upn || "";
}

// For a multi-account provider whose "account" is the GOOGLE ACCOUNT itself,
// the identity is already in the id token and costs no extra call. `sub` is
// the stable Google user id — the address can change, the id cannot — so it
// keys the document and the address is only the label.
//
// This is why Analytics does not reuse the YouTube identity call: that one
// reads a CHANNEL, and an account with no channel would be refused for a
// connection that has nothing to do with YouTube.
function googleAccountIdentity(idToken) {
  const payload = idTokenPayload(idToken);
  const id = payload.sub || payload.email || "";
  return { id: String(id || ""), label: payload.email || String(id || "") };
}

export async function exchangeCode({ provider, code, redirectUri, verifier = "" }) {
  const cfg = providerConfig(provider);
  if (!cfg.configured) {
    throw new Error(`${cfg.label} is not configured here (missing ${cfg.missing.join(", ")}).`);
  }
  const p = getProvider(provider);

  const body = {
    client_id: cfg.clientId,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };
  // X authenticates a confidential client with HTTP Basic and REJECTS the
  // secret in the body; everyone else here wants it in the body.
  const headers = { ...(p.tokenHeaders || {}) };
  if (p.basicAuth) {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`;
  } else {
    body.client_secret = cfg.clientSecret;
  }
  if (p.pkce) body.code_verifier = verifier;

  let json = await postForm(p.tokenUrl, body, headers);

  // Instagram's token endpoint answers a SHORT-lived token (about an hour)
  // and will not issue a refresh token at all. The 60-day token is a second
  // exchange, and skipping it leaves a connection that dies the same morning.
  if (p.tokenPostStyle === "instagram") {
    const shortLived = json.access_token;
    const userId = json.user_id;
    const long = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(
        cfg.clientSecret
      )}&access_token=${encodeURIComponent(shortLived)}`
    ).then((r) => r.json());
    if (!long?.access_token) {
      throw new Error(
        `Instagram would not issue a long-lived token (${long?.error?.message || "no token returned"}).`
      );
    }
    json = {
      access_token: long.access_token,
      expires_in: long.expires_in || 60 * 24 * 3600,
      user_id: userId,
      scope: p.scopes.join(" "),
    };
  }

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
    const who = p.identityFromIdToken
      ? googleAccountIdentity(json.id_token)
      : await socialIdentity(p.id, json.access_token, json.user_id, json);
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || null,
      expiresAt: json.expires_in
        ? new Date(Date.now() + Number(json.expires_in) * 1000).toISOString()
        : "",
      email: who.label || (await identityFor(p.id, json.access_token)),
      accountId: who.id || "",
      accountLabel: who.label || "",
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
  // A multi-account provider needs to know WHICH account consented, because
  // the whole point is that there can be several.
  const who = p.identityFromIdToken
    ? googleAccountIdentity(json.id_token)
    : await socialIdentity(p.id, json.access_token, json.user_id, json);
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token || "",
    expiresAt: json.expires_in
      ? new Date(Date.now() + Number(json.expires_in) * 1000).toISOString()
      : "",
    email: who.label || email,
    accountId: who.id || "",
    accountLabel: who.label || "",
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
  const body = {
    client_id: cfg.clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    // Microsoft requires the scope on a refresh; Google ignores it.
    scope: p.scopes.filter((s) => s !== "offline_access").join(" "),
  };
  const headers = { ...(p.tokenHeaders || {}) };
  if (p.basicAuth) {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`;
  } else {
    body.client_secret = cfg.clientSecret;
  }
  const json = await postForm(p.tokenUrl, body, headers);
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
