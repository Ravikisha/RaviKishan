// Backend-agnostic résumé PDF store.
//
// Two backends, tried in order:
//
//   "storage"    Cloud Storage object under resumes/. Preferred: no size
//                ceiling worth worrying about, served from a CDN. Requires the
//                Blaze plan — since 3 Feb 2026 Cloud Storage for Firebase
//                refuses Spark projects outright.
//
//   "firestore"  The PDF itself, base64-encoded, in its own `resumeFiles/{id}`
//                document. Works on the no-cost Spark plan with nothing to set
//                up. Capped by Firestore's 1 MiB document limit, so the raw PDF
//                must stay under ~700 KB (base64 inflates by ~33%).
//
// The upload path tries Storage and silently falls back to Firestore when the
// project is not on Blaze, so this keeps working today and gets faster for free
// the day the plan is upgraded — no code change, no re-upload.
//
// It lives in its own module (not in the admin page) because the PUBLIC side
// needs the read half too: useResumeUrl() turns a firestore-backed entry into a
// blob: URL. That blob is same-origin, which as a bonus makes the <a download>
// attribute work again — it is ignored for cross-origin URLs like a Storage
// download link.
import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { db, storage } from "./firebase";

// Variants let one résumé store hold several cuts of the same CV — an AI one,
// a backend one, a systems one — each reachable at /resume?v=<id>. "default"
// is what /resume shows with no query and what content.resume points at.
export const DEFAULT_VARIANT = "default";

export const VARIANT_LABELS = {
  default: "Default",
  ai: "AI / ML",
  backend: "Backend",
  systems: "Systems",
  frontend: "Frontend",
};

export const variantLabel = (v) =>
  VARIANT_LABELS[v] || (v ? v.charAt(0).toUpperCase() + v.slice(1) : "Default");

export const normalizeVariant = (v) => {
  const s = String(v || DEFAULT_VARIANT).toLowerCase().trim();
  return /^[a-z0-9][a-z0-9-]{0,23}$/.test(s) ? s : DEFAULT_VARIANT;
};

// Which résumé a given variant should serve. Falls back to the default entry
// so an unknown or unpublished variant never 404s the download button.
export function pickResume(content, variant) {
  const v = normalizeVariant(variant);
  if (v !== DEFAULT_VARIANT) {
    const byVariant = content?.resumeByVariant?.[v];
    if (byVariant) return { entry: byVariant, variant: v, exact: true };
  }
  return { entry: content?.resume, variant: DEFAULT_VARIANT, exact: v === DEFAULT_VARIANT };
}

export const FALLBACK_URL = "/Ravi_Kishan_Resume.pdf";
export const FALLBACK_NAME = "Ravi_Kishan_Resume.pdf";

// Storage tolerates far more; this is the guard for the Firestore backend.
export const MAX_STORAGE_BYTES = 15 * 1024 * 1024;
export const MAX_FIRESTORE_BYTES = 700 * 1024;

// Firebase error codes that mean "this project has no usable bucket" rather
// than "this particular upload was bad". Only these trigger the fallback; a
// genuine permission or validation failure must still surface.
const NO_BUCKET = new Set([
  "storage/unauthorized",
  "storage/unknown",
  "storage/project-not-found",
  "storage/bucket-not-found",
  "storage/quota-exceeded",
  "storage/retry-limit-exceeded",
  "storage/unauthenticated",
]);

export const isPdf = (file) =>
  !!file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));

export const safeName = (name) =>
  (name || "resume.pdf")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .slice(-90) || "resume.pdf";

export const monthYear = (d) =>
  d.toLocaleString("en-US", { month: "long", year: "numeric" });

/* ---------- base64 <-> binary (chunked; a 700 KB spread blows the stack) ---------- */

function bytesToBase64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBlob(b64, type = "application/pdf") {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/* ---------- upload ---------- */

async function uploadToStorage(file, path, onProgress) {
  const task = uploadBytesResumable(storageRef(storage, path), file, {
    contentType: "application/pdf",
    cacheControl: "public, max-age=3600",
  });
  await new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) =>
        onProgress(
          snap.totalBytes
            ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100)
            : 0
        ),
      reject,
      resolve
    );
  });
  return getDownloadURL(task.snapshot.ref);
}

