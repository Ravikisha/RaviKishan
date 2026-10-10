// Spawning the actual agent, and the workspace it runs in.
//
// One job, one fresh git worktree, one process, destroyed afterwards. Nothing
// is reused between jobs — a workspace that accumulates state is a workspace
// where job 12 fails because of something job 3 left behind.
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { profileEnv, verifyEnv, ensureProfile, paths } from "./profiles.js";
import { assertVerifyCommand, redact } from "./policy.js";
import { makeParser } from "./stream.js";
// --- desktop ---
import { mcpDesktopConfig, playwrightMcpConfig } from "./mcp-desktop.js";
// --- /desktop ---
import { SITE_MCP_URL } from "./memory.js";
import { DEFAULT_ORG } from "../../lib/server/orgShape.js";

export class RunnerError extends Error {}

// Where a job's own config lives: NEXT TO its workspace, never inside it.
// It used to be written into the clone, where `git add -A` in finish() would
// have committed the approval bridge's per-job secret into the PR.
export const jobConfigDir = (job) => path.join(paths.work, `${job.id}.agentd`);

// The site's MCP server, for a job. Present only when the daemon holds a token
// AND the job has an approval gate: a yolo job is refused credentials by
// policy.assertYoloAllowed, and an MCP token that can write posts and send
// mail is a credential like any other.
export function siteMcpFor(job, { token = process.env.AGENT_MCP_TOKEN || "", url = SITE_MCP_URL() } = {}) {
  if (!token || job.policy === "yolo") return null;
  return { url, token, orgId: job.orgId || DEFAULT_ORG };
}

// The env var a codex job reads the site token from. Codex takes the NAME in
// its config (bearer_token_env_var) and reads the value itself, which keeps
// the token out of argv and therefore out of `ps`.
export const CODEX_SITE_TOKEN_ENV = "AGENTD_SITE_MCP_TOKEN";

// Builds the argv. Pure and exported so the exact flags are testable — the
// difference between `--permission-prompts host` and leaving it off is the
// difference between an approval gate and an agent that silently proceeds.
export function claudeArgs(job, { mcpConfigPath, settingsPath = "" }) {
  const args = [
    "-p",
    job.prompt || job.task,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
  ];

  if (job.policy === "yolo") {
    // Only reachable for a disposable job with no credentials; sessions.js
    // refuses to create any other kind.
    args.push("--dangerously-skip-permissions");
  } else {
    // `host` means "something else answers prompts", and the tool below is
    // what it asks. Without BOTH of these Claude Code would either prompt a
    // terminal nobody is watching, or proceed unasked.
    args.push("--permission-prompts", "host");
    args.push("--permission-prompt-tool", "mcp__agentd__approve");
    args.push("--mcp-config", mcpConfigPath);
  }

  // Plugins named on the job are enabled for this run only, through a
  // settings file, rather than by changing the profile's own settings — a
  // job that wanted a plugin once must not leave it switched on for the next.
  if (settingsPath) args.push("--settings", settingsPath);

  // Even with the approval gate, the obviously destructive tools are denied
  // outright rather than asked about. A prompt is a chance to tap the wrong
  // button; this is a thing that cannot happen at all.
  args.push("--disallowed-tools", "Bash(sudo *)", "Bash(rm -rf /*)");

  return args;
}

// A TOML basic string for a `-c key=value` override. JSON's escaping is a
// subset TOML accepts.
const toml = (s) => JSON.stringify(String(s));

export function codexArgs(job, { site = null } = {}) {
  // Codex has no equivalent of a permission-prompt tool, so it runs read-only
  // unless the job is disposable. Stated rather than silently degraded.
  const args = ["exec"];
  if (site) {
    // Overrides for this run only; the profile's config.toml is not touched.
    // The token is NAMED here, never given.
    args.push("-c", `mcp_servers.site.url=${toml(site.url)}`);
    args.push("-c", `mcp_servers.site.bearer_token_env_var=${toml(CODEX_SITE_TOKEN_ENV)}`);
    args.push("-c", `mcp_servers.site.http_headers={ "x-org-id" = ${toml(site.orgId)} }`);
  }
  if (job.policy !== "yolo") args.push("--sandbox", "read-only");
  // The prompt goes last, after "--", so a task that starts with a hyphen is
  // a prompt and never a flag.
  args.push("--", job.prompt || job.task);
  return args;
}

