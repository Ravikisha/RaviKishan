// Design reference for the Jarvis desktop app, rendered with the REAL shell.
//
// This mounts the real DesktopOS with `forceOwner` — which a production build
// ignores, and this page is notFound there anyway — and opens the real Jarvis
// window against a FAKE agent socket: a seeded screenshot frame, two live
// runs (one waiting on an approval, one gone quiet) and a chat list. Nothing
// here talks to the box.
//
//   /__jarvispreview          connected, Desktop tab, the seeded frame
//   /__jarvispreview?fail=1   the socket never connects, with the reason
//
// e2e:jarvis drives it at 390 and 1440px.
import React, { useEffect, useState } from "react";
import DesktopOS from "../components/os/DesktopOS";

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

function fakeClient({ fail = false } = {}) {
  return ({ onState, onEvent }) => {
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
        if (fail) {
          setTimeout(() => {
            onEvent({ type: "error", error: "That account is not allowed to use the agent server." });
            onState({ status: "reconnecting" });
          }, 50);
          return;
        }
        setTimeout(() => !closed && onState({ status: "connected", jobs, approvals, profiles: [{ name: "personal" }, { name: "work" }] }), 50);
      },
      retryNow: async () => {},
      close: () => {
        closed = true;
        window.__jvClosed = (window.__jvClosed || 0) + 1;
      },
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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      localStorage.removeItem("os:wins");
      localStorage.setItem("os:welcomed", "1");
    } catch (_) {}
    setReady(true);
  }, []);

  // The owner's app registers asynchronously (its entry is imported after the
  // gate opens), so keep asking until the window exists.
  useEffect(() => {
    if (!ready) return undefined;
    const fail = new URLSearchParams(window.location.search).has("fail");
    const makeClient = fakeClient({ fail });
    const t = setInterval(() => {
      if (document.querySelector('.os-win[aria-label^="Jarvis"]')) return clearInterval(t);
      window.dispatchEvent(new CustomEvent("os:open", { detail: { id: "jarvis", props: { makeClient } } }));
    }, 300);
    return () => clearInterval(t);
  }, [ready]);

  return (
    <main style={{ minHeight: "100vh", background: "#08090d" }}>
      {ready ? <DesktopOS forceOwner /> : null}
    </main>
  );
}

export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
