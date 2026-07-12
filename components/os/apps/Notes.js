import React, { useState } from "react";
import { useSiteContent } from "../../../lib/useSiteContent";

// Notes — short essays in Ravi's voice. The narrative the résumé can't hold:
// why he builds infrastructure from first principles. Copy traces to real facts
// (patent, 167★, the systems built); nothing invented.
const NOTES = (identity, patents) => [
  {
    id: "scratch",
    title: "Why I build from scratch",
    date: "pinned",
    body: [
      "The fastest way I understand a system is to rebuild it.",
      "So I did. A UI runtime with its own reconciler. A language, lexer to interpreter. A container runtime. A fault-tolerant key-value store with replication and a Raft-ish consensus. Not to ship them to millions — to stop treating them as magic.",
      "Every abstraction I use now has a floor I've stood on. When a deploy melts down at 2am, I'm not guessing which layer lied. I've written that layer.",
      "That's the whole thesis. Depth over surface. First principles over frameworks.",
    ],
  },
  {
    id: "ai",
    title: "Applied AI, not applied hype",
    date: "",
    body: [
      "I build agentic systems for a living — retrieval, multi-agent orchestration, evaluation harnesses that actually gate on quality.",
      "The unglamorous parts are the real work: chunking that respects structure, rerankers that earn their latency, evals that catch a regression before a user does.",
      "A model is a component. The system around it is the engineering.",
    ],
  },
  {
    id: "patent",
    title: "The patent",
    date: "granted",
    body: [
      "I'm a named inventor on a published Indian patent — a retrieval-augmented generation method.",
      (patents && patents[0] && patents[0].abstract) ||
        "A method for grounding language-model output in a verified knowledge base to cut hallucination.",
      "Research is just building from scratch with a paper trail.",
    ],
  },
  {
    id: "now",
    title: "What I'm building now",
    date: "",
    body: [
      identity?.now ? `Currently: ${identity.now}.` : "Currently shipping agentic-AI in production.",
      "1,200+ DSA problems kept the fundamentals sharp. 167★ across 69 repos and 1,000+ npm downloads keep me honest about shipping, not just prototyping.",
      "Gold medalist. But the medal I care about is a green CI on something hard.",
    ],
  },
  {
    id: "colophon",
    title: "Colophon — this desktop",
    date: "",
    body: [
      "You're inside a hand-built desktop OS: a window manager with drag, resize, snap-to-edge tiling and z-order focus; a dock with magnification; Spotlight; a menu bar; persisted sessions; keyboard shortcuts; a boot sequence.",
      "No OS framework. Just React state, a few hundred lines, and the same instinct that starts every project here — rebuild it to understand it.",
      "Prefer the clean version? Toggle recruiter mode (⇧⌘R) for a plain, fast portfolio.",
    ],
  },
];

export default function Notes() {
  const { identity, patents } = useSiteContent();
  const notes = NOTES(identity, patents);
  const [active, setActive] = useState(notes[0].id);
  const note = notes.find((n) => n.id === active) || notes[0];

  return (
    <div className="nt">
      <aside className="nt-list">
        {notes.map((n) => (
          <button
            key={n.id}
            className={`nt-item${active === n.id ? " on" : ""}`}
            onClick={() => setActive(n.id)}
          >
            <span className="nt-item-title">{n.title}</span>
            <span className="nt-item-sub">
              {n.date && <em>{n.date}</em>}
              {n.body[0].slice(0, 42)}…
            </span>
          </button>
        ))}
      </aside>

      <article className="nt-body">
        <div className="nt-meta">{note.date || "note"} · ravi@portfolio</div>
        <h1 className="nt-title">{note.title}</h1>
        {note.body.map((p, i) => (
          <p key={i} className={i === 0 ? "nt-lead" : ""}>{p}</p>
        ))}
        <div className="nt-sig">— Ravi Kishan</div>
      </article>

      <style jsx>{`
        .nt { display: grid; grid-template-columns: 230px 1fr; min-height: 100%; background: var(--c-bg); color: var(--c-fg); font-family: "Inter", sans-serif; }
        .nt-list { border-right: 1px solid var(--c-edge); background: var(--c-surface); overflow: auto; padding: 8px; }
        .nt-item { display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; background: none; border: none; cursor: pointer; padding: 11px 12px; border-radius: 9px; transition: background .12s; }
        .nt-item:hover { background: color-mix(in srgb, var(--c-fg) 5%, transparent); }
        .nt-item.on { background: color-mix(in srgb, var(--c-accent) 16%, transparent); }
        .nt-item-title { font-size: 13.5px; font-weight: 600; color: var(--c-fg); }
        .nt-item-sub { font-size: 11px; color: var(--c-muted); display: flex; gap: 6px; align-items: baseline; }
        .nt-item-sub em { font-style: normal; font-family: "JetBrains Mono", monospace; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: var(--c-accentText, var(--c-accent)); }
        .nt-body { padding: 28px 32px 34px; overflow: auto; max-width: 680px; }
        .nt-meta { font-family: "JetBrains Mono", monospace; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--c-muted); }
        .nt-title { margin-top: 8px; font-family: "Space Grotesk", sans-serif; font-size: 28px; font-weight: 700; letter-spacing: -.02em; line-height: 1.15; }
        .nt-body p { margin-top: 15px; font-size: 15px; line-height: 1.7; color: var(--c-muted); }
        .nt-lead { color: var(--c-fg) !important; font-size: 17px !important; font-weight: 500; }
        .nt-sig { margin-top: 26px; font-family: "JetBrains Mono", monospace; font-size: 12px; color: var(--c-accentText, var(--c-accent)); }
        @media (max-width: 640px) {
          .nt { grid-template-columns: 1fr; }
          .nt-list { display: none; }
          .nt-body { padding: 20px; }
        }
      `}</style>
    </div>
  );
}
