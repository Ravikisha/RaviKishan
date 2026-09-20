// Client side of the document vault.
//
// Bytes go to a private Backblaze bucket; metadata goes to Firestore. The two
// are joined by the object `key`.
//
//   browser ──POST /api/vault/sign (Firebase ID token)──> presigned URL
//           ──PUT/GET bytes directly to Backblaze────────> never via Vercel
//
// Identity-class documents (Aadhaar, PAN) are encrypted in the browser with
// AES-GCM before they are uploaded, under a passphrase that is never sent
// anywhere. Backblaze's own SSE-B2 protects everything at rest, but that key
// belongs to Backblaze — this layer means a misconfigured bucket, a leaked
// storage key or a subpoenaed provider yields ciphertext, not a scan of a
// national ID. The tradeoff is real: lose the passphrase and the file is gone.
// That is acceptable only because mydocs/ on disk stays the master copy.
import { auth } from "./firebase";

export const CATEGORIES = [
  { id: "identity", label: "Identity document", forceEncrypt: true, hint: "Aadhaar, PAN, passport" },
  { id: "income", label: "Income", forceEncrypt: false, hint: "Salary slips, Form 16" },
  { id: "employment", label: "Employment", forceEncrypt: false, hint: "Offer / experience letters" },
  { id: "education", label: "Education", forceEncrypt: false, hint: "Marksheets, degrees" },
  { id: "certificate", label: "Certificate", forceEncrypt: false, hint: "Courses, awards" },
  { id: "other", label: "Other", forceEncrypt: false, hint: "" },
];

export const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[5];
export const mustEncrypt = (id) => categoryOf(id).forceEncrypt;

const PBKDF2_ITERATIONS = 250_000;

/* ---------- small helpers ---------- */

export const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
};

export const fromB64 = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const sanitizeName = (name) =>
  (name || "file")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .slice(-90) || "file";

export const objectKey = (category, filename) =>
  `vault/${category}/${Date.now()}-${sanitizeName(filename)}`;

export const fmtSize = (n) =>
  !n ? "—" : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

// Days until an expiry date; negative means already expired.
export const daysUntil = (iso) => {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.ceil((then - Date.now()) / 86_400_000);
};

/* ---------- crypto ---------- */

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptBytes(bytes, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { cipher: new Uint8Array(cipher), salt: toB64(salt), iv: toB64(iv) };
}

export async function decryptBytes(cipher, passphrase, saltB64, ivB64) {
  const key = await deriveKey(passphrase, fromB64(saltB64));
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(ivB64) },
      key,
      cipher
    );
    return new Uint8Array(plain);
  } catch (_) {
    // AES-GCM authentication failure — wrong passphrase, or tampered bytes.
    const e = new Error("Wrong passphrase, or the file has been altered.");
    e.code = "vault/bad-passphrase";
    throw e;
  }
}

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ---------- transport ---------- */

async function signed(op, key) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const token = await user.getIdToken();
  const res = await fetch("/api/vault/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op, key }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Signing failed (HTTP ${res.status}).`);
  return json.url;
}

// Uploads a File. Returns the metadata to write to Firestore.
// `passphrase` is required when the category forces encryption.
export async function putObject(file, { category, passphrase } = {}) {
  const encrypt = mustEncrypt(category);
  if (encrypt && !passphrase) {
    const e = new Error("This category is encrypted — a passphrase is required.");
    e.code = "vault/passphrase-required";
    throw e;
  }

  const raw = new Uint8Array(await file.arrayBuffer());
  const digest = await sha256Hex(raw);

  let payload = raw;
  let salt = null;
  let iv = null;
  if (encrypt) {
    const out = await encryptBytes(raw, passphrase);
    payload = out.cipher;
    salt = out.salt;
    iv = out.iv;
  }

  const key = objectKey(category, file.name);
  const url = await signed("put", key);
  const res = await fetch(url, {
    method: "PUT",
    body: payload,
    // Encrypted blobs are opaque bytes; plaintext keeps its real type so the
    // browser can preview it on download.
    headers: { "Content-Type": encrypt ? "application/octet-stream" : file.type || "application/octet-stream" },
  });
  if (!res.ok)
    throw new Error(`Upload rejected by storage (HTTP ${res.status}).`);

  return {
    key,
    filename: sanitizeName(file.name),
    contentType: file.type || "application/octet-stream",
    size: raw.length,
    storedSize: payload.length,
    encrypted: encrypt,
    salt,
    iv,
    sha256: digest,
    category,
  };
}

// Fetches an object and returns a blob: URL, decrypting first when needed.
// The caller owns the URL and must revoke it.
export async function getObjectUrl(meta, passphrase) {
  const url = await signed("get", meta.key);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
  let bytes = new Uint8Array(await res.arrayBuffer());

  if (meta.encrypted) {
    if (!passphrase) {
      const e = new Error("This document is encrypted — enter the passphrase.");
      e.code = "vault/passphrase-required";
      throw e;
    }
    bytes = await decryptBytes(bytes, passphrase, meta.salt, meta.iv);
    const digest = await sha256Hex(bytes);
    if (meta.sha256 && digest !== meta.sha256) {
      const e = new Error("Decrypted file does not match its recorded checksum.");
      e.code = "vault/checksum-mismatch";
      throw e;
    }
  }

  return URL.createObjectURL(
    new Blob([bytes], { type: meta.contentType || "application/octet-stream" })
  );
}

export async function deleteObject(key) {
  const url = await signed("delete", key);
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404)
    throw new Error(`Delete failed (HTTP ${res.status}).`);
}
