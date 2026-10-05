// Design reference for the Tasks board, rendered with the REAL GroupColumn so
// it cannot drift from the live panel.
//
// The panel itself needs a Google Tasks session, which makes the board
// impossible to look at — or to assert on — without signing in. This renders
// the same components against fixed data: no Google, no network.
//
// 404s in production: it is a design tool, not a page.
import React, { useRef, useState } from "react";
import { GroupColumn, TasksStyles } from "../components/admin/TasksPanel";

const today = new Date().toISOString().slice(0, 10);
const shift = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.toISOString().slice(0, 10)}T00:00:00.000Z`;
};

const LISTS = [
  { id: "l1", title: "My Tasks" },
  { id: "l2", title: "Portfolio" },
  { id: "l3", title: "Reading" },
];

const SEED = {
  l1: [
    { id: "t1", title: "Interview platforms using Claude Code", status: "needsAction", due: shift(-2) },
    { id: "t2", title: "Make a CLI for pch", status: "needsAction", notes: "Start with the argument parser, then the config file.", due: `${today}T00:00:00.000Z` },
    { id: "t3", title: "Draft the parser", status: "needsAction", parent: "t2" },
    { id: "t4", title: "Build AI engineering application", status: "needsAction", due: shift(5) },
    { id: "t5", title: "Add book on portfolio", status: "completed" },
  ],
  l2: [
    { id: "t6", title: "Rewrite the About page in the systems voice", status: "needsAction", notes: "It still reads like the old template." },
    { id: "t7", title: "Regenerate the OG image", status: "needsAction", due: shift(1) },
  ],
  l3: [
    { id: "t8", title: "Designing Data-Intensive Applications — ch. 7", status: "needsAction", due: shift(12) },
  ],
};

export default function TasksPreview() {
  const [byList, setByList] = useState(SEED);
  const [showDone, setShowDone] = useState(true);
  const [dragOver, setDragOver] = useState(null);
  const dragged = useRef(null);

  // The harness moves tasks locally so drag and drop is genuinely exercisable.
  const moveToList = (fromListId, task, toListId) =>
    setByList((m) => ({
      ...m,
      [fromListId]: (m[fromListId] || []).filter((t) => t.id !== task.id),
      [toListId]: [...(m[toListId] || []), task],
    }));

  const toggle = (listId, task) =>
    setByList((m) => ({
      ...m,
      [listId]: m[listId].map((t) =>
        t.id === task.id
          ? { ...t, status: t.status === "completed" ? "needsAction" : "completed" }
          : t
      ),
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
          due: fields.due ? `${fields.due}T00:00:00.000Z` : undefined,
          status: "needsAction",
        },
      ],
    }));

  const remove = (listId, task) =>
    setByList((m) => ({ ...m, [listId]: m[listId].filter((t) => t.id !== task.id) }));

  return (
    <main className="admin-main tk-main" style={{ background: "#08090d", minHeight: "100vh", padding: "88px 24px 24px" }}>
      <div className="ops-head tk-head">
        <div>
          <h3>
            Tasks{" "}
            <span className="admin-sub">
              {Object.values(byList).flat().filter((t) => t.status !== "completed").length} open ·{" "}
              {Object.values(byList).flat().filter((t) => t.status === "completed").length} done ·{" "}
              {LISTS.length} groups
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
          <button className="admin-ghost" type="button">New group</button>
          <button className="admin-ghost" type="button">Refresh</button>
        </span>
      </div>

      <div className="tk-board">
        {LISTS.map((list) => (
          <GroupColumn
            key={list.id}
            list={list}
            tasks={byList[list.id] || []}
            showDone={showDone}
            busy=""
            isDropTarget={dragOver === list.id}
            onDragStateChange={setDragOver}
            draggedRef={dragged}
            onDropTask={moveToList}
            onAdd={add}
            onToggle={toggle}
            onEdit={() => {}}
            onRemove={remove}
            onRename={() => {}}
            onDelete={() => {}}
            onClearDone={() => {}}
          />
        ))}
        <button className="tk-newgroup" type="button">
          <span>+</span> New group
        </button>
      </div>

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

export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
