// Spawning the actual agent, and the workspace it runs in.
//
// One job, one fresh git worktree, one process, destroyed afterwards. Nothing
// is reused between jobs — a workspace that accumulates state is a workspace
// where job 12 fails because of something job 3 left behind.
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { profileEnv, ensureProfile, paths } from "./profiles.js";
import { makeParser } from "./stream.js";

export class RunnerError extends Error {}

// Builds the argv. Pure and exported so the exact flags are testable — the
// difference between `--permission-prompts host` and leaving it off is the
// difference between an approval gate and an agent that silently proceeds.
export function claudeArgs(job, { mcpConfigPath }) {
  const args = [
    "-p",
    job.task,
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

  // Even with the approval gate, the obviously destructive tools are denied
  // outright rather than asked about. A prompt is a chance to tap the wrong
  // button; this is a thing that cannot happen at all.
  args.push("--disallowed-tools", "Bash(sudo *)", "Bash(rm -rf /*)");

  return args;
}

export function codexArgs(job) {
  // Codex has no equivalent of a permission-prompt tool, so it runs read-only
  // unless the job is disposable. Stated rather than silently degraded.
  const args = ["exec", job.task];
  if (job.policy !== "yolo") args.push("--sandbox", "read-only");
  return args;
}

// The per-job MCP config pointing Claude Code at our approval bridge.
function writeMcpConfig(dir, { approveUrl, jobId, jobToken }) {
  const file = path.join(dir, "mcp.json");
  const bridge = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "mcp-approve.js");
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        mcpServers: {
          agentd: {
            command: process.execPath,
            args: [bridge],
            env: {
              AGENTD_APPROVE_URL: approveUrl,
              AGENTD_JOB_ID: jobId,
              AGENTD_JOB_TOKEN: jobToken,
            },
          },
        },
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  return file;
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

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
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

  let args;
  if (tool === "claude") {
    const mcpConfigPath = writeMcpConfig(cwd, { approveUrl, jobId: job.id, jobToken });
    args = claudeArgs(job, { mcpConfigPath });
  } else {
    args = codexArgs(job);
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
export async function verify(job, cwd, onEvent) {
  for (const cmd of job.verify || []) {
    onEvent({ type: "verify", at: Date.now(), text: `$ ${cmd}` });
    const [bin, ...rest] = cmd.split(/\s+/);
    try {
      const { out } = await run(bin, rest, { cwd });
      onEvent({ type: "verify", at: Date.now(), text: out.slice(-4000) });
    } catch (e) {
      onEvent({ type: "verify", at: Date.now(), text: e.message, failed: true });
      return { ok: false, failed: cmd, error: e.message };
    }
  }
  return { ok: true };
}

export function cleanupWorkspace(job) {
  const dir = path.join(paths.work, job.id);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch (_) {
    return false;
  }
}
