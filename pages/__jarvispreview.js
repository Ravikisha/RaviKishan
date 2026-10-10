// Design reference for the admin's Jarvis tab, rendered with the REAL
// AdminShell, the real admin Styles and the real JarvisPanel, so it cannot
// drift from the signed-in interface. The panel is handed a FAKE agent
// socket: a seeded desktop pushed as real binary JPEG frames, live runs (one waiting on an approval,
// one gone quiet) and a chat list. Nothing here talks to the box.
//
//   /__jarvispreview          "Not connected" until Connect is pressed — as
//                             in the admin — then the seeded stream
//   /__jarvispreview?fail=1   Connect fails three times, with the reason
//   /__jarvispreview?poll=1   an agentd from before the push stream (polls)
//   /__jarvispreview?side=runs  opens with the side panel showing Runs
//   /__jarvispreview?tab=mcp    the MCP tab, for its "Connect from anywhere"
//
// e2e:jarvis drives it at 390, 768 and 1440px. 404s in production: it is a
// design tool, not a page.
import React, { useEffect, useState } from "react";
import AdminShell from "../components/admin/AdminShell";
import JarvisPanel from "../components/admin/JarvisPanel";
import McpPanel from "../components/admin/McpPanel";
import { Styles, TABS } from "./admin";
import { fakeDesktopStream } from "../components/admin/workbench/fakeDesktopStream";

const MIN = 60000;

const SHOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<rect width="1600" height="900" fill="#2b3a4a"/>
<rect x="0" y="868" width="1600" height="32" fill="#1b2430"/>
<text x="16" y="890" font-family="sans-serif" font-size="15" fill="#c9d1dc">Applications   Chromium   Terminal</text>
<rect x="120" y="70" width="1360" height="760" rx="8" fill="#ffffff"/>
<rect x="120" y="70" width="1360" height="44" rx="8" fill="#dee1e6"/>
<rect x="300" y="80" width="900" height="26" rx="13" fill="#ffffff"/>
<text x="318" y="99" font-family="sans-serif" font-size="15" fill="#202124">https://ravikishan.me/blog/cgroups-from-scratch</text>
<text x="200" y="200" font-family="sans-serif" font-size="44" font-weight="bold" fill="#111111">cgroups from scratch</text>
<rect x="200" y="300" width="1100" height="14" rx="7" fill="#e6e6e6"/>
<rect x="200" y="330" width="980" height="14" rx="7" fill="#e6e6e6"/>
<rect x="200" y="420" width="1100" height="180" rx="8" fill="#0f1117"/>
<text x="230" y="470" font-family="monospace" font-size="20" fill="#e9ebf2">$ mkdir /sys/fs/cgroup/demo</text>
</svg>`;

function fakeClient({ fail = false, poll = false } = {}) {
  return ({ onState, onEvent }) => {
    const stream = fakeDesktopStream({ svg: SHOT_SVG, key: "__jvStream" });
    window.__jvConnects = window.__jvConnects || 0;
    const now = Date.now();
    const data = window.btoa(SHOT_SVG);
    const jobs = [
      { id: "j_wait", state: "waiting", task: "Add a release workflow to kontainer", repo: "Ravikisha/kontainer", profile: "personal", elapsedMs: 6 * MIN, idleMs: 40000, startedAt: now - 6 * MIN },
      { id: "j_quiet", state: "stalled", task: "Port the cgroup v1 fallback to v2 and keep the old path behind a flag", repo: "Ravikisha/kontainer", profile: "work", elapsedMs: 22 * MIN, idleMs: 7 * MIN, startedAt: now - 22 * MIN },
      { id: "j_run", state: "running", task: "Write the e2e for the Notes panel", repo: "Ravikisha/RaviKishan", profile: "personal", elapsedMs: 3 * MIN, idleMs: 2000, startedAt: now - 3 * MIN },
      { id: "j_done", state: "done", task: "Tidy the Tasks board column cap", repo: "Ravikisha/RaviKishan", elapsedMs: 9 * MIN },
    ];
    const approvals = [
      { id: "a_job", jobId: "j_wait", tool: "Write", summary: "Write .github/workflows/release.yml", input: { file_path: ".github/workflows/release.yml" }, cwd: "/home/agent/.agentd/work/j_wait", askedAt: now, expiresAt: now + 4 * MIN },
    ];
    const emit = (m) => setTimeout(() => onEvent(m), 0);
    const actions = (window.__jvActions = []);
    let closed = false;
    return {
      url: "wss://agent.example.test",
      connect: async () => {
        window.__jvConnects += 1;
        closed = false;
        onState({ status: "connecting" });
        if (fail) {
          // What AgentClient does: three refused attempts, then it gives up.
          onEvent({ type: "error", error: "That account is not allowed to use the agent server." });
          setTimeout(() => onState({ status: "reconnecting", attempt: 2, of: 3, delayMs: 50 }), 30);
          setTimeout(() => onState({ status: "reconnecting", attempt: 3, of: 3, delayMs: 100 }), 90);
          setTimeout(() => onState({ status: "failed", attempts: 3 }), 160);
          return;
        }
        setTimeout(() => !closed && onState({ status: "connected", jobs, approvals, profiles: [{ name: "personal" }, { name: "work" }] }), 50);
      },
      retryNow: async () => {},
      close: () => {
        closed = true;
        stream.stopStream();
        window.__jvClosed = (window.__jvClosed || 0) + 1;
      },
      ...(poll ? {} : stream),
      send: () => {},
      chatList: () =>
        emit({
          type: "chats",
          live: [{ chatId: "c_live", state: "thinking", title: "Why does the cgroup v2 fallback leak a mount?", profile: "work", tool: "codex" }],
          history: [],
        }),
      opsList: () =>
        emit({
          type: "ops",
          rows: [
            { at: now - 0.4 * MIN, actor: "chat:c_live", kind: "browser", summary: "Opened https://docs.kernel.org/admin-guide/cgroup-v2.html" },
            { at: now - 2 * MIN, actor: "owner", kind: "desktop", summary: "Clicked at 812, 440 in Chromium" },
          ],
        }),
      previewList: () => emit({ type: "previews", ports: [] }),
      chatHistory: () => {},
      skills: () => {},
      answer: (id) => emit({ type: "approval.answered", id }),
      stop: () => {},
      desktopStatus: async () => ({ type: "desktop.status", display: "up", vnc: "down", browser: "up", screen: { width: 1600, height: 900 } }),
      desktopShot: async () => {
        window.__jvShots = (window.__jvShots || 0) + 1;
        return { type: "desktop.screenshot", mime: "image/svg+xml", data, width: 1600, height: 900, takenAt: Date.now() };
      },
      desktopAction: async (a) => {
        actions.push(a);
        return { type: "desktop.acted", action: a.action };
      },
      reauth: async () => ({ type: "ready" }),
      desktopTicket: async () => {
        throw new Error("No VNC in the preview.");
      },
      termOpen: async () => {
        throw new Error("No shell in the preview.");
      },
    };
  };
}

export default function JarvisPreview() {
  const [opts, setOpts] = useState(null);
  // Switching section really unmounts the panel, as in the admin, so the
  // suite can prove leaving the tab closes the socket.
  const [view, setView] = useState("jarvis");

  // After mount: the seed is dated relative to now and the views print local
  // times, both of which differ between the server render and the client.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setOpts({ fail: q.has("fail"), poll: q.has("poll"), side: q.get("side") || "" });
    if (q.get("tab") === "mcp") setView("mcp");
  }, []);

  return (
    <AdminShell tabs={TABS} view={view} onView={setView} email="ravikishan63392@gmail.com" onSignOut={() => {}}>
      {!opts ? null : view === "jarvis" ? (
        <JarvisPanel makeClient={fakeClient({ fail: opts.fail, poll: opts.poll })} initialSide={opts.side} />
      ) : view === "mcp" ? (
        // The MCP tab's "Connect from anywhere" section, with no sign-in: the
        // token list beneath it simply fails to load, which is fine here.
        <McpPanel user={null} />
      ) : (
        <p className="admin-sub jp-left" style={{ padding: "0 20px" }}>
          Left the Jarvis tab.
        </p>
      )}
      <Styles />
    </AdminShell>
  );
}

export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
