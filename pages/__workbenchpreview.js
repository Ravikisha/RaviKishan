// Design reference for the Workbench, rendered with the REAL components.
//
// Chat, desktop, terminal, previews and review all need a live agentd over a
// WebSocket. This renders the same ChatView, DesktopView, TerminalView,
// PreviewsView, ReviewView and WorkbenchSwitcher against fixed data, every view
// stacked so one screenshot covers the lot — and the switcher at the top still
// works, so the phone layout can be driven one view at a time.
//
// The seed is chosen for the states that matter, not the happy one:
//   - a chat MID-TURN, with text still streaming, a tool call that FAILED
//     (which must never look done), a long code block that must scroll inside
//     itself rather than push the page sideways at 390px, and a push that is
//     WAITING on an approval card rendered inline under the call it is about
//   - 30 past conversations, so the list is searched, not looked at
//   - the desktop as the SCREENSHOT STREAM (the box has no VNC: x11vnc cannot
//     run under SELinux enforcing), once watching, once driving with a sign-in
//     too old to drive — a seeded, static frame from a fake client
//   - the desktop and the terminal DISCONNECTED, which is what a phone on a
//     train sees most of the time
//   - a review timeline holding every kind of entry, from every kind of actor,
//     with allowed, denied and automatic decisions
//
// Rendered after mount: the seed is dated relative to now, and the views print
// local times, both of which differ between the server render and the client.
//
// 404s in production: it is a design tool, not a page.
import React, { useEffect, useMemo, useState } from "react";
import WorkbenchSwitcher from "../components/admin/workbench/WorkbenchSwitcher";
import WorkbenchStyles from "../components/admin/workbench/WorkbenchStyles";
import ChatView from "../components/admin/workbench/ChatView";
import DesktopView from "../components/admin/workbench/DesktopView";
import TerminalView from "../components/admin/workbench/TerminalView";
import PreviewsView from "../components/admin/workbench/PreviewsView";
import ReviewView, { OP_KINDS } from "../components/admin/workbench/ReviewView";
import { AgentStyles, ConnectionDot } from "../components/admin/AgentPanel";

const MIN = 60000;

