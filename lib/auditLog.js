// Append-only record of every write made from the admin.
//
// Single-admin CMS, so this is not about catching someone else — it is about
// answering "what did I change, and when did the site start looking wrong".
// The rules make it create-only: the admin can write and read entries but
// cannot edit or delete them, so the log can't be quietly rewritten.
//
// Logging must never break the thing being logged: every failure here is
// swallowed. A lost log line is an acceptable cost; a failed résumé upload
// because the log write failed is not.
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

export async function logAdminAction({ action, target = "", detail = "", user } = {}) {
  try {
    await addDoc(collection(db, "auditLog"), {
      action,
      target,
      detail,
      email: user?.email || "",
      uid: user?.uid || "",
      at: new Date().toISOString(),
      ts: serverTimestamp(),
      ua:
        typeof navigator !== "undefined"
          ? String(navigator.userAgent).slice(0, 200)
          : "",
    });
  } catch (_) {
    /* deliberately silent — see note above */
  }
}

// Short human label for an action id, used by the admin log viewer.
export const ACTION_LABELS = {
  "content.save": "Published site content",
  "content.draft": "Saved draft",
  "content.restore": "Restored a previous version",
  "content.reset": "Reset editor to file defaults",
  "resume.upload": "Uploaded a résumé",
  "resume.makeLive": "Switched the live résumé",
  "resume.delete": "Deleted a résumé version",
  "vault.upload": "Added a vault document",
  "vault.open": "Opened a vault document",
  "vault.delete": "Deleted a vault document",
  "vault.import": "Imported vault documents from a manifest",
  "storage.delete": "Deleted a file from object storage",
  "gallery.upload": "Added photos to the gallery",
  "gallery.delete": "Removed a gallery photo",
  "export.run": "Exported a backup",
  "link.create": "Created a short link",
  "link.toggle": "Enabled/disabled a short link",
  "link.delete": "Deleted a short link",
  "job.create": "Tracked a job application",
  "job.stage": "Moved an application stage",
  "job.delete": "Removed a job application",
  "post.publish": "Published a post",
  "post.unpublish": "Unpublished a post",
  "post.draft": "Saved a post draft",
  "post.delete": "Deleted a post",
  "post.import": "Imported articles from dev.to",
  "post.crosspost": "Cross-posted to dev.to",
  "contacts.import": "Imported LinkedIn connections",
  "task.create": "Created a Google task",
  "task.update": "Updated a Google task",
  "task.delete": "Deleted a Google task",
  "mcp.mint": "Minted an MCP access token",
  "mcp.revoke": "Revoked an MCP access token",
};
