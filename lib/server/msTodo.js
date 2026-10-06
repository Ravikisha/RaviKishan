// SERVER ONLY. Microsoft To Do over the Graph API.
//
// Deliberately shaped to answer the same questions as googleTasksServer.js, so
// the adapter above it can treat the two as one board. Where the services
// genuinely differ, this file converts rather than pretends — and the two
// places they differ are worth knowing:
//
//   SUBTASKS. Google subtasks are real tasks with a `parent`. Microsoft has
//   "steps" (checklistItems), which are a title and a tick INSIDE a task —
//   they have no due date, no notes, and cannot themselves be moved. They are
//   addressed here as `step:<taskId>:<itemId>` so one id space covers both, and
//   a step reports `isStep: true` so a caller is never misled about what it can
//   do with it.
//
//   MOVING. Graph has no move operation. Crossing lists means recreating the
//   task and deleting the original, so the id CHANGES — the opposite of
//   Google, whose move endpoint preserves it. Every move result says which
//   happened rather than leaving the caller to assume.
const API = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {}

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
    throw new GraphError(
      "Microsoft rejected the connection. Reconnect Microsoft To Do in the admin's Tasks tab."
    );
  }
  if (res.status === 404) {
    throw new GraphError(
      "Microsoft To Do answered 404 — that list or task does not exist, or the account has no To Do data."
    );
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json())?.error?.message || msg;
    } catch (_) {}
    throw new GraphError(`Microsoft To Do: ${msg}`);
  }
  return res.status === 204 ? null : res.json();
}

const enc = encodeURIComponent;

/* ---------------- dates ---------------- */

// Graph wants a date-time plus a zone and hands back a seven-decimal fraction
// no Date parser wants. Both directions are pinned to UTC midnight so a task
// due "the 9th" does not become the 8th for anyone east of London.
export const toGraphDue = (d) =>
  d ? { dateTime: `${String(d).slice(0, 10)}T00:00:00.0000000`, timeZone: "UTC" } : null;

export const fromGraphDue = (v) => (v?.dateTime ? String(v.dateTime).slice(0, 10) : "");

/* ---------------- lists ---------------- */

export const listGroups = (t) =>
  call(t, "/me/todo/lists?$top=100").then((d) =>
    (d.value || []).map((l) => ({
      id: l.id,
      title: l.displayName,
      // The default "Tasks" list and the Flagged/Planned smart lists cannot be
      // renamed or deleted; saying so beats a 400 from Graph.
      readOnlyName: !!l.wellknownListName && l.wellknownListName !== "none",
    }))
  );

export const createGroup = (t, title) =>
  call(t, "/me/todo/lists", { method: "POST", body: { displayName: title } }).then((l) => ({
    id: l.id,
    title: l.displayName,
  }));

export const renameGroup = (t, id, title) =>
  call(t, `/me/todo/lists/${enc(id)}`, { method: "PATCH", body: { displayName: title } }).then(
    (l) => ({ id: l.id, title: l.displayName })
  );

export const deleteGroup = (t, id) => call(t, `/me/todo/lists/${enc(id)}`, { method: "DELETE" });

/* ---------------- tasks ---------------- */

export const STEP_PREFIX = "step:";
export const isStepId = (id) => String(id || "").startsWith(STEP_PREFIX);
// Both halves are percent-encoded before being joined, so the separator can
// never appear inside either one. Splitting a raw "a:b:c" on the first or the
// last colon is a guess, and a wrong guess here addresses the wrong task.
export const makeStepId = (taskId, itemId) =>
  `${STEP_PREFIX}${encodeURIComponent(taskId)}:${encodeURIComponent(itemId)}`;

export function readStepId(id) {
  const parts = String(id).slice(STEP_PREFIX.length).split(":");
  if (parts.length !== 2) throw new GraphError(`"${id}" is not a usable step id.`);
  return { taskId: decodeURIComponent(parts[0]), itemId: decodeURIComponent(parts[1]) };
}

const shapeTask = (t) => ({
  id: t.id,
  title: t.title || "",
  notes: t.body?.content ? String(t.body.content).trim() : "",
  due: fromGraphDue(t.dueDateTime),
  completed: t.status === "completed",
  parent: null,
  isStep: false,
});

const shapeStep = (taskId, item) => ({
  id: makeStepId(taskId, item.id),
  title: item.displayName || "",
  notes: "",
  due: "",
  completed: !!item.isChecked,
  parent: taskId,
  isStep: true,
});

export async function listTasksIn(t, listId, { showCompleted = false } = {}) {
  const filter = showCompleted ? "" : "&$filter=status%20ne%20'completed'";
  const data = await call(t, `/me/todo/lists/${enc(listId)}/tasks?$top=100${filter}`);
  const rows = data.value || [];

  // Steps arrive only when asked for, so they are fetched per task. Bounded to
  // the tasks that actually say they have any — `checklistItems` comes back on
  // the expanded read, and asking for every task would be 100 extra requests
  // to find out most of them have none.
  const out = [];
  for (const raw of rows) {
    out.push(shapeTask(raw));
    const items = raw.checklistItems;
    if (Array.isArray(items)) {
      for (const it of items) out.push(shapeStep(raw.id, it));
    }
  }
  return out;
}

