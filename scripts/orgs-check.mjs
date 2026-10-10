// Organisations — checked with no network and no credentials.
//
// The failure that matters is not "an org is missing from a list". It is an
// account from ONE org acting in ANOTHER: Acme's unnamed "post to the channel"
// resolving to Relax's personal one, or a Relax token being refreshed on a call
// made in Acme. Nothing downstream can tell that was a mistake, so most of this
// file is about the refusals and the order they happen in — an org check that
// runs AFTER the token refresh has already used the credential it was meant to
// protect.
//
// Firestore is replaced by an in-memory fake behind a stubbed globalThis.fetch.
// Anything that is NOT a Firestore document request throws and is recorded, so
// "refused before any token refresh" is a fact the suite can see rather than a
// hope.
//
//   node scripts/orgs-check.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

// The env store must stay out of the way: without ENV_KEY hydrateEnv() is a
// no-op, which is what lets withEnv be driven here with no network.
delete process.env.ENV_KEY;
// Sealing needs a key and none of these assertions depend on which.
process.env.INTEGRATION_SECRET ||= "test-integration-secret-for-the-orgs-suite";
process.env.SECRETS_KEY ||= "test-secrets-key-for-the-orgs-suite";
// A provider only reads as connectable with both halves of a client. YouTube
// and Analytics borrow the Google pair, so one pair configures all three.
process.env.GOOGLE_TASKS_CLIENT_ID ||= "test-google-client";
process.env.GOOGLE_TASKS_CLIENT_SECRET ||= "test-google-secret";
process.env.INSTAGRAM_CLIENT_ID ||= "test-ig-client";
process.env.INSTAGRAM_CLIENT_SECRET ||= "test-ig-secret";

let pass = 0;
const fails = [];
const check = (ok, name, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const throws = (fn, name, { code, re } = {}) => {
  try {
    fn();
    check(false, name, "it did not throw");
  } catch (e) {
    check((!code || e.code === code) && (!re || re.test(e.message)), name, `${e.code || ""} ${e.message}`.slice(0, 160));
  }
};
const rejects = async (p, name, { code, re } = {}) => {
  try {
    await (typeof p === "function" ? p() : p);
    check(false, name, "it did not reject");
    return null;
  } catch (e) {
    check((!code || e.code === code) && (!re || re.test(e.message)), name, `${e.code || ""} ${e.message}`.slice(0, 160));
    return e;
  }
};

/* ------------------------------------------------------------------ *
 * A fake Firestore behind fetch                                       *
 * ------------------------------------------------------------------ */

const BASE =
  "https://firestore.googleapis.com/v1/projects/myportifilio-3ab5f/databases/(default)/documents";
const { toFields, fromFields } = await import("../lib/server/firestoreRest.js");

const db = new Map(); // "collection/id" -> plain object
const log = []; // every Firestore call: { method, path, mask }
const unexpected = []; // every call that was not a Firestore document request
const failingLists = new Set(); // collections whose LIST answers 500 (a transient Firestore error)

const respond = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const docOut = (p, obj) => ({ name: `${BASE}/${p}`, fields: toFields(obj) });

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = (init.method || "GET").toUpperCase();
  if (!url.startsWith(`${BASE}/`)) {
    unexpected.push(`${method} ${url}`);
    throw new Error(`unexpected network call in a no-network suite: ${method} ${url}`);
  }
  const [p, q = ""] = url.slice(BASE.length + 1).split("?");
  const params = new URLSearchParams(q);
  const segs = p.split("/");
  log.push({ method, path: p, mask: params.getAll("updateMask.fieldPaths") });

  if (method === "GET" && segs.length % 2 === 1) {
    if (failingLists.has(p)) return respond(500, { error: { message: "INTERNAL (injected)" } });
    const documents = [...db.entries()]
      .filter(([k]) => k.startsWith(`${p}/`) && k.split("/").length === segs.length + 1)
      .map(([k, v]) => docOut(k, v));
    return respond(200, { documents });
  }
  if (method === "GET") {
    return db.has(p) ? respond(200, docOut(p, db.get(p))) : respond(404, { error: { message: "NOT_FOUND" } });
  }
  if (method === "PATCH") {
    const data = fromFields(JSON.parse(init.body || "{}").fields);
    const merged = { ...(db.get(p) || {}), ...data };
    db.set(p, merged);
    return respond(200, docOut(p, merged));
  }
  if (method === "POST") {
    const id = params.get("documentId");
    const key = `${p}/${id}`;
    if (db.has(key)) return respond(409, { error: { message: "Document already exists: " + key } });
    db.set(key, fromFields(JSON.parse(init.body || "{}").fields));
    return respond(200, docOut(key, db.get(key)));
  }
  if (method === "DELETE") {
    db.delete(p);
    return respond(200, {});
  }
  unexpected.push(`${method} ${url}`);
  throw new Error(`unexpected Firestore method ${method}`);
};

const writes = () => log.filter((c) => c.method !== "GET");
const resetLog = () => {
  log.length = 0;
  unexpected.length = 0;
};

/* ------------------------------------------------------------------ */

const shapeMod = await import("../lib/server/orgShape.js");
const {
  DEFAULT_ORG,
  ORG_ID_RE,
  isOrgId,
  assertOrgId,
  slugifyOrg,
  orgIdsOf,
  inOrg,
  unionOrgs,
  withoutOrg,
  defaultsPathFor,
  orgShape,
  DEPLOYMENT_SCOPED,
  deploymentScopedFor,
  deploymentScopedForSource,
  assertDeploymentScope,
} = shapeMod;

console.log("\norg ids");
check(DEFAULT_ORG === "relax", "the default org is relax");
check(ORG_ID_RE.source === "^[a-z0-9][a-z0-9-]{1,39}$", "the id rule is the one the spec names");
for (const ok of ["relax", "acme", "a1", "acme-corp", "9lives", "x".repeat(40)]) check(isOrgId(ok), `"${ok.length > 12 ? ok.slice(0, 12) + "…" : ok}" is a valid id`);
for (const bad of ["", "a", "-acme", "Acme", "acme corp", "acme_corp", "acme/../x", "x".repeat(41), null, undefined, 42, ["acme"]]) {
  check(!isOrgId(bad), `${JSON.stringify(bad)?.slice(0, 16)} is refused`);
}
throws(() => assertOrgId("Acme Corp"), "assertOrgId throws org/bad-id", { code: "org/bad-id" });
check(assertOrgId("acme") === "acme", "assertOrgId returns a valid id unchanged");

console.log("\nslugifying a name");
check(slugifyOrg("Acme Corp") === "acme-corp", "spaces become hyphens");
check(slugifyOrg("  Café Ünïcode!! ") === "cafe-unicode", "accents fold, punctuation and edges drop", slugifyOrg("  Café Ünïcode!! "));
check(slugifyOrg("!!!") === "", "nothing usable gives empty, not an invented id");
check(slugifyOrg("A") === "", "a one-character name is too short to be an id");
const long = slugifyOrg("The " + "very ".repeat(12) + "long org");
check(isOrgId(long) && long.length <= 40 && !long.endsWith("-"), "a long name is cut to 40 with no trailing hyphen", long);
check(slugifyOrg(null) === "" && slugifyOrg(undefined) === "", "null and undefined give empty");

console.log("\nmembership defaults to relax");
check(JSON.stringify(orgIdsOf(undefined)) === '["relax"]', "no document → relax");
check(JSON.stringify(orgIdsOf({})) === '["relax"]', "no orgIds → relax");
check(JSON.stringify(orgIdsOf({ orgIds: [] })) === '["relax"]', "an EMPTY array → relax, never nowhere");
check(JSON.stringify(orgIdsOf({ orgIds: "acme" })) === '["relax"]', "a non-array → relax");
check(JSON.stringify(orgIdsOf({ orgIds: ["BAD", "-x"] })) === '["relax"]', "only invalid ids → relax");
check(JSON.stringify(orgIdsOf({ orgIds: ["acme", "acme", "BAD", "relax"] })) === '["acme","relax"]', "valid ids kept, deduped, order kept");
check(inOrg({}, "relax") && !inOrg({}, "acme"), "a pre-org document is relax's and nobody else's");
check(inOrg({ orgIds: ["acme"] }, "acme") && !inOrg({ orgIds: ["acme"] }, "relax"), "an acme document is not relax's");
check(inOrg({}, undefined), "inOrg with no org means relax");

