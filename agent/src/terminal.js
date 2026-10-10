// A shell on this box, in the admin.
//
// Three rules, each the answer to a way a browser terminal goes wrong:
//   - OUTPUT GOES ONLY TO THE SOCKET THAT OPENED IT. Never broadcast: a shell
//     is not a transcript, and a second viewer (another tab, a stale socket)
//     must not see what was typed or printed.
//   - It needs a FRESH sign-in (auth_time within 30 minutes), checked at open.
//   - Every command line entered is written to the ops timeline (redacted),
//     and every terminal dies with the socket that opened it.
//
// node-pty is an optionalDependency; when it did not build, `script -qfc`
// gives a real pty without it (resize is then unavailable, and says so).
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { record as recordOp } from "./oplog.js";
import { assertRecentSignIn } from "./auth.js";
import { paths } from "./profiles.js";

export class TerminalError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const MAX_PER_SOCKET = 4;
export const MAX_TOTAL = 8;
const MAX_INPUT = 64 * 1024;

const clampDim = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
};

// The shell's environment: the daemon's own secrets removed, the shared
// desktop's display set.
export function shellEnv(base = process.env, { cols = 120, rows = 32 } = {}) {
  const env = { ...base };
  for (const k of Object.keys(env)) if (/^(AGENT_MCP_TOKEN|AGENT_ADMIN_EMAILS|AGENT_PREVIEW_SECRET)$/.test(k)) delete env[k];
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.DISPLAY = process.env.AGENT_DISPLAY || ":1";
  env.COLUMNS = String(cols);
  env.LINES = String(rows);
  return env;
}

// Where a shell may start: an existing directory. Defaults to the workspaces.
export function resolveCwd(cwd, { home = process.env.HOME || "/home/agent", fallback = paths.work } = {}) {
  if (cwd === undefined || cwd === null || cwd === "") return fallback;
  const raw = String(cwd);
  if (raw.length > 500 || raw.includes("\0")) throw new TerminalError("That is not a directory.");
  const p = path.resolve(raw.startsWith("~") ? path.join(home, raw.slice(1)) : raw);
  let st;
  try {
    st = fs.statSync(p);
  } catch (_) {
    throw new TerminalError(`${p} does not exist.`);
  }
  if (!st.isDirectory()) throw new TerminalError(`${p} is not a directory.`);
  return p;
}

// PURE. Turns keystrokes into the command lines they submit, for the
// timeline. Backspace edits; Ctrl-C and Ctrl-U clear; escape sequences
// (arrows, function keys) are dropped — so a line edited with arrow keys or
// tab-completed is logged as TYPED, which the summary says.
export class LineCapture {
  constructor({ max = 2000 } = {}) {
    this.buf = "";
    this.max = max;
    this.esc = 0; // 0 none, 1 saw ESC, 2 inside CSI/SS3
  }
  push(data) {
    const lines = [];
    for (const ch of String(data)) {
      const c = ch.charCodeAt(0);
      if (this.esc === 1) {
        this.esc = ch === "[" || ch === "O" ? 2 : 0;
        continue;
      }
      if (this.esc === 2) {
        if (c >= 0x40 && c <= 0x7e) this.esc = 0;
        continue;
      }
      if (c === 0x1b) {
        this.esc = 1;
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        const line = this.buf.trim();
        this.buf = "";
        if (line) lines.push(line);
        continue;
      }
      if (c === 0x7f || c === 0x08) {
        this.buf = this.buf.slice(0, -1);
        continue;
      }
      if (c === 0x03 || c === 0x15) {
        this.buf = "";
        continue;
      }
      if (c < 0x20) continue;
      if (this.buf.length < this.max) this.buf += ch;
    }
    return lines;
  }
}

let ptyModule;
export async function loadPty() {
  if (ptyModule !== undefined) return ptyModule;
  try {
    const m = await import("node-pty");
    ptyModule = m.default || m;
  } catch (_) {
    ptyModule = null;
  }
  return ptyModule;
}

// The fallback: util-linux `script` allocates the pty. -q quiet, -f flush,
// -c the command, /dev/null the typescript nobody wants.
export const scriptArgs = () => ["-qfc", "bash -l", "/dev/null"];

