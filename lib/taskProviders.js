// BROWSER. One task client over Google Tasks and Microsoft To Do.
//
// What changed, and why it matters more than it looks:
//
// The old client asked Firebase for a Google access token at sign-in and kept
// it in sessionStorage. That token lasts about an hour, Firebase will not
// refresh it, and nothing server-side could obtain one — so the panel asked
// you to press Connect every hour, and the MCP tools simply stopped working
// when the browser went cold.
//
// Now the credential comes from this deployment: /api/integrations/<id>/token
// unseals a stored refresh token and mints a fresh access token per use. The
// panel holds nothing durable, there is no Connect-every-hour, and the MCP
// tools use exactly the same connection. Connecting is a one-time act.
import { deleteDoc, doc } from "firebase/firestore";
import { db } from "./firebase";
import { adminJson } from "./adminFetch";
import { currentOrgId, DEFAULT_ORG } from "./orgState";
import { finishConnect as claimConnection } from "./socialClient";

export const PROVIDERS = [
  { id: "google", label: "Google Tasks", short: "Google" },
  { id: "microsoft", label: "Microsoft To Do", short: "Microsoft" },
];

export const providerLabel = (id) => PROVIDERS.find((p) => p.id === id)?.label || id;

// Must match docId in lib/server/integrations.js — the LEGACY single-account
// documents, which only a pre-org connection still lives in.
const DOC_ID = { google: "googleTasks", microsoft: "microsoftTasks", github: "github" };

const API = {
  google: "https://tasks.googleapis.com/tasks/v1",
  microsoft: "https://graph.microsoft.com/v1.0",
};

/* ---------------- this deployment ---------------- */

// Our own routes go through adminFetch (bearer + x-org-id). The provider APIs
// further down deliberately do NOT — see lib/adminFetch.js.
const ours = (path, body) => adminJson(path, body);

// Which accounts are connected, as whom, and what is missing when they are not.
export const connectionStatus = () => ours("/api/integrations/status").then((j) => j.providers);

// Step 1 of connecting: ask for a consent URL and go there. The redirect comes
// back to /admin?tab=tasks&connected=<provider>&org=<org>, which the panel claims.
export async function beginConnect(provider) {
  const { url } = await ours(`/api/integrations/${provider}/start`, { from: "tasks" });
  window.location.assign(url);
}

// Step 2: collect the sealed connection the callback left behind and store it.
//
// This used to write `integrations/googleTasks|microsoftTasks` whatever the
// server said — the legacy single-account store — even though Google and
// Microsoft have been multi-account since the account directory landed. So a
// Tasks-tab consent overwrote the one legacy document instead of adding a
// second account, and never carried an org. The shared claim honours the
// server's collection/docId and unions the org membership.
export const finishConnect = (provider) => claimConnection(provider);

// Disconnecting is per org and goes through the server (see socialClient). A
// connection still in the legacy store has no per-account document for the
// server to edit; it is Relax's by construction, so only Relax may remove it.
export async function disconnect(provider, accountId = current.get(provider) || "") {
  if (accountId) {
    const out = await ours("/api/accounts", { action: "forget", provider, accountId });
    // `remaining` is present only when a per-account document existed.
    if (Array.isArray(out.remaining)) {
      // The selection named the account just removed; leaving it would point
      // the next load (and a second Disconnect) at nothing.
      if (current.get(provider) === accountId) current.set(provider, "");
      return out;
    }
    // No document, and the server says the name is NOT this org's legacy
    // connection: it is simply gone (a stale selection). Deleting the legacy
    // store now would remove an account nobody named.
    if (out.legacy !== true) {
      if (current.get(provider) === accountId) current.set(provider, "");
      throw new Error("That account is no longer connected here. Reload the board to see what is.");
    }
  }
  if (currentOrgId() !== DEFAULT_ORG) {
    throw new Error("That connection predates orgs and belongs to Relax. Switch to Relax to disconnect it.");
  }
  await deleteDoc(doc(db, "integrations", DOC_ID[provider] || provider));
  current.set(provider, "");
  return { removedFrom: DEFAULT_ORG, deleted: true };
}

