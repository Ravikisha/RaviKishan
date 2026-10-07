// SERVER ONLY. One task API over two services.
//
// Google Tasks and Microsoft To Do answer the same questions in different
// words. Rather than give an AI client two parallel sets of tools to choose
// between — nine `google_*` and nine `microsoft_*`, with the model guessing
// which account a request meant — every tool takes `provider` and arrives
// here. One vocabulary, two back ends.
//
// The shape everything speaks:
//   group { id, title, readOnlyName? }
//   task  { id, title, notes, due:"YYYY-MM-DD", completed, parent, isStep }
//
// Where a service cannot do something, this layer throws a sentence saying so.
// It never silently does something else instead — a move that quietly becomes
// a copy is worse than a move that refuses.
import { accessTokenFor } from "./connectedAccount.js";
import * as google from "./googleTasksServer.js";
import * as microsoft from "./msTodo.js";
import { getProvider } from "./integrations.js";

export const DEFAULT_PROVIDER = "google";

/* ---------------- google, normalised ---------------- */

const gTask = (t) => ({
  id: t.id,
  title: t.title || "",
  notes: t.notes || "",
  due: google.fromDueDate(t.due),
  completed: t.status === "completed",
  parent: t.parent || null,
  isStep: false,
});

const googleAdapter = {
  id: "google",
  label: "Google Tasks",
  // What the caller can rely on, so a tool can say why rather than fail.
  can: { nestedTasks: true, moveKeepsId: true, subtaskDetails: true },

  listGroups: async (t) =>
    (await google.listGroups(t)).map((g) => ({ id: g.id, title: g.title, updated: g.updated })),
  createGroup: async (t, title) => {
    const g = await google.createGroup(t, title);
    return { id: g.id, title: g.title };
  },
  renameGroup: async (t, id, title) => {
    const g = await google.renameGroup(t, id, title);
    return { id: g.id, title: g.title };
  },
  deleteGroup: (t, id) => google.deleteGroup(t, id),

  listTasks: async (t, listId, opts) => (await google.listTasksIn(t, listId, opts)).map(gTask),
  createTask: async (t, listId, { title, notes, due, parent }) =>
    gTask(
      await google.createTaskIn(t, listId, {
        title,
        notes: notes || undefined,
        due: due ? google.toDueDate(due) : undefined,
        parent: parent || undefined,
      })
    ),
  patchTask: async (t, listId, taskId, patch) => {
    const body = {};
    if (typeof patch.title === "string") body.title = patch.title;
    if (typeof patch.notes === "string") body.notes = patch.notes;
    if ("due" in patch) body.due = patch.due ? google.toDueDate(patch.due) : null;
    if (typeof patch.completed === "boolean") {
      body.status = patch.completed ? "completed" : "needsAction";
      // Google refuses a completion timestamp on a reopened task.
      body.completed = patch.completed ? new Date().toISOString() : null;
    }
    return gTask(await google.patchTaskIn(t, listId, taskId, body));
  },
  deleteTask: (t, listId, taskId) => google.deleteTaskIn(t, listId, taskId),
  moveTask: async (t, fromListId, taskId, { toListId, parent }) => {
    const out = await google.moveTaskTo(t, fromListId, taskId, { toListId, parent });
    return { ...gTask(out), idChanged: false };
  },
  clearCompleted: async (t, listId) => {
    const done = (await google.listTasksIn(t, listId, { showCompleted: true })).filter(
      (x) => x.status === "completed"
    );
    for (const task of done) await google.deleteTaskIn(t, listId, task.id).catch(() => {});
    return done.length;
  },
};

/* ---------------- microsoft, already normalised ---------------- */

const microsoftAdapter = {
  id: "microsoft",
  label: "Microsoft To Do",
  // Steps are not tasks: they hold a title and a tick and nothing else, and
  // Graph has no move endpoint at all.
  can: { nestedTasks: false, moveKeepsId: false, subtaskDetails: false },

  listGroups: (t) => microsoft.listGroups(t),
  createGroup: (t, title) => microsoft.createGroup(t, title),
  renameGroup: (t, id, title) => microsoft.renameGroup(t, id, title),
  deleteGroup: (t, id) => microsoft.deleteGroup(t, id),

  listTasks: (t, listId, opts) => microsoft.listTasksWithSteps(t, listId, opts),
  createTask: (t, listId, task) => microsoft.createTaskIn(t, listId, task),
  patchTask: (t, listId, taskId, patch) => microsoft.patchTaskIn(t, listId, taskId, patch),
  deleteTask: (t, listId, taskId) => microsoft.deleteTaskIn(t, listId, taskId),
  moveTask: (t, fromListId, taskId, { toListId }) =>
    microsoft.moveTaskTo(t, fromListId, taskId, { toListId }),
  clearCompleted: (t, listId) => microsoft.clearCompleted(t, listId),
};

