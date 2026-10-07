// The agent server, from your phone.
//
// DESIGN
//
// Everything in this panel is secondary to one moment: the agent has stopped
// and is asking whether it may do something you cannot undo. That moment is
// the product. So the approval card is the only loud element on the page, it
// sits above everything else, and **Deny is the larger, closer target** —
// the asymmetry is deliberate, because a mistaken deny costs a tap and a
// mistaken allow costs a repository.
//
// The transcript is deliberately quiet. It is reassurance, not the interface:
// you glance at it to see the thing is alive, and you read it properly only
// when something went wrong.
//
// Voice is an ENHANCEMENT and never the only route. The microphone button
// appears only where the Web Speech API exists, and everything it does can be
// typed. Speaking a task is convenience; it is not a second code path.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentClient,
  speechSupported,
  listen,
  say,
  parseCommand,
} from "../../lib/agentClient";
import WhatsappPanel from "./WhatsappPanel";

// Whether this browser can hear you is not knowable on the server, so it is
// decided after mount. Calling speechSupported() during render makes the server
// HTML and the first client render disagree, which React reports as a hydration
// failure — and the panel then re-renders from scratch.
function useSpeech() {
  const [can, setCan] = useState(false);
  useEffect(() => setCan(speechSupported()), []);
  return can;
}

const STATE_TONE = {
  queued: "idle",
  running: "live",
  waiting: "ask",
  done: "ok",
  failed: "bad",
  stopped: "idle",
};

/* ================= the panel ================= */

