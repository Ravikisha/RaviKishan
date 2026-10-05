// Google Tasks, in the admin — as a board, not a dropdown.
//
// Reads and writes your real Google Tasks lists. This is not a second todo
// system to keep in sync, which is the usual failure mode of bolting tasks
// onto a dashboard: everything here round-trips to Google immediately.
//
// Design: your tasks are already organised into groups, and the old panel hid
// that behind a <select> — one group visible at a time, no way to see the
// shape of the week, and moving a task between groups was impossible. Every
// group is a column now, and a task moves by being dragged. The one loud
// moment in the interface is the amber drop target, because that is the moment
// the interface is answering a question: "will it land here?"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAccessToken,
  forgetToken,
  listTaskLists,
  listTasks,
  createTask,
  patchTask,
  deleteTask,
  moveTask,
  createTaskList,
  renameTaskList,
  deleteTaskList,
  clearCompleted,
  toDue,
  fromDue,
} from "../../lib/googleTasks";
import { logAdminAction } from "../../lib/auditLog";

const todayISO = () => new Date().toISOString().slice(0, 10);

const dueState = (due) => {
  const d = fromDue(due);
  if (!d) return null;
  const today = todayISO();
  if (d < today) return "overdue";
  if (d === today) return "today";
  return "later";
};

const dueLabel = (due) => {
  const d = fromDue(due);
  if (!d) return "";
  const today = todayISO();
  if (d === today) return "Today";
  const t = new Date(`${today}T00:00:00Z`);
  const x = new Date(`${d}T00:00:00Z`);
  const days = Math.round((x - t) / 86400000);
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days < 7) return `In ${days}d`;
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short" });
};

