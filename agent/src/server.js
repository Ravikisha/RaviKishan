// agentd — the only thing on this box that is reachable from the network.
//
// Deliberately small. It authenticates, it keeps the job registry, it routes
// approvals, and it streams. It does NOT execute anything itself: every command
// runs in a workspace via runner.js. Keeping it small is the point — this is
// the file someone should be able to audit in an afternoon, because it is the
// front door to a machine that clones repositories and holds deploy
// credentials.
import http from "http";
import crypto from "crypto";
import { WebSocketServer } from "ws";
import { verifyToken, assertFresh, AuthError, canReceive, AUTH_GRACE_MS } from "./auth.js";
import { Registry, SessionError } from "./sessions.js";
import { Approvals } from "./approvals.js";
import { decide, redact } from "./policy.js";
import { isModelText } from "./stream.js";
import path from "path";
import { listProfiles, pickProfile, ensureProfile, paths, assertProfileName, ProfileError } from "./profiles.js";
import { prepareWorkspace, startAgent, verify, cleanupWorkspace, run, buildCommand } from "./runner.js";
import { LoginFlows, LoginError, storeToken, loginStatus, logout, assertTool } from "./login.js";
import { listPlugins, installPlugin, removePlugin, addMarketplace, listSkills, listMcp, PluginError } from "./plugins.js";
import { NameError } from "./names.js";
import { PolicyError } from "./policy.js";
import { buildPrompt, recallFor, reflectFor, memoryEnabled, SITE_MCP_URL } from "./memory.js";
import { handleApi, isApiPath, assertJobId, ApiError } from "./api.js";
import * as wa from "./whatsapp.js";
import fs from "fs";
import os from "os";
// --- desktop ---
import { createWorkbench, WORKBENCH_ERRORS } from "./workbench.js";
// --- /desktop ---
// --- chat ---
import { ChatRegistry, ChatError, isChatId, readSession, assertChatId, MAX_WAIT_MS } from "./chat.js";
// --- /chat ---

const PORT = Number(process.env.AGENT_PORT || 7777);
// Bound to loopback by default. Cloudflare Tunnel connects outward from this
// box, so nothing needs to listen on a public interface — and if the tunnel is
// misconfigured the failure is "unreachable", not "open to the internet".
const HOST = process.env.AGENT_HOST || "127.0.0.1";

for (const d of [paths.root, paths.profiles, paths.work, paths.logs]) {
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
}

const registry = new Registry();
const sockets = new Set();

// A socket joins `sockets` only once it has authenticated (see the `auth`
// branch below), and is still checked here: an authenticated socket whose
// token has since expired is closed rather than fed, and the panel reconnects
// with a fresh token on its own.
const broadcast = (msg) => {
  const text = JSON.stringify(msg);
  for (const ws of sockets) {
    if (canReceive(ws)) ws.send(text);
    else if (ws.readyState === 1 && ws.authed) closeExpired(ws);
  }
};

function closeExpired(ws) {
  sockets.delete(ws);
  try {
    ws.close(4401, "Token expired; reconnect.");
  } catch (_) {}
}

// --- desktop ---
// Created below, once the job and chat registries exist; approval decisions
// feed the review timeline through it.
let workbench = null;
// --- /desktop ---
const approvals = new Approvals({
  onChange: (e) => {
    broadcast(e);
    workbench?.onApproval(e);
  },
});

// Relayed sign-ins. Their prompts (URL, device code) and outcomes go to every
// panel, because the person who started one may be on another device by the
// time the provider's page shows the code.
const loginFlows = new LoginFlows({ onEvent: (e) => broadcast(e) });

// Per-job secrets for the approval bridge. A runner can only answer for its
// own job, so a compromised job cannot approve another's push.
const jobTokens = new Map();

// What each job's model SAID, kept apart from the job record (which is
// broadcast whole on every state change) and bounded. Read once, when the job
// ends, for the learnings block.
const jobText = new Map();
const TEXT_KEEP = 40_000;

const transcriptFile = (jobId) => `${paths.logs}/${assertJobId(jobId)}.ndjson`;

