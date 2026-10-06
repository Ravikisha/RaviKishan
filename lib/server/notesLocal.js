// The built-in note store: Firestore collection `notes/`, admin-only.
//
// This is the DEFAULT source and the one the user asked for first — "a custom
// own note system I can use when I don't want these settings". It needs no
// third party, no consent screen, no key, and it keeps working when Notion is
// down, when a Trello token is revoked, and when a vault repository is being
// renamed. Everything else here is optional on top of it.
//
// Like every other server-side Firestore access in this deployment it goes
// through the REST API AS THE USER (no service account), so firestore.rules
// stays the real boundary.
import crypto from "crypto";
import {
  getDocument,
  listDocuments,
  patchDocument,
  createDocument,
  deleteDocument,
} from "./firestoreRest.js";
import { NoteError, shapeNote, cleanTags, sortNotes, titleFrom } from "./noteShape.js";

const COLLECTION = "notes";

// Sortable by id and collision-proof without a round trip. The timestamp
// prefix means a raw Firestore listing is already roughly chronological, which
// matters because the REST list endpoint cannot order without an index.
const newId = () => `n_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;

const fromDoc = (d) =>
  shapeNote(
    {
      id: d.id,
      title: d.title,
      body: d.body,
      tags: d.tags,
      container: d.notebook,
      containerName: d.notebook,
      pinned: d.pinned,
      archived: d.archived,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    },
    { source: "local" }
  );

export async function listNotes(idToken, { includeArchived = true } = {}) {
  // No orderBy: ordering a Firestore REST list needs a composite index, and an
  // index nobody deployed answers 400 — the exact fault that left /feed.xml
  // emitting an empty channel for 29 posts. A few hundred notes sort fine here.
  const rows = await listDocuments(idToken, COLLECTION, { pageSize: 300 });
  const notes = rows.map(fromDoc).filter((n) => includeArchived || !n.archived);
  return sortNotes(notes);
}

export async function getNote(idToken, id) {
  const d = await getDocument(idToken, `${COLLECTION}/${id}`);
  if (!d) throw new NoteError(`No note ${id} here.`);
  return fromDoc(d);
}

export async function createNote(idToken, patch) {
  const now = new Date().toISOString();
  const id = newId();
  const body = String(patch.body || "");
  const data = {
    // A note pasted in as a wall of text has no title; take its first heading
    // or first line rather than storing an empty one and showing "Untitled".
    title: String(patch.title || "").trim() || titleFrom(body, "Untitled"),
    body,
    tags: cleanTags(patch.tags),
    notebook: String(patch.container || ""),
    pinned: !!patch.pinned,
    archived: !!patch.archived,
    createdAt: now,
    updatedAt: now,
  };
  await createDocument(idToken, COLLECTION, id, data);
  return fromDoc({ id, ...data });
}

export async function updateNote(idToken, id, patch) {
  const data = {};
  if (patch.title !== undefined) data.title = String(patch.title);
  if (patch.body !== undefined) data.body = String(patch.body);
  if (patch.tags !== undefined) data.tags = cleanTags(patch.tags);
  if (patch.container !== undefined) data.notebook = String(patch.container);
  if (patch.pinned !== undefined) data.pinned = !!patch.pinned;
  if (patch.archived !== undefined) data.archived = !!patch.archived;
  if (!Object.keys(data).length) throw new NoteError("Nothing to change.");

  // Always stamped, and always last, so a patch cannot leave the timestamp
  // behind — which would quietly break every "newest first" list.
  data.updatedAt = new Date().toISOString();

  // patchDocument sends an updateMask built from these keys, so untouched
  // fields are left alone rather than being cleared.
  await patchDocument(idToken, `${COLLECTION}/${id}`, data);
  return getNote(idToken, id);
}

export async function deleteNote(idToken, id) {
  await deleteDocument(idToken, `${COLLECTION}/${id}`);
  return { deleted: id };
}

// Notebooks are not a collection. A notebook here is just the string on a
// note, so there is nothing to create, nothing to keep in sync, and no empty
// notebook left behind when its last note moves out — the same reasoning as
// deriving the certificate logo picker from the content itself.
export async function listNotebooks(idToken) {
  const notes = await listNotes(idToken);
  const counts = new Map();
  for (const n of notes) {
    if (!n.container) continue;
    counts.set(n.container, (counts.get(n.container) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, notes]) => ({ id, name: id, notes }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
