// SERVER ONLY. Organisations: the records, membership, and the migration.
//
// Reads and writes Firestore over REST AS THE SIGNED-IN USER, like every other
// store here — `orgs/` is admin-only in firestore.rules, so the rules remain
// the boundary and there is no service account to bypass them.
//
// What lives where:
//   orgs/{orgId}                         the record (name, website, colour…)
//   connectedAccounts/<key>.orgIds       membership, on the ACCOUNT
//   identities/{id}.orgId                which org a person belongs to
//   secrets/{id}.orgId                   which org a saved sign-in belongs to
//   config/accountDefaults[__<orgId>]    each org's defaults
//
// The rules this file enforces are the ones that cannot be undone if they
// are got wrong: Relax cannot be deleted; an account is never left in NO org;
// a credential is never deleted because an org was; membership is changed by
// writing the whole array once, read-modify-write, because the REST API has
// no arrayUnion and a merge of a partial array would evict the account from
// the orgs it left out.
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  listEveryDocument,
  patchDocument,
} from "./firestoreRest.js";
import {
  DEFAULT_ORG,
  assertOrgId,
  defaultsPathFor,
  isOrgId,
  orgIdsOf,
  orgShape,
  slugifyOrg,
  unionOrgs,
  withoutIdentity,
  withoutOrg,
} from "./orgShape.js";
import { ConnectedAuthError, COLLECTION as ACCOUNTS, accountPath, listAccounts, readAccount } from "./connectedStore.js";
import { currentOrg } from "./orgContext.js";
import { SERVICES, IDENTITIES, allAccounts, readDefaults, identityOrg } from "./accountDirectory.js";
import { getProvider } from "./integrations.js";

export const ORGS = "orgs";
const SECRETS = "secrets";

const orgError = (message, code, status = 400, extra = {}) => {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  Object.assign(e, extra);
  return e;
};

/* ------------------------------------------------------------------ *
 * Reading                                                             *
 * ------------------------------------------------------------------ */

// Relax is ALWAYS in the list, written or not: it exists before its document
// does, and an org switcher that lost it would strand every pre-org login.
export async function listOrgs(idToken, { withCounts = false } = {}) {
  const rows = await listDocuments(idToken, ORGS, { pageSize: 100 }).catch(() => []);
  const orgs = rows.map((r) => orgShape(r)).filter((o) => isOrgId(o.id));
  if (!orgs.some((o) => o.id === DEFAULT_ORG)) orgs.push(orgShape({ id: DEFAULT_ORG }));
  orgs.sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : a.name.localeCompare(b.name)));
  if (!withCounts) return orgs;

  // What each org HOLDS, from one read of every account rather than a read per
  // org: the list is what the switcher and the Orgs tab open with.
  const accounts = await allAccounts(idToken, undefined, { allOrgs: true }).catch(() => []);
  return orgs.map((o) => {
    const mine = accounts.filter((a) => a.orgIds.includes(o.id));
    const services = Object.values(SERVICES)
      .filter((s) => mine.some((a) => s.providers.includes(a.provider)))
      .map((s) => s.id);
    return { ...o, accountCount: mine.length, services };
  });
}

export async function getOrg(idToken, id) {
  assertOrgId(id);
  const doc = await getDocument(idToken, `${ORGS}/${id}`);
  if (doc) return orgShape({ ...doc, id });
  return id === DEFAULT_ORG ? orgShape({ id: DEFAULT_ORG }) : null;
}

export async function assertOrgExists(idToken, id) {
  const org = await getOrg(idToken, id);
  if (org) return org;
  const known = (await listOrgs(idToken)).map((o) => o.id);
  throw orgError(`There is no org "${id}". Known orgs: ${known.join(", ")}.`, "org/unknown", 404, {
    orgId: id,
  });
}

/* ------------------------------------------------------------------ *
 * Writing the record                                                  *
 * ------------------------------------------------------------------ */

const FIELDS = ["name", "description", "website", "color", "logo", "note"];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const HTTP = /^https?:\/\/\S+$/i;

// Checked here rather than left to the panel, because MCP writes these too
// and a colour of "red; background:url(…)" would end up in a style attribute.
function cleanFields(input = {}, { partial = false } = {}) {
  const out = {};
  for (const k of FIELDS) {
    if (input[k] === undefined) continue;
    const v = String(input[k] ?? "").trim();
    if (k === "name" && !v) throw orgError("An org needs a name.", "org/bad-field");
    if (k === "color" && v && !HEX.test(v)) {
      throw orgError(`Colour must be a hex value such as #FFB020, not "${v}".`, "org/bad-field");
    }
    if ((k === "website" || k === "logo") && v && !HTTP.test(v)) {
      throw orgError(`${k === "logo" ? "The logo" : "The website"} must be an http(s) address.`, "org/bad-field");
    }
    out[k] = v.slice(0, k === "description" || k === "note" ? 2000 : 300);
  }
  if (!partial && !out.name) throw orgError("An org needs a name.", "org/bad-field");
  return out;
}

