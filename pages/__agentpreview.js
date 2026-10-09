// Design reference for the Agent panel, rendered with the REAL components.
//
// The panel needs a live agentd over a WebSocket, which makes it impossible to
// look at — or assert on — without a server. This renders the same
// ApprovalCard, NewJob and JobRow against fixed data.
//
// The seed is chosen for the states that matter, not the happy one:
//   - an approval WAITING on you, which is the whole product
//   - a job that failed verification, which must not look like success
//   - a job finished with a PR link
//   - a transcript carrying a tool call and a secret that must come out masked
//
// 404s in production: it is a design tool, not a page.
import React, { useState } from "react";
import {
  ApprovalCard,
  NewJob,
  JobRow,
  ConnectionDot,
  AgentStyles,
} from "../components/admin/AgentPanel";

const PROFILES = [
  { name: "personal", claude: true, codex: false },
  { name: "work", claude: true, codex: true },
];

const JOBS = [
  {
    id: "j_1",
    state: "waiting",
    repo: "Ravikisha/RaviKishan",
    profile: "personal",
    task: "Add rate limiting to /api/notes and a test for it",
    approvals: { asked: 3, allowed: 2, denied: 0 },
    result: null,
    error: "",
  },
  {
    id: "j_2",
    state: "done",
    repo: "Ravikisha/kontainer",
    profile: "work",
    task: "Document the cgroups setup in the README",
    approvals: { asked: 1, allowed: 1, denied: 0 },
    result: { kind: "pr", url: "https://github.com/Ravikisha/kontainer/pull/12" },
    error: "",
  },
  {
    id: "j_3",
    state: "failed",
    repo: "Ravikisha/RaviKishan",
    profile: "personal",
    task: "Upgrade next to 14",
    approvals: { asked: 2, allowed: 2, denied: 0 },
    result: null,
    error: 'Verification failed at "npm run test:notes".',
  },
];

const EVENTS = {
  j_1: [
    { type: "started", at: Date.now() - 60000, text: "" },
    { type: "text", at: Date.now() - 55000, text: "Reading the route and its tests." },
    { type: "tool", at: Date.now() - 50000, tool: "Read", text: "pages/api/notes.js" },
    { type: "tool", at: Date.now() - 40000, tool: "Bash", text: "npm run test:notes" },
    // Proof the redaction runs on the way out, not in the panel.
    { type: "result", at: Date.now() - 30000, text: "73 passed, 0 failed\nGITHUB_TOKEN=••••••••••••" },
    { type: "text", at: Date.now() - 10000, text: "Adding a limiter and a test that exercises the 429." },
  ],
};

const CARD = {
  id: "a_1",
  jobId: "j_1",
  tool: "Bash",
  summary: "Run: git push -u origin agent/j_1",
  input: { command: "git push -u origin agent/j_1" },
  cwd: "/home/agent/.agentd/work/j_1",
  askedAt: Date.now(),
  expiresAt: Date.now() + 8 * 60 * 1000,
};

export default function AgentPreview() {
  const [open, setOpen] = useState("j_1");
  const [cards, setCards] = useState([CARD]);

  return (
    <main
      className="admin-main ag-main"
      style={{ background: "#08090d", minHeight: "100vh", padding: "88px 24px 24px" }}
    >
      <div className="ops-head">
        <div>
          <h3>Agent</h3>
          <p className="admin-sub ag-sub">
            Claude Code and Codex on your own server. Jobs run there; you approve the parts that
            cannot be undone.
          </p>
        </div>
        <span className="ag-actions">
          <ConnectionDot status="connected" />
          <label className="ag-toggle">
            <input type="checkbox" readOnly /> Speak
          </label>
          <button className="ag-halt" type="button">
            Stop everything
          </button>
        </span>
      </div>

      {cards.length ? (
        <section className="ag-approvals" aria-label="Waiting for your approval">
          {cards.map((c) => (
            <ApprovalCard
              key={c.id}
              card={c}
              job={JOBS.find((j) => j.id === c.jobId)}
              onAnswer={() => setCards([])}
            />
          ))}
        </section>
      ) : (
        <p className="ag-none">Nothing is waiting on you.</p>
      )}

      <NewJob
        profiles={PROFILES}
        repos={JOBS.map((j) => j.repo)}
        disabled={false}
        onStart={() => {}}
      />

      <p className="ag-limits">1 of 4 running · 2 per profile · 50 a day</p>

      <div className="ag-jobs">
        {JOBS.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            open={open === job.id}
            events={EVENTS[job.id] || []}
            onOpen={() => setOpen(open === job.id ? null : job.id)}
            onStop={() => {}}
          />
        ))}
      </div>

      <AgentStyles />
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