function readTranscript(jobId, tail = 500) {
  const file = transcriptFile(jobId);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return text
    .split("\n")
    .filter(Boolean)
    .slice(-tail)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch (_) {
        return { type: "log", text: l };
      }
    });
}

/* ---------------- running a job ---------------- */

async function execute(job) {
  const log = (raw) => {
    // Redacted ONCE, here, before the event goes anywhere — the socket, the
    // transcript on disk, the learnings text. Verify output and stderr used to
    // reach all three verbatim.
    const e = typeof raw?.text === "string" ? { ...raw, text: redact(raw.text) } : raw;
    broadcast({ type: "event", jobId: job.id, event: e });
    workbench?.onJobEvent(job.id, e); // --- desktop --- the review timeline
    // Every event is proof of life. A stalled job that speaks again goes back
    // to running, and the panel is told.
    if (registry.touch(job.id)) broadcast({ type: "job", job: publicJob(job) });
    if (isModelText(job, e)) {
      jobText.set(job.id, `${jobText.get(job.id) || ""}\n${e.text}`.slice(-TEXT_KEEP));
    }
    // The transcript is kept on disk so a reconnecting panel can catch up
    // without the daemon holding every job in memory.
    try {
      fs.appendFileSync(`${paths.logs}/${job.id}.ndjson`, `${JSON.stringify(e)}\n`);
    } catch (_) {}
  };

  // Asked at every point where the next step does something: a Stop can land
  // during the clone, the recall (up to 20s against the site), the agent, or
  // the verify, and each of those used to carry on regardless.
  const stopped = () => registry.get(job.id).state === "stopped";

  try {
    registry.setState(job.id, "running");
    broadcast({ type: "job", job: publicJob(job) });

    const { dir, branch } = await prepareWorkspace(job);
    registry.setState(job.id, "running", { branch });
    log({ type: "workspace", at: Date.now(), text: `Cloned ${job.repo} onto ${branch}` });

    // Recall BEFORE the agent starts, so what was learned last time is in the
    // prompt rather than something the model must think to ask for. Fail soft:
    // an error is a line in the transcript, not a failed job.
    const recalled = await recallFor(job);
    job.memory.recalled = recalled.memories.length;
    if (recalled.error) job.memory.error = recalled.error;
    log({
      type: "memory",
      at: Date.now(),
      text: recalled.error
        ? `Memory unavailable (${recalled.error}); running without it.`
        : recalled.skipped
        ? `Memory skipped: ${recalled.skipped}.`
        : `Recalled ${recalled.memories.length} memor${recalled.memories.length === 1 ? "y" : "ies"} for org ${job.orgId}.`,
    });
    job.prompt = buildPrompt(job, { memories: recalled.memories, reflect: memoryEnabled() });

    // Stopped while recall was in flight: there is no process to kill yet, so
    // the only correct move is not to start one.
    if (stopped()) return;

    const approveUrl = `http://127.0.0.1:${PORT}/internal/approve`;
    const handle = startAgent(job, { cwd: dir, approveUrl, onEvent: log });
    // The kill switch is wired BEFORE anything that can throw. It used to be
    // assigned after setState, so a setState refusal left a live claude with
    // no handle anywhere.
    job._stop = handle.stop;
    jobTokens.set(job.id, handle.jobToken);
    if (stopped()) {
      handle.stop();
      return;
    }
    registry.setState(job.id, "running", { pid: handle.pid });

    const code = await handle.done;

    // Reflect whatever the exit code: a failed job is where the lessons are.
    // Never awaited into the outcome — memory makes the NEXT job better.
    if (memoryEnabled()) {
      const r = await reflectFor(job, jobText.get(job.id) || "");
      job.memory.learned = r.learned;
      if (r.error) job.memory.error = r.error;
      log({
        type: "memory",
        at: Date.now(),
        text: r.error ? `Could not file learnings (${r.error}).` : r.skipped ? `No learnings filed: ${r.skipped}.` : `Filed ${r.learned} learning${r.learned === 1 ? "" : "s"}.`,
      });
    }

    // Stopped from the panel or the API while it ran: the record already says
    // so, and a stopped job must not go on to verify, commit and push.
    if (stopped()) return;

    if (code !== 0) {
      registry.setState(job.id, "failed", { exitCode: code, error: `The agent exited with code ${code}.` });
      return;
    }

    // A job that cannot pass its own tests never reaches `finish`. Same rule
    // the rest of this project applies to itself. A Stop during verify kills
    // the running command (job._stop is re-pointed at it) and ends here.
    const v = await verify(job, dir, log, {
      shouldStop: stopped,
      onChild: (child) => {
        job._stop = () => {
          try {
            child.kill("SIGTERM");
          } catch (_) {}
        };
      },
    });
    if (v.stopped || stopped()) return;
    if (!v.ok) {
      registry.setState(job.id, "failed", { error: `Verification failed at "${v.failed}".` });
      return;
    }

    // The last chance before anything leaves the box.
    if (stopped()) return;
    const result = await finish(job, dir, branch, log);
    registry.setState(job.id, "done", { result });
  } catch (e) {
    // Guarded: a job stopped mid-clone is already finished, and setState
    // refusing that here would throw out of the catch and take the daemon
    // down with an unhandled rejection.
    try {
      registry.setState(job.id, "failed", { error: e.message });
    } catch (_) {}
    // Whatever threw, the job is over: a process it started must not outlive
    // it untracked. Killing one that already exited is a no-op.
    try {
      job._stop?.();
    } catch (_) {}
    log({ type: "stderr", at: Date.now(), text: e.message });
  } finally {
    approvals.forget(job.id);
    jobTokens.delete(job.id);
    jobText.delete(job.id);
    // Removes the per-job config (it holds tokens) always, and the clone
    // unless the job finishes as a patch.
    cleanupWorkspace(job);
    broadcast({ type: "job", job: publicJob(registry.get(job.id)) });
  }
}