export async function createOrg(idToken, input = {}) {
  const fields = cleanFields(input);
  const id = input.id ? String(input.id).trim().toLowerCase() : slugifyOrg(fields.name);
  if (!id) {
    throw orgError(
      `"${fields.name}" does not make a usable id — give one explicitly (2 to 40 lowercase letters, digits or hyphens).`,
      "org/bad-id"
    );
  }
  assertOrgId(id);
  if (id === DEFAULT_ORG) {
    // It already exists, implicitly. Creating it would be a second way to say
    // "edit Relax", and the one that fails when the document is already there.
    throw orgError("Relax always exists — edit it rather than creating it.", "org/exists", 409);
  }
  const now = new Date().toISOString();
  const record = { ...fields, createdAt: now, updatedAt: now };
  try {
    await createDocument(idToken, ORGS, id, record);
  } catch (e) {
    if (/already exists/i.test(e.message || "")) {
      throw orgError(`An org with the id "${id}" already exists.`, "org/exists", 409);
    }
    throw e;
  }
  return orgShape({ ...record, id });
}

// The id is IMMUTABLE: it is stamped on every account, identity and sign-in
// filed under the org, and changing it would silently drop all of them out.
// Renaming changes `name`.
export async function updateOrg(idToken, id, patch = {}) {
  assertOrgId(id);
  if (patch.id !== undefined && patch.id !== id) {
    throw orgError(
      "An org's id cannot be changed — it is stamped on every account filed under it. Change its name instead.",
      "org/immutable-id"
    );
  }
  const fields = cleanFields(patch, { partial: true });
  if (!Object.keys(fields).length) throw orgError("Nothing to change.", "org/empty-update");
  const existing = await getDocument(idToken, `${ORGS}/${id}`);
  if (!existing && id !== DEFAULT_ORG) await assertOrgExists(idToken, id);
  const now = new Date().toISOString();
  // Relax may have no document yet; the first edit writes it.
  const record = { ...fields, updatedAt: now, ...(existing ? {} : { createdAt: now }) };
  if (!existing && !record.name) record.name = "Relax";
  const out = await patchDocument(idToken, `${ORGS}/${id}`, record);
  return orgShape({ ...out, id });
}

/* ------------------------------------------------------------------ *
 * Membership                                                          *
 * ------------------------------------------------------------------ */

// Set an account's orgs, whole. The ONE place membership is edited, so the
// rules about it live in one place: never empty (an account in no org is an
// account nobody can see or disconnect), every org must exist, and the whole
// array is written at once.
export async function setAccountOrgs(idToken, provider, accountId, orgIds) {
  const p = getProvider(provider);
  const asked = (Array.isArray(orgIds) ? orgIds : []).map((x) => String(x ?? "").trim().toLowerCase());
  const bad = asked.filter((x) => !isOrgId(x));
  if (bad.length) throw orgError(`Not valid org ids: ${bad.map((b) => `"${b}"`).join(", ")}.`, "org/bad-id");
  const wanted = unionOrgs([], asked);
  if (!wanted.length) {
    throw orgError(
      "An account must belong to at least one org — otherwise nothing can see it, use it or disconnect it. To remove it everywhere, disconnect it instead.",
      "org/empty-membership"
    );
  }
  const known = new Set((await listOrgs(idToken)).map((o) => o.id));
  const missing = wanted.filter((id) => !known.has(id));
  if (missing.length) {
    throw orgError(
      `No such org${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Known orgs: ${[...known].join(", ")}.`,
      "org/unknown",
      404
    );
  }
  const path = accountPath(p.id, accountId);
  const doc = await getDocument(idToken, path).catch(() => null);
  if (!doc) {
    // A legacy single-account row has no document of its own to stamp, and it
    // is Relax's by construction. Reconnecting it moves it into the
    // per-account store, where it can be shared.
    throw new ConnectedAuthError(
      `No ${p.label} account "${accountId}" in the per-account store. A legacy connection belongs to Relax only — reconnect it to share it with another org.`,
      { provider: p.id, accountId: String(accountId), code: "account/unknown" }
    );
  }
  const before = orgIdsOf(doc);
  await patchDocument(idToken, path, { orgIds: wanted });
  return { provider: p.id, accountId: String(accountId), key: `${p.id}__${accountId}`, before, after: wanted };
}

