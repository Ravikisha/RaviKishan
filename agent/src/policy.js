// What a job is allowed to do without asking.
//
// PURE — no I/O — so every rule here is unit-testable, which matters more than
// usual: this file is the difference between an assistant and an unattended
// process with your deploy credentials.
//
// THE DEFAULT IS ASK. Everything below is about which narrow set of things is
// safe enough to skip the prompt, and the answer is: reads, and commands that
// cannot change anything outside the working copy.

export class PolicyError extends Error {}

export const POLICIES = ["manual", "allowlist", "yolo"];

// Tools that only read. Approving these every time trains you to tap Allow
// without looking, which is worse than not asking.
const READ_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "NotebookRead",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Task",
]);

// Shell commands that are safe to run unattended under `allowlist`. Matched
// against the START of the command, after normalising whitespace.
//
// Everything here is read-only or confined to the working copy. Note what is
// NOT here: push, deploy, rm, curl piped to a shell, anything with sudo,
// anything that writes outside the repo, and any package manager command that
// RUNS code from the network (`npm install` executes install scripts, so it is
// allowed only in the verify phase where the repo is already trusted).
const SAFE_COMMANDS = [
  /^git (status|diff|log|show|branch|rev-parse|ls-files|blame)\b/,
  /^(ls|cat|head|tail|wc|find|grep|rg|file|stat|pwd|which|du)\b/,
  /^node --check\b/,
  /^npm (run )?(test|lint)\b/,
  /^npx? (tsc|eslint|prettier) --?/,
  /^echo\b/,
];

// Commands that must NEVER be auto-approved, even if something above would
// match them. Checked first, and deliberately broad — a false prompt costs a
// tap, a false approval costs a repository.
const NEVER = [
  /\bsudo\b/,
  /\brm\s+-[rf]/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\b/,
  /\b(curl|wget)\b[^|]*\|\s*(ba)?sh\b/,
  /\bchmod\s+[0-7]*7[0-7]*\b/,
  /\b(shutdown|reboot|mkfs|dd)\b/,
  />\s*\/(etc|usr|bin|boot)\//,
  /\b(vercel|netlify|fly|wrangler)\b.*\bdeploy\b/,
  /\bnpm\s+publish\b/,
  // Reaching for a credential file is never incidental.
  /\.env\b|\bid_rsa\b|\bcredentials\.json\b|\.ssh\//,
];

const normalise = (cmd) => String(cmd || "").replace(/\s+/g, " ").trim();

// The decision. Returns { allow, reason } — `reason` is shown to the human on
// the approval card, so it is written for them, not for a log.
export function decide({ policy = "manual", tool, input = {} } = {}) {
  if (!POLICIES.includes(policy)) {
    throw new PolicyError(`Unknown policy "${policy}". Known: ${POLICIES.join(", ")}.`);
  }
  if (!tool) throw new PolicyError("A tool name is required to decide anything.");

  // yolo exists so the dangerous option is a named, auditable choice rather
  // than a flag someone adds at 1am. The server still refuses it unless the
  // job is marked disposable — see jobs.js — so this returning true is not on
  // its own enough to run anything.
  if (policy === "yolo") {
    return { allow: true, reason: "Policy is yolo: nothing is asked." };
  }

  if (policy === "manual") {
    return { allow: false, reason: "Policy is manual: every tool asks." };
  }

  // allowlist
  if (READ_TOOLS.has(tool)) {
    return { allow: true, reason: `${tool} only reads.` };
  }

  if (tool === "Bash") {
    const cmd = normalise(input.command);
    if (!cmd) return { allow: false, reason: "An empty command is never run unasked." };

    const banned = NEVER.find((re) => re.test(cmd));
    if (banned) {
      return {
        allow: false,
        reason: `This command always asks, whatever the policy (matched ${banned}).`,
      };
    }
    const safe = SAFE_COMMANDS.find((re) => re.test(cmd));
    if (safe) return { allow: true, reason: "A read-only command on the allowlist." };

    return { allow: false, reason: "Not on the allowlist of read-only commands." };
  }

  // Write, Edit, MultiEdit, NotebookEdit and anything new.
  return { allow: false, reason: `${tool} can change things, so it asks.` };
}

// A job may only use `yolo` if it was declared disposable AND has no
// credentials mounted. Two independent conditions, because either alone is a
// mistake waiting to happen.
export function assertYoloAllowed(job) {
  if (job.policy !== "yolo") return;
  if (!job.disposable) {
    throw new PolicyError(
      "Policy yolo is only allowed on a job marked disposable. Mark it disposable, or use allowlist."
    );
  }
  if (job.credentials && Object.keys(job.credentials).length) {
    throw new PolicyError(
      "Policy yolo is refused for a job with credentials mounted. An agent with no approval gate must not hold a token."
    );
  }
}

// Secrets must not reach the browser transcript. Applied to every line of tool
// output before it is streamed.
//
// This is a mitigation, not a guarantee: a determined agent could encode a
// secret past it. It exists because the realistic leak is accidental — a
// `cat .env`, a stack trace, a debug print — and those it does catch.
const SECRET_PATTERNS = [
  // key=value in an env file or a shell export
  /\b([A-Z][A-Z0-9_]{3,})\s*=\s*(['"]?)([^\s'"]{8,})\2/g,
  // Bearer tokens and the common provider prefixes
  /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\b(sk-[A-Za-z0-9-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g,
  // Private key blocks
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redact(text) {
  let out = String(text ?? "");
  out = out.replace(SECRET_PATTERNS[0], (m, k, q, v) =>
    // Keep the key visible — knowing WHICH variable appeared is useful, and
    // the name is not the secret.
    `${k}=${q}${"•".repeat(Math.min(12, v.length))}${q}`
  );
  out = out.replace(SECRET_PATTERNS[1], (m, p) => `${p}••••••••`);
  out = out.replace(SECRET_PATTERNS[2], "••••••••");
  out = out.replace(SECRET_PATTERNS[3], "-----REDACTED PRIVATE KEY-----");
  return out;
}