async function finish(job, dir, branch, log) {
  const { out: status } = await run("git", ["status", "--porcelain"], { cwd: dir });
  if (!status.trim()) {
    log({ type: "finish", at: Date.now(), text: "Nothing changed, so there is nothing to push." });
    return { kind: "noop" };
  }

  if (job.finish === "patch") {
    const { out: diff } = await run("git", ["diff"], { cwd: dir });
    return { kind: "patch", diff: diff.slice(0, 200_000) };
  }

  await run("git", ["add", "-A"], { cwd: dir });
  await run("git", ["-c", `user.name=${process.env.AGENT_GIT_NAME || "agentd"}`, "-c", `user.email=${process.env.AGENT_GIT_EMAIL || "agent@localhost"}`, "commit", "-m", job.task.slice(0, 72)], { cwd: dir });
  await run("git", ["push", "-u", "origin", branch], { cwd: dir });
  log({ type: "finish", at: Date.now(), text: `Pushed ${branch}` });

  if (job.finish === "pr") {
    try {
      const { out } = await run("gh", ["pr", "create", "--fill", "--head", branch, "--base", job.base], { cwd: dir });
      return { kind: "pr", url: out.trim().split(/\s+/).pop() };
    } catch (e) {
      // The branch is pushed either way; a failed PR is recoverable by hand
      // and must not read as a failed job.
      log({ type: "finish", at: Date.now(), text: `Pushed, but the PR could not be opened: ${e.message}` });
      return { kind: "branch", branch };
    }
  }
  return { kind: "branch", branch };
}

/* ---------------- whatsapp ---------------- */

// One dispatcher, used by both the MCP tools (over HTTP) and the panel (over
// the WebSocket), so a capability cannot exist in one and not the other.
const WA_ACTIONS = new Set([
  "status", "connect", "disconnect", "logout",
  "chats", "read", "search", "send", "markRead", "exists",
]);