// A static "screenshot" of the box: a browser on the shared desktop. SVG so it
// is crisp and seeded, served exactly as the box serves a frame (base64 + mime).
const SHOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<rect width="1600" height="900" fill="#2b3a4a"/>
<rect x="0" y="868" width="1600" height="32" fill="#1b2430"/>
<text x="16" y="890" font-family="sans-serif" font-size="15" fill="#c9d1dc">Applications   Chromium   Terminal</text>
<text x="1500" y="890" font-family="sans-serif" font-size="15" fill="#c9d1dc">14:02</text>
<rect x="120" y="70" width="1360" height="760" rx="8" fill="#ffffff"/>
<rect x="120" y="70" width="1360" height="44" rx="8" fill="#dee1e6"/>
<rect x="300" y="80" width="900" height="26" rx="13" fill="#ffffff"/>
<text x="318" y="99" font-family="sans-serif" font-size="15" fill="#202124">https://ravikishan.me/blog/cgroups-from-scratch</text>
<text x="200" y="200" font-family="sans-serif" font-size="44" font-weight="bold" fill="#111111">cgroups from scratch</text>
<text x="200" y="250" font-family="sans-serif" font-size="20" fill="#555555">Building a container runtime one syscall at a time</text>
<rect x="200" y="300" width="1100" height="14" rx="7" fill="#e6e6e6"/>
<rect x="200" y="330" width="980" height="14" rx="7" fill="#e6e6e6"/>
<rect x="200" y="360" width="1040" height="14" rx="7" fill="#e6e6e6"/>
<rect x="200" y="420" width="1100" height="180" rx="8" fill="#0f1117"/>
<text x="230" y="470" font-family="monospace" font-size="20" fill="#e9ebf2">$ mkdir /sys/fs/cgroup/demo</text>
<text x="230" y="505" font-family="monospace" font-size="20" fill="#e9ebf2">$ echo 50000 100000 &gt; cpu.max</text>
<rect x="200" y="650" width="160" height="48" rx="8" fill="#1a73e8"/>
<text x="232" y="681" font-family="sans-serif" font-size="18" fill="#ffffff">Subscribe</text>
</svg>`;

// A fake agent client with just the desktop half. Every action it is sent is
// kept on window.__wbDesktopActions so e2e:workbench can read back what a click
// on the picture mapped to. `stale` refuses actions the way the box refuses
// a sign-in older than 30 minutes.
function fakeDesktopClient({ stale = false } = {}) {
  const data = typeof window === "undefined" ? "" : window.btoa(SHOT_SVG);
  return {
    desktopStatus: async () => ({ type: "desktop.status", display: "up", vnc: "down", browser: "up", screen: { width: 1600, height: 900 } }),
    desktopShot: async () => ({ type: "desktop.screenshot", format: "svg", mime: "image/svg+xml", data, width: 1600, height: 900, imageWidth: 1600, imageHeight: 900, takenAt: Date.now() }),
    desktopAction: async (a) => {
      if (typeof window !== "undefined") (window.__wbDesktopActions = window.__wbDesktopActions || []).push({ ...a, stale });
      if (stale) {
        const e = new Error("Driving the desktop needs a sign-in from the last 30 minutes. Sign in again, then retry.");
        e.status = 403;
        e.request = "desktop.action";
        throw e;
      }
      return { type: "desktop.acted", action: a.action, at: Date.now() };
    },
    reauth: async () => ({ type: "ready" }),
    desktopTicket: async () => {
      throw new Error("No VNC in the preview.");
    },
  };
}

const PROFILES = [{ name: "personal" }, { name: "work" }];
const ORGS = [
  { id: "relax", name: "Relax" },
  { id: "asap-god", name: "Asap God" },
];
const SKILLS = [
  { name: "launch", description: "Take an idea from a sentence to a shipped, announced project." },
  { name: "profile-sync", description: "Propagate a fact everywhere and detect drift." },
  { name: "resume-tailor", description: "Tailor the resume to a job description." },
];

// A long, wide block on purpose: it must scroll inside its own frame.
const CODE = `import { RateLimiterMemory } from "rate-limiter-flexible";

// One bucket per signed-in user, keyed on the Firebase uid rather than the IP address, because every request from the admin PWA on a phone shares one carrier-grade NAT address with thousands of strangers.
const limiter = new RateLimiterMemory({ points: 30, duration: 60, blockDuration: 120, keyPrefix: "notes" });

