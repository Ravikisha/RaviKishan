// SERVER ONLY. The settings that can change WITHOUT a deployment.
//
// A Vercel environment variable is baked at build time, so flipping one means
// a redeploy. That is correct for a client secret and useless for a setting
// you want to change and see. These live in Firestore instead, in one
// document, and are read at request time.
//
// THE RULE: nothing secret goes in here. These values are stored in plaintext,
// because a value the app must read on every request cannot be behind a
// passphrase, and because the whole point is that they are boring. Secrets go
// to the secret store (sealed, scoped, audited) or stay in the platform
// environment. `assertManageable` refuses anything critical, and the registry
// is what decides which is which.
//
// Reading falls back to process.env and then to the registry default, so
// nothing breaks before a value has ever been set — and a deployment that
// never writes one behaves exactly as it did before this file existed.
import { getDocument, patchDocument } from "./firestoreRest.js";
import { EnvError, assertManageable, classify, known } from "./envRegistry.js";

export const DOC_PATH = "config/runtime";

export function assertRuntime(key) {
  const k = assertManageable(key, { action: "change" });
  if (classify(k) !== "runtime") {
    throw new EnvError(
      `${k} is a deployment variable, not a runtime setting. It belongs in the platform environment — setting it here would have no effect, because nothing reads it from the database.`,
      { status: 400, code: "env/not-runtime" }
    );
  }
  return k;
}

export async function readAll(idToken) {
  const doc = await getDocument(idToken, DOC_PATH).catch(() => null);
  return doc?.values && typeof doc.values === "object" ? doc.values : {};
}

// What the app should use for a runtime setting: the stored value, then the
// environment, then the registry's documented default.
export function resolve(key, stored = {}) {
  const k = String(key);
  if (stored[k] !== undefined && stored[k] !== "") return stored[k];
  if (process.env[k] !== undefined && process.env[k] !== "") return process.env[k];
  return known(k)?.default ?? "";
}

export async function setValue(idToken, key, value) {
  const k = assertRuntime(key);
  if (typeof value !== "string") throw new EnvError(`${k} needs a string value.`);
  // Firestore cannot patch a single map entry, so the map is read, changed and
  // written back whole. Reading first also means an unknown key cannot wipe
  // the others by being written alone.
  const values = await readAll(idToken);
  values[k] = value;
  await patchDocument(idToken, DOC_PATH, { values, updatedAt: new Date().toISOString() });
  return { key: k, saved: true, effectiveOn: "immediately" };
}

export async function removeValue(idToken, key) {
  const k = assertRuntime(key);
  const values = await readAll(idToken);
  if (!(k in values)) {
    throw new EnvError(`${k} has no stored value — it is already falling back to the default.`, {
      status: 404,
    });
  }
  delete values[k];
  await patchDocument(idToken, DOC_PATH, { values, updatedAt: new Date().toISOString() });
  return {
    key: k,
    deleted: true,
    effectiveOn: "immediately",
    note: "It now falls back to the environment, then to its default.",
  };
}