async function whatsappAction({ action, profile = process.env.AGENT_DEFAULT_PROFILE || "personal", ...args } = {}) {
  if (!WA_ACTIONS.has(action)) {
    throw new wa.WaError(`Unknown action "${action}". Known: ${[...WA_ACTIONS].join(", ")}.`);
  }

  if (action === "status") {
    return {
      installed: await wa.isInstalled(),
      hasSession: wa.hasSession(profile),
      sessions: wa.statusAll(),
    };
  }

  if (action === "connect") {
    const s = await wa.connect(profile, { onEvent: (e) => broadcast(e) });
    return s.status();
  }

  if (action === "disconnect") return wa.disconnect(profile, { logout: false });
  if (action === "logout") return wa.disconnect(profile, { logout: true });

  const session = wa.get(profile);
  switch (action) {
    case "chats":
      return { chats: session.listChats(args) };
    case "read":
      return session.readChat(args.jid, args);
    case "search":
      return { query: args.query, messages: session.search(args.query, args) };
    case "send":
      return session.send(args.to, args.text, { quoted: args.quoted });
    case "markRead":
      return session.markRead(args.jid);
    case "exists":
      return session.exists(args.number);
    default:
      throw new wa.WaError(`Unhandled action "${action}".`);
  }
}

/* ---------------- operations, shared by the socket and the HTTP API ---------------- */

// Errors that carry a sentence for a human (a refused limit, a bad name, a
// missing profile) answer 400; anything else is a bug and answers 500.
const USER_ERRORS = [SessionError, PolicyError, ProfileError, LoginError, PluginError, NameError, ApiError];
const isUserError = (e) => USER_ERRORS.some((C) => e instanceof C);

// A job as it leaves this box: the record, plus how long it has run and how
// long it has been silent — the two numbers "is it stuck?" is answered with.
function publicJob(job) {
  const now = Date.now();
  const { _stop, prompt, ...rest } = job;
  return {
    ...rest,
    elapsedMs: job.startedAt ? (job.endedAt || now) - job.startedAt : 0,
    idleMs: ["running", "stalled", "waiting"].includes(job.state) ? now - (job.lastEventAt || now) : 0,
    pendingApprovals: approvals.list(job.id).length,
  };
}

function profileRows() {
  return listProfiles().map((p) => {
    let login = null;
    try {
      login = loginStatus(p.name);
    } catch (_) {}
    return { ...p, login };
  });
}

// Disk is the resource a box of clones runs out of first. statfs is Node
// 18.15+; on anything older the figure is simply absent, not guessed.
function diskFree() {
  try {
    const s = fs.statfsSync(paths.root);
    return { freeGb: +((s.bavail * s.bsize) / 1e9).toFixed(1), totalGb: +((s.blocks * s.bsize) / 1e9).toFixed(1) };
  } catch (_) {
    return null;
  }
}

// --- chat ---
// Chats share the job limits both ways: a chat counts against a job's slot
// (registry.externalLive) and a job against a chat's (jobsLive).
const chats = new ChatRegistry({
  approvals,
  approveUrl: `http://127.0.0.1:${PORT}/internal/approve`,
  isHalted: () => registry.halted,
  jobsLive: () => ({ total: registry.list({ live: true }).length, byProfile: (p) => registry.liveFor(p) }),
  onEvent: (chatId, event) => broadcast({ type: "chat.event", chatId, event }),
  onState: (chatId, state, sessionId) => broadcast({ type: "chat.state", chatId, state, sessionId }),
});
registry.externalLive = () => chats.liveCounts();

const chatOps = {
  chatList() {
    return { live: chats.list(), history: chats.history({ profiles: listProfiles().map((p) => p.name) }) };
  },
  chatHistory({ profile, tool, sessionId, cap } = {}) {
    return readSession({ profile: assertProfileName(profile), tool: tool || "claude", sessionId, cap: Math.max(1, Math.min(500, Number(cap) || 200)) });
  },
  async chatStart(spec = {}) {
    const profile = pickProfile(spec.profile, { profiles: listProfiles() });
    const out = spec.sessionId ? await chats.resume({ ...spec, profile }) : await chats.start({ ...spec, profile });
    return { chatId: out.chatId, sessionId: out.sessionId, reused: !!out.reused, chat: out.chat };
  },
  async chatResume(spec = {}) {
    const profile = pickProfile(spec.profile, { profiles: listProfiles() });
    const out = await chats.resume({ ...spec, profile });
    return { chatId: out.chatId, sessionId: out.sessionId, reused: !!out.reused, chat: out.chat };
  },
  async chatMessage(id, { text, waitMs } = {}) {
    return chats.sendAndWait(assertChatId(id), text, Math.min(MAX_WAIT_MS, Math.max(0, Number(waitMs) || 60_000)));
  },
  chatInterrupt(id) {
    return chats.interrupt(assertChatId(id));
  },
  chatClose(id) {
    return chats.close(assertChatId(id));
  },
};

