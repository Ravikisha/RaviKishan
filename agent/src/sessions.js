// Many sessions at once, and the limits that stop that becoming a problem.
//
// PURE registry — it holds records and enforces rules, it does not spawn
// anything. runner.js does the spawning and calls in here. Keeping the two
// apart is what makes the concurrency rules testable without starting a
// process.
//
// Three limits, each for a different failure:
//
//   per profile   one account running six jobs at once will hit its rate limit
//                 and every job degrades together. Better to queue.
//   global        the box has 4 cores and 24 GB; npm installs are not free.
//   per day       a background agent can burn a subscription's budget while you
//                 sleep. This is the one people regret not having.
import crypto from "crypto";
import { PolicyError, assertYoloAllowed, assertVerifyCommand } from "./policy.js";
import { NameError, resolveOrg, cleanList, assertSkillName, assertPluginName } from "./names.js";

export class SessionError extends Error {}

export const LIMITS = {
  perProfile: Number(process.env.AGENT_MAX_PER_PROFILE || 2),
  global: Number(process.env.AGENT_MAX_CONCURRENT || 4),
  perDay: Number(process.env.AGENT_MAX_PER_DAY || 50),
};

// `waiting` and `stalled` are both live and both mean "not making progress",
// and they are kept apart on purpose: waiting is a job blocked on YOU (an
// approval card is open), which is the system working; stalled is a job that
// has said nothing for AGENT_STALL_MS while nobody owes it an answer, which is
// the thing worth being told about. Folding them together would page you for
// every approval you are simply slow to read.
export const STATES = ["queued", "running", "waiting", "stalled", "done", "failed", "stopped"];
const LIVE = new Set(["queued", "running", "waiting", "stalled"]);

export const STALL_MS = Number(process.env.AGENT_STALL_MS || 5 * 60 * 1000);

