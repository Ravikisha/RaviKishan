// The top of the Agent tab: ONE sentence that answers "does anything need
// me?", and — when something does — the thing itself, right under it.
//
// This replaces three places that each said part of the state (a title with a
// paragraph of description, a connection dot, a separate Not connected card)
// with one. The sentence is written from real state by headline.js and set at
// display size; the second line is quiet and says what else is going on.
// When an approval is waiting, its card sits directly beneath the sentence,
// compact, Deny first and larger, reachable by a thumb on the first screen of
// a phone. When the panel is not connected, the sentence says so and the
// primary Connect sits where the card would be: one place for state.
//
// The one motion on the page: the sentence cross-fades when it changes. It is
// keyed on its own text, so it only moves when the answer moves.
import React from "react";
import { ApprovalCard } from "./ApprovalCard";
import { headline } from "./headline";

export default function WorkbenchHead({
  status = "idle",
  host = "",
  conn = {},
  approvals = [],
  strip = approvals,
  chats = [],
  jobs = [],
  idleOf,
  halted = false,
  actions = null,
  whereFor = () => undefined,
  scopeFor = () => "job",
  jobFor = () => undefined,
  onConnect,
  onAnswer,
  onJump,
  onMore,
}) {
  const h = headline({ status, host, conn, approvals, chats, jobs, idleOf, halted });
  const connectable = status === "idle" || status === "closed" || status === "failed";
  const first = strip[0];
  const more = strip.length - 1;
  // Waiting, but the card is already on screen somewhere else (inline in the
  // open conversation): say where rather than showing it twice.
  const elsewhere = Math.max(0, approvals.length - strip.length);
  return (
    <header className={`wb-head t-${h.tone}`} data-tone={h.tone} data-state={status}>
      <div className="wb-head-row">
        <div className="wb-head-say" role={h.tone === "fail" ? "alert" : "status"} aria-live="polite" aria-atomic="true">
          <p className="wb-head-line" key={h.line}>
            {h.line}
          </p>
          {h.sub ? <p className="wb-head-sub">{h.sub}</p> : null}
        </div>
        {actions ? <div className="wb-head-acts">{actions}</div> : null}
      </div>

      {connectable ? (
        <button type="button" className="admin-primary ag-connect-btn" onClick={onConnect}>
          {status === "failed" ? "Connect again" : "Connect"}
          {host ? <code>{host}</code> : null}
        </button>
      ) : null}

      {/* Always mounted, so a card that arrives is announced: an unanswered
          approval is DENIED when it expires. */}
      <section
        className={first ? "wb-strip" : "wb-strip is-empty"}
        aria-label="Waiting for your approval"
        aria-live="assertive"
        aria-relevant="additions"
      >
        {first ? (
          <ApprovalCard
            key={first.id}
            compact
            card={first}
            job={jobFor(first)}
            where={whereFor(first)}
            scopeLabel={scopeFor(first)}
            onAnswer={(allow, scope) => onAnswer(first, allow, scope)}
          />
        ) : null}
      </section>
      {more > 0 ? (
        <button type="button" className="wb-head-link" onClick={onMore}>
          {more} more waiting, in Review
        </button>
      ) : null}
      {elsewhere > 0 && onJump ? (
        <button type="button" className="wb-head-link" onClick={onJump}>
          {first ? "One more is in the conversation below. Show it" : "It is in the conversation below. Show it"}
        </button>
      ) : null}
    </header>
  );
}

// Styles live in WorkbenchStyles (.wb-head…), with the rest of the workbench.
