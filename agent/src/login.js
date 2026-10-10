// Signing a profile in from the admin, without SSH.
//
// Two paths, because the two tools and the two kinds of account want different
// things:
//
//   TOKEN    paste a `claude setup-token` token (Claude) or an OpenAI API key
//            (Codex). Stored on THIS box, in the profile dir, mode 600. Never
//            in Firestore, never in a log, never echoed back — status reports
//            presence and the last four characters, which is enough to tell two
//            tokens apart and useless to anyone who reads it.
//   RELAYED  agentd runs the tool's own sign-in (`claude auth login`,
//            `codex login --device-auth`) under the profile's config dir,
//            relays the URL / device code to the panel, and pipes back the code
//            the operator pastes. The browser never sees a credential: the tool
//            writes it straight into the profile.
//
// Every spawn is array-form — no shell, so a profile name or a pasted code
// cannot become a command — and the profile name passes assertProfileName
// before it reaches a path.
import { spawn as nodeSpawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { assertProfileName, ensureProfile, profileDir, profileEnv, tokenFile, storedToken, hasCredentials } from "./profiles.js";

export class LoginError extends Error {}

export const TOOLS = ["claude", "codex"];
export const LOGIN_TIMEOUT_MS = Number(process.env.AGENT_LOGIN_TIMEOUT_MS || 10 * 60 * 1000);

export function assertTool(tool) {
  if (!TOOLS.includes(tool)) throw new LoginError(`Unknown tool "${tool}". Known tools: ${TOOLS.join(", ")}.`);
  return tool;
}

// A token is one opaque line. Anything with whitespace inside it is a paste
// accident (two tokens, a trailing sentence) and storing it would produce a
// login that fails later with an error that never mentions the paste.
export function assertTokenShape(tool, token) {
  const t = String(token ?? "").trim();
  if (!t) throw new LoginError("Paste a token first.");
  if (/\s/.test(t)) throw new LoginError("That token contains whitespace, so it is probably two things pasted together. Paste just the token.");
  if (t.length < 20 || t.length > 4096) throw new LoginError(`That does not look like a ${tool} token (${t.length} characters).`);
  if (t.startsWith("-")) throw new LoginError("A token cannot start with a hyphen.");
  return t;
}

export const last4 = (t) => (t && t.length >= 8 ? t.slice(-4) : "");

const metaFile = (profile) => path.join(profileDir(profile), ".login.json");

function readMeta(profile) {
  try {
    return JSON.parse(fs.readFileSync(metaFile(profile), "utf8")) || {};
  } catch (_) {
    return {};
  }
}

function writeMeta(profile, meta) {
  fs.writeFileSync(metaFile(profile), JSON.stringify(meta, null, 2), { mode: 0o600 });
}

const writeSecret = (file, value) => {
  fs.writeFileSync(file, `${value}\n`, { mode: 0o600 });
  // writeFileSync's mode only applies when it CREATES the file; an existing
  // one keeps whatever mode it had.
  fs.chmodSync(file, 0o600);
};

// Runs a CLI to completion, optionally feeding stdin. Injected in tests.
export function runCli(cmd, args, { env, input, timeoutMs = 60_000, spawn = nodeSpawn } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return resolve({ code: -1, out: "", err: e.message });
    }
    let out = "";
    let err = "";
    const t = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: -1, out, err: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out, err });
    });
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end();
  });
}

// Stores a pasted token. Resolves to the status row, never to the token.
export async function storeToken({ profile, tool, token }, { spawn } = {}) {
  assertProfileName(profile);
  assertTool(tool);
  const t = assertTokenShape(tool, token);
  ensureProfile(profile);

  if (tool === "claude") {
    // CLAUDE_CODE_OAUTH_TOKEN is read from the environment at spawn time
    // (profileEnv), so storing the file IS signing in.
    writeSecret(tokenFile(profile, "claude"), t);
  } else {
    // Codex keeps its own auth file, so the tool writes it — `--with-api-key`
    // reads the key from stdin, which keeps it out of argv and therefore out
    // of `ps`. If the CLI is missing, the file is written in the shape it
    // would have written, so the profile works the moment codex is installed.
    const env = profileEnv(profile, { tool: "codex" });
    const r = await runCli("codex", ["login", "--with-api-key"], { env, input: `${t}\n`, spawn });
    if (r.code !== 0) {
      const authFile = path.join(env.CODEX_HOME, "auth.json");
      fs.writeFileSync(authFile, JSON.stringify({ OPENAI_API_KEY: t }, null, 2), { mode: 0o600 });
      fs.chmodSync(authFile, 0o600);
    }
    // Kept so status can report the last four without parsing codex's file.
    writeSecret(tokenFile(profile, "codex"), t);
  }

  const meta = readMeta(profile);
  meta[tool] = { method: "token", last4: last4(t), at: Date.now() };
  writeMeta(profile, meta);
  return loginStatus(profile)[tool];
}

