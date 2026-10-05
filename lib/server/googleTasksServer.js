// Google Tasks from the server, for the MCP tools.
//
// The problem this solves: the admin panel talks to Google Tasks with an
// access token that Firebase hands the BROWSER at sign-in. The MCP server has
// no such token — it authenticates as the Firebase user and speaks to
// Firestore, which is a different credential entirely.
//
// The obvious fix is to store a Google REFRESH token so the server can mint
// its own. This codebase has refused that from the start, and still does: a
// refresh token is permanent access to the account's tasks, held server-side,
// and it is a far worse secret than anything else in this deployment.
//
// What happens instead: the admin panel writes its SHORT-LIVED access token to
// an admin-only Firestore document when it connects, and these tools borrow
// it. The token expires in about an hour, so an AI client can manage tasks for
// as long as the admin session is warm and is told plainly to reconnect
// otherwise. That is a real limitation, stated rather than hidden — and it
// costs nothing permanent if the document ever leaks.
import { getDocument } from "./firestoreRest.js";

const API = "https://tasks.googleapis.com/tasks/v1";

// Where the panel parks the token. Admin-only in firestore.rules, in both
// directions — this is a credential, not content.
export const TOKEN_PATH = "integrations/googleTasks";

export class TasksAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "TasksAuthError";
  }
}

const RECONNECT =
  "No usable Google Tasks token. Open the admin's Tasks tab and press Connect — " +
  "Google issues this token to the browser and it lasts about an hour, so it has " +
  "to be refreshed there rather than here.";

export async function googleTasksToken(idToken) {
  const doc = await getDocument(idToken, TOKEN_PATH);
  if (!doc?.accessToken) throw new TasksAuthError(RECONNECT);
  const expires = Date.parse(doc.expiresAt || "");
  // A minute of headroom so a call cannot die mid-flight.
  if (!expires || expires < Date.now() + 60_000) {
    throw new TasksAuthError(
      `${RECONNECT} (the stored token expired ${
        expires ? new Date(expires).toISOString() : "at an unknown time"
      }.)`
    );
  }
  return doc.accessToken;
}

async function call(token, path, { method = "GET", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401 || res.status === 403) {
    throw new TasksAuthError(
      "Google rejected the stored token. Reconnect in the admin's Tasks tab."
    );
  }
  if (res.status === 404) {
    throw new Error(
      "Google Tasks answered 404 — either that id does not exist, or the Tasks API is not enabled for this Google Cloud project."
    );
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json())?.error?.message || msg;
    } catch (_) {}
    throw new Error(`Google Tasks: ${msg}`);
  }
  return res.status === 204 ? null : res.json();
}

/* ---------------- groups ---------------- */

export const listGroups = (t) =>
  call(t, "/users/@me/lists?maxResults=100").then((d) => d.items || []);

export const createGroup = (t, title) =>
  call(t, "/users/@me/lists", { method: "POST", body: { title } });

export const renameGroup = (t, id, title) =>
  call(t, `/users/@me/lists/${encodeURIComponent(id)}`, { method: "PATCH", body: { title } });

export const deleteGroup = (t, id) =>
  call(t, `/users/@me/lists/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ---------------- tasks ---------------- */

export const listTasksIn = (t, listId, { showCompleted = false } = {}) =>
  call(
    t,
    `/lists/${encodeURIComponent(listId)}/tasks?maxResults=100&showCompleted=${showCompleted}&showHidden=${showCompleted}`
  ).then((d) => d.items || []);

export const createTaskIn = (t, listId, task) =>
  call(t, `/lists/${encodeURIComponent(listId)}/tasks`, { method: "POST", body: task });

export const patchTaskIn = (t, listId, taskId, patch) =>
  call(t, `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: patch,
  });

export const deleteTaskIn = (t, listId, taskId) =>
  call(t, `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });

// Across lists this keeps the task's id, notes and subtasks; the older
// create-then-delete loses all three.
export async function moveTaskTo(t, fromListId, taskId, { toListId, parent, previous } = {}) {
  const q = new URLSearchParams();
  if (toListId && toListId !== fromListId) q.set("destinationTasklist", toListId);
  if (parent) q.set("parent", parent);
  if (previous) q.set("previous", previous);
  const qs = q.toString();
  return call(
    t,
    `/lists/${encodeURIComponent(fromListId)}/tasks/${encodeURIComponent(taskId)}/move${qs ? `?${qs}` : ""}`,
    { method: "POST" }
  );
}

// Google stores a due date as RFC3339 but ignores the time, so a plain date
// has to be sent as midnight UTC or it lands on the wrong day.
export const toDueDate = (d) => (d ? `${String(d).slice(0, 10)}T00:00:00.000Z` : null);
export const fromDueDate = (d) => (d ? String(d).slice(0, 10) : "");
