// Design reference for the Tasks board, rendered with the REAL GroupColumn so
// it cannot drift from the live panel.
//
// The panel needs two connected accounts, which makes the board impossible to
// look at — or to assert on — without signing in to both. This renders the same
// components against fixed data: no Google, no Microsoft, no network.
//
// It shows BOTH shelves, because the thing worth checking is the thing the
// screenshots cannot otherwise reach: that a drag within an account looks
// different from a drag across accounts, which is a different operation.
//
// 404s in production: it is a design tool, not a page.
import React, { useRef, useState } from "react";
import { GroupColumn, TasksStyles, shelfSummary } from "../components/admin/TasksPanel";

const iso = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const SHELVES = [
  {
    provider: "google",
    label: "Google Tasks",
    email: "ravikishan63392@gmail.com",
    lists: [
      { id: "l1", title: "My Tasks", provider: "google" },
      { id: "l2", title: "Portfolio", provider: "google" },
      { id: "l3", title: "Reading", provider: "google" },
    ],
  },
  {
    provider: "microsoft",
    label: "Microsoft To Do",
    email: "ravikishan63392@gmail.com",
    lists: [
      { id: "m1", title: "Tasks", provider: "microsoft", readOnlyName: true },
      { id: "m2", title: "Work", provider: "microsoft" },
    ],
  },
];

const SEED = {
  l1: [
    { id: "t1", title: "Interview platforms using Claude Code", completed: false, due: iso(-2) },
    {
      id: "t2",
      title: "Make a CLI for pch",
      completed: false,
      notes: "Start with the argument parser, then the config file.",
      due: iso(0),
    },
    { id: "t3", title: "Draft the parser", completed: false, parent: "t2" },
    { id: "t4", title: "Build AI engineering application", completed: false, due: iso(5) },
    { id: "t5", title: "Add book on portfolio", completed: true },
  ],
  l2: [
    {
      id: "t6",
      title: "Rewrite the About page in the systems voice",
      completed: false,
      notes: "It still reads like the old template.",
    },
    { id: "t7", title: "Regenerate the OG image", completed: false, due: iso(1) },
  ],
  l3: [{ id: "t8", title: "Designing Data-Intensive Applications — ch. 7", completed: false, due: iso(12) }],
  m1: [
    { id: "x1", title: "Renew the domain", completed: false, due: iso(3) },
    { id: "x2", title: "Check the backup ran", completed: false },
    { id: "x3", title: "Open the dashboard", completed: false, parent: "x2", isStep: true },
  ],
  m2: [{ id: "x4", title: "Send the invoice", completed: false, due: iso(-1) }],
};

