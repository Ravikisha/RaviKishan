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
//
// EVERYTHING HERE IS PER ORG
// --------------------------
// Each answer above is given INSIDE the org the request is acting in (see
// orgContext.js): the pool is the org's accounts, the defaults are the org's
// defaults, the identities are the org's people. Every function takes an
// explicit `{ org }` too, so the Orgs panel, the migration and the tests can
// name one — the request's org is only the fallback. Legacy rows are Relax's
// alone, because their store has one document per provider and no room to
// say whose it is.
import { getDocument, listDocuments, patchDocument } from "./firestoreRest.js";
import { getProvider, PROVIDERS, providerConfig } from "./integrations.js";
import {
  ConnectedAuthError,
  accountDocId,
  connectedToken,
  listAccounts,
} from "./connectedStore.js";
import { accessTokenFor, readConnection } from "./connectedAccount.js";
import { DEFAULT_ORG, defaultsPathFor, identityIdIn, orgIdsOf } from "./orgShape.js";
import { currentOrg, ensureOrgKnown, orgSource } from "./orgContext.js";
import { signInOf, secretVisibleIn } from "./secretStore.js";

export { ConnectedAuthError };

// Relax's defaults document — the one every saved default already lives in.
// Other orgs use a sibling (defaultsPathFor in orgShape.js).
export const DEFAULTS_PATH = defaultsPathFor(DEFAULT_ORG);
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
  mail: { id: "mail", label: "Mail", providers: ["gmail", "outlook"], verbs: ["read", "write"], analytics: true },
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