console.log("\nunion, never replace");
{
  const a = ["relax"];
  const u = unionOrgs(a, ["acme", "relax"]);
  check(JSON.stringify(u) === '["relax","acme"]', "union keeps the existing org and adds the new one");
  check(a.length === 1, "union does not mutate its input");
  check(JSON.stringify(unionOrgs(null, ["acme", "NOPE"])) === '["acme"]', "union drops invalid ids and tolerates null");
  check(JSON.stringify(unionOrgs([], [])) === "[]", "union of nothing is empty (the caller decides the default)");
  check(JSON.stringify(withoutOrg(["relax", "acme"], "acme")) === '["relax"]', "withoutOrg removes exactly one org");
  check(JSON.stringify(withoutOrg(["acme"], "acme")) === "[]", "withoutOrg can leave nothing — forget then deletes");
  check(JSON.stringify(withoutOrg(null, "acme")) === "[]", "withoutOrg tolerates null");
}

console.log("\ndefaults live in one document per org");
check(defaultsPathFor("relax") === "config/accountDefaults", "relax keeps the document every saved default already lives in");
check(defaultsPathFor(undefined) === "config/accountDefaults", "no org is relax");
check(defaultsPathFor("acme") === "config/accountDefaults__acme", "acme gets a sibling document");
check(!defaultsPathFor("acme").includes("."), "never a dotted key the REST writer would store literally");

console.log("\nthe record");
{
  const r = orgShape({ id: "relax" });
  check(r.name === "Relax" && r.isDefault === true, "relax is named and marked default before it has a document");
  const a = orgShape({ id: "acme", name: "Acme", color: "#00AAFF" });
  check(a.isDefault === false && a.color === "#00AAFF" && a.website === "", "another org is not default; missing fields are empty strings");
  const keys = Object.keys(a).sort().join(",");
  check(keys === "color,createdAt,description,id,isDefault,logo,name,note,updatedAt,website", "the shape is exactly the contract's fields", keys);
}

console.log("\ndeployment-held logins belong to relax");
{
  const fams = DEPLOYMENT_SCOPED.map((e) => e.family).sort().join(",");
  check(fams === "devto,env,medium,obsidian,release,trello,whatsapp", "all seven deployment families are listed", fams);
  check(shapeMod.deploymentScopedFamily("env")?.family === "env" && shapeMod.deploymentScopedFamily("nope") === null, "a family is found by name, for the API routes");
  for (const n of ["set_env_var", "import_env_vars", "delete_env_var"]) {
    check(deploymentScopedFor(n)?.family === "env", `${n} writes the deployment's env, so it is Relax's`);
  }
  check(deploymentScopedFor("get_env_status") === null, "reading the env status is not fenced");
  check(DEPLOYMENT_SCOPED.every((e) => e.reason && e.label), "every family says what it is and why");
  check(deploymentScopedFor("crosspost_to_devto")?.family === "devto", "crosspost_to_devto is dev.to's");
  check(deploymentScopedFor("import_devto_posts")?.family === "devto", "import_devto_posts is dev.to's");
  check(deploymentScopedFor("link_vercel_project")?.family === "release", "link_vercel_project is the release family");
  check(deploymentScopedFor("list_medium_posts")?.family === "medium", "list_medium_posts is Medium's");
  check(deploymentScopedFor("whatsapp_send_message")?.family === "whatsapp", "whatsapp_* is WhatsApp's");
  check(deploymentScopedFor("list_accounts") === null, "an account tool is not deployment-scoped");
  check(deploymentScopedFor("") === null && deploymentScopedFor(undefined) === null, "no name, no family");
  check(deploymentScopedForSource("trello")?.family === "trello", "the trello notes source is found by source");
  check(deploymentScopedForSource("obsidian")?.family === "obsidian", "the obsidian notes source is found by source");
  check(deploymentScopedForSource("notion") === null && deploymentScopedForSource("local") === null, "notion and the local store are not deployment-scoped");
  const devto = deploymentScopedFor("crosspost_to_devto");
  let threw = null;
  try {
    assertDeploymentScope(devto, "acme");
  } catch (e) {
    threw = e;
  }
  check(threw?.code === "org/deployment-scoped" && threw?.status === 403, "dev.to in acme is refused, 403");
  check(/Relax/.test(threw?.message || "") && /acme/.test(threw?.message || ""), "and the refusal names both orgs");
  let ok = true;
  try {
    assertDeploymentScope(devto, "relax");
    assertDeploymentScope(devto, undefined);
    assertDeploymentScope(null, "acme");
  } catch {
    ok = false;
  }
  check(ok, "dev.to in relax (or with no org) passes, and a non-scoped tool passes anywhere");
}

/* ------------------------------------------------------------------ */

console.log("\nthe request-scoped org (AsyncLocalStorage)");
const ctxA = await import("../lib/server/orgContext.js");
// A second, DISTINCT module instance — the same thing Next dev's HMR or a
// second loader would produce. The setter and the reader must still agree.
const ctxB = await import("../lib/server/orgContext.js?second-instance");
const { runInOrg, currentOrg, orgSource, orgFromRequest, ensureOrgKnown } = ctxA;
{
  const als = globalThis[Symbol.for("rk.orgContext")];
  check(!!als && typeof als.run === "function", "the store is parked on the global symbol");
  check(ctxA !== ctxB, "the two imports really are two module instances");
  const seen = await ctxA.runInOrg("acme", async () => ctxB.currentOrg());
  check(seen === "acme", "an org set through one instance is read by the other", seen);
  check(currentOrg() === "relax" && orgSource() === "default", "outside any run: relax, source default");
  const s1 = runInOrg("acme", () => [currentOrg(), orgSource()]);
  check(s1[0] === "acme" && s1[1] === "explicit", "inside runInOrg: the org, source explicit");
  const s2 = runInOrg("acme", () => orgSource(), { source: "header" });
  check(s2 === "header", "the caller can say the org came from the header");
  const s3 = runInOrg("", () => [currentOrg(), orgSource()]);
  check(s3[0] === "relax" && s3[1] === "default", "runInOrg with no org is relax, source default");
  throws(() => runInOrg("Not An Id", () => 1), "runInOrg refuses a malformed org", { code: "org/bad-id" });
  const nested = runInOrg("acme", () => [runInOrg("beta", () => currentOrg()), currentOrg()]);
  check(nested[0] === "beta" && nested[1] === "acme", "a nested run ends with its callback and the outer org returns");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const orgs = Array.from({ length: 24 }, (_, i) => ["relax", "acme", "beta"][i % 3]);
  const results = await Promise.all(
    orgs.map((o, i) =>
      runInOrg(o, async () => {
        const seenAt = [currentOrg()];
        await sleep((i * 7) % 11);
        seenAt.push(currentOrg());
        await Promise.resolve();
        await sleep((i * 3) % 5);
        seenAt.push(ctxB.currentOrg());
        return seenAt.every((x) => x === o);
      })
    )
  );
  check(results.every(Boolean), "24 concurrent calls across three orgs each keep their own org across awaits");
  check(currentOrg() === "relax", "and nothing leaks out after them");

  check(orgFromRequest({ headers: { "x-org-id": "acme" } }) === "acme", "a valid header is read");
  check(orgFromRequest({ headers: { "x-org-id": " ACME " } }) === "acme", "the header is trimmed and lowercased");
  check(orgFromRequest({ headers: { "x-org-id": ["acme", "beta"] } }) === "acme", "an array header takes the first");
  check(orgFromRequest({ headers: { "x-org-id": "../relax" } }) === "", "a malformed header reads as absent");
  check(orgFromRequest({ headers: {} }) === "" && orgFromRequest(undefined) === "", "no header, no org");

  resetLog();
  await ensureOrgKnown("tok");
  check(log.length === 0, "relax is known without a single request");
}

console.log("\nwithEnv lays the org over every API route");
{
  const { withEnv } = await import("../lib/server/envStore.js");
  const h = withEnv(async (req, res) => ({ org: currentOrg(), src: orgSource() }));
  const a = await h({ headers: { "x-org-id": "acme" } }, {});
  check(a.org === "acme" && a.src === "header", "x-org-id: acme → acme, source header", JSON.stringify(a));
  const b = await h({ headers: { "x-org-id": "<script>" } }, {});
  check(b.org === "relax" && b.src === "default", "an invalid header is ignored → relax, not an error", JSON.stringify(b));
  const c = await h({ headers: {} }, {});
  check(c.org === "relax" && c.src === "default", "no header → relax");
  const both = await Promise.all([
    h({ headers: { "x-org-id": "acme" } }, {}),
    h({ headers: { "x-org-id": "beta" } }, {}),
    h({ headers: {} }, {}),
  ]);
  check(both.map((x) => x.org).join(",") === "acme,beta,relax", "concurrent requests do not see each other's org");
}

/* ------------------------------------------------------------------ *
 * The stores, against the fake Firestore                              *
 * ------------------------------------------------------------------ */