// PURE. The per-job MCP config Claude Code is pointed at: the approval
// bridge, and the site with this job's org.
// --- desktop ---
// Whether runs get the shared desktop's MCP server (and, opt-in, Playwright
// attached to the desktop's browser). The desktop server carries the SAME
// per-run secret as the approval bridge; agentd gates every action again.
export const desktopEnabled = () => process.env.AGENT_DESKTOP !== "0";
export const playwrightEnabled = () => process.env.AGENT_PLAYWRIGHT_MCP === "1";
// --- /desktop ---

export function mcpConfigFor({ bridge, approveUrl, jobId, jobToken, site, desktop = desktopEnabled(), playwright = playwrightEnabled() }) {
  const servers = {
    agentd: {
      command: process.execPath,
      args: [bridge],
      env: {
        AGENTD_APPROVE_URL: approveUrl,
        AGENTD_JOB_ID: jobId,
        AGENTD_JOB_TOKEN: jobToken,
      },
    },
  };
  if (site) {
    servers.site = {
      type: "http",
      url: site.url,
      headers: { Authorization: `Bearer ${site.token}`, "x-org-id": site.orgId },
    };
  }
  // --- desktop ---
  if (desktop) {
    const desktopUrl = String(approveUrl || "").replace(/\/internal\/approve$/, "/internal/desktop");
    servers.desktop = mcpDesktopConfig({ desktopUrl, callerId: jobId, token: jobToken });
  }
  if (playwright) servers.playwright = playwrightMcpConfig();
  // --- /desktop ---
  return { mcpServers: servers };
}

export const settingsFor = (job) =>
  job.plugins?.length ? { enabledPlugins: Object.fromEntries(job.plugins.map((p) => [p, true])) } : null;

const bridgePath = () =>
  path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "mcp-approve.js");

const mask = (s) => (s ? `••••••••${String(s).slice(-4)}` : "");

// PURE. Everything a job would run, without running it — what `dryRun`
// returns. Secrets in the config are masked, so a dry run can be shown in a
// chat client or pasted into an issue.
export function buildCommand(job, { site = siteMcpFor(job), approveUrl = "http://127.0.0.1:7777/internal/approve" } = {}) {
  const tool = job.tool === "codex" ? "codex" : "claude";
  const cwd = path.join(paths.work, job.id || "<job>");
  if (tool === "codex") {
    return {
      cmd: "codex",
      args: codexArgs(job, { site }),
      cwd,
      files: {},
      env: site ? { [CODEX_SITE_TOKEN_ENV]: mask(site.token) } : {},
    };
  }
  const cfg = jobConfigDir({ id: job.id || "<job>" });
  const mcpConfigPath = path.join(cfg, "mcp.json");
  const settings = settingsFor(job);
  const settingsPath = settings ? path.join(cfg, "settings.json") : "";
  const mcp = mcpConfigFor({
    bridge: bridgePath(),
    approveUrl,
    jobId: job.id || "<job>",
    jobToken: "<per-job secret>",
    site: site && { ...site, token: mask(site.token) },
  });
  return {
    cmd: "claude",
    args: claudeArgs(job, { mcpConfigPath, settingsPath }),
    cwd,
    files: { [mcpConfigPath]: job.policy === "yolo" ? null : mcp, ...(settings ? { [settingsPath]: settings } : {}) },
    env: {},
  };
}

function writeJobFiles(job, { approveUrl, jobToken, site }) {
  const dir = jobConfigDir(job);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const mcpConfigPath = path.join(dir, "mcp.json");
  fs.writeFileSync(
    mcpConfigPath,
    JSON.stringify(mcpConfigFor({ bridge: bridgePath(), approveUrl, jobId: job.id, jobToken, site }), null, 2),
    { mode: 0o600 }
  );
  const settings = settingsFor(job);
  let settingsPath = "";
  if (settings) {
    settingsPath = path.join(dir, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
  }
  return { mcpConfigPath, settingsPath };
}

// A fresh clone per job. `--depth 1` because an agent almost never needs the
// history and a shallow clone of a large repo is the difference between a job
// starting in two seconds and thirty.
export async function prepareWorkspace(job, { git = "git" } = {}) {
  const dir = path.join(paths.work, job.id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const url = job.repoUrl || `https://github.com/${job.repo}.git`;
  await run(git, ["clone", "--depth", "1", "--branch", job.base, url, dir], { cwd: paths.work });

  const branch = job.branch || `agent/${job.id}`;
  await run(git, ["checkout", "-b", branch], { cwd: dir });
  return { dir, branch };
}

function run(cmd, args, { onChild, ...opts } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    if (onChild) onChild(p);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve({ out, err }) : reject(new RunnerError(`${cmd} ${args[0]} failed (${code}): ${err.slice(0, 500)}`))
    );
  });
}

