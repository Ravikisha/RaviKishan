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
// The second question, asked every time the panel is opened from a pocket, is
// "is it stuck?". So the run board is grouped by the ANSWER, not by date:
// waiting on you, quiet too long, running, finished — and each live row says
// in words how long it has run and how long since it last said anything, over
// a thin track that fills towards the stall threshold. Waiting on you is
// deliberately NOT stuck: the job is blocked on a person, which is the system
// working, and the row says so instead of turning red.
//
// The left edge carries state, as everywhere else in this admin, in the same
// graded tones as the rail's badges: waiting = filled amber (it wants you),
// stalled = red, running = solid neutral, finished = hairline, failed = red
// dashed so it can never be mistaken for done.
//
// Accounts on the box are a ROSTER per profile, one line per tool. A token is
// shown as presence and its last four characters — the same contract as the
// secret store — and the two ways in (paste, or a relayed sign-in) are the
// two buttons on a signed-out line. Sign out is red and asks twice.
//
// The transcript is deliberately quiet. It is reassurance, not the interface:
// you glance at it to see the thing is alive, and you read it properly only
// when something went wrong.
//
// Voice is an ENHANCEMENT and never the only route. The microphone button
// appears only where the Web Speech API exists, and everything it does can be
// typed. Speaking a task is convenience; it is not a second code path.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AgentClient,
  speechSupported,
  listen,
  say,
  parseCommand,
  liveTimes,
  dur,
  splitNames,
} from "../../lib/agentClient";
import { loadOrgs } from "../../lib/orgsClient";
import { currentOrgId } from "../../lib/orgState";
import WhatsappPanel from "./WhatsappPanel";
import { ApprovalCard, clock } from "./workbench/ApprovalCard";
import useWorkbench from "./workbench/useWorkbench";
import WorkbenchSwitcher from "./workbench/WorkbenchSwitcher";
import WorkbenchStyles from "./workbench/WorkbenchStyles";
import ChatView from "./workbench/ChatView";
import DesktopView from "./workbench/DesktopView";
import TerminalView from "./workbench/TerminalView";
import PreviewsView from "./workbench/PreviewsView";
import ReviewView from "./workbench/ReviewView";

// Re-exported: the run board, the previews and the tests import it from here.
export { ApprovalCard };

// Whether this browser can hear you is not knowable on the server, so it is
// decided after mount. Calling speechSupported() during render makes the server
// HTML and the first client render disagree, which React reports as a hydration
// failure — and the panel then re-renders from scratch.
function useSpeech() {
  const [can, setCan] = useState(false);
  useEffect(() => setCan(speechSupported()), []);
  return can;
}

// One clock for the whole panel. Starts at 0 and is set after mount for the
// same reason as useSpeech: Date.now() differs between server and browser.
function useNow(ms = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// A destructive button that needs a second tap. The first tap arms it and
// changes its words to say what will happen; a second within `ms` does it;
// otherwise it disarms on its own. Same two-step shape as Sign out and plugin
// Remove — a stop cannot be undone, and Resume brings nothing back.
export function useArmed(ms = 4000) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), ms);
    return () => clearTimeout(t);
  }, [armed, ms]);
  const press = (fn) => {
    if (!armed) return setArmed(true);
    setArmed(false);
    fn();
  };
  return [armed, press, () => setArmed(false)];
}

const STATE_TONE = {
  queued: "run",
  running: "run",
  waiting: "ask",
  stalled: "stuck",
  done: "ok",
  failed: "bad",
  stopped: "idle",
};

const LIVE = ["queued", "running", "waiting", "stalled"];
const TOOLS = ["claude", "codex"];
const TOOL_LABEL = { claude: "Claude Code", codex: "Codex" };

// Which part of the panel a refusal belongs to. The server echoes the request
// TYPE on an error (never its body — a login.token body is a credential), so a
// failed sign-in is said beside the sign-in, not in a banner at the top.
const areaOf = (request = "") =>
  /^login\./.test(request) ? "login" : /^(plugins\.|marketplace\.|skills\.|mcp\.)/.test(request) ? "features" : "main";

/* ================= the panel ================= */

