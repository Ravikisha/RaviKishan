// Chat: conversations on the left, the one you are in on the right.
//
// On a phone there is room for one of those at a time, so the list is a pane
// you open from the conversation's header rather than a column squeezed to
// 120px. The conversation is the default; the list is one tap away and says
// how many conversations it holds, so nothing is hidden without a trace.
//
// A past conversation opens READ-ONLY, from disk, with Resume as its one
// action. Reading history must never quietly start a process on the box.
import React, { useState } from "react";
import SessionList, { ago } from "./SessionList";
import ChatTranscript from "./ChatTranscript";
import Composer from "./Composer";
import { stateLine } from "./chatFold";

const TOOL = { claude: "Claude Code", codex: "Codex" };

export default function ChatView({
  connected = false,
  chats = [],
  sessions = [],
  selected = null, // { chatId } | { session } | null (a new chat)
  events = [],
  approvals = [],
  profiles = [],
  orgs = [],
  skills = [],
  repos = [],
  now = 0,
  loading = false,
  busy = false,
  error = "",
  unsupported = "",
  initialPane = "talk",
  onSelect = () => {},
  onStart = () => {},
  onSend = () => {},
  onInterrupt = () => {},
  onClose = () => {},
  onResume = () => {},
  onAnswer = () => {},
  onRefresh = () => {},
  onNeedSkills = () => {},
}) {
  const [pane, setPane] = useState(initialPane);

  const chat = selected?.chatId ? chats.find((c) => c.chatId === selected.chatId) || { chatId: selected.chatId, state: "idle" } : null;
  const session = selected?.session || null;
  const mine = chat ? approvals.filter((a) => a.jobId === chat.chatId || a.chatId === chat.chatId) : [];
  const waitingOn = {};
  for (const a of approvals) {
    const id = a.chatId || a.jobId;
    if (chats.some((c) => c.chatId === id)) waitingOn[id] = (waitingOn[id] || 0) + 1;
  }

  const title = chat ? chat.title || "New conversation" : session ? session.title || "Untitled conversation" : "New chat";
  const tool = chat?.tool || session?.tool || "claude";
  const status = chat ? stateLine(chat.state, { tool, pending: mine.length }) : "";
  const where = chat?.repo || chat?.cwd || session?.cwd || "";

  return (
    <div className={`wb-chat pane-${pane}`}>
      <div className="wb-chat-list">
        <SessionList
          chats={chats}
          sessions={sessions}
          selected={chat?.chatId || session?.sessionId || ""}
          waitingOn={waitingOn}
          now={now}
          loading={loading}
          unsupported={unsupported}
          onRefresh={onRefresh}
          onNew={() => {
            onSelect(null);
            setPane("talk");
          }}
          onOpenChat={(c) => {
            onSelect({ chatId: c.chatId });
            setPane("talk");
          }}
          onOpenSession={(s) => {
            onSelect({ session: s });
            setPane("talk");
          }}
        />
      </div>

      <section className={`wb-chat-main${mine.length ? " ask" : chat ? " live" : ""}`} aria-label="Conversation">
        <header className="wb-chat-head">
          <button type="button" className="ag-ghost wb-to-list" onClick={() => setPane("list")} aria-label="Show conversations">
            Conversations <em>{chats.length + sessions.length}</em>
          </button>
          <div className="wb-chat-title">
            <h4>{title}</h4>
            <p className="wb-chat-meta">
              <span>{TOOL[tool] || tool}</span>
              {chat?.profile || session?.profile ? <span>{chat?.profile || session?.profile}</span> : null}
              {chat?.model ? <span>{chat.model}</span> : null}
              {chat?.orgId ? <span>{chat.orgId}</span> : null}
              {where ? (
                <span>
                  <code>{where}</code>
                </span>
              ) : null}
              {chat?.sessionId || session?.sessionId ? (
                <span>
                  <code title="Session id">{String(chat?.sessionId || session?.sessionId).slice(0, 8)}</code>
                </span>
              ) : null}
            </p>
          </div>
        </header>

        {/* Always mounted, so a change of state is announced. */}
        <p className={`wb-status${mine.length ? " ask" : ""}`} role="status" aria-live="polite">
          {status}
        </p>
        {error ? (
          <p className="admin-err wb-err" role="alert">
            {error}
          </p>
        ) : null}

        {!chat && !session ? (
          <div className="wb-blank">
            <p className="wb-blank-h">Talk to Claude Code or Codex on your server.</p>
            <p>
              Every tool call shows up as it happens, and anything the chat&apos;s rules say to ask about stops and
              waits here for you. Pick the account, the folder and the org below, then write the first message.
            </p>
          </div>
        ) : (
          <ChatTranscript
            events={events}
            tool={tool}
            approvals={mine}
            where={where}
            onAnswer={onAnswer}
          />
        )}

        {session && !chat ? (
          <div className="wb-resume">
            <p>
              A past conversation{session.updatedAt && now ? `, last active ${ago(session.updatedAt, now)}` : ""}. Reading it
              does not start anything on the box.
            </p>
            <button type="button" className="admin-primary" disabled={!connected || busy} onClick={() => onResume(session)}>
              {busy ? "Resuming…" : "Resume this conversation"}
            </button>
          </div>
        ) : (
          <Composer
            chat={chat}
            profiles={profiles}
            orgs={orgs}
            skills={skills}
            repos={repos}
            disabled={!connected || !!unsupported}
            busy={busy}
            onStart={onStart}
            onSend={(t) => onSend(chat, t)}
            onInterrupt={() => onInterrupt(chat)}
            onClose={() => onClose(chat)}
            onNeedSkills={onNeedSkills}
          />
        )}
      </section>
    </div>
  );
}
