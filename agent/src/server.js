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
import { verifyToken, assertFresh, AuthError } from "./auth.js";
import { Registry, SessionError } from "./sessions.js";
import { Approvals } from "./approvals.js";
import { decide } from "./policy.js";
import { listProfiles, pickProfile, ensureProfile, paths } from "./profiles.js";
import { prepareWorkspace, startAgent, verify, cleanupWorkspace, run } from "./runner.js";
import fs from "fs";

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

const broadcast = (msg) => {
  const text = JSON.stringify(msg);
  for (const ws of sockets) {
    if (ws.readyState === 1) ws.send(text);
  }
};

const approvals = new Approvals({ onChange: (e) => broadcast(e) });

// Per-job secrets for the approval bridge. A runner can only answer for its
// own job, so a compromised job cannot approve another's push.
const jobTokens = new Map();

/* ---------------- running a job ---------------- */

async function execute(job) {
  const log = (e) => {
    broadcast({ type: "event", jobId: job.id, event: e });
    // The transcript is kept on disk so a reconnecting panel can catch up
    // without the daemon holding every job in memory.
    try {
      fs.appendFileSync(`${paths.logs}/${job.id}.ndjson`, `${JSON.stringify(e)}\n`);
    } catch (_) {}
  };

  try {
    registry.setState(job.id, "running");
    broadcast({ type: "job", job });

    const { dir, branch } = await prepareWorkspace(job);
    registry.setState(job.id, "running", { branch });
    log({ type: "workspace", at: Date.now(), text: `Cloned ${job.repo} onto ${branch}` });

    const approveUrl = `http://127.0.0.1:${PORT}/internal/approve`;
    const handle = startAgent(job, { cwd: dir, approveUrl, onEvent: log });
    jobTokens.set(job.id, handle.jobToken);
    registry.setState(job.id, "running", { pid: handle.pid });
    job._stop = handle.stop;

    const code = await handle.done;
    if (code !== 0) {
      registry.setState(job.id, "failed", { exitCode: code, error: `The agent exited with code ${code}.` });
      return;
    }

    // A job that cannot pass its own tests never reaches `finish`. Same rule
    // the rest of this project applies to itself.
    const v = await verify(job, dir, log);
    if (!v.ok) {
      registry.setState(job.id, "failed", { error: `Verification failed at "${v.failed}".` });
      return;
    }

    const result = await finish(job, dir, branch, log);
    registry.setState(job.id, "done", { result });
  } catch (e) {
    registry.setState(job.id, "failed", { error: e.message });
    log({ type: "stderr", at: Date.now(), text: e.message });
  } finally {
    approvals.forget(job.id);
    jobTokens.delete(job.id);
    if (job.finish !== "patch") cleanupWorkspace(job);
    broadcast({ type: "job", job: registry.get(job.id) });
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

/* ---------------- http ---------------- */

const server = http.createServer(async (req, res) => {
  const json = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };

  if (req.url === "/health") return json(200, { ok: true, jobs: registry.list({ live: true }).length, halted: registry.halted });

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
    const auto = decide({ policy: job.policy, tool: payload.tool, input: payload.input });
    if (auto.allow) {
      job.approvals.allowed++;
      return json(200, { allow: true, reason: auto.reason });
    }

    job.approvals.asked++;
    registry.setState(job.id, "waiting");
    broadcast({ type: "job", job });

    const answer = await approvals.ask(job.id, { ...payload, policyReason: auto.reason });
    if (answer.allow) job.approvals.allowed++;
    else job.approvals.denied++;

    if (registry.get(job.id).state === "waiting") {
      registry.setState(job.id, "running");
      broadcast({ type: "job", job });
    }
    return json(200, answer);
  }

  json(404, { error: "Not found." });
});

/* ---------------- websocket ---------------- */

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.authed = null;
  sockets.add(ws);

  const reply = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

  ws.on("close", () => sockets.delete(ws));

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
        return reply({
          type: "ready",
          profiles: listProfiles(),
          jobs: registry.list(),
          approvals: approvals.list(),
          halted: registry.halted,
          limits: registry.limits,
        });
      }

      if (!ws.authed) throw new AuthError("Authenticate first.");
      // A socket opened an hour ago is not proof of anything now.
      assertFresh(ws.authed);

      switch (msg.type) {
        case "jobs":
          return reply({ type: "jobs", jobs: registry.list() });

        case "start": {
          const profile = pickProfile(msg.profile, { profiles: listProfiles() });
          const job = registry.create({ ...msg, profile });
          reply({ type: "job", job });
          // Deliberately not awaited: the socket answers immediately and the
          // job reports through broadcasts.
          execute(job);
          return;
        }

        case "stop": {
          const job = registry.get(msg.jobId);
          if (job._stop) job._stop();
          registry.setState(job.id, "stopped");
          return broadcast({ type: "job", job });
        }

        case "answer":
          return reply({ type: "answered", ...approvals.answer(msg.id, msg) });

        case "halt":
          return broadcast({ type: "halted", stopped: registry.halt(msg.reason).length, reason: registry.haltReason });

        case "resume":
          registry.resume();
          return broadcast({ type: "resumed" });

        case "profile.add":
          ensureProfile(msg.name);
          return reply({ type: "profiles", profiles: listProfiles() });

        case "transcript": {
          const file = `${paths.logs}/${msg.jobId}.ndjson`;
          const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
          const events = text.split("\n").filter(Boolean).slice(-500).map((l) => JSON.parse(l));
          return reply({ type: "transcript", jobId: msg.jobId, events });
        }

        default:
          return reply({ type: "error", error: `Unknown message "${msg.type}".` });
      }
    } catch (e) {
      const status = e instanceof AuthError ? e.status : e instanceof SessionError ? 400 : 500;
      reply({ type: "error", error: e.message, status });
    }
  });

  // Cloudflare idles out a quiet socket; a heartbeat keeps a long job's
  // transcript flowing and lets the panel notice a dead connection.
  const beat = setInterval(() => ws.readyState === 1 && ws.ping(), 25_000);
  ws.on("close", () => clearInterval(beat));
});

setInterval(() => registry.prune(), 3600_000).unref?.();

server.listen(PORT, HOST, () => {
  console.log(`agentd listening on ${HOST}:${PORT}`);
  console.log(`profiles: ${listProfiles().map((p) => p.name).join(", ") || "none yet"}`);
});