export default function AgentPanel({ user }) {
  const [status, setStatus] = useState("connecting");
  const [jobs, setJobs] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [limits, setLimits] = useState(null);
  const [halted, setHalted] = useState(false);
  const [open, setOpen] = useState(null);
  const [events, setEvents] = useState({});
  const [err, setErr] = useState("");
  const [voice, setVoice] = useState(false);
  const [tab, setTab] = useState("jobs");
  const [wa, setWa] = useState({ status: null, chats: [], thread: null });
  const canSpeak = useSpeech();
  const client = useRef(null);

  /* ---------------- connection ---------------- */

  useEffect(() => {
    const c = new AgentClient({
      onState: (s) => {
        setStatus(s.status);
        if (s.status === "connected") {
          // Asked for once a socket exists, so the WhatsApp section is not a
          // blank box until something else happens to refresh it.
          setTimeout(() => {
            try {
              client.current?.send({ type: "whatsapp", action: "status" });
              client.current?.send({ type: "whatsapp", action: "chats", limit: 60 });
            } catch (_) {}
          }, 0);
          setJobs(s.jobs || []);
          setApprovals(s.approvals || []);
          setProfiles(s.profiles || []);
          setLimits(s.limits || null);
          setHalted(!!s.halted);
          setErr("");
        }
      },
      onEvent: (msg) => {
        switch (msg.type) {
          case "job":
            return setJobs((js) => [msg.job, ...js.filter((j) => j.id !== msg.job.id)]);
          case "jobs":
            return setJobs(msg.jobs || []);
          case "event":
            return setEvents((e) => ({
              ...e,
              [msg.jobId]: [...(e[msg.jobId] || []).slice(-400), msg.event],
            }));
          case "transcript":
            return setEvents((e) => ({ ...e, [msg.jobId]: msg.events || [] }));
          case "approval.asked":
            setApprovals((a) => [msg.card, ...a]);
            // The whole reason this panel exists on a phone.
            say(`Approval needed: ${msg.card.summary}`, { enabled: voice });
            return;
          case "approval.answered":
            return setApprovals((a) => a.filter((c) => c.id !== msg.id));
          case "halted":
            return setHalted(true);
          case "resumed":
            return setHalted(false);
          case "profiles":
            return setProfiles(msg.profiles || []);
          case "whatsapp":
            // One reply shape for every action, so the panel does not need a
            // branch per capability.
            return setWa((w) => {
              if (msg.action === "chats") return { ...w, chats: msg.result?.chats || [] };
              if (msg.action === "read") return { ...w, thread: msg.result };
              if (msg.action === "status" || msg.action === "connect") {
                return { ...w, status: msg.result?.sessions ? msg.result : { ...w.status, sessions: [msg.result] } };
              }
              return w;
            });
          case "whatsapp.qr":
          case "whatsapp.open":
          case "whatsapp.close":
            // A connection event changes what the panel may do, so re-ask
            // rather than trying to patch the status locally.
            try {
              client.current?.send({ type: "whatsapp", action: "status" });
            } catch (_) {}
            return;
          case "whatsapp.message":
            // New traffic invalidates both the chat list and the open thread.
            try {
              client.current?.send({ type: "whatsapp", action: "chats", limit: 60 });
            } catch (_) {}
            return;
          case "error":
            return setErr(msg.error);
          default:
            return;
        }
      },
    });
    client.current = c;
    c.connect().catch((e) => setErr(e.message));
    return () => c.close();
    // Connect once; `voice` is read through the ref-free closure below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const repos = useMemo(
    () => [...new Set(jobs.map((j) => j.repo).filter(Boolean))],
    [jobs]
  );

  const openJob = (job) => {
    setOpen(job.id);
    try {
      client.current.transcript(job.id);
    } catch (_) {}
  };

  const act = (fn) => {
    try {
      setErr("");
      fn();
    } catch (e) {
      setErr(e.message);
    }
  };

  const live = jobs.filter((j) => ["queued", "running", "waiting"].includes(j.state));

  // WhatsApp actions go over the same socket as everything else. Returning a
  // promise lets the compose box show "Sending…" and surface a refusal.
  const waAction = (msg) =>
    new Promise((resolve, reject) => {
      try {
        client.current.send({ type: "whatsapp", ...msg });
        resolve();
      } catch (e) {
        reject(e);
      }
    });

  return (
    <div className="ag-main">
      <div className="ops-head">
        <div>
          <h3>Agent</h3>
          <p className="admin-sub ag-sub">
            Claude Code and Codex on your own server. Jobs run there; you approve the parts
            that cannot be undone.
          </p>
        </div>
        <span className="ag-actions">
          <ConnectionDot status={status} />
          {canSpeak ? (
            <label className="ag-toggle" title="Speak status and approvals aloud">
              <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
              Speak
            </label>
          ) : null}
          <button
            className={halted ? "admin-primary" : "ag-halt"}
            type="button"
            onClick={() => act(() => (halted ? client.current.resume() : client.current.halt("Stopped from the panel.")))}
          >
            {halted ? "Resume" : "Stop everything"}
          </button>
        </span>
      </div>

      <div className="ag-tabs" role="tablist">
        {[
          ["jobs", `Jobs${live.length ? ` (${live.length})` : ""}`],
          ["whatsapp", "WhatsApp"],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`ag-tab${tab === k ? " on" : ""}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {err ? <p className="admin-err">{err}</p> : null}
      {halted ? (
        <p className="ag-halted">
          Halted. Nothing new will start until you resume. Jobs already running were asked to stop.
        </p>
      ) : null}

      {/* The one loud thing. Above everything, because it is the only part
          that is blocking on you. */}
      {approvals.length ? (
        <section className="ag-approvals" aria-label="Waiting for your approval">
          {approvals.map((card) => (
            <ApprovalCard
              key={card.id}
              card={card}
              job={jobs.find((j) => j.id === card.jobId)}
              onAnswer={(allow, scope) => act(() => client.current.answer(card.id, allow, { scope }))}
            />
          ))}
        </section>
      ) : null}

      {tab === "whatsapp" ? (
        <WhatsappPanel
          client={client.current}
          status={wa.status}
          chats={wa.chats}
          thread={wa.thread}
          onAction={waAction}
        />
      ) : (
      <>
      <NewJob
        profiles={profiles}
        repos={repos}
        disabled={status !== "connected" || halted}
        onStart={(job) => act(() => client.current.start(job))}
      />

      {limits ? (
        <p className="ag-limits">
          {live.length} of {limits.global} running · {limits.perProfile} per profile · {limits.perDay} a day
        </p>
      ) : null}

      <div className="ag-jobs">
        {jobs.length === 0 ? (
          <p className="ag-none">No jobs yet. Describe one above.</p>
        ) : (
          jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              open={open === job.id}
              events={events[job.id] || []}
              onOpen={() => (open === job.id ? setOpen(null) : openJob(job))}
              onStop={() => act(() => client.current.stop(job.id))}
            />
          ))
        )}
      </div>

      </>
      )}

      <AgentStyles />
    </div>
  );
}

/* ================= pieces ================= */

export function ConnectionDot({ status }) {
  const label = {
    connecting: "Connecting…",
    connected: "Connected",
    reconnecting: "Reconnecting…",
    closed: "Disconnected",
  }[status] || status;
  return (
    <span className={`ag-conn ${status}`} title={label}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

export function ApprovalCard({ card, job, onAnswer }) {
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

  const mins = left === null ? 0 : Math.floor(left / 60000);
  const secs = left === null ? 0 : Math.floor((left % 60000) / 1000);

  return (
    <article className="ag-card">
      <header>
        <strong>{card.tool}</strong>
        <span className="ag-card-repo">{job?.repo || card.jobId}</span>
        <span className={`ag-card-clock${left !== null && left < 60000 ? " soon" : ""}`}>
          {left === null ? "…" : `${mins}:${String(secs).padStart(2, "0")} left`}
        </span>
      </header>

      <p className="ag-card-summary">{card.summary}</p>

      {card.input?.command ? <pre className="ag-card-cmd">{card.input.command}</pre> : null}
      {card.cwd ? <p className="ag-card-cwd">{card.cwd}</p> : null}

      <p className="ag-card-note">
        No answer means no. If this expires it is refused and the job stops there.
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
          Allow this exact command for the job
        </button>
      </div>
    </article>
  );
}

export function NewJob({ profiles, repos, disabled, onStart }) {
  const canSpeak = useSpeech();
  const [task, setTask] = useState("");
  const [repo, setRepo] = useState("");
  const [profile, setProfile] = useState("");
  const [policy, setPolicy] = useState("allowlist");
  const [finish, setFinish] = useState("pr");
  const [hearing, setHearing] = useState(false);
  const stopRef = useRef(null);

  const mic = () => {
    if (hearing) {
      stopRef.current?.();
      return;
    }
    setHearing(true);
    stopRef.current = listen({
      onText: (text, final) => {
        setTask(text);
        if (!final) return;
        // Routing words only — the task itself goes to the agent verbatim.
        const parsed = parseCommand(text, {
          repos,
          profiles: profiles.map((p) => p.name),
          defaults: { repo, profile },
        });
        setTask(parsed.task);
        if (parsed.repo) setRepo(parsed.repo);
        if (parsed.profile) setProfile(parsed.profile);
        if (parsed.finish) setFinish(parsed.finish);
      },
      onEnd: () => setHearing(false),
      onError: () => setHearing(false),
    });
  };

  const submit = (e) => {
    e.preventDefault();
    if (!task.trim() || !repo.trim()) return;
    onStart({ task: task.trim(), repo: repo.trim(), profile, policy, finish });
    setTask("");
  };

  return (
    <form className="ag-new" onSubmit={submit}>
      <div className="ag-task-row">
        <textarea
          className="admin-input ag-task"
          rows={2}
          placeholder="What should it do? e.g. add rate limiting to /api/notes and a test for it"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          disabled={disabled}
        />
        {canSpeak ? (
          <button
            type="button"
            className={`ag-mic${hearing ? " on" : ""}`}
            onClick={mic}
            disabled={disabled}
            aria-label={hearing ? "Stop listening" : "Speak the task"}
            title={hearing ? "Listening — tap to stop" : "Speak the task"}
          >
            {hearing ? "Listening…" : "Speak"}
          </button>
        ) : null}
      </div>

      <div className="ag-row">
        <label className="ag-field">
          <span>Repository</span>
          <input
            className="admin-input"
            list="ag-repos"
            placeholder="owner/name"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            disabled={disabled}
          />
          <datalist id="ag-repos">
            {repos.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>

        <label className="ag-field">
          <span>Account</span>
          <select className="admin-input" value={profile} onChange={(e) => setProfile(e.target.value)} disabled={disabled}>
            <option value="">default</option>
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.claude ? "" : " (not signed in)"}
              </option>
            ))}
          </select>
        </label>

        <label className="ag-field">
          <span>Asks</span>
          <select className="admin-input" value={policy} onChange={(e) => setPolicy(e.target.value)} disabled={disabled}>
            <option value="manual">everything</option>
            <option value="allowlist">writes and pushes</option>
          </select>
        </label>

        <label className="ag-field">
          <span>Finish</span>
          <select className="admin-input" value={finish} onChange={(e) => setFinish(e.target.value)} disabled={disabled}>
            <option value="pr">open a PR</option>
            <option value="patch">show me a diff</option>
            <option value="deploy">push and deploy</option>
          </select>
        </label>

        <button className="admin-primary" type="submit" disabled={disabled || !task.trim() || !repo.trim()}>
          Start
        </button>
      </div>
    </form>
  );
}

export function JobRow({ job, open, events, onOpen, onStop }) {
  const tone = STATE_TONE[job.state] || "idle";
  const bodyRef = useRef(null);

  // Follow the tail while it runs, so a glance shows the latest line.
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [events.length, open]);

  return (
    <article className={`ag-job ${tone}${open ? " is-open" : ""}`} data-job={job.id}>
      <button type="button" className="ag-job-head" onClick={onOpen} aria-expanded={open}>
        <span className={`ag-state ${tone}`}>{job.state}</span>
        <span className="ag-job-task">{job.task}</span>
        <span className="ag-job-meta">
          {job.repo}
          {job.profile ? ` · ${job.profile}` : ""}
          {job.approvals?.asked ? ` · ${job.approvals.allowed}/${job.approvals.asked} allowed` : ""}
        </span>
      </button>

      {open ? (
        <div className="ag-job-body">
          <div className="ag-transcript" ref={bodyRef}>
            {events.length === 0 ? (
              <p className="ag-none">No output yet.</p>
            ) : (
              events.map((e, i) => <Line key={i} e={e} />)
            )}
          </div>

          <div className="ag-job-actions">
            {job.result?.url ? (
              <a className="ag-link" href={job.result.url} target="_blank" rel="noreferrer noopener">
                Open the pull request
              </a>
            ) : null}
            {job.error ? <span className="ag-error">{job.error}</span> : null}
            {["queued", "running", "waiting"].includes(job.state) ? (
              <button className="ag-halt" type="button" onClick={onStop}>
                Stop this job
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function Line({ e }) {
  if (e.type === "delta") return <span className="ag-delta">{e.text}</span>;
  // Every modifier is ag- prefixed. A bare "text" class would pick up the
  // global, unscoped `.text` rule in styles/components_styles/_map.scss —
  // white, Poppins, heading-sized — which is the same collision that once made
  // every KaTeX \text{} invisible on the blog.
  const kind =
    e.type === "tool" ? "tool" : e.type === "stderr" || e.failed ? "bad" : e.type === "finished" ? "ok" : e.type;
  return (
    <p className={`ag-line ag-${kind}`}>
      {e.type === "tool" ? <b>{e.tool}</b> : null}
      {e.text}
    </p>
  );
}

/* ================= styles ================= */

export function AgentStyles() {
  return (
    <style jsx global>{`
      .ag-main {
        max-width: none;
      }
      .ag-sub {
        margin: 6px 0 0;
        max-width: 64ch;
        line-height: 1.5;
      }
      .ag-actions {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .ag-conn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      .ag-conn i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #5c6377;
      }
      .ag-conn.connected i {
        background: #4ade80;
      }
      .ag-conn.reconnecting i,
      .ag-conn.connecting i {
        background: var(--a-amber, #ffb020);
      }
      .ag-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
        cursor: pointer;
      }
      .ag-tabs {
        display: flex;
        gap: 6px;
        margin: 14px 0 4px;
      }
      .ag-tab {
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 999px;
        color: var(--a-dim, #8b90a0);
        padding: 6px 14px;
        font: inherit;
        font-size: 12.5px;
        cursor: pointer;
      }
      .ag-tab.on {
        border-color: var(--a-amber, #ffb020);
        color: var(--a-text, #e7e8ee);
      }
      .ag-halt {
        background: none;
        border: 1px solid #5a2a30;
        color: #ff8a8a;
        border-radius: 9px;
        padding: 9px 14px;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .ag-halted {
        margin: 12px 0;
        padding: 10px 13px;
        border-radius: 9px;
        border: 1px solid #5a2a30;
        background: rgba(163, 59, 69, 0.12);
        color: #ff9a9a;
        font-size: 12.5px;
      }

      /* ---- the one loud thing ---- */
      .ag-approvals {
        display: grid;
        gap: 10px;
        margin: 16px 0;
      }
      .ag-card {
        border: 1px solid var(--a-amber, #ffb020);
        border-left-width: 4px;
        border-radius: 12px;
        background: rgba(255, 176, 32, 0.06);
        padding: 14px 16px;
      }
      .ag-card header {
        display: flex;
        align-items: baseline;
        gap: 10px;
        flex-wrap: wrap;
      }
      .ag-card header strong {
        font-family: "Space Grotesk", sans-serif;
        font-size: 14px;
        color: var(--a-text, #e7e8ee);
      }
      .ag-card-repo {
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      .ag-card-clock {
        margin-left: auto;
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      .ag-card-clock.soon {
        color: #ff8a8a;
      }
      .ag-card-summary {
        margin: 8px 0 0;
        font-size: 14px;
        color: var(--a-text, #e7e8ee);
        line-height: 1.45;
      }
      .ag-card-cmd {
        margin: 8px 0 0;
        padding: 9px 11px;
        background: var(--a-void, #0d0e13);
        border-radius: 8px;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-all;
        color: #ffd79a;
      }
      .ag-card-cwd,
      .ag-card-note {
        margin: 7px 0 0;
        font-size: 11px;
        color: var(--a-dim, #7d8496);
      }
      .ag-card-actions {
        display: flex;
        gap: 8px;
        margin-top: 13px;
        flex-wrap: wrap;
      }
      /* Deny is the biggest, first target. The asymmetry is the point. */
      .ag-deny {
        flex: 1 1 140px;
        background: #43171c;
        color: #ffb4b4;
        border: 1px solid #6d2a31;
        border-radius: 9px;
        padding: 13px 18px;
        font: inherit;
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
      }
      .ag-allow,
      .ag-allow-session {
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        color: var(--a-text, #e7e8ee);
        border-radius: 9px;
        padding: 10px 14px;
        font: inherit;
        font-size: 12.5px;
        cursor: pointer;
      }
      .ag-allow-session {
        color: var(--a-dim, #8b90a0);
        font-size: 11.5px;
      }

      /* ---- new job ---- */
      .ag-new {
        margin: 16px 0;
        display: grid;
        gap: 10px;
      }
      .ag-task-row {
        display: flex;
        gap: 8px;
        align-items: stretch;
      }
      .ag-task {
        flex: 1;
        font-family: inherit;
        font-size: 14px;
      }
      .ag-mic {
        flex: none;
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 9px;
        color: var(--a-dim, #8b90a0);
        padding: 0 16px;
        font: inherit;
        font-size: 12.5px;
        cursor: pointer;
      }
      .ag-mic.on {
        border-color: var(--a-amber, #ffb020);
        color: var(--a-amber, #ffb020);
      }
      .ag-row {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: flex-end;
      }
      .ag-field {
        display: flex;
        flex-direction: column;
        gap: 5px;
        flex: 1 1 160px;
        min-width: 0;
      }
      .ag-field > span {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
      }
      .ag-limits {
        margin: 0 0 12px;
        font-size: 11.5px;
        color: #5c6377;
      }

      /* ---- jobs ---- */
      .ag-jobs {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .ag-none {
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
        padding: 10px 2px;
        margin: 0;
      }
      .ag-job {
        border: 1px solid var(--a-line, #23262f);
        border-left: 3px solid transparent;
        border-radius: 10px;
        background: var(--a-raise, #15171d);
        overflow: hidden;
      }
      .ag-job.live {
        border-left-color: var(--a-amber, #ffb020);
      }
      .ag-job.ask {
        border-left-color: #ffd79a;
      }
      .ag-job.bad {
        border-left-color: #a33b45;
      }
      .ag-job.ok {
        border-left-color: #2f6b45;
      }
      .ag-job-head {
        width: 100%;
        display: flex;
        align-items: baseline;
        gap: 10px;
        padding: 11px 14px;
        background: none;
        border: 0;
        text-align: left;
        font: inherit;
        color: inherit;
        cursor: pointer;
        flex-wrap: wrap;
      }
      .ag-state {
        font-size: 10.5px;
        text-transform: lowercase;
        border: 1px solid var(--a-line, #2a2e38);
        border-radius: 999px;
        padding: 1px 8px;
        color: var(--a-dim, #7d8496);
        flex: none;
      }
      .ag-state.live,
      .ag-state.ask {
        color: var(--a-amber, #ffb020);
        border-color: rgba(255, 176, 32, 0.4);
      }
      .ag-state.bad {
        color: #ff8a8a;
        border-color: #5a2a30;
      }
      .ag-job-task {
        flex: 1;
        min-width: 160px;
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
      }
      .ag-job-meta {
        font-size: 11px;
        color: #5c6377;
      }
      .ag-job-body {
        border-top: 1px solid var(--a-line, #23262f);
        padding: 10px 14px 14px;
      }
      .ag-transcript {
        max-height: 44vh;
        overflow-y: auto;
        background: var(--a-void, #0d0e13);
        border-radius: 8px;
        padding: 10px 12px;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11.5px;
        line-height: 1.55;
      }
      .ag-line {
        margin: 0 0 4px;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--a-dim, #8b90a0);
      }
      .ag-line.ag-text {
        color: var(--a-text, #e7e8ee);
      }
      .ag-line.ag-tool {
        color: #ffd79a;
      }
      .ag-line.ag-tool b {
        color: var(--a-amber, #ffb020);
        margin-right: 6px;
      }
      .ag-line.ag-bad {
        color: #ff8a8a;
      }
      .ag-line.ag-ok {
        color: #86e8ab;
      }
      .ag-line.ag-thinking {
        color: #5c6377;
        font-style: italic;
      }
      .ag-delta {
        color: var(--a-text, #e7e8ee);
        white-space: pre-wrap;
      }
      .ag-job-actions {
        display: flex;
        gap: 10px;
        align-items: center;
        margin-top: 10px;
        flex-wrap: wrap;
      }
      .ag-link {
        font-size: 12.5px;
        color: var(--a-amber, #ffb020);
      }
      .ag-error {
        font-size: 12px;
        color: #ff8a8a;
      }

      @media (max-width: 720px) {
        .ag-row > * {
          flex-basis: 100%;
        }
        .ag-card-actions {
          flex-direction: column;
        }
        .ag-deny {
          order: -1;
        }
      }
    `}</style>
  );
}
