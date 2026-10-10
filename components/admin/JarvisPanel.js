// Jarvis — the agent server's desktop, as a remote-desktop view in the admin.
//
// ADMIN ONLY. It lives behind the admin's Firebase sign-in and allow-list like
// every other tab, and nothing on the public site imports it: the desktop-OS
// mode has no owner app, no gate and no agent address (e2e:jarvis asserts the
// public bundle is clean). The agent socket checks the ID token and the
// allow-list on the box as well, so this is a view, not a boundary.
//
// The shape is a remote desktop, not a dashboard: the box's screen is the
// page — as large as the content area allows, at the box's own aspect ratio,
// with a fullscreen button — and everything else (Chat, Terminal, Runs) is a
// side panel you pull over it. On a desk the panel sits beside the screen so
// you can watch a chat drive the browser; on a phone it is a full-height sheet
// over it. Every view is the REAL workbench component; this file holds only
// the socket, the layout and the run list.
//
// Opening it is view-only. "Take control" is DesktopView's, and driving needs
// a sign-in from the last 30 minutes (step-up in place, then the action is
// retried). Leaving the tab unmounts the panel and closes the socket.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AgentClient, liveTimes, dur } from "../../lib/agentClient";
import useWorkbench from "./workbench/useWorkbench";
import WorkbenchStyles from "./workbench/WorkbenchStyles";
import ChatView from "./workbench/ChatView";
import DesktopView from "./workbench/DesktopView";
import TerminalView from "./workbench/TerminalView";
import { ApprovalCard } from "./workbench/ApprovalCard";
import { AgentStyles, ConnectionDot, useArmed } from "./AgentPanel";

export const SIDE_TABS = [
  ["chat", "Chat"],
  ["terminal", "Terminal"],
  ["runs", "Runs"],
];

const LIVE = ["queued", "running", "waiting", "stalled"];
const ORDER = { waiting: 0, stalled: 1, running: 2, queued: 3 };

const hostOf = (url = "") => {
  try {
    return new URL(url).host;
  } catch (_) {
    return "";
  }
};