export default function AgentPanel() {
  const [status, setStatus] = useState("connecting");
  const [jobs, setJobs] = useState([]);
  const [seen, setSeen] = useState({}); // jobId -> { receivedAt, lastSeen }
  const [approvals, setApprovals] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [limits, setLimits] = useState(null);
  const [stallMs, setStallMs] = useState(300000);
  const [siteMcp, setSiteMcp] = useState(null);
  const [halted, setHalted] = useState(false);
  const [open, setOpen] = useState(null);
  const [events, setEvents] = useState({});
  const [err, setErr] = useState({ main: "", login: "", features: "" });
  const [voice, setVoice] = useState(false);
  // The workbench opens on Chat: it is the view that talks back. Runs, the
  // accounts on the box and features are still one tap away.
  const [tab, setTab] = useState("chat");
  const [skillProfile, setSkillProfile] = useState("");
  const [flows, setFlows] = useState([]);
  const [loginNotes, setLoginNotes] = useState({});
  const [features, setFeatures] = useState({});
  const [featProfile, setFeatProfile] = useState("");
  const [orgs, setOrgs] = useState([]);
  const [wa, setWa] = useState({ status: null, chats: [], thread: null });
  // When the socket was last lost (0 while connected). The board's clock
  // stops there: with no events arriving, a running clock fills every silence
  // meter and says "last output 6m ago" about a run that is talking fine.
  const [lostAt, setLostAt] = useState(0);
  // One polite sentence for a screen reader when a run goes quiet or ends.
  const [announce, setAnnounce] = useState("");
  const announced = useRef(new Set());
  const [haltArmed, pressHalt] = useArmed();
  const canSpeak = useSpeech();
  const now = useNow();
  const client = useRef(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const wb = useWorkbench(client);
  // The socket handler is created once; it reads the workbench through a ref.
  const wbRef = useRef(wb);
  wbRef.current = wb;

  /* ---------------- connection ---------------- */

  const stampJobs = (list) =>
    setSeen((s) => {
      const t = Date.now();
      const next = { ...s };
      for (const j of list) next[j.id] = { ...(next[j.id] || {}), receivedAt: t };
      return next;
    });

  const patchLogin = (profile, tool, status) =>
    setProfiles((ps) =>
      ps.map((p) =>
        p.name !== profile ? p : { ...p, login: tool ? { ...(p.login || {}), [tool]: status } : status }
      )
    );

  const patchFeatures = (profile, part) =>
    setFeatures((f) => ({ ...f, [profile]: { ...(f[profile] || {}), ...part } }));

  useEffect(() => {
    const c = new AgentClient({
      onState: (s) => {
        setStatus(s.status);
        setLostAt((t) => (s.status === "connected" ? 0 : t || Date.now()));
        if (s.status === "connected") {
          // Asked for once a socket exists, so the WhatsApp section is not a
          // blank box until something else happens to refresh it.
          setTimeout(() => {
            try {
              client.current?.send({ type: "whatsapp", action: "status" });
              client.current?.send({ type: "whatsapp", action: "chats", limit: 60 });
            } catch (_) {}
            wbRef.current.onConnected();
          }, 0);
          setJobs(s.jobs || []);
          stampJobs(s.jobs || []);
          setApprovals(s.approvals || []);
          setProfiles(s.profiles || []);
          setFlows(s.logins || []);
          setLimits(s.limits || null);
          if (s.stallMs) setStallMs(s.stallMs);
          setSiteMcp(s.siteMcp || null);
          setHalted(!!s.halted);
          setErr({ main: "", login: "", features: "" });
        }
      },
      onEvent: (msg) => {
        // Chat, desktop, terminal, previews and the review timeline first:
        // anything the workbench recognises is its own.
        if (wbRef.current.handle(msg)) return;
        switch (msg.type) {
          case "job": {
            stampJobs([msg.job]);
            const j = msg.job;
            const key = `${j.id}:${j.state}`;
            if (["stalled", "done", "failed", "stopped"].includes(j.state) && !announced.current.has(key)) {
              announced.current.add(key);
              const word = { stalled: "has gone quiet", done: "finished", failed: "failed", stopped: "was stopped" }[j.state];
              setAnnounce(`Run ${word}: ${String(j.task || "").slice(0, 80)}`);
            }
            return setJobs((js) => [j, ...js.filter((x) => x.id !== j.id)]);
          }
          case "jobs":
            stampJobs(msg.jobs || []);
            return setJobs(msg.jobs || []);
          case "event":
            setSeen((s) => ({ ...s, [msg.jobId]: { ...(s[msg.jobId] || {}), lastSeen: Date.now() } }));
            return setEvents((e) => ({
              ...e,
              [msg.jobId]: [...(e[msg.jobId] || []).slice(-400), msg.event],
            }));
          case "transcript":
            return setEvents((e) => ({ ...e, [msg.jobId]: msg.events || [] }));
          case "job.stalled":
            say("A job has gone quiet.", { enabled: voiceRef.current });
            return;
          case "approval.asked":
            setApprovals((a) => [msg.card, ...a]);
            // The whole reason this panel exists on a phone.
            say(`Approval needed: ${msg.card.summary}`, { enabled: voiceRef.current });
            return;
          case "approval.answered":
            return setApprovals((a) => a.filter((c) => c.id !== msg.id));
          case "halted":
            return setHalted(true);
          case "resumed":
            return setHalted(false);
          case "profiles":
            return setProfiles(msg.profiles || []);

          /* ---- sign-in ---- */
          case "login.started":
          case "login.prompt": {
            const { type: _t, ...card } = msg;
            return setFlows((fs) => [...fs.filter((f) => f.id !== card.id), { ...(fs.find((f) => f.id === card.id) || {}), ...card }]);
          }
          case "login.codeSent":
            return setFlows((fs) => fs.map((f) => (f.id === msg.id ? { ...f, sent: true } : f)));
          case "login.cancelled":
            return setFlows((fs) => fs.filter((f) => f.id !== msg.id));
          case "login.done":
            setFlows((fs) => fs.filter((f) => f.id !== msg.id));
            if (msg.status) patchLogin(msg.profile, msg.tool, msg.status);
            return setLoginNotes((n) => ({
              ...n,
              [`${msg.profile}:${msg.tool}`]: msg.ok
                ? { ok: true, text: "Signed in." }
                : { ok: false, text: msg.error || "The sign-in did not finish." },
            }));
          case "login.status":
            if (msg.status) patchLogin(msg.profile, msg.tool, msg.status);
            if (msg.tool) {
              setLoginNotes((n) => ({
                ...n,
                [`${msg.profile}:${msg.tool}`]: { ok: true, text: msg.status?.signedIn ? "Saved on the server." : "Signed out." },
              }));
            }
            return;

          /* ---- features ---- */
          case "plugins":
            return patchFeatures(msg.profile, {
              plugins: { plugins: msg.plugins || [], marketplaces: msg.marketplaces || [], raw: msg.raw || "" },
              note: msg.action ? (msg.result?.output || "Done.") : undefined,
              busy: false,
            });
          case "skills":
            return patchFeatures(msg.profile, { skills: msg.skills || [] });
          case "mcp":
            return patchFeatures(msg.profile, { mcp: { claude: msg.claude || "", codex: msg.codex || [], perJob: msg.perJob || [] } });

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
          case "error": {
            const area = areaOf(msg.request);
            if (area === "features") setFeatures((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { ...v, busy: false }])));
            return setErr((e) => ({ ...e, [area]: msg.error }));
          }
          default:
            return;
        }
      },
    });
    client.current = c;
    c.connect().catch((e) => setErr((x) => ({ ...x, main: e.message })));
    return () => c.close();
    // Connect once; voice is read through voiceRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which orgs a run can act in. A failure here is not worth a banner: the
  // current org is always a valid answer, so the select falls back to it.
  useEffect(() => {
    loadOrgs()
      .then((j) => setOrgs(j.orgs || []))
      .catch(() => {});
  }, []);

  const repos = useMemo(() => [...new Set(jobs.map((j) => j.repo).filter(Boolean))], [jobs]);

  const act = (fn, area = "main") => {
    try {
      setErr((e) => ({ ...e, [area]: "" }));
      fn();
    } catch (e) {
      setErr((x) => ({ ...x, [area]: e.message }));
    }
  };

  // Features are read on demand: `claude mcp list` health-checks every server
  // and takes seconds, so it is not something to fire on every page load.
  const needFeatures = (profile, { force = false } = {}) => {
    if (!profile || status !== "connected") return;
    if (!force && features[profile]?.asked) return;
    patchFeatures(profile, { asked: true });
    act(() => {
      client.current.plugins(profile);
      client.current.skills(profile);
      client.current.mcpServers(profile);
    }, "features");
  };

  const profileForFeatures = featProfile || profiles[0]?.name || "";
  useEffect(() => {
    if (tab === "features") needFeatures(profileForFeatures);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profileForFeatures, status]);

  const openJob = (job) => {
    setOpen(job.id);
    try {
      client.current.transcript(job.id);
    } catch (_) {}
  };

  const live = jobs.filter((j) => LIVE.includes(j.state));
  const stuck = jobs.filter((j) => j.state === "stalled").length;

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

  const connected = status === "connected";

  // An approval for the chat on screen is answered INLINE, where it was
  // asked; on Review every approval is pinned at the top of the timeline. So
  // the banner above the views carries only what is not already in front of
  // you, never two cards for one question.
  const openChatId = wb.selected?.chatId || "";
  const chatOf = (c) => wb.chats.find((x) => x.chatId === (c.chatId || c.jobId));
  const banner =
    tab === "review" ? [] : tab === "chat" ? approvals.filter((c) => (c.chatId || c.jobId) !== openChatId) : approvals;
  const chatAsks = approvals.filter((c) => !!chatOf(c)).length;
  const working = wb.chats.filter((c) => c.state === "thinking").length;
  const badges = {
    chat: chatAsks ? { text: String(chatAsks), tone: "ask" } : working ? { text: `${working} working` } : null,
    review: approvals.length ? { text: String(approvals.length), tone: "ask" } : null,
    runs: stuck ? { text: `${stuck} stuck`, tone: "bad" } : live.length ? { text: `${live.length} live` } : null,
    accounts: flows.length ? { text: "signing in" } : null,
  };
  const answer = (card, allow, scope) => act(() => client.current.answer(card.id, allow, { scope }));
  const chatSkills = features[skillProfile || profiles[0]?.name || ""]?.skills || [];

  return (
    <div className="ag-main wb-root">
      <div className="ops-head">
        <div>
          <h3>Workbench</h3>
          <p className="admin-sub ag-sub">
            Claude Code and Codex on your own server: talk to them, watch the desktop they work on,
            open a shell. You approve the parts that cannot be undone.
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
          {halted ? (
            <button className="admin-primary" type="button" onClick={() => act(() => client.current.resume())}>
              Resume
            </button>
          ) : (
            <button
              className={`ag-halt${haltArmed ? " armed" : ""}`}
              type="button"
              onClick={() => pressHalt(() => act(() => client.current.halt("Stopped from the panel.")))}
            >
              {haltArmed
                ? live.length
                  ? `Tap again to stop ${live.length} run${live.length === 1 ? "" : "s"}`
                  : "Tap again to halt"
                : "Stop everything"}
            </button>
          )}
        </span>
      </div>

      <WorkbenchSwitcher view={tab} onView={setTab} badges={badges} />

      {err.main ? (
        <p className="admin-err ag-err" role="alert">
          {err.main}
        </p>
      ) : null}
      {/* Always mounted, so a screen reader hears each change: a live region
          that appears WITH its first message is often not announced. */}
      <p className="ag-sr" role="status" aria-live="polite">
        {announce}
      </p>
      {halted ? (
        <p className="ag-halted">
          Halted. Nothing new will start until you resume. Jobs already running were asked to stop.
        </p>
      ) : null}

      {/* The one loud thing. Above everything, because it is the only part
          that is blocking on you. */}
      {/* The region stays mounted (empty, it takes no space) so a card that
          arrives is announced: an unanswered approval is DENIED when it
          expires, so not hearing it is not a small thing. */}
      <section
        className={banner.length ? "ag-approvals" : "ag-approvals is-empty"}
        aria-label="Waiting for your approval"
        aria-live="assertive"
        aria-relevant="additions"
      >
        {banner.map((card) => {
          const chat = chatOf(card);
          return (
            <ApprovalCard
              key={card.id}
              card={card}
              job={jobs.find((j) => j.id === card.jobId)}
              where={chat ? `chat: ${chat.title || chat.chatId}` : undefined}
              scopeLabel={chat ? "chat" : "job"}
              onAnswer={(allow, scope) => answer(card, allow, scope)}
            />
          );
        })}
      </section>

      {tab === "chat" ? (
        <ChatView
          connected={connected}
          chats={wb.chats}
          sessions={wb.sessions}
          selected={wb.selected}
          events={wb.selectedEvents}
          approvals={approvals}
          profiles={profiles}
          orgs={orgs}
          skills={chatSkills}
          repos={repos}
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
            setSkillProfile(p);
            needFeatures(p);
          }}
        />
      ) : tab === "desktop" ? (
        <>
          {wb.unsupported.desktop ? <p className="wb-note">{wb.unsupported.desktop}</p> : null}
          <DesktopView client={client.current} connected={connected} ops={wb.ops} />
        </>
      ) : tab === "terminal" ? (
        <>
          {wb.unsupported.term ? <p className="wb-note">{wb.unsupported.term}</p> : null}
          <TerminalView client={client.current} connected={connected} subscribe={wb.subscribe} />
        </>
      ) : tab === "previews" ? (
        <>
          {wb.unsupported.preview ? <p className="wb-note">{wb.unsupported.preview}</p> : null}
          <PreviewsView
            client={client.current}
            connected={connected}
            ports={wb.ports}
            loading={wb.portsLoading}
            now={now}
            onRefresh={wb.refreshPorts}
          />
        </>
      ) : tab === "review" ? (
        <>
          {wb.unsupported.ops ? <p className="wb-note">{wb.unsupported.ops}</p> : null}
          <ReviewView
            ops={wb.ops}
            approvals={approvals}
            chats={wb.chats}
            jobs={jobs}
            connected={connected}
            loading={wb.opsLoading}
            onAnswer={answer}
            onRefresh={wb.refreshOps}
          />
        </>
      ) : tab === "whatsapp" ? (
        <WhatsappPanel
          client={client.current}
          status={wa.status}
          chats={wa.chats}
          thread={wa.thread}
          onAction={waAction}
        />
      ) : tab === "accounts" ? (
        <ProfileAccounts
          profiles={profiles}
          flows={flows}
          notes={loginNotes}
          error={err.login}
          now={now}
          disabled={!connected}
          onToken={(p, t, token) => act(() => client.current.loginToken(p, t, token), "login")}
          onStartLogin={(p, t) => act(() => client.current.loginStart(p, t), "login")}
          onCode={(id, code) => act(() => client.current.loginCode(id, code), "login")}
          onCancel={(id) => act(() => client.current.loginCancel(id), "login")}
          onLogout={(p, t) => act(() => client.current.logout(p, t), "login")}
          onAddProfile={(name) => act(() => client.current.addProfile(name), "login")}
          siteMcp={siteMcp}
        />
      ) : tab === "features" ? (
        <FeaturesPanel
          profiles={profiles}
          profile={profileForFeatures}
          onProfile={setFeatProfile}
          data={features[profileForFeatures] || {}}
          error={err.features}
          disabled={!connected}
          onRefresh={() => needFeatures(profileForFeatures, { force: true })}
          onInstall={(name) => {
            patchFeatures(profileForFeatures, { busy: true, note: "" });
            act(() => client.current.installPlugin(profileForFeatures, name), "features");
          }}
          onRemove={(name) => {
            patchFeatures(profileForFeatures, { busy: true, note: "" });
            act(() => client.current.removePlugin(profileForFeatures, name), "features");
          }}
          onAddMarket={(source) => {
            patchFeatures(profileForFeatures, { busy: true, note: "" });
            act(() => client.current.addMarketplace(profileForFeatures, source), "features");
          }}
        />
      ) : (
        <>
          <NewJob
            profiles={profiles}
            repos={repos}
            orgs={orgs}
            features={features}
            onNeedFeatures={(p) => needFeatures(p)}
            disabled={!connected || halted}
            onStart={(job) => act(() => client.current.start(job))}
          />

          {limits ? (
            <p className="ag-limits">
              {live.length} of {limits.global} running, {limits.perProfile} per profile, {limits.perDay} a day.
              Quiet for {dur(stallMs)} counts as stuck.
            </p>
          ) : null}

          <RunBoard
            jobs={jobs}
            approvals={approvals}
            seen={seen}
            now={connected ? now : lostAt || now}
            stale={!connected}
            stallMs={stallMs}
            open={open}
            events={events}
            onOpen={(job) => (open === job.id ? setOpen(null) : openJob(job))}
            onStop={(job) => act(() => client.current.stop(job.id))}
          />
        </>
      )}

      <AgentStyles />
      <WorkbenchStyles />
    </div>
  );
}

