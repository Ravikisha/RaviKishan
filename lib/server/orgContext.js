// SERVER ONLY — imports async_hooks. Never import this from a module the
// browser loads (orgShape.js is the browser-safe half; this is the other one).
//
// THE CURRENT ORG, FOR ONE REQUEST
// --------------------------------
// Which org a request acts in has to reach the directory, the connected-
// account store, the secret store and every MCP handler — about forty call
// sites, three or four calls deep. Threading an `orgId` parameter through all
// of them would be forty chances to forget one, and the one forgotten would
// quietly act as Relax. So the org rides in an AsyncLocalStorage set ONCE at
// the edge: `withEnv` for every API route, the MCP dispatcher per tool call.
//
// ONE INSTANCE, ON PURPOSE
// ------------------------
// Next dev compiles routes on demand and re-evaluates modules on HMR, while
// the test scripts load lib/server through native ESM. Either can leave two
// copies of this module alive, and then the code that SETS the org and the
// code that READS it hold different AsyncLocalStorage objects — getStore()
// comes back undefined and the request silently acts as Relax. Parking the
// instance on a global symbol makes every copy share it.
//
// NO STORE MEANS RELAX
// --------------------
// A script, a unit test or anything else running outside a request gets the
// default org. That is the only behaviour that keeps every pre-org caller
// working, and `orgSource()` reports "default" so a result can SAY that it
// was not asked to act anywhere else.
import { AsyncLocalStorage } from "async_hooks";
import { DEFAULT_ORG, isOrgId, assertOrgId } from "./orgShape.js";
import { getDocument, listDocuments } from "./firestoreRest.js";

const KEY = Symbol.for("rk.orgContext");
const als = globalThis[KEY] || (globalThis[KEY] = new AsyncLocalStorage());

// Run `fn` inside an org. Always `run`, never `enterWith`: enterWith would
// leak the org into whatever continuation runs next on the same async
// resource — in an MCP batch, the NEXT tool call.
export function runInOrg(orgId, fn, { source = "explicit" } = {}) {
  const id = orgId ? assertOrgId(orgId) : DEFAULT_ORG;
  return als.run({ orgId: id, source: orgId ? source : "default", known: null }, fn);
}

export const currentOrg = () => als.getStore()?.orgId || DEFAULT_ORG;

export const orgSource = () => als.getStore()?.source || "default";

// The header the admin's browser sends on every same-origin /api call. An
// invalid value is treated as absent rather than refused here: this runs
// before authentication, and a garbage header must not turn into an error
// message that reveals anything to an anonymous caller. Refusing an org that
// does not EXIST happens later, lazily, once there is an identity to ask
// Firestore with.
export function orgFromRequest(req) {
  const raw = req?.headers?.["x-org-id"];
  const v = String(Array.isArray(raw) ? raw[0] : raw || "").trim().toLowerCase();
  return isOrgId(v) ? v : "";
}

// Refuse an org that does not exist, once per request.
//
// Without this an unknown org looks EMPTY — no accounts, no defaults — which
// reads as "nothing is connected" and sends the caller off to reconnect
// everything. A typo in an org id should say it is a typo.
//
// Relax never needs a fetch: it exists before its document is written. That
// also keeps every no-network test suite free of an unexpected request.
export async function ensureOrgKnown(idToken) {
  const store = als.getStore();
  const org = store?.orgId || DEFAULT_ORG;
  if (org === DEFAULT_ORG) return org;
  if (store && store.known) return store.known;
  const check = (async () => {
    const doc = await getDocument(idToken, `orgs/${org}`);
    if (doc) return org;
    const rows = await listDocuments(idToken, "orgs", { pageSize: 100 }).catch(() => []);
    const ids = [DEFAULT_ORG, ...rows.map((r) => r.id).filter((id) => id && id !== DEFAULT_ORG)];
    const e = new Error(`There is no org "${org}". Known orgs: ${ids.join(", ")}.`);
    e.code = "org/unknown";
    e.status = 404;
    e.orgId = org;
    throw e;
  })();
  if (store) {
    store.known = check;
    // A FAILED check must not be cached as a pass, and a transient Firestore
    // error should be retried by the next caller rather than poisoning the
    // rest of the request.
    check.catch(() => {
      if (store.known === check) store.known = null;
    });
  }
  return check;
}

export const isOrgError = (e) => !!e && typeof e.code === "string" && e.code.startsWith("org/");