/* ------------------------------------------------------------------ *
 * Forgetting an account, per org                                      *
 * ------------------------------------------------------------------ */

// Disconnecting is PER ORG. An account shared by Relax and Acme is one
// credential; disconnecting it in Acme takes Acme off it and leaves Relax's
// working, and the document — the credential — goes only when no org is
// left using it. Acme's grouping of it (identityIds) goes with Acme.
//
// The route (/api/accounts `forget`) is a thin wrapper round this, so the
// suite drives the real rule rather than a copy of it.
//
// With no per-account document, `legacy` says whether that is because the
// name is this org's LEGACY connection (integrations/<docId>, which only the
// browser may delete) — or because there is simply nothing by that name any
// more. A caller must not read "nothing here" as "so delete the legacy one":
// that is how a stale selection deleted an account nobody named.
export async function forgetFromOrg(idToken, provider, accountId, { org } = {}) {
  const p = getProvider(provider);
  const orgId = org || currentOrg();
  const id = String(accountId || "");
  const path = accountPath(p.id, id);
  const forgotten = `${p.id}__${id}`;
  // readAccount refuses an account that belongs to other orgs (account/other-org).
  const doc = await readAccount(idToken, p.id, id, { org: orgId });
  if (!doc) {
    const pool = await allAccounts(idToken, p.id, { org: orgId });
    const legacy = pool.some((a) => a.legacy && (a.accountId === id || a.key === id));
    return { forgotten, removedFrom: orgId, deleted: false, legacy };
  }
  const remaining = withoutOrg(orgIdsOf(doc), orgId);
  if (remaining.length) {
    await patchDocument(idToken, path, { orgIds: remaining, identityIds: withoutIdentity(doc, orgId) });
  } else {
    await deleteDocument(idToken, path);
  }
  return { forgotten, removedFrom: orgId, deleted: !remaining.length, remaining, legacy: false };
}

/* ------------------------------------------------------------------ *
 * Deleting                                                            *
 * ------------------------------------------------------------------ */

// Deleting an org NEVER deletes a credential. So it refuses while anything
// that holds one would be orphaned — an account whose only org this is, or a
// saved sign-in filed here — and says which, so they can be moved first.
// Accounts SHARED with another org merely lose this org, and that is what
// `confirm` agrees to; without it the call reports what it would do.
export async function deleteOrg(idToken, id, { confirm = false } = {}) {
  assertOrgId(id);
  if (id === DEFAULT_ORG) {
    throw orgError("Relax cannot be deleted — it is the default org, and every login made before orgs existed belongs to it.", "org/protected", 403);
  }
  const org = await assertOrgExists(idToken, id);

  // STRICT reads, every page, nothing caught. The refusal below is the only
  // thing standing between this delete and a stranded credential, and a read
  // that failed into an empty list would wave it straight through.
  const accounts = (await listAccounts(idToken, undefined, { allOrgs: true, strict: true })).filter((a) =>
    a.orgIds.includes(id)
  );
  const sole = accounts.filter((a) => a.orgIds.length === 1);
  const shared = accounts.filter((a) => a.orgIds.length > 1);
  const secretRows = (await listEveryDocument(idToken, SECRETS)).filter((r) => r.orgId === id);
  const identityRows = (await listEveryDocument(idToken, IDENTITIES)).filter((r) => identityOrg(r) === id);
  const keyOf = (a) => `${a.provider}__${a.accountId}`;

  if (sole.length || secretRows.length) {
    throw orgError(
      `${org.name} still holds logins that belong to no other org — move or disconnect them first, so deleting the org cannot delete a credential.${
        sole.length ? ` Accounts only in ${id}: ${sole.map(keyOf).join(", ")}.` : ""
      }${secretRows.length ? ` Saved sign-ins filed under ${id}: ${secretRows.map((r) => r.id).join(", ")}.` : ""}`,
      "org/not-empty",
      409,
      { accounts: sole.map(keyOf), secrets: secretRows.map((r) => r.id) }
    );
  }

  const plan = {
    org: org.id,
    unassigned: shared.map(keyOf),
    identitiesRemoved: identityRows.map((r) => r.id),
    defaultsRemoved: defaultsPathFor(id),
  };
  if (!confirm) {
    throw orgError(
      `Deleting ${org.name} would remove it from ${shared.length} shared account${shared.length === 1 ? "" : "s"}${
        shared.length ? ` (${plan.unassigned.join(", ")})` : ""
      } and drop ${identityRows.length} identit${identityRows.length === 1 ? "y" : "ies"} and its defaults. No credential is deleted. Call again with confirm: true.`,
      "org/needs-confirm",
      400,
      { plan }
    );
  }

  for (const a of shared) {
    // The org's grouping goes with it: a shared account must not keep
    // pointing at a person that was deleted with the org.
    await patchDocument(idToken, accountPath(a.provider, a.accountId), {
      orgIds: withoutOrg(a.orgIds, id),
      identityIds: withoutIdentity(a, id),
    });
  }
  // Identities hold no credential — a label and an address — and are
  // invisible once their org is gone, so they go with it.
  for (const r of identityRows) await deleteDocument(idToken, `${IDENTITIES}/${r.id}`).catch(() => {});
  await deleteDocument(idToken, defaultsPathFor(id)).catch(() => {});
  await deleteDocument(idToken, `${ORGS}/${id}`);
  return { deleted: id, ...plan };
}

