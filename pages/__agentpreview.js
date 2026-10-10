// Design reference for the Agent panel, rendered with the REAL components.
//
// The panel needs a live agentd over a WebSocket, which makes it impossible to
// look at — or assert on — without a server. This renders the same
// ApprovalCard, NewJob, RunBoard, ProfileAccounts and FeaturesPanel against
// fixed data, every section stacked so one screenshot covers the lot.
//
// The seed is chosen for the states that matter, not the happy one:
//   - an approval WAITING on you, which is the whole product, with its
//     countdown on the run row as well as on the card
//   - a STALLED job, silent past the threshold, which must read as stuck
//   - a running job whose silence is approaching the threshold
//   - a job that failed verification, which must not look like success
//   - a profile with Claude signed in by token and Codex NOT signed in, with
//     a relayed Codex sign-in mid-flow (link + device code)
//   - a second profile mid-way through a Claude sign-in that wants a code
//     pasted back, and a failed earlier attempt said beside the line
//   - a plugin that is installed but turned off, and skills from both sources
//
// 404s in production: it is a design tool, not a page.
import React, { useEffect, useState } from "react";
import {
  AgentTabs,
  ApprovalCard,
  NewJob,
  RunBoard,
  ProfileAccounts,
  FeaturesPanel,
  ConnectionDot,
  AgentStyles,
} from "../components/admin/AgentPanel";

const MIN = 60000;

const PROFILES = [
  {
    name: "personal",
    claude: true,
    codex: false,
    login: {
      claude: { signedIn: true, method: "token", last4: "x9Qa", at: 0 },
      codex: { signedIn: false, method: null, last4: "", at: 0 },
    },
  },
  {
    name: "work",
    claude: false,
    codex: true,
    login: {
      claude: { signedIn: false, method: null, last4: "", at: 0 },
      codex: { signedIn: true, method: "oauth", last4: "", at: 0 },
    },
  },
];

const ORGS = [
  { id: "relax", name: "Relax" },
  { id: "asap-god", name: "Asap God" },
];

// Durations, not timestamps, so the server render and the browser agree.
const JOBS = [
  {
    id: "j_wait",
    state: "waiting",
    repo: "Ravikisha/RaviKishan",
    profile: "personal",
    tool: "claude",
    orgId: "relax",
    task: "Add rate limiting to /api/notes and a test for it",
    approvals: { asked: 3, allowed: 2, denied: 0 },
    elapsedMs: 14 * MIN,
    idleMs: 2 * MIN,
    startedAt: 1,
    result: null,
    error: "",
  },
  {
    id: "j_stuck",
    state: "stalled",
    repo: "Ravikisha/kontainer",
    profile: "work",
    tool: "codex",
    orgId: "relax",
    task: "Port the cgroup v1 fallback to v2 and keep the integration tests green on a kernel that has no unified hierarchy mounted at /sys/fs/cgroup",
    approvals: { asked: 0, allowed: 0, denied: 0 },
    elapsedMs: 41 * MIN,
    idleMs: 7 * MIN,
    startedAt: 1,
    result: null,
    error: "",
    memory: { recalled: 4, learned: 0, error: "" },
  },
  {
    id: "j_run",
    state: "running",
    repo: "Ravikisha/RaviKishan",
    profile: "personal",
    tool: "claude",
    orgId: "asap-god",
    task: "Draft the launch post for the YouTube channel and save it to notes",
    approvals: { asked: 1, allowed: 1, denied: 0 },
    elapsedMs: 9 * MIN,
    idleMs: 3.4 * MIN,
    startedAt: 1,
    result: null,
    error: "",
  },
  {
    id: "j_done",
    state: "done",
    repo: "Ravikisha/kontainer",
    profile: "work",
    tool: "claude",
    orgId: "relax",
    task: "Document the cgroups setup in the README",
    approvals: { asked: 1, allowed: 1, denied: 0 },
    elapsedMs: 18 * MIN,
    idleMs: 0,
    startedAt: 1,
    result: { kind: "pr", url: "https://github.com/Ravikisha/kontainer/pull/12" },
    error: "",
    memory: { recalled: 3, learned: 2, error: "" },
  },
  {
    id: "j_fail",
    state: "failed",
    repo: "Ravikisha/RaviKishan",
    profile: "personal",
    tool: "claude",
    orgId: "relax",
    task: "Upgrade next to 14",
    approvals: { asked: 2, allowed: 2, denied: 0 },
    elapsedMs: 6 * MIN,
    idleMs: 0,
    startedAt: 1,
    result: null,
    error: 'Verification failed at "npm run test:notes".',
  },
];