export default function TasksPanel({ user }) {
  const [token, setToken] = useState(null);
  const [lists, setLists] = useState([]);
  const [byList, setByList] = useState({}); // listId -> tasks[]
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState(null); // { listId, task }
  const [dragOver, setDragOver] = useState(null);
  const dragged = useRef(null);

  /* ---------------- connection ---------------- */

  useEffect(() => {
    getAccessToken({ interactive: false })
      .then((t) => t && setToken(t))
      .catch(() => {});
  }, []);

  const loadAll = useCallback(async (t) => {
    const ls = await listTaskLists(t);
    setLists(ls);
    // Every group's tasks at once — a board that fills in column by column as
    // you watch is worse than one that appears whole.
    const entries = await Promise.all(
      ls.map(async (l) => [l.id, await listTasks(t, l.id, { showCompleted: true })])
    );
    setByList(Object.fromEntries(entries));
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    setBusy("Loading your tasks…");
    try {
      await loadAll(token);
      setErr("");
    } catch (e) {
      if (e.code === "gtasks/reauth") setToken(null);
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }, [token, loadAll]);

  useEffect(() => {
    if (token) refresh();
  }, [token, refresh]);

  const connect = async () => {
    setErr("");
    setBusy("Waiting for Google…");
    try {
      setToken(await getAccessToken({ interactive: true }));
      setMsg("Connected to Google Tasks.");
    } catch (e) {
      if (!/popup-closed|cancelled-popup/.test(e?.code || "")) {
        setErr(e.message || "Could not connect.");
      }
    } finally {
      setBusy("");
    }
  };

  const disconnect = () => {
    forgetToken();
    setToken(null);
    setLists([]);
    setByList({});
    setMsg("Disconnected. Your tasks are untouched — this only forgets the token.");
  };

  /* ---------------- helpers ---------------- */

  // Optimistic: Google is a round-trip away and a board that lags behind the
  // pointer feels broken. Every mutation re-reads the affected group after.
  const reloadList = useCallback(
    async (listId) => {
      if (!token) return;
      try {
        const rows = await listTasks(token, listId, { showCompleted: true });
        setByList((m) => ({ ...m, [listId]: rows }));
      } catch (e) {
        setErr(e.message);
      }
    },
    [token]
  );

  const run = async (label, fn, after) => {
    setErr("");
    setBusy(label);
    try {
      await fn();
      if (after) await after();
    } catch (e) {
      if (e.code === "gtasks/reauth") setToken(null);
      setErr(e.message || "That did not work.");
    } finally {
      setBusy("");
    }
  };

  /* ---------------- task operations ---------------- */

  const addTask = (listId, fields) =>
    run(
      "Adding…",
      async () => {
        await createTask(token, listId, {
          title: fields.title.trim(),
          notes: fields.notes || undefined,
          due: fields.due ? toDue(fields.due) : undefined,
          parent: fields.parent || undefined,
        });
        await logAdminAction({ action: "task.create", detail: fields.title, user });
      },
      () => reloadList(listId)
    );

  const toggleDone = (listId, task) =>
    run(
      task.status === "completed" ? "Reopening…" : "Completing…",
      () =>
        patchTask(token, listId, task.id, {
          status: task.status === "completed" ? "needsAction" : "completed",
          // Google refuses a completion timestamp on a reopened task.
          completed: task.status === "completed" ? null : new Date().toISOString(),
        }),
      () => reloadList(listId)
    );

  const saveTask = (listId, taskId, patch) =>
    run("Saving…", () => patchTask(token, listId, taskId, patch), () => reloadList(listId));

  const removeTask = (listId, task) => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete “${task.title || "this task"}”?`)) return;
    run(
      "Deleting…",
      async () => {
        await deleteTask(token, listId, task.id);
        await logAdminAction({ action: "task.delete", detail: task.title, user });
      },
      () => reloadList(listId)
    );
  };

  const moveToList = (fromListId, task, toListId) => {
    if (fromListId === toListId) return;
    // Move it on screen first; the board should answer the drop instantly.
    setByList((m) => ({
      ...m,
      [fromListId]: (m[fromListId] || []).filter((t) => t.id !== task.id),
      [toListId]: [...(m[toListId] || []), task],
    }));
    run(
      "Moving…",
      async () => {
        await moveTask(token, fromListId, task.id, { toListId });
        await logAdminAction({
          action: "task.move",
          detail: `${task.title} → ${lists.find((l) => l.id === toListId)?.title || toListId}`,
          user,
        });
      },
      async () => {
        await reloadList(fromListId);
        await reloadList(toListId);
      }
    );
  };

  /* ---------------- group operations ---------------- */

  const addGroup = () => {
    // eslint-disable-next-line no-alert
    const title = prompt("Name the new group:");
    if (!title || !title.trim()) return;
    run("Creating group…", () => createTaskList(token, title.trim()), refresh);
  };

  const renameGroup = (list) => {
    // eslint-disable-next-line no-alert
    const title = prompt("Rename this group:", list.title);
    if (!title || !title.trim() || title === list.title) return;
    run("Renaming…", () => renameTaskList(token, list.id, title.trim()), refresh);
  };

  const removeGroup = (list) => {
    const n = (byList[list.id] || []).length;
    // eslint-disable-next-line no-alert
    if (
      !confirm(
        `Delete the group “${list.title}”?\n\n${n} task${n === 1 ? "" : "s"} inside will be deleted too. Google has no undo for this.`
      )
    )
      return;
    run("Deleting group…", () => deleteTaskList(token, list.id), refresh);
  };

  const clearDone = (list) =>
    run("Clearing completed…", () => clearCompleted(token, list.id), () => reloadList(list.id));

  /* ---------------- counts ---------------- */

  const totals = useMemo(() => {
    let open = 0;
    let done = 0;
    for (const rows of Object.values(byList)) {
      for (const t of rows) (t.status === "completed" ? done++ : open++);
    }
    return { open, done };
  }, [byList]);

  /* ---------------- render ---------------- */

  if (!token) {
    return (
      <main className="admin-main">
        <div className="tk-connect">
          <h3>Your Google Tasks, here</h3>
          <p>
            This reads and writes the same lists as the Tasks app on your phone — not a
            separate copy. The connection lasts about an hour, then Google asks again.
          </p>
          <button className="admin-primary" type="button" onClick={connect} disabled={!!busy}>
            {busy || "Connect Google Tasks"}
          </button>
          {err && <div className="admin-err">{err}</div>}
        </div>
        <TasksStyles />
      </main>
    );
  }

  return (
    <main className="admin-main tk-main">
      <div className="ops-head tk-head">
        <div>
          <h3>
            Tasks{" "}
            <span className="admin-sub">
              {totals.open} open · {totals.done} done · {lists.length} groups
            </span>
          </h3>
          <p className="admin-sub tk-sub">
            Drag a task onto another group to move it. Everything saves to Google straight away.
          </p>
        </div>
        <span className="tk-actions">
          <label className="tk-toggle">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            <span>Show completed</span>
          </label>
          <button className="admin-ghost" type="button" onClick={addGroup} disabled={!!busy}>
            New group
          </button>
          <button className="admin-ghost" type="button" onClick={refresh} disabled={!!busy}>
            Refresh
          </button>
          <button className="admin-ghost" type="button" onClick={disconnect}>
            Disconnect
          </button>
        </span>
      </div>

      {err && <div className="admin-err">{err}</div>}
      {msg && !err && <div className="rm-ok">{msg}</div>}
      {busy && <div className="tk-busy">{busy}</div>}

      <div className="tk-board">
        {lists.map((list) => (
          <GroupColumn
            key={list.id}
            list={list}
            tasks={byList[list.id] || []}
            showDone={showDone}
            busy={busy}
            isDropTarget={dragOver === list.id}
            onDragStateChange={setDragOver}
            draggedRef={dragged}
            onDropTask={moveToList}
            onAdd={addTask}
            onToggle={toggleDone}
            onEdit={(task) => setEditing({ listId: list.id, task })}
            onRemove={removeTask}
            onRename={() => renameGroup(list)}
            onDelete={() => removeGroup(list)}
            onClearDone={() => clearDone(list)}
          />
        ))}

        <button className="tk-newgroup" type="button" onClick={addGroup} disabled={!!busy}>
          <span>+</span> New group
        </button>
      </div>

      {editing && (
        <TaskEditor
          listId={editing.listId}
          task={editing.task}
          lists={lists}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            saveTask(editing.listId, editing.task.id, patch);
            setEditing(null);
          }}
          onMove={(toListId) => {
            moveToList(editing.listId, editing.task, toListId);
            setEditing(null);
          }}
        />
      )}

      <TasksStyles />
    </main>
  );
}

/* ---------------- a group ---------------- */

export function GroupColumn({
  list,
  tasks,
  showDone,
  busy,
  isDropTarget,
  onDragStateChange,
  draggedRef,
  onDropTask,
  onAdd,
  onToggle,
  onEdit,
  onRemove,
  onRename,
  onDelete,
  onClearDone,
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState(false);

  const open = tasks.filter((t) => t.status !== "completed");
  const done = tasks.filter((t) => t.status === "completed");
  const shown = showDone ? [...open, ...done] : open;

  // Subtasks hang off a parent id; render them under their parent rather than
  // as orphan rows, which is how they look in the Google app.
  const roots = shown.filter((t) => !t.parent);
  const childrenOf = (id) => shown.filter((t) => t.parent === id);

  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd(list.id, { title, due, notes });
    setTitle("");
    setDue("");
    setNotes("");
    setExpanded(false);
  };

  return (
    <section
      className={`tk-col${isDropTarget ? " drop" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        onDragStateChange(list.id);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        onDragStateChange(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDragStateChange(null);
        const payload = draggedRef.current;
        if (payload && payload.listId !== list.id) onDropTask(payload.listId, payload.task, list.id);
        draggedRef.current = null;
      }}
    >
      <header className="tk-col-head">
        <div className="tk-col-title">
          <h4>{list.title}</h4>
          <span className="tk-count">{open.length}</span>
        </div>
        <div className="tk-col-menu">
          <button
            className="tk-icon"
            type="button"
            aria-label={`Actions for ${list.title}`}
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            ⋯
          </button>
          {menu && (
            <>
              <div className="tk-menu-scrim" onClick={() => setMenu(false)} />
              <div className="tk-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMenu(false); onRename(); }}>
                  Rename group
                </button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); onClearDone(); }}>
                  Clear completed
                </button>
                <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(false); onDelete(); }}>
                  Delete group
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="tk-rows">
        {roots.length === 0 && (
          <p className="tk-empty">Nothing here. Add the first task below.</p>
        )}
        {roots.map((t) => (
          <React.Fragment key={t.id}>
            <TaskRow
              task={t}
              listId={list.id}
              draggedRef={draggedRef}
              onToggle={onToggle}
              onEdit={onEdit}
              onRemove={onRemove}
            />
            {childrenOf(t.id).map((c) => (
              <TaskRow
                key={c.id}
                task={c}
                listId={list.id}
                child
                draggedRef={draggedRef}
                onToggle={onToggle}
                onEdit={onEdit}
                onRemove={onRemove}
              />
            ))}
          </React.Fragment>
        ))}
      </div>

      <form className="tk-add" onSubmit={submit}>
        <input
          className="admin-input tk-add-title"
          placeholder="Add a task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setExpanded(true)}
        />
        {expanded && (
          <>
            <div className="tk-add-row">
              <input
                className="admin-input"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                aria-label="Due date"
              />
            </div>
            <textarea
              className="admin-input tk-add-notes"
              placeholder="Details"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="tk-add-actions">
              <button className="admin-primary sm" type="submit" disabled={!!busy || !title.trim()}>
                Add task
              </button>
              <button
                className="admin-ghost sm"
                type="button"
                onClick={() => { setExpanded(false); setTitle(""); setDue(""); setNotes(""); }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </form>
    </section>
  );
}

/* ---------------- a task ---------------- */

function TaskRow({ task, listId, child, draggedRef, onToggle, onEdit, onRemove }) {
  const done = task.status === "completed";
  const state = dueState(task.due);

  return (
    <article
      className={`tk-row${done ? " done" : ""}${child ? " child" : ""}`}
      draggable
      onDragStart={(e) => {
        draggedRef.current = { listId, task };
        e.dataTransfer.effectAllowed = "move";
        // Firefox refuses to start a drag without data on the transfer.
        e.dataTransfer.setData("text/plain", task.id);
      }}
      onDragEnd={() => {
        draggedRef.current = null;
      }}
    >
      <button
        className={`tk-check${done ? " on" : ""}`}
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={() => onToggle(listId, task)}
      >
        {done && (
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 7.4 L5.8 10 L11 4.4" />
          </svg>
        )}
      </button>

      <button className="tk-body" type="button" onClick={() => onEdit(task)} title="Edit task">
        <span className="tk-title">{task.title || "Untitled task"}</span>
        {task.notes && <span className="tk-notes">{task.notes}</span>}
        {task.due && <span className={`tk-due ${state}`}>{dueLabel(task.due)}</span>}
      </button>

      <button
        className="tk-icon tk-del"
        type="button"
        aria-label={`Delete ${task.title}`}
        onClick={() => onRemove(listId, task)}
      >
        ✕
      </button>
    </article>
  );
}

/* ---------------- the editor ---------------- */

function TaskEditor({ listId, task, lists, onClose, onSave, onMove }) {
  const [title, setTitle] = useState(task.title || "");
  const [notes, setNotes] = useState(task.notes || "");
  const [due, setDue] = useState(fromDue(task.due));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="tk-modal-scrim" onMouseDown={onClose}>
      <div className="tk-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Edit task">
        <h4>Edit task</h4>

        <label className="tk-field">
          <span>Title</span>
          <input className="admin-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>

        <label className="tk-field">
          <span>Details</span>
          <textarea
            className="admin-input tk-add-notes"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the title does not say"
          />
        </label>

        <label className="tk-field">
          <span>Due</span>
          <input className="admin-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>

        <label className="tk-field">
          <span>Group</span>
          <select
            className="admin-input"
            value={listId}
            onChange={(e) => e.target.value !== listId && onMove(e.target.value)}
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>

        <div className="tk-modal-actions">
          <button className="admin-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="admin-primary"
            type="button"
            onClick={() =>
              onSave({
                title: title.trim() || "Untitled task",
                notes,
                due: due ? toDue(due) : null,
              })
            }
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- styles ---------------- */

export function TasksStyles() {
  return (
    <style jsx global>{`
      .tk-main {
        max-width: none;
      }
      .tk-head {
        align-items: flex-start;
      }
      .tk-sub {
        margin: 6px 0 0;
        max-width: 60ch;
      }
      .tk-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .tk-toggle {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
        cursor: pointer;
      }
      .tk-busy {
        margin: 10px 0;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
      }

      .tk-connect {
        max-width: 48ch;
        margin: 40px auto;
        text-align: center;
        display: grid;
        gap: 12px;
        justify-items: center;
      }
      .tk-connect h3 {
        margin: 0;
        font-size: 18px;
        color: var(--a-text, #e7e8ee);
        font-family: "Space Grotesk", sans-serif;
      }
      .tk-connect p {
        margin: 0;
        color: var(--a-dim, #8b90a0);
        font-size: 13.5px;
        line-height: 1.6;
      }

      /* ---- the board ---- */
      .tk-board {
        display: flex;
        gap: 14px;
        align-items: flex-start;
        overflow-x: auto;
        padding: 4px 2px 20px;
        scroll-snap-type: x proximity;
      }
      .tk-col {
        flex: 0 0 306px;
        scroll-snap-align: start;
        display: flex;
        flex-direction: column;
        max-height: calc(100vh - 230px);
        border: 1px solid var(--a-line, #262a35);
        border-radius: 14px;
        background: var(--a-panel, #0f1117);
        transition: border-color 0.14s ease, background 0.14s ease;
      }
      /* The one loud moment: the board answering "will it land here?" */
      .tk-col.drop {
        border-color: var(--a-amber, #ffb020);
        background: rgba(255, 176, 32, 0.05);
      }
      .tk-col-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 12px 12px 10px;
        border-bottom: 1px solid var(--a-line, #1e222c);
      }
      .tk-col-title {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
      }
      .tk-col-title h4 {
        margin: 0;
        font-size: 13.5px;
        font-weight: 600;
        color: var(--a-text, #e7e8ee);
        font-family: "Space Grotesk", sans-serif;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tk-count {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
        font-variant-numeric: tabular-nums;
      }
      .tk-col-menu {
        position: relative;
      }
      .tk-menu-scrim {
        position: fixed;
        inset: 0;
        z-index: 40;
      }
      .tk-menu {
        position: absolute;
        right: 0;
        top: 26px;
        z-index: 41;
        min-width: 170px;
        padding: 5px;
        border: 1px solid var(--a-line, #262a35);
        border-radius: 10px;
        background: var(--a-raise, #171a22);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
        display: flex;
        flex-direction: column;
      }
      .tk-menu button {
        text-align: left;
        background: none;
        border: none;
        color: var(--a-text, #e7e8ee);
        font: inherit;
        font-size: 12.5px;
        padding: 8px 10px;
        border-radius: 7px;
        cursor: pointer;
      }
      .tk-menu button:hover {
        background: rgba(255, 255, 255, 0.05);
      }
      .tk-menu button.danger {
        color: #ff8f8f;
      }

      .tk-rows {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-height: 60px;
      }
      .tk-empty {
        margin: 10px 4px;
        font-size: 12.5px;
        color: #5c6377;
      }

      /* ---- a task ---- */
      .tk-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: start;
        gap: 9px;
        padding: 9px 10px;
        border: 1px solid var(--a-line, #1e222c);
        border-radius: 10px;
        background: #12151d;
        cursor: grab;
      }
      .tk-row:active {
        cursor: grabbing;
      }
      .tk-row:hover {
        border-color: #2f3545;
      }
      .tk-row.child {
        margin-left: 18px;
        border-left: 2px solid var(--a-line, #262a35);
      }
      .tk-row.done .tk-title {
        text-decoration: line-through;
        color: #6a7183;
      }
      .tk-check {
        width: 17px;
        height: 17px;
        margin-top: 1px;
        border: 1.5px solid #3a4152;
        border-radius: 5px;
        background: none;
        cursor: pointer;
        display: grid;
        place-items: center;
        padding: 0;
      }
      .tk-check:hover {
        border-color: var(--a-amber, #ffb020);
      }
      .tk-check.on {
        background: var(--a-amber, #ffb020);
        border-color: var(--a-amber, #ffb020);
      }
      .tk-check svg {
        width: 12px;
        height: 12px;
        fill: none;
        stroke: #1a1300;
        stroke-width: 2.2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .tk-body {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
        min-width: 0;
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        text-align: left;
        cursor: pointer;
        color: inherit;
      }
      .tk-title {
        font-size: 13px;
        line-height: 1.4;
        color: var(--a-text, #e7e8ee);
        overflow-wrap: anywhere;
      }
      .tk-notes {
        font-size: 11.5px;
        line-height: 1.45;
        color: var(--a-dim, #7d8496);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .tk-due {
        font-size: 11px;
        padding: 1px 7px;
        border-radius: 999px;
        border: 1px solid var(--a-line, #262a35);
        color: var(--a-dim, #8b90a0);
      }
      .tk-due.today {
        color: #1a1300;
        background: var(--a-amber, #ffb020);
        border-color: var(--a-amber, #ffb020);
        font-weight: 600;
      }
      .tk-due.overdue {
        color: #ff9d9d;
        border-color: #5d2b2b;
        background: rgba(255, 90, 90, 0.08);
      }
      .tk-icon {
        background: none;
        border: none;
        color: #6a7183;
        font-size: 13px;
        cursor: pointer;
        padding: 2px 5px;
        border-radius: 6px;
        line-height: 1;
      }
      .tk-icon:hover {
        color: var(--a-text, #e7e8ee);
        background: rgba(255, 255, 255, 0.06);
      }
      .tk-row .tk-del {
        opacity: 0;
        transition: opacity 0.12s ease;
      }
      .tk-row:hover .tk-del,
      .tk-row:focus-within .tk-del {
        opacity: 1;
      }

      /* ---- add ---- */
      .tk-add {
        padding: 8px;
        border-top: 1px solid var(--a-line, #1e222c);
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .tk-add .admin-input {
        font-size: 12.5px;
        padding: 8px 10px;
      }
      .tk-add-notes {
        font-family: inherit;
        resize: vertical;
      }
      .tk-add-actions {
        display: flex;
        gap: 7px;
      }
      .admin-primary.sm,
      .admin-ghost.sm {
        padding: 6px 11px;
        font-size: 12px;
        border-radius: 8px;
      }

      .tk-newgroup {
        flex: 0 0 210px;
        min-height: 92px;
        border: 1.5px dashed var(--a-line, #2a3040);
        border-radius: 14px;
        background: none;
        color: var(--a-dim, #8b90a0);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .tk-newgroup:hover {
        border-color: var(--a-amber, #ffb020);
        color: var(--a-text, #e7e8ee);
      }
      .tk-newgroup span {
        font-size: 17px;
      }

      /* ---- editor ---- */
      .tk-modal-scrim {
        position: fixed;
        inset: 0;
        z-index: 60;
        background: rgba(5, 6, 10, 0.62);
        backdrop-filter: blur(3px);
        display: grid;
        place-items: center;
        padding: 20px;
      }
      .tk-modal {
        width: min(480px, 100%);
        max-height: 88vh;
        overflow-y: auto;
        padding: 20px;
        border: 1px solid var(--a-line, #262a35);
        border-radius: 16px;
        background: var(--a-panel, #111319);
        display: flex;
        flex-direction: column;
        gap: 13px;
      }
      .tk-modal h4 {
        margin: 0;
        font-size: 15px;
        color: var(--a-text, #e7e8ee);
        font-family: "Space Grotesk", sans-serif;
      }
      .tk-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .tk-field > span {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
      }
      .tk-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 4px;
      }

      @media (max-width: 720px) {
        .tk-col {
          flex-basis: 85vw;
          max-height: none;
        }
        .tk-rows {
          overflow-y: visible;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .tk-col,
        .tk-row .tk-del {
          transition: none;
        }
      }
    `}</style>
  );
}