// Graph returns checklistItems only when the task is read singly or expanded,
// so a board that wants steps asks for them with this.
export async function listTasksWithSteps(t, listId, { showCompleted = false } = {}) {
  const filter = showCompleted ? "" : "&$filter=status%20ne%20'completed'";
  const data = await call(
    t,
    `/me/todo/lists/${enc(listId)}/tasks?$top=100&$expand=checklistItems${filter}`
  );
  const out = [];
  for (const raw of data.value || []) {
    out.push(shapeTask(raw));
    for (const it of raw.checklistItems || []) out.push(shapeStep(raw.id, it));
  }
  return out;
}

export async function createTaskIn(t, listId, { title, notes, due, parent } = {}) {
  // A "subtask" under a Microsoft task is a step, not a task.
  if (parent) {
    const item = await call(t, `/me/todo/lists/${enc(listId)}/tasks/${enc(parent)}/checklistItems`, {
      method: "POST",
      body: { displayName: title },
    });
    return shapeStep(parent, item);
  }

  const body = { title };
  if (notes) body.body = { content: notes, contentType: "text" };
  if (due) body.dueDateTime = toGraphDue(due);
  const made = await call(t, `/me/todo/lists/${enc(listId)}/tasks`, { method: "POST", body });
  return shapeTask(made);
}

export async function patchTaskIn(t, listId, taskId, patch) {
  if (isStepId(taskId)) {
    const { taskId: owner, itemId } = readStepId(taskId);
    const body = {};
    if (typeof patch.title === "string") body.displayName = patch.title;
    if (typeof patch.completed === "boolean") body.isChecked = patch.completed;
    if (!Object.keys(body).length) {
      throw new GraphError(
        "A step only has a title and a tick — it cannot hold details or a due date. Change those on the task it belongs to."
      );
    }
    const item = await call(
      t,
      `/me/todo/lists/${enc(listId)}/tasks/${enc(owner)}/checklistItems/${enc(itemId)}`,
      { method: "PATCH", body }
    );
    return shapeStep(owner, item);
  }

  const body = {};
  if (typeof patch.title === "string") body.title = patch.title;
  if (typeof patch.notes === "string") body.body = { content: patch.notes, contentType: "text" };
  if ("due" in patch) body.dueDateTime = patch.due ? toGraphDue(patch.due) : null;
  if (typeof patch.completed === "boolean") body.status = patch.completed ? "completed" : "notStarted";

  const out = await call(t, `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}`, {
    method: "PATCH",
    body,
  });
  return shapeTask(out);
}

export async function deleteTaskIn(t, listId, taskId) {
  if (isStepId(taskId)) {
    const { taskId: owner, itemId } = readStepId(taskId);
    return call(
      t,
      `/me/todo/lists/${enc(listId)}/tasks/${enc(owner)}/checklistItems/${enc(itemId)}`,
      { method: "DELETE" }
    );
  }
  return call(t, `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}`, { method: "DELETE" });
}

// Graph has no move. Recreating the task is the only way across lists, which
// means a NEW id and — stated rather than discovered — the steps have to be
// recreated with it.
export async function moveTaskTo(t, fromListId, taskId, { toListId } = {}) {
  if (isStepId(taskId)) {
    throw new GraphError(
      "A step cannot be moved between lists. Move the task it belongs to, or make it a task of its own."
    );
  }
  if (!toListId || toListId === fromListId) {
    throw new GraphError("Microsoft To Do has no ordering API, so a move needs a different list.");
  }

  const full = await call(t, `/me/todo/lists/${enc(fromListId)}/tasks/${enc(taskId)}?$expand=checklistItems`);
  const made = await createTaskIn(t, toListId, {
    title: full.title,
    notes: full.body?.content ? String(full.body.content).trim() : "",
    due: fromGraphDue(full.dueDateTime),
  });
  for (const it of full.checklistItems || []) {
    await call(t, `/me/todo/lists/${enc(toListId)}/tasks/${enc(made.id)}/checklistItems`, {
      method: "POST",
      body: { displayName: it.displayName, isChecked: !!it.isChecked },
    }).catch(() => {});
  }
  if (full.status === "completed") {
    await patchTaskIn(t, toListId, made.id, { completed: true }).catch(() => {});
  }
  await call(t, `/me/todo/lists/${enc(fromListId)}/tasks/${enc(taskId)}`, { method: "DELETE" });

  return { ...made, idChanged: true, previousId: taskId };
}

export async function clearCompleted(t, listId) {
  const done = (await listTasksIn(t, listId, { showCompleted: true })).filter(
    (x) => x.completed && !x.isStep
  );
  for (const task of done) await deleteTaskIn(t, listId, task.id).catch(() => {});
  return done.length;
}