const EVENTS = {
  j_wait: [
    { type: "started", text: "" },
    { type: "text", text: "Reading the route and its tests." },
    { type: "tool", tool: "Read", text: "pages/api/notes.js" },
    { type: "tool", tool: "Bash", text: "npm run test:notes" },
    // Proof the redaction runs on the way out, not in the panel.
    { type: "result", text: "73 passed, 0 failed\nGITHUB_TOKEN=••••••••••••" },
    { type: "text", text: "Adding a limiter and a test that exercises the 429." },
  ],
};

const FEATURES = {
  personal: {
    asked: true,
    plugins: {
      plugins: [
        { id: "frontend-design@claude-plugins-official", name: "frontend-design", version: "1.2.0", enabled: true },
        { id: "caveman@caveman-plugins", name: "caveman", version: "0.4.1", enabled: false },
      ],
      marketplaces: [
        { name: "claude-plugins-official", source: "anthropics/claude-plugins-official" },
        { name: "caveman-plugins", source: "https://github.com/someone/caveman-plugins.git" },
      ],
      raw: "",
    },
    skills: [
      { name: "launch", description: "Take an idea from a sentence to a shipped, announced project.", source: "user", path: "skills/launch/SKILL.md" },
      { name: "frontend-design:frontend-design", description: "Distinctive, intentional visual design for new UI.", source: "plugin", path: "plugins/cache/x/SKILL.md" },
    ],
    mcp: {
      claude: "Checking MCP server health...\n\ngithub: npx -y @modelcontextprotocol/server-github - ✓ Connected\nfigma: https://mcp.figma.com/mcp (HTTP) - ✗ Failed to connect",
      codex: ["github"],
      perJob: ["site (www.ravikishan.me/api/mcp, with the job's org)", "agentd (approvals)"],
    },
    note: "",
  },
};

