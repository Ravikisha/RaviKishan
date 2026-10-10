// Jarvis — the agent server, from inside the portfolio's own desktop.
//
// OWNER ONLY. This file is never fetched by a visitor: DesktopOS imports the
// app's registry entry (components/os/jarvisApp.js) only after useAdminGate
// has seen the allow-listed, verified address signed in, and that entry loads
// this module with a dynamic import. The socket itself checks the Firebase ID
// token and the allow-list on the server, so this is a view, not a boundary.
//
// It is the admin's Workbench, cut down to what you want from a desktop
// window: the box's screen (the default — it is the thing you open this to
// look at), a chat, a shell, and the runs that are live. Every view is the
// REAL workbench component; this file only holds the socket and the tabs.
//
// Lifecycle is the window's: opening it connects, closing it disconnects, and
// only the visible tab is mounted, so the screenshot stream polls only while
// the Desktop tab is on screen. A socket that cannot connect says so, with
// the reason, where the desktop would have been.
//
// A desktop app must not route (see .eslintrc.json): nothing here links out.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AgentClient, liveTimes, dur } from "../../../lib/agentClient";
import useWorkbench from "../../admin/workbench/useWorkbench";
import WorkbenchStyles from "../../admin/workbench/WorkbenchStyles";
import ChatView from "../../admin/workbench/ChatView";
import DesktopView from "../../admin/workbench/DesktopView";
import TerminalView from "../../admin/workbench/TerminalView";
import { ApprovalCard } from "../../admin/workbench/ApprovalCard";
import { AgentStyles, ConnectionDot, useArmed } from "../../admin/AgentPanel";