// Access tokens are minted per use and cached only for this page's lifetime.
// Nothing is written to sessionStorage: the durable credential is the sealed
// refresh token on the server side, and a second copy in the browser would be
// a second thing to leak for no benefit.
const live = new Map();

// WHICH account each provider acts as. Several Google accounts can be
// connected, so the provider alone no longer says whose tasks these are — the
// same problem lib/github.js solved with setAccount(), and the same answer, so
// the twenty functions below keep their signatures.
//
// Empty means "let the server decide": the saved default, then the only one
// connected, then a refusal that lists the candidates. That is deliberate —
// guessing between two accounts writes a task into the wrong person's list.
const current = new Map();

export const setTaskAccount = (provider, accountId) => {
  const was = current.get(provider) || "";
  const now = accountId || "";
  if (was === now) return false;
  current.set(provider, now);
  // The cached token belongs to the account it was minted for, so switching
  // accounts has to drop it or the next call acts as the previous one.
  live.delete(`${provider}:${was}`);
  return true;
};

export const taskAccount = (provider) => current.get(provider) || "";

async function accessToken(provider, { fresh = false } = {}) {
  const accountId = current.get(provider) || "";
  const key = `${provider}:${accountId}`;
  const held = live.get(key);
  if (!fresh && held && held.until > Date.now()) return held.token;
  const { accessToken: token } = await ours(
    `/api/integrations/${provider}/token`,
    accountId ? { accountId } : undefined
  );
  // Half the usual hour, so a long-lived tab refreshes well before expiry
  // rather than discovering it mid-action.
  live.set(key, { token, until: Date.now() + 25 * 60 * 1000 });
  return token;
}

export const forgetTokens = () => live.clear();

/* ---------------- the provider APIs ---------------- */

async function call(provider, path, { method = "GET", body, retry = true } = {}) {
  const token = await accessToken(provider);
  const res = await fetch(API[provider] + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if ((res.status === 401 || res.status === 403) && retry) {
    // One retry with a freshly minted token: the cached one may simply have
    // aged out, and asking the user to reconnect for that would undo the whole
    // point of holding a refresh token.
    live.delete(`${provider}:${current.get(provider) || ""}`);
    return call(provider, path, { method, body, retry: false });
  }
  if (res.status === 401 || res.status === 403) {
    const e = new Error(
      `${providerLabel(provider)} refused the connection. Reconnect it below.`
    );
    e.code = "tasks/reauth";
    e.provider = provider;
    throw e;
  }
  if (res.status === 404) {
    const e = new Error(
      provider === "google"
        ? "Google Tasks answered 404 — enable the Tasks API for this project in Google Cloud Console → APIs & Services."
        : "Microsoft To Do answered 404 — that list or task no longer exists."
    );
    e.code = "tasks/not-found";
    throw e;
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json())?.error?.message || msg;
    } catch (_) {}
    throw new Error(`${providerLabel(provider)}: ${msg}`);
  }
  return res.status === 204 ? null : res.json();
}

const enc = encodeURIComponent;

/* ---------------- the shared shape ----------------
   group { id, title, provider, readOnlyName }
   task  { id, title, notes, due:"YYYY-MM-DD", completed, parent, isStep, provider }
------------------------------------------------------ */

const gTask = (t) => ({
  id: t.id,
  title: t.title || "",
  notes: t.notes || "",
  due: t.due ? String(t.due).slice(0, 10) : "",
  completed: t.status === "completed",
  parent: t.parent || null,
  isStep: false,
  position: t.position || "",
});

const STEP = "step:";
export const isStepId = (id) => String(id || "").startsWith(STEP);
// Percent-encoded, matching lib/server/msTodo.js exactly: the separator can
// never appear inside either half, so the split is not a guess.
const stepId = (taskId, itemId) =>
  `${STEP}${encodeURIComponent(taskId)}:${encodeURIComponent(itemId)}`;
function readStep(id) {
  const [a, b] = String(id).slice(STEP.length).split(":");
  return { taskId: decodeURIComponent(a), itemId: decodeURIComponent(b) };
}