// What the panel and get_agent_status show: presence, method, last four.
export function loginStatus(profile) {
  assertProfileName(profile);
  const dir = profileDir(profile);
  const meta = readMeta(profile);
  const out = {};
  for (const tool of TOOLS) {
    const token = storedToken(profile, tool);
    const oauth = hasCredentials(path.join(dir, tool));
    const m = meta[tool] || {};
    out[tool] = {
      signedIn: !!token || oauth,
      method: token ? "token" : oauth ? "oauth" : null,
      last4: token ? last4(token) : "",
      at: m.at || 0,
    };
  }
  return out;
}

// Removes a profile's credentials for one tool. The tool's own logout runs
// first (so a server-side session is revoked where the tool supports it),
// then the files go regardless — a logout that fails half way must still
// leave the profile signed OUT, because that is what was asked for.
export async function logout({ profile, tool }, { spawn } = {}) {
  assertProfileName(profile);
  assertTool(tool);
  const dir = profileDir(profile);
  if (!fs.existsSync(dir)) return loginStatus(profile)[tool];

  const env = profileEnv(profile, { tool });
  await runCli(tool, tool === "claude" ? ["auth", "logout"] : ["logout"], { env, spawn, timeoutMs: 30_000 });

  fs.rmSync(tokenFile(profile, tool), { force: true });
  const confDir = path.join(dir, tool);
  for (const f of [".credentials.json", "credentials.json", "auth.json"]) {
    fs.rmSync(path.join(confDir, f), { force: true });
  }
  const meta = readMeta(profile);
  delete meta[tool];
  writeMeta(profile, meta);
  return loginStatus(profile)[tool];
}

// Removes a pasted token and its record, leaving the tool's own OAuth login
// in place. Used when a relayed sign-in replaces a pasted one.
export function dropPastedToken(profile, tool) {
  assertProfileName(profile);
  assertTool(tool);
  fs.rmSync(tokenFile(profile, tool), { force: true });
  const meta = readMeta(profile);
  if (meta[tool]) {
    delete meta[tool];
    writeMeta(profile, meta);
  }
}

/* ---------------- relayed sign-in ---------------- */

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
const URL_RE = /https:\/\/[^\s"'<>]+/g;
// Device codes as both tools print them: XXXX-XXXX or XXXX-XXXXX.
const CODE_RE = /\b([A-Z0-9]{4,5}-[A-Z0-9]{4,5})\b/;

// PURE. Pulls the sign-in URL and device code out of a chunk of CLI output.
// The URL picked is the first that looks like a sign-in page, not the first
// URL at all — both tools print documentation links in the same banner.
export function parseLoginOutput(text) {
  const clean = String(text || "").replace(ANSI, "");
  const urls = (clean.match(URL_RE) || []).map((u) => u.replace(/[).,;]+$/, ""));
  const url =
    urls.find((u) => /oauth|authorize|login|device|auth\./i.test(u)) ||
    urls[0] ||
    "";
  const m = clean.match(CODE_RE);
  return { url, code: m ? m[1] : "", text: clean };
}

export const loginArgs = (tool) => (tool === "claude" ? ["auth", "login"] : ["login", "--device-auth"]);

export class LoginFlows {
  constructor({ spawn = nodeSpawn, onEvent = () => {}, timeoutMs = LOGIN_TIMEOUT_MS } = {}) {
    this.flows = new Map();
    this.spawn = spawn;
    this.onEvent = onEvent;
    this.timeoutMs = timeoutMs;
  }

