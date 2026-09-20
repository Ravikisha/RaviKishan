// Google Tasks, in the admin.
//
// Reads and writes your real Google Tasks lists — this is not a second todo
// system to keep in sync, which is the usual failure mode of bolting tasks
// onto a dashboard. Everything here round-trips to Google immediately.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAccessToken,
  forgetToken,
  listTaskLists,
  listTasks,
  createTask,
  patchTask,
  deleteTask,
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

export default function TasksPanel({ user }) {
  const [token, setToken] = useState(null);
  const [lists, setLists] = useState([]);
  const [listId, setListId] = useState("");
  const [tasks, setTasks] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [showDone, setShowDone] = useState(false);

  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(null);

  // Try silently on mount so a returning session goes straight to the tasks.
  useEffect(() => {
    getAccessToken({ interactive: false })
      .then((t) => t && setToken(t))
      .catch(() => {});
  }, []);

  const loadLists = useCallback(async (t) => {
    const ls = await listTaskLists(t);
    setLists(ls);
    setListId((cur) => cur || ls[0]?.id || "");
  }, []);

  useEffect(() => {
    if (!token) return;
    loadLists(token).catch((e) => setErr(e.message));
  }, [token, loadLists]);

  const refresh = useCallback(async () => {
    if (!token || !listId) return;
    setBusy("Loading tasks…");
    try {
      setTasks(await listTasks(token, listId, { showCompleted: true }));
      setErr("");
    } catch (e) {
      if (e.code === "gtasks/reauth") setToken(null);
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }, [token, listId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connect = async () => {
    setErr("");
    setBusy("Waiting for Google…");
    try {
      setToken(await getAccessToken({ interactive: true }));
      setMsg("Connected to Google Tasks.");
    } catch (e) {
      if (!/popup-closed|cancelled-popup/.test(e?.code || "")) setErr(e.message || "Could not connect.");
    } finally {
      setBusy("");
    }
  };

  const disconnect = () => {
    forgetToken();
    setToken(null);
    setTasks(null);
    setMsg("Disconnected. Your Google account still has the grant — remove it in your Google account settings to revoke it fully.");
  };

  const guard = async (label, fn) => {
    setErr("");
    setMsg("");
    setBusy(label);
    try {
      await fn();
      await refresh();
    } catch (e) {
      if (e.code === "gtasks/reauth") setToken(null);
      setErr(e.message || "Failed.");
    } finally {
      setBusy("");
    }
  };

  const submit = () =>
    guard(editing ? "Saving…" : "Adding…", async () => {
      if (!title.trim()) throw new Error("A title is required.");
      const payload = {
        title: title.trim(),
        notes: notes.trim() || undefined,
        due: toDue(due) || undefined,
      };
      if (editing) {
        await patchTask(token, listId, editing, { ...payload, notes: notes.trim(), due: toDue(due) });
        await logAdminAction({ action: "task.update", target: title.trim(), user });
      } else {
        await createTask(token, listId, payload);
        await logAdminAction({ action: "task.create", target: title.trim(), user });
      }
      setTitle("");
      setDue("");
      setNotes("");
      setEditing(null);
    });

  const toggle = (t) => () =>
    guard("Updating…", () =>
      patchTask(token, listId, t.id, {
        status: t.status === "completed" ? "needsAction" : "completed",
        // Google keeps a stale completion timestamp unless it is cleared.
        completed: t.status === "completed" ? null : new Date().toISOString(),
      })
    );

  const edit = (t) => () => {
    setEditing(t.id);
    setTitle(t.title || "");
    setDue(fromDue(t.due));
    setNotes(t.notes || "");
  };

  const remove = (t) => () => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete "${t.title}"?`)) return;
    guard("Deleting…", async () => {
      await deleteTask(token, listId, t.id);
      await logAdminAction({ action: "task.delete", target: t.title, user });
      if (editing === t.id) {
        setEditing(null);
        setTitle("");
        setDue("");
        setNotes("");
      }
    });
  };

  const visible = useMemo(() => {
    const all = tasks || [];
    const open = all.filter((t) => t.status !== "completed");
    const done = all.filter((t) => t.status === "completed");
    const rank = (t) => {
      const s = dueState(t.due);
      return s === "overdue" ? 0 : s === "today" ? 1 : s === "later" ? 2 : 3;
    };
    open.sort((a, b) => rank(a) - rank(b) || fromDue(a.due).localeCompare(fromDue(b.due)));
    return showDone ? [...open, ...done] : open;
  }, [tasks, showDone]);

  const counts = useMemo(() => {
    const all = tasks || [];
    return {
      open: all.filter((t) => t.status !== "completed").length,
      overdue: all.filter((t) => t.status !== "completed" && dueState(t.due) === "overdue").length,
      done: all.filter((t) => t.status === "completed").length,
    };
  }, [tasks]);

  if (!token) {
    return (
      <main className="admin-main">
        <section className="ops-card">
          <h3>Google Tasks</h3>
          <p className="admin-sub">
            Connect the Google account you already sign in with. This reads and
            writes your real task lists — nothing is copied into a second todo
            system here. Google&apos;s access token lasts about an hour, so you
            will reconnect occasionally; that is deliberate, the alternative is
            storing a Google refresh token on the server.
          </p>
          {err && <div className="admin-err">{err}</div>}
          {msg && !err && <div className="rm-ok">{msg}</div>}
          <div style={{ marginTop: 12 }}>
            <button className="admin-primary" type="button" onClick={connect} disabled={!!busy}>
              {busy || "Connect Google Tasks"}
            </button>
          </div>
          <p className="admin-sub" style={{ marginTop: 12 }}>
            First time: the Tasks API must be enabled for this Google Cloud
            project, and the <code>auth/tasks</code> scope added to the OAuth
            consent screen.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-main">
      <section className="ops-card">
        <div className="ops-head">
          <h3>
            Tasks{" "}
            <span className="admin-sub">
              {counts.open} open
              {counts.overdue > 0 && ` · ${counts.overdue} overdue`}
              {counts.done > 0 && ` · ${counts.done} done`}
            </span>
          </h3>
          <span className="tk-head-btns">
            <select
              className="admin-input tk-list"
              value={listId}
              onChange={(e) => setListId(e.target.value)}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
            <button className="admin-ghost sm" type="button" onClick={refresh} disabled={!!busy}>
              Refresh
            </button>
            <button className="admin-ghost sm" type="button" onClick={disconnect}>
              Disconnect
            </button>
          </span>
        </div>

        <div className="tk-form">
          <input
            className="admin-input"
            placeholder={editing ? "Edit task" : "What needs doing?"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
          />
          <input
            className="admin-input tk-due"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <input
            className="admin-input"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button className="admin-primary" type="button" onClick={submit} disabled={!!busy}>
            {busy || (editing ? "Save" : "Add task")}
          </button>
          {editing && (
            <button
              className="admin-ghost"
              type="button"
              onClick={() => {
                setEditing(null);
                setTitle("");
                setDue("");
                setNotes("");
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </section>

      {err && <div className="admin-err">{err}</div>}
      {msg && !err && <div className="rm-ok">{msg}</div>}

      <div className="vt-toolbar">
        <label className="tk-toggle">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          <span>Show completed</span>
        </label>
      </div>

      {tasks == null ? (
        <p className="admin-sub" style={{ padding: "20px 2px" }}>Loading…</p>
      ) : visible.length === 0 ? (
        <div className="inbox-empty">
          <p>{counts.done ? "Everything here is done." : "Nothing on this list."}</p>
          <span>Add a task above.</span>
        </div>
      ) : (
        <div className="vt-list">
          {visible.map((t) => {
            const state = dueState(t.due);
            const done = t.status === "completed";
            return (
              <div key={t.id} className={`vt-item tk-item${done ? " done" : ""}`}>
                <div className="vt-main">
                  <button
                    className={`tk-check${done ? " on" : ""}`}
                    type="button"
                    onClick={toggle(t)}
                    aria-label={done ? "Mark not done" : "Mark done"}
                    disabled={!!busy}
                  >
                    {done ? "✓" : ""}
                  </button>
                  <span className="vt-name">{t.title || "(untitled)"}</span>
                  {t.due && !done && (
                    <span className={`vt-exp ${state === "overdue" ? "bad" : state === "today" ? "warn" : "ok"}`}>
                      {state === "overdue" ? "overdue" : state === "today" ? "today" : fromDue(t.due)}
                    </span>
                  )}
                </div>
                {t.notes && <div className="vt-meta">{t.notes}</div>}
                <div className="vt-btns">
                  <button className="admin-ghost sm" type="button" onClick={edit(t)} disabled={!!busy}>
                    Edit
                  </button>
                  <button className="admin-del" type="button" onClick={remove(t)} disabled={!!busy}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style jsx global>{`
        .tk-head-btns {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .tk-list {
          max-width: 190px;
          padding: 5px 9px;
          font-size: 12px;
        }
        .tk-form {
          display: grid;
          grid-template-columns: 2fr 150px 2fr auto auto;
          gap: 10px;
          align-items: center;
          margin-top: 12px;
        }
        @media (max-width: 960px) {
          .tk-form {
            grid-template-columns: 1fr;
          }
        }
        .tk-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12.5px;
          color: #8b90a0;
          cursor: pointer;
        }
        .tk-check {
          flex-shrink: 0;
          width: 19px;
          height: 19px;
          border-radius: 6px;
          border: 1.5px solid #3a3f4d;
          background: none;
          color: #0a1a05;
          font-size: 12px;
          line-height: 1;
          cursor: pointer;
          display: grid;
          place-items: center;
        }
        .tk-check:hover {
          border-color: #ffb020;
        }
        .tk-check.on {
          background: #4ed0c0;
          border-color: #4ed0c0;
        }
        .tk-item.done .vt-name {
          text-decoration: line-through;
          color: #6b7080;
        }
      `}</style>
    </main>
  );
}
