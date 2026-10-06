// BROWSER. YouTube, Instagram and X for the admin panel.
//
// None of the three send CORS headers, so unlike Google Tasks and Microsoft
// Graph nothing here talks to the provider directly — every call goes through
// our own admin-gated /api/social, which already holds the credential.
//
// The weighted character count for X is imported from the server module rather
// than reimplemented: a counter that disagrees with the validator is worse
// than no counter, because it tells you the post will fit and then it does not.
import { auth, db } from "./firebase";
import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";

export { MAX_POST_CHARS as X_MAX, weightedLength, charsLeft } from "./server/xapi";
export { MAX_CAPTION as IG_MAX } from "./server/instagram";

export const PROVIDERS = [
  { id: "youtube", label: "YouTube", noun: "channel" },
  { id: "instagram", label: "Instagram", noun: "account" },
  { id: "x", label: "X", noun: "handle" },
];

export const providerLabel = (id) => PROVIDERS.find((p) => p.id === id)?.label || id;

async function idToken() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  return user.getIdToken();
}

async function call(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error || `HTTP ${res.status}`);
    e.code = json.code || "";
    e.provider = json.provider || "";
    throw e;
  }
  return json;
}

const social = (body) => call("/api/social", body);

/* ---------------- accounts ---------------- */

export const listAccounts = () => social({ action: "accounts" }).then((j) => j.providers);
export const capabilities = () => social({ action: "capabilities" });

export async function beginConnect(provider) {
  const { url } = await call(`/api/integrations/${provider}/start`);
  window.location.assign(url);
}

// Collect the sealed connection the callback left in a cookie and store it.
// The server tells us WHERE — a multi-account provider lands one document per
// account in connectedAccounts, keyed so reconnecting the same channel updates
// that row rather than adding a second one beside it.
export async function finishConnect(provider) {
  const { record, collection: col, docId } = await call(`/api/integrations/${provider}/claim`);
  await setDoc(doc(db, col, docId), record, { merge: true });
  return record;
}

export async function disconnect(provider, accountId) {
  await deleteDoc(doc(db, "connectedAccounts", `${provider}__${encodeURIComponent(accountId)}`));
}

// Read straight from Firestore — the rules already make it admin-only, and the
// sealed secret is never part of what the panel renders.
export async function readAccounts() {
  const snap = await getDocs(collection(db, "connectedAccounts"));
  return snap.docs.map((d) => {
    const { secret, ...rest } = d.data();
    return { id: d.id, ...rest };
  });
}

/* ---------------- YouTube ---------------- */

export const ytChannel = (accountId) => social({ action: "channel", provider: "youtube", accountId });
export const ytVideos = (accountId, max) =>
  social({ action: "videos", provider: "youtube", accountId, max });
export const ytUpdateVideo = (accountId, videoId, patch) =>
  social({ action: "updateVideo", provider: "youtube", accountId, videoId, ...patch });
export const ytPlaylists = (accountId) =>
  social({ action: "playlists", provider: "youtube", accountId });
export const ytComments = (accountId, videoId) =>
  social({ action: "comments", provider: "youtube", accountId, videoId });

/* ---------------- Instagram ---------------- */

export const igAccount = (accountId) => social({ action: "account", provider: "instagram", accountId });
export const igMedia = (accountId, max) => social({ action: "media", provider: "instagram", accountId, max });
export const igPublish = (accountId, body) =>
  social({ action: "publish", provider: "instagram", accountId, ...body });
export const igComments = (accountId, mediaId) =>
  social({ action: "comments", provider: "instagram", accountId, mediaId });

/* ---------------- X ---------------- */

export const xAccount = (accountId) => social({ action: "account", provider: "x", accountId });
export const xPosts = (accountId, max) => social({ action: "posts", provider: "x", accountId, max });
export const xPublish = (accountId, text) => social({ action: "publish", provider: "x", accountId, text });
export const xThread = (accountId, texts) => social({ action: "thread", provider: "x", accountId, texts });
export const xDelete = (accountId, postId) =>
  social({ action: "delete", provider: "x", accountId, postId });
