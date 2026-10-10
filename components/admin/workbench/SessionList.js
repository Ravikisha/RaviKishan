// Every conversation on the box: the ones running now, then everything
// Claude Code and Codex have kept on disk, newest first.
//
// Open-now chats sit above the history because they are the ones that can be
// waiting on you; a chat blocked on an approval wears the amber edge, the same
// mark as everywhere else in this admin for "this wants you". The one being
// read is marked by a solid neutral edge and aria-current, not by amber —
// amber is attention, and selection is not attention.
//
// Search narrows by every word typed, across title, folder and session id.
import React, { useMemo, useState } from "react";
import { matchSession } from "./chatFold";

const TOOL = { claude: "Claude Code", codex: "Codex" };
const STATE_WORD = { thinking: "working", waiting: "waiting for you", idle: "ready", closed: "closed" };

export function ago(at, now) {
  if (!at || !now) return "";
  const t = typeof at === "number" ? at : Date.parse(at);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function SessionList({
  chats = [],
  sessions = [],
  selected = "",
  waitingOn = {},
  now = 0,
  loading = false,
  unsupported = "",
  onOpenChat = () => {},
  onOpenSession = () => {},
  onNew = () => {},
  onRefresh = () => {},
}) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(20);

  const liveIds = new Set(chats.map((c) => c.sessionId).filter(Boolean));
  const past = useMemo(
    () =>
      sessions
        .filter((s) => !liveIds.has(s.sessionId))
        .filter((s) => matchSession(s, q))
        .sort((a, b) => (Date.parse(b.updatedAt) || b.updatedAt || 0) - (Date.parse(a.updatedAt) || a.updatedAt || 0)),
    // liveIds is derived from chats
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, chats, q]
  );
  const open = chats.filter((c) => c.state !== "closed").filter((c) => matchSession(c, q));

  return (
    <nav className="wb-sessions" aria-label="Conversations">
      <div className="wb-sessions-head">
        <button type="button" className="admin-primary wb-new" onClick={onNew}>
          New chat
        </button>
        <button type="button" className="ag-ghost" onClick={onRefresh} disabled={loading}>
          {loading ? "Reading…" : "Refresh"}
        </button>
      </div>
      <input
        className="admin-input wb-search"
        type="search"
        placeholder={`Search ${sessions.length} past conversation${sessions.length === 1 ? "" : "s"}`}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setShown(20);
        }}
        aria-label="Search conversations"
      />
      {unsupported ? <p className="wb-note">{unsupported}</p> : null}

      {open.length ? (
        <section className="wb-sgroup" aria-label="Open now">
          <h4 className="wb-sgroup-h">
            Open now <span>{open.length}</span>
          </h4>
          {open.map((c) => {
            const asks = waitingOn[c.chatId] || 0;
            return (
              <button
                key={c.chatId}
                type="button"
                className={`wb-srow live${asks || c.state === "waiting" ? " ask" : ""}${selected === c.chatId ? " on" : ""}`}
                aria-current={selected === c.chatId ? "true" : undefined}
                onClick={() => onOpenChat(c)}
                data-chat={c.chatId}
              >
                <span className="wb-srow-title">{c.title || "New conversation"}</span>
                <span className="wb-srow-meta">
                  <span>{asks ? `${asks} waiting for you` : STATE_WORD[c.state] || c.state || "ready"}</span>
                  <span>{TOOL[c.tool] || c.tool || "Claude Code"}</span>
                  {c.profile ? <span>{c.profile}</span> : null}
                </span>
              </button>
            );
          })}
        </section>
      ) : null}

      <section className="wb-sgroup" aria-label="History">
        <h4 className="wb-sgroup-h">
          History <span>{q ? `${past.length} of ${sessions.length}` : sessions.length}</span>
        </h4>
        {!past.length ? (
          <p className="wb-empty">{q ? "Nothing matches every word." : loading ? "Reading the box…" : "No past conversations yet."}</p>
        ) : null}
        {past.slice(0, shown).map((s) => (
          <button
            key={`${s.profile}:${s.tool}:${s.sessionId}`}
            type="button"
            className={`wb-srow${selected === s.sessionId ? " on" : ""}`}
            aria-current={selected === s.sessionId ? "true" : undefined}
            onClick={() => onOpenSession(s)}
            data-session={s.sessionId}
          >
            <span className="wb-srow-title">{s.title || "Untitled conversation"}</span>
            <span className="wb-srow-meta">
              <span>{ago(s.updatedAt, now)}</span>
              {s.messageCount ? <span>{s.messageCount} messages</span> : null}
              <span>{TOOL[s.tool] || s.tool || "Claude Code"}</span>
              {s.profile ? <span>{s.profile}</span> : null}
            </span>
            {s.cwd ? <code className="wb-srow-cwd">{s.cwd}</code> : null}
          </button>
        ))}
        {past.length > shown ? (
          <button type="button" className="ag-ghost wb-more" onClick={() => setShown((n) => n + 20)}>
            Show {Math.min(20, past.length - shown)} more
          </button>
        ) : null}
      </section>
    </nav>
  );
}