/* ------------------------------------------------------------------ *
 * Overview                                                            *
 * ------------------------------------------------------------------ */

// What one org holds, by job: which accounts can do each service, which is
// the default, and which jobs nothing in the org can do at all.
export async function orgOverview(idToken, orgId) {
  const org = await assertOrgExists(idToken, orgId);
  const [accounts, defaults] = await Promise.all([
    allAccounts(idToken, undefined, { org: org.id }),
    readDefaults(idToken, { org: org.id }),
  ]);
  const byService = {};
  const gaps = [];
  for (const s of Object.values(SERVICES)) {
    const keys = accounts.filter((a) => s.providers.includes(a.provider)).map((a) => a.key);
    byService[s.id] = keys;
    if (!keys.length) gaps.push(s.id);
  }
  return { org, accounts, byService, defaults, gaps };
}

/* ------------------------------------------------------------------ *
 * Migration — "save all current logins on Relax"                      *
 * ------------------------------------------------------------------ */

// Idempotent, and a dry run by default. Missing membership ALREADY reads as
// Relax everywhere, so nothing is broken before this runs; what it buys is
// that every document says so explicitly, which is what a later filter, an
// export or a human reading the database can rely on.
//
// It only ever ADDS a field to a document that lacks it — an account already
// filed under any org is left exactly as it is.
export async function migrateToOrgs(idToken, { dryRun = true } = {}) {
  const orgDoc = await getDocument(idToken, `${ORGS}/${DEFAULT_ORG}`);
  const orgCreated = !orgDoc;
  if (orgCreated && !dryRun) {
    const now = new Date().toISOString();
    await patchDocument(idToken, `${ORGS}/${DEFAULT_ORG}`, {
      name: "Relax",
      description: "The default org. Every login made before orgs existed belongs here.",
      createdAt: now,
      updatedAt: now,
    });
  }

  const hasOrgs = (r) => Array.isArray(r.orgIds) && r.orgIds.some(isOrgId);

  // Strict, paged reads throughout: a migration that silently saw one page,
  // or turned a refused read into "nothing to stamp", would report success
  // while leaving logins unfiled.
  const accountRows = await listEveryDocument(idToken, ACCOUNTS);
  const accountsStamped = [];
  for (const r of accountRows) {
    if (hasOrgs(r)) continue;
    accountsStamped.push(r.id);
    if (!dryRun) await patchDocument(idToken, `${ACCOUNTS}/${r.id}`, { orgIds: [DEFAULT_ORG] });
  }

  const identityRows = await listEveryDocument(idToken, IDENTITIES);
  const identityIds = identityRows.filter((r) => !isOrgId(r.orgId)).map((r) => r.id);
  if (!dryRun) {
    for (const id of identityIds) await patchDocument(idToken, `${IDENTITIES}/${id}`, { orgId: DEFAULT_ORG });
  }

  // Secrets are stamped by a one-field patch: the mask names `orgId` alone,
  // so the sealed value is never read, rewritten or echoed here.
  const secretRows = await listEveryDocument(idToken, SECRETS);
  const secretIds = secretRows.filter((r) => !isOrgId(r.orgId)).map((r) => r.id);
  if (!dryRun) {
    for (const id of secretIds) await patchDocument(idToken, `${SECRETS}/${id}`, { orgId: DEFAULT_ORG });
  }

  return {
    dryRun: !!dryRun,
    org: DEFAULT_ORG,
    orgCreated,
    accountsStamped,
    identitiesStamped: identityIds.length,
    identityIds,
    secretsStamped: secretIds.length,
    secretIds,
    note: dryRun
      ? "Nothing was written. Call again with dryRun: false to apply."
      : "Every login made before orgs existed is now filed under Relax explicitly.",
  };
}