const newId = () => `j_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;

export class Registry {
  constructor({ limits = LIMITS, now = () => Date.now(), stallMs = STALL_MS } = {}) {
    this.jobs = new Map();
    this.limits = limits;
    this.now = now;
    this.stallMs = stallMs;
    // A flag the whole server checks. Set it and nothing new starts — the
    // thing you want to exist BEFORE you need it.
    this.halted = false;
    this.haltReason = "";
  }

  halt(reason = "Stopped by the operator.") {
    this.halted = true;
    this.haltReason = reason;
    return [...this.jobs.values()].filter((j) => LIVE.has(j.state));
  }

  resume() {
    this.halted = false;
    this.haltReason = "";
  }

  list({ live = false } = {}) {
    const all = [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
    return live ? all.filter((j) => LIVE.has(j.state)) : all;
  }

  get(id) {
    const j = this.jobs.get(id);
    if (!j) throw new SessionError(`No job ${id}.`);
    return j;
  }

  liveFor(profile) {
    return this.list({ live: true }).filter((j) => j.profile === profile).length;
  }

  startedToday() {
    const since = this.now() - 24 * 3600 * 1000;
    return [...this.jobs.values()].filter((j) => j.createdAt >= since).length;
  }

  // Everything that could refuse a job refuses HERE, before a process exists,
  // so a rejection costs nothing and says exactly which limit it hit.
  admit(spec) {
    if (this.halted) {
      throw new SessionError(`The agent is halted: ${this.haltReason}`);
    }
    if (!spec.profile) throw new SessionError("A job must name a profile.");
    if (!spec.task || !String(spec.task).trim()) throw new SessionError("A job needs a task.");
    if (!spec.repo) throw new SessionError("A job needs a repository.");

    assertYoloAllowed(spec);
    if (spec.verify !== undefined && !Array.isArray(spec.verify)) throw new SessionError("verify must be a list of commands.");
    for (const cmd of spec.verify || []) {
      try {
        assertVerifyCommand(cmd);
      } catch (e) {
        throw new SessionError(e.message);
      }
    }
    try {
      resolveOrg(spec.orgId);
      cleanList(spec.skills, assertSkillName, { label: "skill" });
      cleanList(spec.plugins, assertPluginName, { label: "plugin" });
    } catch (e) {
      // Re-thrown as a SessionError so the socket and the HTTP API answer 400
      // with the sentence, not 500 as if it were a bug.
      if (e instanceof NameError) throw new SessionError(e.message);
      throw e;
    }

    if (this.startedToday() >= this.limits.perDay) {
      throw new SessionError(
        `The daily cap of ${this.limits.perDay} jobs is spent. It is a cap on spend as much as on load; raise AGENT_MAX_PER_DAY if it is genuinely too low.`
      );
    }
    // Open chats (chat.js) share these limits; server.js points externalLive
    // at the chat registry, so a job and a chat cannot both take the last slot.
    const ext = this.externalLive?.() || { total: 0, byProfile: () => 0 };
    if (this.list({ live: true }).length + ext.total >= this.limits.global) {
      throw new SessionError(
        `${this.limits.global} jobs are already running, which is this server's limit. The job was not queued — start it again when one finishes.`
      );
    }
    if (this.liveFor(spec.profile) + ext.byProfile(spec.profile) >= this.limits.perProfile) {
      throw new SessionError(
        `Profile "${spec.profile}" already has ${this.limits.perProfile} jobs running. Running more on one account mostly means hitting its rate limit together.`
      );
    }
    return true;
  }

  create(spec) {
    this.admit(spec);
    const job = {
      id: newId(),
      state: "queued",
      createdAt: this.now(),
      startedAt: 0,
      endedAt: 0,
      profile: spec.profile,
      tool: spec.tool || "claude",
      repo: spec.repo,
      base: spec.base || "main",
      branch: spec.branch || "",
      task: String(spec.task).trim(),
      // Which org the job acts in. It reaches the site's MCP server as
      // x-org-id, so "post as the channel" resolves inside THIS org's accounts
      // and recall returns this org's memories plus the global ones.
      orgId: resolveOrg(spec.orgId),
      // Hints, not grants: skills are named in the prompt, plugins are enabled
      // for this one run. Validated by the runner before anything spawns.
      skills: cleanList(spec.skills, assertSkillName),
      plugins: cleanList(spec.plugins, assertPluginName),
      policy: spec.policy || "allowlist",
      disposable: !!spec.disposable,
      verify: Array.isArray(spec.verify) ? spec.verify.map(assertVerifyCommand) : [],
      finish: spec.finish || "pr",
      // Set by the runner.
      pid: 0,
      sessionId: "",
      exitCode: null,
      error: "",
      result: null,
      approvals: { asked: 0, allowed: 0, denied: 0 },
      // The last time the process said anything. The stall check reads this,
      // and nothing else, so "stuck" means "silent", never "slow".
      lastEventAt: this.now(),
      stalledAt: 0,
      memory: { recalled: 0, learned: 0, error: "" },
    };
    this.jobs.set(job.id, job);
    return job;
  }

  setState(id, state, patch = {}) {
    if (!STATES.includes(state)) throw new SessionError(`Unknown state "${state}".`);
    const job = this.get(id);
    // A finished job does not go back to running. Without this a late event
    // from a dead process can resurrect a job in the UI.
    //
    // And finished is FINAL, not just "not live": stopped → done was allowed,
    // which is how a run stopped mid-verify went on to push, open a PR and
    // read as Finished; stopped → failed overwrote the owner's Stop with an
    // error about the race it lost.
    if (!LIVE.has(job.state)) {
      throw new SessionError(`Job ${id} already finished as ${job.state}; it cannot become ${state}.`);
    }
    job.state = state;
    if (state === "running" && !job.startedAt) job.startedAt = this.now();
    // Leaving `waiting` restarts the silence clock. Otherwise a job you took
    // eight minutes to approve would be reported stalled the moment you did.
    if (state === "running" || state === "waiting") {
      job.lastEventAt = this.now();
      job.stalledAt = 0;
    }
    if (!LIVE.has(state)) job.endedAt = this.now();
    Object.assign(job, patch);
    return job;
  }

  // Called for every event a job's process emits. A stalled job that speaks
  // again is simply running — stalled is an observation, not a verdict.
  // Returns true when the state changed, so the caller knows to broadcast.
  touch(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.lastEventAt = this.now();
    if (job.state === "stalled") {
      job.state = "running";
      job.stalledAt = 0;
      return true;
    }
    return false;
  }

  // Marks silent running jobs as stalled and returns the ones that changed.
  // Only `running` is eligible: a queued job has not started, and a waiting
  // job is blocked on a human, which is not the job's fault.
  //
  // `owesAnswer(id)` is true while the job has an approval card open. State
  // alone cannot say it: two cards open in parallel, the owner answers one, and
  // the job reads `running` while it is still blocked on the other.
  checkStalls({ owesAnswer = () => false } = {}) {
    const changed = [];
    const now = this.now();
    for (const job of this.jobs.values()) {
      if (job.state !== "running") continue;
      if (owesAnswer(job.id)) continue;
      if (now - (job.lastEventAt || job.startedAt || job.createdAt) >= this.stallMs) {
        job.state = "stalled";
        job.stalledAt = now;
        changed.push(job);
      }
    }
    return changed;
  }

  counts() {
    const out = { queued: 0, running: 0, waiting: 0, stalled: 0, done: 0, failed: 0, stopped: 0 };
    for (const j of this.jobs.values()) out[j.state] = (out[j.state] || 0) + 1;
    return out;
  }

  // Keeps memory bounded on a long-running daemon. Finished jobs older than
  // the window go; live ones never do, whatever their age.
  prune({ keepMs = 7 * 24 * 3600 * 1000, keepAtLeast = 50 } = {}) {
    const finished = this.list().filter((j) => !LIVE.has(j.state));
    const cutoff = this.now() - keepMs;
    let removed = 0;
    for (const j of finished.slice(keepAtLeast)) {
      if (j.endedAt && j.endedAt < cutoff) {
        this.jobs.delete(j.id);
        removed++;
      }
    }
    return removed;
  }
}

export { PolicyError };