const integ = await import("../lib/server/integrations.js");
const store = await import("../lib/server/connectedStore.js");
const dir = await import("../lib/server/accountDirectory.js");

const refreshBlob = integ.seal({ refreshToken: "1//not-a-real-refresh-token" }, "refresh");
const seed = () => {
  db.clear();
  db.set("orgs/acme", { name: "Acme", createdAt: "2026-10-09T00:00:00Z" });
  db.set("orgs/beta", { name: "Beta" });
  // YouTube: one relax-only (pre-org, no orgIds), one acme-only, one shared.
  db.set("connectedAccounts/youtube__UCrelax", { provider: "youtube", accountId: "UCrelax", label: "Ravi Kishan", secret: refreshBlob, kind: "refresh" });
  db.set("connectedAccounts/youtube__UCacme", { provider: "youtube", accountId: "UCacme", label: "Acme Channel", secret: refreshBlob, kind: "refresh", orgIds: ["acme"] });
  db.set("connectedAccounts/youtube__UCshared", { provider: "youtube", accountId: "UCshared", label: "Shared Channel", secret: refreshBlob, kind: "refresh", orgIds: ["relax", "acme"] });
  // Instagram: the SAME provider in two orgs, one account each.
  db.set("connectedAccounts/instagram__igrelax", { provider: "instagram", accountId: "igrelax", label: "@ravi", secret: refreshBlob, kind: "refresh", orgIds: ["relax"] });
  db.set("connectedAccounts/instagram__igacme", { provider: "instagram", accountId: "igacme", label: "@acme", secret: refreshBlob, kind: "refresh", orgIds: ["acme"] });
  // An empty array — must read as relax, not as nowhere.
  db.set("connectedAccounts/google__sub1", { provider: "google", accountId: "sub1", label: "me@gmail.com", email: "me@gmail.com", secret: refreshBlob, orgIds: [] });
  // A legacy single-account row: relax's alone.
  db.set("integrations/microsoftTasks", { secret: refreshBlob, email: "legacy@outlook.com" });
  process.env.MS_TASKS_CLIENT_ID ||= "test-ms-client";
  process.env.MS_TASKS_CLIENT_SECRET ||= "test-ms-secret";
  // Defaults: one document per org.
  db.set("config/accountDefaults", { video: "youtube__UCrelax" });
  db.set("config/accountDefaults__acme", { video: "youtube__UCacme" });
  // People per org.
  db.set("identities/me", { label: "Me" });
  db.set("identities/acmeops", { label: "Acme ops", orgId: "acme" });
  // Saved passwords per org.
  db.set("secrets/s-legacy", { name: "old-api-key", kind: "apiKey", value: "sealed-a", agentReadable: false });
  db.set("secrets/s-relax", { name: "relax-key", kind: "apiKey", value: "sealed-b", orgId: "relax" });
  db.set("secrets/s-acme", { name: "acme-key", kind: "apiKey", value: "sealed-c", orgId: "acme" });
};
seed();
const ids = (rows) => rows.map((a) => a.accountId).sort().join(",");

console.log("\nthe connected-account store filters by org");
{
  const relax = await store.listAccounts("tok", undefined);
  check(ids(relax) === "UCrelax,UCshared,igrelax,sub1", "relax (no run): the pre-org, empty-array and shared accounts", ids(relax));
  check(relax.find((a) => a.accountId === "UCrelax").orgIds.join() === "relax", "a missing orgIds is shaped as [relax]");
  check(relax.find((a) => a.accountId === "sub1").orgIds.join() === "relax", "an empty orgIds is shaped as [relax]");
  check(relax.every((a) => !("secret" in a)), "no row carries the sealed secret");
  const acme = await runInOrg("acme", () => store.listAccounts("tok", undefined));
  check(ids(acme) === "UCacme,UCshared,igacme", "acme (runInOrg): acme's and the shared one only", ids(acme));
  const acmeExplicit = await store.listAccounts("tok", "youtube", { org: "acme" });
  check(ids(acmeExplicit) === "UCacme,UCshared", "an explicit { org } outside any run, for one provider", ids(acmeExplicit));
  const beta = await runInOrg("beta", () => store.listAccounts("tok", undefined));
  check(beta.length === 0, "an org with nothing in it is empty, not relax's");
  const all = await store.listAccounts("tok", undefined, { allOrgs: true });
  check(all.length === 6, "allOrgs sees every account", String(all.length));
  check(all.find((a) => a.accountId === "UCshared").orgIds.join() === "relax,acme", "a shared account carries both orgs");
  await rejects(runInOrg("ghost", () => store.listAccounts("tok", undefined)), "an org that does not exist is refused, not empty", { code: "org/unknown", re: /acme/ });
}

console.log("\nlegacy rows are relax's only");
{
  const relax = await dir.allAccounts("tok");
  const leg = relax.filter((a) => a.legacy);
  check(leg.length === 1 && leg[0].provider === "microsoft" && leg[0].orgIds.join() === "relax", "relax sees the legacy Microsoft row, filed under relax", JSON.stringify(leg.map((a) => a.key)));
  const acme = await runInOrg("acme", () => dir.allAccounts("tok"));
  check(!acme.some((a) => a.legacy), "acme sees no legacy row");
  resetLog();
  await runInOrg("acme", () => dir.allAccounts("tok"));
  check(!log.some((c) => c.path.startsWith("integrations/")), "and does not even read the legacy store");
  const every = await dir.allAccounts("tok", undefined, { allOrgs: true });
  check(every.some((a) => a.legacy) && every.length === 7, "the cross-org roster includes it once", String(every.length));
  const { readConnection } = await import("../lib/server/connectedAccount.js");
  check((await runInOrg("acme", () => readConnection("tok", "microsoft"))) === null, "readConnection outside relax is null");
  check(!!(await readConnection("tok", "microsoft")), "readConnection in relax still finds it");
}

console.log("\nchoosing an account, per org");
{
  const everything = await dir.allAccounts("tok", undefined, { allOrgs: true });
  throws(() => dir.chooseAccount(everything, { service: "photos" }), "across ALL orgs two Instagram accounts are ambiguous", { code: "account/ambiguous" });
  const relaxPool = everything.filter((a) => a.orgIds.includes("relax"));
  const acmePool = everything.filter((a) => a.orgIds.includes("acme"));
  const r = dir.chooseAccount(relaxPool, { service: "photos", orgId: "relax" });
  check(r.accountId === "igrelax" && r.chosenBy === "only" && r.orgId === "relax", "inside relax: the only one, no ambiguity");
  const a = dir.chooseAccount(acmePool, { service: "photos", orgId: "acme" });
  check(a.accountId === "igacme" && a.chosenBy === "only" && a.orgId === "acme", "inside acme: the only one, no ambiguity");
  try {
    dir.chooseAccount(acmePool, { service: "video", orgId: "acme" });
    check(false, "two acme channels and no default refuse");
  } catch (e) {
    check(e.code === "account/ambiguous" && e.orgId === "acme", "two acme channels and no default refuse, stamped acme");
    check(/ in acme/.test(e.message) && !/UCrelax/.test(e.message), "the refusal names the org and lists only its accounts", e.message);
  }
  try {
    dir.chooseAccount([], { service: "photos" });
  } catch (e) {
    check(e.orgId === "relax" && !/ in relax/.test(e.message), "a relax refusal is stamped relax but reads as it always did");
  }
  const def = dir.chooseAccount(acmePool, { service: "video", defaults: { video: "youtube__UCacme" }, orgId: "acme" });
  check(def.accountId === "UCacme" && def.chosenBy === "default", "acme's default decides inside acme");
  throws(
    () => dir.chooseAccount(acmePool, { service: "video", defaults: { video: "youtube__UCrelax" }, orgId: "acme" }),
    "a default naming another org's account is stale here, not silently honoured",
    { code: "account/stale-default" }
  );
}

