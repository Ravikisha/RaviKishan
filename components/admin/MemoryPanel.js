// Memory — what the agents have been taught, and the one place to correct it.
//
// DESIGN
//
// A memory list is read to answer two questions: "what does it think it knows
// about me?" and "which of those is wrong?". Both are about the SENTENCES, so
// the sentence is the largest thing on every row and everything else — kind,
// layer, tags, how often it was used, where it came from — is one quiet line
// under it.
//
// THE ONE BOLD THING is the left edge, and its WEIGHT is the memory's
// confidence: a hairline for something an agent guessed once, a thick bar for
// something the owner said and then said again. Scanning the edge is scanning
// how sure the system is, which is exactly where a wrong memory hides — a thin
// edge on a sentence you disagree with is a guess to delete; a thick one is a
// belief to correct. The edge is the console's neutral ink, never amber:
// amber means "the selected one" everywhere in this admin, so it appears only
// on the row being edited. An archived memory's edge is dashed, the same
// "not live" language as the Tasks and Writing panels.
//
// Two layers, said plainly: a memory is either "You" (true in every org) or
// belongs to the org you are in. Another org's memories are never listed —
// the server does not return them — so the layer filter has two choices, not
// a list of orgs.
//
// "What would an agent be told?" runs the REAL recall for a task and shows the
// ranked result. It counts as a use, like any recall, and says so.
//
// Search and the filters run in the browser through memoryShape's own
// `rankMemories`, the same scorer the server uses, so the panel and an MCP
// search cannot disagree about what matches.
//
// Every part is exported so /__memorypreview renders THESE components against
// a deliberately unflattering seed instead of a copy of their markup.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { KINDS, KIND_INFO, MAX_TEXT, looksSecret, rankMemories } from "../../lib/server/memoryShape";
import { forgetMemory, listMemories, recallFor, rememberMemory, updateMemory } from "../../lib/memoryClient";

const DAY = 86400000;
// A memory nobody has recalled for this long is worth a look: either it is
// wrong, or the tags it carries are not the words tasks use.
export const STALE_DAYS = 90;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const d = Math.floor((now - t) / DAY);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 31) return `${d} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} yr ago`;
}

export const isStale = (m, now = Date.now()) => {
  const t = Date.parse(m.lastUsedAt || m.createdAt || "");
  return !m.archived && Number.isFinite(t) && now - t > STALE_DAYS * DAY;
};

// Confidence to edge weight: 1px for a guess, 6px for certain.
export const edgeOf = (c) => `${1 + Math.round(Math.max(0, Math.min(1, c)) * 5)}px`;

const layerName = (m, orgId) => (m.scope === "global" ? "You" : m.orgId || orgId);

/* ------------------------------------------------------------------ *
 * Headline                                                            *
 * ------------------------------------------------------------------ */

