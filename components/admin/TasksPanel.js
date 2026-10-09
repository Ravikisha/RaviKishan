// Your real tasks, in the admin — two accounts, one board.
//
// Reads and writes Google Tasks and Microsoft To Do directly. This is not a
// second todo system to keep in sync, which is the usual failure mode of
// bolting tasks onto a dashboard: everything here round-trips immediately.
//
// DESIGN
//
// The board already had the right idea — every group is a column, a task moves
// by being dragged, and the one loud moment is the amber drop target, because
// that is the interface answering "will it land here?". Two accounts broke it,
// because a groupId is only meaningful inside its own service and a drag from
// one to the other is not a move at all: there is no API for it on either
// side, so the task is recreated and the original deleted, with a new id.
//
// So the account is a SHELF you are inside, not a badge stamped on every card.
// Position carries it — the strongest and cheapest signal there is — and the
// board needs no second colour, no logo, and no per-card chrome to say where
// something lives. It also makes the dangerous action legible for free: a drop
// inside your shelf is the familiar solid amber, a drop onto the other shelf is
// dashed and says what it will do before you let go.
//
// The shelf header says what needs you before you read a single card, in the
// same words and the same graded colours as the rail in AdminShell — the two
// surfaces are one system.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROVIDERS,
  providerLabel,
  connectionStatus,
  beginConnect,
  finishConnect,
  disconnect,
  forgetTokens,
  listGroups,
  listTasks,
  createGroup,
  renameGroup,
  deleteGroup,
  createTask,
  patchTask,
  deleteTask,
  moveTask,
  clearCompleted,
  setTaskAccount,
  taskAccount,
} from "../../lib/taskProviders";
import { setDefaultAccount } from "../../lib/accountsClient";
import { logAdminAction } from "../../lib/auditLog";

const todayISO = () => new Date().toISOString().slice(0, 10);

export const dueState = (due) => {
  if (!due) return null;
  const today = todayISO();
  if (due < today) return "overdue";
  if (due === today) return "today";
  return "later";
};

