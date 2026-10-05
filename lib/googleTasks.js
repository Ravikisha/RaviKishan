// Google Tasks, through the Google account you already sign in with.
//
// No second login and no server route: Firebase's Google provider can request
// extra OAuth scopes, and the resulting credential carries a Google ACCESS
// token (distinct from the Firebase ID token) that the Tasks REST API accepts
// directly from the browser.
//
// That token is short-lived (~1 hour) and Firebase does not refresh it — it is
// only handed over at sign-in. So it is cached in sessionStorage and, when it
// expires, the user re-consents with a popup. For an admin panel that is the
// right trade: the alternative is storing a Google refresh token server-side,
// which is a far more dangerous secret than anything else here.
import { GoogleAuthProvider, signInWithPopup, reauthenticateWithPopup } from "firebase/auth";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

export const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
const API = "https://tasks.googleapis.com/tasks/v1";
const CACHE_KEY = "gtasks:token";

function readCached() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { token, exp } = JSON.parse(raw);
    // 2 minutes of headroom so a call never dies mid-flight.
    return exp > Date.now() + 120_000 ? token : null;
  } catch (_) {
    return null;
  }
}

function cache(token) {
  publishTokenForTools(token);
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ token, exp: Date.now() + 55 * 60 * 1000 })
    );
  } catch (_) {
    /* private mode — the in-memory flow still works for this page load */
  }
}

// Hand the token to the server side, so the MCP tools can manage tasks too.
//
// Google issues this to the browser and Firebase will not refresh it, so the
// server cannot obtain one by itself. Parking it in an admin-only document is
// what makes "add a task" work from an AI client at all. It expires in about
// an hour; nothing permanent is stored, and the refresh token — which WOULD be
// permanent access — is never written anywhere.
export async function publishTokenForTools(token) {
  try {
    await setDoc(
      doc(db, "integrations", "googleTasks"),
      {
        accessToken: token,
        expiresAt: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (_) {
    // The panel must keep working even if this fails; only the MCP tools lose
    // their token, and they say so clearly when they do.
  }
}

async function revokeTokenForTools() {
  try {
    await deleteDoc(doc(db, "integrations", "googleTasks"));
  } catch (_) {}
}

export function forgetToken() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch (_) {}
  // Disconnecting has to revoke the server's copy too, or "Disconnect" would
  // leave the MCP tools holding a working token.
  revokeTokenForTools();
}

// Asks Google for a Tasks-scoped access token. `interactive: false` returns
// null instead of opening a popup, so the panel can render a "Connect" button
// rather than ambushing the user with a popup on page load.
export async function getAccessToken({ interactive = true } = {}) {
  const cached = readCached();
  if (cached) return cached;
  if (!interactive) return null;

  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");

  const provider = new GoogleAuthProvider();
  provider.addScope(TASKS_SCOPE);
  // Forces the consent screen the first time, which is what actually grants
  // the scope; without it Google silently returns a token without Tasks.
  provider.setCustomParameters({ prompt: "consent" });

  // Re-authenticate rather than sign in again, so the Firebase session (and
  // its auth_time, which the vault's step-up check reads) stays coherent.
  const result = await reauthenticateWithPopup(user, provider).catch(async (e) => {
    if (e?.code === "auth/user-mismatch" || e?.code === "auth/requires-recent-login")
      return signInWithPopup(auth, provider);
    throw e;
  });

  const cred = GoogleAuthProvider.credentialFromResult(result);
  const token = cred?.accessToken;
  if (!token) throw new Error("Google did not return an access token.");
  cache(token);
  return token;
}

async function call(path, { method = "GET", body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401 || res.status === 403) {
    forgetToken();
    const detail = await res.text();
    const e = new Error(
      /insufficient|scope|ACCESS_TOKEN_SCOPE/i.test(detail)
        ? "Google hasn't granted the Tasks scope. Press Connect and approve it."
        : "Google access expired. Press Connect to re-authorize."
    );
    e.code = "gtasks/reauth";
    throw e;
  }
  if (res.status === 404) {
    const e = new Error(
      "Google Tasks API returned 404. Enable it for this project in Google Cloud Console → APIs & Services."
    );
    e.code = "gtasks/not-enabled";
    throw e;
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

export const listTaskLists = (token) =>
  call("/users/@me/lists?maxResults=100", { token }).then((d) => d.items || []);

export const listTasks = (token, listId, { showCompleted = true } = {}) =>
  call(
    `/lists/${encodeURIComponent(listId)}/tasks?maxResults=100&showCompleted=${showCompleted}&showHidden=${showCompleted}`,
    { token }
  ).then((d) => d.items || []);

export const createTask = (token, listId, task) =>
  call(`/lists/${encodeURIComponent(listId)}/tasks`, { method: "POST", body: task, token });

export const patchTask = (token, listId, taskId, patch) =>
  call(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: patch,
    token,
  });

export const deleteTask = (token, listId, taskId) =>
  call(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    token,
  });

/* ---------------- task lists (the groups) ---------------- */

export const createTaskList = (token, title) =>
  call("/users/@me/lists", { method: "POST", body: { title }, token });

export const renameTaskList = (token, listId, title) =>
  call(`/users/@me/lists/${encodeURIComponent(listId)}`, {
    method: "PATCH",
    body: { title },
    token,
  });

// Google deletes every task in the list with it, and there is no undo.
export const deleteTaskList = (token, listId) =>
  call(`/users/@me/lists/${encodeURIComponent(listId)}`, { method: "DELETE", token });

export const clearCompleted = (token, listId) =>
  call(`/lists/${encodeURIComponent(listId)}/clear`, { method: "POST", token });

/* ---------------- moving a task ---------------- */

// Within a list, `move` reorders and re-parents. ACROSS lists it takes a
// destinationTasklist, which is the only way to keep the task's id, notes and
// subtasks intact — the obvious create-then-delete loses the id every link and
// every subtask points at. Older deployments of the API reject the parameter,
// so that fallback is kept for exactly that case.
export async function moveTask(token, fromListId, taskId, { toListId, parent, previous } = {}) {
  const params = new URLSearchParams();
  if (toListId && toListId !== fromListId) params.set("destinationTasklist", toListId);
  if (parent) params.set("parent", parent);
  if (previous) params.set("previous", previous);
  const qs = params.toString();

  try {
    return await call(
      `/lists/${encodeURIComponent(fromListId)}/tasks/${encodeURIComponent(taskId)}/move${qs ? `?${qs}` : ""}`,
      { method: "POST", token }
    );
  } catch (e) {
    if (!toListId || toListId === fromListId) throw e;
    // Copy across, then remove the original. The id changes, which is why this
    // is the fallback and not the path.
    const original = await call(
      `/lists/${encodeURIComponent(fromListId)}/tasks/${encodeURIComponent(taskId)}`,
      { token }
    );
    const copy = await createTask(token, toListId, {
      title: original.title,
      notes: original.notes,
      due: original.due,
      status: original.status,
      completed: original.completed,
    });
    await deleteTask(token, fromListId, taskId);
    return copy;
  }
}

// Google Tasks stores due dates as an RFC3339 timestamp but ignores the time
// part entirely, so a plain date has to be sent as midnight UTC.
export const toDue = (yyyymmdd) => (yyyymmdd ? `${yyyymmdd}T00:00:00.000Z` : null);
export const fromDue = (due) => (due ? String(due).slice(0, 10) : "");
