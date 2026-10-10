// Chat sessions: Claude Code or Codex, turn by turn, from the admin and MCP.
//
// A job is one prompt, one process, one PR. A chat is a CONVERSATION: the owner
// writes, the model answers, tools run under the same approval gate a job
// uses, and the whole thing can be closed and picked up again tomorrow from
// the tool's own session file.
//
//   claude   ONE long-lived child per chat:
//              claude -p --input-format stream-json --output-format stream-json
//                     --verbose --include-partial-messages …
//            Each owner message is a stream-json user message on stdin. If the
//            child dies (an interrupt, a crash) the chat stays open and the
//            next message respawns it with --resume <sessionId> in the SAME
//            cwd — Claude files a session under the slug of its cwd, so a
//            resume from anywhere else does not find it.
//   codex    ONE child per TURN: `codex exec --json …` first, then
//            `codex exec … resume <sessionId>`. Codex has no permission-prompt
//            tool, so — exactly as for jobs — it runs read-only unless the chat
//            is disposable yolo.
//
// Every spawn is array-form, never a shell. The per-chat MCP config (it holds
// the approval bridge's per-chat secret and, when present, the site token)
// lives NEXT TO the workspace, never in it, and is deleted when the chat
// closes.
//
// The pure parts — argv, stdin encoding, history parsing, the state machine —
// are exported and tested without a process (test/chat-check.mjs).
import { spawn as nodeSpawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { profileEnv, profileDir, ensureProfile, paths, assertProfileName } from "./profiles.js";
import { POLICIES, PolicyError, assertYoloAllowed, decide, redact } from "./policy.js";
import { makeParser } from "./stream.js";
import { mcpConfigFor, settingsFor, siteMcpFor, CODEX_SITE_TOKEN_ENV, prepareWorkspace as runnerPrepare } from "./runner.js";
import { summarise } from "./approvals.js";
import { resolveOrg, cleanList, assertPluginName, NameError } from "./names.js";
import { record as recordOp } from "./oplog.js";

export class ChatError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const CHAT_STATES = ["idle", "thinking", "waiting", "closed"];
export const IDLE_MS = Number(process.env.AGENT_CHAT_IDLE_MS || 30 * 60 * 1000);
export const INTERRUPT_GRACE_MS = Number(process.env.AGENT_CHAT_INTERRUPT_GRACE_MS || 3000);
export const MAX_MESSAGE = 100_000;
export const MAX_WAIT_MS = 120_000;
export const DISPLAY = () => process.env.AGENT_DISPLAY || ":1";

const CHAT_ID = /^c_[a-z0-9]+_[0-9a-f]{6}$/;
// Claude session ids are UUIDs; Codex thread ids are UUIDs too. Anything else
// would become part of a path, so the shape is fixed.
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,79}$/;
const GH_REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const HTTPS_REPO = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~\/-]+(\.git)?$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/;

