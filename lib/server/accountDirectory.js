// SERVER ONLY. The authentication centre: one view of every account this
// deployment can act as, across every provider.
//
// WHY THIS EXISTS
// ---------------
// Connections grew provider by provider, and each one answered "am I
// connected" on its own terms: Tasks asked `integrations/googleTasks`, the
// social panel asked `connectedAccounts/`, GitHub asked a third thing. That is
// fine while there is one of each. It stops being fine the moment the answer
// is "I have two Google accounts, three GitHub handles and four Instagram
// profiles, and I want to say WHICH one does this" — because there is then no
// place that knows the full list, and no place that can be asked.
//
// So this module is the only thing that answers:
//
//   who can I act as?        -> allAccounts()
//   who should I act as?     -> resolveAccount()  (explicit > default > sole)
//   get me a token for them  -> tokenFor()
//
// Everything else — the panels, the API routes, the MCP tools — goes through
// it rather than keeping its own idea of the list.
//
// TWO STORES, ON PURPOSE
// ----------------------
// Every provider is now multi-account, so a NEW connection always lands in
// `connectedAccounts/<provider>__<accountId>`. But four providers were
// single-account when they were connected, and their credential still sits in
// `integrations/<docId>` with no account id at all. Deleting those would
// disconnect live accounts to tidy a schema, so they are READ here as
// first-class rows, marked `legacy`, keyed by whatever identifies them
// (an address, a handle), and upgraded in place the next time they are
// connected. Nothing has to be migrated by hand and nothing breaks in between.
import { getDocument, listDocuments, patchDocument } from "./firestoreRest.js";
import { getProvider, PROVIDERS, providerConfig } from "./integrations.js";
import {
  ConnectedAuthError,
  accountDocId,
  connectedToken,
  listAccounts,
} from "./connectedStore.js";
import { accessTokenFor, readConnection } from "./connectedAccount.js";

export { ConnectedAuthError };

export const DEFAULTS_PATH = "config/accountDefaults";
export const IDENTITIES = "identities";

/* ------------------------------------------------------------------ *
 * Services                                                            *
 * ------------------------------------------------------------------ *
 * A SERVICE is a thing you want done — post to Instagram, read channel
 * analytics, manage tasks. A PROVIDER is the account that can do it.
 * They are not the same: one Google account serves Tasks, YouTube and
 * Analytics, and each of those is chosen separately because they are
 * separate decisions. Picking a default "Google account" would be the
 * wrong granularity — you may well report on one property while
 * uploading to another channel.
 *
 * `analytics: true` means the service answers "how did it do", which is
 * what the Insights surface iterates over.
 */
export const SERVICES = {
  tasks: { id: "tasks", label: "Tasks", providers: ["google", "microsoft"], verbs: ["read", "write"] },
  notes: { id: "notes", label: "Notes", providers: ["notion", "github"], verbs: ["read", "write"] },
  code: { id: "code", label: "Code", providers: ["github"], verbs: ["read", "write"], analytics: true },
  video: { id: "video", label: "Video", providers: ["youtube"], verbs: ["read", "write"], analytics: true },
  photos: { id: "photos", label: "Photos & reels", providers: ["instagram"], verbs: ["read", "write"], analytics: true },
  posts: { id: "posts", label: "Short posts", providers: ["x"], verbs: ["read", "write"] },
  professional: { id: "professional", label: "Professional", providers: ["linkedin"], verbs: ["write"] },
  siteAnalytics: { id: "siteAnalytics", label: "Site analytics", providers: ["analytics"], verbs: ["read"], analytics: true },
  ml: { id: "ml", label: "ML lab", providers: ["huggingface", "kaggle"], verbs: ["read", "write"], analytics: true },
};

export const servicesFor = (provider) =>
  Object.values(SERVICES).filter((s) => s.providers.includes(getProvider(provider).id));

/* ------------------------------------------------------------------ *
 * Reading every account                                               *
 * ------------------------------------------------------------------ */

// What identifies a legacy single-account connection. It has no accountId —
// that field did not exist when it was written — so the address or handle it
// DID record stands in. Falling back to the provider id keeps a row that has
// neither from being nameless and unselectable.
const legacyIdFor = (provider, conn) =>
  conn.email || conn.accountId || `legacy:${getProvider(provider).id}`;

