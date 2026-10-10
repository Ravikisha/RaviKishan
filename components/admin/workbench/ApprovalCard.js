// The approval card — the one loud element anywhere in the agent tab.
//
// Lives in its own file so the run board, the chat transcript and the review
// timeline render the SAME card. AgentPanel re-exports it, so nothing that
// imported it from there changes. Its styles stay in AgentStyles (.ag-card…),
// which every surface that renders it already mounts.
//
// Deny is the larger, first target. A mistaken deny costs a tap; a mistaken
// allow costs a repository.
import React, { useEffect, useState } from "react";

export const clock = (ms) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
};

// `where` names what asked: a job's repository, or a chat's folder. `scopeLabel`
// says what "for the rest of it" means there — a job, or a chat.
// `compact` is the strip under the Agent tab's headline: the same card, the
// same Deny-first actions, with the working directory left out.
export function ApprovalCard({ card, job, where, scopeLabel = "job", compact = false, onAnswer }) {
  // Starts at null and is filled in after mount: Date.now() on the server and
  // Date.now() in the browser are different numbers by definition.
  const [left, setLeft] = useState(null);

  // The countdown is not decoration: an approval that expires is DENIED, and
  // the person deciding should be able to see how long they have.
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, card.expiresAt - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [card.expiresAt]);

  return (
    <article className={`ag-card${compact ? " compact" : ""}`} data-approval={card.id}>
      <header>
        <strong>{card.tool}</strong>
        <span className="ag-card-repo">{where || job?.repo || card.jobId}</span>
        <span className={`ag-card-clock${left !== null && left < 60000 ? " soon" : ""}`}>
          {left === null ? "…" : `${clock(left)} left`}
        </span>
      </header>

      <p className="ag-card-summary">{card.summary}</p>

      {card.input?.command ? <pre className="ag-card-cmd">{card.input.command}</pre> : null}
      {card.cwd && !compact ? <p className="ag-card-cwd">{card.cwd}</p> : null}

      <p className="ag-card-note">
        No answer means no. If this expires it is refused and the {scopeLabel} stops there.
      </p>

      <div className="ag-card-actions">
        {/* Deny first, and larger. A mistaken deny costs a tap. */}
        <button className="ag-deny" type="button" onClick={() => onAnswer(false)}>
          Deny
        </button>
        <button className="ag-allow" type="button" onClick={() => onAnswer(true, "once")}>
          Allow once
        </button>
        <button className="ag-allow-session" type="button" onClick={() => onAnswer(true, "session")}>
          Allow this exact command for the {scopeLabel}
        </button>
      </div>
    </article>
  );
}

export default ApprovalCard;
