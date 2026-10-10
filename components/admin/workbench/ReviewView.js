// What was done on the box, and by whom.
//
// One timeline for every OS-level action — commands, file writes, desktop
// clicks and keys, page loads, terminal lines, preview opens and approval
// decisions. Anything still WAITING for an answer is pinned above it, because
// an unanswered approval is denied when it expires and the timeline is where
// you come to look.
//
// The filters are the two questions asked of a log like this: who did it
// (you, a chat, a job, the site's MCP) and what kind of thing it was. Each
// carries its count, so a filter never promises rows it then fails to show.
// The left edge carries the decision for a gated action: red for denied,
// solid for allowed, hairline for everything else.
import React, { useMemo, useState } from "react";
import { ApprovalCard } from "./ApprovalCard";

export const OP_KINDS = ["command", "file", "desktop", "browser", "terminal", "approval", "preview"];
const KIND_WORD = {
  command: "Commands",
  file: "Files",
  desktop: "Desktop",
  browser: "Browser",
  terminal: "Terminal",
  approval: "Approvals",
  preview: "Previews",
};
const ACTORS = [
  ["all", "Everyone", () => true],
  ["owner", "You", (a) => a === "owner"],
  ["chat", "Chats", (a) => /^chat:/.test(a)],
  ["job", "Jobs", (a) => /^(job|agent):/.test(a)],
  ["mcp", "Site MCP", (a) => a === "mcp"],
];

const when = (at) => {
  try {
    const d = new Date(at);
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch (_) {
    return "";
  }
};

const actorWord = (a) => (a === "owner" ? "you" : a === "mcp" ? "site MCP" : a || "unknown");

function Detail({ detail }) {
  if (detail == null) return null;
  let text = "";
  try {
    text = typeof detail === "string" ? detail : JSON.stringify(detail, null, 2);
  } catch (_) {
    text = String(detail);
  }
  if (!text || text === "{}") return null;
  return (
    <details className="wb-op-detail">
      <summary>Detail</summary>
      <pre className="wb-pre">{text}</pre>
    </details>
  );
}

export default function ReviewView({ ops = [], approvals = [], chats = [], jobs = [], connected = false, loading = false, onAnswer = () => {}, onRefresh = () => {} }) {
  const [actor, setActor] = useState("all");
  const [kind, setKind] = useState("");

  const byActor = useMemo(() => {
    const test = (ACTORS.find(([k]) => k === actor) || ACTORS[0])[2];
    return ops.filter((o) => test(o.actor));
  }, [ops, actor]);
  const counts = useMemo(() => {
    const c = {};
    for (const o of byActor) c[o.kind] = (c[o.kind] || 0) + 1;
    return c;
  }, [byActor]);
  const actorCounts = useMemo(() => Object.fromEntries(ACTORS.map(([k, , t]) => [k, ops.filter((o) => t(o.actor)).length])), [ops]);
  const rows = kind ? byActor.filter((o) => o.kind === kind) : byActor;

  const whereOf = (card) => {
    const chat = chats.find((c) => c.chatId === (card.chatId || card.jobId));
    if (chat) return `chat: ${chat.title || chat.chatId}`;
    const job = jobs.find((j) => j.id === card.jobId);
    return job?.repo || card.jobId;
  };

  return (
    <div className="wb-review">
      {approvals.length ? (
        <section className="wb-pinned" aria-label="Waiting for your answer">
          <h4 className="wb-sgroup-h ask">
            Waiting for you <span>{approvals.length}</span>
          </h4>
          {approvals.map((card) => (
            <ApprovalCard
              key={card.id}
              card={card}
              where={whereOf(card)}
              scopeLabel={chats.some((c) => c.chatId === (card.chatId || card.jobId)) ? "chat" : "job"}
              onAnswer={(allow, scope) => onAnswer(card, allow, scope)}
            />
          ))}
        </section>
      ) : null}

      <div className="wb-filters">
        <div className="wb-seg" role="radiogroup" aria-label="Who did it">
          {ACTORS.map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={actor === k} className={actor === k ? "on" : ""} onClick={() => setActor(k)}>
              {label} <em>{actorCounts[k]}</em>
            </button>
          ))}
        </div>
        <div className="wb-seg" role="radiogroup" aria-label="What kind">
          <button type="button" role="radio" aria-checked={!kind} className={!kind ? "on" : ""} onClick={() => setKind("")}>
            All <em>{byActor.length}</em>
          </button>
          {OP_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)} disabled={!counts[k]}>
              {KIND_WORD[k]} <em>{counts[k] || 0}</em>
            </button>
          ))}
        </div>
        <button type="button" className="ag-ghost" onClick={onRefresh} disabled={!connected || loading}>
          {loading ? "Reading…" : "Refresh"}
        </button>
      </div>

      {!connected && !ops.length ? <p className="wb-empty">Not connected to the agent server. The timeline is read from the box.</p> : null}
      {connected && !loading && !rows.length ? <p className="wb-empty">{ops.length ? "Nothing matches both filters." : "Nothing has been done on the box yet."}</p> : null}

      <ol className="wb-ops" aria-label="Timeline" aria-live="polite" aria-relevant="additions">
        {rows.map((o, i) => (
          <li key={`${o.at}:${i}`} className={`wb-op ${o.kind}${o.decision ? ` d-${o.decision}` : ""}`} data-kind={o.kind} data-actor={o.actor}>
            <div className="wb-op-top">
              <span className="wb-op-kind">{o.kind}</span>
              <code className="wb-op-actor">{actorWord(o.actor)}</code>
              {o.decision ? <span className={`wb-op-dec ${o.decision}`}>{o.decision}</span> : null}
              <time className="wb-op-at">{when(o.at)}</time>
            </div>
            <p className="wb-op-sum">{o.summary}</p>
            <Detail detail={o.detail} />
          </li>
        ))}
      </ol>
    </div>
  );
}
