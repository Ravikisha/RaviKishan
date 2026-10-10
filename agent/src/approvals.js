// "Can I run this?" — asked on the server, answered on your phone.
//
// This is the piece that makes a remote agent feel like Claude Code rather than
// a cron job you cannot argue with, and it is also the piece where a mistake is
// most expensive. Two rules, and neither bends:
//
//   DENY BY DEFAULT.    An approval that is not an explicit yes is a no.
//   DENY ON TIMEOUT.    A sleeping phone must never become a yes. If nobody
//                       answers, the tool call is refused with "no answer" —
//                       the job stalls, which is recoverable, instead of
//                       pushing to main, which is not.
//
// The promise returned by `ask` is what Claude Code's permission-prompt tool
// blocks on, so resolving it IS the answer.
import crypto from "crypto";
import { redact } from "./policy.js";

export class ApprovalError extends Error {}

export const DEFAULT_TIMEOUT_MS = Number(process.env.AGENT_APPROVAL_TIMEOUT_MS || 10 * 60 * 1000);

const newId = () => `a_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;

export class Approvals {
  constructor({ timeoutMs = DEFAULT_TIMEOUT_MS, now = () => Date.now(), onChange = () => {} } = {}) {
    this.pending = new Map();
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.onChange = onChange;
    // Remembered "allow for the rest of this job" decisions, keyed by job and
    // a signature of the request. Scoped to the job on purpose: a blanket
    // always-allow that outlives the session is how the gate stops existing.
    this.sessionAllows = new Map();
  }

  // Two requests are "the same" when the tool and its meaningful input match.
  // For Bash that is the exact command — NOT a prefix, because allowing
  // `git push origin feature` must not also allow `git push --force origin main`.
  signature(req) {
    const input = req.input || {};
    const key = req.tool === "Bash" ? String(input.command || "") : JSON.stringify(input);
    return `${req.tool}::${key}`;
  }

  remembered(jobId, req) {
    return this.sessionAllows.get(jobId)?.has(this.signature(req)) || false;
  }

  remember(jobId, req) {
    if (!this.sessionAllows.has(jobId)) this.sessionAllows.set(jobId, new Set());
    this.sessionAllows.get(jobId).add(this.signature(req));
  }

  forget(jobId) {
    this.sessionAllows.delete(jobId);
    // Any still-pending approval for a job that has ended is denied, so a
    // runner cannot be left holding a promise nobody will ever answer.
    for (const [id, p] of this.pending) {
      if (p.jobId === jobId) this.answer(id, { allow: false, reason: "The job ended." });
    }
  }

  list(jobId) {
    const all = [...this.pending.values()].map((p) => p.card);
    return jobId ? all.filter((c) => c.jobId === jobId) : all;
  }

  // Called by the permission-prompt tool. Resolves to { allow, reason }.
  // `timeoutMs` shortens the wait for one card — the desktop API answers an
  // HTTP caller that gives up after ~20s, and a card left open past that
  // would let a click land after nobody was waiting for it. Never longer than
  // the default: deny-on-timeout only gets stricter.
  ask(jobId, req, { timeoutMs } = {}) {
    const wait = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, this.timeoutMs) : this.timeoutMs;
    if (this.remembered(jobId, req)) {
      return Promise.resolve({ allow: true, reason: "Allowed earlier in this job." });
    }

    const id = newId();
    const card = {
      id,
      jobId,
      tool: req.tool,
      // Redacted before it leaves the server, because a tool call's arguments
      // can carry a secret just as easily as its output.
      input: redactInput(req.input),
      summary: summarise(req),
      cwd: req.cwd || "",
      askedAt: this.now(),
      expiresAt: this.now() + wait,
    };

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.answer(id, {
          allow: false,
          reason: wait >= 60000 ? `Nobody answered within ${Math.round(wait / 60000)} minutes, so it was refused.` : `Nobody answered within ${Math.round(wait / 1000)} seconds, so it was refused.`,
          timedOut: true,
        });
      }, wait);
      // Deliberately NOT unref'd. The daemon's listening socket keeps the
      // process alive anyway, so unref bought nothing — and it made the
      // deny-on-timeout rule, the most important one in this file, impossible
      // to test: node exited before the timer could fire.

      this.pending.set(id, { card, resolve, timer, jobId });
      this.onChange({ type: "approval.asked", card });
    });
  }

  answer(id, { allow, reason = "", scope = "once", timedOut = false } = {}) {
    const p = this.pending.get(id);
    if (!p) throw new ApprovalError(`No approval ${id} is waiting. It may have timed out already.`);

    clearTimeout(p.timer);
    this.pending.delete(id);

    // Only an explicit true allows. Anything else — undefined, a string, a
    // truthy object from a malformed client — is a refusal.
    const allowed = allow === true;
    if (allowed && scope === "session") this.remember(p.jobId, p.card);

    const answer = {
      allow: allowed,
      reason: reason || (allowed ? "Allowed." : "Denied."),
      timedOut,
    };
    this.onChange({ type: "approval.answered", id, jobId: p.jobId, ...answer });
    p.resolve(answer);
    return answer;
  }
}

// What the card says, in one line, written for the person deciding at a bus
// stop rather than for a log.
export function summarise(req) {
  const input = req.input || {};
  switch (req.tool) {
    case "Bash":
      return `Run: ${String(input.command || "").slice(0, 300)}`;
    case "Write":
      return `Create or overwrite ${input.file_path || "a file"}`;
    case "Edit":
    case "MultiEdit":
      return `Edit ${input.file_path || "a file"}`;
    case "WebFetch":
      return `Fetch ${input.url || "a URL"}`;
    // A desktop action from agentd's own gate (desktop.js). The approval card
    // must say exactly what will happen on the shared screen.
    case "Desktop": {
      const a = input.action;
      if (a === "click" || a === "double_click") return `Desktop: ${a === "click" ? "click" : "double-click"} ${input.button || "left"} at (${input.x}, ${input.y})`;
      if (a === "move") return `Desktop: move the pointer to (${input.x}, ${input.y})`;
      if (a === "type") return `Desktop: type "${String(input.text || "").slice(0, 200)}"`;
      if (a === "key") return `Desktop: press ${input.combo}`;
      if (a === "scroll") return `Desktop: scroll ${input.direction} ${input.amount}`;
      if (a === "open_url") return `Desktop: open ${input.url}`;
      if (a === "focus_window") return `Desktop: focus the window "${input.window}"`;
      return `Desktop: ${a}`;
    }
    default:
      return `${req.tool}${input.file_path ? ` on ${input.file_path}` : ""}`;
  }
}

function redactInput(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = typeof v === "string" ? redact(v).slice(0, 2000) : v;
  }
  return out;
}