setInterval(() => {
  chats.checkIdle();
  chats.prune();
}, 60_000).unref?.();
// --- /chat ---

const ops = {
  async status() {
    const counts = registry.counts();
    return {
      ok: true,
      host: os.hostname(),
      uptimeSec: Math.round(process.uptime()),
      load: os.loadavg().map((n) => +n.toFixed(2)),
      cpus: os.cpus().length,
      memory: { totalMb: Math.round(os.totalmem() / 1e6), freeMb: Math.round(os.freemem() / 1e6) },
      disk: diskFree(),
      halted: registry.halted,
      haltReason: registry.haltReason,
      limits: registry.limits,
      stallMs: registry.stallMs,
      startedToday: registry.startedToday(),
      counts,
      running: counts.running,
      waiting: counts.waiting,
      stalled: counts.stalled,
      profiles: profileRows(),
      siteMcp: { enabled: memoryEnabled(), url: SITE_MCP_URL() },
      logins: loginFlows.list(),
    };
  },

  list({ live = false, limit = 50 } = {}) {
    return registry.list({ live }).slice(0, Math.max(1, Math.min(200, limit))).map(publicJob);
  },

  get(id, { tail = 100 } = {}) {
    const job = registry.get(id);
    return { run: publicJob(job), approvals: approvals.list(id), transcript: readTranscript(id, tail) };
  },

  // dryRun answers with exactly what would run — argv, the per-job config
  // with secrets masked, the prompt before recall — and creates nothing.
  async start(spec = {}) {
    const profile = pickProfile(spec.profile, { profiles: listProfiles() });
    if (spec.dryRun) {
      let refusal = "";
      try {
        registry.admit({ ...spec, profile });
      } catch (e) {
        refusal = e.message;
      }
      const preview = { ...spec, id: "", profile, orgId: spec.orgId || "", policy: spec.policy || "allowlist", skills: spec.skills || [], plugins: spec.plugins || [], task: String(spec.task || "").trim() };
      preview.prompt = buildPrompt(preview, { memories: [], reflect: memoryEnabled() });
      return {
        dryRun: true,
        wouldStart: !refusal,
        refusal,
        command: buildCommand(preview),
        note: memoryEnabled() ? "Recalled memories are prepended to the prompt at start; none are fetched for a dry run." : "Memory is off on this server (no AGENT_MCP_TOKEN).",
      };
    }
    const job = registry.create({ ...spec, profile });
    // Deliberately not awaited: the caller answers immediately and the job
    // reports through broadcasts.
    execute(job);
    return { run: publicJob(job) };
  },

  stop(id) {
    const job = registry.get(id);
    if (job._stop) job._stop();
    try {
      registry.setState(job.id, "stopped");
    } catch (_) {
      // Already finished — stopping a finished job is a no-op, not an error.
    }
    broadcast({ type: "job", job: publicJob(job) });
    return { run: publicJob(job) };
  },

  answer(id, body = {}) {
    // Only `allow: true` allows; approvals.answer enforces it again.
    return approvals.answer(id, { allow: body.allow === true, reason: String(body.reason || "").slice(0, 300), scope: body.scope === "session" ? "session" : "once" });
  },
};
// --- desktop ---
// The desktop bridge's callers: a job (its approval secret and policy) or a
// chat (the chat's own). Anything else is refused.
workbench = createWorkbench({
  approvals,
  broadcast,
  callerFor: (id) => {
    if (jobTokens.has(id)) {
      try {
        return { token: jobTokens.get(id), policy: registry.get(id).policy };
      } catch (_) {
        return null;
      }
    }
    if (isChatId(id)) {
      try {
        const c = chats.get(id);
        return c.token && c.state !== "closed" ? { token: c.token, policy: c.policy } : null;
      } catch (_) {
        return null;
      }
    }
    return null;
  },
});
USER_ERRORS.push(...WORKBENCH_ERRORS);
// --- /desktop ---
// --- chat ---
Object.assign(ops, chatOps);
USER_ERRORS.push(ChatError);
// --- /chat ---