// Graded, not printed: "12 Oct" tells you nothing you can act on, and the
// whole point of a due date is whether it has passed.
export const dueLabel = (due) => {
  if (!due) return "";
  const today = todayISO();
  if (due === today) return "Today";
  const days = Math.round(
    (new Date(`${due}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000
  );
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days < 7) return `In ${days}d`;
  return new Date(`${due}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
};

// What the shelf header says. Counts come from the tasks themselves rather
// than being tracked separately, so the sentence cannot disagree with the
// board under it.
export function shelfSummary(tasks) {
  const open = tasks.filter((t) => !t.completed && !t.isStep);
  const overdue = open.filter((t) => dueState(t.due) === "overdue").length;
  const today = open.filter((t) => dueState(t.due) === "today").length;
  if (!open.length) return { tone: "clear", text: "Nothing open." };
  if (overdue) {
    return {
      tone: "overdue",
      text: `${overdue} overdue${today ? `, ${today} due today` : ""} · ${open.length} open`,
    };
  }
  if (today) return { tone: "today", text: `${today} due today · ${open.length} open` };
  return { tone: "clear", text: `${open.length} open, nothing due yet` };
}

/* ================= lenses ================= */

// Two hundred tasks across fourteen lists is not something you look at, it is
// something you search. A lens narrows the WHOLE board — both accounts, every
// list — and the count beside each lens comes from the same predicate as the
// rows under it, so the number cannot promise what the board then fails to show.
export const LENSES = [
  ["all", "Everything"],
  ["overdue", "Overdue"],
  ["week", "Due within 7 days"],
];

const daysFromToday = (due) =>
  Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 86400000);

export function matchesLens(task, lens, query = "") {
  if (lens === "overdue" && dueState(task.due) !== "overdue") return false;
  if (lens === "week") {
    if (!task.due) return false;
    const d = daysFromToday(task.due);
    if (d < 0 || d > 7) return false;
  }
  // Every word must appear, so a second word narrows instead of widening.
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${task.title || ""} ${task.notes || ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function lensCounts(tasks) {
  const open = tasks.filter((t) => !t.completed && !t.isStep);
  return Object.fromEntries(
    LENSES.map(([k]) => [k, open.filter((t) => matchesLens(t, k)).length])
  );
}

// The rows of one list that survive a lens. A parent stays when one of its
// subtasks matched, so a hit is never shown orphaned from the task it belongs to.
export function narrowRows(rows, { lens, query, showDone }) {
  const hit = (t) => (showDone || !t.completed) && matchesLens(t, lens, query);
  const keep = new Set(rows.filter(hit).map((t) => t.id));
  for (const t of rows) if (t.parent && keep.has(t.id)) keep.add(t.parent);
  return rows.filter((t) => keep.has(t.id));
}

export function LensBar({ lens, onLens, query, onQuery, counts }) {
  return (
    <div className="tk-lens" role="search">
      <input
        className="admin-input tk-find"
        type="search"
        placeholder="Find a task"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onQuery("")}
        aria-label="Find a task in every list"
      />
      <div className="tk-lens-set" role="group" aria-label="Show">
        {LENSES.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`tk-lens-item${lens === k ? " on" : ""}`}
            aria-pressed={lens === k}
            onClick={() => onLens(k)}
          >
            {/* The blog rail's highlighter, reused: the one bold gesture in
                this admin means "this is the one you are looking at". */}
            <span className="tk-lens-mark" aria-hidden="true" />
            <span className="tk-lens-text">{label}</span>
            <span className={`tk-lens-n${k === "overdue" && counts[k] ? " late" : ""}`}>
              {counts[k] ?? 0}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ================= the panel ================= */

export default function TasksPanel({ user }) {
  const [conns, setConns] = useState(null); // provider id -> status
  const [groups, setGroups] = useState({}); // provider -> group[]
  const [tasks, setTasks] = useState({}); // `${provider}:${groupId}` -> task[]
  const [err, setErr] = useState("");
  // The provider whose STORED connection the service has stopped accepting.
  // Held separately from `err` because this one failure has an action, and a
  // sentence telling you to go and press a button on the tab you are already
  // looking at is not one.
  const [dead, setDead] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  // Lists with nothing in them collapse to a name. These are the ones the
  // reader has asked to open anyway, keyed `provider:groupId`.
  const [opened, setOpened] = useState({});
  // True for the length of a drag, so every list is a column — and therefore a
  // drop target — while one is in the air.
  const [dragging, setDragging] = useState(false);
  const dragged = useRef(null);
  const [lens, setLens] = useState("all");
  const [query, setQuery] = useState("");
  const filtering = lens !== "all" || query.trim() !== "";

  const key = (provider, groupId) => `${provider}:${groupId}`;
  const rowsOf = (provider, groupId) => {
    const rows = tasks[key(provider, groupId)] || [];
    return filtering ? narrowRows(rows, { lens, query, showDone }) : rows;
  };

  // Does this list get a column? It does if it holds anything worth the space
  // — open work, or completed work while completed work is being shown — or if
  // it was opened by hand. A drag in progress opens every list, because you
  // cannot drop a task onto a chip. Under a lens, only lists with a match.
  const shown = (provider, group) => {
    // `dragged` is a ref, so it cannot drive this on its own — a ref change
    // renders nothing, and the chips would still be chips at the moment you
    // need them to be drop targets.
    if (dragging) return true;
    const list = rowsOf(provider, group.id);
    if (filtering) return list.length > 0;
    if (opened[key(provider, group.id)]) return true;
    // `completed`, not `done`: the rows have no `done` field, so the old
    // check was true for every task and a list holding only finished work
    // took a full column to say "Nothing here".
    return showDone ? list.length > 0 : list.some((t) => !t.completed);
  };

  /* ---------------- connections ---------------- */

  const loadConnections = useCallback(async () => {
    const list = await connectionStatus();
    setConns(Object.fromEntries(list.map((p) => [p.provider, p])));
    return list;
  }, []);

  // Which account a shelf shows when nothing has been picked: the saved
  // default if there is one, otherwise the account the server said would act.
  // NOT simply the first in the list — that would show one account's lists
  // under another's name the moment the order changed.
  const defaultAccountId = (status) =>
    (status.accounts || []).find((a) => a.isDefault)?.accountId ||
    (status.accounts || []).find((a) => a.email && a.email === status.email)?.accountId ||
    (status.accounts || [])[0]?.accountId ||
    "";

  // The head says whose tasks these are. With several connected it must name
  // the SELECTED one, not whatever the status endpoint resolved — otherwise
  // the chips and the line above them disagree.
  const shelfAccountLabel = (status) => {
    const id = taskAccount(status.provider) || defaultAccountId(status);
    const a = (status.accounts || []).find((x) => x.accountId === id);
    return a?.label || a?.email || status.email || "connected";
  };

  const pickAccount = useCallback(
    async (provider, accountId, key) => {
      if (!setTaskAccount(provider, accountId)) return;
      // Picking here SAVES the choice rather than only switching this tab.
      // Two ideas — "acting as, for now" and "the default" — is exactly what
      // makes people ask which one they are using, so there is one control
      // and one meaning: what the board shows is what an unqualified MCP call
      // will act as too.
      //
      // `tasks` is one job served by two providers and holds ONE default, so
      // choosing on the Google shelf answers "which account do you mean" for
      // the job as a whole. A call that names microsoft is unaffected —
      // chooseAccount skips a default belonging to another provider.
      if (key) {
        try {
          await setDefaultAccount("tasks", key);
        } catch (e) {
          // The board can still act as this account for now; only the saved
          // part failed, and saying so beats a silent half-change.
          setErr(`Switched for now, but the default could not be saved: ${e.message}`);
        }
      }
      // The board on screen belongs to the previous account. Clearing it is
      // what stops one account's lists sitting under another's name while the
      // new ones load.
      setGroups((m) => ({ ...m, [provider]: [] }));
      setTasks((m) =>
        Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith(`${provider}:`)))
      );
      setDead((d) => (d === provider ? "" : d));
      setErr("");
      await refreshRef.current?.(provider);
    },
    []
  );

  const loadProvider = useCallback(async (provider) => {
    const gs = await listGroups(provider);
    setGroups((m) => ({ ...m, [provider]: gs }));
    // Every group at once: a board that fills in column by column while you
    // watch is worse than one that appears whole.
    const entries = await Promise.all(
      gs.map(async (g) => [`${provider}:${g.id}`, await listTasks(provider, g.id)])
    );
    setTasks((m) => ({ ...m, ...Object.fromEntries(entries) }));
  }, []);

  const refreshRef = useRef(null);

  const refresh = useCallback(
    async (only) => {
      setBusy("Loading your tasks…");
      try {
        const list = only ? Object.values(conns || {}) : await loadConnections();
        const live = list.filter((p) => p.connected && (!only || p.provider === only));
        await Promise.all(
          live.map((p) =>
            loadProvider(p.provider).catch((e) => {
              // A connection the service no longer accepts is not the same
              // kind of failure as a network blip: it cannot be retried, only
              // re-granted. Say which account, and offer the one action.
              if (String(e.code || "").startsWith("integration/")) {
                setDead((prev) => prev || p.provider);
                // A success line from the consent redirect would otherwise sit
                // directly under the failure, which reads as contradicting it.
                setMsg("");
              }
              setErr((prev) => prev || `${providerLabel(p.provider)}: ${e.message}`);
            })
          )
        );
      } catch (e) {
        setErr(e.message || "Could not read your accounts.");
      } finally {
        setBusy("");
      }
    },
    [conns, loadConnections, loadProvider]
  );
  refreshRef.current = refresh;

  // On load, and after the consent redirect lands back here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const connected = params.get("connected");
      const failed = params.get("connectError");

      if (failed) setErr(failed);
      if (connected) {
        setBusy(`Saving the ${providerLabel(connected)} connection…`);
        try {
          const rec = await finishConnect(connected);
          setMsg(
            // One line. The old copy explained the architecture ("It stays
            // connected — the MCP tools use it too") in a confirmation toast,
            // which is the one place nobody is reading about architecture.
            `${providerLabel(connected)} connected${rec?.email ? ` as ${rec.email}` : ""}.`
          );
          logAdminAction({
            action: "integration.connect",
            target: connected,
            detail: rec?.email || "",
            user,
          });
        } catch (e) {
          setErr(e.message || "That connection could not be saved.");
        }
      }
      // Clean the query so a refresh does not try to claim a spent cookie.
      if (connected || failed) {
        const url = new URL(window.location.href);
        ["connected", "connectError", "account"].forEach((k) => url.searchParams.delete(k));
        window.history.replaceState({}, "", url.toString());
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately once: this is the page-load sequence, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async (provider) => {
    setErr("");
    setDead("");
    setBusy(`Opening ${providerLabel(provider)}…`);
    try {
      await beginConnect(provider);
    } catch (e) {
      setBusy("");
      setErr(e.message || "Could not start the connection.");
    }
  };

  const unlink = async (provider) => {
    if (!window.confirm(`Disconnect ${providerLabel(provider)}? The MCP tools lose it too.`)) return;
    await disconnect(provider);
    forgetTokens();
    logAdminAction({ action: "integration.disconnect", target: provider, user });
    setGroups((m) => ({ ...m, [provider]: [] }));
    setMsg(`${providerLabel(provider)} disconnected.`);
    await loadConnections();
  };

  /* ---------------- writes ---------------- */

  const run = async (label, fn) => {
    setErr("");
    setDead("");
    setMsg("");
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setErr(e.message || "That did not work.");
    } finally {
      setBusy("");
    }
  };

  const addTask = (provider, groupId, draft) =>
    run("Adding…", async () => {
      await createTask(provider, groupId, draft);
      await reloadGroup(provider, groupId);
      logAdminAction({
        action: "task.create",
        target: `${provider}:${groupId}`,
        detail: draft.title,
        user,
      });
    });

  const reloadGroup = async (provider, groupId) => {
    const rows = await listTasks(provider, groupId);
    setTasks((m) => ({ ...m, [key(provider, groupId)]: rows }));
  };

  const toggle = (provider, groupId, task) =>
    run(task.completed ? "Reopening…" : "Completing…", async () => {
      // Optimistic: a tick that waits for a round trip feels broken.
      setTasks((m) => ({
        ...m,
        [key(provider, groupId)]: (m[key(provider, groupId)] || []).map((t) =>
          t.id === task.id ? { ...t, completed: !task.completed } : t
        ),
      }));
      await patchTask(provider, groupId, task.id, { completed: !task.completed });
      await reloadGroup(provider, groupId);
    });

  const saveTask = (provider, groupId, task, patch) =>
    run("Saving…", async () => {
      await patchTask(provider, groupId, task.id, patch);
      await reloadGroup(provider, groupId);
      setEditing(null);
    });

  const removeTask = (provider, groupId, task) =>
    run("Deleting…", async () => {
      await deleteTask(provider, groupId, task.id);
      await reloadGroup(provider, groupId);
      logAdminAction({
        action: "task.delete",
        target: `${provider}:${groupId}`,
        detail: task.title,
        user,
      });
    });

  const dropTask = (to) =>
    run("Moving…", async () => {
      const from = dragged.current;
      dragged.current = null;
      setDragOver(null);
      if (!from) return;
      if (from.provider === to.provider && from.groupId === to.groupId) return;

      const out = await moveTask(
        { provider: from.provider, listId: from.groupId },
        { provider: to.provider, listId: to.groupId },
        from.task
      );
      await reloadGroup(from.provider, from.groupId);
      await reloadGroup(to.provider, to.groupId);
      if (out.idChanged) {
        setMsg(
          from.provider === to.provider
            ? `Moved. ${providerLabel(to.provider)} has no move operation, so the task was recreated with a new id.`
            : `Moved to ${providerLabel(to.provider)}. It was recreated there, so it has a new id.`
        );
      }
      logAdminAction({
        action: "task.move",
        target: `${from.provider}:${from.groupId} → ${to.provider}:${to.groupId}`,
        detail: from.task.title,
        user,
      });
    });

  const addGroup = (provider) => {
    const title = window.prompt(`New list in ${providerLabel(provider)}:`);
    if (!title?.trim()) return;
    run("Creating…", async () => {
      await createGroup(provider, title.trim());
      await loadProvider(provider);
    });
  };

  const rename = (provider, group) => {
    const title = window.prompt("Rename this list:", group.title);
    if (!title?.trim() || title === group.title) return;
    run("Renaming…", async () => {
      await renameGroup(provider, group.id, title.trim());
      await loadProvider(provider);
    });
  };

  const removeGroup = (provider, group) => {
    const rows = tasks[key(provider, group.id)] || [];
    const n = rows.filter((t) => !t.isStep).length;
    if (
      !window.confirm(
        `Delete "${group.title}"${n ? ` and its ${n} task${n === 1 ? "" : "s"}` : ""}? There is no undo.`
      )
    )
      return;
    run("Deleting…", async () => {
      await deleteGroup(provider, group.id);
      await loadProvider(provider);
    });
  };

  const clearDone = (provider, group) =>
    run("Clearing…", async () => {
      const n = await clearCompleted(provider, group.id);
      await reloadGroup(provider, group.id);
      setMsg(n ? `Cleared ${n} completed task${n === 1 ? "" : "s"}.` : "Nothing was completed.");
    });

  /* ---------------- render ---------------- */

  const connected = useMemo(
    () => PROVIDERS.filter((p) => conns?.[p.id]?.connected),
    [conns]
  );
  const counts = useMemo(() => lensCounts(Object.values(tasks).flat()), [tasks]);

  return (
    <div className="tk-main">
      <div className="ops-head tk-head">
        <div>
          {/* No <h2>Tasks</h2> here: AdminShell already prints the section
              name as the page's h1, and the panel repeating it put the word
              twice on one screen, the second time smaller and greyer — which
              reads as a subheading that forgot its content. */}
          <p className="tk-sub">
            Google Tasks and Microsoft To Do, read and written in place. Nothing here is a copy.
          </p>
        </div>
        <div className="tk-actions">
          <label className="tk-toggle">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
            />
            Show completed
          </label>
          <button className="admin-ghost" type="button" onClick={() => refresh()} disabled={!!busy}>
            Refresh
          </button>
        </div>
      </div>

      {busy ? <p className="tk-busy">{busy}</p> : null}
      {err && !dead ? <p className="admin-err">{err}</p> : null}
      {dead ? (
        <div className="tk-dead">
          {/* The panel writes this, not the server. The server's wording ends
              "open the admin's Tasks tab and press Connect" — correct for an
              MCP client, absurd on the tab itself, next to the button. */}
          <p className="tk-dead-msg">
            {providerLabel(dead)} stopped accepting the saved connection. The permission was
            withdrawn, or it expired. Reconnecting is one consent screen and holds again.
          </p>
          <button type="button" className="admin-btn primary" onClick={() => connect(dead)}>
            Reconnect {providerLabel(dead)}
          </button>
        </div>
      ) : null}
      {/* Not while something is loading: "Loading your tasks…" sitting above
          "Google Tasks connected…" is two states claiming the present tense. */}
      {msg && !busy ? <p className="tk-ok">{msg}</p> : null}

      {connected.length ? (
        <LensBar lens={lens} onLens={setLens} query={query} onQuery={setQuery} counts={counts} />
      ) : null}

      {conns === null ? (
        <p className="tk-busy">Checking your accounts…</p>
      ) : (
        PROVIDERS.map((p) => {
          const status = conns[p.id] || { connected: false, detail: "" };
          const gs = groups[p.id] || [];
          const all = gs.flatMap((g) => tasks[key(p.id, g.id)] || []);
          const summary = shelfSummary(all);
          // A shelf whose load FAILED has no lists for the same reason it has
          // no tasks: nothing was read. Rendering it as a genuinely empty
          // account states something untrue — "no lists in this account yet"
          // about an account nobody could open, next to a banner saying so.
          const failed = dead === p.id;

          return (
            <section className="tk-shelf" key={p.id} data-provider={p.id}>
              <header className={`tk-shelf-head ${failed ? "" : summary.tone}`}>
                <div className="tk-shelf-who">
                  <h3>{p.label}</h3>
                  {status.connected ? (
                    <p>
                      <span className="tk-acct">{shelfAccountLabel(status)}</span>
                      <span className="tk-hair" aria-hidden="true" />
                      {failed ? (
                        <span className="tk-state tk-unread">Could not be read</span>
                      ) : (
                        <span className={`tk-state ${summary.tone}`}>{summary.text}</span>
                      )}
                    </p>
                  ) : (
                    <p className="tk-off">{status.detail}</p>
                  )}
                </div>
                <div className="tk-shelf-actions">
                  {status.connected ? (
                    <>
                      <button
                        className="admin-ghost"
                        type="button"
                        onClick={() => addGroup(p.id)}
                        /* Creating a list needs the same credential that just
                           failed, so offering it is offering an error. */
                        disabled={!!busy || failed}
                        title={failed ? "Reconnect this account first" : undefined}
                      >
                        New list
                      </button>
                      {/* The only route to a SECOND account. Without it the
                          header offered Connect while disconnected and then
                          only New list / Disconnect, so a second account was
                          reachable from the Accounts tab and nowhere near the
                          board it would appear on. */}
                      <button
                        className="admin-ghost"
                        type="button"
                        onClick={() => connect(p.id)}
                        disabled={!!busy}
                        title={`Connect another ${p.label} account`}
                      >
                        Add another
                      </button>
                      <button
                        className="admin-ghost"
                        type="button"
                        onClick={() => unlink(p.id)}
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      className="admin-primary"
                      type="button"
                      onClick={() => connect(p.id)}
                      disabled={!!busy || status.configured === false}
                    >
                      Connect {p.short}
                    </button>
                  )}
                </div>
              </header>

              {/* WHICH account this shelf is acting as.
                  Shown whenever the service is connected, INCLUDING with one
                  account — a chip row was hidden at one, which answered "can I
                  switch?" and never answered "whose list is this?". The head
                  line above names the account, but it reads as a label; a
                  control reads as a thing you can change, and that is the
                  question people actually arrive with.
                  A select rather than chips because this grows: two Google
                  accounts fit as chips, six do not, and a row that reflows to
                  three lines stops being scannable. */}
              {status.connected ? (
                <div className="tk-whose">
                  <label className="tk-whose-label" htmlFor={`acct-${p.id}`}>
                    Acting as
                  </label>
                  <select
                    id={`acct-${p.id}`}
                    className="tk-whose-select"
                    value={taskAccount(p.id) || defaultAccountId(status)}
                    disabled={!!busy || (status.accounts || []).length < 2}
                    onChange={(e) => {
                      const a = (status.accounts || []).find((x) => x.accountId === e.target.value);
                      pickAccount(p.id, e.target.value, a?.key);
                    }}
                  >
                    {(status.accounts || []).map((a) => (
                      <option key={a.accountId} value={a.accountId}>
                        {(a.label || a.email || a.accountId) +
                          (a.needsReconnect ? " — expired" : "") +
                          (a.isDefault ? " — default" : "")}
                      </option>
                    ))}
                  </select>
                  {/* The one account that cannot be used is worth saying out
                      loud here rather than at the moment a write fails. */}
                  {(status.accounts || []).find(
                    (a) => a.accountId === (taskAccount(p.id) || defaultAccountId(status))
                  )?.needsReconnect ? (
                    <span className="tk-whose-dead">Reconnect this account before writing to it.</span>
                  ) : null}
                  {(status.accounts || []).length < 2 ? (
                    <span className="tk-whose-only">
                      the only one connected — use <strong>Add another</strong> to connect a second
                    </span>
                  ) : (
                    <span className="tk-whose-only">saved, and used by the MCP tools too</span>
                  )}
                </div>
              ) : null}

              {status.connected ? (
                gs.length ? (
                  <>
                  <div className="tk-rail">
                    {gs.filter((g) => shown(p.id, g)).map((g) => (
                      <GroupColumn
                        key={g.id}
                        provider={p.id}
                        list={g}
                        tasks={rowsOf(p.id, g.id)}
                        showDone={showDone || filtering}
                        limit={filtering ? 0 : COLUMN_LIMIT}
                        busy={!!busy}
                        dropState={
                          dragOver === `${p.id}:${g.id}`
                            ? dragged.current && dragged.current.provider !== p.id
                              ? "cross"
                              : "same"
                            : null
                        }
                        draggedRef={dragged}
                        onDragging={setDragging}
                        onDragStateChange={setDragOver}
                        onDropTask={() => dropTask({ provider: p.id, groupId: g.id })}
                        onAdd={(groupId, draft) => addTask(p.id, groupId, draft)}
                        onToggle={(groupId, task) => toggle(p.id, groupId, task)}
                        onEdit={(groupId, task) => setEditing({ provider: p.id, groupId, task })}
                        onRemove={(groupId, task) => removeTask(p.id, groupId, task)}
                        onRename={() => rename(p.id, g)}
                        onDelete={() => removeGroup(p.id, g)}
                        onClearDone={() => clearDone(p.id, g)}
                      />
                    ))}
                  </div>
                  {/* An empty list is a name, not a column. Five of them side
                      by side, each repeating "Nothing here. Add the first task
                      below." under a full-size field, filled the first screen
                      with the word "nothing" and pushed eighteen real tasks in
                      the other account below the fold. Clicking one opens it
                      where it stands. */}
                  {filtering ? (
                    gs.some((g) => shown(p.id, g)) ? null : (
                      <p className="tk-empty">Nothing in {p.label} matches.</p>
                    )
                  ) : (
                    <QuietLists
                      lists={gs.filter((g) => !shown(p.id, g))}
                      onOpen={(g) => setOpened((m) => ({ ...m, [key(p.id, g.id)]: true }))}
                    />
                  )}
                  </>
                ) : failed ? (
                  <p className="tk-empty tk-empty-unread">
                    Nothing was read from this account, so whether it has lists is unknown.
                  </p>
                ) : (
                  <p className="tk-empty">
                    No lists in this account yet. Press New list to make the first one.
                  </p>
                )
              ) : null}
            </section>
          );
        })
      )}

      {editing ? (
        <TaskEditor
          provider={editing.provider}
          groupId={editing.groupId}
          task={editing.task}
          groups={groups[editing.provider] || []}
          onClose={() => setEditing(null)}
          onSave={(patch) => saveTask(editing.provider, editing.groupId, editing.task, patch)}
          onMove={(toGroupId) => {
            dragged.current = {
              provider: editing.provider,
              groupId: editing.groupId,
              task: editing.task,
            };
            setEditing(null);
            dropTask({ provider: editing.provider, groupId: toGroupId });
          }}
        />
      ) : null}

      <TasksStyles />
    </div>
  );
}

/* ================= one group ================= */

// The lists that hold nothing.
//
// Exported and rendered by /__taskspreview as well, because this is the state
// the board is in most of the time on a personal account — and a design
// reference that only ever shows full lists is a reference for the easy case.
export function QuietLists({ lists, onOpen }) {
  if (!lists.length) return null;
  return (
    <div className="tk-quiet">
      <span className="tk-quiet-label">Empty</span>
      {lists.map((g) => (
        <button key={g.id} type="button" className="tk-chip" onClick={() => onOpen(g)}>
          {g.title}
        </button>
      ))}
    </div>
  );
}

// A list of sixty tasks rendered whole is a scroll box inside a scroll box,
// eight times over. A column shows the first few in the list's own order and
// says how many more there are; a lens lifts the cap, because then every row
// on screen is one you asked for.
export const COLUMN_LIMIT = 8;

export function GroupColumn({
  provider = "google",
  list,
  tasks,
  showDone,
  limit = COLUMN_LIMIT,
  busy,
  dropState,
  onDragStateChange,
  draggedRef,
  onDragging,
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
  const [more, setMore] = useState(false);

  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);
  const shown = showDone ? [...open, ...done] : open;

  // Subtasks and steps hang off a parent id; render them under their parent
  // rather than as orphan rows, which is how both apps show them.
  const allRoots = shown.filter((t) => !t.parent);
  const capped = limit > 0 && !more && allRoots.length > limit;
  const roots = capped ? allRoots.slice(0, limit) : allRoots;
  const childrenOf = (id) => shown.filter((t) => t.parent === id);

  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd(list.id, { title: title.trim(), due, notes });
    setTitle("");
    setDue("");
    setNotes("");
    setExpanded(false);
  };

  return (
    <section
      className={`tk-col${dropState ? ` is-drop is-drop-${dropState}` : ""}`}
      data-list={list.id}
      data-provider={provider}
      onDragOver={(e) => {
        e.preventDefault();
        onDragStateChange(`${provider}:${list.id}`);
      }}
      onDragLeave={(e) => {
        // Only when the pointer truly left the column, not on the way between
        // two of its own children.
        if (!e.currentTarget.contains(e.relatedTarget)) onDragStateChange(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropTask();
      }}
    >
      <header className="tk-col-head">
        <h4 title={list.title}>{list.title}</h4>
        {open.filter((t) => !t.isStep).length > 0 ? (
          <span className="tk-count">{open.filter((t) => !t.isStep).length}</span>
        ) : null}
        <div className="tk-menu-wrap">
          <button
            type="button"
            className="tk-menu-btn"
            aria-haspopup="true"
            aria-expanded={menu}
            aria-label={`Actions for ${list.title}`}
            onClick={() => setMenu((v) => !v)}
          >
            <span aria-hidden="true">···</span>
          </button>
          {menu ? (
            <div className="tk-menu" role="menu" onMouseLeave={() => setMenu(false)}>
              <button
                type="button"
                role="menuitem"
                disabled={list.readOnlyName}
                title={
                  list.readOnlyName
                    ? "Microsoft's built-in lists cannot be renamed"
                    : undefined
                }
                onClick={() => {
                  setMenu(false);
                  onRename();
                }}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onClearDone();
                }}
              >
                Clear completed
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                disabled={list.readOnlyName}
                title={
                  list.readOnlyName
                    ? "Microsoft's built-in lists cannot be deleted"
                    : undefined
                }
                onClick={() => {
                  setMenu(false);
                  onDelete();
                }}
              >
                Delete list
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="tk-rows">
        {roots.length === 0 ? (
          <p className="tk-none">Nothing here. Add the first task below.</p>
        ) : (
          roots.map((t) => (
            <React.Fragment key={t.id}>
              <TaskRow
                task={t}
                listId={list.id}
                provider={provider}
                draggedRef={draggedRef}
                onDragging={onDragging}
                onToggle={onToggle}
                onEdit={onEdit}
                onRemove={onRemove}
              />
              {childrenOf(t.id).map((c) => (
                <TaskRow
                  key={c.id}
                  task={c}
                  listId={list.id}
                  provider={provider}
                  child
                  draggedRef={draggedRef}
                  onDragging={onDragging}
                  onToggle={onToggle}
                  onEdit={onEdit}
                  onRemove={onRemove}
                />
              ))}
            </React.Fragment>
          ))
        )}
        {limit > 0 && allRoots.length > limit ? (
          <button type="button" className="tk-more" onClick={() => setMore((v) => !v)}>
            {more ? "Show fewer" : `Show ${allRoots.length - limit} more`}
          </button>
        ) : null}
      </div>

      <form className={`tk-add${expanded ? " is-open" : ""}`} onSubmit={submit}>
        <input
          className="admin-input tk-add-title"
          placeholder="+ Add a task"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setExpanded(true)}
          disabled={busy}
          aria-label={`Add a task to ${list.title}`}
        />
        {expanded ? (
          <>
            <textarea
              className="admin-input tk-add-notes"
              placeholder="Details"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="tk-add-row">
              <input
                className="admin-input"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                aria-label="Due date"
              />
              <button className="admin-primary" type="submit" disabled={!title.trim()}>
                Add task
              </button>
            </div>
          </>
        ) : null}
      </form>

      {dropState ? (
        <p className={`tk-drop-note ${dropState}`} role="status">
          {dropState === "cross"
            ? `Recreated in ${providerLabel(provider)} with a new id`
            : "Move here"}
        </p>
      ) : null}
    </section>
  );
}

/* ================= one task ================= */

function TaskRow({ task, listId, provider, child, draggedRef, onDragging, onToggle, onEdit, onRemove }) {
  const state = dueState(task.due);
  return (
    <article
      className={`tk-row${child ? " is-child" : ""}${task.completed ? " is-done" : ""}`}
      draggable={!task.isStep}
      data-task={task.id}
      onDragStart={() => {
        draggedRef.current = { provider, groupId: listId, task };
        if (onDragging) onDragging(true);
      }}
      onDragEnd={() => {
        draggedRef.current = null;
        if (onDragging) onDragging(false);
      }}
    >
      <button
        type="button"
        className={`tk-tick${task.completed ? " on" : ""}`}
        aria-label={task.completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={() => onToggle(listId, task)}
      />
      <div className="tk-body" role="button" tabIndex={0} onClick={() => onEdit(listId, task)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onEdit(listId, task);
          }
        }}
      >
        <p className="tk-title">{task.title}</p>
        {task.notes ? <p className="tk-notes">{task.notes}</p> : null}
        {task.due ? <span className={`tk-due ${state}`}>{dueLabel(task.due)}</span> : null}
      </div>
      <button
        type="button"
        className="tk-del"
        aria-label={`Delete ${task.title}`}
        onClick={() => onRemove(listId, task)}
      >
        <span aria-hidden="true">×</span>
      </button>
    </article>
  );
}

/* ================= edit one task ================= */

function TaskEditor({ provider, groupId, task, groups, onClose, onSave, onMove }) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes || "");
  const [due, setDue] = useState(task.due || "");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const step = task.isStep;

  return (
    <div className="tk-scrim" onClick={onClose}>
      <div
        className="tk-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Edit task"
        onClick={(e) => e.stopPropagation()}
      >
        <h4>{step ? "Edit step" : "Edit task"}</h4>

        {step ? (
          <p className="tk-note-line">
            A step lives inside its task. It holds a title and a tick — details and a due date
            belong on the task itself.
          </p>
        ) : null}

        <label className="tk-field">
          <span>Title</span>
          <input className="admin-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        {!step ? (
          <>
            <label className="tk-field">
              <span>Details</span>
              <textarea
                className="admin-input"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <label className="tk-field">
              <span>Due</span>
              <input
                className="admin-input"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <label className="tk-field">
              <span>Move to list</span>
              <select
                className="admin-input"
                value={groupId}
                onChange={(e) => e.target.value !== groupId && onMove(e.target.value)}
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        <div className="tk-modal-actions">
          <button className="admin-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="admin-primary"
            type="button"
            onClick={() =>
              onSave(step ? { title } : { title, notes, due })
            }
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= styles ================= */

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
        color: var(--a-dim, #8b90a0);
        font-size: 13px;
        line-height: 1.5;
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
      /* A dead connection is the one failure on this panel with a fix, so it
         gets the fix rather than a sentence pointing at one. Red left edge,
         the same "state lives on the left edge" language as the rail and the
         content editor. */
      .tk-dead {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 10px 0;
        padding: 12px 14px;
        border: 1px solid rgba(220, 76, 70, 0.35);
        border-left: 2px solid #dc4c46;
        border-radius: 0 10px 10px 0;
        background: rgba(220, 76, 70, 0.07);
      }
      .tk-dead-msg {
        margin: 0;
        flex: 1 1 320px;
        min-width: 0;
        font-size: 12.5px;
        line-height: 1.55;
        color: #f0a9a5;
      }
      .tk-ok {
        margin: 10px 0;
        font-size: 12.5px;
        line-height: 1.5;
        color: var(--a-amber, #ffb020);
        max-width: 72ch;
      }

      /* ---- the lens: find, and narrow the whole board ---- */
      .tk-lens {
        display: flex;
        align-items: center;
        gap: 10px 22px;
        flex-wrap: wrap;
        margin: 16px 0 4px;
      }
      .tk-find {
        flex: 0 1 300px;
        min-width: 200px;
      }
      .tk-lens-set {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 18px;
      }
      .tk-lens-item {
        position: relative;
        display: inline-flex;
        align-items: baseline;
        gap: 7px;
        padding: 4px 2px;
        background: none;
        border: 0;
        font: inherit;
        font-size: 13px;
        color: var(--a-dim, #8b90a0);
        cursor: pointer;
      }
      .tk-lens-item:hover {
        color: var(--a-text, #e7e8ee);
      }
      .tk-lens-item.on {
        color: var(--a-text, #e7e8ee);
        font-weight: 600;
      }
      .tk-lens-text,
      .tk-lens-n {
        position: relative;
        z-index: 1;
      }
      .tk-lens-n {
        font-size: 12px;
        font-weight: 400;
        color: var(--a-dim, #7d8496);
        font-variant-numeric: tabular-nums;
      }
      .tk-lens-n.late {
        color: #ff9a9a;
      }
      /* The marker-pen swipe from the blog's contents rail, skewed and
         overrunning the words the way a real highlighter does. */
      .tk-lens-mark {
        position: absolute;
        left: -3px;
        right: -3px;
        top: 50%;
        height: 1.15em;
        transform: translateY(-50%) skewX(-9deg) scaleX(0);
        transform-origin: left center;
        background: var(--a-amber, #ffb020);
        opacity: 0.3;
        border-radius: 2px;
        transition: transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
      }
      .tk-lens-item.on .tk-lens-mark {
        transform: translateY(-50%) skewX(-9deg) scaleX(1);
      }
      .tk-lens-item:focus-visible {
        outline: 2px solid var(--a-amber, #ffb020);
        outline-offset: 3px;
        border-radius: 4px;
      }

      /* ---- the shelf: which account you are inside ---- */
      .tk-shelf {
        margin: 22px 0 0;
        border-top: 1px solid var(--a-line, #23262f);
        padding-top: 16px;
      }
      .tk-shelf-head {
        display: flex;
        align-items: flex-start;
        gap: 16px;
        flex-wrap: wrap;
        padding-left: 12px;
        border-left: 3px solid var(--a-line, #23262f);
      }
      /* The same graded language as the rail in AdminShell. */
      .tk-shelf-head.overdue {
        border-left-color: #a33b45;
      }
      .tk-shelf-head.today {
        border-left-color: var(--a-amber, #ffb020);
      }
      .tk-shelf-who {
        flex: 1;
        min-width: 0;
      }
      .tk-shelf-who h3 {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 17px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: var(--a-text, #e7e8ee);
      }
      .tk-shelf-who p {
        margin: 4px 0 0;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      /* Hairlines, not middots. */
      .tk-hair {
        width: 16px;
        height: 1px;
        background: var(--a-line, #2a2e38);
        flex: none;
      }
      .tk-state.overdue {
        color: #ff9a9a;
      }
      .tk-state.today {
        color: var(--a-amber, #ffb020);
      }
      .tk-off {
        max-width: 62ch;
        line-height: 1.5;
      }
      /* Which account this shelf is acting as. A control, not a label:
         "whose list is this" is the question people arrive with, and a select
         answers it and offers the change in the same object. */
      .tk-whose {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin: 0 0 14px;
      }
      .tk-whose-label {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
      }
      .tk-whose-select {
        background: var(--a-raise, #15171d);
        color: var(--a-text, #e7e8ee);
        border: 1px solid var(--a-line, #2b3040);
        /* The amber left edge this admin uses everywhere for "this is the
           one", kept so the control reads as part of the same system. */
        border-left: 3px solid var(--a-amber, #ffb020);
        border-radius: 9px;
        padding: 7px 10px;
        font: inherit;
        font-size: 12.5px;
        max-width: 320px;
      }
      .tk-whose-select:disabled {
        border-left-color: var(--a-line, #2b3040);
        color: var(--a-dim, #8b90a0);
        cursor: default;
      }
      .tk-whose-select:focus-visible {
        outline: 2px solid var(--a-amber, #ffb020);
        outline-offset: 2px;
      }
      .tk-whose-only {
        font-size: 11px;
        color: var(--a-dim, #6f7687);
      }
      .tk-whose-dead {
        font-size: 11.5px;
        color: #ff8a8a;
      }

      .tk-shelf-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      /* The quiet strip: lists that hold nothing. A name and a target, no
         card, no field, no repeated sentence. */
      .tk-quiet {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        /* Clear of the columns above it. Tight against them it reads as the
           last card's footer rather than as the shelf's own. */
        margin-top: 4px;
        padding: 10px 2px 2px;
      }
      .tk-quiet-label {
        margin-right: 2px;
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      .tk-chip {
        padding: 5px 11px;
        border: 1px dashed var(--a-line, #23262f);
        border-radius: 999px;
        background: transparent;
        color: var(--a-dim, #8b90a0);
        font: inherit;
        font-size: 12.5px;
        cursor: pointer;
        transition: color 0.12s, border-color 0.12s;
      }
      /* Dashed, and solid once it holds something — the same "dashed means not
         yet real" language the board already uses for a cross-service drag and
         the writing desk uses for an unpublished post. */
      .tk-chip:hover,
      .tk-chip:focus-visible {
        color: var(--a-fg, #eceef3);
        border-color: var(--a-accent, #ffb020);
        border-style: solid;
      }
      .tk-empty {
        margin: 14px 0 0 15px;
        font-size: 13px;
        color: var(--a-dim, #8b90a0);
      }
      /* Dashed, because the state is "unknown", not "empty" — the same
         dashed-means-unconfirmed language the board already uses for a drag
         that crosses services. */
      .tk-empty-unread {
        border-left: 1px dashed rgba(220, 76, 70, 0.45);
        padding-left: 11px;
        margin-left: 15px;
      }
      .tk-state.tk-unread {
        color: #f0a9a5;
      }

      /* ---- the column rail ---- */
      /* Wraps, never scrolls sideways.
         The rail used to be a horizontal strip, which put a long amber
         scrollbar across the page — the loudest object on a panel whose whole
         identity is "one amber accent, used for the thing you are acting on"
         — and clipped the last list mid-card. Sideways scrolling in an admin
         panel is where content goes to be forgotten. */
      .tk-rail {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
        align-content: start;
        gap: 12px;
        padding: 14px 2px 6px;
        /* Each column is its own height. Stretching them all to the tallest is
           the kanban default and it turns a list with one task into a tall
           empty box; the floor on .tk-rows keeps a short column a big enough
           target to drop onto, which is the only thing the stretch was buying. */
        align-items: flex-start;
      }
      .tk-col {
        min-width: 0;
        display: flex;
        flex-direction: column;
        background: var(--a-raise, #15171d);
        border: 1px solid var(--a-line, #23262f);
        border-radius: 12px;
        max-height: 70vh;
        position: relative;
        transition: border-color 0.12s ease, background 0.12s ease;
      }
      /* The one loud moment: the board answering "will it land here?" */
      .tk-col.is-drop-same {
        border-color: var(--a-amber, #ffb020);
        background: rgba(255, 176, 32, 0.06);
      }
      /* A different answer deserves a different mark. Dashed, because this one
         is not a move: the task is recreated and the original deleted. */
      .tk-col.is-drop-cross {
        border-style: dashed;
        border-color: var(--a-amber, #ffb020);
        background: rgba(255, 176, 32, 0.03);
      }
      .tk-drop-note {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 8px;
        margin: 0;
        font-size: 11px;
        text-align: center;
        color: #1a1300;
        background: var(--a-amber, #ffb020);
        border-radius: 6px;
        padding: 4px 6px;
      }
      .tk-drop-note.cross {
        background: none;
        color: var(--a-amber, #ffb020);
        border: 1px dashed rgba(255, 176, 32, 0.6);
      }

      .tk-col-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 11px 10px 9px 13px;
        border-bottom: 1px solid var(--a-line, #23262f);
      }
      .tk-col-head h4 {
        margin: 0;
        flex: 1;
        min-width: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 13.5px;
        font-weight: 600;
        color: var(--a-text, #e7e8ee);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* A number, not a pill: the circle around it was chrome that said
         "badge" and nothing about the count. */
      .tk-count {
        font-size: 12px;
        color: var(--a-dim, #7d8496);
        font-variant-numeric: tabular-nums;
      }
      .tk-menu-wrap {
        position: relative;
      }
      .tk-menu-btn {
        background: none;
        border: 0;
        color: var(--a-dim, #7d8496);
        font: inherit;
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 6px;
        line-height: 1;
      }
      .tk-menu-btn:hover {
        color: var(--a-text, #e7e8ee);
      }
      .tk-menu {
        position: absolute;
        right: 0;
        top: 100%;
        z-index: 30;
        min-width: 152px;
        background: var(--a-panel, #111319);
        border: 1px solid var(--a-line, #23262f);
        border-radius: 10px;
        padding: 5px;
        display: flex;
        flex-direction: column;
      }
      .tk-menu button {
        background: none;
        border: 0;
        text-align: left;
        font: inherit;
        font-size: 12.5px;
        color: var(--a-text, #e7e8ee);
        padding: 7px 9px;
        border-radius: 7px;
        cursor: pointer;
      }
      .tk-menu button:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.05);
      }
      .tk-menu button:disabled {
        color: #555b69;
        cursor: not-allowed;
      }
      .tk-menu button.danger:hover:not(:disabled) {
        color: #ff8a8a;
      }

      .tk-rows {
        overflow-y: auto;
        padding: 6px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
        min-height: 84px;
      }
      .tk-none {
        margin: 14px 8px;
        font-size: 12px;
        color: #5c6377;
      }

      /* A row, with its state on the left edge — the same language as the
         content editor and the blog's contents rail. */
      .tk-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 8px 8px 9px;
        border-radius: 8px;
        border-left: 2px solid transparent;
        cursor: grab;
      }
      .tk-row:hover {
        background: rgba(255, 255, 255, 0.03);
      }
      .tk-row.is-child {
        margin-left: 18px;
        border-left-color: var(--a-line, #2a2e38);
      }
      .tk-row.is-done .tk-title {
        text-decoration: line-through;
        color: #5c6377;
      }
      .tk-tick {
        margin-top: 2px;
        width: 15px;
        height: 15px;
        flex: none;
        border-radius: 50%;
        border: 1.5px solid #434959;
        background: none;
        cursor: pointer;
        padding: 0;
      }
      .tk-tick:hover {
        border-color: var(--a-amber, #ffb020);
      }
      .tk-tick.on {
        background: var(--a-amber, #ffb020);
        border-color: var(--a-amber, #ffb020);
      }
      .tk-body {
        flex: 1;
        min-width: 0;
        cursor: pointer;
      }
      .tk-title {
        margin: 0;
        font-size: 13px;
        line-height: 1.35;
        color: var(--a-text, #e7e8ee);
        overflow-wrap: anywhere;
      }
      .tk-notes {
        margin: 3px 0 0;
        font-size: 11.5px;
        line-height: 1.4;
        color: var(--a-dim, #7d8496);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .tk-due {
        display: inline-block;
        margin-top: 5px;
        font-size: 11px;
        color: var(--a-dim, #7d8496);
      }
      .tk-due.overdue {
        color: #ff8a8a;
      }
      .tk-due.today {
        color: var(--a-amber, #ffb020);
      }
      .tk-del {
        opacity: 0;
        background: none;
        border: 0;
        color: #6b7285;
        font-size: 15px;
        line-height: 1;
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 6px;
        transition: opacity 0.12s ease;
      }
      .tk-row:hover .tk-del,
      .tk-del:focus-visible {
        opacity: 1;
      }
      .tk-del:hover {
        color: #ff8a8a;
      }

      .tk-add {
        border-top: 1px solid var(--a-line, #23262f);
        padding: 6px;
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .tk-add-title {
        font-size: 13px;
      }
      /* At rest the add field is a line of text, not a boxed input repeated
         under every column; it becomes a field when you go to use it. */
      .tk-add:not(.is-open) .tk-add-title {
        background: transparent;
        border-color: transparent;
      }
      .tk-add:not(.is-open) .tk-add-title:hover {
        border-color: var(--a-line, #2a2e38);
      }
      .tk-more {
        align-self: flex-start;
        margin: 4px 0 2px 9px;
        padding: 3px 0;
        background: none;
        border: 0;
        border-bottom: 1px dashed var(--a-line, #3a3f4d);
        color: var(--a-dim, #8b90a0);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .tk-more:hover,
      .tk-more:focus-visible {
        color: var(--a-text, #e7e8ee);
        border-bottom-color: var(--a-amber, #ffb020);
      }
      .tk-add-notes {
        font-family: inherit;
        font-size: 12.5px;
      }
      .tk-add-row {
        display: flex;
        gap: 7px;
        align-items: center;
      }
      .tk-add-row .admin-input {
        flex: 1;
        min-width: 0;
      }

      .tk-scrim {
        position: fixed;
        inset: 0;
        z-index: 120;
        background: rgba(4, 5, 8, 0.72);
        display: grid;
        place-items: center;
        padding: 18px;
      }
      .tk-modal {
        width: min(460px, 100%);
        background: var(--a-panel, #111319);
        border: 1px solid var(--a-line, #23262f);
        border-radius: 14px;
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 13px;
        max-height: 88vh;
        overflow-y: auto;
      }
      .tk-modal h4 {
        margin: 0;
        font-size: 15px;
        color: var(--a-text, #e7e8ee);
        font-family: "Space Grotesk", sans-serif;
      }
      .tk-note-line {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--a-dim, #8b90a0);
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
          max-height: none;
        }
        .tk-rows {
          overflow-y: visible;
        }
        .tk-shelf-actions {
          width: 100%;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .tk-lens-mark,
        .tk-col,
        .tk-row .tk-del {
          transition: none;
        }
      }
    `}</style>
  );
}