export const newChatId = () => `c_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
export const isChatId = (id) => CHAT_ID.test(String(id || ""));
export const assertChatId = (id) => {
  if (!isChatId(id)) throw new ChatError(`"${String(id).slice(0, 40)}" is not a chat id.`);
  return id;
};
export const assertSessionId = (id) => {
  if (!SESSION_ID.test(String(id || ""))) throw new ChatError(`"${String(id).slice(0, 40)}" is not a session id.`);
  return String(id);
};
export const assertChatTool = (t) => {
  const tool = t || "claude";
  if (tool !== "claude" && tool !== "codex") throw new ChatError(`Unknown tool "${String(tool).slice(0, 20)}". Known: claude, codex.`);
  return tool;
};

// The tools whose every use lands on the review timeline.
const LOGGED_TOOLS = { Bash: "command", Edit: "file", Write: "file", MultiEdit: "file" };

/* ---------------- pure: the state machine ---------------- */

// idle → thinking (a message was sent) → waiting (an approval card is open for
// this chat) → thinking (every card answered) → idle (the turn finished). A
// child that exits leaves the chat idle and resumable. closed is FINAL — a
// late event from a dying child must not reopen a chat in the panel.
export function nextState(state, ev) {
  if (state === "closed") return "closed";
  switch (ev) {
    case "send":
      return state === "idle" ? "thinking" : state;
    case "ask":
      return state === "thinking" || state === "waiting" ? "waiting" : state;
    case "answered":
      return state === "waiting" ? "thinking" : state;
    case "finished":
    case "exit":
      return "idle";
    case "close":
      return "closed";
    default:
      return state;
  }
}

/* ---------------- pure: argv and stdin ---------------- */

// The argv for a chat's long-lived Claude child. `sessionId` is fixed up front
// with --session-id for a new chat (so chat.started can name it before the
// model has said a word) and passed as --resume for an existing one.
export function chatClaudeArgs(chat, { mcpConfigPath = "", settingsPath = "", resume = false } = {}) {
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  if (chat.model) args.push("--model", chat.model);
  if (chat.sessionId) args.push(resume ? "--resume" : "--session-id", chat.sessionId);
  if (chat.policy === "yolo") {
    args.push("--dangerously-skip-permissions");
  } else {
    // The same gate a job has: something else answers prompts, and this is
    // the tool it asks. Without both, the chat would either prompt a
    // terminal nobody watches or proceed unasked.
    args.push("--permission-prompts", "host");
    args.push("--permission-prompt-tool", "mcp__agentd__approve");
    if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);
  }
  if (settingsPath) args.push("--settings", settingsPath);
  args.push("--disallowed-tools", "Bash(sudo *)", "Bash(rm -rf /*)");
  return args;
}

const toml = (s) => JSON.stringify(String(s));

// One Codex turn. The prompt goes last, after "--", so a message that starts
// with a hyphen is a prompt and never a flag. The site token is NAMED
// (bearer_token_env_var), never given, so it stays out of `ps`.
export function chatCodexArgs(chat, { site = null, prompt = "", resume = false } = {}) {
  const args = ["exec", "--json"];
  if (site) {
    args.push("-c", `mcp_servers.site.url=${toml(site.url)}`);
    args.push("-c", `mcp_servers.site.bearer_token_env_var=${toml(CODEX_SITE_TOKEN_ENV)}`);
    args.push("-c", `mcp_servers.site.http_headers={ "x-org-id" = ${toml(site.orgId)} }`);
  }
  if (chat.model) args.push("--model", chat.model);
  if (chat.policy !== "yolo") args.push("--sandbox", "read-only");
  // A chat workspace is a plain directory, not a git repo, and codex exec
  // refuses to run outside one without this.
  args.push("--skip-git-repo-check");
  if (resume) {
    if (!chat.sessionId) throw new ChatError("Codex did not report a session id for this chat, so it cannot be continued. Start a new chat.");
    args.push("resume", chat.sessionId);
  }
  args.push("--", String(prompt));
  return args;
}

// An owner message as Claude's stream-json input expects it, one line.
export function encodeUserMessage(text) {
  return `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: String(text) }] } })}\n`;
}

// Stops the current turn without ending the child (stream.js maps the answer
// to a `control` event, which is not broadcast).
export function encodeInterrupt(requestId = `int_${crypto.randomBytes(4).toString("hex")}`) {
  return `${JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "interrupt" } })}\n`;
}

/* ---------------- pure: validating a start ---------------- */

// Where a chat may run when the owner names a directory: under the work root
// or under a root listed in AGENT_CHAT_CWD_ROOTS — and never inside the agentd
// home outside work/, which holds every profile's credentials.
export function chatCwdRoots() {
  const extra = String(process.env.AGENT_CHAT_CWD_ROOTS || "").split(":").filter(Boolean);
  return [paths.work, ...extra].map((r) => path.resolve(r));
}

const inside = (p, root) => {
  const rel = path.relative(root, p);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
};

export function assertChatCwd(cwd, { roots = chatCwdRoots() } = {}) {
  const raw = String(cwd || "");
  if (!path.isAbsolute(raw)) throw new ChatError("A chat's working directory must be an absolute path.");
  const p = path.resolve(raw);
  if (inside(p, path.resolve(paths.root)) && !inside(p, path.resolve(paths.work))) {
    throw new ChatError("That directory is inside agentd's own home, which holds every profile's credentials. Pick a directory under the work root.");
  }
  if (!roots.some((r) => inside(p, r))) {
    throw new ChatError(`A chat may only run under ${roots.join(", ")}. Add a root to AGENT_CHAT_CWD_ROOTS to allow another.`);
  }
  return p;
}

// Everything that could refuse a chat refuses here, before a directory or a
// process exists.
export function normaliseChatSpec(spec = {}) {
  const tool = assertChatTool(spec.tool);
  const profile = assertProfileName(spec.profile || process.env.AGENT_DEFAULT_PROFILE || "personal");
  const policy = spec.policy || "allowlist";
  if (!POLICIES.includes(policy)) throw new ChatError(`Unknown policy "${String(policy).slice(0, 20)}". Known: ${POLICIES.join(", ")}.`);
  try {
    assertYoloAllowed({ policy, disposable: spec.disposable === true });
  } catch (e) {
    throw new ChatError(e.message);
  }
  const model = spec.model ? String(spec.model) : "";
  if (model && !MODEL.test(model)) throw new ChatError(`"${model.slice(0, 40)}" is not a model name.`);
  let orgId, plugins;
  try {
    orgId = resolveOrg(spec.orgId);
    plugins = cleanList(spec.plugins, assertPluginName, { label: "plugin" });
  } catch (e) {
    if (e instanceof NameError) throw new ChatError(e.message);
    throw e;
  }
  const repo = spec.repo ? String(spec.repo) : "";
  if (repo && !GH_REPO.test(repo) && !HTTPS_REPO.test(repo)) throw new ChatError(`"${repo.slice(0, 80)}" is not a repository. Use owner/name or an https git URL.`);
  if (repo && spec.cwd) throw new ChatError("Give a chat a repository OR a working directory, not both.");
  const base = spec.base ? String(spec.base) : "main";
  if (!BRANCH.test(base)) throw new ChatError(`"${base.slice(0, 40)}" is not a branch name.`);
  const cwd = spec.cwd ? assertChatCwd(spec.cwd) : "";
  const prompt = spec.prompt == null ? "" : String(spec.prompt);
  if (prompt.length > MAX_MESSAGE) throw new ChatError(`A message is capped at ${MAX_MESSAGE} characters.`);
  const sessionId = spec.sessionId ? assertSessionId(spec.sessionId) : "";
  return { tool, profile, policy, disposable: spec.disposable === true, model, orgId, plugins, repo, base, cwd, prompt, sessionId };
}

/* ---------------- pure: history ---------------- */

const TURN_TEXT = 4000;
const clipText = (s, n = TURN_TEXT) => {
  const t = redact(String(s ?? ""));
  return t.length > n ? `${t.slice(0, n)}…[${t.length - n} more characters]` : t;
};

const parseJsonl = (text) =>
  String(text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);

const toolLine = (name, input = {}) => summarise({ tool: name, input: input || {} }).slice(0, 300);

// Injected context a tool writes as a "user" message (a slash-command echo,
// Codex's environment block) is not something the owner said.
const isInjected = (t) => /^\s*<(command-|local-command|environment_context|user_instructions|system-reminder)/.test(t);

// A Claude Code session file → displayable turns. `cap` keeps the newest.
export function parseClaudeSession(text, { cap = 200 } = {}) {
  const turns = [];
  let title = "";
  let cwd = "";
  let sessionId = "";
  let updatedAt = 0;
  for (const row of parseJsonl(text)) {
    if (row.sessionId && !sessionId) sessionId = row.sessionId;
    if (row.cwd && !cwd) cwd = row.cwd;
    const at = row.timestamp ? Date.parse(row.timestamp) || 0 : 0;
    if (at > updatedAt) updatedAt = at;
    if (row.isMeta) continue;
    if (row.type === "user" && row.message) {
      const c = row.message.content;
      if (typeof c === "string") {
        if (isInjected(c)) continue;
        if (!title) title = c.trim().slice(0, 120);
        turns.push({ role: "user", text: clipText(c), tools: [], at });
      } else if (Array.isArray(c)) {
        const texts = c.filter((b) => b.type === "text" && b.text && !isInjected(b.text)).map((b) => b.text);
        // tool results come back as user messages; they mark the matching
        // tool ok/failed on the previous assistant turn rather than being turns
        for (const b of c.filter((x) => x.type === "tool_result")) {
          for (let i = turns.length - 1; i >= 0; i--) {
            const t = turns[i].tools.find((x) => x.id === b.tool_use_id);
            if (t) {
              t.ok = !b.is_error;
              break;
            }
          }
        }
        if (texts.length) {
          const joined = texts.join("\n");
          if (!title) title = joined.trim().slice(0, 120);
          turns.push({ role: "user", text: clipText(joined), tools: [], at });
        }
      }
    } else if (row.type === "assistant" && row.message) {
      const content = Array.isArray(row.message.content) ? row.message.content : [];
      const text = content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n");
      const tools = content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id || "", name: b.name || "?", summary: clipText(toolLine(b.name, b.input), 300), ok: null }));
      // Claude writes one assistant row per content block; consecutive rows
      // of the same message are one turn on screen.
      const last = turns[turns.length - 1];
      if (last && last.role === "assistant" && last.messageId && last.messageId === row.message.id) {
        if (text) last.text = clipText(last.text ? `${last.text}\n${text}` : text);
        last.tools.push(...tools);
      } else if (text || tools.length) {
        turns.push({ role: "assistant", text: clipText(text), tools, at, messageId: row.message.id || "" });
      }
    }
  }
  const messageCount = turns.length;
  const shown = turns.slice(-cap).map(({ messageId, ...t }) => t);
  return { sessionId, title: redact(title), cwd, updatedAt, messageCount, truncated: turns.length > cap, turns: shown };
}

// A Codex rollout file → displayable turns. Two generations exist: rows of
// {type:"session_meta"|"response_item"|"event_msg", payload} (current) and a
// bare first line {id, timestamp} followed by bare items (older).
export function parseCodexSession(text, { cap = 200 } = {}) {
  const turns = [];
  let title = "";
  let cwd = "";
  let sessionId = "";
  let updatedAt = 0;
  for (const row of parseJsonl(text)) {
    const at = row.timestamp ? Date.parse(row.timestamp) || 0 : 0;
    if (at > updatedAt) updatedAt = at;
    let item = row;
    if (row.type === "session_meta" && row.payload) {
      sessionId = sessionId || row.payload.id || "";
      cwd = cwd || row.payload.cwd || "";
      continue;
    }
    if (row.type === "response_item" && row.payload) item = row.payload;
    else if (row.type === "event_msg" || row.type === "turn_context" || row.type === "compacted") continue;
    else if (!row.type && row.id) {
      sessionId = sessionId || row.id;
      continue;
    }
    if (item.type === "message") {
      const text = (Array.isArray(item.content) ? item.content : [])
        .filter((b) => (b.type === "input_text" || b.type === "output_text" || b.type === "text") && b.text)
        .map((b) => b.text)
        .join("\n");
      if (!text || isInjected(text)) continue;
      if (item.role === "user") {
        if (!title) title = text.trim().slice(0, 120);
        turns.push({ role: "user", text: clipText(text), tools: [], at });
      } else if (item.role === "assistant") {
        const last = turns[turns.length - 1];
        if (last && last.role === "assistant" && !last.text) last.text = clipText(text);
        else turns.push({ role: "assistant", text: clipText(text), tools: [], at });
      }
    } else if (item.type === "function_call" || item.type === "local_shell_call" || item.type === "custom_tool_call") {
      let input = {};
      try {
        input = typeof item.arguments === "string" ? JSON.parse(item.arguments) : item.arguments || item.action || {};
      } catch (_) {}
      const command = Array.isArray(input.command) ? input.command.join(" ") : input.command;
      const name = item.name === "shell" || item.type === "local_shell_call" || command ? "Bash" : item.name || "tool";
      const tool = { id: item.call_id || item.id || "", name, summary: clipText(toolLine(name, command ? { command } : input), 300), ok: null };
      const last = turns[turns.length - 1];
      if (last && last.role === "assistant") last.tools.push(tool);
      else turns.push({ role: "assistant", text: "", tools: [tool], at });
    } else if (item.type === "function_call_output" || item.type === "custom_tool_call_output") {
      for (let i = turns.length - 1; i >= 0; i--) {
        const t = turns[i].tools.find((x) => x.id === item.call_id);
        if (t) {
          let ok = true;
          try {
            const out = typeof item.output === "string" ? JSON.parse(item.output) : item.output;
            const code = out?.metadata?.exit_code;
            if (code != null) ok = code === 0;
          } catch (_) {}
          t.ok = ok;
          break;
        }
      }
    }
  }
  const messageCount = turns.length;
  return { sessionId, title: redact(title), cwd, updatedAt, messageCount, truncated: turns.length > cap, turns: turns.slice(-cap) };
}

/* ---------------- history on disk ---------------- */

const HEAD_BYTES = 1024 * 1024;
const FULL_BYTES = 8 * 1024 * 1024;

function readCapped(file, max) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const n = Math.min(size, max);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, 0);
    return { text: buf.toString("utf8"), whole: n === size };
  } finally {
    fs.closeSync(fd);
  }
}

export const claudeProjectsDir = (profile) => path.join(profileDir(profile), "claude", "projects");
export const codexSessionsDir = (profile) => path.join(profileDir(profile), "codex", "sessions");

// Bounded walk: a sessions tree is year/month/day, and nothing here needs to
// read more than a few hundred files to answer "what did I talk about".
function walkJsonl(dir, { maxDepth = 5, maxFiles = 500 } = {}) {
  const out = [];
  const stack = [[dir, 0]];
  while (stack.length && out.length < maxFiles) {
    const [d, depth] = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < maxDepth) stack.push([p, depth + 1]);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

function summaryFor(file, tool, profile) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (_) {
    return null;
  }
  let parsed;
  let whole = true;
  try {
    const r = readCapped(file, stat.size <= FULL_BYTES ? FULL_BYTES : HEAD_BYTES);
    whole = r.whole;
    parsed = tool === "claude" ? parseClaudeSession(r.text, { cap: 1 }) : parseCodexSession(r.text, { cap: 1 });
  } catch (_) {
    return null;
  }
  const fromName = tool === "claude" ? path.basename(file, ".jsonl") : (path.basename(file, ".jsonl").match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i) || [])[1];
  const sessionId = parsed.sessionId || fromName || "";
  if (!SESSION_ID.test(sessionId)) return null;
  return {
    profile,
    tool,
    sessionId,
    title: redact(parsed.title || "(untitled)"),
    cwd: parsed.cwd,
    updatedAt: parsed.updatedAt || stat.mtimeMs,
    // A file too large to read whole has an unknown count, not a wrong one.
    messageCount: whole ? parsed.messageCount : null,
  };
}

export function listSessions({ profile, tool } = {}) {
  const prof = assertProfileName(profile);
  const tools = tool ? [assertChatTool(tool)] : ["claude", "codex"];
  const out = [];
  for (const t of tools) {
    const files = t === "claude" ? walkJsonl(claudeProjectsDir(prof), { maxDepth: 1 }) : walkJsonl(codexSessionsDir(prof));
    for (const f of files) {
      // Claude's sub-agent sidechains sit beside the session as agent-*.jsonl.
      if (t === "claude" && /^agent-/.test(path.basename(f))) continue;
      const s = summaryFor(f, t, prof);
      if (s) out.push(s);
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function findSessionFile({ profile, tool, sessionId }) {
  const prof = assertProfileName(profile);
  const t = assertChatTool(tool);
  const id = assertSessionId(sessionId);
  if (t === "claude") {
    return walkJsonl(claudeProjectsDir(prof), { maxDepth: 1 }).find((f) => path.basename(f) === `${id}.jsonl`) || "";
  }
  return walkJsonl(codexSessionsDir(prof)).find((f) => path.basename(f, ".jsonl").endsWith(id)) || "";
}

export function readSession({ profile, tool, sessionId, cap = 200 }) {
  const file = findSessionFile({ profile, tool, sessionId });
  if (!file) throw new ChatError(`No ${tool} session ${sessionId} for profile "${profile}".`, 404);
  const { text, whole } = readCapped(file, FULL_BYTES);
  const parsed = tool === "codex" ? parseCodexSession(text, { cap }) : parseClaudeSession(text, { cap });
  return { profile, tool, ...parsed, sessionId: parsed.sessionId || sessionId, title: redact(parsed.title || "(untitled)"), partial: !whole };
}

/* ---------------- the registry ---------------- */

const bridgePath = () =>
  path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "mcp-approve.js");

export const chatsRoot = () => path.join(paths.work, "chats");
export const chatWorkspace = (id) => path.join(chatsRoot(), assertChatId(id));
export const chatConfigDir = (id) => path.join(chatsRoot(), `${assertChatId(id)}.agentd`);

const LIMITS = () => ({
  perProfile: Number(process.env.AGENT_MAX_PER_PROFILE || 2),
  global: Number(process.env.AGENT_MAX_CONCURRENT || 4),
});

export class ChatRegistry {
  constructor({
    spawn = nodeSpawn,
    approvals = null,
    limits = LIMITS(),
    jobsLive = () => ({ total: 0, byProfile: () => 0 }),
    isHalted = () => false,
    onEvent = () => {},
    onState = () => {},
    onOp = recordOp,
    idleMs = IDLE_MS,
    interruptGraceMs = INTERRUPT_GRACE_MS,
    now = () => Date.now(),
    approveUrl = "http://127.0.0.1:7777/internal/approve",
    site = (chat) => siteMcpFor(chat),
    prepareWorkspace = runnerPrepare,
    sessionId = () => crypto.randomUUID(),
  } = {}) {
    Object.assign(this, { spawn, approvals, limits, jobsLive, isHalted, onEvent, onState, onOp, idleMs, interruptGraceMs, now, approveUrl, site, prepareWorkspace, newSessionId: sessionId });
    this.chats = new Map();
  }

  /* ---- bookkeeping ---- */

  get(id) {
    const c = this.chats.get(assertChatId(id));
    if (!c) throw new ChatError(`No chat ${id}.`, 404);
    return c;
  }

  live() {
    return [...this.chats.values()].filter((c) => c.state !== "closed");
  }

  // What a chat costs the limits. An open chat counts whether or not it is
  // mid-turn: its Claude child is alive, and idle close is what frees it.
  liveCounts() {
    const live = this.live();
    return { total: live.length, byProfile: (p) => live.filter((c) => c.profile === p).length };
  }

  publicChat(c) {
    return {
      chatId: c.id,
      profile: c.profile,
      tool: c.tool,
      model: c.model,
      policy: c.policy,
      orgId: c.orgId,
      repo: c.repo,
      cwd: c.cwd,
      state: c.state,
      sessionId: c.sessionId,
      createdAt: c.createdAt,
      lastActivityAt: c.lastActivityAt,
      turns: c.turnCount,
      closedReason: c.closedReason || "",
      pendingApprovals: this.approvals ? this.approvals.list(c.id).length : 0,
    };
  }

  list() {
    return [...this.chats.values()].sort((a, b) => b.createdAt - a.createdAt).map((c) => this.publicChat(c));
  }

  admit(spec) {
    if (this.isHalted()) throw new ChatError("The agent is halted; no chat can start until it is resumed.");
    const jobs = this.jobsLive() || { total: 0, byProfile: () => 0 };
    const mine = this.liveCounts();
    if (jobs.total + mine.total >= this.limits.global) {
      throw new ChatError(`${this.limits.global} jobs and chats are already open, which is this server's limit (AGENT_MAX_CONCURRENT). Close a chat or wait for a job.`);
    }
    if (jobs.byProfile(spec.profile) + mine.byProfile(spec.profile) >= this.limits.perProfile) {
      throw new ChatError(`Profile "${spec.profile}" already has ${this.limits.perProfile} jobs or chats open (AGENT_MAX_PER_PROFILE).`);
    }
  }

  setState(c, ev) {
    const before = c.state;
    c.state = nextState(c.state, ev);
    if (c.state !== before) this.onState(c.id, c.state, c.sessionId);
    return c.state;
  }

  emit(c, event) {
    c.lastActivityAt = this.now();
    this.onEvent(c.id, event);
  }

  /* ---- starting ---- */

  async start(rawSpec = {}) {
    const spec = normaliseChatSpec(rawSpec);
    this.admit(spec);
    // Two children on one session file would interleave writes into it.
    if (spec.sessionId) {
      const existing = this.live().find((c) => c.sessionId === spec.sessionId && c.profile === spec.profile && c.tool === spec.tool);
      if (existing) return { chatId: existing.id, sessionId: existing.sessionId, reused: true, chat: this.publicChat(existing) };
    }
    ensureProfile(spec.profile);
    const id = newChatId();
    const c = {
      id,
      ...spec,
      resumed: !!spec.sessionId,
      sessionId: spec.sessionId || (spec.tool === "claude" ? this.newSessionId() : ""),
      state: "idle",
      createdAt: this.now(),
      lastActivityAt: this.now(),
      turnCount: 0,
      child: null,
      turnChild: null,
      token: crypto.randomBytes(24).toString("base64url"),
      turn: null,
      waiters: [],
      configDir: "",
      closedReason: "",
    };
    this.chats.set(id, c);
    try {
      if (spec.repo) {
        const ws = await this.prepareWorkspace({ id: path.join("chats", id), repo: GH_REPO.test(spec.repo) ? spec.repo : "", repoUrl: HTTPS_REPO.test(spec.repo) ? spec.repo : "", base: spec.base, branch: `chat/${id}` });
        c.cwd = ws.dir;
      } else if (!c.cwd) {
        c.cwd = chatWorkspace(id);
      }
      fs.mkdirSync(c.cwd, { recursive: true, mode: 0o700 });
      if (c.tool === "claude") this.spawnClaude(c);
    } catch (e) {
      this.close(id, { reason: `Could not start: ${e.message}` });
      throw e instanceof ChatError ? e : new ChatError(e.message);
    }
    this.onState(c.id, c.state, c.sessionId);
    if (spec.prompt) this.send(id, spec.prompt);
    return { chatId: id, sessionId: c.sessionId, chat: this.publicChat(c) };
  }

  // A past session, opened as a live chat. The cwd comes from the session
  // file, because Claude only finds a session under the slug of its cwd.
  async resume({ profile, tool, sessionId, prompt, ...rest } = {}) {
    const t = assertChatTool(tool);
    const prof = assertProfileName(profile || process.env.AGENT_DEFAULT_PROFILE || "personal");
    const sid = assertSessionId(sessionId);
    const live = this.live().find((c) => c.sessionId === sid && c.profile === prof && c.tool === t);
    if (live) {
      if (prompt) this.send(live.id, prompt);
      return { chatId: live.id, sessionId: sid, reused: true, chat: this.publicChat(live) };
    }
    const s = readSession({ profile: prof, tool: t, sessionId: sid, cap: 1 });
    let cwd = "";
    if (s.cwd) {
      try {
        cwd = assertChatCwd(s.cwd);
      } catch (_) {
        cwd = "";
      }
      if (cwd && !fs.existsSync(cwd)) cwd = "";
    }
    if (!cwd && t === "claude") {
      throw new ChatError(`Session ${sid} ran in ${s.cwd || "an unknown directory"}, which is gone or outside the allowed roots; Claude can only resume it from there.`);
    }
    return this.start({ ...rest, profile: prof, tool: t, sessionId: sid, prompt, cwd: cwd || undefined });
  }

  writeConfig(c) {
    const dir = chatConfigDir(c.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    c.configDir = dir;
    const mcpConfigPath = path.join(dir, "mcp.json");
    const site = this.site(c);
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfigFor({ bridge: bridgePath(), approveUrl: this.approveUrl, jobId: c.id, jobToken: c.token, site }), null, 2), { mode: 0o600 });
    const settings = settingsFor(c);
    let settingsPath = "";
    if (settings) {
      settingsPath = path.join(dir, "settings.json");
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
    }
    return { mcpConfigPath, settingsPath };
  }

  envFor(c) {
    const env = { ...profileEnv(c.profile, { tool: c.tool }), DISPLAY: DISPLAY() };
    return env;
  }

  spawnClaude(c, { resume = c.resumed } = {}) {
    const { mcpConfigPath, settingsPath } = c.policy === "yolo" ? { mcpConfigPath: "", settingsPath: "" } : this.writeConfig(c);
    const args = chatClaudeArgs(c, { mcpConfigPath, settingsPath, resume });
    const child = this.spawn("claude", args, { cwd: c.cwd, env: this.envFor(c), stdio: ["pipe", "pipe", "pipe"] });
    c.child = child;
    // Once a child has run under --session-id, every later spawn resumes it.
    c.resumed = true;
    child.stdin?.on?.("error", () => {});
    const parser = makeParser("claude");
    child.stdout.on("data", (chunk) => {
      for (const e of parser.push(chunk)) this.handle(c, e);
    });
    child.stderr?.on?.("data", (chunk) => this.emit(c, { type: "stderr", at: this.now(), text: redact(String(chunk)).slice(0, 4000) }));
    child.on("error", (e) => this.emit(c, { type: "stderr", at: this.now(), text: `Could not start claude: ${e.message}` }));
    child.on("close", (code) => {
      for (const e of parser.flush()) this.handle(c, e);
      if (c.child !== child) return;
      c.child = null;
      if (c.state === "closed") return;
      this.emit(c, { type: "exited", at: this.now(), code });
      // The session file survives; the next message resumes it.
      this.endTurn(c, { ok: false, error: code === 0 ? "" : `claude exited with code ${code}.` });
    });
    return child;
  }

  /* ---- a turn ---- */

  send(id, text) {
    const c = this.get(id);
    const msg = String(text ?? "");
    if (!msg.trim()) throw new ChatError("A message needs some text.");
    if (msg.length > MAX_MESSAGE) throw new ChatError(`A message is capped at ${MAX_MESSAGE} characters.`);
    if (c.state === "closed") throw new ChatError(`Chat ${id} is closed. Resume its session to continue.`, 409);
    if (c.state !== "idle") throw new ChatError(`Chat ${id} is ${c.state}. Wait for the turn to finish, or interrupt it.`, 409);
    c.turn = { text: "", result: "", tools: [], startedAt: this.now(), ok: null, error: "" };
    c.turnCount++;
    this.setState(c, "send");
    this.emit(c, { type: "user", at: this.now(), text: clipText(msg, 8000) });
    if (c.tool === "claude") {
      if (!c.child) this.spawnClaude(c, { resume: true });
      c.child.stdin.write(encodeUserMessage(msg));
    } else {
      this.runCodexTurn(c, msg);
    }
    return this.publicChat(c);
  }

  runCodexTurn(c, prompt) {
    const site = this.site(c);
    const env = this.envFor(c);
    if (site) env[CODEX_SITE_TOKEN_ENV] = site.token;
    const resume = !!c.sessionId;
    const args = chatCodexArgs(c, { site, prompt, resume });
    const child = this.spawn("codex", args, { cwd: c.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    c.turnChild = child;
    const parser = makeParser("codex-json");
    child.stdout.on("data", (chunk) => {
      for (const e of parser.push(chunk)) this.handle(c, e, { codex: true });
    });
    child.stderr?.on?.("data", (chunk) => this.emit(c, { type: "stderr", at: this.now(), text: redact(String(chunk)).slice(0, 4000) }));
    child.on("error", (e) => this.emit(c, { type: "stderr", at: this.now(), text: `Could not start codex: ${e.message}` }));
    child.on("close", (code) => {
      for (const e of parser.flush()) this.handle(c, e, { codex: true });
      if (c.turnChild === child) c.turnChild = null;
      if (c.state === "closed") return;
      // A Codex turn is over when its process is, whatever it printed.
      this.endTurn(c, { ok: c.turn?.ok ?? code === 0, error: code === 0 ? c.turn?.error || "" : `codex exited with code ${code}.` });
    });
  }

  // One normalised stream event.
  handle(c, e, { codex = false } = {}) {
    if (!e) return;
    if (e.type === "control") return; // the answer to an interrupt; not transcript
    if (e.type === "started" && e.sessionId) {
      if (c.sessionId !== e.sessionId) {
        c.sessionId = e.sessionId;
        this.onState(c.id, c.state, c.sessionId);
      }
    }
    const t = c.turn;
    if (t) {
      if (e.type === "text") t.text = t.text ? `${t.text}\n\n${e.text}` : e.text;
      if (e.type === "tool") {
        t.tools.push({ id: e.id || "", name: e.tool || "?", summary: toolLine(e.tool, e.input), ok: null });
      }
      if (e.type === "result") {
        const tool = t.tools.find((x) => x.id && x.id === e.id);
        if (tool) tool.ok = !e.isError;
      }
      if (e.type === "error") t.error = e.text || t.error;
    }
    if (e.type === "tool" && LOGGED_TOOLS[e.tool]) {
      try {
        this.onOp({ actor: `chat:${c.id}`, kind: LOGGED_TOOLS[e.tool], summary: toolLine(e.tool, e.input), detail: { tool: e.tool, input: e.input, tool_use_id: e.id || "", sessionId: c.sessionId } });
      } catch (_) {}
    }
    this.emit(c, e);
    if (e.type === "finished") {
      if (t) {
        t.result = e.text || "";
        t.ok = e.ok;
      }
      if (e.sessionId && c.sessionId !== e.sessionId) c.sessionId = e.sessionId;
      // Claude's turn ends at `result`; Codex's when its process exits.
      if (!codex) this.endTurn(c, { ok: e.ok });
    }
  }

  snapshot(c) {
    const t = c.turn || { text: "", result: "", tools: [] };
    return {
      state: c.state,
      text: redact(t.text || t.result || ""),
      tools: t.tools.map(({ name, summary, ok }) => ({ name, summary: redact(summary), ok })),
      sessionId: c.sessionId,
      ...(t.error ? { error: redact(t.error) } : {}),
    };
  }

  endTurn(c, { ok = true, error = "" } = {}) {
    clearTimeout(c.interruptTimer);
    c.interruptTimer = null;
    if (c.turn) {
      if (c.turn.ok == null) c.turn.ok = ok;
      if (error && !c.turn.error) c.turn.error = error;
    }
    if (c.state !== "closed") this.setState(c, "finished");
    c.lastActivityAt = this.now();
    const snap = this.snapshot(c);
    const waiters = c.waiters;
    c.waiters = [];
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve(snap);
    }
  }

  // Resolves when the current turn ends, or with the turn so far when
  // `waitMs` passes first — the shape send_chat_message returns.
  waitTurn(id, waitMs = 60_000) {
    const c = this.get(id);
    if (c.state === "idle" || c.state === "closed") return Promise.resolve(this.snapshot(c));
    const ms = Math.max(0, Math.min(MAX_WAIT_MS, Number(waitMs) || 0));
    return new Promise((resolve) => {
      const w = { resolve, timer: null };
      w.timer = setTimeout(() => {
        c.waiters = c.waiters.filter((x) => x !== w);
        resolve(this.snapshot(c));
      }, ms);
      c.waiters.push(w);
    });
  }

  async sendAndWait(id, text, waitMs) {
    this.send(id, text);
    return this.waitTurn(id, waitMs);
  }

  /* ---- controls ---- */

  // Stops the current turn and keeps the session. Claude is asked first over
  // its control channel (the child survives); if the turn is still running
  // after the grace period it gets SIGINT, and the next message resumes.
  interrupt(id) {
    const c = this.get(id);
    if (c.state !== "thinking" && c.state !== "waiting") return { ...this.publicChat(c), interrupted: false };
    if (this.approvals) {
      for (const card of this.approvals.list(c.id)) {
        try {
          this.approvals.answer(card.id, { allow: false, reason: "The owner interrupted the turn." });
        } catch (_) {}
      }
    }
    if (c.tool === "claude" && c.child) {
      try {
        c.child.stdin.write(encodeInterrupt());
      } catch (_) {}
      const child = c.child;
      clearTimeout(c.interruptTimer);
      c.interruptTimer = setTimeout(() => {
        if (c.child === child && (c.state === "thinking" || c.state === "waiting")) {
          try {
            child.kill("SIGINT");
          } catch (_) {}
        }
      }, this.interruptGraceMs);
      c.interruptTimer.unref?.();
    } else if (c.turnChild) {
      try {
        c.turnChild.kill("SIGINT");
      } catch (_) {}
    }
    this.emit(c, { type: "interrupted", at: this.now() });
    return { ...this.publicChat(c), interrupted: true };
  }

  close(id, { reason = "Closed by the owner." } = {}) {
    const c = this.get(id);
    if (c.state === "closed") return this.publicChat(c);
    c.closedReason = reason;
    this.setState(c, "close");
    clearTimeout(c.interruptTimer);
    if (this.approvals) this.approvals.forget(c.id);
    for (const child of [c.child, c.turnChild].filter(Boolean)) {
      try {
        child.stdin?.end?.();
      } catch (_) {}
      try {
        child.kill("SIGTERM");
      } catch (_) {}
      const t = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch (_) {}
      }, 5000);
      t.unref?.();
    }
    c.child = null;
    c.turnChild = null;
    // The config holds the bridge secret and maybe the site token; the
    // workspace stays, because a resume needs the same cwd.
    try {
      if (c.configDir) fs.rmSync(c.configDir, { recursive: true, force: true });
    } catch (_) {}
    c.token = "";
    this.emit(c, { type: "closed", at: this.now(), text: reason });
    const snap = this.snapshot(c);
    for (const w of c.waiters) {
      clearTimeout(w.timer);
      w.resolve(snap);
    }
    c.waiters = [];
    return this.publicChat(c);
  }

  // Idle chats are closed but stay resumable from their session file.
  checkIdle() {
    const closed = [];
    const now = this.now();
    for (const c of this.live()) {
      if (c.state === "idle" && now - c.lastActivityAt >= this.idleMs) {
        this.close(c.id, { reason: `Idle for ${Math.round(this.idleMs / 60000)} minutes; resume the session to continue.` });
        closed.push(c.id);
      }
    }
    return closed;
  }

  // Forgets closed chats older than a day so a long-running daemon stays bounded.
  prune({ keepMs = 24 * 3600 * 1000 } = {}) {
    for (const c of [...this.chats.values()]) {
      if (c.state === "closed" && this.now() - c.lastActivityAt > keepMs) this.chats.delete(c.id);
    }
  }

  /* ---- the approval bridge ---- */

  // Called by server.js for a POST /internal/approve whose jobId is a chat id.
  // Returns { status, body }. Same rules as for a job: per-chat secret,
  // timing-safe; policy first; deny by default.
  async approve(payload = {}, bearer = "") {
    const c = isChatId(payload.jobId) ? this.chats.get(payload.jobId) : null;
    const expected = c?.token || "";
    const ok = expected && bearer.length === expected.length && crypto.timingSafeEqual(Buffer.from(bearer), Buffer.from(expected));
    if (!ok) return { status: 403, body: { allow: false, reason: "That chat cannot answer approvals." } };
    if (c.state === "closed") return { status: 200, body: { allow: false, reason: "The chat is closed." } };
    const auto = decide({ policy: c.policy, tool: payload.tool, input: payload.input, workspace: c.cwd });
    if (auto.allow) return { status: 200, body: { allow: true, reason: auto.reason } };
    if (!this.approvals) return { status: 200, body: { allow: false, reason: "Nobody is wired to answer approvals." } };
    this.setState(c, "ask");
    const answer = await this.approvals.ask(c.id, { ...payload, policyReason: auto.reason });
    if (c.state === "waiting" && this.approvals.list(c.id).length === 0) this.setState(c, "answered");
    return { status: 200, body: answer };
  }

  /* ---- history ---- */

  history({ profiles = [], tool } = {}) {
    const out = [];
    for (const p of profiles) {
      try {
        out.push(...listSessions({ profile: p, tool }));
      } catch (_) {}
    }
    const live = new Map(this.live().map((c) => [`${c.profile}:${c.tool}:${c.sessionId}`, c.id]));
    return out
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 200)
      .map((s) => ({ ...s, liveChatId: live.get(`${s.profile}:${s.tool}:${s.sessionId}`) || "" }));
  }
}

export { PolicyError };
