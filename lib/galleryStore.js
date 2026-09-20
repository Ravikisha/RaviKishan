// The photo wall.
//
// Images live in the same private bucket under media/gallery/ and are served
// through /api/media/, so they are public to read but there is still only one
// bucket and one upload path. Metadata (title, category, note, order) is in
// the world-readable `gallery` collection.
//
// `order` is an explicit number rather than an upload timestamp, because a
// gallery is curated — the newest shot is not automatically the one that
// should lead.
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "./firebase";

export const CATEGORIES = ["Desk", "Builds", "Talks", "Field", "People", "Other"];

export async function fetchGallery() {
  try {
    const snap = await getDocs(query(collection(db, "gallery"), orderBy("order", "asc")));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (_) {
    // Missing index, offline, or rules not yet published — the app falls back
    // to its built-in shots rather than rendering an empty wall.
    return [];
  }
}

// Gallery keys are content-addressed by timestamp, so a URL never changes.
export const galleryKey = (filename) =>
  `media/gallery/${Date.now()}-${String(filename || "photo")
    .replace(/[^\w.-]+/g, "_")
    .slice(-60)}`;

export const publicUrlFor = (key) => `/api/media/${String(key).slice("media/".length)}`;