console.log("\nresolution and defaults through the directory");
{
  const rr = await dir.resolveAccount("tok", { service: "video" });
  check(rr.accountId === "UCrelax" && rr.chosenBy === "default" && rr.orgId === "relax" && rr.orgSource === "default", "relax resolves video to relax's saved default", JSON.stringify([rr.accountId, rr.chosenBy, rr.orgSource]));
  const ra = await runInOrg("acme", () => dir.resolveAccount("tok", { service: "video" }));
  check(ra.accountId === "UCacme" && ra.orgId === "acme" && ra.orgSource === "explicit", "acme resolves video to ACME's default", JSON.stringify([ra.accountId, ra.orgSource]));
  const rh = await runInOrg("acme", () => dir.resolveAccount("tok", { service: "photos" }), { source: "header" });
  check(rh.accountId === "igacme" && rh.orgSource === "header", "and reports that the org came from the header");
  const ex = await rejects(runInOrg("acme", () => dir.resolveAccount("tok", { provider: "youtube", accountId: "UCrelax" })), "naming relax's channel from acme is refused", { code: "account/unknown" });
  check(ex?.orgId === "acme", "and the refusal carries the org it was refused in");

  const d1 = await dir.readDefaults("tok");
  const d2 = await dir.readDefaults("tok", { org: "acme" });
  check(d1.video === "youtube__UCrelax" && d2.video === "youtube__UCacme", "each org reads its own defaults document");
  check(!("id" in d2), "the document's own id is not mistaken for a service");
  check(Object.keys(await dir.readDefaults("tok", { org: "beta" })).length === 0, "an org with no defaults document has none");

  resetLog();
  const bad = await rejects(runInOrg("acme", () => dir.writeDefault("tok", "video", "youtube__UCrelax")), "writeDefault refuses a key outside the org", { code: "account/unknown", re: /in acme/ });
  check(bad?.orgId === "acme", "the refusal carries orgId");
  check(writes().length === 0, "and writes nothing", JSON.stringify(writes()));
  const ok = await runInOrg("acme", () => dir.writeDefault("tok", "video", "youtube__UCshared"));
  check(ok.orgId === "acme" && db.get("config/accountDefaults__acme").video === "youtube__UCshared", "a shared account can be acme's default, written to acme's document");
  check(db.get("config/accountDefaults").video === "youtube__UCrelax", "relax's default is untouched");
  const cleared = await runInOrg("acme", () => dir.writeDefault("tok", "photos", ""));
  check(cleared.key === "" && db.get("config/accountDefaults__acme").photos === "", "an empty key clears without a membership check");
  await rejects(dir.writeDefault("tok", "tweeting", ""), "an unknown service is refused", { code: "account/unknown-service" });
  seed();
}

console.log("\npeople are per org");
{
  const r = await dir.listIdentities("tok");
  const a = await runInOrg("acme", () => dir.listIdentities("tok"));
  check(r.map((i) => i.id).join() === "me" && r[0].orgId === "relax", "relax: the pre-org identity, filed under relax");
  check(a.map((i) => i.id).join() === "acmeops", "acme: only acme's");
  check((await dir.listIdentities("tok", { allOrgs: true })).length === 2, "allOrgs: both");
}

console.log("\nmembership is checked by name, too");
{
  const hit = await runInOrg("acme", () => dir.assertAccountInOrg("tok", "youtube", "UCshared"));
  check(hit.accountId === "UCshared" && hit.orgId === "acme", "a shared account is in acme");
  await rejects(runInOrg("acme", () => dir.assertAccountInOrg("tok", "youtube", "UCrelax")), "relax's channel named from acme is another org's", { code: "account/other-org", re: /relax/ });
  await rejects(runInOrg("acme", () => dir.assertAccountInOrg("tok", "youtube", "UCnobody")), "an account that does not exist anywhere is unknown, not other-org", { code: "account/unknown" });
}

console.log("\nconnectedToken refuses another org's account BEFORE the refresh");
{
  resetLog();
  const e = await rejects(runInOrg("acme", () => store.connectedToken("tok", "youtube", "UCrelax")), "relax's channel from acme: account/other-org", { code: "account/other-org" });
  check(e?.name === "ConnectedAuthError" && e?.accountId === "UCrelax", "a ConnectedAuthError naming the account");
  check(unexpected.length === 0, "and no token endpoint was ever called", unexpected.join(" | "));
  // The contrast that proves the stub would have SEEN a refresh: the same
  // call in relax gets past the org check and reaches Google's token endpoint.
  resetLog();
  await rejects(store.connectedToken("tok", "youtube", "UCrelax"), "the same call in relax gets as far as the refresh", { code: "social/rejected" });
  check(unexpected.some((u) => /oauth2\.googleapis\.com\/token/.test(u)), "which the stub saw as a request to Google's token endpoint", unexpected.join(" | "));
  resetLog();
  const amb = await rejects(runInOrg("acme", () => store.connectedToken("tok", "youtube")), "no accountId in acme with two channels: ambiguous", { code: "social/ambiguous" });
  check(amb && !/UCrelax/.test(amb.message) && /UCacme/.test(amb.message), "listing acme's channels only");
  check(unexpected.length === 0, "still without a refresh");
  const none = await rejects(runInOrg("beta", () => store.connectedToken("tok", "instagram")), "nothing in beta: refused, naming beta", { re: / in beta/ });
  check(none?.code === "social/disconnected", "as 'disconnected', not as another org's account");
  const raw = await store.readAccount("tok", "youtube", "UCrelax", { allOrgs: true });
  check(raw?.accountId === "UCrelax", "readAccount with allOrgs (the Orgs panel) reads across orgs");
  await rejects(store.readAccount("tok", "youtube", "UCacme"), "readAccount in relax refuses acme's channel", { code: "account/other-org" });
  check((await store.readAccount("tok", "youtube", "UCnone")) === null, "readAccount of nothing is null");
}

console.log("\nthe OAuth state carries the org");
{
  const s = integ.readState(integ.makeState({ provider: "youtube", uid: "u1", redirectUri: "https://x/cb", from: "youtube", orgId: "acme" }));
  check(s.orgId === "acme" && s.provider === "youtube" && s.uid === "u1", "makeState/readState round-trips acme");
  check(s.from === "youtube", "and the panel that started it (it used to be dropped)");
  check(integ.readState(integ.makeState({ provider: "youtube", uid: "u1", redirectUri: "x" })).orgId === "relax", "no org → relax");
  check(integ.readState(integ.makeState({ provider: "youtube", uid: "u1", redirectUri: "x", orgId: "Evil Org" })).orgId === "relax", "a malformed org is not sealed");
  const blob = integ.makeState({ provider: "youtube", uid: "u1", redirectUri: "x", orgId: "acme" });
  check(!blob.includes("acme"), "the org is sealed, not readable in the state string");
  throws(() => integ.readState(blob.slice(0, -4) + "AAAA"), "a tampered state is refused");

  const r1 = store.connectedRecord({ provider: "youtube", accountId: "UCx", sealed: "s", orgIds: ["acme"] });
  check(r1.orgIds.join() === "acme", "connectedRecord takes the state's org");
  const r2 = runInOrg("beta", () => store.connectedRecord({ provider: "youtube", accountId: "UCx", sealed: "s" }));
  check(r2.orgIds.join() === "beta", "with none given, the request's org");
  const r3 = store.connectedRecord({ provider: "youtube", accountId: "UCx", sealed: "s", orgIds: [] });
  check(r3.orgIds.join() === "relax", "outside any request, relax");
  check(integ.connectionRecord({ provider: "microsoft", sealed: "s" }).orgIds.join() === "relax", "a legacy-store record can only ever be relax's");
}

/* ------------------------------------------------------------------ *
 * The MCP dispatcher                                                   *
 * ------------------------------------------------------------------ */

console.log("\nthe MCP dispatcher: which org each call acts in");
const mcp = await import("../lib/server/mcpTools.js");
{
  const raw = { orgId: "acme", provider: "youtube" };
  const c1 = mcp.orgForCall(raw, { headers: { "x-org-id": "beta" } });
  check(c1.orgId === "acme" && c1.source === "explicit", "the call's own orgId beats the header");
  check(!("orgId" in c1.args) && c1.args.provider === "youtube", "orgId is stripped from the arguments the handler sees");
  check(raw.orgId === "acme", "as a copy — the caller's object is untouched");
  const c2 = mcp.orgForCall({ provider: "youtube" }, { headers: { "x-org-id": "beta" } });
  check(c2.orgId === "beta" && c2.source === "header", "no argument: the connection's header");
  const c3 = mcp.orgForCall({}, { headers: {} });
  check(c3.orgId === "relax" && c3.source === "default", "neither: relax, source default");
  const c4 = mcp.orgForCall({}, { headers: { "x-org-id": "NOT VALID" } });
  check(c4.orgId === "relax", "a malformed header is ignored");
  throws(() => mcp.orgForCall({ orgId: "not valid!" }, {}), "a malformed orgId the call DID pass is refused, not swapped for relax", { code: "org/bad-id" });
  check(mcp.orgForCall({ orgId: "ACME" }, {}).orgId === "acme", "an explicit id is lowercased");
  check(mcp.orgForCall({ orgId: "" }, { headers: { "x-org-id": "beta" } }).orgId === "beta", "an empty orgId counts as not given");
  check(JSON.stringify(mcp.orgForCall(null, {}).args) === "{}" && JSON.stringify(mcp.orgForCall(["x"], {}).args) === "{}", "non-object arguments become {}");

  const listed = mcp.listToolsFor(["read", "write", "secrets", "vault"]);
  const byName = Object.fromEntries(listed.map((t) => [t.name, t]));
  check(!!byName.list_accounts?.inputSchema?.properties?.orgId, "list_accounts advertises orgId");
  check(!(mcp.toolByName("list_accounts").inputSchema.properties || {}).orgId, "without writing it into the registry itself");
  check(!!byName.list_youtube_videos?.inputSchema?.properties?.orgId, "a tool declaring accountId advertises orgId");
  check(!byName.crosspost_to_devto?.inputSchema?.properties?.orgId, "a deployment-scoped tool does not advertise orgId");
  check(!byName.list_orgs?.inputSchema?.properties?.orgId && !byName.delete_org?.inputSchema?.properties?.orgId, "the org tools take their target as id, not orgId");
  check(listed.every((t) => !(t.inputSchema?.required || []).includes("orgId")), "orgId is never required");
  for (const n of ["list_orgs", "get_org", "create_org", "update_org", "set_account_orgs", "delete_org", "migrate_logins_to_org"]) {
    check(!!mcp.toolByName(n), `${n} exists`);
  }
  check(mcp.toolByName("list_orgs").scope === "read" && mcp.toolByName("create_org").scope === "write", "list_orgs reads, create_org writes");
}