const msTask = (t) => ({
  id: t.id,
  title: t.title || "",
  notes: t.body?.content ? String(t.body.content).trim() : "",
  due: t.dueDateTime?.dateTime ? String(t.dueDateTime.dateTime).slice(0, 10) : "",
  completed: t.status === "completed",
  parent: null,
  isStep: false,
  position: t.createdDateTime || "",
});

const msStep = (taskId, i) => ({
  id: stepId(taskId, i.id),
  title: i.displayName || "",
  notes: "",
  due: "",
  completed: !!i.isChecked,
  parent: taskId,
  isStep: true,
  position: i.createdDateTime || "",
});

const msDue = (d) =>
  d ? { dateTime: `${String(d).slice(0, 10)}T00:00:00.0000000`, timeZone: "UTC" } : null;

/* ---------------- groups ---------------- */

export async function listGroups(provider) {
  if (provider === "google") {
    const d = await call("google", "/users/@me/lists?maxResults=100");
    return (d.items || []).map((l) => ({ id: l.id, title: l.title, provider, readOnlyName: false }));
  }
  const d = await call("microsoft", "/me/todo/lists?$top=100");
  return (d.value || []).map((l) => ({
    id: l.id,
    title: l.displayName,
    provider,
    // Microsoft's built-in lists refuse a rename or a delete; saying so in the
    // menu beats a 400 after the click.
    readOnlyName: !!l.wellknownListName && l.wellknownListName !== "none",
  }));
}

export async function createGroup(provider, title) {
  if (provider === "google") {
    const g = await call("google", "/users/@me/lists", { method: "POST", body: { title } });
    return { id: g.id, title: g.title, provider };
  }
  const g = await call("microsoft", "/me/todo/lists", {
    method: "POST",
    body: { displayName: title },
  });
  return { id: g.id, title: g.displayName, provider };
}

export async function renameGroup(provider, id, title) {
  if (provider === "google")
    return call("google", `/users/@me/lists/${enc(id)}`, { method: "PATCH", body: { title } });
  return call("microsoft", `/me/todo/lists/${enc(id)}`, {
    method: "PATCH",
    body: { displayName: title },
  });
}

export async function deleteGroup(provider, id) {
  const path =
    provider === "google" ? `/users/@me/lists/${enc(id)}` : `/me/todo/lists/${enc(id)}`;
  return call(provider, path, { method: "DELETE" });
}

/* ---------------- tasks ---------------- */

export async function listTasks(provider, listId, { showCompleted = true } = {}) {
  if (provider === "google") {
    const d = await call(
      "google",
      `/lists/${enc(listId)}/tasks?maxResults=100&showCompleted=${showCompleted}&showHidden=${showCompleted}`
    );
    return (d.items || []).map(gTask);
  }
  const filter = showCompleted ? "" : "&$filter=status%20ne%20'completed'";
  const d = await call(
    "microsoft",
    `/me/todo/lists/${enc(listId)}/tasks?$top=100&$expand=checklistItems${filter}`
  );
  const out = [];
  for (const raw of d.value || []) {
    out.push(msTask(raw));
    for (const i of raw.checklistItems || []) out.push(msStep(raw.id, i));
  }
  return out;
}

export async function createTask(provider, listId, { title, notes, due, parent } = {}) {
  if (provider === "google") {
    const body = { title };
    if (notes) body.notes = notes;
    if (due) body.due = `${due}T00:00:00.000Z`;
    if (parent) body.parent = parent;
    // Google takes the parent as a query parameter, not a body field.
    const qs = parent ? `?parent=${enc(parent)}` : "";
    return gTask(await call("google", `/lists/${enc(listId)}/tasks${qs}`, { method: "POST", body }));
  }

  if (parent) {
    const i = await call(
      "microsoft",
      `/me/todo/lists/${enc(listId)}/tasks/${enc(parent)}/checklistItems`,
      { method: "POST", body: { displayName: title } }
    );
    return msStep(parent, i);
  }
  const body = { title };
  if (notes) body.body = { content: notes, contentType: "text" };
  if (due) body.dueDateTime = msDue(due);
  return msTask(await call("microsoft", `/me/todo/lists/${enc(listId)}/tasks`, { method: "POST", body }));
}

