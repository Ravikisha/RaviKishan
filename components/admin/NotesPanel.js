// Notes, in the admin — one desk over four places.
//
// DESIGN
//
// The hard part is not listing notes. It is that four services disagree about
// what a note IS, and every disagreement is silent: Trello has no free-text
// tags (its labels are board-scoped objects), Notion cannot pin, a vault
// cannot archive, and Google Keep cannot be reached at all from a personal
// account. A panel that renders the same five controls for all of them teaches
// you to expect something that will be dropped.
//
// So the SOURCE STRIP is the organising element, and it carries a sentence —
// what this place can do, and what it cannot. You switch source rarely but you
// must know instantly which one you are writing into, because that is what
// decides whether the tag you just typed survives. Controls a source cannot
// honour are disabled WITH THE REASON, in place, rather than hidden: a missing
// control teaches nothing, a disabled one with a sentence teaches once.
//
// Google Keep is shown in the strip, greyed, with its reason. Leaving it out
// would read as an oversight to anyone who went looking for it; showing it as
// a button that 403s would be a lie.
//
// Everything else is the console's existing language: one amber accent for the
// selected row, state on the left edge, hairlines rather than middots.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SOURCES,
  sourceLabel,
  listSources,
  listNotebooks,
  listNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  searchNotes,
  excerptOf,
} from "../../lib/notesClient";
import { logAdminAction } from "../../lib/auditLog";

const dayLabel = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(Number(d))) return "";
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
};

