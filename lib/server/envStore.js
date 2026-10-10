// SERVER ONLY. Every environment variable, kept in the database.
//
// THE MODEL (the owner's choice, Oct 2026)
// The deployment holds exactly ONE variable: ENV_KEY. Everything else — OAuth
// client ids and secrets, API keys, SECRETS_KEY, INTEGRATION_SECRET,
// MCP_TOKEN_SECRET, the B2 keys, NEXT_PUBLIC_ values — lives in Firestore
// `envStore/current` as ONE blob sealed under ENV_KEY (AES-256-GCM). Every API
// route is wrapped in `withEnv`, which opens the blob and lays the values over
// process.env before the handler runs. The code that reads process.env keeps
// working, and a value changed in the admin or over MCP is live on the next
// request. No Vercel, no redeploy.
//
// WHY ONE KEY STAYS OUTSIDE
// Encrypted values need a key the database does not hold; a store holding its
// own key is plaintext with extra steps. ENV_KEY is that key, set once.
//
// WHY THE DOCUMENT IS READABLE WITHOUT SIGNING IN — AND WHAT THAT COSTS
// Several routes run with nobody signed in and still need secrets: the OAuth
// callback (the provider navigates to it), MCP authentication (it must open
// the token before it knows who is calling), the public Instagram gallery and
// the RSS feed. So `get` on this ONE document is public and the CONTENT is the
// protection: a single AES-256-GCM blob with even the key names inside it.
// Without ENV_KEY a reader has random bytes. The trade, stated plainly: ENV_KEY
// now protects every credential at once, so it must be treated as the most
// sensitive value the project has. Writes are admin-only; `list` is refused.
//
// Nothing here hands a value to a caller except `publicValues`, which returns
// NEXT_PUBLIC_ keys only — meant, by their own name, for every visitor.
import crypto from "crypto";
import { patchDocument } from "./firestoreRest.js";
import { EnvError, assertKey, known, isPublic, isKeyring } from "./envRegistry.js";
import { runInOrg, orgFromRequest } from "./orgContext.js";

const PROJECT = "myportifilio-3ab5f";
// The public web key, the same one compiled into every page.
const WEB_KEY = "AIzaSyDuDWdIMLs5CCRbPqMvwfxpbobsR4SO3w0";
export const DOC_PATH = "envStore/current";
const DOC_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${DOC_PATH}`;
export const CACHE_MS = 30_000;
const PURPOSE = "env-store-v1";

// Captured at import, before any overlay, so nothing stored can ever swap the
// key out from under the store.
const BOOT_KEY = process.env.ENV_KEY || "";

export const isConfigured = () => !!(BOOT_KEY || process.env.ENV_KEY);

function envKey() {
  const raw = BOOT_KEY || process.env.ENV_KEY;
  if (!raw) {
    throw new EnvError(
      "ENV_KEY is not set on this deployment. It is the one variable that cannot live in the database (it is the key that opens it): add it once in Vercel and in .env.local.",
      { status: 503, code: "env/no-key" }
    );
  }
  const buf = Buffer.from(raw, "base64url");
  return buf.length === 32 ? buf : crypto.createHash("sha256").update(raw).digest();
}

export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", envKey(), iv);
  c.setAAD(Buffer.from(PURPOSE));
  const body = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

export function open(blob) {
  const buf = Buffer.from(String(blob || ""), "base64url");
  if (buf.length < 29) throw new EnvError("The env store is empty or damaged.", { code: "env/unreadable" });
  const d = crypto.createDecipheriv("aes-256-gcm", envKey(), buf.subarray(0, 12));
  d.setAAD(Buffer.from(PURPOSE));
  d.setAuthTag(buf.subarray(12, 28));
  try {
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
  } catch (_) {
    throw new EnvError(
      "The env store could not be opened with this ENV_KEY. If ENV_KEY was changed, every stored value is sealed under the old one: put the old key back.",
      { code: "env/wrong-key" }
    );
  }
}

/* ---------------- who may write what ---------------- */

// `via` is "admin" (the Environment tab, signed in) or "mcp". Keyring keys —
// the ones that seal other data, and the vault's location — are admin-only:
// an MCP token able to set MCP_TOKEN_SECRET could mint itself any scope, and
// one able to move B2_ENDPOINT could send the vault to another server.
export function assertWritable(key, { via = "admin" } = {}) {
  const k = assertKey(key);
  if (k === "ENV_KEY" || known(k)?.cls === "bootstrap") {
    throw new EnvError(
      "ENV_KEY opens the store, so it cannot be inside it. It is the one variable set in Vercel and .env.local.",
      { status: 403, code: "env/bootstrap" }
    );
  }
  if (via === "mcp" && isKeyring(k)) {
    throw new EnvError(`${k} can only be changed in the admin's Environment tab, not over MCP. ${known(k).why}`, {
      status: 403,
      code: "env/keyring",
    });
  }
  return k;
}

/* ---------------- the blob ---------------- */

