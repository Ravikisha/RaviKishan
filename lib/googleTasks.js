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
import { auth } from "./firebase";

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
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ token, exp: Date.now() + 55 * 60 * 1000 })
    );
  } catch (_) {
    /* private mode — the in-memory flow still works for this page load */
  }
}

export function forgetToken() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch (_) {}
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

// Google Tasks stores due dates as an RFC3339 timestamp but ignores the time
// part entirely, so a plain date has to be sent as midnight UTC.
export const toDue = (yyyymmdd) => (yyyymmdd ? `${yyyymmdd}T00:00:00.000Z` : null);
export const fromDue = (due) => (due ? String(due).slice(0, 10) : "");