function startFallback({ cwd, env, spawnFn = spawn }) {
  const child = spawnFn("script", scriptArgs(), { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const listeners = { data: [], exit: [] };
  child.stdout.on("data", (d) => listeners.data.forEach((f) => f(String(d))));
  child.stderr.on("data", (d) => listeners.data.forEach((f) => f(String(d))));
  child.on("close", (code) => listeners.exit.forEach((f) => f({ exitCode: code })));
  child.on("error", (e) => {
    listeners.data.forEach((f) => f(`\r\nCould not start a shell: ${e.message}\r\n`));
    listeners.exit.forEach((f) => f({ exitCode: -1 }));
  });
  return {
    backend: "script",
    pid: child.pid,
    write: (d) => child.stdin.writable && child.stdin.write(d),
    resize: () => false,
    kill: () => {
      try {
        child.kill("SIGHUP");
      } catch (_) {}
    },
    onData: (f) => listeners.data.push(f),
    onExit: (f) => listeners.exit.push(f),
  };
}

function startPty(pty, { cwd, env, cols, rows }) {
  const p = pty.spawn("bash", ["-l"], { name: "xterm-256color", cols, rows, cwd, env });
  return {
    backend: "node-pty",
    pid: p.pid,
    write: (d) => p.write(d),
    resize: (c, r) => {
      p.resize(c, r);
      return true;
    },
    kill: () => {
      try {
        p.kill();
      } catch (_) {}
    },
    onData: (f) => p.onData(f),
    onExit: (f) => p.onExit(f),
  };
}

const send = (ws, msg) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
};

export class Terminals {
  constructor({ log = recordOp, pty = loadPty, spawnFn = spawn, requireFresh = assertRecentSignIn } = {}) {
    this.log = log;
    this.pty = pty;
    this.spawnFn = spawnFn;
    this.requireFresh = requireFresh;
    this.terms = new Map(); // termId → { ws, proc, capture, cwd }
  }

  countFor(ws) {
    let n = 0;
    for (const t of this.terms.values()) if (t.ws === ws) n++;
    return n;
  }

  // The terminal belongs to its opener. Anyone else is told it does not exist
  // rather than that it is someone else's.
  own(ws, termId) {
    const t = this.terms.get(String(termId || ""));
    if (!t || t.ws !== ws) throw new TerminalError("No such terminal.", 404);
    return t;
  }

  async open(ws, { cols, rows, cwd } = {}) {
    this.requireFresh(ws?.authed, { what: "Opening a terminal" });
    if (this.countFor(ws) >= MAX_PER_SOCKET) throw new TerminalError(`At most ${MAX_PER_SOCKET} terminals per window. Close one first.`, 429);
    if (this.terms.size >= MAX_TOTAL) throw new TerminalError(`At most ${MAX_TOTAL} terminals on the box. Close one first.`, 429);
    const c = clampDim(cols, 10, 500, 120);
    const r = clampDim(rows, 4, 200, 32);
    const dir = resolveCwd(cwd);
    const env = shellEnv(process.env, { cols: c, rows: r });
    const pty = await this.pty();
    const proc = pty ? startPty(pty, { cwd: dir, env, cols: c, rows: r }) : startFallback({ cwd: dir, env, spawnFn: this.spawnFn });
    const termId = `t_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
    const t = { ws, proc, capture: new LineCapture(), cwd: dir, who: String(ws?.authed?.email || "") };
    this.terms.set(termId, t);
    proc.onData((data) => send(ws, { type: "term.output", termId, data }));
    proc.onExit(({ exitCode } = {}) => {
      if (!this.terms.has(termId)) return;
      this.terms.delete(termId);
      send(ws, { type: "term.exit", termId, exitCode: exitCode ?? null });
    });
    this.log({ actor: "owner", kind: "terminal", summary: `Opened a terminal in ${dir}`, detail: { termId, cwd: dir, backend: proc.backend } });
    return { termId, cwd: dir, backend: proc.backend, resizable: proc.backend === "node-pty" };
  }

  input(ws, termId, data) {
    const t = this.own(ws, termId);
    const d = String(data ?? "");
    if (d.length > MAX_INPUT) throw new TerminalError("That paste is too large for one message.", 413);
    for (const line of t.capture.push(d)) {
      this.log({ actor: "owner", kind: "terminal", summary: `$ ${line}`, detail: { termId, cwd: t.cwd, note: "as typed" } });
    }
    t.proc.write(d);
    return true;
  }

  resize(ws, termId, cols, rows) {
    const t = this.own(ws, termId);
    const ok = t.proc.resize(clampDim(cols, 10, 500, 120), clampDim(rows, 4, 200, 32));
    return { resized: !!ok, ...(ok ? {} : { reason: "This box has no node-pty, so the fallback terminal cannot be resized." }) };
  }

  close(ws, termId) {
    const t = this.own(ws, termId);
    this.terms.delete(String(termId));
    t.proc.kill();
    this.log({ actor: "owner", kind: "terminal", summary: "Closed a terminal", detail: { termId } });
    return true;
  }

  // A socket that goes away takes its shells with it.
  closeAll(ws) {
    let n = 0;
    for (const [id, t] of this.terms) {
      if (t.ws !== ws) continue;
      this.terms.delete(id);
      t.proc.kill();
      n++;
    }
    return n;
  }
}