export function MemoryHeadline({ memories, orgId, now = Date.now() }) {
  const live = memories.filter((m) => !m.archived);
  const global = live.filter((m) => m.scope === "global").length;
  const stale = live.filter((m) => isStale(m, now)).length;
  const guesses = live.filter((m) => m.confidence < 0.5).length;
  if (!live.length) {
    return (
      <div className="mm-top">
        <p className="mm-state">
          Nothing remembered in <strong>{orgId}</strong> yet. Write the first thing an agent should know
          below, or let one file what it learns with <span className="mono">reflect</span> at the end of a job.
        </p>
      </div>
    );
  }
  return (
    <div className="mm-top">
      <p className="mm-state">
        <strong>{plural(live.length, "memory", "memories")}</strong> reach agents working in{" "}
        <strong>{orgId}</strong>: {live.length - global} for this org, {global} about you in every org.
        {guesses ? ` ${plural(guesses, "is a guess", "are guesses")} (under 50% sure).` : ""}
        {stale ? ` ${plural(stale, "has", "have")} not been recalled in ${STALE_DAYS} days.` : ""}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Remember                                                            *
 * ------------------------------------------------------------------ */

export function RememberForm({ orgId, onRemember }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState("preference");
  // The current org, like the server's own default. Global was the default
  // here, so a client fact typed in "acme" without touching the control was
  // handed to every agent in every org. Global is a choice you make.
  const [scope, setScope] = useState("org");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // Checked as you type with the server's own rule, so a pasted key is
  // refused before it is sent anywhere — not after a round trip.
  const secret = looksSecret(text);
  const over = text.length > MAX_TEXT;

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() || secret.secret || over) return;
    setBusy(true);
    setMsg(null);
    try {
      const out = await onRemember({ text, kind, scope, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) });
      setMsg({
        ok: true,
        text:
          out.action === "updated"
            ? `That was already remembered, so it was reinforced (now ${Math.round(out.memory.confidence * 100)}% sure) rather than filed twice.`
            : out.conflict
            ? `Remembered beside “${String(out.conflict.text || "").slice(0, 90)}”, which it seems to contradict. Both are kept; archive the old one if this replaces it.`
            : "Remembered.",
      });
      setText("");
      setTags("");
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mm-new" onSubmit={submit}>
      <label className="mm-sr" htmlFor="mm-new-text">
        Something every agent should know
      </label>
      <textarea
        id="mm-new-text"
        className="mm-new-text"
        rows={2}
        placeholder="Something every agent should know — one sentence, e.g. “Never announce a launch before the deploy is live.”"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mm-new-row">
        <select className="mm-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" title={KIND_INFO[kind]}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <div className="mm-seg" role="radiogroup" aria-label="Who it is true for">
          <button type="button" role="radio" aria-checked={scope === "org"} className={scope === "org" ? "on" : ""} onClick={() => setScope("org")}>
            Only {orgId}
          </button>
          <button type="button" role="radio" aria-checked={scope === "global"} className={scope === "global" ? "on" : ""} onClick={() => setScope("global")}>
            You, every org
          </button>
        </div>
        <input className="mm-input mm-tags" placeholder="tags, comma separated" value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Tags" />
        <button className="mm-go" type="submit" disabled={busy || !text.trim() || secret.secret || over}>
          {busy ? "Remembering…" : "Remember"}
        </button>
      </div>
      {secret.secret ? (
        <p className="mm-refuse" role="alert">
          That looks like {secret.reason}. Memory is read into prompts on purpose, so credentials go in Secrets and
          only their name goes here.
        </p>
      ) : over ? (
        <p className="mm-refuse">
          {text.length} of {MAX_TEXT} characters — a memory is one fact. Put the long version in Notes and remember where it is.
        </p>
      ) : (
        <p className="mm-hint">{KIND_INFO[kind]}</p>
      )}
      {msg ? <p className={msg.ok ? "mm-ok" : "mm-err"}>{msg.text}</p> : null}
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Filters                                                             *
 * ------------------------------------------------------------------ */

export function MemoryFilters({ orgId, query, setQuery, layer, setLayer, kind, setKind, archived, setArchived, counts }) {
  const layers = [
    ["all", "Everything"],
    ["global", "You"],
    ["org", orgId],
  ];
  return (
    <div className="mm-filters">
      <input
        className="mm-input mm-search"
        type="search"
        placeholder="Find a memory — every word must match"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search memories"
      />
      <div className="mm-chips" role="group" aria-label="Layer">
        {layers.map(([id, label]) => (
          <button key={id} type="button" className={`mm-chip${layer === id ? " on" : ""}`} aria-pressed={layer === id} onClick={() => setLayer(id)}>
            {label}
            <span className="mm-n">{counts.layer[id] || 0}</span>
          </button>
        ))}
      </div>
      <div className="mm-chips" role="group" aria-label="Kind">
        <button type="button" className={`mm-chip${!kind ? " on" : ""}`} aria-pressed={!kind} onClick={() => setKind("")}>
          Any kind
        </button>
        {KINDS.filter((k) => counts.kind[k]).map((k) => (
          <button key={k} type="button" title={KIND_INFO[k]} className={`mm-chip${kind === k ? " on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(kind === k ? "" : k)}>
            {k}
            <span className="mm-n">{counts.kind[k]}</span>
          </button>
        ))}
        <label className="mm-arch">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived too
          {counts.archived ? <span className="mm-n">{counts.archived}</span> : null}
        </label>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A row                                                               *
 * ------------------------------------------------------------------ */

export function MemoryRow({ m, orgId, open, onToggle, onSave, onForget, now = Date.now() }) {
  const [draft, setDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setDraft({ text: m.text, kind: m.kind, scope: m.scope, tags: m.tags.join(", "), confidence: m.confidence });
    } else {
      setDraft(null);
      setConfirmDelete(false);
      setErr("");
    }
  }, [open, m]);

  const run = async (fn) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(() =>
      onSave(m.id, {
        text: draft.text,
        kind: draft.kind,
        scope: draft.scope,
        tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
        confidence: Number(draft.confidence),
      })
    );

  const secret = draft ? looksSecret(draft.text) : { secret: false };
  const stale = isStale(m, now);

  return (
    <li
      className={`mm-row${open ? " open" : ""}${m.archived ? " gone" : ""}`}
      style={{ "--mm-edge": edgeOf(m.confidence) }}
    >
      <button type="button" className="mm-hit" onClick={onToggle} aria-expanded={open}>
        <span className="mm-text">{m.text}</span>
        <span className="mm-meta">
          <span>{m.kind}</span>
          <span className={m.scope === "global" ? "mm-you" : ""}>{layerName(m, orgId)}</span>
          <span title="How sure the system is — the weight of the left edge">{Math.round(m.confidence * 100)}% sure</span>
          <span className={stale ? "mm-stale" : ""}>
            {m.uses ? `recalled ${plural(m.uses, "time")}, last ${ago(m.lastUsedAt, now)}` : "never recalled"}
          </span>
          {m.tags.length ? <span>{m.tags.map((t) => `#${t}`).join(" ")}</span> : null}
          {m.archived ? <span>{m.supersededBy ? "replaced" : "archived"}</span> : null}
        </span>
      </button>

      {open && draft ? (
        <div className="mm-edit">
          <textarea
            className="mm-new-text"
            rows={3}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            aria-label="Memory text"
          />
          {secret.secret ? <p className="mm-refuse">That looks like {secret.reason} — it cannot be saved here.</p> : null}
          <div className="mm-new-row">
            <select className="mm-select" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} aria-label="Kind">
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <div className="mm-seg" role="radiogroup" aria-label="Who it is true for">
              <button type="button" role="radio" aria-checked={draft.scope === "global"} className={draft.scope === "global" ? "on" : ""} onClick={() => setDraft({ ...draft, scope: "global" })}>
                You, every org
              </button>
              <button type="button" role="radio" aria-checked={draft.scope === "org"} className={draft.scope === "org" ? "on" : ""} onClick={() => setDraft({ ...draft, scope: "org" })}>
                Only {orgId}
              </button>
            </div>
            <input className="mm-input mm-tags" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} aria-label="Tags" placeholder="tags" />
            <label className="mm-conf">
              <span>{Math.round(draft.confidence * 100)}% sure</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={draft.confidence}
                onChange={(e) => setDraft({ ...draft, confidence: Number(e.target.value) })}
                aria-label="Confidence"
              />
            </label>
          </div>

          <p className="mm-prov">
            Learned from <span className="mono">{m.source || "unknown"}</span>
            {m.createdAt ? `, ${ago(m.createdAt, now)}` : ""}
            {m.reinforced ? `, heard again ${plural(m.reinforced, "time")}` : ""}
            {m.lastSource ? (
              <>
                {" "}
                (latest from <span className="mono">{m.lastSource}</span>)
              </>
            ) : null}
            .{m.context ? ` In the context of: “${m.context}”` : ""}
            {m.supersededBy ? (
              <>
                {" "}
                Replaced by <span className="mono">{m.supersededBy}</span>.
              </>
            ) : null}{" "}
            <span className="mono mm-id">{m.id}</span>
          </p>

          <div className="mm-actions">
            <button type="button" className="mm-go" disabled={busy || secret.secret || !draft.text.trim()} onClick={save}>
              {busy ? "Saving…" : "Save changes"}
            </button>
            {m.archived ? (
              <button type="button" className="mm-ghost" disabled={busy} onClick={() => run(() => onSave(m.id, { archived: false }))}>
                Restore
              </button>
            ) : (
              <button type="button" className="mm-ghost" disabled={busy} onClick={() => run(() => onForget(m.id, false))}>
                Archive
              </button>
            )}
            {confirmDelete ? (
              <>
                <span className="mm-warn">Deleted for good — there is no copy.</span>
                <button type="button" className="mm-danger" disabled={busy} onClick={() => run(() => onForget(m.id, true))}>
                  Delete it
                </button>
                <button type="button" className="mm-ghost" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className="mm-ghost mm-red" disabled={busy} onClick={() => setConfirmDelete(true)}>
                Delete…
              </button>
            )}
          </div>
          {err ? <p className="mm-err">{err}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * What would an agent be told?                                        *
 * ------------------------------------------------------------------ */

export function RecallProbe({ onRecall, initial = null }) {
  const [task, setTask] = useState(initial?.task || "");
  const [out, setOut] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const go = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      setOut(await onRecall(task));
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="mm-probe" open={!!initial}>
      <summary>What would an agent be told?</summary>
      <form className="mm-new-row" onSubmit={go}>
        <input
          className="mm-input mm-grow"
          placeholder="Describe a task, e.g. write a LinkedIn post about the container runtime"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          aria-label="Task"
        />
        <button className="mm-go" type="submit" disabled={busy}>
          {busy ? "Recalling…" : "Recall"}
        </button>
      </form>
      <p className="mm-hint">Runs the same recall an agent gets at the start of a job, so it counts as a use.</p>
      {err ? <p className="mm-err">{err}</p> : null}
      {out ? (
        out.memories.length ? (
          <ol className="mm-recalled">
            {out.memories.map((m) => (
              <li key={m.id} style={{ "--mm-edge": edgeOf(m.confidence) }}>
                <span>{m.text}</span>
                <span className="mm-meta">
                  <span>{m.scope === "global" ? "You" : m.orgId}</span>
                  <span>{m.kind}</span>
                  <span>score {m.score}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mm-hint">Nothing would be recalled for that — the agent would start knowing nothing about it.</p>
        )
      ) : null}
    </details>
  );
}

/* ------------------------------------------------------------------ *
 * The panel                                                           *
 * ------------------------------------------------------------------ */

export function useMemoryView(memories) {
  const [query, setQuery] = useState("");
  const [layer, setLayer] = useState("all");
  const [kind, setKind] = useState("");
  const [archived, setArchived] = useState(false);

  const counts = useMemo(() => {
    const live = memories.filter((m) => archived || !m.archived);
    const c = { layer: { all: live.length, global: 0, org: 0 }, kind: {}, archived: memories.filter((m) => m.archived).length };
    for (const m of live) {
      c.layer[m.scope === "global" ? "global" : "org"]++;
      c.kind[m.kind] = (c.kind[m.kind] || 0) + 1;
    }
    return c;
  }, [memories, archived]);

  const shown = useMemo(() => {
    const pool = memories.filter((m) => layer === "all" || (layer === "global" ? m.scope === "global" : m.scope === "org"));
    const q = query.trim();
    if (q.length >= 2) {
      return rankMemories(pool, q, { mode: "all", kinds: kind ? [kind] : [], includeArchived: archived, limit: 200 });
    }
    return pool
      .filter((m) => (archived || !m.archived) && (!kind || m.kind === kind))
      .sort((a, b) => Number(a.archived) - Number(b.archived) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }, [memories, query, layer, kind, archived]);

  return { query, setQuery, layer, setLayer, kind, setKind, archived, setArchived, counts, shown };
}

export function MemoryList({ shown, orgId, openId, setOpenId, onSave, onForget, now }) {
  if (!shown.length) {
    return <p className="mm-wait">Nothing matches. Clear the search or the filters, or remember it above.</p>;
  }
  return (
    <ul className="mm-list">
      {shown.map((m) => (
        <MemoryRow
          key={m.id}
          m={m}
          orgId={orgId}
          open={openId === m.id}
          onToggle={() => setOpenId(openId === m.id ? "" : m.id)}
          onSave={onSave}
          onForget={onForget}
          now={now}
        />
      ))}
    </ul>
  );
}

export default function MemoryPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      setData(await listMemories({ includeArchived: true, limit: 500 }));
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const memories = data?.memories || [];
  const orgId = data?.orgId || "relax";
  const view = useMemoryView(memories);

  const onRemember = async (m) => {
    const out = await rememberMemory(m);
    await load();
    return out;
  };
  const onSave = async (id, patch) => {
    await updateMemory(id, patch);
    await load();
  };
  const onForget = async (id, confirm) => {
    await forgetMemory(id, { confirm });
    setOpenId("");
    await load();
  };

  return (
    <div className="mm">
      {err ? <p className="mm-err" role="alert">{err}</p> : null}
      {!data && !err ? <p className="mm-wait">Reading what has been remembered…</p> : null}
      {data ? (
        <>
          <MemoryHeadline memories={memories} orgId={orgId} />
          <RememberForm orgId={orgId} onRemember={onRemember} />
          <RecallProbe onRecall={(task) => recallFor(task)} />
          <MemoryFilters orgId={orgId} {...view} />
          <MemoryList shown={view.shown} orgId={orgId} openId={openId} setOpenId={setOpenId} onSave={onSave} onForget={onForget} />
          {data.truncated ? <p className="mm-hint">Showing the newest {memories.length} of {data.total}.</p> : null}
        </>
      ) : null}
      <MemoryStyles />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Styles                                                              *
 * ------------------------------------------------------------------ */

export function MemoryStyles() {
  return (
    <style jsx global>{`
      .mm {
        --mm-line: var(--a-line, #1e222c);
        --mm-dim: var(--a-dim, #7d8496);
        --mm-text: var(--a-text, #e9ebf2);
        --mm-amber: var(--a-amber, #ffb020);
        --mm-raise: var(--a-raise, #171a22);
        --mm-ink: #c9cdd8;
        padding: 0 20px 28px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        color: var(--mm-text);
        min-width: 0;
      }
      .mm .mono {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11.5px;
      }
      .mm-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .mm-wait,
      .mm-hint {
        color: var(--mm-dim);
        font-size: 12.5px;
        margin: 0;
        max-width: 74ch;
        line-height: 1.55;
      }
      .mm-err,
      .mm-refuse {
        color: #ff6b6b;
        font-size: 12.5px;
        margin: 0;
        max-width: 74ch;
        line-height: 1.55;
      }
      .mm-ok {
        margin: 0;
        font-size: 12.5px;
        padding-left: 10px;
        border-left: 2px solid var(--mm-amber);
      }

      /* status line */
      .mm-state {
        margin: 0;
        max-width: 74ch;
        font-size: 13px;
        line-height: 1.6;
        color: var(--mm-dim);
        padding-left: 12px;
        border-left: 3px solid var(--mm-line);
      }
      .mm-state strong {
        color: var(--mm-text);
        font-weight: 600;
      }

      /* remember */
      .mm-new {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border: 1px solid var(--mm-line);
        border-radius: 12px;
        background: var(--mm-raise);
      }
      .mm-new-text {
        width: 100%;
        box-sizing: border-box;
        resize: vertical;
        background: #0d0e13;
        border: 1px solid #2b3040;
        border-radius: 10px;
        color: var(--mm-text);
        padding: 10px 12px;
        font: 15px/1.5 Inter, system-ui, sans-serif;
        outline: none;
      }
      .mm-new-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .mm-input,
      .mm-select {
        box-sizing: border-box;
        background: #0d0e13;
        border: 1px solid #2b3040;
        border-radius: 9px;
        color: var(--mm-text);
        padding: 8px 10px;
        font: 13px Inter, system-ui, sans-serif;
        outline: none;
        min-width: 0;
      }
      .mm-new-text:focus,
      .mm-input:focus,
      .mm-select:focus {
        border-color: var(--mm-amber);
      }
      .mm-tags {
        flex: 1 1 160px;
      }
      .mm-grow {
        flex: 1 1 240px;
        width: 100%;
      }
      /* in a COLUMN, a flex-basis is a height: the search box must not grow */
      .mm-search {
        flex: none;
        width: 100%;
      }
      .mm-seg {
        display: inline-flex;
        border: 1px solid #2b3040;
        border-radius: 9px;
        overflow: hidden;
      }
      .mm-seg button {
        background: transparent;
        border: 0;
        color: var(--mm-dim);
        font: 12.5px Inter, system-ui, sans-serif;
        padding: 8px 10px;
        cursor: pointer;
      }
      .mm-seg button + button {
        border-left: 1px solid #2b3040;
      }
      .mm-seg button.on {
        color: var(--mm-text);
        background: #222634;
      }
      .mm-go,
      .mm-ghost,
      .mm-danger {
        font: 600 12.5px Inter, system-ui, sans-serif;
        border-radius: 9px;
        padding: 8px 14px;
        cursor: pointer;
        border: 1px solid transparent;
      }
      .mm-go {
        background: var(--mm-text);
        color: #0d0e13;
      }
      .mm-go:disabled,
      .mm-ghost:disabled,
      .mm-danger:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .mm-ghost {
        background: transparent;
        border-color: #2b3040;
        color: var(--mm-ink);
      }
      .mm-red {
        color: #ff8b8b;
      }
      .mm-danger {
        background: #c4413a;
        color: #fff;
      }
      .mm-warn {
        color: #ff8b8b;
        font-size: 12px;
      }
      .mm button:focus-visible,
      .mm summary:focus-visible,
      .mm input[type="checkbox"]:focus-visible {
        outline: 2px solid var(--mm-amber);
        outline-offset: 2px;
      }

      /* recall probe */
      .mm-probe {
        border-top: 1px solid var(--mm-line);
        padding-top: 10px;
      }
      .mm-probe summary {
        cursor: pointer;
        font: 600 13.5px "Space Grotesk", system-ui, sans-serif;
        color: var(--mm-text);
        margin-bottom: 8px;
      }
      .mm-probe .mm-hint {
        margin-top: 6px;
      }
      .mm-recalled {
        list-style: none;
        margin: 10px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .mm-recalled li {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px 0 4px 10px;
        border-left: var(--mm-edge) solid var(--mm-ink);
        font-size: 13px;
      }

      /* filters */
      .mm-filters {
        display: flex;
        flex-direction: column;
        gap: 8px;
        border-top: 1px solid var(--mm-line);
        padding-top: 12px;
      }
      .mm-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      .mm-chip {
        background: transparent;
        border: 1px solid #2b3040;
        border-radius: 999px;
        color: var(--mm-dim);
        font: 12.5px Inter, system-ui, sans-serif;
        padding: 5px 11px;
        cursor: pointer;
        display: inline-flex;
        gap: 6px;
        align-items: baseline;
      }
      .mm-chip.on {
        color: var(--mm-text);
        border-color: var(--mm-ink);
        background: #1b1e28;
      }
      .mm-n {
        font-size: 11px;
        color: var(--mm-dim);
      }
      .mm-arch {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        font-size: 12.5px;
        color: var(--mm-dim);
        margin-left: 4px;
      }

      /* rows: the edge weight IS the confidence */
      .mm-list {
        list-style: none;
        margin: 0;
        padding: 0;
        border-top: 1px solid var(--mm-line);
      }
      .mm-row {
        position: relative;
        border-bottom: 1px solid var(--mm-line);
        padding-left: 14px;
      }
      .mm-row::before {
        content: "";
        position: absolute;
        left: 0;
        top: 10px;
        bottom: 10px;
        width: var(--mm-edge);
        background: var(--mm-ink);
        border-radius: 1px;
        transition: background 0.18s ease;
      }
      .mm-row.gone::before {
        background: transparent;
        border-left: var(--mm-edge) dashed #4a5064;
        width: 0;
      }
      .mm-row.open::before {
        background: var(--mm-amber);
        border-left: 0;
        width: var(--mm-edge);
        top: 0;
        bottom: 0;
      }
      .mm-hit {
        display: flex;
        flex-direction: column;
        gap: 5px;
        width: 100%;
        text-align: left;
        background: none;
        border: 0;
        padding: 12px 4px 12px 0;
        color: inherit;
        cursor: pointer;
        min-width: 0;
      }
      .mm-text {
        font: 15px/1.5 Inter, system-ui, sans-serif;
        color: var(--mm-text);
        max-width: 78ch;
        overflow-wrap: anywhere;
      }
      /* open, the sentence is in the editor below; showing it twice is noise */
      .mm-row.open .mm-text {
        display: none;
      }
      .mm-row.gone .mm-text {
        color: var(--mm-dim);
      }
      .mm-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 0;
        font-size: 12px;
        color: var(--mm-dim);
      }
      .mm-meta > span {
        padding: 0 8px;
        overflow-wrap: anywhere;
      }
      .mm-meta > span:first-child {
        padding-left: 0;
      }
      .mm-meta > span + span {
        border-left: 1px solid var(--mm-line);
      }
      .mm-you {
        color: var(--mm-ink);
      }
      .mm-stale {
        color: #d9a65a;
      }
      .mm-edit {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 0 4px 14px 0;
      }
      .mm-conf {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 12.5px;
        color: var(--mm-dim);
      }
      .mm-conf input {
        accent-color: var(--mm-amber);
        width: 120px;
      }
      .mm-prov {
        margin: 0;
        font-size: 12px;
        color: var(--mm-dim);
        line-height: 1.6;
        max-width: 78ch;
        overflow-wrap: anywhere;
      }
      .mm-id {
        color: #5a6072;
      }
      .mm-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }

      @media (max-width: 720px) {
        .mm {
          padding: 0 14px 24px;
        }
        .mm-input,
        .mm-select,
        .mm-new-text {
          font-size: 16px;
        }
        /* a hairline at the end of a wrapped line reads as a fault; space instead */
        .mm-meta > span + span {
          border-left: 0;
        }
        .mm-meta > span {
          padding: 0 10px 0 0;
        }
        .mm-seg {
          width: 100%;
        }
        .mm-seg button {
          flex: 1;
        }
        .mm-tags,
        .mm-go {
          flex: 1 1 100%;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .mm-row::before {
          transition: none;
        }
      }
    `}</style>
  );
}
