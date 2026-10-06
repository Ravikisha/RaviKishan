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
import { getDocument, listDocuments, patchDocument } from "./firestoreRest.js";
import {
  accessTokenFromRefresh,
  getProvider,
  providerConfig,
  seal,
  unseal,
} from "./integrations.js";

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
}) {
  const p = assertMulti(provider);
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
    connectedAt: new Date().toISOString(),
  };
}

/* ---------------- reading ---------------- */

const shape = (id, d) => ({
  id,
  provider: d.provider,
  accountId: d.accountId || "",
  label: d.label || d.accountId || "",
  kind: d.kind || "refresh",
  expiresAt: d.expiresAt || "",
  connectedAt: d.connectedAt || "",
  scope: d.scope || "",
});

// Every connected social account, optionally for one provider. Never returns
// the sealed secret — nothing outside this file needs it.
export async function listAccounts(idToken, provider) {
  const rows = await listDocuments(idToken, COLLECTION, { pageSize: 200 }).catch(() => []);
  return rows
    .map((r) => shape(r.__name || r.id || "", r))
    .filter((a) => a.provider && (!provider || a.provider === getProvider(provider).id))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label));
}

export async function readAccount(idToken, provider, accountId) {
  const doc = await getDocument(idToken, accountPath(provider, accountId)).catch(() => null);
  return doc || null;
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
export async function connectedToken(idToken, provider, accountId) {
  const p = assertMulti(provider);
  const cfg = providerConfig(p.id);
  if (!cfg.configured) {
    throw new ConnectedAuthError(
      `${p.label} is not configured on this deployment (missing ${cfg.missing.join(", ")}).`,
      { provider: p.id, code: "social/not-configured" }
    );
  }
  if (!accountId) {
    const all = await listAccounts(idToken, p.id);
    if (all.length === 1) accountId = all[0].accountId;
    else if (all.length === 0) {
      throw new ConnectedAuthError(`No ${p.label} account is connected. ${reconnectHint(p.label)}`, {
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

  const doc = await readAccount(idToken, p.id, accountId);
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
