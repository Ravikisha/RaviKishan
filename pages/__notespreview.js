// Design reference for the Notes panel, rendered with the REAL SourceStrip and
// Editor so it cannot drift from the live one.
//
// The panel needs four connections to show its four states, which makes it
// impossible to look at — or assert on — without them. This renders the same
// components against fixed data covering every state that matters:
//
//   local      connected, everything allowed
//   notion     connected, but cannot pin
//   trello     connected, but tags are read-only (labels are board objects)
//   obsidian   not connected, with its limits shown
//   keep       declared unavailable, with the evidence
//
// A preview showing only the happy source would prove nothing about the one
// thing this panel exists for: telling you what the place you are typing into
// cannot do.
//
// 404s in production: it is a design tool, not a page.
import React, { useMemo, useState } from "react";
import { SourceStrip, Editor, NotesStyles, capabilityLine } from "../components/admin/NotesPanel";
import { excerptOf } from "../lib/notesClient";

const CAPS = {
  local: { create: true, update: true, delete: true, tags: true, containers: true, pinned: true, archive: true },
  notion: { create: true, update: true, delete: true, tags: true, containers: true, pinned: false, archive: true },
  trello: { create: true, update: true, delete: true, tags: false, containers: true, pinned: false, archive: true },
  obsidian: { create: true, update: true, delete: true, tags: true, containers: true, pinned: true, archive: false },
  keep: { create: false, update: false, delete: false, tags: false, containers: false, pinned: false, archive: false },
};

const SOURCES = [
  { source: "local", label: "Notes here", available: true, connected: true, capabilities: CAPS.local, detail: "Always available. Stored here, in Firestore." },
  { source: "notion", label: "Notion", available: true, connected: true, capabilities: CAPS.notion, detail: "Notion is connected." },
  { source: "trello", label: "Trello", available: true, connected: true, capabilities: CAPS.trello, detail: "Trello is connected." },
  {
    source: "obsidian",
    label: "Obsidian",
    available: true,
    connected: false,
    capabilities: CAPS.obsidian,
    detail: "No Obsidian vault is configured. Set OBSIDIAN_VAULT_REPO to the repository holding the vault.",
    limits: [
      "Obsidian has NO cloud API — a vault is Markdown files on disk, and this deployment's filesystem is read-only at runtime. So the vault is read and written as a GitHub repository, which is how most people already sync one.",
      "Every write is a real commit on the default branch.",
    ],
  },
  {
    source: "keep",
    label: "Google Keep",
    available: false,
    connected: false,
    capabilities: CAPS.keep,
    detail:
      'Google Keep has no API for a personal account. The Keep API exists, but its own discovery document describes it as "used in an enterprise environment to manage Google Keep content and resolve issues identified by cloud security software" — it is a Google Workspace admin and DLP API, and it is not reachable from a personal gmail.com account at any tier.',
    alternative:
      "Use the built-in notes here, or Obsidian over a GitHub vault. Google Tasks is already connected in the Tasks tab for anything checklist-shaped.",
  },
];

const NOTES = {
  local: [
    {
      id: "1",
      title: "Why the recorder produced 110 bytes",
      body:
        "VP9 **plus** an explicit `videoBitsPerSecond` encodes a WebM header and no frames.\n\n- isTypeSupported says yes\n- onstop fires normally\n- the file is valid and empty",
      tags: ["debugging", "media"],
      container: "Engineering",
      containerName: "Engineering",
      pinned: true,
      archived: false,
      updatedAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
    },
    {
      id: "2",
      title: "Reading list",
      body: "Designing Data-Intensive Applications — chapter 7 next.",
      tags: ["reading"],
      container: "Personal",
      containerName: "Personal",
      pinned: false,
      archived: false,
      updatedAt: new Date(Date.now() - 3 * 86400e3).toISOString(),
    },
    {
      id: "3",
      title: "Old scratch",
      body: "Superseded by the rules-check script.",
      tags: [],
      containerName: "",
      pinned: false,
      archived: true,
      updatedAt: new Date(Date.now() - 40 * 86400e3).toISOString(),
    },
  ],
};

const NOTEBOOKS = [
  { id: "Engineering", name: "Engineering" },
  { id: "Personal", name: "Personal" },
];

export default function NotesPreview() {
  const [source, setSource] = useState("local");
  const [draft, setDraft] = useState({ ...NOTES.local[0], tags: [...NOTES.local[0].tags] });

  const current = useMemo(() => SOURCES.find((s) => s.source === source), [source]);
  const caps = current.capabilities;
  const notes = NOTES[source] || [];

  return (
    <main
      className="admin-main nt-main"
      style={{ background: "#08090d", minHeight: "100vh", padding: "88px 24px 24px" }}
    >
      <div className="ops-head">
        <div>
          <h3>Notes</h3>
          <p className="admin-sub nt-sub">
            One desk over four places. Everything saves straight to the place it came from.
          </p>
        </div>
        <span className="nt-actions">
          <button className="admin-ghost" type="button">
            Refresh
          </button>
          <button className="admin-primary" type="button">
            New note
          </button>
        </span>
      </div>

      <SourceStrip sources={SOURCES} value={source} onPick={setSource} busy={false} />

      {!current.connected ? (
        <div className="nt-blocked">
          <p>{current.detail}</p>
          {current.alternative ? <p className="nt-alt">{current.alternative}</p> : null}
          {(current.limits || []).map((l) => (
            <p className="nt-limit" key={l}>
              {l}
            </p>
          ))}
        </div>
      ) : (
        <div className="nt-grid">
          <aside className="nt-list">
            <form className="nt-search" onSubmit={(e) => e.preventDefault()}>
              <input className="admin-input" placeholder={`Search ${current.label}`} readOnly />
            </form>
            {notes.length === 0 ? (
              <p className="nt-none">No notes here yet. Press New note.</p>
            ) : (
              notes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`nt-row${draft?.id === n.id ? " on" : ""}${n.archived ? " archived" : ""}${
                    n.pinned ? " pinned" : ""
                  }`}
                  onClick={() => setDraft({ ...n, tags: [...n.tags] })}
                >
                  <span className="nt-row-title">{n.title}</span>
                  <span className="nt-row-ex">{excerptOf(n.body) || "—"}</span>
                  <span className="nt-row-meta">
                    {n.containerName ? <em>{n.containerName}</em> : null}
                    {n.tags.slice(0, 3).map((t) => (
                      <i key={t}>{t}</i>
                    ))}
                    <span className="nt-when">
                      {Math.round((Date.now() - Date.parse(n.updatedAt)) / 86400000) < 1
                        ? "Today"
                        : `${Math.round((Date.now() - Date.parse(n.updatedAt)) / 86400000)}d ago`}
                    </span>
                  </span>
                </button>
              ))
            )}
          </aside>

          <section className="nt-editor">
            <Editor
              draft={draft}
              caps={caps}
              source={source}
              notebooks={NOTEBOOKS}
              busy={false}
              readOnly={false}
              onEdit={(patch) => setDraft((d) => ({ ...d, ...patch }))}
              onSave={() => {}}
              onDelete={() => {}}
            />
          </section>
        </div>
      )}

      <NotesStyles />
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