// The stall check. Cheap (a pass over an in-memory map), so it runs often
// enough that "stalled" appears within a tick of the threshold.
setInterval(() => {
  for (const job of registry.checkStalls({ owesAnswer: (id) => approvals.list(id).length > 0 })) {
    broadcast({ type: "job", job: publicJob(job) });
    broadcast({ type: "job.stalled", jobId: job.id, idleMs: Date.now() - job.lastEventAt });
  }
}, Math.min(15_000, Math.max(1000, Math.floor(registry.stallMs / 4)))).unref?.();

/* ---------------- http ---------------- */

const server = http.createServer(async (req, res) => {
  const json = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };

  if (req.url === "/health") return json(200, { ok: true, jobs: registry.list({ live: true }).length, halted: registry.halted });

  // --- desktop ---
  // /preview/<port>/… (cookie-authenticated proxy) and the loopback desktop
  // bridge for runs' MCP servers.
  if (await workbench.handleHttp(req, res)) return;
  // --- /desktop ---

  // The approval bridge. Loopback only, and authenticated with the per-job
  // secret — not with the admin's token, which never leaves the browser.
  if (req.url === "/internal/approve" && req.method === "POST") {
    if (req.socket.remoteAddress !== "127.0.0.1" && req.socket.remoteAddress !== "::ffff:127.0.0.1" && req.socket.remoteAddress !== "::1") {
      return json(403, { allow: false, reason: "Approvals are answered on the server only." });
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (_) {
      return json(400, { allow: false, reason: "Unreadable approval request." });
    }

    // --- chat ---
    // A chat's bridge carries a chat id where a job's carries a job id; the
    // chat registry checks its own per-chat secret and policy.
    if (isChatId(payload.jobId)) {
      const r = await chats.approve(payload, (req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
      return json(r.status, r.body);
    }
    // --- /chat ---

    const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const expected = jobTokens.get(payload.jobId);
    // Timing-safe, because this is a secret comparison on a loopback endpoint
    // that a job's own code could reach.
    const ok =
      expected &&
      bearer.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(bearer), Buffer.from(expected));
    if (!ok) return json(403, { allow: false, reason: "That job cannot answer approvals." });

    let job;
    try {
      job = registry.get(payload.jobId);
    } catch (_) {
      return json(404, { allow: false, reason: "No such job." });
    }

    // Policy first: anything auto-approved never reaches a human, and anything
    // on the never-list is refused without asking.
    // The workspace goes in so a read is judged by WHERE it reads: the clone
    // yes, the profiles directory and the per-job config beside it no.
    const auto = decide({ policy: job.policy, tool: payload.tool, input: payload.input, workspace: path.join(paths.work, job.id) });
    if (auto.allow) {
      job.approvals.allowed++;
      return json(200, { allow: true, reason: auto.reason });
    }

    // A job that has already ended (stopped from the panel while its process
    // was still winding down) gets a refusal, not a card nobody should answer.
    if (!["running", "stalled", "waiting", "queued"].includes(job.state)) {
      return json(200, { allow: false, reason: `The job is ${job.state}.` });
    }
    job.approvals.asked++;
    registry.setState(job.id, "waiting");
    broadcast({ type: "job", job: publicJob(job) });

    const answer = await approvals.ask(job.id, { ...payload, policyReason: auto.reason });
    if (answer.allow) job.approvals.allowed++;
    else job.approvals.denied++;

    // Back to running only once NOTHING is open: with two cards up, answering
    // one leaves the job still blocked on the other, and calling that
    // `running` is how it came to be reported stalled while it waited on you.
    if (registry.get(job.id).state === "waiting" && approvals.list(job.id).length === 0) {
      registry.setState(job.id, "running");
      broadcast({ type: "job", job: publicJob(job) });
    }
    return json(200, answer);
  }

  // WhatsApp, for the MCP tools.
  //
  // Authenticated with an ordinary Firebase ID token — the MCP server already
  // holds the admin's refresh token and can mint one, so there is no new
  // shared secret to store, rotate or leak. One identity, one allow-list, the
  // same one the panel uses.
  if (req.url === "/whatsapp" && req.method === "POST") {
    try {
      await verifyToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    } catch (e) {
      return json(e.status || 401, { error: e.message });
    }

    let body = "";
    for await (const chunk of req) body += chunk;
    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch (_) {
      return json(400, { error: "Unreadable request." });
    }

    try {
      return json(200, await whatsappAction(payload));
    } catch (e) {
      // A WaError carries a sentence written for a human; anything else is a
      // bug and says so rather than pretending to be advice.
      return json(e instanceof wa.WaError ? 400 : 500, { error: e.message });
    }
  }

  // The run-control API for the MCP tools. Same authentication as /whatsapp.
  if (isApiPath(req.url)) return handleApi(req, res, { verifyToken, ops, isUserError, workbench: workbench.api });

  json(404, { error: "Not found." });
});

/* ---------------- websocket ---------------- */

// --- desktop ---
// Upgrades are routed by path: /desktop (VNC) and /preview/<port>/… belong to
// the workbench; everything else is the panel's socket. ws's own `server`
// mode would answer 400 to the paths it does not own, so routing is explicit.
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (workbench.claimsUpgrade(req.url)) return workbench.handleUpgrade(req, socket, head);
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
// --- /desktop ---

wss.on("connection", (ws) => {
  ws.authed = null;
  // NOT added to `sockets` here. A socket that has not authenticated must not
  // receive a single broadcast — see canReceive in auth.js for what one leaked.
  // And it gets a few seconds to authenticate, not forever.
  const grace = setTimeout(() => {
    if (!ws.authed) {
      try {
        ws.close(4401, "Authenticate first.");
      } catch (_) {}
    }
  }, AUTH_GRACE_MS);
  grace.unref?.();

  const reply = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

  ws.on("close", () => {
    clearTimeout(grace);
    sockets.delete(ws);
    workbench.onSocketClose(ws); // --- desktop --- a closed window takes its shells with it
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch (_) {
      return reply({ type: "error", error: "Unreadable message." });
    }

    try {
      if (msg.type === "auth") {
        ws.authed = await verifyToken(msg.token);
        // Only now does it hear broadcasts.
        sockets.add(ws);
        return reply({
          type: "ready",
          profiles: profileRows(),
          jobs: registry.list().map(publicJob),
          approvals: approvals.list(),
          logins: loginFlows.list(),
          halted: registry.halted,
          limits: registry.limits,
          stallMs: registry.stallMs,
          siteMcp: { enabled: memoryEnabled(), url: SITE_MCP_URL() },
        });
      }

      if (!ws.authed) throw new AuthError("Authenticate first.");
      // A socket opened an hour ago is not proof of anything now.
      assertFresh(ws.authed);

      // --- desktop ---
      if (await workbench.handleSocket(ws, msg, reply)) return;
      // --- /desktop ---

      switch (msg.type) {
        case "jobs":
          return reply({ type: "jobs", jobs: registry.list().map(publicJob) });

        case "status":
          return reply({ type: "status", ...(await ops.status()) });

        case "start": {
          const { type: _t, ...spec } = msg;
          const out = await ops.start(spec);
          return reply(out.dryRun ? { type: "dryRun", ...out } : { type: "job", job: out.run });
        }

        case "stop":
          ops.stop(assertJobId(msg.jobId));
          return;

        case "answer":
          return reply({ type: "answered", ...approvals.answer(msg.id, msg) });

        case "halt":
          return broadcast({ type: "halted", stopped: registry.halt(msg.reason).length, reason: registry.haltReason });

        case "resume":
          registry.resume();
          return broadcast({ type: "resumed" });

        case "profile.add":
          ensureProfile(msg.name);
          return reply({ type: "profiles", profiles: profileRows() });

        case "whatsapp":
          return reply({ type: "whatsapp", action: msg.action, result: await whatsappAction(msg) });

        case "transcript":
          return reply({ type: "transcript", jobId: msg.jobId, events: readTranscript(msg.jobId, 500) });

        /* ---- signing a profile in ---- */

        // The token never comes back: the reply is the status row, which
        // carries presence and the last four characters only.
        case "login.token": {
          const status = await storeToken({ profile: msg.profile, tool: msg.tool, token: msg.token });
          broadcast({ type: "profiles", profiles: profileRows() });
          return reply({ type: "login.status", profile: msg.profile, tool: msg.tool, status });
        }

        case "login.start":
          return reply({ type: "login.started", ...loginFlows.start({ profile: msg.profile, tool: msg.tool }) });

        case "login.code":
          return reply({ type: "login.codeSent", ...loginFlows.code(msg.id, msg.code) });

        case "login.cancel":
          return reply({ type: "login.cancelled", ...loginFlows.cancel(msg.id) });

        case "login.logout": {
          const status = await logout({ profile: msg.profile, tool: assertTool(msg.tool) });
          broadcast({ type: "profiles", profiles: profileRows() });
          return reply({ type: "login.status", profile: msg.profile, tool: msg.tool, status });
        }

        case "login.status":
          return reply({ type: "login.status", profile: msg.profile, status: loginStatus(assertProfileName(msg.profile)) });

        /* ---- Claude Code features, per profile ---- */

        case "plugins.list":
          return reply({ type: "plugins", ...(await listPlugins(assertProfileName(msg.profile))) });

        case "plugins.install":
        case "plugins.remove":
        case "marketplace.add": {
          const profile = assertProfileName(msg.profile);
          const result =
            msg.type === "plugins.install"
              ? await installPlugin(profile, msg.name)
              : msg.type === "plugins.remove"
              ? await removePlugin(profile, msg.name)
              : await addMarketplace(profile, msg.source);
          // The fresh list rides along, so the panel never shows a stale one
          // after a change it just made.
          return reply({ type: "plugins", action: msg.type, result, ...(await listPlugins(profile)) });
        }

        case "skills.list":
          return reply({ type: "skills", ...listSkills(assertProfileName(msg.profile)) });

        case "mcp.list":
          return reply({ type: "mcp", ...(await listMcp(assertProfileName(msg.profile))) });

        // --- chat ---
        case "chat.list":
          return reply({ type: "chats", ...chatOps.chatList() });

        case "chat.history":
          return reply({ type: "chat.history", ...chatOps.chatHistory(msg) });

        case "chat.start":
        case "chat.resume": {
          const { type: _t, ...spec } = msg;
          const out = msg.type === "chat.resume" ? await chatOps.chatResume(spec) : await chatOps.chatStart(spec);
          return reply({ type: "chat.started", ...out });
        }

        case "chat.send":
          return reply({ type: "chat.sent", chat: chats.send(assertChatId(msg.chatId), msg.text) });

        case "chat.interrupt":
          return reply({ type: "chat.interrupted", chat: chatOps.chatInterrupt(msg.chatId) });

        case "chat.close":
          return reply({ type: "chat.closed", chat: chatOps.chatClose(msg.chatId) });
        // --- /chat ---

        default:
          return reply({ type: "error", error: `Unknown message "${msg.type}".` });
      }
    } catch (e) {
      const status = e instanceof AuthError ? e.status : isUserError(e) ? 400 : 500;
      // `request` echoes the message type (never its body — a login.token body
      // is a credential) so the panel knows which control failed.
      reply({ type: "error", error: e.message, status, request: msg.type });
    }
  });

  // Cloudflare idles out a quiet socket; a heartbeat keeps a long job's
  // transcript flowing and lets the panel notice a dead connection.
  // The same tick retires a socket whose token expired during a quiet spell,
  // so a stale one is not left holding a place in `sockets`.
  const beat = setInterval(() => {
    if (ws.readyState !== 1) return;
    if (ws.authed && !canReceive(ws)) return closeExpired(ws);
    ws.ping();
  }, 25_000);
  ws.on("close", () => clearInterval(beat));
});

setInterval(() => registry.prune(), 3600_000).unref?.();

server.listen(PORT, HOST, () => {
  console.log(`agentd listening on ${HOST}:${PORT}`);
  console.log(`profiles: ${listProfiles().map((p) => p.name).join(", ") || "none yet"}`);
});