export function accountShape(row) {
  return {
    key: `${row.provider}__${row.accountId}`,
    provider: row.provider,
    accountId: row.accountId,
    label: row.label || row.accountId,
    email: row.email || "",
    identityId: row.identityId || "",
    kind: row.kind || "refresh",
    expiresAt: row.expiresAt || "",
    scope: row.scope || "",
    connectedAt: row.connectedAt || "",
    legacy: !!row.legacy,
    agentReadable: row.agentReadable === true,
    // Days left, or null when the credential refreshes itself and the
    // question does not apply.
    expiresInDays:
      row.kind === "access" && row.expiresAt
        ? Math.floor((Date.parse(row.expiresAt) - Date.now()) / 86400000)
        : null,
  };
}

// Every account, from both stores, for every provider — or for one.
//
// A legacy row is dropped when a per-account row already exists for the same
// provider AND address, because that is the same account after an upgrade and
// showing it twice would make "which one am I using" unanswerable.
export async function allAccounts(idToken, provider) {
  const want = provider ? getProvider(provider).id : "";
  const ids = want ? [want] : Object.keys(PROVIDERS);

  const modern = (await listAccounts(idToken).catch(() => []))
    .filter((a) => !want || a.provider === want)
    .map((a) => accountShape({ ...a, email: a.email || a.label }));

  const legacy = [];
  for (const id of ids) {
    // A pasted-token provider was born multi-account; there is no legacy row to find.
    if (PROVIDERS[id].auth === "apiKey") continue;
    // A provider with no client credentials cannot have a usable connection,
    // and asking Firestore for one costs a round trip to learn nothing.
    if (!providerConfig(id).configured) continue;
    const conn = await readConnection(idToken, id).catch(() => null);
    if (!conn) continue;
    const accountId = legacyIdFor(id, conn);
    const already = modern.some(
      (m) => m.provider === id && (m.accountId === accountId || (conn.email && m.email === conn.email))
    );
    if (already) continue;
    legacy.push(
      accountShape({
        provider: id,
        accountId,
        label: conn.email || getProvider(id).label,
        email: conn.email || "",
        kind: conn.legacy ? "access" : "refresh",
        expiresAt: conn.expiresAt || "",
        scope: conn.scope || "",
        connectedAt: conn.connectedAt || "",
        legacy: true,
      })
    );
  }

  return [...modern, ...legacy].sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label)
  );
}

/* ------------------------------------------------------------------ *
 * Identities — the person an account belongs to                       *
 * ------------------------------------------------------------------ */

