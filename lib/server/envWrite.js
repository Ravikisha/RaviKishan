// SERVER ONLY. One router for every environment-variable write, used by the
// admin route AND the MCP tools — two copies of "where does this key go and
// who may change it" would drift the way the GitHub audit's two copies did.
//
// No function here returns a value.
import * as reg from "./envRegistry.js";
import * as runtime from "./runtimeConfig.js";
import * as store from "./envStore.js";

const FRESH_SECONDS = 30 * 60;

// A keyring key seals other data or decides where the vault's files go, so
// changing one from the admin needs a sign-in from the last 30 minutes — the
// same bar as revealing a password. `auth_time` does not move on a silent
// token refresh, which is what makes it a real check.
function assertFresh(key, claims) {
  if (!reg.isKeyring(key)) return;
  const t = Number(claims?.auth_time || 0);
  if (!t || Math.floor(Date.now() / 1000) - t > FRESH_SECONDS) {
    throw new reg.EnvError(
      `Sign in again to change ${key}: it needs a sign-in from the last 30 minutes. ${reg.known(key)?.why || ""}`.trim(),
      { status: 401, code: "env/stale-auth" }
    );
  }
}

// `via`: "admin" (with `claims`, for the freshness check) or "mcp".
export async function writeEnv(idToken, key, value, { by = "", via = "admin", claims } = {}) {
  const k = reg.assertManageable(key, { action: "change" });
  if (reg.classify(k) === "runtime") {
    return { ...(await runtime.setValue(idToken, k, value)), cls: "runtime", where: "database (settings)" };
  }
  store.assertWritable(k, { via });
  if (via === "admin") assertFresh(k, claims);
  return {
    ...(await store.setStored(idToken, k, value, { by, via })),
    cls: "stored",
    keyring: reg.isKeyring(k),
    where: "database (sealed)",
  };
}

export async function removeEnv(idToken, key, { via = "admin", claims } = {}) {
  const k = reg.assertManageable(key, { action: "delete" });
  if (reg.classify(k) === "runtime") return { ...(await runtime.removeValue(idToken, k)), cls: "runtime" };
  store.assertWritable(k, { via });
  if (via === "admin") assertFresh(k, claims);
  return { ...(await store.deleteStored(idToken, k, { via })), cls: "stored" };
}

// A pasted .env file. Every line is validated BEFORE anything is written, so a
// bad line cannot leave a half-imported store. ENV_KEY is skipped (it stays in
// the deployment), runtime settings go to their own store, and over MCP the
// keyring keys are skipped and listed rather than failing the whole import.
export async function importEnv(idToken, text, { by = "", via = "admin", claims } = {}) {
  const { entries, skipped } = store.parseDotenv(text);
  const toStore = [];
  const toRuntime = [];
  const refused = [];
  for (const [key, value] of entries) {
    if (!value) {
      refused.push({ key, why: "empty value" });
      continue;
    }
    try {
      const k = reg.assertManageable(key, { action: "change" });
      if (reg.classify(k) === "runtime") {
        toRuntime.push([k, value]);
        continue;
      }
      store.assertWritable(k, { via });
      if (via === "admin") assertFresh(k, claims);
      toStore.push([k, value]);
    } catch (e) {
      refused.push({ key, why: e.message });
    }
  }
  const saved = toStore.length ? await store.setMany(idToken, toStore, { by, via }) : [];
  for (const [k, v] of toRuntime) await runtime.setValue(idToken, k, v);
  return {
    imported: saved.length + toRuntime.length,
    created: saved.filter((s) => s.created).map((s) => s.key),
    updated: saved.filter((s) => !s.created).map((s) => s.key),
    settings: toRuntime.map(([k]) => k),
    refused,
    unparsed: skipped,
    effectiveOn: "next request",
  };
}

// Every catalogued key plus every key that has been stored, each with where
// its value is coming from right now. Values never leave.
export async function envStatus(idToken) {
  await store.hydrateEnv({ force: true });
  const [stored, runtimeVals] = await Promise.all([
    store.listStored().catch(() => []),
    runtime.readAll(idToken).catch(() => ({})),
  ]);
  const storedBy = new Map(stored.map((s) => [s.key, s]));

  const row = (key) => {
    const cls = reg.classify(key);
    if (cls === "runtime") {
      const v = runtime.resolve(key, runtimeVals);
      return {
        ...reg.statusOf(key, v),
        hint: v,
        source: runtimeVals[key] ? "database" : process.env[key] ? "deployment" : "default",
      };
    }
    if (cls === "bootstrap") {
      return { ...reg.statusOf(key, store.isConfigured() ? "set" : ""), hint: "", source: "deployment" };
    }
    const s = storedBy.get(key);
    return {
      ...reg.statusOf(key, s ? "x" : process.env[key]),
      source: s ? "database" : process.env[key] ? "deployment" : "unset",
      ...(s ? { hint: s.hint, updatedAt: s.updatedAt } : {}),
    };
  };

  const keys = reg.REGISTRY.map((e) => e.key);
  for (const s of stored) if (!keys.includes(s.key)) keys.push(s.key);
  const rows = keys.map(row);
  // Still being read from the deployment's own environment: what moving fully
  // into the database is waiting on.
  const notMoved = rows.filter((r) => r.cls === "stored" && r.source === "deployment").map((r) => r.key);

  return {
    rows,
    missingRequired: rows.filter((r) => r.missing).map((r) => r.key),
    notMoved,
    counts: reg.CLASSES.reduce((acc, c) => ({ ...acc, [c]: rows.filter((r) => r.cls === c).length }), {}),
    store: {
      configured: store.isConfigured(),
      error: store.lastError(),
      note: !store.isConfigured()
        ? "ENV_KEY is not set on this deployment. It is the one variable that stays outside the database; add it in Vercel once."
        : store.lastError()
        ? `The store could not be read: ${store.lastError()}`
        : "Every value here is sealed in the database and live on the next request.",
    },
  };
}