export async function patchTask(provider, listId, taskId, patch) {
  if (provider === "google") {
    const body = {};
    if (typeof patch.title === "string") body.title = patch.title;
    if (typeof patch.notes === "string") body.notes = patch.notes;
    if ("due" in patch) body.due = patch.due ? `${patch.due}T00:00:00.000Z` : null;
    if (typeof patch.completed === "boolean") {
      body.status = patch.completed ? "completed" : "needsAction";
      body.completed = patch.completed ? new Date().toISOString() : null;
    }
    return gTask(
      await call("google", `/lists/${enc(listId)}/tasks/${enc(taskId)}`, { method: "PATCH", body })
    );
  }

  if (isStepId(taskId)) {
    const { taskId: owner, itemId } = readStep(taskId);
    const body = {};
    if (typeof patch.title === "string") body.displayName = patch.title;
    if (typeof patch.completed === "boolean") body.isChecked = patch.completed;
    const i = await call(
      "microsoft",
      `/me/todo/lists/${enc(listId)}/tasks/${enc(owner)}/checklistItems/${enc(itemId)}`,
      { method: "PATCH", body }
    );
    return msStep(owner, i);
  }

  const body = {};
  if (typeof patch.title === "string") body.title = patch.title;
  if (typeof patch.notes === "string") body.body = { content: patch.notes, contentType: "text" };
  if ("due" in patch) body.dueDateTime = patch.due ? msDue(patch.due) : null;
  if (typeof patch.completed === "boolean") body.status = patch.completed ? "completed" : "notStarted";
  return msTask(
    await call("microsoft", `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}`, {
      method: "PATCH",
      body,
    })
  );
}

export async function deleteTask(provider, listId, taskId) {
  if (provider === "google")
    return call("google", `/lists/${enc(listId)}/tasks/${enc(taskId)}`, { method: "DELETE" });
  if (isStepId(taskId)) {
    const { taskId: owner, itemId } = readStep(taskId);
    return call(
      "microsoft",
      `/me/todo/lists/${enc(listId)}/tasks/${enc(owner)}/checklistItems/${enc(itemId)}`,
      { method: "DELETE" }
    );
  }
  return call("microsoft", `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}`, {
    method: "DELETE",
  });
}

// Moving a task. Three cases, and the caller is told which one happened,
// because only the first keeps the task's id.
//
//   within Google      the move endpoint, id preserved, subtasks intact
//   within Microsoft   Graph has no move: recreated, NEW id
//   across providers   recreated on the other service, NEW id
export async function moveTask(from, to, task) {
  const sameProvider = from.provider === to.provider;

  if (sameProvider && from.provider === "google") {
    const out = await call(
      "google",
      `/lists/${enc(from.listId)}/tasks/${enc(task.id)}/move?destinationTasklist=${enc(to.listId)}`,
      { method: "POST" }
    );
    return { ...gTask(out), idChanged: false, provider: "google" };
  }

  if (task.isStep) {
    const e = new Error(
      "A Microsoft step lives inside its task and cannot be moved on its own. Move the task it belongs to."
    );
    e.code = "tasks/step-immovable";
    throw e;
  }

  const made = await createTask(to.provider, to.listId, {
    title: task.title,
    notes: task.notes,
    due: task.due,
  });
  if (task.completed) {
    await patchTask(to.provider, to.listId, made.id, { completed: true }).catch(() => {});
  }
  await deleteTask(from.provider, from.listId, task.id);
  return { ...made, idChanged: true, previousId: task.id, provider: to.provider };
}

export async function clearCompleted(provider, listId) {
  const done = (await listTasks(provider, listId, { showCompleted: true })).filter(
    (t) => t.completed && !t.isStep
  );
  for (const t of done) await deleteTask(provider, listId, t.id).catch(() => {});
  return done.length;
}
