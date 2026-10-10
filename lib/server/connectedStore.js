// SERVER ONLY. Connections for providers you can hold SEVERAL of.
//
// The four original providers are one-per-deployment: there is one Google
// Tasks account, one GitHub, one LinkedIn. YouTube, Instagram and X are not
// like that — you can run two channels and three handles — so their
// connections live one document per ACCOUNT in `connectedAccounts/`, keyed
// `<provider>__<accountId>`, instead of one per provider in `integrations/`.
//
// Everything else is deliberately identical to the single-account path: the
// credential is sealed with the same `seal()` under the same
// INTEGRATION_SECRET, the server still never writes it (the browser does,
// under admin-only rules), and refreshing goes through the same
// `accessTokenFromRefresh`. Only the address changes.
//
// Keying on the provider's OWN id for the account — a YouTube channel id, an
// Instagram user id, an X user id — means reconnecting the same account
// UPDATES it rather than silently creating a second row that quietly competes
// with the first.
import { getDocument, listDocuments, listEveryDocument, patchDocument } from "./firestoreRest.js";
import {
  accessTokenFromRefresh,
  getProvider,
  providerConfig,
  seal,
  unseal,
} from "./integrations.js";
import { DEFAULT_ORG, orgIdsOf, unionOrgs } from "./orgShape.js";
import { currentOrg, ensureOrgKnown } from "./orgContext.js";

export const COLLECTION = "connectedAccounts";

export class ConnectedAuthError extends Error {
  constructor(message, { provider, accountId, code = "social/disconnected" } = {}) {
    super(message);
    this.name = "ConnectedAuthError";
    this.provider = provider;
    this.accountId = accountId;
    this.code = code;
  }
}

// Firestore document ids may not contain "/", and a provider account id can be
// almost anything, so it is encoded rather than trusted.
export const accountDocId = (provider, accountId) =>
  `${getProvider(provider).id}__${encodeURIComponent(String(accountId))}`;

export const accountPath = (provider, accountId) =>
  `${COLLECTION}/${accountDocId(provider, accountId)}`;

export function assertMulti(provider) {
  const p = getProvider(provider);
  if (!p.multi) {
    throw new ConnectedAuthError(
      `${p.label} holds a single connection, not one per account — it lives in integrations/, not connectedAccounts/.`,
      { provider: p.id, code: "social/not-multi" }
    );
  }
  return p;
}

// Built on the server, written by the browser — the same split as the
// single-account path: the browser holds a blob it cannot open, the server
// holds a key with nothing attached.
export function connectedRecord({
  provider,
  accountId,
  label,
  sealed,
  kind,
  expiresAt,
  scope,
  email,
  identityId,
  orgIds,
}) {
  const p = assertMulti(provider);
  // Which orgs this account belongs to. The callback passes the org sealed
  // into the OAuth state; anything else is filed under the org the request is
  // acting in. A caller that is reconnecting an EXISTING account must union
  // this with what is stored (see unionOrgs) — writing it as-is would evict
  // the account from every other org that uses it.
  const orgs = unionOrgs([], orgIds && orgIds.length ? orgIds : [currentOrg()]);
  return {
    provider: p.id,
    accountId: String(accountId || ""),
    // What to call it in the interface. Falls back to the id so a row is never
    // nameless.
    label: label || String(accountId || ""),
    secret: sealed,
    kind: kind || "refresh",
    expiresAt: expiresAt || "",
    scope: scope || "",
    // The address is kept beside the provider's own id because it is what
    // groups accounts into PEOPLE. An Instagram handle and a Google address
    // are the same person only if something says so, and this is that thing.
    email: email || "",
    // Which identity (person) this belongs to. Set in the Accounts panel, not
    // at consent time — the provider has no idea.
    identityId: identityId || "",
    orgIds: orgs.length ? orgs : [DEFAULT_ORG],
    connectedAt: new Date().toISOString(),
  };
}

/* ---------------- reading ---------------- */