const TABS = [
  ["desktop", "Desktop"],
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
// a seeded frame. Everyone else gets the real AgentClient.
export default function Jarvis({ makeClient = null, initialTab = "desktop" }) {
  const [tab, setTab] = useState(initialTab);
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
            // about to close — keep it for the sentence that explains why.
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
    // One socket per window; makeClient is fixed for the window's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    runs: jobAsks.length ? { text: String(jobAsks.length), tone: "ask" } : stuck ? { text: `${stuck} stuck`, tone: "bad" } : live.length ? { text: String(live.length) } : null,
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

  return (
    <div className="jv-root wb-root" data-tab={tab} data-status={status}>
      <header className="jv-bar">
        <nav className="jv-tabs" role="tablist" aria-label="Jarvis views">
          {TABS.map(([k, label]) => {
            const b = badges[k];
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={`jv-tab${tab === k ? " on" : ""}`}
                data-tab={k}
                onClick={() => setTab(k)}
              >
                {label}
                {b ? <em className={b.tone ? `t-${b.tone}` : ""}>{b.text}</em> : null}
              </button>
            );
          })}
        </nav>
        <span className="jv-conn">
          <ConnectionDot status={down ? "closed" : status} />
          {host ? <code className="jv-host">{host}</code> : null}
        </span>
      </header>

      {err ? (
        <p className="admin-err jv-err" role="alert">
          {err}
        </p>
      ) : null}
      {ever && !connected ? (
        <p className="jv-lost" role="status">
          Connection lost. Reconnecting; what is on screen is the last thing the box sent.
        </p>
      ) : null}

      <div className={`jv-body jv-body-${tab}`}>
        {down ? (
          <section className="jv-down" role="alert" aria-label="Agent server unreachable">
            <h4>Can&apos;t reach the agent server</h4>
            <p className="jv-why">{failure}</p>
            <p className="jv-what">
              {host ? (
                <>
                  Tried <code>{host}</code>.{" "}
                </>
              ) : null}
              It keeps retrying in the background while this window is open, backing off up to 30 seconds between
              tries. Closing the window stops it.
            </p>
            <button type="button" className="admin-primary" onClick={retry}>
              Try now
            </button>
          </section>
        ) : tab === "desktop" ? (
          <>
            {wb.unsupported.desktop ? <p className="wb-note">{wb.unsupported.desktop}</p> : null}
            <DesktopView client={client.current} connected={connected} ops={wb.ops} />
          </>
        ) : tab === "chat" ? (
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
        ) : tab === "terminal" ? (
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
    <div className="jv-runs">
      {asks.length ? (
        <section className="jv-asks" aria-label="Waiting for your approval" aria-live="assertive">
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
        <p className="wb-empty">Nothing running. Runs started from the admin&apos;s Agent tab, or by a chat, show up here while they are live.</p>
      ) : (
        <ol className="jv-run-list" aria-label="Live runs">
          {jobs.map((job) => (
            <RunLine key={job.id} job={job} times={liveTimes(job, { now: now || Date.now(), ...(seen[job.id] || {}) })} connected={connected} onStop={() => onStop(job)} />
          ))}
        </ol>
      )}
    </div>
  );
}

function RunLine({ job, times, connected, onStop }) {
  const [armed, press] = useArmed();
  return (
    <li className={`jv-run s-${job.state}`} data-state={job.state}>
      <div className="jv-run-tx">
        <p className="jv-run-task">{job.task || job.id}</p>
        <p className="jv-run-meta">
          <span className="jv-run-v">{verdict(job, times)}</span>
          {job.repo ? <code>{job.repo}</code> : null}
          {job.profile ? <span>{job.profile}</span> : null}
        </p>
      </div>
      <button type="button" className={`ag-ghost danger jv-stop${armed ? " armed" : ""}`} disabled={!connected} onClick={() => press(onStop)}>
        {armed ? "Tap again to stop" : "Stop"}
      </button>
    </li>
  );
}

/* ---------------- styles ---------------- */

// The workbench is written for the admin's dark console and its viewport.
// Inside a window that is neither, three things are re-pointed here: the
// console palette and the admin controls (Styles in pages/admin.js is not
// loaded on the public site), and the viewport-sized heights the workbench
// uses on a desk and a phone, which must be the WINDOW's here.
function JarvisStyles() {
  return (
    <style jsx global>{`
      .jv-root {
        --a-void: #08090d;
        --a-panel: #111319;
        --a-raise: #171a22;
        --a-line: #1e222c;
        --a-dim: #7d8496;
        --a-text: #e9ebf2;
        --a-amber: #ffb020;
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        background: var(--a-void);
        color: var(--a-text);
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        font-size: 13px;
      }
      .jv-root.wb-root {
        padding-bottom: 0;
      }
      .jv-bar {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 0 14px;
        border-bottom: 1px solid var(--a-line);
        background: var(--a-panel);
        min-width: 0;
      }
      .jv-tabs {
        display: flex;
        gap: 2px;
        min-width: 0;
      }
      .jv-tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: none;
        border: 0;
        border-bottom: 2px solid transparent;
        color: var(--a-dim);
        font: inherit;
        font-size: 13px;
        padding: 11px 10px 9px;
        cursor: pointer;
        white-space: nowrap;
      }
      .jv-tab:hover {
        color: var(--a-text);
      }
      .jv-tab.on {
        color: var(--a-text);
        border-bottom-color: var(--a-amber);
      }
      .jv-tab em {
        font-style: normal;
        font-size: 11px;
        color: #6b7285;
      }
      .jv-tab em.t-ask {
        color: #1a1300;
        background: var(--a-amber);
        border-radius: 999px;
        padding: 0 6px;
      }
      .jv-tab em.t-bad {
        color: #ff8a8a;
      }
      .jv-tab:focus-visible {
        outline: 2px solid var(--a-amber);
        outline-offset: -2px;
      }
      .jv-conn {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .jv-host {
        font-size: 11px;
        color: #5c6377;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .jv-err,
      .jv-lost {
        flex: none;
        margin: 0;
        padding: 8px 14px;
        border-bottom: 1px solid var(--a-line);
        font-size: 12.5px;
      }
      .jv-lost {
        color: var(--a-amber);
      }
      .jv-body {
        flex: 1 1 auto;
        min-height: 0;
        min-width: 0;
        overflow: auto;
        padding: 14px;
        overscroll-behavior: contain;
      }

      /* the chat fills the window rather than the viewport */
      .jv-root .wb-chat {
        height: auto;
        min-height: 0;
      }
      @media (min-width: 1000px) {
        .jv-body-chat {
          overflow: hidden;
        }
        .jv-root .wb-chat {
          height: 100%;
        }
      }
      @media (max-width: 999px) {
        .jv-root .wb-composer {
          bottom: 0;
        }
      }

      /* what the admin's shared Styles would otherwise provide */
      .jv-root .admin-input {
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
      .jv-root .admin-input:focus {
        outline: none;
        border-color: var(--a-amber);
      }
      .jv-root .admin-primary {
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
      .jv-root .admin-primary:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .jv-root .admin-primary:focus-visible,
      .jv-root .admin-input:focus-visible {
        outline: 2px solid var(--a-amber);
        outline-offset: 2px;
      }
      .jv-root .admin-sub {
        color: var(--a-dim);
        font-size: 12.5px;
      }
      .jv-root .admin-err {
        color: #ff8a8a;
        font-size: 12.5px;
      }

      /* unreachable: said where the desktop would have been */
      .jv-down {
        max-width: 56ch;
        margin: 8vh 0 0;
        padding-left: 16px;
        border-left: 3px solid #ff8a8a;
      }
      .jv-down h4 {
        margin: 0 0 8px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 19px;
        font-weight: 600;
        color: var(--a-text);
      }
      .jv-why {
        margin: 0 0 10px;
        font-size: 14px;
        line-height: 1.5;
        color: var(--a-text);
      }
      .jv-what {
        margin: 0 0 16px;
        font-size: 12.5px;
        line-height: 1.55;
        color: var(--a-dim);
      }
      .jv-what code {
        color: var(--a-text);
        overflow-wrap: anywhere;
      }

      /* runs */
      .jv-runs {
        display: grid;
        gap: 14px;
        max-width: 860px;
      }
      .jv-asks {
        display: grid;
        gap: 12px;
      }
      .jv-run-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 6px;
      }
      .jv-run {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border: 1px solid var(--a-line);
        border-left: 3px solid #c9cdd8;
        border-radius: 8px;
        background: var(--a-panel);
        min-width: 0;
      }
      .jv-run.s-waiting {
        border-left-color: var(--a-amber);
      }
      .jv-run.s-stalled {
        border-left-color: #ff6b6b;
      }
      .jv-run.s-queued {
        border-left-style: dashed;
        border-left-color: #5c6377;
      }
      .jv-run-tx {
        flex: 1 1 auto;
        min-width: 0;
      }
      .jv-run-task {
        margin: 0;
        color: var(--a-text);
        font-size: 13.5px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .jv-run-meta {
        margin: 3px 0 0;
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        font-size: 12px;
        color: var(--a-dim);
        min-width: 0;
      }
      .jv-run-meta code {
        font-size: 11.5px;
        color: #a3a9b8;
        overflow-wrap: anywhere;
      }
      .jv-run.s-waiting .jv-run-v {
        color: var(--a-amber);
        font-weight: 600;
      }
      .jv-run.s-stalled .jv-run-v {
        color: #ff8a8a;
      }
      .jv-stop {
        flex: none;
      }

      @media (max-width: 640px) {
        .jv-bar {
          padding: 0 6px;
        }
        .jv-tab {
          padding: 10px 7px 8px;
          font-size: 12.5px;
        }
        .jv-host {
          display: none;
        }
        /* the dot says it; the word does not fit beside four tabs */
        .jv-conn .ag-conn {
          font-size: 0;
          gap: 0;
        }
        .jv-body {
          padding: 10px;
        }
        .jv-down {
          margin-top: 24px;
        }
      }
    `}</style>
  );
}