export default withEnv(async function handler(req, res) {
  const user = await verifyAdmin(req);
  try {
    await limiter.consume(user.uid);
  } catch (rej) {
    res.setHeader("Retry-After", String(Math.ceil(rej.msBeforeNext / 1000)));
    return res.status(429).json({ error: "Too many requests. Try again in a minute.", code: "rate/limited" });
  }
  return notesHandler(req, res, user);
});`;

function seed(now) {
  const t = (m) => now - m * MIN;
  const chats = [
    {
      chatId: "c_live",
      sessionId: "8f3a2c11-6b2e-4d0e-9a7f-1c2d3e4f5a6b",
      state: "waiting",
      title: "Add rate limiting to /api/notes and a test for it",
      profile: "personal",
      tool: "claude",
      model: "sonnet",
      repo: "Ravikisha/RaviKishan",
      orgId: "relax",
      policy: "allowlist",
    },
    { chatId: "c_work", sessionId: "2b7c9d0e-1111-4222-8333-944455566677", state: "thinking", title: "Why does the cgroup v2 fallback leak a mount?", profile: "work", tool: "codex", cwd: "/home/agent/work/chats/c_work", orgId: "relax" },
    { chatId: "c_idle", sessionId: "77aa88bb-0000-4000-8000-123456789abc", state: "idle", title: "Draft the launch post for the YouTube channel", profile: "personal", tool: "claude", orgId: "asap-god" },
  ];

  const events = [
    { type: "user", text: "Add rate limiting to /api/notes and a test for it. Keep it per user, not per IP." },
    { type: "started", sessionId: chats[0].sessionId, model: "claude-sonnet" },
    { type: "text", text: `I'll key the limiter on the Firebase uid. Here is the handler change:\n\n\`\`\`js\n${CODE}\n\`\`\`\n\nNow the test.` },
    { type: "tool", id: "t1", tool: "Read", input: { file_path: "pages/api/notes.js" } },
    { type: "result", id: "t1", isError: false, text: "1\t// Notes, one desk over four places.\n2\timport { withEnv } from \"../../lib/server/envStore.js\";\n…" },
    { type: "tool", id: "t2", tool: "Edit", input: { file_path: "pages/api/notes.js", old_string: "export default withEnv(handler);", new_string: "export default withEnv(limited(handler));" } },
    { type: "result", id: "t2", isError: false, text: "The file pages/api/notes.js has been updated." },
    { type: "tool", id: "t3", tool: "Bash", input: { command: "npm run test:notes" } },
    {
      type: "result",
      id: "t3",
      isError: true,
      text: "> test:notes\n> node scripts/notes-check.mjs\n\n  ✗ a 31st request inside a minute is refused with 429 — got 200\n\n72 passed, 1 failed\nnpm ERR! code 1",
    },
    { type: "delta", text: "The limiter is created per import, so the test's second " },
    { type: "delta", text: "module instance gets a fresh bucket. Moving it to module scope and pushing the branch so CI runs the whole suite" },
    { type: "tool", id: "t4", tool: "Bash", input: { command: "git push -u origin fix/notes-rate-limit" } },
  ];

  const approvals = [
    {
      id: "a_chat",
      jobId: "c_live",
      tool: "Bash",
      summary: "Run: git push -u origin fix/notes-rate-limit",
      input: { command: "git push -u origin fix/notes-rate-limit" },
      cwd: "/home/agent/work/chats/c_live",
      askedAt: now,
      expiresAt: now + 7 * MIN,
    },
    {
      id: "a_job",
      jobId: "j_wait",
      tool: "Write",
      summary: "Write .github/workflows/release.yml",
      input: { file_path: ".github/workflows/release.yml" },
      cwd: "/home/agent/.agentd/work/j_wait",
      askedAt: now,
      expiresAt: now + 4 * MIN,
    },
  ];

  const topics = [
    "Port the cgroup v1 fallback to v2",
    "Explain the SigV4 query-string canonicalisation",
    "Fix the flaky export suite on a busy machine",
    "Write the README for kontainer",
    "Why does mermaid taint the canvas",
    "Tidy the Tasks board column cap",
    "Audit the GitHub repos without topics",
    "Draft a LinkedIn post about the patent",
    "Migrate /about to the systems design",
    "Add an e2e for the Notes panel",
  ];
  const sessions = Array.from({ length: 30 }, (_, i) => ({
    sessionId: `${(0x1000 + i).toString(16)}a1b2c3-4d5e-4f60-8a7b-${String(100000000000 + i * 7919).slice(0, 12)}`,
    profile: i % 3 === 0 ? "work" : "personal",
    tool: i % 4 === 0 ? "codex" : "claude",
    title: `${topics[i % topics.length]}${i >= topics.length ? ` (${Math.floor(i / topics.length) + 1})` : ""}`,
    cwd: i % 2 ? `/home/agent/work/chats/c_${i}` : "/home/agent/work/repos/Ravikisha/RaviKishan",
    updatedAt: t(i * 97 + 3),
    messageCount: 4 + ((i * 7) % 40),
  }));

  const ops = [
    { at: t(0.2), actor: "chat:c_live", kind: "approval", summary: "Asked to run: git push -u origin fix/notes-rate-limit", detail: { tool: "Bash" } },
    { at: t(0.5), actor: "chat:c_live", kind: "command", summary: "npm run test:notes", detail: { exit: 1, cwd: "/home/agent/work/chats/c_live" } },
    { at: t(1), actor: "chat:c_live", kind: "file", summary: "Edited pages/api/notes.js", detail: { path: "pages/api/notes.js", bytes: 2311 } },
    { at: t(2), actor: "chat:c_work", kind: "browser", summary: "Opened https://docs.kernel.org/admin-guide/cgroup-v2.html", detail: { url: "https://docs.kernel.org/admin-guide/cgroup-v2.html" } },
    { at: t(2.4), actor: "chat:c_work", kind: "desktop", summary: "Clicked at 812, 440 in Chromium", detail: { x: 812, y: 440, button: "left" }, decision: "auto" },
    { at: t(3), actor: "owner", kind: "desktop", summary: "Typed 11 characters", detail: { text: "••••••••" } },
    { at: t(4), actor: "owner", kind: "terminal", summary: "systemctl status agentd-vnc --no-pager", detail: { cwd: "/home/agent" } },
    { at: t(6), actor: "owner", kind: "preview", summary: "Opened a preview of port 3000", detail: { port: 3000 } },
    { at: t(9), actor: "job:j_wait", kind: "approval", summary: "Denied: rm -rf node_modules/.cache && git clean -fdx", detail: { tool: "Bash" }, decision: "denied" },
    { at: t(11), actor: "job:j_wait", kind: "approval", summary: "Allowed: git commit -m 'Add release workflow'", decision: "allowed" },
    { at: t(14), actor: "mcp", kind: "command", summary: "desktop_action open_url https://ravikishan.me/blog", detail: { token: "••••••••" } },
    { at: t(20), actor: "mcp", kind: "browser", summary: "Navigated to https://ravikishan.me/blog/cgroups-from-scratch" },
  ];

  const ports = [
    { port: 3000, process: "node next dev (chat c_live)" },
    { port: 5173, process: "vite" },
    { port: 8787, process: "wrangler dev" },
  ];

  return { chats, events, approvals, sessions, ops, ports };
}

