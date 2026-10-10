// PURE. What an organisation IS, with no I/O and no node built-ins — the
// browser imports this file too (the Orgs panel, the org switcher), so it must
// never grow a Firestore call or a `crypto` import.
//
// WHY ORGS EXIST
// --------------
// Every connection used to be deployment-global: one pool of Google, GitHub,
// YouTube and LinkedIn accounts, one set of defaults, one list of people. The
// owner runs several organisations and wants each to be a workspace of its
// own — its own logins, its own defaults, its own people — so "post as the
// company channel" can never resolve to the personal one by accident.
//
// THE MODEL, IN THREE RULES
// -------------------------
//   1. `relax` is the default org. It exists before anything is written and
//      cannot be deleted, and everything that predates orgs belongs to it.
//   2. Membership is an ARRAY ON THE ACCOUNT (`orgIds`), never a copy of the
//      account. One YouTube channel used by two orgs is ONE credential, so it
//      is one document with `orgIds: ["relax","acme"]` — two copies would
//      rotate their refresh tokens against each other.
//   3. A missing or empty `orgIds` means `["relax"]`. That is what makes the
//      change safe to ship before a single document has been migrated.
//
// Shared by orgStore.js (server), the directory, the MCP dispatcher and the
// panels, for the same reason as repoAudit.js and postText.js: two copies of a
// rule drift within an hour.

export const DEFAULT_ORG = "relax";

// A slug, because it is stamped on every account and typed into tool calls.
// Immutable once created — renaming an org changes its `name`, never its id,
// or every account filed under it would silently fall out of it.
export const ORG_ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

const orgError = (message, code, status = 400) => {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
};

export const isOrgId = (id) => typeof id === "string" && ORG_ID_RE.test(id);

export function assertOrgId(id) {
  if (!isOrgId(id)) {
    throw orgError(
      `"${String(id ?? "")}" is not a valid org id — use 2 to 40 lowercase letters, digits or hyphens, starting with a letter or digit.`,
      "org/bad-id"
    );
  }
  return id;
}

// A name to an id. Returns "" rather than a made-up id when nothing usable is
// left, so a caller has to say so instead of creating an org called "-".
export function slugifyOrg(name) {
  const s = String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return isOrgId(s) ? s : "";
}

/* ------------------------------------------------------------------ *
 * Membership                                                          *
 * ------------------------------------------------------------------ */

// Every document written before orgs existed has no `orgIds`, and it belongs
// to Relax. Treating an EMPTY array the same way is deliberate too: an account
// that somehow lost every org must land somewhere visible, not nowhere.
export function orgIdsOf(doc) {
  const ids = doc && Array.isArray(doc.orgIds) ? doc.orgIds.filter(isOrgId) : [];
  return ids.length ? [...new Set(ids)] : [DEFAULT_ORG];
}

export const inOrg = (doc, orgId) => orgIdsOf(doc).includes(orgId || DEFAULT_ORG);

// UNION, never replace. A reconnect from Acme of a channel Relax already uses
// must ADD Acme — a plain overwrite would evict the account from Relax.
export function unionOrgs(a, b) {
  const out = [];
  for (const id of [...(a || []), ...(b || [])]) if (isOrgId(id) && !out.includes(id)) out.push(id);
  return out;
}

export const withoutOrg = (ids, orgId) => (ids || []).filter((id) => id !== orgId);

// What a CLAIM (the browser storing a fresh consent) must write for orgIds.
// `null` means the stored array is explicit, so a Firestore arrayUnion of
// `ids` is exact. Otherwise the stored doc has no (or an empty) orgIds — which
// READS as [relax] — and an arrayUnion onto a missing field would write just
// `ids`, silently evicting the account from Relax. Then the whole merged
// array is returned to be written as-is.
export function claimOrgIds(existing, ids) {
  const stored = existing && Array.isArray(existing.orgIds) ? existing.orgIds.filter(isOrgId) : [];
  if (stored.length) return null;
  return unionOrgs(existing ? orgIdsOf(existing) : [], ids);
}

// WHICH PERSON an account is filed under is a per-org answer. One account
// document can be shared by Relax and Acme, and Relax's "Ravi" is not Acme's
// "Brand" — a single `identityId` field let whichever org assigned last
// overwrite the other's grouping. So it is a map, `identityIds: {org: id}`.
// The old single field predates orgs and stands for Relax only.
const identityMap = (doc) =>
  doc && doc.identityIds && typeof doc.identityIds === "object" && !Array.isArray(doc.identityIds)
    ? doc.identityIds
    : {};

export function identityIdIn(doc, orgId) {
  const org = orgId || DEFAULT_ORG;
  const map = identityMap(doc);
  if (Object.prototype.hasOwnProperty.call(map, org)) return String(map[org] || "");
  return org === DEFAULT_ORG ? String((doc && doc.identityId) || "") : "";
}

// The whole map with one org's entry set (or removed with an empty id). The
// REST writer replaces a map field whole, so callers write what this returns.
export function withIdentity(doc, orgId, identityId) {
  const out = { ...identityMap(doc) };
  const org = orgId || DEFAULT_ORG;
  if (identityId) out[org] = String(identityId);
  else if (org === DEFAULT_ORG && doc && doc.identityId) out[org] = "";
  else delete out[org];
  return out;
}