const shape = (id, d) => ({
  id,
  provider: d.provider,
  accountId: d.accountId || "",
  label: d.label || d.accountId || "",
  email: d.email || "",
  identityId: d.identityId || "",
  // Per-org grouping (orgShape.identityIdIn); the single field above is Relax's legacy answer.
  identityIds: d.identityIds && typeof d.identityIds === "object" && !Array.isArray(d.identityIds) ? d.identityIds : {},
  kind: d.kind || "refresh",
  expiresAt: d.expiresAt || "",
  connectedAt: d.connectedAt || "",
  scope: d.scope || "",
  // Only a pasted-token account can be exported to an agent; a strict true.
  agentReadable: d.agentReadable === true,
  // Missing means Relax: every account connected before orgs existed is
  // Relax's, and saying so here is what lets every filter downstream see it.
  orgIds: orgIdsOf(d),
});

// Which org a read is FOR. An explicit `org` wins (the Orgs panel and the
// migration name one); otherwise the request's own.
const orgFor = (opts = {}) => opts.org || currentOrg();

// Every connected account IN THE CURRENT ORG, optionally for one provider.
// Never returns the sealed secret — nothing outside this file needs it.
//
// The org filter lives HERE and not only in the directory, because several
// callers come straight to this store (the Social and Analytics panels'
// account lists, connectedToken's own fallback). A filter placed one layer up
// would be a filter those callers walk round.
//
// `{ allOrgs: true }` is for the two places that must see across orgs: the
// Orgs panel's roster and the migration. Filtered in JS because Firestore
// cannot match a document whose `orgIds` is simply missing — which is every
// account that predates orgs.
export async function listAccounts(idToken, provider, opts = {}) {
  const org = orgFor(opts);
  // Before the read, and outside its catch: an org that does not exist must
  // be refused, not reported as an org with nothing connected.
  if (!opts.allOrgs && !opts.org) await ensureOrgKnown(idToken);
  // `strict` is for a caller whose safety depends on the WHOLE list (deleting
  // an org): every page, and a failed read throws instead of reading as "no
  // accounts", which would wave the delete through.
  const rows = opts.strict
    ? await listEveryDocument(idToken, COLLECTION)
    : await listDocuments(idToken, COLLECTION, { pageSize: 300 }).catch(() => []);
  return rows
    .map((r) => shape(r.__name || r.id || "", r))
    .filter((a) => a.provider && (!provider || a.provider === getProvider(provider).id))
    .filter((a) => opts.allOrgs || a.orgIds.includes(org))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label));
}

// One account's raw document — refused when it exists but belongs to other
// orgs. Without this an explicit accountId walks past every list filter: the
// caller in Acme names Relax's channel and gets its token.
export async function readAccount(idToken, provider, accountId, opts = {}) {
  const doc = await getDocument(idToken, accountPath(provider, accountId)).catch(() => null);
  if (!doc) return null;
  if (!opts.allOrgs) assertAccountOrg(doc, provider, accountId, orgFor(opts));
  return doc;
}

export function assertAccountOrg(doc, provider, accountId, org = currentOrg()) {
  const ids = orgIdsOf(doc);
  if (ids.includes(org)) return doc;
  throw new ConnectedAuthError(
    `${getProvider(provider).label} account "${doc?.label || accountId}" belongs to ${ids.join(
      ", "
    )}, not ${org}. Add it to ${org} in the Orgs tab, or switch org.`,
    { provider: getProvider(provider).id, accountId, code: "account/other-org" }
  );
}

// Days left on a stored access token, or null when the credential is a refresh
// token and the question does not apply.
export function expiryOf(account) {
  if (account.kind !== "access" || !account.expiresAt) return null;
  const until = Date.parse(account.expiresAt);
  if (!until) return null;
  return Math.floor((until - Date.now()) / 86400000);
}

export async function accountStatus(idToken, provider) {
  const p = assertMulti(provider);
  const cfg = providerConfig(p.id);
  const accounts = cfg.configured ? await listAccounts(idToken, p.id) : [];
  return {
    provider: p.id,
    label: p.label,
    configured: cfg.configured,
    missing: cfg.missing,
    borrowed: cfg.borrowed || "",
    count: accounts.length,
    accounts: accounts.map((a) => {
      const days = expiryOf(a);
      return {
        ...a,
        expiresInDays: days,
        // Instagram's long-lived token is 60 days and dies if unused; saying
        // so beats finding out when a post fails.
        needsReconnect: days !== null && days <= 0,
        warning:
          days !== null && days > 0 && days <= 7
            ? `This connection expires in ${days} day${days === 1 ? "" : "s"}.`
            : "",
      };
    }),
  };
}