// An identity is "me, personal" or "me, work": a label you put accounts under
// so a list of fourteen connections reads as two people rather than as
// fourteen unrelated rows. It holds no credential and grants nothing; it is
// purely how the list is grouped.
export async function listIdentities(idToken) {
  const rows = await listDocuments(idToken, IDENTITIES, { pageSize: 100 }).catch(() => []);
  return rows
    .map((r) => ({
      id: r.__name || r.id || "",
      label: r.label || "",
      email: r.email || "",
      note: r.note || "",
      createdAt: r.createdAt || "",
    }))
    .filter((i) => i.id)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/* ------------------------------------------------------------------ *
 * Defaults — which account a service uses when nobody says            *
 * ------------------------------------------------------------------ */

export async function readDefaults(idToken) {
  const doc = await getDocument(idToken, DEFAULTS_PATH).catch(() => null);
  const out = {};
  for (const [k, v] of Object.entries(doc || {})) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

export async function writeDefault(idToken, service, key) {
  if (!SERVICES[service]) {
    throw new ConnectedAuthError(
      `Unknown service "${service}". Known: ${Object.keys(SERVICES).join(", ")}.`,
      { code: "account/unknown-service" }
    );
  }
  await patchDocument(idToken, DEFAULTS_PATH, { [service]: String(key || "") });
  return { service, key: String(key || "") };
}

/* ------------------------------------------------------------------ *
 * Resolution — the whole point                                        *
 * ------------------------------------------------------------------ */

// Which account should do this, and why that one.
//
// The order is explicit > default > the only one there is, and the reason is
// RETURNED rather than being left to be guessed: a caller that posted to the
// wrong handle needs to be able to see which rule chose it. When nothing
// decides, this refuses and lists the candidates — guessing between two
// Instagram accounts is a public post that cannot be quietly undone.
// Which providers could serve this request. Pure.
export function poolFor({ service, provider } = {}) {
  if (service && !SERVICES[service]) {
    throw new ConnectedAuthError(
      `Unknown service "${service}". Known: ${Object.keys(SERVICES).join(", ")}.`,
      { code: "account/unknown-service" }
    );
  }
  if (provider) return [getProvider(provider).id];
  if (service) return SERVICES[service].providers;
  return Object.keys(PROVIDERS);
}

// THE RULE, with no I/O, so it can be tested exhaustively: every ordering,
// every refusal, every message. `resolveAccount` below is the three-line shell
// that fetches what this needs. Same split as repoAudit.js and postText.js,
// for the same reason — two copies of a decision drift within an hour.
export function chooseAccount(accounts, { service, provider, accountId, defaults = {} } = {}) {
  const svc = service ? SERVICES[service] : null;
  const providers = poolFor({ service, provider });
  const pool = (accounts || []).filter((a) => providers.includes(a.provider));

  if (accountId) {
    const hit = pool.find((a) => a.accountId === accountId || a.key === accountId);
    if (!hit) {
      throw new ConnectedAuthError(
        `No connected account "${accountId}"${
          provider ? ` for ${getProvider(provider).label}` : ""
        }. Connected: ${pool.map((a) => a.accountId).join(", ") || "none"}.`,
        { provider: provider || "", accountId, code: "account/unknown" }
      );
    }
    return { ...hit, chosenBy: "explicit" };
  }

  if (svc) {
    const want = defaults[svc.id];
    if (want) {
      const hit = pool.find((a) => a.key === want || a.accountId === want);
      // A default pointing at an account that has since been disconnected is
      // reported, not silently ignored: falling through to "the only one
      // there is" would act as somebody the setting did not name.
      if (!hit) {
        throw new ConnectedAuthError(
          `The default account for ${svc.label} ("${want}") is not connected any more. Pick another in Accounts.`,
          { code: "account/stale-default" }
        );
      }
      return { ...hit, chosenBy: "default" };
    }
  }

  if (pool.length === 1) return { ...pool[0], chosenBy: "only" };
  if (pool.length === 0) {
    throw new ConnectedAuthError(
      `No account is connected for ${svc ? svc.label : providers.join(", ")}. Connect one in Accounts.`,
      { code: "account/none" }
    );
  }
  throw new ConnectedAuthError(
    `${pool.length} accounts could do this — name one, or set a default for ${
      svc ? svc.label : "this provider"
    }. Connected: ${pool.map((a) => `${a.label} (${a.accountId})`).join(", ")}.`,
    { code: "account/ambiguous" }
  );
}

export async function resolveAccount(idToken, { service, provider, accountId } = {}) {
  // poolFor first so an unknown service is refused before a round trip.
  poolFor({ service, provider });
  const [accounts, defaults] = await Promise.all([
    allAccounts(idToken),
    service ? readDefaults(idToken) : Promise.resolve({}),
  ]);
  return chooseAccount(accounts, { service, provider, accountId, defaults });
}

// A usable access token for a resolved account, whichever store it lives in.
// The legacy path cannot name an account because that store holds one per
// provider — which is exactly why it is being replaced.
export async function tokenFor(idToken, { service, provider, accountId } = {}) {
  const account = await resolveAccount(idToken, { service, provider, accountId });
  if (account.legacy) {
    // accessTokenFor returns the token string itself — destructuring it gave
    // every legacy caller `undefined`.
    const token = await accessTokenFor(idToken, account.provider);
    return { token, account };
  }
  const { token } = await connectedToken(idToken, account.provider, account.accountId);
  return { token, account };
}

/* ------------------------------------------------------------------ *
 * Scope drift                                                         *
 * ------------------------------------------------------------------ */

// A connection made before a scope was added keeps working for everything it
// already had and fails ONLY the new thing, with a 403 that names an API
// rather than the reason. So the gap is computed up front and reported as
// "reconnect to gain X", which is a sentence someone can act on.
export function missingScopes(account) {
  const p = PROVIDERS[account.provider];
  if (!p || !p.scopes?.length || !account.scope) return [];
  const held = new Set(String(account.scope).split(/[\s,]+/).filter(Boolean));
  return p.scopes.filter((s) => s !== "openid" && s !== "email" && !held.has(s));
}

export const shortScope = (s) => String(s).split("/").pop() || s;