/* ================= pieces ================= */

export function AgentTabs({ tab, onTab, counts = {} }) {
  const tabs = [
    ["runs", "Runs", counts.stuck ? `${counts.stuck} stuck` : counts.live ? `${counts.live} live` : ""],
    ["accounts", "Accounts on the box", counts.flows ? "signing in" : ""],
    ["features", "Claude features", ""],
    ["whatsapp", "WhatsApp", ""],
  ];
  return (
    <div className="ag-tabs" role="tablist">
      {tabs.map(([k, label, badge]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={tab === k}
          className={`ag-tab${tab === k ? " on" : ""}`}
          onClick={() => onTab(k)}
        >
          {label}
          {badge ? <em className={`ag-tab-n${/stuck/.test(badge) ? " stuck" : ""}`}>{badge}</em> : null}
        </button>
      ))}
    </div>
  );
}

export function ConnectionDot({ status }) {
  const label = {
    connecting: "Connecting…",
    connected: "Connected",
    reconnecting: "Reconnecting…",
    closed: "Disconnected",
  }[status] || status;
  return (
    <span className={`ag-conn ${status}`} title={label} role="status">
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

/* ---------------- new run ---------------- */

export function NewJob({ profiles, repos, orgs = [], features = {}, onNeedFeatures = () => {}, disabled, onStart }) {
  const canSpeak = useSpeech();
  const [task, setTask] = useState("");
  const [repo, setRepo] = useState("");
  const [profile, setProfile] = useState("");
  const [tool, setTool] = useState("claude");
  // The org a run acts in decides which accounts and memories its MCP server
  // sees, so it starts as the org this admin is in — never blank, because
  // blank means "relax" on the server and that is not necessarily here.
  const [orgId, setOrgId] = useState("");
  const [skills, setSkills] = useState("");
  const [plugins, setPlugins] = useState("");
  const [policy, setPolicy] = useState("allowlist");
  const [finish, setFinish] = useState("pr");
  const [hearing, setHearing] = useState(false);
  const stopRef = useRef(null);

  useEffect(() => setOrgId((o) => o || currentOrgId()), []);

  const chosen = profile || profiles[0]?.name || "";
  useEffect(() => {
    if (chosen) onNeedFeatures(chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  const f = features[chosen] || {};
  const skillHints = (f.skills || []).map((s) => s.name);
  const pluginHints = (f.plugins?.plugins || []).map((p) => p.id || p.name);

  const orgChoices = useMemo(() => {
    const list = orgs.map((o) => ({ id: o.id, name: o.name || o.id }));
    if (orgId && !list.some((o) => o.id === orgId)) list.unshift({ id: orgId, name: orgId });
    return list;
  }, [orgs, orgId]);

  const signedIn = (p, t) => !!(p?.login?.[t]?.signedIn ?? p?.[t]);

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
    onStart({
      task: task.trim(),
      repo: repo.trim(),
      profile,
      tool,
      orgId: orgId || currentOrgId(),
      skills: splitNames(skills),
      plugins: splitNames(plugins),
      policy,
      finish,
    });
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
          <span>Org</span>
          <select className="admin-input" value={orgId} onChange={(e) => setOrgId(e.target.value)} disabled={disabled}>
            {orgChoices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>

        <label className="ag-field">
          <span>Tool</span>
          <select className="admin-input" value={tool} onChange={(e) => setTool(e.target.value)} disabled={disabled}>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
        </label>

        <label className="ag-field">
          <span>Account</span>
          <select className="admin-input" value={profile} onChange={(e) => setProfile(e.target.value)} disabled={disabled}>
            <option value="">default</option>
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {signedIn(p, tool) ? "" : ` (${TOOL_LABEL[tool]} not signed in)`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="ag-row">
        <label className="ag-field">
          <span>Skills to use</span>
          <input
            className="admin-input"
            list="ag-skills"
            placeholder={skillHints.length ? `e.g. ${skillHints.slice(0, 2).join(", ")}` : "none"}
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            disabled={disabled}
          />
          <datalist id="ag-skills">
            {skillHints.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <small className="ag-hint">Named in the prompt. The job still decides when to use them.</small>
        </label>

        <label className="ag-field">
          <span>Plugins to enable</span>
          <input
            className="admin-input"
            list="ag-plugins"
            placeholder={pluginHints.length ? `e.g. ${pluginHints[0]}` : "none"}
            value={plugins}
            onChange={(e) => setPlugins(e.target.value)}
            disabled={disabled}
          />
          <datalist id="ag-plugins">
            {pluginHints.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <small className="ag-hint">Turned on for this run only. Install them under Claude features.</small>
        </label>
      </div>

      <div className="ag-row">
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

        <button className="admin-primary ag-start" type="submit" disabled={disabled || !task.trim() || !repo.trim()}>
          Start in {orgChoices.find((o) => o.id === orgId)?.name || orgId || "this org"}
        </button>
      </div>
    </form>
  );
}

/* ---------------- the run board ---------------- */

// Grouped by the answer to "is it stuck", in the order that needs you first.
const GROUPS = [
  ["ask", "Waiting on you", (j) => j.state === "waiting"],
  ["stuck", "Quiet too long", (j) => j.state === "stalled"],
  ["run", "Running", (j) => j.state === "running" || j.state === "queued"],
  ["end", "Finished", (j) => !LIVE.includes(j.state)],
];

// `stale` is true while the socket is down. `now` is then the moment it was
// lost, so nothing on the board ages past what was actually observed, and each
// live row says it is showing the last known state rather than guessing.
export function RunBoard({ jobs, approvals = [], seen = {}, now, stale = false, stallMs, open, events = {}, onOpen, onStop }) {
  if (!jobs.length) return <p className="ag-none">No runs yet. Describe one above.</p>;
  return (
    <div className={`ag-board${stale ? " is-stale" : ""}`}>
      {GROUPS.map(([key, label, test]) => {
        const rows = jobs.filter(test);
        if (!rows.length) return null;
        return (
          <section key={key} className={`ag-group ${key}`} aria-label={label}>
            <h4 className="ag-group-h">
              {label} <span>{rows.length}</span>
            </h4>
            {rows.map((job) => (
              <RunRow
                key={job.id}
                job={job}
                card={approvals.find((c) => c.jobId === job.id)}
                times={liveTimes(job, { now: now || Date.now(), ...(seen[job.id] || {}) })}
                now={now}
                stale={stale}
                stallMs={stallMs}
                open={open === job.id}
                events={events[job.id] || []}
                onOpen={() => onOpen(job)}
                onStop={() => onStop(job)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

// The sentence that answers "is it stuck" for one row.
function verdict(job, { elapsed, idle }, { card, now }) {
  switch (job.state) {
    case "waiting": {
      const left = card && now ? Math.max(0, card.expiresAt - now) : null;
      return left === null
        ? "Waiting on you. Not stuck: it needs an answer."
        : `Waiting on you, ${clock(left)} left to answer.`;
    }
    case "stalled":
      return `No output for ${dur(idle)}. Running ${dur(elapsed)} in all.`;
    case "queued":
      return "Queued. Starts when a slot is free.";
    case "running":
      return idle < 5000
        ? `Running ${dur(elapsed)}, working now.`
        : `Running ${dur(elapsed)}, last output ${dur(idle)} ago.`;
    case "done":
      return `Done in ${dur(elapsed)}.`;
    case "failed":
      return `Failed after ${dur(elapsed)}.`;
    case "stopped":
      return `Stopped after ${dur(elapsed)}.`;
    default:
      return job.state;
  }
}

export function RunRow({ job, card, times, now, stale = false, stallMs = 300000, open, events, onOpen, onStop }) {
  const tone = STATE_TONE[job.state] || "idle";
  const bodyRef = useRef(null);
  const live = LIVE.includes(job.state);
  const [stopArmed, pressStop] = useArmed();

  // Follow the tail while it runs, so a glance shows the latest line.
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [events.length, open]);

  // How close silence is to the stall threshold. Hidden while waiting on you:
  // a job blocked on a person is not drifting towards stuck.
  const fill = Math.min(1, (times.idle || 0) / Math.max(1, stallMs));
  // Hidden while disconnected too: a meter cannot fill on information that is
  // not arriving.
  const meter = live && !stale && job.state !== "waiting" && job.state !== "queued";
  const said = verdict(job, times, { card, now });
  const shown = stale && live ? `Not connected. Last known: ${said.charAt(0).toLowerCase()}${said.slice(1)}` : said;

  return (
    <article className={`ag-run ${tone}${open ? " is-open" : ""}`} data-job={job.id} data-state={job.state}>
      <div className="ag-run-top">
        <button type="button" className="ag-run-head" onClick={onOpen} aria-expanded={open}>
          <span className="ag-run-task">{job.task}</span>
          <span className="ag-run-meta">
            <span>{job.repo}</span>
            {job.profile ? <span>{job.profile}</span> : null}
            <span>{TOOL_LABEL[job.tool] || job.tool || "Claude Code"}</span>
            {job.orgId ? <span>{job.orgId}</span> : null}
            {job.approvals?.asked ? (
              <span>
                {job.approvals.allowed} of {job.approvals.asked} allowed
              </span>
            ) : null}
          </span>
        </button>
        <div className="ag-run-side">
          <span className={`ag-verdict ${stale && live ? "stale" : tone}`}>{shown}</span>
          <span className="ag-run-btns">
            <button type="button" className="ag-ghost" onClick={onOpen}>
              {open ? "Hide transcript" : "Transcript"}
            </button>
            {live ? (
              <button type="button" className={`ag-stop${stopArmed ? " armed" : ""}`} onClick={() => pressStop(onStop)}>
                {stopArmed ? "Tap again to stop" : "Stop"}
              </button>
            ) : null}
          </span>
        </div>
      </div>

      {meter ? (
        <div
          className={`ag-quiet${job.state === "stalled" ? " stuck" : fill >= 0.6 ? " late" : ""}`}
          role="meter"
          aria-label="Time since last output, against the stall threshold"
          aria-valuemin={0}
          aria-valuemax={Math.round(stallMs / 1000)}
          aria-valuenow={Math.round((times.idle || 0) / 1000)}
        >
          <i style={{ width: `${Math.round(fill * 100)}%` }} />
        </div>
      ) : null}

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
            {job.memory?.recalled || job.memory?.learned ? (
              <span className="ag-mem">
                Recalled {job.memory.recalled || 0}, learned {job.memory.learned || 0}
              </span>
            ) : null}
            {job.memory?.error ? <span className="ag-error">Memory: {job.memory.error}</span> : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

// Kept for anything that still imports the old name.
export const JobRow = ({ job, open, events, onOpen, onStop }) => (
  <RunRow job={job} times={{ elapsed: job.elapsedMs || 0, idle: job.idleMs || 0 }} open={open} events={events} onOpen={onOpen} onStop={onStop} />
);

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

/* ---------------- accounts on the box ---------------- */

// What each tool takes, said where the decision is made. The instructions are
// the point: a field labelled "token" with no way to get one is a dead end.
const TOOL_INFO = {
  claude: {
    paste: "Paste a token",
    pasteHow: (
      <>
        On any computer with Claude Code, run <code>claude setup-token</code>, sign in with the
        account this profile should use, and paste the token it prints. It is a long-lived token
        for that subscription; jobs on this profile run as it.
      </>
    ),
    placeholder: "the token from claude setup-token",
    relay: "Sign in through the browser",
    relayHow:
      "Runs claude auth login on the server and hands you its link. Open it, approve, then paste the code the page shows back here.",
    pasteBack: true,
  },
  codex: {
    paste: "Paste an API key",
    pasteHow: (
      <>
        Create a key at platform.openai.com under API keys and paste it. The server stores it with{" "}
        <code>codex login --with-api-key</code>; runs on this profile bill to that key.
      </>
    ),
    placeholder: "OpenAI API key",
    relay: "Sign in with ChatGPT",
    relayHow:
      "Runs codex login --device-auth on the server. Open the link, sign in, and type the device code shown here into that page. Nothing comes back here.",
    pasteBack: false,
  },
};

export function ProfileAccounts({
  profiles,
  flows = [],
  notes = {},
  error = "",
  now,
  disabled,
  onToken,
  onStartLogin,
  onCode,
  onCancel,
  onLogout,
  onAddProfile,
  siteMcp,
}) {
  const [name, setName] = useState("");
  const valid = /^[a-z0-9][a-z0-9_-]{0,31}$/.test(name);
  return (
    <div className="ag-accounts">
      <p className="ag-lede">
        A profile is one signed-in account on the server. Credentials stay on the server, in that
        profile, and never reach the database; this page only ever sees whether one is there and
        its last four characters.
      </p>
      {error ? (
        <p className="admin-err ag-err" role="alert">
          {error}
        </p>
      ) : null}
      {siteMcp && !siteMcp.enabled ? (
        <p className="ag-note-line">
          Runs are not getting this site&apos;s tools or memory: the server has no AGENT_MCP_TOKEN.
        </p>
      ) : null}

      {profiles.length === 0 ? <p className="ag-none">No profiles yet. Add one below.</p> : null}

      {profiles.map((p) => (
        <section key={p.name} className="ag-profile" aria-label={`Profile ${p.name}`}>
          <h4 className="ag-profile-h">
            <code>{p.name}</code>
          </h4>
          {TOOLS.map((tool) => (
            <ToolLogin
              key={tool}
              profile={p.name}
              tool={tool}
              state={p.login?.[tool] || { signedIn: !!p[tool], method: null, last4: "" }}
              flow={flows.find((f) => f.profile === p.name && f.tool === tool)}
              note={notes[`${p.name}:${tool}`]}
              now={now}
              disabled={disabled}
              onToken={onToken}
              onStartLogin={onStartLogin}
              onCode={onCode}
              onCancel={onCancel}
              onLogout={onLogout}
            />
          ))}
        </section>
      ))}

      <form
        className="ag-addprofile"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onAddProfile(name);
          setName("");
        }}
      >
        <label className="ag-field">
          <span>Add a profile</span>
          <input
            className="admin-input"
            placeholder="e.g. work"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
          />
          <small className="ag-hint">Lowercase letters, digits, hyphen or underscore. It becomes a folder on the server.</small>
        </label>
        <button type="submit" className="ag-ghost" disabled={disabled || !valid}>
          Add profile
        </button>
      </form>
    </div>
  );
}

export function ToolLogin({ profile, tool, state, flow, note, now, disabled, onToken, onStartLogin, onCode, onCancel, onLogout }) {
  const info = TOOL_INFO[tool];
  const [mode, setMode] = useState(""); // "" | "paste"
  const [token, setToken] = useState("");
  const [sure, setSure] = useState(false);

  const signed = !!state?.signedIn;
  const how = !signed
    ? "Not signed in"
    : state.method === "token"
    ? "Signed in with a pasted token"
    : state.method === "oauth"
    ? "Signed in through the browser"
    : "Signed in";

  return (
    <div className={`ag-login ${signed ? "in" : "out"}${flow ? " flowing" : ""}`} data-tool={tool}>
      <div className="ag-login-line">
        <strong>{TOOL_LABEL[tool]}</strong>
        <span className="ag-login-state">
          {how}
          {signed && state.last4 ? (
            <>
              , ending <code>{state.last4}</code>
            </>
          ) : null}
        </span>
        <span className="ag-login-btns">
          {!flow && mode !== "paste" ? (
            <>
              <button type="button" className="ag-ghost" disabled={disabled} onClick={() => setMode("paste")}>
                {signed ? "Replace" : info.paste}
              </button>
              <button type="button" className="ag-ghost" disabled={disabled} onClick={() => onStartLogin(profile, tool)}>
                {info.relay}
              </button>
            </>
          ) : null}
          {signed && !flow ? (
            sure ? (
              <button
                type="button"
                className="ag-stop"
                disabled={disabled}
                onClick={() => {
                  setSure(false);
                  onLogout(profile, tool);
                }}
              >
                Sign out {profile}
              </button>
            ) : (
              <button type="button" className="ag-ghost danger" disabled={disabled} onClick={() => setSure(true)}>
                Sign out
              </button>
            )
          ) : null}
        </span>
      </div>

      {note ? (
        <p className={`ag-login-note${note.ok ? "" : " bad"}`} role={note.ok ? "status" : "alert"}>
          {note.text}
        </p>
      ) : null}

      {mode === "paste" && !flow ? (
        <form
          className="ag-paste"
          onSubmit={(e) => {
            e.preventDefault();
            if (!token.trim()) return;
            onToken(profile, tool, token.trim());
            // Gone from the page the moment it is sent: the server is the
            // only place it should exist from here on.
            setToken("");
            setMode("");
          }}
        >
          <p className="ag-how">{info.pasteHow}</p>
          <div className="ag-paste-row">
            <input
              className="admin-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={info.placeholder}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              aria-label={`${TOOL_LABEL[tool]} credential for ${profile}`}
            />
            <button type="submit" className="admin-primary" disabled={disabled || !token.trim()}>
              Save to the server
            </button>
            <button type="button" className="ag-ghost" onClick={() => {
                setToken("");
                setMode("");
              }}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {flow ? (
        <LoginFlow flow={flow} info={info} now={now} disabled={disabled} onCode={onCode} onCancel={onCancel} />
      ) : null}
    </div>
  );
}

export function LoginFlow({ flow, info, now, disabled, onCode, onCancel }) {
  const [code, setCode] = useState("");
  const left = now && flow.expiresAt ? Math.max(0, flow.expiresAt - now) : null;
  const copy = (text) => {
    try {
      navigator.clipboard?.writeText(text);
    } catch (_) {}
  };
  return (
    <div className="ag-flow" data-flow={flow.id}>
      <p className="ag-how">{info.relayHow}</p>
      <ol className="ag-flow-steps">
        <li className={flow.url ? "done" : ""}>
          {flow.url ? (
            <a className="ag-link" href={flow.url} target="_blank" rel="noreferrer noopener">
              Open the sign-in page
            </a>
          ) : (
            <span className="ag-wait">Waiting for the server to print its sign-in link…</span>
          )}
        </li>
        {flow.code ? (
          <li>
            <span>Device code</span>{" "}
            <code className="ag-devcode">{flow.code}</code>{" "}
            <button type="button" className="ag-ghost" onClick={() => copy(flow.code)}>
              Copy
            </button>
          </li>
        ) : null}
        {info.pasteBack ? (
          <li>
            {flow.sent ? (
              <span className="ag-wait">Code sent. Waiting for the server to confirm…</span>
            ) : (
              <form
                className="ag-paste-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!code.trim()) return;
                  onCode(flow.id, code.trim());
                  setCode("");
                }}
              >
                <input
                  className="admin-input"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste the code the page shows"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={disabled || !flow.url}
                />
                <button type="submit" className="admin-primary" disabled={disabled || !code.trim()}>
                  Send code
                </button>
              </form>
            )}
          </li>
        ) : null}
      </ol>
      <p className="ag-flow-foot">
        <span>{left === null ? "" : `Cancelled automatically in ${clock(left)}.`}</span>
        <button type="button" className="ag-ghost" onClick={() => onCancel(flow.id)} disabled={disabled}>
          Cancel sign-in
        </button>
      </p>
    </div>
  );
}

/* ---------------- Claude features ---------------- */

export function ProfilePicker({ profiles, value, onChange }) {
  if (profiles.length < 2) return null;
  return (
    <div className="ag-picker" role="radiogroup" aria-label="Profile">
      {profiles.map((p) => (
        <button
          key={p.name}
          type="button"
          role="radio"
          aria-checked={value === p.name}
          className={`ag-pick${value === p.name ? " on" : ""}`}
          onClick={() => onChange(p.name)}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

export function FeaturesPanel({ profiles, profile, onProfile, data = {}, error = "", disabled, onRefresh, onInstall, onRemove, onAddMarket }) {
  const [plugin, setPlugin] = useState("");
  const [market, setMarket] = useState("");
  const [removing, setRemoving] = useState("");
  const plugins = data.plugins?.plugins || [];
  const markets = data.plugins?.marketplaces || [];
  const skills = data.skills || [];
  const mcp = data.mcp;

  if (!profiles.length) return <p className="ag-none">Add a profile under Accounts on the box first.</p>;

  return (
    <div className="ag-features">
      <div className="ag-feat-head">
        <ProfilePicker profiles={profiles} value={profile} onChange={onProfile} />
        <p className="ag-lede">
          What Claude Code has installed for <code>{profile}</code>. A run can turn on any of these
          by name; every run also gets this site&apos;s tools for its org.
        </p>
        <button type="button" className="ag-ghost" onClick={onRefresh} disabled={disabled}>
          Read again
        </button>
      </div>
      {error ? (
        <p className="admin-err ag-err" role="alert">
          {error}
        </p>
      ) : null}
      {data.note ? <pre className="ag-output">{data.note}</pre> : null}

      <section className="ag-feat">
        <h4 className="ag-group-h">
          Plugins <span>{data.plugins ? plugins.length : "…"}</span>
        </h4>
        {data.plugins && !plugins.length ? (
          <div className="ag-none">
            None installed.
            {data.plugins.raw ? <pre className="ag-output">{data.plugins.raw}</pre> : null}
          </div>
        ) : null}
        {plugins.map((p) => (
          <div key={p.id || p.name} className={`ag-item${p.enabled === false ? " off" : ""}`}>
            <code className="ag-item-id">{p.id || p.name}</code>
            <span className="ag-item-meta">
              {p.version ? <span>{p.version}</span> : null}
              <span>{p.enabled === false ? "installed, turned off" : "on"}</span>
            </span>
            {removing === (p.id || p.name) ? (
              <button
                type="button"
                className="ag-stop"
                disabled={disabled || data.busy}
                onClick={() => {
                  setRemoving("");
                  onRemove(p.id || p.name);
                }}
              >
                Remove it
              </button>
            ) : (
              <button type="button" className="ag-ghost danger" disabled={disabled || data.busy} onClick={() => setRemoving(p.id || p.name)}>
                Remove
              </button>
            )}
          </div>
        ))}
        <form
          className="ag-paste-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!plugin.trim()) return;
            onInstall(plugin.trim());
            setPlugin("");
          }}
        >
          <input
            className="admin-input"
            placeholder="name@marketplace"
            value={plugin}
            onChange={(e) => setPlugin(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Plugin to install"
          />
          <button type="submit" className="admin-primary" disabled={disabled || data.busy || !plugin.trim()}>
            {data.busy ? "Working…" : "Install"}
          </button>
        </form>
      </section>

      <section className="ag-feat">
        <h4 className="ag-group-h">
          Marketplaces <span>{data.plugins ? markets.length : "…"}</span>
        </h4>
        {markets.map((m) => (
          <div key={m.name} className="ag-item">
            <code className="ag-item-id">{m.name}</code>
            <span className="ag-item-meta">
              <span>{m.source}</span>
            </span>
          </div>
        ))}
        <form
          className="ag-paste-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!market.trim()) return;
            onAddMarket(market.trim());
            setMarket("");
          }}
        >
          <input
            className="admin-input"
            placeholder="owner/repo or https:// git URL"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Marketplace to add"
          />
          <button type="submit" className="ag-ghost" disabled={disabled || data.busy || !market.trim()}>
            Add marketplace
          </button>
        </form>
        <small className="ag-hint">Local folders are refused on purpose: a marketplace is code the server will run.</small>
      </section>

      <section className="ag-feat">
        <h4 className="ag-group-h">
          Skills <span>{data.skills ? skills.length : "…"}</span>
        </h4>
        {data.skills && !skills.length ? <p className="ag-none">No skills on this profile.</p> : null}
        {skills.map((s) => (
          <div key={`${s.source}:${s.name}:${s.path}`} className="ag-item">
            <code className="ag-item-id">{s.name}</code>
            <span className="ag-item-desc">{s.description || "No description."}</span>
            <span className="ag-item-meta">
              <span>{s.source === "plugin" ? "from a plugin" : "your own"}</span>
            </span>
          </div>
        ))}
      </section>

      <section className="ag-feat">
        <h4 className="ag-group-h">MCP servers</h4>
        {!mcp ? <p className="ag-none">Reading… this asks each server whether it answers, so it can take a few seconds.</p> : null}
        {mcp ? (
          <>
            <p className="ag-sublabel">Claude Code</p>
            <pre className="ag-output">{mcp.claude || "None configured."}</pre>
            <p className="ag-sublabel">Codex</p>
            {mcp.codex?.length ? (
              mcp.codex.map((n) => (
                <div key={n} className="ag-item">
                  <code className="ag-item-id">{n}</code>
                </div>
              ))
            ) : (
              <p className="ag-none">None configured.</p>
            )}
            <p className="ag-sublabel">Added to every run</p>
            {(mcp.perJob || []).map((n) => (
              <div key={n} className="ag-item">
                <span className="ag-item-desc">{n}</span>
              </div>
            ))}
          </>
        ) : null}
      </section>
    </div>
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
      .ag-tabs {
        flex-wrap: wrap;
      }
      .ag-tab-n {
        font-style: normal;
        margin-left: 7px;
        color: #5c6377;
        font-size: 11px;
      }
      .ag-tab-n.stuck {
        color: #ff8a8a;
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

      /* ---- run board ---- */
      .ag-board {
        display: grid;
        gap: 18px;
      }
      .ag-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      /* globals.scss pins h1-h4 to a light-theme ink; every heading here
         sets its own colour or it vanishes on the console. */
      .ag-group-h,
      .ag-profile-h {
        margin: 0 0 2px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--a-dim, #8b90a0);
        letter-spacing: 0.01em;
      }
      .ag-group-h span {
        color: #5c6377;
        font-weight: 400;
        margin-left: 4px;
      }
      .ag-group.ask .ag-group-h {
        color: var(--a-amber, #ffb020);
      }
      .ag-group.stuck .ag-group-h {
        color: #ff8a8a;
      }
      .ag-run {
        border: 1px solid var(--a-line, #23262f);
        border-left: 3px solid var(--a-line, #23262f);
        border-radius: 10px;
        background: var(--a-raise, #15171d);
        overflow: hidden;
        min-width: 0;
      }
      .ag-run.run {
        border-left-color: #c9cdd8;
      }
      .ag-run.ask {
        border-left-color: var(--a-amber, #ffb020);
        background: linear-gradient(90deg, rgba(255, 176, 32, 0.07), transparent 40%), var(--a-raise, #15171d);
      }
      .ag-run.stuck {
        border-left-color: #d1434f;
      }
      .ag-run.bad {
        border-left: 3px dashed #a33b45;
      }
      .ag-run.idle {
        border-left: 3px dashed #3a3f4d;
      }
      .ag-run-top {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        padding: 11px 14px 10px;
        flex-wrap: wrap;
      }
      .ag-run-head {
        flex: 1 1 280px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 5px;
        background: none;
        border: 0;
        padding: 0;
        text-align: left;
        font: inherit;
        color: inherit;
        cursor: pointer;
      }
      .ag-run-task {
        font-size: 13.5px;
        color: var(--a-text, #e7e8ee);
        line-height: 1.4;
        overflow-wrap: anywhere;
      }
      .ag-run-meta,
      .ag-item-meta {
        display: flex;
        flex-wrap: wrap;
        font-size: 11px;
        color: #6b7285;
        min-width: 0;
      }
      .ag-run-meta > span + span,
      .ag-item-meta > span + span {
        border-left: 1px solid #2f3442;
        margin-left: 8px;
        padding-left: 8px;
      }
      .ag-run-meta > span,
      .ag-item-meta > span {
        overflow-wrap: anywhere;
      }
      .ag-run-side {
        flex: 0 1 auto;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 7px;
        min-width: 0;
        max-width: 100%;
      }
      /* The answer to "is it stuck", in words: the one thing on a row set
         louder than the task's own metadata. */
      .ag-verdict {
        font-size: 12.5px;
        color: var(--a-text, #e7e8ee);
        text-align: right;
      }
      .ag-verdict.ask {
        color: #1a1300;
        background: var(--a-amber, #ffb020);
        border-radius: 6px;
        padding: 2px 8px;
        font-weight: 600;
      }
      .ag-verdict.stuck {
        color: #ff8a8a;
        font-weight: 600;
      }
      .ag-verdict.bad {
        color: #ff8a8a;
      }
      .ag-verdict.ok,
      .ag-verdict.idle {
        color: var(--a-dim, #8b90a0);
      }
      /* Disconnected: the row is what was last seen, said in the dim voice
         and dashed on the left, the same mark the console uses for "not
         current". The amber stays off it - nothing here is selected. */
      .ag-verdict.stale {
        color: var(--a-dim, #8b90a0);
        font-style: italic;
      }
      .ag-board.is-stale .ag-run {
        border-left-style: dashed;
        opacity: 0.72;
      }
      .ag-approvals.is-empty {
        margin: 0;
      }
      .ag-halt.armed,
      .ag-stop.armed {
        background: #8f1d27;
        border-color: #ff8a8a;
        color: #fff;
        font-weight: 600;
      }
      .ag-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
      }
      .ag-run-btns {
        display: flex;
        gap: 6px;
      }
      .ag-ghost {
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        color: var(--a-text, #e7e8ee);
        border-radius: 8px;
        padding: 6px 11px;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
        white-space: nowrap;
      }
      .ag-ghost:disabled,
      .ag-stop:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .ag-ghost.danger {
        color: #ff8a8a;
      }
      .ag-stop {
        background: #43171c;
        border: 1px solid #6d2a31;
        color: #ffb4b4;
        border-radius: 8px;
        padding: 6px 12px;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .ag-ghost:focus-visible,
      .ag-stop:focus-visible,
      .ag-tab:focus-visible,
      .ag-pick:focus-visible,
      .ag-run-head:focus-visible {
        outline: 2px solid var(--a-amber, #ffb020);
        outline-offset: 2px;
      }
      /* Silence against the stall threshold. A track, so an empty meter
         still reads as a meter rather than as nothing. */
      .ag-quiet {
        height: 3px;
        margin: 0 14px 10px;
        background: #22252e;
        border-radius: 2px;
        overflow: hidden;
      }
      .ag-quiet i {
        display: block;
        height: 100%;
        background: #5c6377;
        transition: width 0.9s linear;
      }
      .ag-quiet.late i {
        background: #b0707a;
      }
      .ag-quiet.stuck i {
        background: #d1434f;
      }
      .ag-mem {
        font-size: 11.5px;
        color: #6b7285;
      }
      .ag-hint {
        font-size: 11px;
        color: #5c6377;
        line-height: 1.4;
      }
      .ag-start {
        flex: 0 1 auto;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
      .ag-err {
        margin: 10px 0;
      }

      /* ---- accounts on the box ---- */
      .ag-accounts,
      .ag-features {
        display: grid;
        gap: 14px;
        margin-top: 14px;
        min-width: 0;
      }
      .ag-lede {
        margin: 0;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
        line-height: 1.55;
        max-width: 68ch;
      }
      .ag-lede code,
      .ag-how code,
      .ag-profile-h code,
      .ag-login-state code {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 0.92em;
        color: var(--a-text, #e7e8ee);
        overflow-wrap: anywhere;
      }
      .ag-note-line {
        margin: 0;
        font-size: 12px;
        color: #ff9a9a;
      }
      .ag-profile {
        border: 1px solid var(--a-line, #23262f);
        border-radius: 12px;
        background: var(--a-raise, #15171d);
        padding: 12px 14px;
        display: grid;
        gap: 8px;
        min-width: 0;
      }
      .ag-profile-h {
        font-size: 14px;
        color: var(--a-text, #e7e8ee);
      }
      .ag-login {
        border-left: 3px solid #4b9a6b;
        padding: 6px 0 6px 12px;
        min-width: 0;
      }
      .ag-login.out {
        border-left: 3px dashed #3a3f4d;
      }
      .ag-login.flowing {
        border-left: 3px solid var(--a-amber, #ffb020);
      }
      .ag-login-line {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .ag-login-line strong {
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
        font-weight: 600;
        min-width: 92px;
      }
      .ag-login-state {
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
        flex: 1 1 180px;
        min-width: 0;
      }
      .ag-login-btns {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .ag-login-note {
        margin: 6px 0 0;
        font-size: 12px;
        color: #86e8ab;
        overflow-wrap: anywhere;
      }
      .ag-login-note.bad {
        color: #ff8a8a;
      }
      .ag-paste,
      .ag-flow {
        margin-top: 10px;
        display: grid;
        gap: 8px;
        min-width: 0;
      }
      .ag-how {
        margin: 0;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
        line-height: 1.55;
        max-width: 68ch;
      }
      .ag-paste-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
        min-width: 0;
      }
      .ag-paste-row .admin-input {
        flex: 1 1 220px;
        min-width: 0;
        width: auto;
      }
      .ag-flow-steps {
        margin: 0;
        padding-left: 20px;
        display: grid;
        gap: 9px;
        font-size: 12.5px;
        color: var(--a-text, #e7e8ee);
      }
      .ag-flow-steps li::marker {
        color: #5c6377;
      }
      .ag-wait {
        color: var(--a-dim, #8b90a0);
      }
      .ag-devcode {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 16px;
        letter-spacing: 0.08em;
        color: var(--a-text, #e7e8ee);
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 6px;
        padding: 2px 8px;
      }
      .ag-flow-foot {
        margin: 0;
        display: flex;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        font-size: 11.5px;
        color: #6b7285;
      }
      .ag-addprofile {
        display: flex;
        gap: 10px;
        align-items: flex-end;
        flex-wrap: wrap;
      }

      /* ---- Claude features ---- */
      .ag-feat-head {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
      }
      .ag-feat-head .ag-lede {
        flex: 1 1 260px;
      }
      .ag-picker {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .ag-pick {
        background: var(--a-raise, #15171d);
        border: 1px solid var(--a-line, #2b3040);
        border-left: 3px solid transparent;
        border-radius: 8px;
        color: var(--a-dim, #8b90a0);
        padding: 6px 12px;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12px;
        cursor: pointer;
      }
      .ag-pick.on {
        border-left-color: var(--a-amber, #ffb020);
        color: var(--a-text, #e7e8ee);
      }
      .ag-feat {
        display: grid;
        gap: 6px;
        min-width: 0;
      }
      .ag-item {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
        padding: 8px 12px;
        border: 1px solid var(--a-line, #23262f);
        border-radius: 9px;
        background: var(--a-raise, #15171d);
        min-width: 0;
      }
      .ag-item.off {
        border-style: dashed;
      }
      .ag-item-id {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12px;
        color: var(--a-text, #e7e8ee);
        overflow-wrap: anywhere;
        min-width: 0;
      }
      .ag-item-desc {
        flex: 1 1 200px;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .ag-item .ag-item-meta {
        flex: 1 1 auto;
      }
      .ag-sublabel {
        margin: 6px 0 0;
        font-size: 11.5px;
        color: #6b7285;
      }
      .ag-output {
        margin: 0;
        padding: 9px 11px;
        background: var(--a-void, #0d0e13);
        border-radius: 8px;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11.5px;
        line-height: 1.5;
        color: var(--a-dim, #8b90a0);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-height: 30vh;
        overflow-y: auto;
      }

      @media (max-width: 720px) {
        .ag-run-side {
          align-items: flex-start;
          width: 100%;
        }
        .ag-verdict {
          text-align: left;
        }
        /* A hairline left dangling at the end of a wrapped line reads as a
           rendering fault, so on a phone the separator is space. */
        .ag-run-meta > span + span,
        .ag-item-meta > span + span {
          border-left: 0;
          margin-left: 0;
          padding-left: 0;
        }
        .ag-run-meta,
        .ag-item-meta {
          column-gap: 12px;
        }
        .ag-start {
          flex-basis: 100%;
        }
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