/* ---------------- using one ---------------- */

const reconnectHint = (label) =>
  `Open the admin's Social tab and connect ${label} again.`;

// The one call every social tool makes. Resolves ONE account's credential:
// unseals it, refreshes if it is a refresh token, and writes back a rotated
// one when the provider issues it.
export async function connectedToken(idToken, provider, accountId, opts = {}) {
  const p = assertMulti(provider);
  const org = orgFor(opts);
  if (!opts.org) await ensureOrgKnown(idToken);
  const cfg = providerConfig(p.id);
  if (!cfg.configured) {
    throw new ConnectedAuthError(
      `${p.label} is not configured on this deployment (missing ${cfg.missing.join(", ")}).`,
      { provider: p.id, code: "social/not-configured" }
    );
  }
  if (!accountId) {
    const all = await listAccounts(idToken, p.id, opts);
    if (all.length === 1) accountId = all[0].accountId;
    else if (all.length === 0) {
      throw new ConnectedAuthError(`No ${p.label} account is connected${org === DEFAULT_ORG ? "" : ` in ${org}`}. ${reconnectHint(p.label)}`, {
        provider: p.id,
      });
    } else {
      // Guessing which of several accounts was meant is how you post to the
      // wrong one, which cannot be undone quietly.
      throw new ConnectedAuthError(
        `${all.length} ${p.label} accounts are connected — name one with accountId. Connected: ${all
          .map((a) => `${a.label} (${a.accountId})`)
          .join(", ")}.`,
        { provider: p.id, code: "social/ambiguous" }
      );
    }
  }

  const doc = await readAccount(idToken, p.id, accountId, { org });
  if (!doc?.secret) {
    throw new ConnectedAuthError(
      `No ${p.label} account "${accountId}" is connected. ${reconnectHint(p.label)}`,
      { provider: p.id, accountId }
    );
  }

  let opened;
  try {
    opened = unseal(doc.secret, "refresh");
  } catch (e) {
    throw new ConnectedAuthError(e.message, {
      provider: p.id,
      accountId,
      code: "social/unreadable",
    });
  }

  // An access token stored directly (Instagram's 60-day one) is used as-is
  // until its stated expiry.
  if ((doc.kind || "refresh") === "access") {
    const until = Date.parse(doc.expiresAt || "");
    if (until && until < Date.now()) {
      throw new ConnectedAuthError(
        `The ${p.label} connection for ${doc.label || accountId} expired on ${new Date(until)
          .toISOString()
          .slice(0, 10)}. ${reconnectHint(p.label)}`,
        { provider: p.id, accountId, code: "social/expired" }
      );
    }
    if (!opened.accessToken) {
      throw new ConnectedAuthError(
        `The stored ${p.label} connection is not in the expected shape. ${reconnectHint(p.label)}`,
        { provider: p.id, accountId, code: "social/unreadable" }
      );
    }
    return { token: opened.accessToken, account: shape(accountDocId(p.id, accountId), doc) };
  }

  let out;
  try {
    out = await accessTokenFromRefresh({ provider: p.id, refreshToken: opened.refreshToken });
  } catch (e) {
    throw new ConnectedAuthError(
      `${p.label} refused the stored connection for ${doc.label || accountId} (${e.message}). ${reconnectHint(
        p.label
      )}`,
      { provider: p.id, accountId, code: "social/rejected" }
    );
  }

  // X rotates its refresh token on every use and invalidates the old one, so
  // missing this write breaks the connection on the SECOND refresh, not the
  // first — which is exactly the kind of lag that gets misdiagnosed.
  if (out.rotatedRefreshToken && out.rotatedRefreshToken !== opened.refreshToken) {
    await patchDocument(idToken, accountPath(p.id, accountId), {
      secret: seal({ refreshToken: out.rotatedRefreshToken }, "refresh"),
      rotatedAt: new Date().toISOString(),
    }).catch(() => {});
  }

  return { token: out.accessToken, account: shape(accountDocId(p.id, accountId), doc) };
}