export { run };

// Starts the agent. `onEvent` receives the normalised stream events; the
// returned handle can stop it.
export function startAgent(job, { cwd, approveUrl, onEvent }) {
  ensureProfile(job.profile);
  const jobToken = crypto.randomBytes(24).toString("base64url");

  const tool = job.tool === "codex" ? "codex" : "claude";
  const env = profileEnv(job.profile, { tool });
  const site = siteMcpFor(job);

  let args;
  if (tool === "claude") {
    const { mcpConfigPath, settingsPath } = writeJobFiles(job, { approveUrl, jobToken, site });
    args = claudeArgs(job, { mcpConfigPath, settingsPath });
  } else {
    if (site) env[CODEX_SITE_TOKEN_ENV] = site.token;
    args = codexArgs(job, { site });
  }

  const child = spawn(tool, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const parser = makeParser(tool);
  child.stdout.on("data", (chunk) => {
    for (const e of parser.push(chunk)) onEvent(e);
  });
  // stderr is where update notices and real errors both land; it is logged,
  // never parsed as protocol.
  child.stderr.on("data", (chunk) => onEvent({ type: "stderr", at: Date.now(), text: String(chunk) }));

  return {
    pid: child.pid,
    jobToken,
    stop: () => {
      // SIGTERM first so the tool can write its session file; SIGKILL only if
      // it ignores that. Killing it outright loses the resumable session.
      try {
        child.kill("SIGTERM");
      } catch (_) {}
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch (_) {}
      }, 5000);
    },
    done: new Promise((resolve) => {
      child.on("close", (code) => {
        for (const e of parser.flush()) onEvent(e);
        resolve(code);
      });
      child.on("error", (e) => {
        onEvent({ type: "stderr", at: Date.now(), text: `Could not start ${tool}: ${e.message}` });
        resolve(-1);
      });
    }),
  };
}

// The verify step. Runs in the workspace, and its failure is the job's
// failure — a job that cannot pass its own tests never reaches `finish`.
//
// Three properties, each the answer to a way this step was an open door:
//   - every command is re-checked against policy.assertVerifyCommand here,
//     whatever the caller checked, because this is the code that spawns it;
//   - it runs under verifyEnv, not the daemon's process.env — `env` as a
//     verify command used to print AGENT_MCP_TOKEN into the transcript;
//   - output is redacted before it is an event, like every other line.
// `shouldStop` is asked before each command and `onChild` is handed the
// running one, so a Stop pressed during `npm test` kills the test and the job
// never reaches finish().
export async function verify(job, cwd, onEvent, { shouldStop = () => false, onChild = () => {} } = {}) {
  const cmds = job.verify || [];
  if (!cmds.length) return { ok: true };
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agentd-verify-"));
  try {
    for (const raw of cmds) {
      if (shouldStop()) return { ok: false, stopped: true };
      let cmd;
      try {
        cmd = assertVerifyCommand(raw);
      } catch (e) {
        onEvent({ type: "verify", at: Date.now(), text: e.message, failed: true });
        return { ok: false, failed: String(raw).slice(0, 80), error: e.message };
      }
      onEvent({ type: "verify", at: Date.now(), text: `$ ${cmd}` });
      const [bin, ...rest] = cmd.split(" ");
      try {
        const { out } = await run(bin, rest, { cwd, env: verifyEnv(job.profile, { home }), onChild });
        onEvent({ type: "verify", at: Date.now(), text: redact(out.slice(-4000)) });
      } catch (e) {
        if (shouldStop()) return { ok: false, stopped: true };
        onEvent({ type: "verify", at: Date.now(), text: redact(e.message), failed: true });
        return { ok: false, failed: cmd, error: redact(e.message) };
      }
    }
    if (shouldStop()) return { ok: false, stopped: true };
    return { ok: true };
  } finally {
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch (_) {}
  }
}

export function cleanupWorkspace(job) {
  // The config dir holds a token and goes whatever the finish mode — a patch
  // job keeps its clone for the diff, not its secrets.
  try {
    fs.rmSync(jobConfigDir(job), { recursive: true, force: true });
  } catch (_) {}
  if (job.finish === "patch") return true;
  const dir = path.join(paths.work, job.id);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch (_) {
    return false;
  }
}
