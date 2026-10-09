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
import { PolicyError, assertYoloAllowed } from "./policy.js";

export class SessionError extends Error {}

export const LIMITS = {
  perProfile: Number(process.env.AGENT_MAX_PER_PROFILE || 2),
  global: Number(process.env.AGENT_MAX_CONCURRENT || 4),
  perDay: Number(process.env.AGENT_MAX_PER_DAY || 50),
};

export const STATES = ["queued", "running", "waiting", "done", "failed", "stopped"];
const LIVE = new Set(["queued", "running", "waiting"]);

const newId = () => `j_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;

export class Registry {
  constructor({ limits = LIMITS, now = () => Date.now() } = {}) {
    this.jobs = new Map();
    this.limits = limits;
    this.now = now;
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

    if (this.startedToday() >= this.limits.perDay) {
      throw new SessionError(
        `The daily cap of ${this.limits.perDay} jobs is spent. It is a cap on spend as much as on load; raise AGENT_MAX_PER_DAY if it is genuinely too low.`
      );
    }
    if (this.list({ live: true }).length >= this.limits.global) {
      throw new SessionError(
        `${this.limits.global} jobs are already running, which is this server's limit. The job was not queued — start it again when one finishes.`
      );
    }
    if (this.liveFor(spec.profile) >= this.limits.perProfile) {
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
      policy: spec.policy || "allowlist",
      disposable: !!spec.disposable,
      verify: Array.isArray(spec.verify) ? spec.verify : [],
      finish: spec.finish || "pr",
      // Set by the runner.
      pid: 0,
      sessionId: "",
      exitCode: null,
      error: "",
      result: null,
      approvals: { asked: 0, allowed: 0, denied: 0 },
    };
    this.jobs.set(job.id, job);
    return job;
  }

  setState(id, state, patch = {}) {
    if (!STATES.includes(state)) throw new SessionError(`Unknown state "${state}".`);
    const job = this.get(id);
    // A finished job does not go back to running. Without this a late event
    // from a dead process can resurrect a job in the UI.
    if (!LIVE.has(job.state) && LIVE.has(state)) {
      throw new SessionError(`Job ${id} already finished as ${job.state}; it cannot return to ${state}.`);
    }
    job.state = state;
    if (state === "running" && !job.startedAt) job.startedAt = this.now();
    if (!LIVE.has(state)) job.endedAt = this.now();
    Object.assign(job, patch);
    return job;
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