export function withoutIdentity(doc, orgId) {
  const out = { ...identityMap(doc) };
  delete out[orgId || DEFAULT_ORG];
  return out;
}

// A record filed under ONE org (`orgId`, singular — a LinkedIn post, a log
// entry). One with no orgId predates orgs and is Relax's, whatever else it
// carries: an accountId says who published it, not which org did.
export const rowInOrg = (row, orgId) =>
  row && isOrgId(row.orgId) ? row.orgId === (orgId || DEFAULT_ORG) : (orgId || DEFAULT_ORG) === DEFAULT_ORG;

// Relax keeps the document every saved default already lives in, so nothing
// has to be migrated and the live defaults keep working. Any other org gets a
// sibling document — never a dotted key inside the one document, because the
// REST writer would store a literal field called "acme.tasks".
export const defaultsPathFor = (orgId) =>
  !orgId || orgId === DEFAULT_ORG ? "config/accountDefaults" : `config/accountDefaults__${orgId}`;

/* ------------------------------------------------------------------ *
 * The record                                                          *
 * ------------------------------------------------------------------ */

export function orgShape(row = {}) {
  const id = String(row.id || row.__name || "");
  return {
    id,
    name: row.name || (id === DEFAULT_ORG ? "Relax" : id),
    description: row.description || "",
    website: row.website || "",
    color: row.color || "",
    logo: row.logo || "",
    note: row.note || "",
    createdAt: row.createdAt || "",
    updatedAt: row.updatedAt || "",
    isDefault: id === DEFAULT_ORG,
  };
}

/* ------------------------------------------------------------------ *
 * Logins the DEPLOYMENT holds                                         *
 * ------------------------------------------------------------------ *
 * Some credentials are not connected accounts at all: they are one value
 * in the env store for the whole deployment. They belong to Relax, and in
 * any other org the tools that use them REFUSE with a sentence — silently
 * acting with Relax's dev.to key while the caller believes they are in
 * Acme is exactly the mistake orgs exist to prevent.
 *
 * `test` matches MCP tool names. The two notes sources are chosen by an
 * argument, not by a tool name, so their `test` matches nothing and
 * noteBoard.js enforces them by `source` instead.
 */
const NEVER = /(?!)/;

export const DEPLOYMENT_SCOPED = [
  {
    family: "devto",
    label: "dev.to",
    reason: "it signs in with DEVTO_API_KEY, one key for the whole deployment",
    test: /^(import_devto_posts|crosspost_to_devto)$/,
  },
  {
    family: "trello",
    label: "Trello notes",
    source: "trello",
    reason: "it signs in with TRELLO_API_KEY and TRELLO_TOKEN, one pair for the whole deployment",
    test: NEVER,
  },
  {
    family: "obsidian",
    label: "the Obsidian vault",
    source: "obsidian",
    reason: "the vault repository is OBSIDIAN_VAULT_REPO, one setting for the whole deployment",
    test: NEVER,
  },
  {
    family: "release",
    label: "Vercel and npm releases",
    reason: "it uses VERCEL_TOKEN and the NPM_TOKEN workflow, which are the deployment's own accounts",
    test: /^(link_vercel_project|add_release_workflow)$/,
  },
  {
    family: "medium",
    label: "Medium",
    reason: "the Medium profile it reads is one deployment setting",
    test: /^list_medium_posts$/,
  },
  {
    family: "whatsapp",
    label: "WhatsApp",
    reason: "the WhatsApp session lives on the agent server, one number for the whole deployment",
    test: /^whatsapp_/,
  },
  {
    // The env store is ONE sealed blob for the whole deployment, and it holds
    // every login above (DEVTO_API_KEY, TRELLO_*, OBSIDIAN_VAULT_REPO,
    // VERCEL_TOKEN, AGENT_URL…). Writing it from another org would repoint
    // Relax's logins from a place that says it is not Relax.
    family: "env",
    label: "The deployment's environment variables",
    reason: "every variable is one value for the whole deployment, including the dev.to, Trello, Obsidian, Vercel and agent logins",
    test: /^(set_env_var|import_env_vars|delete_env_var)$/,
  },
];

export const deploymentScopedFor = (toolName) =>
  DEPLOYMENT_SCOPED.find((e) => e.test.test(String(toolName || ""))) || null;

// For an API route that IS one family (/api/devto/*, /api/medium/list,
// /api/env writes) rather than one MCP tool name.
export const deploymentScopedFamily = (family) =>
  DEPLOYMENT_SCOPED.find((e) => e.family === family) || null;

export const deploymentScopedForSource = (sourceId) =>
  DEPLOYMENT_SCOPED.find((e) => e.source && e.source === sourceId) || null;

export function assertDeploymentScope(entry, orgId) {
  if (!entry) return;
  const org = orgId || DEFAULT_ORG;
  if (org === DEFAULT_ORG) return;
  throw orgError(
    `${entry.label} belongs to Relax, not "${org}": ${entry.reason}. Switch to Relax to use it — acting here would use Relax's login while you are working in ${org}.`,
    "org/deployment-scoped",
    403
  );
}