  list() {
    return [...this.flows.values()].map((f) => f.card);
  }

  start({ profile, tool }) {
    assertProfileName(profile);
    assertTool(tool);
    // One sign-in per profile and tool at a time. Two children racing to
    // write the same credentials file is how a profile ends up signed in as
    // whichever finished last.
    for (const f of this.flows.values()) {
      if (f.card.profile === profile && f.card.tool === tool) {
        throw new LoginError(`A ${tool} sign-in for "${profile}" is already in progress. Finish or cancel it first.`);
      }
    }
    ensureProfile(profile);
    const env = profileEnv(profile, { tool });
    // A relayed login must produce an OAuth login, not inherit a pasted token.
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    // Plain output: no colour codes to strip and no prompt that waits on a TTY
    // it will never get.
    env.NO_COLOR = "1";
    env.BROWSER = "echo";

    const id = `l_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
    const child = this.spawn(tool, loginArgs(tool), { env, stdio: ["pipe", "pipe", "pipe"] });
    const card = { id, profile, tool, url: "", code: "", startedAt: Date.now(), expiresAt: Date.now() + this.timeoutMs };
    const flow = { card, child, buf: "", done: false };
    this.flows.set(id, flow);

    const onOut = (chunk) => {
      flow.buf = (flow.buf + String(chunk)).slice(-8000);
      const p = parseLoginOutput(flow.buf);
      const changed = (p.url && p.url !== card.url) || (p.code && p.code !== card.code);
      if (p.url) card.url = p.url;
      if (p.code) card.code = p.code;
      if (changed) this.onEvent({ type: "login.prompt", ...card });
    };
    child.stdout?.on("data", onOut);
    child.stderr?.on("data", onOut);

    flow.timer = setTimeout(() => this.finish(id, { ok: false, error: `No sign-in within ${Math.round(this.timeoutMs / 60000)} minutes, so it was cancelled.` }), this.timeoutMs);

    child.on("error", (e) => this.finish(id, { ok: false, error: `Could not start ${tool}: ${e.message}` }));
    child.on("close", (code) =>
      this.finish(id, code === 0 ? { ok: true } : { ok: false, error: `${tool} exited with code ${code}. ${tail(flow.buf)}`.trim() })
    );

    this.onEvent({ type: "login.started", ...card });
    return card;
  }

  // The code the operator copied from the provider's page. Written with a
  // newline because both CLIs read a line.
  code(id, code) {
    const f = this.get(id);
    const c = String(code ?? "").trim();
    if (!c || /[\r\n]/.test(c) || c.length > 2048) throw new LoginError("Paste the code the sign-in page showed you, on one line.");
    f.child.stdin?.write(`${c}\n`);
    return { id, sent: true };
  }

  cancel(id) {
    this.finish(id, { ok: false, error: "Cancelled." });
    return { id, cancelled: true };
  }

  get(id) {
    const f = this.flows.get(id);
    if (!f) throw new LoginError(`No sign-in ${id} is in progress. It may have finished or timed out.`);
    return f;
  }

  finish(id, result) {
    const f = this.flows.get(id);
    if (!f || f.done) return;
    f.done = true;
    clearTimeout(f.timer);
    this.flows.delete(id);
    if (!result.ok) {
      try {
        f.child.kill("SIGKILL");
      } catch (_) {}
    } else {
      // A relayed sign-in that succeeded is the operator's newest, deliberate
      // choice, so it must be the one that RUNS. A pasted token left behind
      // wins in profileEnv, and the profile kept acting as the old account
      // under a panel that said the switch had worked.
      try {
        dropPastedToken(f.card.profile, f.card.tool);
      } catch (_) {}
    }
    let status = null;
    try {
      status = loginStatus(f.card.profile)[f.card.tool];
    } catch (_) {}
    this.onEvent({ type: "login.done", id, profile: f.card.profile, tool: f.card.tool, ...result, status });
  }
}

// The last line of output, for an error message. Redacted of URLs because a
// sign-in URL carries a state parameter that should not sit in a log.
const tail = (buf) => String(buf || "").replace(ANSI, "").replace(URL_RE, "<url>").trim().split("\n").slice(-2).join(" ").slice(0, 300);