export default function WorkbenchPreview() {
  const [now, setNow] = useState(0);
  const [view, setView] = useState("chat");
  const [selected, setSelected] = useState({ chatId: "c_live" });
  const [extra, setExtra] = useState({});
  const [desk] = useState(() => ({ watch: fakeDesktopClient(), stale: fakeDesktopClient({ stale: true }) }));

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Seeded once, from the first real clock reading.
  const data = useMemo(() => (now ? seed(now) : null), [!!now]); // eslint-disable-line react-hooks/exhaustive-deps
  const [approvals, setApprovals] = useState(null);
  useEffect(() => {
    if (data && approvals === null) setApprovals(data.approvals);
  }, [data, approvals]);

  if (!data || approvals === null) {
    return <main style={{ background: "#08090d", minHeight: "100vh" }} />;
  }

  const eventsFor = (sel) => {
    if (sel?.chatId === "c_live") return [...data.events, ...(extra.c_live || [])];
    if (sel?.chatId) return [{ type: "user", text: data.chats.find((c) => c.chatId === sel.chatId)?.title || "" }, ...(extra[sel.chatId] || [])];
    if (sel?.session) return [{ type: "user", text: sel.session.title }, { type: "text", text: "This is a conversation read back from disk." }];
    return [];
  };

  const badges = {
    chat: { text: "1", tone: "ask" },
    review: { text: String(approvals.length), tone: "ask" },
    runs: { text: "1 stuck", tone: "bad" },
  };

  const show = (k) => view === k || view === "all";

  return (
    <main
      className="admin-main ag-main wb-root wb-preview"
      data-view={view}
      style={{
        background: "#08090d",
        color: "#e9ebf2",
        minHeight: "100vh",
        padding: "28px 20px 40px",
        boxSizing: "border-box",
      }}
    >
      <div className="ops-head">
        <div>
          <h3>Workbench</h3>
          <p className="admin-sub ag-sub">
            Claude Code and Codex on your own server: talk to them, watch the desktop they work on, open a shell.
            You approve the parts that cannot be undone.
          </p>
        </div>
        <span className="ag-actions">
          <ConnectionDot status="connected" />
          <button type="button" className="ag-ghost" onClick={() => setView(view === "all" ? "chat" : "all")}>
            {view === "all" ? "One view" : "Every view"}
          </button>
        </span>
      </div>

      <WorkbenchSwitcher view={view === "all" ? "chat" : view} onView={setView} badges={badges} />

      {show("chat") ? (
        <PreviewSection id="chat" title="Chat">
          <ChatView
            connected
            chats={data.chats}
            sessions={data.sessions}
            selected={selected}
            events={eventsFor(selected)}
            approvals={approvals}
            profiles={PROFILES}
            orgs={ORGS}
            skills={SKILLS}
            repos={["Ravikisha/RaviKishan", "Ravikisha/kontainer"]}
            now={now}
            onSelect={setSelected}
            onStart={() => {}}
            onSend={(chat, text) => chat && setExtra((x) => ({ ...x, [chat.chatId]: [...(x[chat.chatId] || []), { type: "user", text, local: true }] }))}
            onInterrupt={() => {}}
            onClose={() => {}}
            onResume={() => {}}
            onAnswer={(card) => setApprovals((a) => a.filter((c) => c.id !== card.id))}
          />
        </PreviewSection>
      ) : null}

      {show("desktop") ? (
        <>
          <PreviewSection id="desktop" title="Desktop, screenshot stream (no VNC on the box)">
            <DesktopView client={desk.watch} connected ops={data.ops} />
          </PreviewSection>
          <PreviewSection id="desktop-stale" title="Desktop, driving with a sign-in too old to drive">
            <DesktopView client={desk.stale} connected ops={data.ops} initialControl />
          </PreviewSection>
          <PreviewSection id="desktop-off" title="Desktop, disconnected">
            <DesktopView client={null} connected={false} ops={data.ops} />
          </PreviewSection>
        </>
      ) : null}

      {show("terminal") ? (
        <PreviewSection id="terminal" title="Terminal, disconnected">
          <TerminalView client={null} connected={false} />
        </PreviewSection>
      ) : null}

      {show("previews") ? (
        <PreviewSection id="previews" title="Previews">
          <PreviewsView
            client={null}
            connected
            ports={data.ports}
            now={now}
            initialOpen={{ port: 3000, url: "about:blank", expiresAt: now + 12 * MIN }}
          />
        </PreviewSection>
      ) : null}

      {show("review") ? (
        <PreviewSection id="review" title="Review">
          <ReviewView
            ops={data.ops}
            approvals={approvals}
            chats={data.chats}
            jobs={[{ id: "j_wait", repo: "Ravikisha/RaviKishan" }]}
            connected
            onAnswer={(card) => setApprovals((a) => a.filter((c) => c.id !== card.id))}
          />
          <p className="wb-note" data-kinds={OP_KINDS.join(",")}>
            Every kind the server records is in this seed: {OP_KINDS.join(", ")}.
          </p>
        </PreviewSection>
      ) : null}

      {["runs", "accounts", "features", "whatsapp"].includes(view) ? (
        <p className="wb-empty">This view is the existing agent panel; see /__agentpreview.</p>
      ) : null}

      <AgentStyles />
      <WorkbenchStyles />
      <style jsx global>{`
        .wb-preview {
          --a-void: #08090d;
          --a-panel: #111319;
          --a-raise: #171a22;
          --a-line: #1e222c;
          --a-dim: #7d8496;
          --a-text: #e9ebf2;
          --a-amber: #ffb020;
        }
        .admin-input {
          width: 100%;
          box-sizing: border-box;
          background: var(--a-void);
          border: 1px solid #2b3040;
          border-radius: 9px;
          color: var(--a-text);
          padding: 10px 12px;
          font: inherit;
          font-size: 13px;
        }
        .admin-input:focus {
          outline: none;
          border-color: var(--a-amber);
        }
        .admin-primary {
          background: var(--a-amber);
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
        .admin-primary:focus-visible,
        .admin-input:focus-visible {
          outline: 2px solid var(--a-amber);
          outline-offset: 2px;
        }
        .admin-sub {
          color: var(--a-dim);
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
          margin-bottom: 8px;
        }
        .ops-head h3 {
          margin: 0;
          font-size: 15px;
          color: #e7e8ee;
          font-family: "Space Grotesk", sans-serif;
        }
        .wb-preview-h {
          margin: 30px 0 12px;
          padding-top: 14px;
          border-top: 1px solid #23262f;
          font-family: "Space Grotesk", sans-serif;
          font-size: 13px;
          color: #5c6377;
          font-weight: 500;
        }
        body {
          margin: 0;
          background: #08090d;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        }
      `}</style>
    </main>
  );
}

function PreviewSection({ id, title, children }) {
  return (
    <section data-section={id}>
      <h2 className="wb-preview-h">{title}</h2>
      {children}
    </section>
  );
}

export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
