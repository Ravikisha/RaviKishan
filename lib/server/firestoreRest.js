// SERVER ONLY. A small Firestore REST client that acts AS THE SIGNED-IN USER.
//
// The MCP server holds a refresh token (decrypted out of the caller's access
// token), swaps it for a short-lived ID token, and sends that as the bearer.
// Every read and write therefore goes through firestore.rules exactly as if it
// came from the admin's browser — no service account, no rule bypass.
import crypto from "crypto";

const PROJECT_ID = "myportifilio-3ab5f";
// Public Firebase web API key — the same one shipped in lib/firebase.js. It is
// an identifier, not a secret.
const API_KEY = "AIzaSyDuDWdIMLs5CCRbPqMvwfxpbobsR4SO3w0";

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Refresh tokens are long-lived but the ID tokens they mint last an hour.
// A warm lambda reuses one rather than exchanging on every tool call.
const cache = new Map(); // sha256(refreshToken) -> { idToken, exp }

export async function idTokenFor(refreshToken) {
  const k = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const hit = cache.get(k);
  if (hit && hit.exp > Date.now() + 60_000) return hit.idToken;

  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(
      json?.error?.message === "TOKEN_EXPIRED" || json?.error?.message === "INVALID_REFRESH_TOKEN"
        ? "This MCP token's session has been revoked. Mint a new token in the admin."
        : `Could not refresh the session (${json?.error?.message || res.status}).`
    );
    e.code = "mcp/session-revoked";
    throw e;
  }
  const idToken = json.id_token;
  cache.set(k, { idToken, exp: Date.now() + (Number(json.expires_in || 3600) - 120) * 1000 });
  return idToken;
}

/* ---------- value encoding ---------- */

export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number")
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

export function fromValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
  return null;
}

export const fromFields = (fields) =>
  Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, fromValue(v)]));

export const toFields = (obj) =>
  Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, toValue(v)]));

const idOf = (name) => String(name || "").split("/").pop();

/* ---------- operations ---------- */

async function call(idToken, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    const e = new Error(
      res.status === 403 || /PERMISSION_DENIED/.test(msg)
        ? `Firestore denied this (${msg}). Check that firestore.rules is published.`
        : msg
    );
    e.code = res.status === 404 ? "not-found" : "firestore-error";
    throw e;
  }
  return json;
}

export async function getDocument(idToken, path) {
  try {
    const d = await call(idToken, `${BASE}/${path}`);
    return { id: idOf(d.name), ...fromFields(d.fields) };
  } catch (e) {
    if (e.code === "not-found") return null;
    throw e;
  }
}

export async function listDocuments(idToken, collection, { pageSize = 100 } = {}) {
  const d = await call(
    idToken,
    `${BASE}/${collection}?pageSize=${Math.min(300, pageSize)}`
  );
  return (d.documents || []).map((doc) => ({ id: idOf(doc.name), ...fromFields(doc.fields) }));
}

// Merge-patch: only the named fields are written, everything else is left
// alone — the REST equivalent of setDoc(..., { merge: true }).
export async function patchDocument(idToken, path, data) {
  const mask = Object.keys(data)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");
  const d = await call(idToken, `${BASE}/${path}?${mask}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: toFields(data) }),
  });
  return { id: idOf(d.name), ...fromFields(d.fields) };
}

export async function createDocument(idToken, collection, docId, data) {
  const q = docId ? `?documentId=${encodeURIComponent(docId)}` : "";
  const d = await call(idToken, `${BASE}/${collection}${q}`, {
    method: "POST",
    body: JSON.stringify({ fields: toFields(data) }),
  });
  return { id: idOf(d.name), ...fromFields(d.fields) };
}

export async function deleteDocument(idToken, path) {
  await call(idToken, `${BASE}/${path}`, { method: "DELETE" });
  return true;
}

// The revocation list is world-READABLE on purpose: it holds nothing but
// opaque token ids, and reading it must work before any credential has been
// established. Only the admin can write it.
export async function isRevoked(jti) {
  try {
    const res = await fetch(`${BASE}/site/mcpRevocations`);
    if (!res.ok) return false;
    const d = await res.json();
    const list = fromFields(d.fields || {}).revoked || [];
    return list.includes(jti);
  } catch (_) {
    // Fail OPEN on a network blip rather than locking every client out; the
    // encrypted-token check has already passed by this point.
    return false;
  }
}