async function uploadToFirestore(file, id, onProgress) {
  if (file.size > MAX_FIRESTORE_BYTES) {
    const e = new Error(
      `This PDF is ${Math.round(file.size / 1024)} KB. Without Cloud Storage the ` +
        `limit is ${Math.round(MAX_FIRESTORE_BYTES / 1024)} KB (Firestore caps a ` +
        `document at 1 MiB). Compress the PDF, or upgrade the Firebase project ` +
        `to the Blaze plan to use Cloud Storage.`
    );
    e.code = "resume/too-large-for-firestore";
    throw e;
  }
  onProgress(15);
  const bytes = new Uint8Array(await file.arrayBuffer());
  onProgress(55);
  const data = bytesToBase64(bytes);
  onProgress(80);
  await setDoc(doc(db, "resumeFiles", id), {
    filename: safeName(file.name),
    contentType: "application/pdf",
    size: file.size,
    uploadedAt: new Date().toISOString(),
    data,
  });
  onProgress(100);
  return id;
}

// Uploads `file` and returns the entry to store in content.resume /
// content.resumeVersions. `onProgress(pct)` and `onNotice(msg)` are optional.
export async function uploadResume(
  file,
  { onProgress = () => {}, onNotice = () => {}, variant = DEFAULT_VARIANT } = {}
) {
  if (!isPdf(file)) {
    const e = new Error("That isn't a PDF. Only .pdf résumés can be uploaded.");
    e.code = "resume/not-pdf";
    throw e;
  }
  if (file.size > MAX_STORAGE_BYTES) {
    const e = new Error(
      `Too large (${Math.round(file.size / 1048576)} MB). The limit is 15 MB.`
    );
    e.code = "resume/too-large";
    throw e;
  }

  const filename = safeName(file.name);
  const id = `${Date.now()}-${filename}`.replace(/\//g, "_");
  const now = new Date();
  const base = {
    filename,
    size: file.size,
    uploadedAt: now.toISOString(),
    updated: monthYear(now),
    variant: normalizeVariant(variant),
  };

  try {
    const url = await uploadToStorage(file, `resumes/${id}`, onProgress);
    return { ...base, kind: "storage", url, path: `resumes/${id}` };
  } catch (e) {
    if (!NO_BUCKET.has(e?.code)) throw e;
    onNotice(
      "Cloud Storage isn't available on this Firebase plan — storing the PDF in Firestore instead."
    );
    onProgress(0);
  }

  const docId = await uploadToFirestore(file, id, onProgress);
  return { ...base, kind: "firestore", docId };
}

/* ---------- delete ---------- */

export async function deleteResume(entry) {
  if (!entry) return;
  if (entry.kind === "firestore" && entry.docId) {
    await deleteDoc(doc(db, "resumeFiles", entry.docId));
    return;
  }
  if (entry.path) {
    try {
      await deleteObject(storageRef(storage, entry.path));
    } catch (e) {
      // already gone is success as far as the caller is concerned
      if (e?.code !== "storage/object-not-found") throw e;
    }
  }
}

/* ---------- read (public side) ---------- */

// Resolves a résumé entry to something an <a href> can use.
//   storage / legacy  → the stored url, as-is
//   firestore         → a blob: URL built from the base64 document
// Returns the bundled public/ PDF until (and unless) the real one resolves, so
// SSR and the first client render always agree.
export function useResumeUrl(resume) {
  const direct = resume?.url || FALLBACK_URL;
  const needsFetch = resume?.kind === "firestore" && !!resume?.docId;
  const [url, setUrl] = useState(needsFetch ? FALLBACK_URL : direct);

  useEffect(() => {
    if (!needsFetch) {
      setUrl(direct);
      return undefined;
    }
    let objectUrl;
    let cancelled = false;
    getDoc(doc(db, "resumeFiles", resume.docId))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        const d = snap.data();
        if (!d?.data) return;
        objectUrl = URL.createObjectURL(base64ToBlob(d.data, d.contentType));
        setUrl(objectUrl);
      })
      .catch(() => {
        /* offline / rules / missing → keep the bundled fallback */
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [needsFetch, resume?.docId, direct]);

  return url;
}
