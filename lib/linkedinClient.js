// BROWSER. LinkedIn, for the admin panel.
//
// Unlike Google Tasks and Microsoft To Do, these calls do NOT go straight from
// the browser to the provider: api.linkedin.com sends no CORS headers, so a
// fetch from this origin is blocked before it leaves. Everything therefore
// goes through our own admin-gated route, which holds the credential anyway.
//
// What this client can do is bounded by what LinkedIn allows — posting, and a
// name-and-email profile read. There is no profile write and no job search at
// any self-serve tier. See lib/server/linkedin.js for the full list.
import { auth, db } from "./firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";

// The cap and the counter come from the SAME module the server validates
// with, so the composer can never say "47 left" about a post the server will
// refuse.
export { MAX_POST_CHARS, charsLeft } from "./server/linkedinText";

async function post(action, payload) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const res = await fetch("/api/linkedin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error || `HTTP ${res.status}`);
    e.code = json.code || "";
    throw e;
  }
  return json;
}

// Collect the sealed connection the OAuth callback left behind and STORE it.
//
// This is the step that was missing, and its absence was invisible: the
// callback exchanges the code, seals the credential into a short-lived
// httpOnly cookie and redirects back with ?connected=linkedin. The panel
// showed "LinkedIn connected." on seeing that parameter and never claimed the
// cookie — so nothing was ever written, the cookie expired five minutes
// later, and the next status read still said "not connected" under a success
// message that had already been shown.
//
// The server decides WHERE it goes (integrations/linkedin); the browser
// writes it, because the API routes have no Firestore credential of their own.
export async function finishConnect() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  // The claim endpoint lives under the shared integrations routes, not the
  // LinkedIn action route that post() talks to.
  const res = await fetch("/api/integrations/linkedin/claim", {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Could not save the connection (HTTP ${res.status}).`);
  await setDoc(doc(db, json.collection, json.docId), json.record, { merge: true });
  return json.record;
}

// EVERY call that touches LinkedIn now names the account, because several can
// be connected and posting as the wrong one cannot be quietly undone. Omitted,
// the server still resolves it — saved default, then the only one connected,
// then a refusal that lists the candidates — so a caller that genuinely does
// not care is not forced to choose.
export const getProfile = (accountId) => post("profile", { accountId });
export const getCapabilities = () => post("capabilities", {});
export const publish = (body) => post("publish", body);
export const removePost = (urn, accountId) => post("delete", { urn, accountId });
export const editPostText = (urn, text, accountId) => post("edit", { urn, text, accountId });
export const jobSearchUrl = (filters) => post("jobSearchUrl", filters);

// The profile LinkedIn's API refuses to return, from the committed snapshot of
// the data export. Needs no connection — which is the point, because the
// headline is readable this way and no other.
export const getExportProfile = () => post("exportProfile", {});

// Which LinkedIn accounts are connected. Through /api/accounts rather than a
// LinkedIn call of its own: the directory already merges the per-account store
// with the legacy single connection, and a second idea of "what is connected"
// is a second thing to drift.
export async function listLinkedInAccounts() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const res = await fetch("/api/accounts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify({ action: "list" }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return (json.accounts || []).filter((a) => a.provider === "linkedin");
}

// What LinkedIn was worth, measured on OUR side: the traffic it sent to the
// site, out of the Google Analytics account already connected here.
export const getReach = (range, propertyId) => post("reach", { range, propertyId });

// The history is ours, so it is read straight from Firestore rather than
// through the API route — the rules already make it admin-only.
// Filtered in JS rather than with a Firestore `where`: a composite index on
// (accountId, postedAt) would have to be deployed before the history worked at
// all, and this collection holds tens of rows, not thousands. Posts written
// before accounts were a concept carry no accountId, so they are shown under
// whichever account is selected rather than disappearing — losing a published
// post from the only record of it is worse than attributing it loosely, and
// the row says so.
export async function listPosts(max = 50, accountId = "") {
  const snap = await getDocs(
    query(collection(db, "linkedinPosts"), orderBy("postedAt", "desc"), fsLimit(max))
  );
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!accountId) return rows;
  return rows.filter((r) => !r.accountId || r.accountId === accountId);
}

// A deleted post stays in the record, marked. Removing the row would make the
// history quietly disagree with what was actually published.
export const markDeleted = (id) =>
  updateDoc(doc(db, "linkedinPosts", id), { deletedAt: new Date().toISOString() });

export const forgetPost = (id) => deleteDoc(doc(db, "linkedinPosts", id));

// The history is the only record LinkedIn will ever give back, so a post made
// from the panel is written to it exactly as the MCP tool writes one. It used
// not to be: "Published from here" silently listed MCP posts only.
export const recordPost = ({ urn, url, text, linkUrl, visibility, accountId, accountLabel }) =>
  addDoc(collection(db, "linkedinPosts"), {
    urn: urn || "",
    url: url || "",
    text,
    linkUrl: linkUrl || "",
    visibility: visibility || "PUBLIC",
    postedAt: new Date().toISOString(),
    source: "admin",
    // WHICH account published it. Without this the history is a single list
    // that cannot answer "what did this handle post", which is the first
    // question anyone holding two accounts asks.
    accountId: accountId || "",
    accountLabel: accountLabel || "",
  });

export const markEdited = (id, text) =>
  updateDoc(doc(db, "linkedinPosts", id), { text, editedAt: new Date().toISOString() });
