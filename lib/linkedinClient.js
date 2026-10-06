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
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
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

export const getProfile = () => post("profile", {});
export const getCapabilities = () => post("capabilities", {});
export const publish = (body) => post("publish", body);
export const removePost = (urn) => post("delete", { urn });
export const jobSearchUrl = (filters) => post("jobSearchUrl", filters);

// The history is ours, so it is read straight from Firestore rather than
// through the API route — the rules already make it admin-only.
export async function listPosts(max = 50) {
  const snap = await getDocs(
    query(collection(db, "linkedinPosts"), orderBy("postedAt", "desc"), fsLimit(max))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// A deleted post stays in the record, marked. Removing the row would make the
// history quietly disagree with what was actually published.
export const markDeleted = (id) =>
  updateDoc(doc(db, "linkedinPosts", id), { deletedAt: new Date().toISOString() });

export const forgetPost = (id) => deleteDoc(doc(db, "linkedinPosts", id));