// `org` decides which person the row is grouped under — an account shared by
// two orgs can be filed under a different person in each (identityIdIn).
export function accountShape(row, org) {
  return {
    key: `${row.provider}__${row.accountId}`,
    provider: row.provider,
    accountId: row.accountId,
    label: row.label || row.accountId,
    email: row.email || "",
    identityId: identityIdIn(row, org || currentOrg()),
    kind: row.kind || "refresh",
    expiresAt: row.expiresAt || "",
    scope: row.scope || "",
    connectedAt: row.connectedAt || "",
    legacy: !!row.legacy,
    agentReadable: row.agentReadable === true,
    // Which orgs this account serves. Missing means Relax.
    orgIds: orgIdsOf(row),
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
//
// Scoped to one org: `{ org }` names it, otherwise the request's. The org is
// checked to EXIST first and outside any catch — an unknown org must be
// refused, not reported as an org with nothing connected. `{ allOrgs: true }`
// returns every account (the Orgs panel's roster and the migration only).
export async function allAccounts(idToken, provider, { org, allOrgs = false } = {}) {
  const want = provider ? getProvider(provider).id : "";
  const ids = want ? [want] : Object.keys(PROVIDERS);
  const orgId = org || currentOrg();
  if (!org && !allOrgs) await ensureOrgKnown(idToken);

  const modern = (await listAccounts(idToken, undefined, { org: orgId, allOrgs }).catch(() => []))
    .filter((a) => !want || a.provider === want)
    .map((a) => accountShape({ ...a, email: a.email || a.label }, orgId));

  const legacy = [];
  // The legacy store is Relax's alone; in any other org there is nothing to read.
  const legacyIds = allOrgs || orgId === DEFAULT_ORG ? ids : [];
  for (const id of legacyIds) {
    // A pasted-token provider was born multi-account; there is no legacy row to find.
    if (PROVIDERS[id].auth === "apiKey") continue;
    // A provider with no client credentials cannot have a usable connection,
    // and asking Firestore for one costs a round trip to learn nothing.
    if (!providerConfig(id).configured) continue;
    const conn = await readConnection(idToken, id, { org: DEFAULT_ORG }).catch(() => null);
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
        orgIds: [DEFAULT_ORG],
      }, DEFAULT_ORG)
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
//
// Identities are per org: Acme's people are not Relax's. An identity with no
// `orgId` predates orgs and is Relax's.
export const identityOrg = (row) => (row && row.orgId) || DEFAULT_ORG;

export async function listIdentities(idToken, { org, allOrgs = false } = {}) {
  const orgId = org || currentOrg();
  if (!org && !allOrgs) await ensureOrgKnown(idToken);
  const rows = await listDocuments(idToken, IDENTITIES, { pageSize: 100 }).catch(() => []);
  return rows
    .map((r) => ({
      id: r.__name || r.id || "",
      label: r.label || "",
      email: r.email || "",
      note: r.note || "",
      createdAt: r.createdAt || "",
      orgId: identityOrg(r),
    }))
    .filter((i) => i.id && (allOrgs || i.orgId === orgId))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/* ------------------------------------------------------------------ *
 * Defaults — which account a service uses when nobody says            *
 * ------------------------------------------------------------------ */

// One document per org. Relax keeps `config/accountDefaults`, so every
// default saved before orgs existed is still Relax's and nothing moved.
export async function readDefaults(idToken, { org } = {}) {
  const orgId = org || currentOrg();
  if (!org) await ensureOrgKnown(idToken);
  const doc = await getDocument(idToken, defaultsPathFor(orgId)).catch(() => null);
  const out = {};
  for (const [k, v] of Object.entries(doc || {})) {
    // `id` is the document's own name, added by the REST reader — not a service.
    if (k !== "id" && typeof v === "string" && v) out[k] = v;
  }
  return out;
}

// A default must name an account that can actually serve the job IN THIS
// ORG. Accepting anything would let Acme's default point at Relax's channel —
// and then every unnamed call in Acme would act as Relax. Refused at the
// moment of setting rather than at the moment of use, when it is too late.
// An empty key clears the default and needs no check.
export async function writeDefault(idToken, service, key, { org } = {}) {
  if (!SERVICES[service]) {
    throw new ConnectedAuthError(
      `Unknown service "${service}". Known: ${Object.keys(SERVICES).join(", ")}.`,
      { code: "account/unknown-service" }
    );
  }
  const orgId = org || currentOrg();
  if (!org) await ensureOrgKnown(idToken);
  const want = String(key || "");
  if (want) {
    const pool = (await allAccounts(idToken, undefined, { org: orgId })).filter((a) =>
      SERVICES[service].providers.includes(a.provider)
    );
    if (!pool.some((a) => a.key === want)) {
      const e = new ConnectedAuthError(
        `"${want}" is not an account in ${orgId} that can do ${SERVICES[service].label}. In ${orgId}: ${
          pool.map((a) => a.key).join(", ") || "none connected"
        }.`,
        { code: "account/unknown" }
      );
      e.orgId = orgId;
      throw e;
    }
  }
  await patchDocument(idToken, defaultsPathFor(orgId), { [service]: want });
  return { service, key: want, orgId };
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
//
// `orgId` is only a label here: the CALLER has already narrowed `accounts` to
// one org. It is stamped on every result and every refusal, because "no
// account is connected" means something quite different in Acme than in
// Relax, and a model acting in the wrong org must be able to see that it is.
export function chooseAccount(accounts, { service, provider, accountId, defaults = {}, orgId } = {}) {
  const svc = service ? SERVICES[service] : null;
  const providers = poolFor({ service, provider });
  const pool = (accounts || []).filter((a) => providers.includes(a.provider));
  const org = orgId || DEFAULT_ORG;
  // Named only when it is not the default, so a single-org setup reads exactly
  // as it always did.
  const inOrgText = orgId && orgId !== DEFAULT_ORG ? ` in ${orgId}` : "";
  const refuse = (message, opts) => {
    const e = new ConnectedAuthError(message, opts);
    e.orgId = org;
    return e;
  };

  if (accountId) {
    const hit = pool.find((a) => a.accountId === accountId || a.key === accountId);
    if (!hit) {
      throw refuse(
        `No connected account "${accountId}"${
          provider ? ` for ${getProvider(provider).label}` : ""
        }${inOrgText}. Connected: ${pool.map((a) => a.accountId).join(", ") || "none"}.`,
        { provider: provider || "", accountId, code: "account/unknown" }
      );
    }
    return { ...hit, chosenBy: "explicit", orgId: org };
  }

  if (svc) {
    const want = defaults[svc.id];
    // A job done by several providers (ml: huggingface + kaggle) has ONE
    // default. When the caller names a provider and the default belongs to a
    // different one, the default simply does not speak to this request — it
    // is not stale, and treating it as stale broke every Kaggle tool the
    // moment an HF account was made the ML default.
    const wantProvider = want ? String(want).split("__")[0] : "";
    const otherProvider = !!(provider && PROVIDERS[wantProvider] && !providers.includes(wantProvider));
    if (want && !otherProvider) {
      const hit = pool.find((a) => a.key === want || a.accountId === want);
      // A default pointing at an account that has since been disconnected is
      // reported, not silently ignored: falling through to "the only one
      // there is" would act as somebody the setting did not name.
      if (!hit) {
        throw refuse(
          `The default account for ${svc.label}${inOrgText} ("${want}") is not connected any more. Pick another in Accounts.`,
          { code: "account/stale-default" }
        );
      }
      return { ...hit, chosenBy: "default", orgId: org };
    }
  }

  if (pool.length === 1) return { ...pool[0], chosenBy: "only", orgId: org };
  if (pool.length === 0) {
    throw refuse(
      `No account is connected for ${svc ? svc.label : providers.join(", ")}${inOrgText}. Connect one in Accounts.`,
      { code: "account/none" }
    );
  }
  throw refuse(
    `${pool.length} accounts could do this${inOrgText} — name one, or set a default for ${
      svc ? svc.label : "this provider"
    }. Connected: ${pool.map((a) => `${a.label} (${a.accountId})`).join(", ")}.`,
    { code: "account/ambiguous" }
  );
}

export async function resolveAccount(idToken, { service, provider, accountId, org } = {}) {
  // poolFor first so an unknown service is refused before a round trip.
  poolFor({ service, provider });
  const orgId = org || currentOrg();
  if (!org) await ensureOrgKnown(idToken);
  const [accounts, defaults] = await Promise.all([
    allAccounts(idToken, undefined, { org: orgId }),
    service ? readDefaults(idToken, { org: orgId }) : Promise.resolve({}),
  ]);
  const hit = chooseAccount(accounts, { service, provider, accountId, defaults, orgId });
  // `orgSource` says whether anybody actually ASKED for this org, or the
  // request simply fell through to the default — the same reason `chosenBy`
  // exists.
  return { ...hit, orgId, orgSource: org ? "explicit" : orgSource() };
}

// A usable access token for a resolved account, whichever store it lives in.
// The legacy path cannot name an account because that store holds one per
// provider — which is exactly why it is being replaced.
export async function tokenFor(idToken, { service, provider, accountId, org } = {}) {
  const account = await resolveAccount(idToken, { service, provider, accountId, org });
  if (account.legacy) {
    // accessTokenFor returns the token string itself — destructuring it gave
    // every legacy caller `undefined`.
    const token = await accessTokenFor(idToken, account.provider);
    return { token, account };
  }
  // The org is passed down, so connectedToken's own membership check agrees
  // with the resolution that just happened rather than re-deriving it.
  const { token } = await connectedToken(idToken, account.provider, account.accountId, {
    org: account.orgId,
  });
  return { token, account };
}

// Is this account a member of the org? For callers that address an account
// by name and are about to do something the resolution rule does not cover —
// reading a saved sign-in, flipping a flag, filing it under an identity.
// Without it a caller in Acme can name Relax's account and reach its
// password. Returns the account row; refuses with `account/other-org` when it
// exists elsewhere and `account/unknown` when it does not exist at all.
export async function assertAccountInOrg(idToken, provider, accountId, { org } = {}) {
  const p = getProvider(provider);
  const orgId = org || currentOrg();
  if (!org) await ensureOrgKnown(idToken);
  const id = String(accountId || "");
  const match = (a) => a.accountId === id || a.key === id;
  const pool = await allAccounts(idToken, p.id, { org: orgId });
  const hit = pool.find(match);
  if (hit) return { ...hit, orgId };
  const everywhere = await allAccounts(idToken, p.id, { allOrgs: true }).catch(() => []);
  const elsewhere = everywhere.find(match);
  const e = elsewhere
    ? new ConnectedAuthError(
        `${p.label} account "${elsewhere.label}" belongs to ${elsewhere.orgIds.join(", ")}, not ${orgId}. Add it to ${orgId} in the Orgs tab, or switch org.`,
        { provider: p.id, accountId: id, code: "account/other-org" }
      )
    : new ConnectedAuthError(`No ${p.label} account "${id}" is connected in ${orgId}.`, {
        provider: p.id,
        accountId: id,
        code: "account/unknown",
      });
  e.orgId = orgId;
  throw e;
}

// What secretStore.secretVisibleIn needs to decide a saved sign-in: the
// accounts in this org, and the accounts connected anywhere. Read once per
// call so a listing of fifty secrets costs two reads, not fifty.
export async function signInMembership(idToken, { org } = {}) {
  const orgId = org || currentOrg();
  if (!org) await ensureOrgKnown(idToken);
  const [here, everywhere] = await Promise.all([
    allAccounts(idToken, undefined, { org: orgId }),
    allAccounts(idToken, undefined, { allOrgs: true }),
  ]);
  return {
    here: new Set(here.map((a) => a.key)),
    anywhere: new Set(everywhere.map((a) => a.key)),
  };
}

// One secret: only a sign-in needs the directory read.
export async function secretVisible(idToken, doc, { org } = {}) {
  const orgId = org || currentOrg();
  if (!doc) return false;
  const membership = signInOf(doc) ? await signInMembership(idToken, { org: orgId }) : {};
  return secretVisibleIn(doc, orgId, membership);
}

/* ------------------------------------------------------------------ *
 * Scope drift                                                      *
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