function useNow(ms = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// `makeClient` exists for /__jarvispreview, which hands in a fake socket with
// a seeded frame. The admin gets the real AgentClient.
export default function JarvisPanel({ makeClient = null, initialSide = "" }) {
  const [side, setSide] = useState(initialSide);
  const [status, setStatus] = useState("connecting");
  const [ever, setEver] = useState(false);
  const [failure, setFailure] = useState("");
  const [err, setErr] = useState("");
  const [jobs, setJobs] = useState([]);
  const [seen, setSeen] = useState({});
  const [approvals, setApprovals] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [skills, setSkills] = useState({});
  const [host, setHost] = useState("");
  const now = useNow();
  const client = useRef(null);
  const wb = useWorkbench(client);
  const wbRef = useRef(wb);
  wbRef.current = wb;
  const everRef = useRef(false);
  const lastErr = useRef("");
  const sideHead = useRef(null);

  const stamp = (list) =>
    setSeen((s) => {
      const t = Date.now();
      const next = { ...s };
      for (const j of list) next[j.id] = { ...(next[j.id] || {}), receivedAt: t };
      return next;
    });

  useEffect(() => {
    const handlers = {
      onState: (s) => {
        setStatus(s.status);
        if (s.status === "connected") {
          everRef.current = true;
          setEver(true);
          setFailure("");
          lastErr.current = "";
          setJobs(s.jobs || []);
          stamp(s.jobs || []);
          setApprovals(s.approvals || []);
          setProfiles(s.profiles || []);
          setTimeout(() => wbRef.current.onConnected(), 0);
        } else if (s.status === "reconnecting" && !everRef.current) {
          setFailure(
            lastErr.current ||
              "The agent server did not accept a connection. agentd may be stopped, or the tunnel in front of it is not answering."
          );
        }
      },
      onEvent: (msg) => {
        if (wbRef.current.handle(msg)) return;
        switch (msg.type) {
          case "job":
            stamp([msg.job]);
            return setJobs((js) => [msg.job, ...js.filter((x) => x.id !== msg.job.id)]);
          case "jobs":
            stamp(msg.jobs || []);
            return setJobs(msg.jobs || []);
          case "event":
            return setSeen((s) => ({ ...s, [msg.jobId]: { ...(s[msg.jobId] || {}), lastSeen: Date.now() } }));
          case "approval.asked":
            return setApprovals((a) => [msg.card, ...a.filter((c) => c.id !== msg.card.id)]);
          case "approval.answered":
            return setApprovals((a) => a.filter((c) => c.id !== msg.id));
          case "profiles":
            return setProfiles(msg.profiles || []);
          case "skills":
            return setSkills((k) => ({ ...k, [msg.profile]: msg.skills || [] }));
          case "error":
            // Before the first "ready", an error is the reason the socket is
            // about to close: keep it for the sentence that explains why.
            if (!everRef.current) lastErr.current = msg.error || "";
            else setErr(msg.error || "Refused.");
            return;
          default:
            return;
        }
      },
    };
    const c = makeClient ? makeClient(handlers) : new AgentClient(handlers);
    client.current = c;
    setHost(hostOf(c.url));
    Promise.resolve()
      .then(() => c.connect())
      .catch((e) => setFailure(e.message || "Could not connect."));
    return () => {
      try {
        c.close();
      } catch (_) {}
      client.current = null;
    };
    // One socket per mount; makeClient is fixed for the panel's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes the side panel; opening it moves focus into it.
  useEffect(() => {
    if (!side) return undefined;
    sideHead.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape" && !document.fullscreenElement) setSide("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [side]);

  const connected = status === "connected";
  const act = (fn) => {
    try {
      setErr("");
      fn();
    } catch (e) {
      setErr(e.message);
    }
  };
  const answer = (card, allow, scope) => act(() => client.current.answer(card.id, allow, { scope }));

  const live = useMemo(
    () => jobs.filter((j) => LIVE.includes(j.state)).sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9)),
    [jobs]
  );
  const jobAsks = approvals.filter((c) => !wb.chats.some((x) => x.chatId === (c.chatId || c.jobId)));
  const chatAsks = approvals.length - jobAsks.length;
  const stuck = live.filter((j) => j.state === "stalled").length;
  const badges = {
    chat: chatAsks ? { text: String(chatAsks), tone: "ask" } : null,
    runs: jobAsks.length
      ? { text: String(jobAsks.length), tone: "ask" }
      : stuck
      ? { text: `${stuck} stuck`, tone: "bad" }
      : live.length
      ? { text: String(live.length) }
      : null,
  };

  const retry = () => {
    setFailure("");
    lastErr.current = "";
    const c = client.current;
    if (!c) return;
    Promise.resolve()
      .then(() => (c.retryNow ? c.retryNow() : c.connect()))
      .catch((e) => setFailure(e.message || "Could not connect."));
  };

  const down = !ever && !!failure;
  const firstSkillProfile = profiles[0]?.name || "";
  const toggle = (k) => setSide((s) => (s === k ? "" : k));
  const sideLabel = (SIDE_TABS.find(([k]) => k === side) || [])[1] || "";

  return (
    <div className={`jp-root wb-root${side ? " has-side" : ""}`} data-side={side || "none"} data-status={status}>
      <div className="jp-strip">
        <span className="jp-conn">
          <ConnectionDot status={down ? "closed" : status} />
          {host ? <code className="jp-host">{host}</code> : null}
        </span>
        <nav className="jp-opens" aria-label="Side panel">
          {SIDE_TABS.map(([k, label]) => {
            const b = badges[k];
            return (
              <button
                key={k}
                type="button"
                className={`jp-open${side === k ? " on" : ""}`}
                data-side={k}
                aria-pressed={side === k}
                aria-controls="jp-side"
                onClick={() => toggle(k)}
              >
                {label}
                {b ? <em className={b.tone ? `t-${b.tone}` : ""}>{b.text}</em> : null}
              </button>
            );
          })}
        </nav>
      </div>

      {err ? (
        <p className="admin-err jp-msg" role="alert">
          {err}
        </p>
      ) : null}
      {ever && !connected ? (
        <p className="jp-msg jp-lost" role="status">
          Connection lost. Reconnecting; what is on screen is the last thing the box sent.
        </p>
      ) : null}

      <div className="jp-layout">
        <section className="jp-stage" aria-label="Server desktop">
          {down ? (
            <div className="jp-down" role="alert" aria-label="Agent server unreachable">
              <h4>Can&apos;t reach the agent server</h4>
              <p className="jp-why">{failure}</p>
              <p className="jp-what">
                {host ? (
                  <>
                    Tried <code>{host}</code>.{" "}
                  </>
                ) : null}
                It keeps retrying in the background while this tab is open, backing off up to 30 seconds between
                tries. Leaving the tab stops it.
              </p>
              <button type="button" className="admin-primary" onClick={retry}>
                Try now
              </button>
            </div>
          ) : (
            <>
              {wb.unsupported.desktop ? <p className="wb-note">{wb.unsupported.desktop}</p> : null}
              <DesktopView client={client.current} connected={connected} ops={wb.ops} />
            </>
          )}
        </section>

        {side ? (
          <aside id="jp-side" className={`jp-side jp-side-${side}`} aria-label={`Jarvis: ${sideLabel}`}>
            <header className="jp-side-head">
              <h3 tabIndex={-1} ref={sideHead}>
                {sideLabel}
              </h3>
              <button type="button" className="ag-ghost jp-side-x" onClick={() => setSide("")} aria-label="Close the side panel">
                Close
              </button>
            </header>
            <div className="jp-side-body">
              {side === "chat" ? (
                <ChatView
                  connected={connected}
                  chats={wb.chats}
                  sessions={wb.sessions}
                  selected={wb.selected}
                  events={wb.selectedEvents}
                  approvals={approvals}
                  profiles={profiles}
                  orgs={[]}
                  skills={skills[firstSkillProfile] || []}
                  repos={[...new Set(jobs.map((j) => j.repo).filter(Boolean))]}
                  now={now}
                  loading={wb.chatLoading}
                  busy={wb.busy}
                  error={wb.chatErr}
                  unsupported={wb.unsupported.chat || ""}
                  onSelect={wb.select}
                  onStart={wb.start}
                  onSend={wb.send}
                  onInterrupt={wb.interrupt}
                  onClose={wb.close}
                  onResume={wb.resume}
                  onAnswer={answer}
                  onRefresh={wb.refreshChats}
                  onNeedSkills={(p) => {
                    if (!p || skills[p] || !connected) return;
                    try {
                      client.current.skills(p);
                    } catch (_) {}
                  }}
                />
              ) : side === "terminal" ? (
                <>
                  {wb.unsupported.term ? <p className="wb-note">{wb.unsupported.term}</p> : null}
                  <TerminalView client={client.current} connected={connected} subscribe={wb.subscribe} />
                </>
              ) : (
                <Runs
                  jobs={live}
                  asks={jobAsks}
                  seen={seen}
                  now={now}
                  connected={connected}
                  onAnswer={answer}
                  onStop={(job) => act(() => client.current.stop(job.id))}
                />
              )}
            </div>
          </aside>
        ) : null}
      </div>

      <AgentStyles />
      <WorkbenchStyles />
      <JarvisStyles />
    </div>
  );
}

/* ---------------- runs: only what is live ---------------- */

function verdict(job, { elapsed, idle }) {
  switch (job.state) {
    case "waiting":
      return "Waiting on you";
    case "stalled":
      return `No output for ${dur(idle)}`;
    case "queued":
      return "Queued";
    default:
      return idle < 5000 ? `Working, ${dur(elapsed)} in` : `${dur(elapsed)} in, quiet ${dur(idle)}`;
  }
}

function Runs({ jobs, asks, seen, now, connected, onAnswer, onStop }) {
  return (
    <div className="jp-runs">
      {asks.length ? (
        <section className="jp-asks" aria-label="Waiting for your approval" aria-live="assertive">
          {asks.map((card) => (
            <ApprovalCard
              key={card.id}
              card={card}
              job={jobs.find((j) => j.id === card.jobId)}
              onAnswer={(allow, scope) => onAnswer(card, allow, scope)}
            />
          ))}
        </section>
      ) : null}
      {!jobs.length ? (
        <p className="wb-empty">Nothing running. Runs started from the Agent tab, or by a chat, show up here while they are live.</p>
      ) : (
        <ol className="jp-run-list" aria-label="Live runs">
          {jobs.map((job) => (
            <RunLine
              key={job.id}
              job={job}
              times={liveTimes(job, { now: now || Date.now(), ...(seen[job.id] || {}) })}
              connected={connected}
              onStop={() => onStop(job)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function RunLine({ job, times, connected, onStop }) {
  const [armed, press] = useArmed();
  return (
    <li className={`jp-run s-${job.state}`} data-state={job.state}>
      <div className="jp-run-tx">
        <p className="jp-run-task">{job.task || job.id}</p>
        <p className="jp-run-meta">
          <span className="jp-run-v">{verdict(job, times)}</span>
          {job.repo ? <code>{job.repo}</code> : null}
          {job.profile ? <span>{job.profile}</span> : null}
        </p>
      </div>
      <button
        type="button"
        className={`ag-ghost danger jp-stop${armed ? " armed" : ""}`}
        disabled={!connected}
        onClick={() => press(onStop)}
      >
        {armed ? "Tap again to stop" : "Stop"}
      </button>
    </li>
  );
}

/* ---------------- styles ---------------- */

// The workbench was written for a page of its own. Here the screen is the
// page, so three things are re-pointed: the frame is held to the height that
// is left (at the box's own ratio, never cropped), the desktop log goes under
// the frame instead of stealing 280px beside it, and the chat inside the side
// panel always uses its one-pane phone layout, because the panel is narrow
// whatever the viewport is.
export function JarvisStyles() {
  return (
    <style jsx global>{`
      .jp-root {
        --jp-room: 250px;
        min-width: 0;
        color: var(--a-text, #e9ebf2);
      }
      .jp-root.wb-root {
        padding-bottom: 0;
      }
      .jp-strip {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 0 20px 10px;
        min-width: 0;
      }
      .jp-conn {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .jp-host {
        font-size: 11px;
        color: #5c6377;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .jp-opens {
        display: flex;
        gap: 4px;
        flex: none;
      }
      .jp-open {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: none;
        border: 1px solid var(--a-line, #1e222c);
        border-left: 3px solid var(--a-line, #1e222c);
        border-radius: 8px;
        color: var(--a-dim, #7d8496);
        font: inherit;
        font-size: 13px;
        padding: 7px 11px;
        cursor: pointer;
        white-space: nowrap;
      }
      .jp-open:hover {
        color: var(--a-text, #e9ebf2);
      }
      .jp-open.on {
        color: var(--a-text, #e9ebf2);
        border-left-color: var(--a-amber, #ffb020);
      }
      .jp-open em {
        font-style: normal;
        font-size: 11px;
        color: #6b7285;
      }
      .jp-open em.t-ask {
        color: #1a1300;
        background: var(--a-amber, #ffb020);
        border-radius: 999px;
        padding: 0 6px;
      }
      .jp-open em.t-bad {
        color: #ff8a8a;
      }
      .jp-open:focus-visible {
        outline: 2px solid var(--a-amber, #ffb020);
        outline-offset: 2px;
      }
      /* focus is moved to the heading so a screen reader lands in the panel;
         it is not a control, so it wears no ring */
      .jp-side-head h3:focus {
        outline: none;
      }
      .jp-msg {
        margin: 0 20px 10px;
        font-size: 12.5px;
      }
      .jp-lost {
        color: var(--a-amber, #ffb020);
      }

      .jp-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-width: 0;
      }
      .jp-stage {
        min-width: 0;
        padding: 0 20px;
      }

      /* the frame: as large as the room left, at the box's own ratio */
      .jp-stage .wb-desk {
        grid-template-columns: minmax(0, 1fr);
      }
      .jp-stage .wb-screen {
        width: min(100%, calc((100vh - var(--jp-room)) * 16 / 9));
        width: min(100%, calc((100dvh - var(--jp-room)) * 16 / 9));
        margin-inline: auto;
      }
      .jp-stage .wb-screen.stream.live {
        width: fit-content;
        max-width: 100%;
      }
      .jp-stage .wb-screen.stream.live .wb-shot {
        width: auto;
        max-width: 100%;
        max-height: calc(100vh - var(--jp-room));
        max-height: calc(100dvh - var(--jp-room));
      }
      .jp-stage .wb-screen:fullscreen {
        width: 100vw;
        max-width: none;
        height: 100vh;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
      }
      .jp-stage .wb-screen:fullscreen .wb-shot {
        max-height: 100vh;
        max-width: 100vw;
      }
      .jp-stage .wb-desk-bar,
      .jp-stage .wb-desk-mode,
      .jp-stage .wb-deck {
        width: min(100%, calc((100vh - var(--jp-room)) * 16 / 9));
        width: min(100%, calc((100dvh - var(--jp-room)) * 16 / 9));
        margin-inline: auto;
      }

      /* the side panel */
      .jp-side {
        min-width: 0;
        background: var(--a-void, #08090d);
        display: flex;
        flex-direction: column;
      }
      .jp-side-head {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--a-line, #1e222c);
      }
      .jp-side-head h3 {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 16px;
        font-weight: 600;
        color: var(--a-text, #e9ebf2);
      }
      .jp-side-body {
        flex: 1 1 auto;
        min-height: 0;
        min-width: 0;
        overflow: auto;
        overscroll-behavior: contain;
        padding: 14px 16px;
      }
      /* one pane at a time in the panel, at every width */
      .jp-side .wb-chat {
        grid-template-columns: minmax(0, 1fr);
        height: auto;
        min-height: 0;
      }
      .jp-side .wb-chat.pane-talk .wb-chat-list,
      .jp-side .wb-chat.pane-list .wb-chat-main {
        display: none;
      }
      .jp-side .wb-to-list {
        display: inline-flex;
      }
      .jp-side .wb-composer {
        position: sticky;
        bottom: -14px;
        z-index: 4;
      }
      .jp-side .wb-term-frame {
        height: calc(100vh - 300px);
        height: calc(100dvh - 300px);
        min-height: 280px;
      }

      @media (min-width: 1000px) {
        .jp-root {
          --jp-room: 230px;
        }
        .jp-layout.jp-layout {
          align-items: start;
        }
        .jp-root.has-side .jp-layout {
          grid-template-columns: minmax(0, 1fr) clamp(360px, 34vw, 560px);
        }
        .jp-root.has-side .jp-stage {
          padding-right: 14px;
        }
        .jp-side {
          /* under the admin's sticky section header */
          position: sticky;
          top: 70px;
          height: calc(100vh - 84px);
          height: calc(100dvh - 84px);
          border-left: 1px solid var(--a-line, #1e222c);
        }
      }
      @media (max-width: 999px) {
        .jp-root {
          --jp-room: 330px;
        }
        /* a sheet over the screen; the admin's own section bar stays below */
        .jp-side {
          position: fixed;
          inset: 0;
          z-index: 90;
        }
        .jp-side-head {
          padding-top: calc(10px + env(safe-area-inset-top));
        }
      }
      @media (max-width: 640px) {
        .jp-strip {
          padding: 0 12px 10px;
        }
        .jp-stage {
          padding: 0 12px;
        }
        .jp-msg {
          margin: 0 12px 10px;
        }
        .jp-host {
          display: none;
        }
        .jp-open {
          padding: 7px 9px;
          font-size: 12.5px;
        }
        .jp-side-body {
          padding: 12px;
        }
        .jp-side .wb-composer {
          bottom: -12px;
        }
      }

      /* unreachable: said where the desktop would have been */
      .jp-down {
        max-width: 56ch;
        margin: 6vh 0 0;
        padding-left: 16px;
        border-left: 3px solid #ff8a8a;
      }
      .jp-down h4 {
        margin: 0 0 8px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 19px;
        font-weight: 600;
        color: var(--a-text, #e9ebf2);
      }
      .jp-why {
        margin: 0 0 10px;
        font-size: 14px;
        line-height: 1.5;
        color: var(--a-text, #e9ebf2);
      }
      .jp-what {
        margin: 0 0 16px;
        font-size: 12.5px;
        line-height: 1.55;
        color: var(--a-dim, #7d8496);
      }
      .jp-what code {
        color: var(--a-text, #e9ebf2);
        overflow-wrap: anywhere;
      }

      /* runs */
      .jp-runs {
        display: grid;
        gap: 14px;
      }
      .jp-asks {
        display: grid;
        gap: 12px;
      }
      .jp-run-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 6px;
      }
      .jp-run {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border: 1px solid var(--a-line, #1e222c);
        border-left: 3px solid #c9cdd8;
        border-radius: 8px;
        background: var(--a-panel, #111319);
        min-width: 0;
      }
      .jp-run.s-waiting {
        border-left-color: var(--a-amber, #ffb020);
      }
      .jp-run.s-stalled {
        border-left-color: #ff6b6b;
      }
      .jp-run.s-queued {
        border-left-style: dashed;
        border-left-color: #5c6377;
      }
      .jp-run-tx {
        flex: 1 1 auto;
        min-width: 0;
      }
      .jp-run-task {
        margin: 0;
        color: var(--a-text, #e9ebf2);
        font-size: 13.5px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .jp-run-meta {
        margin: 3px 0 0;
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        font-size: 12px;
        color: var(--a-dim, #7d8496);
        min-width: 0;
      }
      .jp-run-meta code {
        font-size: 11.5px;
        color: #a3a9b8;
        overflow-wrap: anywhere;
      }
      .jp-run.s-waiting .jp-run-v {
        color: var(--a-amber, #ffb020);
        font-weight: 600;
      }
      .jp-run.s-stalled .jp-run-v {
        color: #ff8a8a;
      }
      .jp-stop {
        flex: none;
      }
    `}</style>
  );
}