const ADAPTERS = { google: googleAdapter, microsoft: microsoftAdapter };

// The connected-account table also holds GitHub, LinkedIn and the social
// accounts, so `providerIds()` is NOT the list of task services. Iterating it
// here is how `list_task_providers` crashed on `undefined.can` once GitHub
// joined the table.
export const taskProviderIds = () => Object.keys(ADAPTERS);

export function adapterFor(provider) {
  const id = getProvider(provider || DEFAULT_PROVIDER).id;
  const api = ADAPTERS[id];
  if (!api)
    throw new Error(
      `"${id}" is a connected account, not a task service. Task providers: ${taskProviderIds().join(", ")}.`
    );
  return api;
}

// Every task tool starts here: resolve the provider, get a live credential.
// `accessTokenFor` is what makes this work with no browser open — it unseals
// the stored refresh token and mints a fresh access token per call.
export async function boardFor(idToken, provider, accountId) {
  const api = adapterFor(provider);
  // Through the directory rather than straight to accessTokenFor, so a SECOND
  // Google account actually gets used. The legacy single-account connection is
  // still in the pool, so nothing that worked before stops working — it is
  // simply no longer the only thing that can answer.
  const { tokenFor } = await import("./accountDirectory.js");
  const { token, account } = await tokenFor(idToken, {
    provider: api.id,
    accountId,
    service: "tasks",
  });
  return { api, token, account };
}

// Shared guard: a Microsoft step cannot carry the things a Google subtask can,
// and a caller that tries should be told which service it is talking to.
export function assertSupported(api, feature, what) {
  if (!api.can[feature]) throw new Error(what);
}

// Moving a task from one SERVICE to the other. There is no API for this on
// either side, so it is a recreate-and-delete: the task arrives with a new id,
// and anything the destination cannot hold is reported rather than dropped
// quietly. Deleting last means a failure leaves a duplicate, which is
// recoverable, instead of a hole, which is not.
export async function moveAcrossProviders(idToken, { from, to, taskId }) {
  const src = adapterFor(from.provider);
  const dst = adapterFor(to.provider);
  if (src.id === dst.id) throw new Error("Both sides are the same account — use move_task instead.");

  // Both sides through the directory, so a move can cross ACCOUNTS as well as
  // services — which is the whole point of holding two of each.
  const { tokenFor } = await import("./accountDirectory.js");
  const { token: srcToken } = await tokenFor(idToken, {
    provider: src.id,
    service: "tasks",
    accountId: from.accountId,
  });
  const { token: dstToken } = await tokenFor(idToken, {
    provider: dst.id,
    service: "tasks",
    accountId: to.accountId,
  });

  const rows = await src.listTasks(srcToken, from.groupId, { showCompleted: true });
  const task = rows.find((t) => t.id === taskId);
  if (!task) throw new Error(`No task ${taskId} in that group.`);
  if (task.isStep)
    throw new Error(
      "A Microsoft step lives inside its task and cannot be moved on its own. Move the task it belongs to."
    );

  const children = rows.filter((t) => t.parent === taskId);
  const made = await dst.createTask(dstToken, to.groupId, {
    title: task.title,
    notes: task.notes,
    due: task.due,
  });
  if (task.completed) {
    await dst.patchTask(dstToken, to.groupId, made.id, { completed: true }).catch(() => {});
  }

  const carried = [];
  const lost = [];
  for (const child of children) {
    try {
      await dst.createTask(dstToken, to.groupId, { title: child.title, parent: made.id });
      carried.push(child.title);
      // A Google subtask carries notes and a due date; a Microsoft step holds
      // neither, so say what did not survive rather than letting it vanish.
      if (!dst.can.subtaskDetails && (child.notes || child.due)) lost.push(child.title);
    } catch (_) {
      lost.push(child.title);
    }
  }

  await src.deleteTask(srcToken, from.groupId, taskId);

  return {
    id: made.id,
    title: made.title,
    provider: dst.id,
    groupId: to.groupId,
    idChanged: true,
    previousId: taskId,
    previousProvider: src.id,
    subtasksCarried: carried.length,
    ...(lost.length
      ? {
          warning: `${dst.label} could not keep the details or due date on ${lost.length} subtask(s): ${lost
            .slice(0, 5)
            .join(", ")}.`,
        }
      : {}),
  };
}