// What to do about a source that is not connected.
//
// "Not connected yet." is a dead end: it names a state and offers no route out,
// and the route is genuinely non-obvious for both of these — Trello's key lives
// behind a Power-Up you have to create, and Notion issues no client id at all
// until the integration is made public. So the steps are real steps, in order,
// with the thing you cannot guess spelled out.
//
// A SEQUENCE, so it is numbered — the one case where numbered markers carry
// information rather than decorating a list.
export function SourceSetup({ setup, label }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  if (!setup?.steps?.length) return null;

  return (
    <div className="nt-setup">
      <h4>Connecting {label}</h4>
      {setup.why ? <p className="nt-why">{setup.why}</p> : null}

      <ol className="nt-steps">
        {setup.steps.map((step, i) => (
          <li key={step.title}>
            <span className="nt-step-n">{i + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
              {step.link ? (
                <a className="nt-step-link" href={step.link} target="_blank" rel="noreferrer noopener">
                  {step.link.replace(/^https?:\/\//, "")}
                </a>
              ) : null}
              {step.uris?.length ? (
                <ul className="nt-uris">
                  {step.uris.flatMap((path) =>
                    ["https://www.ravikishan.me", "https://ravikishan.me", origin || "http://localhost:3000"]
                      // The origin this is served from may already be in the
                      // list; a duplicate reads as a mistake in the steps.
                      .filter((o, n, all) => o && all.indexOf(o) === n)
                      .map((o) => (
                        <li key={o + path}>
                          <code>{o + path}</code>
                        </li>
                      ))
                  )}
                </ul>
              ) : null}
              {step.env?.length ? (
                <p className="nt-env">
                  {step.env.map((e) => (
                    <code key={e}>{e}</code>
                  ))}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {setup.warning ? <p className="nt-warn">{setup.warning}</p> : null}
    </div>
  );
}

// The sentence under the source strip. Built from the capabilities the server
// declares, so it cannot claim something the adapter does not do.
export function capabilityLine(source) {
  if (!source) return "";
  // Deliberately SHORT for an unavailable source. The full reason belongs in
  // the panel below, where there is room to read it — printing it here as well
  // put the same paragraph on screen twice.
  if (!source.available) return "Not available from a personal account — see below.";
  if (!source.connected) return "Not connected yet.";
  const c = source.capabilities || {};
  const can = [];
  if (c.tags) can.push("tags");
  if (c.containers) can.push("notebooks");
  if (c.pinned) can.push("pinning");
  if (c.archive) can.push("archive");
  const cannot = [];
  if (!c.tags) cannot.push("no tags");
  if (!c.pinned) cannot.push("no pinning");
  if (!c.archive) cannot.push("no archive");
  const left = can.length ? can.join(", ") : "notes only";
  return cannot.length ? `${left} · ${cannot.join(", ")}` : left;
}

/* ================= the panel ================= */

export default function NotesPanel({ user }) {
  const [sources, setSources] = useState(null);
  const [source, setSource] = useState("local");
  const [notebooks, setNotebooks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [truncated, setTruncated] = useState(null);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const dirty = useRef(false);

  const current = useMemo(
    () => (sources || []).find((s) => s.source === source) || null,
    [sources, source]
  );
  const caps = current?.capabilities || {};

  /* ---------------- loading ---------------- */

  useEffect(() => {
    listSources()
      .then((j) => {
        setSources(j.sources);
        setSource(j.default || "local");
      })
      .catch((e) => setErr(e.message));
  }, []);

  const load = useCallback(
    async (which) => {
      setBusy("Reading notes…");
      setErr("");
      try {
        const [{ notes: rows, truncated: cut }, books] = await Promise.all([
          listNotes(which, { withBodies: which === "local" }),
          listNotebooks(which).catch(() => []),
        ]);
        setNotes(rows);
        setTruncated(cut || null);
        setNotebooks(books);
      } catch (e) {
        setNotes([]);
        setErr(e.message);
      } finally {
        setBusy("");
      }
    },
    []
  );

  useEffect(() => {
    if (!current?.connected) {
      setNotes([]);
      setNotebooks([]);
      return;
    }
    load(source);
    setSelected(null);
    setDraft(null);
  }, [source, current?.connected, load]);

  /* ---------------- selection ---------------- */

  const open = async (note) => {
    if (dirty.current && !window.confirm("Discard unsaved changes to this note?")) return;
    setBusy("Opening…");
    try {
      // The list carries bodies for some sources and not others, so the note is
      // always re-read on open: an editor showing a body the list happened to
      // have is an editor that sometimes opens empty.
      const full = await getNote(source, note.id);
      setSelected(full);
      setDraft({ ...full });
      dirty.current = false;
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const startNew = () => {
    setSelected(null);
    setDraft({
      id: "",
      title: "",
      body: "",
      tags: [],
      container: notebooks[0]?.id || "",
      pinned: false,
      archived: false,
      source,
    });
    dirty.current = true;
  };

  const edit = (patch) => {
    dirty.current = true;
    setDraft((d) => ({ ...d, ...patch }));
  };

  /* ---------------- writes ---------------- */

  const run = async (label, fn) => {
    setBusy(label);
    setErr("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setErr(e.message || "That did not work.");
    } finally {
      setBusy("");
    }
  };

  const save = () =>
    run("Saving…", async () => {
      const patch = { title: draft.title, body: draft.body };
      if (caps.tags) patch.tags = draft.tags;
      if (caps.containers) patch.container = draft.container;
      if (caps.pinned) patch.pinned = draft.pinned;

      const note = draft.id
        ? await updateNote(source, draft.id, patch)
        : await createNote(source, patch);

      dirty.current = false;
      setSelected(note);
      setDraft({ ...note });
      await load(source);
      setMsg(draft.id ? "Saved." : "Note created.");
      logAdminAction({
        action: draft.id ? "note.update" : "note.create",
        target: `${source}:${note.id}`,
        detail: note.title,
        user,
      });
    });

  const remove = () =>
    run("Deleting…", async () => {
      const what =
        source === "notion"
          ? "Archive this page? Notion has no hard delete, so it can be restored from its trash."
          : source === "trello"
          ? "Delete this card permanently? Trello has no undo for this."
          : source === "obsidian"
          ? "Commit a deletion of this file in the vault repository?"
          : "Delete this note?";
      if (!window.confirm(what)) return;
      await deleteNote(source, draft.id);
      dirty.current = false;
      setSelected(null);
      setDraft(null);
      await load(source);
      setMsg("Deleted.");
      logAdminAction({ action: "note.delete", target: `${source}:${draft.id}`, detail: draft.title, user });
    });

  const runSearch = () =>
    run("Searching…", async () => {
      if (!q.trim()) return load(source);
      setNotes(await searchNotes(source, q.trim()));
    });

  /* ---------------- render ---------------- */

  if (sources === null) {
    return (
      <div className="nt-main">
        <p className="nt-busy">Checking where your notes live…</p>
        <NotesStyles />
      </div>
    );
  }

  return (
    <div className="nt-main">
      <div className="ops-head">
        <div>
          <h3>Notes</h3>
          <p className="admin-sub nt-sub">
            One desk over four places. Everything saves straight to the place it came from.
          </p>
        </div>
        <span className="nt-actions">
          <button className="admin-ghost" type="button" onClick={() => load(source)} disabled={!!busy}>
            Refresh
          </button>
          <button
            className="admin-primary"
            type="button"
            onClick={startNew}
            disabled={!!busy || !current?.connected}
          >
            New note
          </button>
        </span>
      </div>

      <SourceStrip sources={sources} value={source} onPick={setSource} busy={!!busy} />

      {busy ? <p className="nt-busy">{busy}</p> : null}
      {err ? <p className="admin-err">{err}</p> : null}
      {msg ? <p className="nt-ok">{msg}</p> : null}

      {!current?.connected ? (
        <div className="nt-blocked">
          <p>{current?.detail}</p>
          {current?.alternative ? <p className="nt-alt">{current.alternative}</p> : null}
          {(current?.limits || []).map((l) => (
            <p className="nt-limit" key={l}>
              {l}
            </p>
          ))}
          <SourceSetup setup={current?.setup} label={current?.label} />
        </div>
      ) : (
        <div className="nt-grid">
          <aside className="nt-list">
            <form
              className="nt-search"
              onSubmit={(e) => {
                e.preventDefault();
                runSearch();
              }}
            >
              <input
                className="admin-input"
                placeholder={`Search ${sourceLabel(source)}`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search notes"
              />
            </form>

            {truncated ? (
              <p className="nt-truncated">
                Showing the first {notes.length} of {truncated.total}. Narrow the vault with
                OBSIDIAN_VAULT_FOLDER, or search instead of browsing.
              </p>
            ) : null}

            {notes.length === 0 ? (
              <p className="nt-none">
                {q.trim() ? "Nothing matched." : "No notes here yet. Press New note."}
              </p>
            ) : (
              notes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`nt-row${draft?.id === n.id ? " on" : ""}${n.archived ? " archived" : ""}${
                    n.pinned ? " pinned" : ""
                  }`}
                  onClick={() => open(n)}
                >
                  <span className="nt-row-title">{n.title || "Untitled"}</span>
                  <span className="nt-row-ex">{excerptOf(n.body) || "—"}</span>
                  <span className="nt-row-meta">
                    {n.containerName ? <em>{n.containerName}</em> : null}
                    {n.tags.slice(0, 3).map((t) => (
                      <i key={t}>{t}</i>
                    ))}
                    <span className="nt-when">{dayLabel(n.updatedAt)}</span>
                  </span>
                </button>
              ))
            )}
          </aside>

          <section className="nt-editor">
            {!draft ? (
              <p className="nt-empty">
                Pick a note on the left, or press New note. This is the one place that keeps
                working when every other service is down.
              </p>
            ) : (
              <Editor
                draft={draft}
                caps={caps}
                source={source}
                notebooks={notebooks}
                busy={!!busy}
                readOnly={!!selected?.readOnly}
                warning={selected?.warning}
                onEdit={edit}
                onSave={save}
                onDelete={draft.id ? remove : null}
              />
            )}
          </section>
        </div>
      )}

      <NotesStyles />
    </div>
  );
}

/* ================= the source strip ================= */

export function SourceStrip({ sources, value, onPick, busy }) {
  const current = sources.find((s) => s.source === value);
  return (
    <div className="nt-strip">
      <div className="nt-tabs" role="tablist" aria-label="Where notes live">
        {SOURCES.map((s) => {
          const row = sources.find((x) => x.source === s.id);
          const unusable = !row || row.available === false;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={value === s.id}
              className={`nt-tab${value === s.id ? " on" : ""}${unusable ? " off" : ""}${
                row && !row.connected && !unusable ? " idle" : ""
              }`}
              onClick={() => onPick(s.id)}
              disabled={busy}
              title={unusable ? row?.detail : undefined}
            >
              {s.label}
              {row && row.connected ? <i className="nt-dot" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      {/* What this place can and cannot do, before you type into it. */}
      <p className={`nt-caps${current && current.available === false ? " off" : ""}`}>
        {capabilityLine(current)}
      </p>
    </div>
  );
}

/* ================= the editor ================= */

export function Editor({ draft, caps, source, notebooks, busy, readOnly, warning, onEdit, onSave, onDelete }) {
  const [tagDraft, setTagDraft] = useState("");

  const addTag = (raw) => {
    const t = String(raw).trim();
    if (!t || draft.tags.includes(t)) return;
    onEdit({ tags: [...draft.tags, t] });
  };

  // Why a control is off, in the control's own place. A hidden field teaches
  // nothing; a disabled one with a sentence teaches once.
  const why = {
    tags:
      source === "trello"
        ? "Trello labels are board-wide objects, not free text — they are read-only here."
        : "This source has no tags.",
    pinned: "Notion has no pin in its API.",
    containers: "This source is flat.",
  };

  return (
    <>
      {readOnly ? (
        <p className="nt-readonly">
          {warning || "This note cannot be written from here."}
        </p>
      ) : null}

      <input
        className="nt-title"
        value={draft.title}
        placeholder="Title"
        onChange={(e) => onEdit({ title: e.target.value })}
        disabled={readOnly}
        aria-label="Note title"
      />

      <textarea
        className="admin-input nt-body"
        value={draft.body}
        placeholder="Markdown. This is the note."
        rows={18}
        onChange={(e) => onEdit({ body: e.target.value })}
        disabled={readOnly}
        aria-label="Note body"
      />

      <div className="nt-fields">
        <div className="nt-field">
          <span>
            Tags
            {!caps.tags ? <em>{why.tags}</em> : null}
          </span>
          <div className={`nt-tags${caps.tags ? "" : " off"}`}>
            {draft.tags.map((t) => (
              <span className="nt-tag" key={t}>
                {t}
                {caps.tags ? (
                  <button
                    type="button"
                    aria-label={`Remove ${t}`}
                    onClick={() => onEdit({ tags: draft.tags.filter((x) => x !== t) })}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
            {caps.tags ? (
              <input
                className="nt-tag-input"
                value={tagDraft}
                placeholder="Add a tag"
                disabled={readOnly}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(tagDraft);
                    setTagDraft("");
                  } else if (e.key === "Backspace" && !tagDraft && draft.tags.length) {
                    onEdit({ tags: draft.tags.slice(0, -1) });
                  }
                }}
              />
            ) : null}
          </div>
        </div>

        {caps.containers ? (
          <label className="nt-field">
            <span>Notebook</span>
            <select
              className="admin-input"
              value={draft.container || ""}
              disabled={readOnly}
              onChange={(e) => onEdit({ container: e.target.value })}
            >
              <option value="">(none)</option>
              {notebooks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {caps.pinned ? (
          <label className="nt-toggle">
            <input
              type="checkbox"
              checked={!!draft.pinned}
              disabled={readOnly}
              onChange={(e) => onEdit({ pinned: e.target.checked })}
            />
            Pin to the top
          </label>
        ) : null}
      </div>

      <div className="nt-editor-actions">
        {onDelete ? (
          <button className="nt-delete" type="button" onClick={onDelete} disabled={busy}>
            Delete
          </button>
        ) : null}
        <button className="admin-primary" type="button" onClick={onSave} disabled={busy || readOnly}>
          {draft.id ? "Save note" : "Create note"}
        </button>
      </div>
    </>
  );
}

/* ================= styles ================= */

export function NotesStyles() {
  return (
    <style jsx global>{`
      .nt-main {
        max-width: none;
      }
      .nt-sub {
        margin: 6px 0 0;
        max-width: 62ch;
        line-height: 1.5;
      }
      .nt-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .nt-busy {
        margin: 10px 0;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
      }
      .nt-ok {
        margin: 10px 0;
        font-size: 12.5px;
        color: var(--a-amber, #ffb020);
      }

      /* ---- the source strip ---- */
      .nt-strip {
        margin: 16px 0 14px;
        border-bottom: 1px solid var(--a-line, #23262f);
        padding-bottom: 10px;
      }
      .nt-tabs {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .nt-tab {
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 999px;
        color: var(--a-dim, #8b90a0);
        padding: 6px 13px;
        font: inherit;
        font-size: 12.5px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 7px;
      }
      .nt-tab.on {
        border-color: var(--a-amber, #ffb020);
        color: var(--a-text, #e7e8ee);
      }
      /* Declared unusable — shown, not hidden, so its absence is never read as
         an oversight. */
      .nt-tab.off {
        opacity: 0.45;
        border-style: dashed;
      }
      .nt-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #4ade80;
      }
      .nt-caps {
        margin: 9px 0 0;
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
      }
      .nt-caps.off {
        color: #d8757f;
        max-width: 90ch;
        line-height: 1.55;
      }

      .nt-blocked {
        margin: 18px 0;
        max-width: 80ch;
        display: grid;
        gap: 10px;
      }
      .nt-blocked p {
        margin: 0;
        font-size: 13px;
        line-height: 1.6;
        color: var(--a-dim, #8b90a0);
      }
      .nt-alt {
        color: var(--a-text, #e7e8ee) !important;
      }
      .nt-limit {
        padding-left: 12px;
        border-left: 2px solid var(--a-line, #2a2e38);
        font-size: 12.5px !important;
      }

      /* ---- list + editor ---- */
      .nt-grid {
        display: grid;
        grid-template-columns: minmax(260px, 340px) 1fr;
        gap: 16px;
        align-items: start;
      }
      .nt-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 72vh;
        overflow-y: auto;
        padding-right: 2px;
      }
      .nt-search {
        position: sticky;
        top: 0;
        z-index: 2;
        background: var(--a-void, #0b0c10);
        padding-bottom: 6px;
      }
      .nt-truncated,
      .nt-none,
      .nt-empty {
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
        line-height: 1.55;
        padding: 10px 2px;
        margin: 0;
      }
      .nt-empty {
        max-width: 48ch;
        padding: 40px 0;
      }

      .nt-row {
        display: grid;
        gap: 3px;
        text-align: left;
        background: var(--a-raise, #15171d);
        border: 1px solid var(--a-line, #23262f);
        border-left: 2px solid transparent;
        border-radius: 9px;
        padding: 9px 11px;
        font: inherit;
        color: inherit;
        cursor: pointer;
      }
      .nt-row:hover {
        background: rgba(255, 255, 255, 0.03);
      }
      /* The one amber thing: the note you are editing. */
      .nt-row.on {
        border-left-color: var(--a-amber, #ffb020);
      }
      .nt-row.pinned .nt-row-title::before {
        content: "▲ ";
        color: var(--a-amber, #ffb020);
        font-size: 9px;
      }
      .nt-row.archived {
        opacity: 0.55;
      }
      .nt-row-title {
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
        font-weight: 500;
      }
      .nt-row-ex {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .nt-row-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        font-size: 10.5px;
        color: #5c6377;
      }
      .nt-row-meta em,
      .nt-row-meta i {
        font-style: normal;
      }
      .nt-row-meta i {
        border: 1px solid var(--a-line, #2a2e38);
        border-radius: 999px;
        padding: 1px 6px;
      }
      .nt-when {
        margin-left: auto;
      }

      .nt-editor {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
      }
      .nt-readonly {
        margin: 0;
        padding: 9px 12px;
        border-radius: 8px;
        border: 1px solid rgba(255, 176, 32, 0.4);
        color: var(--a-amber, #ffb020);
        font-size: 12px;
        line-height: 1.5;
      }
      /* The title is typed at title size in the display face — the same idea as
         the writing desk: it is the one thing you read back. */
      .nt-title {
        background: none;
        border: 0;
        border-bottom: 1px solid var(--a-line, #23262f);
        color: var(--a-text, #e7e8ee);
        font-family: "Space Grotesk", sans-serif;
        font-size: 22px;
        font-weight: 600;
        letter-spacing: -0.02em;
        padding: 4px 0 8px;
        outline: none;
        width: 100%;
      }
      .nt-title:focus {
        border-bottom-color: var(--a-amber, #ffb020);
      }
      .nt-body {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12.5px;
        line-height: 1.6;
        resize: vertical;
      }
      .nt-fields {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
        align-items: flex-start;
      }
      .nt-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 220px;
        flex: 1;
      }
      .nt-field > span {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .nt-field > span em {
        font-style: normal;
        color: #5c6377;
      }
      .nt-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 9px;
        padding: 7px 8px;
        background: var(--a-void, #0d0e13);
        min-height: 38px;
      }
      .nt-tags.off {
        opacity: 0.6;
        border-style: dashed;
      }
      .nt-tag {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11.5px;
        color: var(--a-text, #e7e8ee);
        background: rgba(255, 255, 255, 0.05);
        border-radius: 999px;
        padding: 3px 4px 3px 9px;
      }
      .nt-tag button {
        background: none;
        border: 0;
        color: var(--a-dim, #7d8496);
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
        padding: 0 4px;
      }
      .nt-tag-input {
        flex: 1;
        min-width: 110px;
        background: none;
        border: 0;
        outline: none;
        color: var(--a-text, #e7e8ee);
        font: inherit;
        font-size: 12.5px;
      }
      .nt-toggle {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
        margin-top: 22px;
      }
      .nt-editor-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: flex-end;
      }
      .nt-delete {
        margin-right: auto;
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        color: var(--a-dim, #8b90a0);
        border-radius: 9px;
        padding: 9px 14px;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .nt-delete:hover {
        border-color: #a33b45;
        color: #ff8a8a;
      }

      @media (max-width: 900px) {
        .nt-grid {
          grid-template-columns: 1fr;
        }
        .nt-list {
          max-height: 40vh;
        }
      }
    
      /* ---------- how to connect a source ---------- */
      .nt-setup {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--a-line, #2b3040);
        max-width: 78ch;
      }
      .nt-setup h4 {
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: 14px;
        margin: 0;
        color: var(--a-text, #e7e8ee);
      }
      .nt-why {
        margin: 8px 0 0;
        font-size: 12px;
        line-height: 1.65;
        color: var(--a-dim, #8b90a0);
      }
      .nt-steps {
        list-style: none;
        margin: 16px 0 0;
        padding: 0;
      }
      .nt-steps li {
        display: flex;
        gap: 12px;
        padding: 0 0 16px;
      }
      /* The steps ARE a sequence, which is the one case where a number
         carries information rather than decorating a list. */
      .nt-step-n {
        flex: none;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 1px solid var(--a-line, #2b3040);
        display: grid;
        place-items: center;
        font-size: 11px;
        color: var(--a-dim, #8b90a0);
      }
      .nt-steps strong {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: var(--a-text, #e7e8ee);
      }
      .nt-steps p {
        margin: 4px 0 0;
        font-size: 12px;
        line-height: 1.65;
        color: var(--a-dim, #8b90a0);
      }
      .nt-step-link {
        display: inline-block;
        margin-top: 6px;
        font-size: 11.5px;
        color: #ffb020;
        text-decoration: none;
      }
      .nt-step-link:hover {
        text-decoration: underline;
      }
      .nt-uris {
        list-style: none;
        margin: 8px 0 0;
        padding: 0;
      }
      .nt-uris li {
        display: block;
        padding: 3px 0;
      }
      .nt-setup code {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11px;
        color: var(--a-text, #e7e8ee);
        overflow-wrap: anywhere;
      }
      .nt-env code {
        margin-right: 12px;
      }
      .nt-warn {
        margin: 4px 0 0;
        padding-left: 11px;
        border-left: 2px solid #ffb020;
        font-size: 11.5px;
        line-height: 1.65;
        color: var(--a-dim, #8b90a0);
      }
`}</style>
  );
}