export default function TasksPreview() {
  const [byList, setByList] = useState(SEED);
  const [showDone, setShowDone] = useState(true);
  const [dragOver, setDragOver] = useState(null);
  const dragged = useRef(null);

  const listsOf = (p) => SHELVES.find((s) => s.provider === p).lists;
  const providerOfList = (listId) =>
    SHELVES.find((s) => s.lists.some((l) => l.id === listId)).provider;

  // The harness moves tasks locally so drag and drop is genuinely exercisable.
  const drop = (toListId) => {
    const from = dragged.current;
    dragged.current = null;
    setDragOver(null);
    if (!from || from.groupId === toListId) return;
    setByList((m) => ({
      ...m,
      [from.groupId]: (m[from.groupId] || []).filter((t) => t.id !== from.task.id),
      [toListId]: [...(m[toListId] || []), from.task],
    }));
  };

  const toggle = (listId, task) =>
    setByList((m) => ({
      ...m,
      [listId]: m[listId].map((t) => (t.id === task.id ? { ...t, completed: !t.completed } : t)),
    }));

  const add = (listId, fields) =>
    setByList((m) => ({
      ...m,
      [listId]: [
        ...m[listId],
        {
          id: `new-${Date.now()}`,
          title: fields.title,
          notes: fields.notes || "",
          due: fields.due || "",
          completed: false,
        },
      ],
    }));

  const remove = (listId, task) =>
    setByList((m) => ({ ...m, [listId]: m[listId].filter((t) => t.id !== task.id) }));

  return (
    <main
      className="admin-main tk-main"
      style={{ background: "#08090d", minHeight: "100vh", padding: "88px 24px 24px" }}
    >
      <div className="ops-head tk-head">
        <div>
          <h3>Tasks</h3>
          <p className="admin-sub tk-sub">
            Your real Google Tasks and Microsoft To Do, side by side. Everything here saves
            straight to the account it sits in.
          </p>
        </div>
        <span className="tk-actions">
          <label className="tk-toggle">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
            />
            <span>Show completed</span>
          </label>
          <button className="admin-ghost" type="button">
            Refresh
          </button>
        </span>
      </div>

      {SHELVES.map((shelf) => {
        const all = shelf.lists.flatMap((l) => byList[l.id] || []);
        const summary = shelfSummary(all);
        return (
          <section className="tk-shelf" key={shelf.provider} data-provider={shelf.provider}>
            <header className={`tk-shelf-head ${summary.tone}`}>
              <div className="tk-shelf-who">
                <h3>{shelf.label}</h3>
                <p>
                  <span className="tk-acct">{shelf.email}</span>
                  <span className="tk-hair" aria-hidden="true" />
                  <span className={`tk-state ${summary.tone}`}>{summary.text}</span>
                </p>
              </div>
              <div className="tk-shelf-actions">
                <button className="admin-ghost" type="button">
                  New list
                </button>
                <button className="admin-ghost" type="button">
                  Disconnect
                </button>
              </div>
            </header>

            <div className="tk-rail">
              {shelf.lists.map((list) => (
                <GroupColumn
                  key={list.id}
                  provider={shelf.provider}
                  list={list}
                  tasks={byList[list.id] || []}
                  showDone={showDone}
                  busy={false}
                  dropState={
                    dragOver === `${shelf.provider}:${list.id}`
                      ? dragged.current && dragged.current.provider !== shelf.provider
                        ? "cross"
                        : "same"
                      : null
                  }
                  onDragStateChange={setDragOver}
                  draggedRef={dragged}
                  onDropTask={() => drop(list.id)}
                  onAdd={add}
                  onToggle={toggle}
                  onEdit={() => {}}
                  onRemove={remove}
                  onRename={() => {}}
                  onDelete={() => {}}
                  onClearDone={() => {}}
                />
              ))}
            </div>
          </section>
        );
      })}

      <TasksStyles />
      {/* The board borrows the admin's shared controls. */}
      <style jsx global>{`
        .admin-input {
          width: 100%;
          background: var(--a-void, #0d0e13);
          border: 1px solid var(--a-line, #2b3040);
          border-radius: 9px;
          color: var(--a-text, #e7e8ee);
          padding: 10px 12px;
          font: inherit;
          font-size: 13px;
        }
        .admin-input:focus {
          outline: none;
          border-color: var(--a-amber, #ffb020);
        }
        .admin-primary {
          background: var(--a-amber, #ffb020);
          color: #1a1300;
          border: none;
          border-radius: 9px;
          padding: 9px 14px;
          font: inherit;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        }
        .admin-ghost {
          background: none;
          border: 1px solid var(--a-line, #2b3040);
          border-radius: 9px;
          color: var(--a-text, #e7e8ee);
          padding: 9px 14px;
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }
        .admin-sub {
          color: var(--a-dim, #8b90a0);
          font-size: 12.5px;
          font-weight: 400;
        }
        .ops-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .ops-head h3 {
          margin: 0;
          font-size: 15px;
          color: #e7e8ee;
          font-family: "Space Grotesk", sans-serif;
        }
        body {
          margin: 0;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        }
      `}</style>
    </main>
  );
}

// Dev-only: a design tool, not a page.
export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