// Read with NO credentials: the rules allow a public `get` of this document.
async function readBlob() {
  const res = await fetch(`${DOC_URL}?key=${WEB_KEY}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new EnvError(`The env store could not be read (HTTP ${res.status}).`);
  const j = await res.json();
  return j?.fields?.blob?.stringValue || null;
}

// { KEY: { v, hint, updatedAt, by } }
async function readMap() {
  const blob = await readBlob();
  return blob ? open(blob) : {};
}

export const hintFor = (key, v) => {
  const s = String(v || "");
  if (isPublic(key)) return s;
  return s.length <= 4 ? "••••" : `••••${s.slice(-4)}`;
};

// Metadata only: key, masked hint, when, by whom.
export async function listStored() {
  const map = await readMap();
  return Object.entries(map)
    .map(([key, e]) => ({ key, hint: e.hint || "", updatedAt: e.updatedAt || "", by: e.by || "" }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

async function writeMap(idToken, map) {
  // patchDocument goes through the rules as the signed-in admin.
  await patchDocument(idToken, DOC_PATH, { blob: seal(map), updatedAt: new Date().toISOString() });
  cache.at = 0;
}

export async function setMany(idToken, entries, { by = "", via = "admin" } = {}) {
  const clean = [];
  for (const [key, value] of entries) {
    const k = assertWritable(key, { via });
    const v = typeof value === "string" ? value.trim() : "";
    if (!v) throw new EnvError(`${k} needs a value. To remove it, delete it instead.`);
    clean.push([k, v]);
  }
  if (!clean.length) throw new EnvError("Nothing to save.");
  // Read-modify-write the whole blob: reading first means a write can never
  // drop the keys it did not mention.
  const map = await readMap();
  const at = new Date().toISOString();
  const out = [];
  for (const [k, v] of clean) {
    out.push({ key: k, created: !map[k], hint: hintFor(k, v) });
    map[k] = { v, hint: hintFor(k, v), updatedAt: at, by };
  }
  await writeMap(idToken, map);
  for (const [k, v] of clean) applyOne(k, v);
  return out;
}

export async function setStored(idToken, key, value, opts = {}) {
  const [r] = await setMany(idToken, [[key, value]], opts);
  return { ...r, saved: true, effectiveOn: "next request" };
}

export async function deleteStored(idToken, key, { via = "admin" } = {}) {
  const k = assertWritable(key, { via });
  const map = await readMap();
  if (!map[k]) return { key: k, deleted: false, note: `${k} is not in the store.` };
  delete map[k];
  await writeMap(idToken, map);
  restoreOne(k);
  return { key: k, deleted: true, fallsBackTo: process.env[k] ? "the deployment's own value" : "unset" };
}

// `KEY=value` lines, as in a .env file. Comments, blank lines, `export ` and
// surrounding quotes are handled; anything else is reported, not guessed at.
export function parseDotenv(text) {
  const entries = [];
  const skipped = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) {
      skipped.push(line.slice(0, 40));
      continue;
    }
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    entries.push([m[1].toUpperCase(), v]);
  }
  return { entries, skipped };
}

/* ---------------- the overlay ---------------- */

const original = new Map();
const cache = { at: 0, keys: [], error: "" };

function applyOne(k, v) {
  if (k === "ENV_KEY") return false;
  if (!original.has(k)) original.set(k, process.env[k]);
  process.env[k] = v;
  return true;
}

function restoreOne(k) {
  if (!original.has(k)) return;
  const o = original.get(k);
  if (o === undefined) delete process.env[k];
  else process.env[k] = o;
  original.delete(k);
}

// Lay `values` over process.env; a key applied before but gone now gets the
// deployment's own value back.
export function applyOverlay(values) {
  for (const k of [...original.keys()]) if (!(k in values)) restoreOne(k);
  let n = 0;
  for (const [k, v] of Object.entries(values || {})) if (typeof v === "string" && v && applyOne(k, v)) n++;
  return n;
}

// Opens the store and lays it over process.env. Cached per server instance;
// never throws — if the store is unreachable the deployment's own values
// stand, and the Environment tab says why.
export async function hydrateEnv({ force = false } = {}) {
  if (!isConfigured()) {
    cache.error = "ENV_KEY is not set";
    return { applied: 0, error: cache.error };
  }
  if (!force && cache.at && Date.now() - cache.at < CACHE_MS) return { applied: cache.keys.length, cached: true };
  try {
    const map = await readMap();
    const values = Object.fromEntries(Object.entries(map).map(([k, e]) => [k, e.v]));
    const applied = applyOverlay(values);
    cache.at = Date.now();
    cache.keys = Object.keys(values);
    cache.error = "";
    return { applied };
  } catch (e) {
    cache.error = e.message;
    return { applied: 0, error: e.message };
  }
}

export const lastError = () => cache.error || "";

export const sourceOf = (k) => (original.has(k) ? "database" : process.env[k] ? "deployment" : "unset");

// Wrap a Next.js API route so the store is laid over process.env first —
// and so the handler runs INSIDE the org the caller is acting in.
//
// Every API route already passes through here, which is why the org is set
// here too: one place, so a new route cannot arrive without it. The org comes
// from the x-org-id header the admin's browser sends; with none (or a
// malformed one) the request acts in the default org, and orgSource() says
// "default" so a result can report that it was not asked to act elsewhere.
//
// Only the org id lives in the request scope. The env overlay above is
// process-wide and shared by concurrent requests, so nothing per-org may ever
// be written into process.env.
export function withEnv(handler) {
  return async function envHandler(req, res) {
    await hydrateEnv();
    const org = orgFromRequest(req);
    return runInOrg(org || "", () => handler(req, res), { source: org ? "header" : "default" });
  };
}

// NEXT_PUBLIC_ values only — public by their own name — for the browser,
// which cannot read process.env at run time.
export function publicValues() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) if (isPublic(k) && v) out[k] = v;
  return out;
}

// For tests.
export function _reset() {
  for (const k of [...original.keys()]) restoreOne(k);
  cache.at = 0;
  cache.keys = [];
  cache.error = "";
}