// A mirror of the dispatcher's per-call block in pages/api/mcp/index.js — the
// route cannot be imported outside webpack. Because a mirror that drifts
// passes while the real dispatcher is broken, the source assertions below pin
// the properties this relies on.
const dispatch = async (tool, rawArgs, req) => {
  const call = mcp.orgForCall(rawArgs, req);
  return runInOrg(
    call.orgId,
    async () => {
      await ensureOrgKnown("tok");
      shapeMod.assertDeploymentScope(shapeMod.deploymentScopedFor(tool.name), call.orgId);
      return tool.handler(call.args, { idToken: "tok", claims: {}, orgId: call.orgId, tokenId: "" });
    },
    { source: call.source }
  );
};

console.log("\nthe dispatcher, driven");
{
  const src = fs.readFileSync(path.join(root, "pages/api/mcp/index.js"), "utf8");
  const at = (s) => src.indexOf(s);
  check(at("orgForCall(params?.arguments, req)") > 0, "the route resolves the org with orgForCall");
  check(at("runInOrg(") > 0 && !src.includes(".enterWith("), "per call with runInOrg, never enterWith");
  check(at("await ensureOrgKnown(idToken)") > 0 && at("await ensureOrgKnown(idToken)") < at("tool.handler(callArgs"), "the unknown-org check runs before the handler");
  check(at("assertDeploymentScope(deploymentScopedFor(tool.name), orgId)") > 0 && at("assertDeploymentScope(") < at("tool.handler(callArgs"), "the deployment-scope check runs before the handler");
  check(/tool\.handler\(callArgs,/.test(src) && !/tool\.handler\(params\?\.arguments/.test(src), "the handler gets the STRIPPED arguments");
  check(/\{ source: call\.source \}/.test(src), "the source is passed to runInOrg");

  const la = mcp.toolByName("list_accounts");
  const out = await dispatch(la, { orgId: "acme" }, { headers: {} });
  check(out.orgId === "acme" && out.orgSource === "explicit", "list_accounts with orgId acme acts in acme", JSON.stringify([out.orgId, out.orgSource]));
  check(ids(out.accounts) === "UCacme,UCshared,igacme", "and lists acme's accounts only", ids(out.accounts));
  const outH = await dispatch(la, {}, { headers: { "x-org-id": "acme" } });
  check(outH.orgId === "acme" && outH.orgSource === "header", "the header alone moves it to acme too");
  const outR = await dispatch(la, {}, { headers: {} });
  check(outR.orgId === "relax" && outR.accounts.some((a) => a.accountId === "UCrelax"), "neither: relax");

  let seenArgs = null;
  const spy = { name: "list_accounts", handler: async (args) => ((seenArgs = args), { ok: true }) };
  await dispatch(spy, { orgId: "acme", provider: "youtube" }, {});
  check(seenArgs && !("orgId" in seenArgs) && seenArgs.provider === "youtube", "the handler never sees orgId");

  let called = false;
  const spy2 = { name: "list_accounts", handler: async () => ((called = true), {}) };
  const ghost = await rejects(dispatch(spy2, { orgId: "ghost" }, {}), "an unknown org is refused", { code: "org/unknown", re: /Known orgs: relax, acme, beta/ });
  check(ghost && !called, "before the handler runs");

  let ran = false;
  const devto = { name: "crosspost_to_devto", handler: async () => ((ran = true), { ok: true }) };
  await rejects(dispatch(devto, { orgId: "acme" }, {}), "crosspost_to_devto in acme is refused", { code: "org/deployment-scoped" });
  check(!ran, "before the handler runs");
  const okDevto = await dispatch(devto, {}, {});
  check(ran && okDevto.ok, "crosspost_to_devto in relax passes the org gate");
  ran = false;
  await rejects(dispatch({ name: "whatsapp_send_message", handler: async () => ((ran = true), {}) }, {}, { headers: { "x-org-id": "beta" } }), "a WhatsApp tool in beta (by header) is refused", { code: "org/deployment-scoped" });
  check(!ran, "without running");
}

console.log("\nsaved passwords are filed per org");
{
  const ls = mcp.toolByName("list_secrets");
  const r = await dispatch(ls, {}, {});
  const names = (o) => o.secrets.map((s) => s.name).sort().join(",");
  check(names(r) === "old-api-key,relax-key", "relax: the pre-org secret and relax's", names(r));
  const a = await dispatch(ls, { orgId: "acme" }, {});
  check(names(a) === "acme-key" && a.orgId === "acme", "acme: only acme's", names(a));
  check(a.secrets.every((s) => !("value" in s)), "a listing row carries no value");
  const b = await dispatch(ls, { orgId: "beta" }, {});
  check(b.count === 0, "beta: none");
  const { secretOrg, secretInOrg } = await import("../lib/server/secretStore.js");
  check(secretOrg({}) === "relax" && secretOrg({ orgId: "BAD" }) === "relax", "a secret with no (or a bad) orgId is relax's");
  check(secretInOrg({ orgId: "acme" }, "acme") && !secretInOrg({ orgId: "acme" }, "relax"), "secretInOrg is exact");
}

/* ------------------------------------------------------------------ *
 * Forgetting, per org                                                  *
 * ------------------------------------------------------------------ */

console.log("\nforgetting removes the org; the credential goes only with the last one");
{
  // The REAL rule: pages/api/accounts.js `forget` is a thin wrapper round
  // orgStore.forgetFromOrg, pinned below, so this drives what the route runs.
  const { forgetFromOrg } = await import("../lib/server/orgStore.js");
  const forget = (provider, accountId, org) => forgetFromOrg("tok", provider, accountId, { org });
  const src = fs.readFileSync(path.join(root, "pages/api/accounts.js"), "utf8");
  const body = src.slice(src.indexOf('action === "forget"'), src.indexOf('action === "saveLogin"'));
  check(/forgetFromOrg\(idToken, provider, accountId, \{ org \}\)/.test(body), "the route calls orgStore.forgetFromOrg in the current org");
  check(!/deleteDocument\(/.test(body) && !/patchDocument\(/.test(body), "and writes nothing itself — the rule lives in one place");

  seed();
  db.get("connectedAccounts/youtube__UCshared").identityIds = { relax: "me", acme: "acmeops" };
  const a = await forget("youtube", "UCshared", "acme");
  check(a.deleted === false && a.remaining.join() === "relax" && a.legacy === false, "forgetting the shared channel in acme keeps it for relax");
  check(db.has("connectedAccounts/youtube__UCshared") && db.get("connectedAccounts/youtube__UCshared").orgIds.join() === "relax", "the document stays, now relax-only");
  check(!!db.get("connectedAccounts/youtube__UCshared").secret, "with its credential intact");
  check(JSON.stringify(db.get("connectedAccounts/youtube__UCshared").identityIds) === '{"relax":"me"}', "and acme's grouping of it goes with acme, relax's stays");
  const b = await forget("youtube", "UCshared", "relax");
  check(b.deleted === true && !db.has("connectedAccounts/youtube__UCshared"), "forgetting it in relax too deletes the document");
  const c = await forget("youtube", "UCrelax", "relax");
  check(c.deleted && !db.has("connectedAccounts/youtube__UCrelax"), "a pre-org (no orgIds) account forgotten in relax is deleted");
  await rejects(forget("youtube", "UCacme", "relax"), "forgetting acme's channel from relax is refused", { code: "account/other-org" });
  check(db.has("connectedAccounts/youtube__UCacme"), "and it survives");

  // Regression: a stale selection used to read as "legacy" and delete the
  // legacy connection nobody named.
  const gone = await forget("youtube", "UCshared", "relax");
  check(gone.deleted === false && gone.legacy === false && !("remaining" in gone), "an account that is simply gone is NOT reported as legacy");
  check(db.has("integrations/microsoftTasks"), "and nothing touched the legacy store");
  const leg = await forget("microsoft", "legacy@outlook.com", "relax");
  check(leg.legacy === true && !("remaining" in leg), "relax's real legacy row IS reported as legacy (the browser removes it)");
  const legAcme = await forget("microsoft", "legacy@outlook.com", "acme");
  check(legAcme.legacy === false, "the same name in acme is not acme's legacy row");
  const tp = fs.readFileSync(path.join(root, "lib/taskProviders.js"), "utf8");
  const disc = tp.slice(tp.indexOf("export async function disconnect"), tp.indexOf("const live = new Map()"));
  check(/out\.legacy !== true/.test(disc) && disc.indexOf("out.legacy !== true") < disc.indexOf('deleteDoc(doc(db, "integrations"'), "the Tasks client deletes the legacy store ONLY when the server says legacy");
  check(/current\.set\(provider, ""\)/.test(disc), "and clears the selection after a disconnect");
  const panel = fs.readFileSync(path.join(root, "components/admin/TasksPanel.js"), "utf8");
  const unlink = panel.slice(panel.indexOf("const unlink = async"), panel.indexOf("/* ---------------- writes"));
  check(/from \$\{orgName\}/.test(unlink), "the Tasks disconnect confirm names the org it removes the account from");
  check(/try \{\s*await disconnect\(provider\)/.test(unlink), "and a refusal is caught and shown, not an unhandled rejection");
  seed();
}

console.log("\npeople are filed per org, even on a shared account");
{
  const { identityIdIn, withIdentity, withoutIdentity } = shapeMod;
  check(identityIdIn({ identityId: "me" }, "relax") === "me" && identityIdIn({ identityId: "me" }, "acme") === "", "the old single field is relax's alone");
  const both = { identityId: "me", identityIds: { acme: "brand" } };
  check(identityIdIn(both, "acme") === "brand" && identityIdIn(both, "relax") === "me", "each org reads its own entry");
  check(JSON.stringify(withIdentity(both, "acme", "ops")) === '{"acme":"ops"}', "setting acme's entry leaves relax's answer alone");
  check(identityIdIn({ identityId: "me", identityIds: withIdentity({ identityId: "me" }, "relax", "") }, "relax") === "", "clearing relax's overrides the legacy field");
  check(JSON.stringify(withoutIdentity(both, "acme")) === "{}", "withoutIdentity drops one org's entry");

  seed();
  db.get("connectedAccounts/youtube__UCshared").identityIds = { relax: "me", acme: "acmeops" };
  const r = (await dir.allAccounts("tok")).find((x) => x.accountId === "UCshared");
  const a = (await runInOrg("acme", () => dir.allAccounts("tok"))).find((x) => x.accountId === "UCshared");
  check(r.identityId === "me" && a.identityId === "acmeops", "the shared channel is under relax's person in relax and acme's in acme", `${r.identityId} / ${a.identityId}`);
  const src = fs.readFileSync(path.join(root, "pages/api/accounts.js"), "utf8");
  const assign = src.slice(src.indexOf('action === "assign"'), src.indexOf('action === "forget"'));
  check(/identityIds: withIdentity\(current, org,/.test(assign) && !/identityId: String/.test(assign), "assign writes only this org's entry of the map");
  seed();
}

console.log("\na saved sign-in follows its ACCOUNT — one rule for read, write and delete");
{
  const sec = await import("../lib/server/secretStore.js");
  const orgStoreMod = await import("../lib/server/orgStore.js");
  const login = (provider, accountId) => {
    const { id, record } = sec.buildRecord({
      name: sec.loginSecretName(provider, accountId),
      value: "hunter2-" + accountId,
      kind: "password",
      username: "me",
      tags: ["login", provider],
      agentReadable: true,
      provider,
      accountId,
      orgId: "relax",
    });
    db.set(`secrets/${id}`, record);
    return id;
  };
  check(sec.signInOf({ name: "login-youtube-ucx", provider: "youtube", accountId: "UCx" })?.key === "youtube__UCx", "a sign-in is recognised by its derived name");
  check(sec.signInOf({ name: "my-own", provider: "youtube", accountId: "UCx" }) === null, "a hand-made secret that merely names an account is not a sign-in");
  const m = { here: new Set(["youtube__UCa"]), anywhere: new Set(["youtube__UCa", "youtube__UCb"]) };
  const si = (acct, orgId) => ({ name: sec.loginSecretName("youtube", acct), provider: "youtube", accountId: acct, orgId });
  check(sec.secretVisibleIn(si("UCa", "relax"), "acme", m), "visible where the account is a member, whoever filed it");
  check(!sec.secretVisibleIn(si("UCb", "acme"), "acme", m), "hidden where the account is not, even when filed there");
  check(sec.secretVisibleIn(si("UCgone", "acme"), "acme", m) && !sec.secretVisibleIn(si("UCgone", "acme"), "relax", m), "an account connected nowhere falls back to where it was filed — never stranded");
  check(sec.secretVisibleIn({ orgId: "acme" }, "acme", m) && !sec.secretVisibleIn({ orgId: "acme" }, "relax", m), "an ordinary secret is still filed by orgId");

  seed();
  const shared = login("youtube", "UCshared");
  const getLogin = mcp.toolByName("get_account_login");
  const inAcme = await dispatch(getLogin, { orgId: "acme", provider: "youtube", accountId: "UCshared" }, {});
  check(inAcme.password === "hunter2-UCshared", "acme reads the sign-in of a channel it shares, though relax saved it", JSON.stringify(inAcme).slice(0, 160));

  // The defect: the account moves to acme only; relax kept reading the password.
  const moved = login("youtube", "UCrelax");
  await orgStoreMod.setAccountOrgs("tok", "youtube", "UCrelax", ["acme"]);
  const ls = mcp.toolByName("list_secrets");
  const rl = await dispatch(ls, {}, {});
  check(!rl.secrets.some((x) => x.id === moved), "relax, which no longer holds the account, no longer lists its sign-in");
  await rejects(dispatch(mcp.toolByName("get_secret"), { name: moved }, {}), "and get_secret in relax refuses it as missing", { re: /No secret named/ });
  const al = await dispatch(ls, { orgId: "acme" }, {});
  check(al.secrets.some((x) => x.id === moved) && al.secrets.some((x) => x.id === shared), "acme, which holds both accounts, lists both sign-ins");
  const ga = await dispatch(getLogin, { orgId: "acme", provider: "youtube", accountId: "UCrelax" }, {});
  check(ga.password === "hunter2-UCrelax", "and get_account_login in acme reads it — it used to say none was saved", JSON.stringify(ga).slice(0, 160));
  await rejects(dispatch(mcp.toolByName("delete_secret"), { name: moved, confirm: true }, {}), "delete_secret in relax cannot delete it", { re: /No secret named/ });
  check(db.has(`secrets/${moved}`), "and it survives");

  // A disconnected account's sign-in is not stranded.
  const orphan = login("youtube", "UCgone");
  const ro = await dispatch(ls, {}, {});
  check(ro.secrets.some((x) => x.id === orphan), "a sign-in whose account is gone stays visible where it was filed");

  // The routes ask the same rule before writing or deleting.
  const src = fs.readFileSync(path.join(root, "pages/api/accounts.js"), "utf8");
  const save = src.slice(src.indexOf('action === "saveLogin"'), src.indexOf('action === "forgetLogin"'));
  const forgetL = src.slice(src.indexOf('action === "forgetLogin"'), src.indexOf('action === "connectKey"'));
  check(save.indexOf("dir.secretVisible(idToken, existing") > 0 && save.indexOf("dir.secretVisible(") < save.indexOf("patchDocument("), "saveLogin refuses to overwrite a sign-in this org could not read, before patching");
  check(forgetL.indexOf("dir.secretVisible(idToken, existing") > 0 && forgetL.indexOf("dir.secretVisible(") < forgetL.indexOf("deleteDocument("), "forgetLogin refuses to delete one, before deleting");
  const ss = fs.readFileSync(path.join(root, "pages/api/secrets.js"), "utf8");
  check((ss.match(/secretVisible\(idToken,/g) || []).length >= 3 && /secretVisibleIn\(r, org, membership\)/.test(ss), "/api/secrets list, reveal, save and delete ask the same rule");
  const gl = getLogin.handler.toString();
  check(!/secretInOrg/.test(gl) && /secretVisible\(/.test(gl), "get_account_login no longer gates on the secret's own orgId");
  seed();
}

console.log("\nLinkedIn post history is per org");
{
  const { rowInOrg } = shapeMod;
  check(rowInOrg({ orgId: "acme" }, "acme") && !rowInOrg({ orgId: "acme" }, "relax"), "a stamped row is its org's");
  check(rowInOrg({ accountId: "li1" }, "relax") && !rowInOrg({ accountId: "li1" }, "acme"), "an unstamped row with an accountId is relax's ONLY");
  check(rowInOrg({}, "relax") && !rowInOrg({}, "acme"), "a bare pre-org row is relax's");

  seed();
  db.set("linkedinPosts/p1", { urn: "urn:li:share:1", text: "relax, pre-accounts", postedAt: "2026-09-01" });
  db.set("linkedinPosts/p2", { urn: "urn:li:share:2", text: "relax, with account", postedAt: "2026-10-08", accountId: "li1" });
  db.set("linkedinPosts/p3", { urn: "urn:li:share:3", text: "acme", postedAt: "2026-10-09", accountId: "li2", orgId: "acme" });
  const list = mcp.toolByName("list_linkedin_posts");
  const r = await dispatch(list, {}, {});
  const a = await dispatch(list, { orgId: "acme" }, {});
  check(r.posts.map((x) => x.urn).sort().join() === "urn:li:share:1,urn:li:share:2", "relax lists its own and the pre-org history");
  check(a.posts.map((x) => x.urn).join() === "urn:li:share:3", "acme lists acme's alone — not relax's whole history");
  const create = mcp.toolByName("create_linkedin_post").handler.toString();
  check(/orgId: currentOrg\(\)/.test(create) && /accountId: account\?\.accountId/.test(create), "create_linkedin_post stamps the org and the account that published it");
  const lc = fs.readFileSync(path.join(root, "lib/linkedinClient.js"), "utf8");
  const lp = lc.slice(lc.indexOf("export async function listPosts"), lc.indexOf("export const markDeleted"));
  check(/rowInOrg\(r, org\)/.test(lp) && !/r\.accountId \? true/.test(lp), "the panel's history uses the same rule, with no accountId loophole");
  check(/orgId: currentOrgId\(\)/.test(lc), "and the panel's own posts are stamped with the org");
  seed();
}

console.log("\nthe deployment's logins are fenced on the API routes too");
{
  for (const [f, fam] of [["pages/api/devto/publish.js", "devto"], ["pages/api/devto/list.js", "devto"], ["pages/api/medium/list.js", "medium"]]) {
    const s = fs.readFileSync(path.join(root, f), "utf8");
    const at = s.indexOf(`assertDeploymentScope(deploymentScopedFamily("${fam}"), currentOrg())`);
    check(at > 0 && at < s.lastIndexOf("try {"), `${f} refuses outside relax before calling out`);
  }
  const env = fs.readFileSync(path.join(root, "pages/api/env.js"), "utf8");
  const atEnv = env.indexOf('assertDeploymentScope(deploymentScopedFamily("env"), currentOrg())');
  check(atEnv > 0 && atEnv < env.indexOf("writeEnv(idToken"), "/api/env refuses a write outside relax before writing");
  let ran = false;
  await rejects(dispatch({ name: "set_env_var", handler: async () => ((ran = true), {}) }, { orgId: "acme" }, {}), "set_env_var in acme is refused", { code: "org/deployment-scoped" });
  check(!ran, "without running");
}

console.log("\na claim never evicts an account from relax");
{
  const { claimOrgIds } = shapeMod;
  check(JSON.stringify(claimOrgIds({ provider: "youtube" }, ["acme"])) === '["relax","acme"]', "a pre-org document (no orgIds) keeps relax when acme claims it");
  check(JSON.stringify(claimOrgIds({ orgIds: [] }, ["acme"])) === '["relax","acme"]', "so does an empty array");
  check(claimOrgIds({ orgIds: ["relax"] }, ["acme"]) === null, "an explicit array can take a Firestore arrayUnion");
  check(JSON.stringify(claimOrgIds(null, ["acme"])) === '["acme"]', "a brand-new account is filed under the claiming org only");
  const sc = fs.readFileSync(path.join(root, "lib/socialClient.js"), "utf8");
  const fc = sc.slice(sc.indexOf("export async function finishConnect"), sc.indexOf("export const disconnect"));
  check(/getDoc\(ref\)/.test(fc) && /claimOrgIds\(existing, ids\)/.test(fc) && fc.indexOf("getDoc(ref)") < fc.indexOf("setDoc("), "finishConnect reads the stored document before writing membership");
}

console.log("\nevery admin URL names its org");
{
  const os = fs.readFileSync(path.join(root, "lib/orgState.js"), "utf8");
  const setOrgSrc = os.slice(os.indexOf("export function setOrg"), os.indexOf("export function orgParam"));
  check(/next\.searchParams\.set\("org", id\)/.test(setOrgSrc) && !/id !== DEFAULT_ORG\) next/.test(setOrgSrc), "switching to relax writes org=relax too");
  const op = os.slice(os.indexOf("export function orgParam"), os.indexOf("export const orgKey"));
  check(/return currentOrgId\(\);/.test(op), "orgParam is never empty");
  const ut = fs.readFileSync(path.join(root, "lib/useTabInUrl.js"), "utf8");
  check(/replaceState/.test(ut) && ut.indexOf("replaceState") < ut.indexOf("setSynced(true)"), "the first paint writes the org into the URL");
}

console.log("\nthe browser reaches our routes through adminFetch only");
{
  const offenders = [];
  for (const d of ["lib", "components/admin"]) {
    for (const f of fs.readdirSync(path.join(root, d))) {
      // firebase.js reads the PUBLIC /api/public-env before auth exists, and
      // adminFetch itself imports firebase.js — it is the one exemption.
      if (!f.endsWith(".js") || `${d}/${f}` === "lib/firebase.js") continue;
      const s = fs.readFileSync(path.join(root, d, f), "utf8");
      if (/fetch\(\s*["'`]\/api\//.test(s)) offenders.push(`${d}/${f}`);
    }
  }
  check(offenders.length === 0, 'no browser file calls fetch("/api/…") directly (media and vault signing included)', offenders.join(", "));
}

/* ------------------------------------------------------------------ *
 * The org store                                                        *
 * ------------------------------------------------------------------ */

const orgStore = await import("../lib/server/orgStore.js");

console.log("\nthe org records");
{
  seed();
  const orgs = await orgStore.listOrgs("tok");
  check(orgs[0].id === "relax" && orgs[0].isDefault, "relax is listed first even with no document");
  check(orgs.map((o) => o.id).join() === "relax,acme,beta", "then the others by name");
  const counted = await orgStore.listOrgs("tok", { withCounts: true });
  const acme = counted.find((o) => o.id === "acme");
  check(acme.accountCount === 3 && acme.services.includes("video") && acme.services.includes("photos"), "withCounts says what acme holds", JSON.stringify(acme));
  check((await orgStore.getOrg("tok", "relax"))?.id === "relax", "getOrg(relax) is never null");
  check((await orgStore.getOrg("tok", "ghost")) === null, "getOrg of nothing is null");
  await rejects(orgStore.assertOrgExists("tok", "ghost"), "assertOrgExists lists the known orgs", { code: "org/unknown", re: /relax, acme, beta/ });
  const made = await orgStore.createOrg("tok", { name: "Gamma Labs", color: "#00AAFF", website: "https://gamma.example" });
  check(made.id === "gamma-labs" && db.has("orgs/gamma-labs"), "createOrg derives the id from the name");
  await rejects(orgStore.createOrg("tok", { name: "Gamma Labs" }), "a duplicate id is refused", { code: "org/exists" });
  await rejects(orgStore.createOrg("tok", { name: "Relax", id: "relax" }), "relax cannot be created", { code: "org/exists" });
  await rejects(orgStore.createOrg("tok", { name: "X", id: "x", color: "red; background:url(x)" }), "a colour that is not hex is refused", { re: /hex/ });
  await rejects(orgStore.createOrg("tok", { name: "Y", website: "javascript:alert(1)" }), "a website that is not http(s) is refused", { code: "org/bad-field" });
  await rejects(orgStore.updateOrg("tok", "acme", { id: "acme2", name: "A" }), "an org's id cannot be changed", { code: "org/immutable-id" });
  const up = await orgStore.updateOrg("tok", "acme", { name: "Acme Inc" });
  check(up.id === "acme" && up.name === "Acme Inc", "renaming changes the name, not the id");
  const rx = await orgStore.updateOrg("tok", "relax", { description: "home" });
  check(db.has("orgs/relax") && rx.name === "Relax", "relax's first edit writes its document, named Relax");
  seed();
}

console.log("\nmembership edits");
{
  seed();
  await rejects(orgStore.setAccountOrgs("tok", "youtube", "UCacme", []), "an empty set is refused", { code: "org/empty-membership" });
  await rejects(orgStore.setAccountOrgs("tok", "youtube", "UCacme", ["ghost"]), "an org that does not exist is refused", { code: "org/unknown" });
  await rejects(orgStore.setAccountOrgs("tok", "youtube", "UCacme", ["Bad Id"]), "a malformed id is refused", { code: "org/bad-id" });
  await rejects(orgStore.setAccountOrgs("tok", "microsoft", "legacy@outlook.com", ["acme"]), "a legacy row cannot be shared", { code: "account/unknown" });
  const r = await orgStore.setAccountOrgs("tok", "youtube", "UCacme", ["acme", "relax", "acme"]);
  check(r.before.join() === "acme" && r.after.join() === "acme,relax", "before/after are reported, deduped");
  check(db.get("connectedAccounts/youtube__UCacme").orgIds.join() === "acme,relax", "and the whole array is written");
  seed();
}

console.log("\ndeleting an org never deletes a credential");
{
  seed();
  await rejects(orgStore.deleteOrg("tok", "relax", { confirm: true }), "relax cannot be deleted", { code: "org/protected" });
  const busy = await rejects(orgStore.deleteOrg("tok", "acme", { confirm: true }), "acme still holds accounts only it uses: refused even with confirm", { code: "org/not-empty" });
  check(busy?.accounts?.includes("youtube__UCacme") && busy?.secrets?.includes("s-acme"), "and the refusal names them");
  check(db.has("orgs/acme") && db.has("connectedAccounts/youtube__UCacme"), "nothing was deleted");
  // Move acme's sole holdings to relax, then it can go.
  db.get("connectedAccounts/youtube__UCacme").orgIds = ["relax", "acme"];
  db.get("connectedAccounts/instagram__igacme").orgIds = ["relax", "acme"];
  db.get("secrets/s-acme").orgId = "relax";
  const plan = await rejects(orgStore.deleteOrg("tok", "acme"), "without confirm it reports a plan", { code: "org/needs-confirm" });
  check(plan?.plan?.unassigned?.length === 3 && plan.plan.defaultsRemoved === "config/accountDefaults__acme", "the plan lists the shared accounts and the defaults doc");
  const done = await orgStore.deleteOrg("tok", "acme", { confirm: true });
  check(done.deleted === "acme" && !db.has("orgs/acme"), "with confirm it goes");
  check(db.has("connectedAccounts/youtube__UCshared") && db.get("connectedAccounts/youtube__UCshared").orgIds.join() === "relax", "a shared account only loses acme");
  check(!db.has("config/accountDefaults__acme") && !db.has("identities/acmeops"), "acme's defaults and people go with it");
  check([...db.keys()].filter((k) => k.startsWith("connectedAccounts/")).length === 6, "every credential survives");
  seed();
}

console.log("\na failed read never waves a delete through");
{
  for (const coll of ["connectedAccounts", "secrets", "identities"]) {
    seed();
    // Make acme deletable on paper, then break one read.
    db.get("connectedAccounts/youtube__UCacme").orgIds = ["relax", "acme"];
    db.get("connectedAccounts/instagram__igacme").orgIds = ["relax", "acme"];
    db.get("secrets/s-acme").orgId = "relax";
    failingLists.add(coll);
    await rejects(orgStore.deleteOrg("tok", "acme", { confirm: true }), `a failing ${coll} list aborts the delete`);
    failingLists.clear();
    check(db.has("orgs/acme"), `and acme still exists after the ${coll} failure`);
  }
  seed();
  db.get("connectedAccounts/youtube__UCshared").identityIds = { relax: "me", acme: "acmeops" };
  db.get("connectedAccounts/youtube__UCacme").orgIds = ["relax", "acme"];
  db.get("connectedAccounts/instagram__igacme").orgIds = ["relax", "acme"];
  db.get("secrets/s-acme").orgId = "relax";
  await orgStore.deleteOrg("tok", "acme", { confirm: true });
  check(JSON.stringify(db.get("connectedAccounts/youtube__UCshared").identityIds) === '{"relax":"me"}', "deleting acme clears acme's grouping from a shared account");
  const fr = fs.readFileSync(path.join(root, "lib/server/orgStore.js"), "utf8");
  const del = fr.slice(fr.indexOf("export async function deleteOrg"), fr.indexOf("export async function orgOverview"));
  check(!/\.catch\(\(\) => \[\]\)/.test(del.slice(0, del.indexOf("if (sole.length"))), "none of deleteOrg's guard reads swallow a failure");
  seed();
}


console.log("\nthe migration is a dry run by default, and idempotent");
{
  seed();
  resetLog();
  const dry = await orgStore.migrateToOrgs("tok");
  check(dry.dryRun === true && writes().length === 0, "a dry run writes nothing", JSON.stringify(writes()));
  check(dry.orgCreated === true, "it reports relax's record would be written");
  check([...dry.accountsStamped].sort().join() === "google__sub1,youtube__UCrelax", "it finds the accounts with no (or an empty) org", dry.accountsStamped.join());
  check(dry.identitiesStamped === 1 && dry.secretsStamped === 1, "and one pre-org identity and one pre-org secret");
  const again = await orgStore.migrateToOrgs("tok", { dryRun: true });
  check(JSON.stringify(again) === JSON.stringify(dry), "a second dry run reports the same thing");

  resetLog();
  const applied = await orgStore.migrateToOrgs("tok", { dryRun: false });
  check(applied.dryRun === false && db.has("orgs/relax") && db.get("orgs/relax").name === "Relax", "applied: relax's record exists");
  check(db.get("connectedAccounts/youtube__UCrelax").orgIds.join() === "relax" && db.get("connectedAccounts/google__sub1").orgIds.join() === "relax", "pre-org accounts are stamped relax");
  check(db.get("connectedAccounts/youtube__UCacme").orgIds.join() === "acme", "an account already in an org is left exactly as it was");
  check(db.get("identities/me").orgId === "relax" && db.get("secrets/s-legacy").orgId === "relax", "the identity and the secret are stamped");
  const secretWrites = writes().filter((w) => w.path.startsWith("secrets/"));
  check(secretWrites.length === 1 && secretWrites[0].mask.join() === "orgId", "a secret is patched with orgId ALONE — the sealed value is never rewritten", JSON.stringify(secretWrites));
  check(db.get("secrets/s-legacy").value === "sealed-a", "and its value is byte-for-byte the same");

  resetLog();
  const third = await orgStore.migrateToOrgs("tok", { dryRun: false });
  check(third.orgCreated === false && third.accountsStamped.length === 0 && third.identitiesStamped === 0 && third.secretsStamped === 0, "running it again finds nothing to do");
  check(writes().length === 0, "and writes nothing", JSON.stringify(writes()));
  seed();
}

console.log("\noverview");
{
  seed();
  const o = await orgStore.orgOverview("tok", "acme");
  check(o.org.id === "acme" && ids(o.accounts) === "UCacme,UCshared,igacme", "acme's overview holds acme's accounts");
  check(o.byService.video.length === 2 && o.defaults.video === "youtube__UCacme", "by service, with acme's defaults");
  check(o.gaps.includes("tasks") && !o.gaps.includes("video"), "and names the jobs nothing in acme can do");
  await rejects(orgStore.orgOverview("tok", "ghost"), "an overview of nothing is refused", { code: "org/unknown" });
}

/* ------------------------------------------------------------------ *
 * Boundaries                                                           *
 * ------------------------------------------------------------------ */

console.log("\nboundaries");
{
  const shapeSrc = fs.readFileSync(path.join(root, "lib/server/orgShape.js"), "utf8");
  check(!/^\s*import\s/m.test(shapeSrc), "orgShape.js imports nothing (the browser loads it)");
  const browserFiles = ["lib/orgState.js", "lib/adminFetch.js", "lib/orgsClient.js", "components/admin/OrgsPanel.js", "components/admin/AdminShell.js"];
  for (const f of browserFiles) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    const s = fs.readFileSync(p, "utf8");
    check(!/orgContext|async_hooks|orgStore/.test(s), `${f} does not import the server-only org modules`);
  }
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nFailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
