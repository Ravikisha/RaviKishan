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
import { db } from "./firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { adminJson } from "./adminFetch";
import { currentOrgId, DEFAULT_ORG } from "./orgState";
import { rowInOrg } from "./server/orgShape";
import { finishConnect as claimConnection } from "./socialClient";

// The cap and the counter come from the SAME module the server validates
// with, so the composer can never say "47 left" about a post the server will
// refuse.
export { MAX_POST_CHARS, charsLeft } from "./server/linkedinText";

// Through adminFetch, so the org header travels: which LinkedIn accounts this
// page may post as is decided by the org it is in.
const post = (action, payload) => adminJson("/api/linkedin", { action, ...payload });

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
// The server decides WHERE it goes; the browser writes it, because the API
// routes have no Firestore credential of their own. This used to be a second
// copy of the claim, and the copy would have written `orgIds` with a plain
// merge — evicting the account from every other org it was in. The shared
// claim unions it instead.
export const finishConnect = () => claimConnection("linkedin");

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
  const json = await adminJson("/api/accounts", { action: "list" });
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
  // A row with no orgId predates orgs, so it is Relax's — even one that carries
  // an accountId: that says who published it, not which org did, and letting
  // it through elsewhere would show Relax's history in every org.
  const org = currentOrgId();
  const loose = org === DEFAULT_ORG;
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => rowInOrg(r, org));
  if (!accountId) return rows;
  return rows.filter((r) => (!r.accountId && loose) || r.accountId === accountId);
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
    // The org it was published from, so the history of one org never lists
    // another's posts even for an account the two share.
    orgId: currentOrgId(),
  });

export const markEdited = (id, text) =>
  updateDoc(doc(db, "linkedinPosts", id), { text, editedAt: new Date().toISOString() });
