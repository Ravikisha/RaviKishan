// One conversation, as it happens.
//
// The words are the page; everything the agent DID is folded into a card one
// line tall, showing the literal command or path and whether it worked. You
// open a card when something went wrong, which is the only time a tool's
// output is worth reading. A failed call is the one card that is never quiet:
// red, dashed on the left, the same mark the run board uses for "failed".
//
// An approval the chat is blocked on is rendered INLINE, at the point in the
// conversation where it was asked, with the same card the run board uses.
import React, { useEffect, useMemo, useRef } from "react";
import { foldEvents, splitFences, toolName } from "./chatFold";
import { ApprovalCard } from "./ApprovalCard";

const TOOL_WORD = { claude: "Claude", codex: "Codex" };

export function ToolCard({ item, waiting = false }) {
  const failed = !!item.result?.isError;
  const done = !!item.result && !failed;
  const state = waiting ? "ask" : failed ? "bad" : done ? "ok" : "run";
  const word = waiting ? "waiting for you" : failed ? "failed" : done ? "done" : "running";
  const { server, name } = toolName(item.name);
  return (
    <details className={`wb-tool ${state}`} data-tool-state={state} open={failed || undefined}>
      <summary>
        <span className="wb-tool-name">
          {name}
          {server ? <em>{server}</em> : null}
        </span>
        {item.line ? <code className="wb-tool-line">{item.line}</code> : null}
        <span className={`wb-tool-state ${state}`}>{word}</span>
      </summary>
      <div className="wb-tool-body">
        {item.input && Object.keys(item.input).length ? (
          <>
            <p className="wb-tool-label">Input</p>
            <pre className="wb-pre">{pretty(item.input)}</pre>
          </>
        ) : null}
        {item.result ? (
          <>
            <p className="wb-tool-label">{failed ? "Error" : "Output"}</p>
            <pre className={`wb-pre${failed ? " bad" : ""}`}>{item.result.text || "(no output)"}</pre>
          </>
        ) : (
          <p className="wb-tool-label">{waiting ? "Not run yet: it needs your answer." : "No output yet."}</p>
        )}
      </div>
    </details>
  );
}

const pretty = (v) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch (_) {
    return String(v);
  }
};

// Assistant text, with fenced code set apart. Rendered as TEXT, never HTML:
// it is model output, and model output can be steered by what the model read.
export function AssistantText({ text, streaming }) {
  const parts = useMemo(() => splitFences(text), [text]);
  return (
    <div className={`wb-say${streaming ? " is-streaming" : ""}`}>
      {parts.map((p, i) =>
        p.kind === "code" ? (
          <figure key={i} className="wb-code">
            {p.lang ? <figcaption>{p.lang}</figcaption> : null}
            <pre>
              <code>{p.text}</code>
            </pre>
          </figure>
        ) : (
          <p key={i} className="wb-prose">
            {p.text.trim()}
          </p>
        )
      )}
      {streaming ? <span className="wb-caret" aria-hidden="true" /> : null}
    </div>
  );
}

export default function ChatTranscript({ events = [], tool = "claude", approvals = [], where = "", onAnswer = () => {}, follow = true }) {
  const items = useMemo(() => foldEvents(events), [events]);
  const box = useRef(null);

  // Follow the tail, unless the reader has scrolled up to read something.
  useEffect(() => {
    const el = box.current;
    if (!follow || !el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (near || items.length < 3) el.scrollTop = el.scrollHeight;
  }, [items, approvals.length, follow]);

  // Which running tool an approval belongs to: the newest unanswered call of
  // the same tool. The card then sits directly under the call it is about.
  const placed = new Map();
  for (const card of approvals) {
    const target = [...items].reverse().find((x) => x.kind === "tool" && !x.result && x.name === card.tool && !placed.has(x));
    if (target) placed.set(target, card);
  }
  const unplaced = approvals.filter((c) => ![...placed.values()].includes(c));

  return (
    <div className="wb-transcript" ref={box} aria-label="Conversation">
      {items.length === 0 && !approvals.length ? (
        <p className="wb-empty">Nothing said yet. Write the first message below.</p>
      ) : null}
      {items.map((it, i) => {
        switch (it.kind) {
          case "user":
            return (
              <div key={i} className={`wb-you${it.local ? " is-sending" : ""}`}>
                <p className="wb-who">You</p>
                <p className="wb-prose">{it.text}</p>
              </div>
            );
          case "assistant":
            return (
              <div key={i} className="wb-them">
                <p className="wb-who">{TOOL_WORD[tool] || "Agent"}</p>
                <AssistantText text={it.text} streaming={it.streaming} />
              </div>
            );
          case "thinking":
            return (
              <details key={i} className="wb-thinking">
                <summary>Thinking</summary>
                <p>{it.text}</p>
              </details>
            );
          case "tool": {
            const card = placed.get(it);
            return (
              <div key={i} className="wb-tool-wrap">
                <ToolCard item={it} waiting={!!card} />
                {card ? <ApprovalCard card={card} where={where} scopeLabel="chat" onAnswer={(allow, scope) => onAnswer(card, allow, scope)} /> : null}
              </div>
            );
          }
          case "end":
            return (
              <p key={i} className={`wb-end${it.ok ? "" : " bad"}`}>
                {it.interrupted ? "Interrupted." : it.ok ? "Turn finished" : "Turn ended with an error"}
                {it.ms ? ` in ${Math.max(1, Math.round(it.ms / 1000))}s` : ""}
                {it.usd != null ? `, $${Number(it.usd).toFixed(3)}` : ""}
              </p>
            );
          case "error":
            return (
              <p key={i} className="wb-err-line" role="alert">
                {it.text}
              </p>
            );
          case "system":
            return (
              <p key={i} className="wb-sys">
                {it.text}
              </p>
            );
          default:
            return (
              <pre key={i} className="wb-log">
                {it.text}
              </pre>
            );
        }
      })}
      {unplaced.map((card) => (
        <ApprovalCard key={card.id} card={card} where={where} scopeLabel="chat" onAnswer={(allow, scope) => onAnswer(card, allow, scope)} />
      ))}
    </div>
  );
}