export default function AgentPreview() {
  const [tab, setTab] = useState("runs");
  const [open, setOpen] = useState("j_wait");
  const [now, setNow] = useState(0);
  const [seen, setSeen] = useState({});
  const [cards, setCards] = useState([]);
  const [flows, setFlows] = useState([]);
  const [profiles, setProfiles] = useState(PROFILES);
  const [featProfile, setFeatProfile] = useState("personal");

  // Everything that depends on the wall clock is built after mount, so the
  // hydration pass has nothing to disagree about.
  useEffect(() => {
    const t0 = Date.now();
    setNow(t0);
    setSeen(Object.fromEntries(JOBS.map((j) => [j.id, { receivedAt: t0 }])));
    setCards([
      {
        id: "a_1",
        jobId: "j_wait",
        tool: "Bash",
        summary: "Run: git push -u origin agent/j_wait",
        input: { command: "git push -u origin agent/j_wait" },
        cwd: "/home/agent/.agentd/work/j_wait",
        askedAt: t0,
        expiresAt: t0 + 8 * MIN,
      },
    ]);
    setFlows([
      {
        id: "l_codex",
        profile: "personal",
        tool: "codex",
        url: "https://auth.openai.com/codex/device",
        code: "KQ7M-W2PD",
        startedAt: t0 - 2 * MIN,
        expiresAt: t0 + 8 * MIN,
      },
      {
        id: "l_claude",
        profile: "work",
        tool: "claude",
        url: "https://claude.ai/oauth/authorize?code=true&client_id=preview",
        code: "",
        startedAt: t0 - MIN,
        expiresAt: t0 + 9 * MIN,
      },
    ]);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const job = (id) => JOBS.find((j) => j.id === id);
  const live = JOBS.filter((j) => ["queued", "running", "waiting", "stalled"].includes(j.state));

  return (
    <main
      className="admin-main ag-main"
      style={{ background: "#08090d", minHeight: "100vh", padding: "88px 20px 40px", boxSizing: "border-box" }}
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
          <button className="ag-halt" type="button">
            Stop everything
          </button>
        </span>
      </div>

      <AgentTabs tab={tab} onTab={setTab} counts={{ live: live.length, stuck: 1, flows: flows.length }} />

      {cards.length ? (
        <section className="ag-approvals" aria-label="Waiting for your approval">
          {cards.map((c) => (
            <ApprovalCard key={c.id} card={c} job={job(c.jobId)} onAnswer={() => setCards([])} />
          ))}
        </section>
      ) : null}

      <PreviewSection id="runs" title="Runs">
        <NewJob
          profiles={profiles}
          repos={[...new Set(JOBS.map((j) => j.repo))]}
          orgs={ORGS}
          features={FEATURES}
          disabled={false}
          onStart={() => {}}
        />
        <p className="ag-limits">
          3 of 4 running, 2 per profile, 50 a day. Quiet for 5m counts as stuck.
        </p>
        <RunBoard
          jobs={JOBS}
          approvals={cards}
          seen={seen}
          now={now}
          stallMs={5 * MIN}
          open={open}
          events={EVENTS}
          onOpen={(j) => setOpen(open === j.id ? null : j.id)}
          onStop={() => {}}
        />
      </PreviewSection>

      <PreviewSection id="accounts" title="Accounts on the box">
        <ProfileAccounts
          profiles={profiles}
          flows={flows}
          notes={{ "work:claude": { ok: false, text: "claude exited with code 1. Invalid code — open the link again and paste the newest one." } }}
          now={now}
          disabled={false}
          siteMcp={{ enabled: true }}
          onToken={(p, t, token) =>
            setProfiles((ps) =>
              ps.map((x) => (x.name === p ? { ...x, login: { ...x.login, [t]: { signedIn: true, method: "token", last4: token.slice(-4) } } } : x))
            )
          }
          onStartLogin={(p, t) =>
            setFlows((fs) => [...fs, { id: `l_${p}_${t}`, profile: p, tool: t, url: "", code: "", expiresAt: Date.now() + 10 * MIN }])
          }
          onCode={(id) => setFlows((fs) => fs.map((f) => (f.id === id ? { ...f, sent: true } : f)))}
          onCancel={(id) => setFlows((fs) => fs.filter((f) => f.id !== id))}
          onLogout={(p, t) =>
            setProfiles((ps) =>
              ps.map((x) => (x.name === p ? { ...x, login: { ...x.login, [t]: { signedIn: false, method: null, last4: "" } } } : x))
            )
          }
          onAddProfile={(name) => setProfiles((ps) => [...ps, { name, login: {} }])}
        />
      </PreviewSection>

      <PreviewSection id="features" title="Claude features">
        <FeaturesPanel
          profiles={profiles}
          profile={featProfile}
          onProfile={setFeatProfile}
          data={FEATURES[featProfile] || { asked: true }}
          disabled={false}
          onRefresh={() => {}}
          onInstall={() => {}}
          onRemove={() => {}}
          onAddMarket={() => {}}
        />
      </PreviewSection>

      <AgentStyles />
      <style jsx global>{`
        .admin-input {
          width: 100%;
          box-sizing: border-box;
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
        .admin-primary:disabled {
          opacity: 0.45;
          cursor: default;
        }
        .admin-sub {
          color: var(--a-dim, #8b90a0);
          font-size: 12.5px;
          font-weight: 400;
        }
        .admin-err {
          color: #ff8a8a;
          font-size: 12.5px;
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
        .ag-preview-h {
          margin: 34px 0 0;
          padding-top: 14px;
          border-top: 1px solid #23262f;
          font-family: "Space Grotesk", sans-serif;
          font-size: 13px;
          color: #5c6377;
          font-weight: 500;
        }
        body {
          margin: 0;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        }
      `}</style>
    </main>
  );
}

// Every tab's content stacked, under the name its tab carries, so the whole
// panel is one page to look at and one page to assert on.
function PreviewSection({ id, title, children }) {
  return (
    <section data-section={id}>
      <h2 className="ag-preview-h">{title}</h2>
      {children}
    </section>
  );
}

export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
