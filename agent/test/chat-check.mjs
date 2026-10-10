// Chat sessions, checked without a real claude or codex.
//
// Every process here is a fake child: what chat.js WRITES to it (argv, env,
// stdin lines) and what it does with what the child PRINTS are the contract,
// and both are formats that are not ours — so they are pinned here.
//
//   node test/chat-check.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";

process.env.AGENT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "agentd-chat-"));
delete process.env.AGENT_MCP_TOKEN;
delete process.env.AGENT_CHAT_CWD_ROOTS;

const chat = await import("../src/chat.js");
const profiles = await import("../src/profiles.js");
const { Approvals } = await import("../src/approvals.js");
const sessions = await import("../src/sessions.js");
const api = await import("../src/api.js");
const oplog = await import("../src/oplog.js");

let pass = 0;
const fails = [];
const check = (ok, name, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  OK  ${name}`);
  } else {
    fails.push(`${name}${detail ? ` - ${detail}` : ""}`);
    console.log(`  XX  ${name}${detail ? ` - ${detail}` : ""}`);
  }
};
const throws = async (fn, name, re) => {
  try {
    await fn();
    check(false, name, "it did not throw");
  } catch (e) {
    check(re.test(e.message), name, e.message.slice(0, 140));
  }
};
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const after = (args, flag) => args[args.indexOf(flag) + 1];

/* ---------------- fakes ---------------- */

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.writes = [];
  c.kills = [];
  c.stdin = { write: (s) => c.writes.push(String(s)), end: () => (c.ended = true), on: () => {} };
  c.kill = (sig) => c.kills.push(sig);
  c.say = (...objs) => c.stdout.emit("data", objs.map((o) => (typeof o === "string" ? o : JSON.stringify(o))).join("\n") + "\n");
  c.exit = (code = 0) => c.emit("close", code);
  return c;
}
function fakeSpawner() {
  const calls = [];
  return {
    calls,
    spawn: (cmd, args, opts) => {
      const child = fakeChild();
      calls.push({ cmd, args, opts, child });
      return child;
    },
  };
}

const SID = "11111111-2222-3333-4444-555555555555";
function makeRegistry(over = {}) {
  const fx = fakeSpawner();
  const events = [];
  const states = [];
  const ops = [];
  let now = 1_000_000;
  const approvals = new Approvals({ timeoutMs: 5000 });
  const reg = new chat.ChatRegistry({
    spawn: fx.spawn,
    approvals,
    onEvent: (id, e) => events.push({ id, e }),
    onState: (id, state, sessionId) => states.push({ id, state, sessionId }),
    onOp: (op) => ops.push(op),
    now: () => now,
    sessionId: () => SID,
    interruptGraceMs: 20,
    limits: { global: 4, perProfile: 2 },
    prepareWorkspace: async (job) => {
      const dir = path.join(profiles.paths.work, job.id);
      fs.mkdirSync(dir, { recursive: true });
      return { dir, branch: job.branch };
    },
    ...over,
  });
  return { reg, fx, events, states, ops, approvals, advance: (ms) => (now += ms) };
}

/* ---------------- ids ---------------- */

console.log("\nids");
{
  const id = chat.newChatId();
  check(chat.isChatId(id), "a new chat id has the chat shape");
  check(!chat.isChatId("j_abc_123456") && !chat.isChatId("../x"), "a job id or a path is not a chat id");
  await throws(() => chat.assertChatId("c_../../etc"), "assertChatId refuses a crafted id", /not a chat id/);
  await throws(() => chat.assertSessionId("../../.ssh/id"), "a session id that climbs is refused", /not a session id/);
  check(chat.assertSessionId(SID) === SID, "a UUID session id is accepted");
  const rec = oplog.approvalRecorder({ record: (e) => e });
  rec({ type: "approval.asked", card: { id: "a_1", tool: "Write", summary: "Create x" } });
  const entry = rec({ type: "approval.answered", id: "a_1", jobId: id, allow: true });
  check(entry.actor === `chat:${id}`, "the review timeline attributes a chat approval to chat:<id>");
}

/* ---------------- argv ---------------- */

console.log("\nclaude argv");
{
  const base = { policy: "allowlist", model: "", sessionId: SID };
  const a = chat.chatClaudeArgs(base, { mcpConfigPath: "/cfg/mcp.json" });
  check(a[0] === "-p", "print mode");
  check(after(a, "--input-format") === "stream-json", "stdin is stream-json");
  check(after(a, "--output-format") === "stream-json", "stdout is stream-json");
  check(a.includes("--verbose") && a.includes("--include-partial-messages"), "verbose with partial messages");
  check(after(a, "--session-id") === SID && !a.includes("--resume"), "a new chat fixes its session id up front");
  check(after(a, "--permission-prompt-tool") === "mcp__agentd__approve", "the approval bridge answers prompts");
  check(after(a, "--permission-prompts") === "host", "and prompts are hosted, as for jobs");
  check(after(a, "--mcp-config") === "/cfg/mcp.json", "the per-chat MCP config is passed");
  check(!a.includes("--dangerously-skip-permissions"), "no skip-permissions on an allowlist chat");
  check(a.includes("Bash(sudo *)"), "sudo is denied outright");
  check(!a.some((x) => /hello/.test(x)), "no prompt in argv: messages go to stdin");
  const r = chat.chatClaudeArgs({ ...base, model: "opus" }, { mcpConfigPath: "/m", settingsPath: "/s", resume: true });
  check(after(r, "--resume") === SID && !r.includes("--session-id"), "a resumed chat uses --resume");
  check(after(r, "--model") === "opus" && after(r, "--settings") === "/s", "model and settings are passed");
  const y = chat.chatClaudeArgs({ policy: "yolo", sessionId: SID }, {});
  check(y.includes("--dangerously-skip-permissions") && !y.includes("--mcp-config"), "a yolo chat skips the gate and has no bridge");
}

console.log("\ncodex argv");
{
  const site = { url: "https://x/api/mcp", token: "rkmcp_SECRETSECRETSECRET123", orgId: "acme" };
  const a = chat.chatCodexArgs({ policy: "allowlist", sessionId: "" }, { site, prompt: "-rf look" });
  check(a[0] === "exec" && a[1] === "--json", "codex exec --json");
  check(!a.includes("resume"), "the first turn is not a resume");
  check(after(a, "--sandbox") === "read-only", "codex runs read-only (it has no prompt tool)");
  check(a.includes("--skip-git-repo-check"), "a plain chat directory is allowed");
  check(a[a.length - 2] === "--" && a[a.length - 1] === "-rf look", "the prompt follows --, so it is never a flag");
  check(a.some((x) => x.includes("bearer_token_env_var")) && !a.join(" ").includes(site.token), "the site token is named, never in argv");
  check(a.some((x) => x.includes('"x-org-id" = "acme"')), "the org rides as x-org-id");
  const r = chat.chatCodexArgs({ policy: "allowlist", sessionId: "abcd1234-0000-0000-0000-000000000000", model: "gpt-5" }, { prompt: "next", resume: true });
  const i = r.indexOf("resume");
  check(i > 0 && r[i + 1] === "abcd1234-0000-0000-0000-000000000000" && r.indexOf("--") > i, "later turns: exec … resume <id> -- prompt");
  check(after(r, "--model") === "gpt-5", "model is passed");
  await throws(() => chat.chatCodexArgs({ policy: "allowlist", sessionId: "" }, { prompt: "x", resume: true }), "resume without a session id is refused", /session id/);
  check(!chat.chatCodexArgs({ policy: "yolo" }, { prompt: "x" }).includes("--sandbox"), "yolo leaves codex's own sandbox default");
}

console.log("\nstdin encoding");
{
  const line = chat.encodeUserMessage("hello\nworld");
  check(line.endsWith("\n") && line.trim().split("\n").length === 1, "one message is one line, even with newlines in it");
  const m = JSON.parse(line);
  check(m.type === "user" && m.message.role === "user", "a user message");
  check(m.message.content[0].type === "text" && m.message.content[0].text === "hello\nworld", "with the text as a text block");
  const ctl = JSON.parse(chat.encodeInterrupt("int_1"));
  check(ctl.type === "control_request" && ctl.request_id === "int_1" && ctl.request.subtype === "interrupt", "an interrupt is a control_request");
}

/* ---------------- spec ---------------- */

console.log("\nvalidating a start");
{
  const ok = chat.normaliseChatSpec({ profile: "personal" });
  check(ok.tool === "claude" && ok.policy === "allowlist" && ok.orgId === "relax", "defaults: claude, allowlist, the default org");
  await throws(() => chat.normaliseChatSpec({ tool: "bash" }), "an unknown tool is refused", /Unknown tool/);
  await throws(() => chat.normaliseChatSpec({ policy: "wat" }), "an unknown policy is refused", /Unknown policy/);
  await throws(() => chat.normaliseChatSpec({ policy: "yolo" }), "yolo without disposable is refused", /disposable/);
  await throws(() => chat.normaliseChatSpec({ model: "--dangerously-skip-permissions" }), "a model that is a flag is refused", /not a model/);
  await throws(() => chat.normaliseChatSpec({ repo: "file:///etc" }), "a local repo is refused", /not a repository/);
  await throws(() => chat.normaliseChatSpec({ repo: "a/b", cwd: profiles.paths.work }), "repo AND cwd is refused", /not both/);
  await throws(() => chat.normaliseChatSpec({ cwd: "relative/dir" }), "a relative cwd is refused", /absolute/);
  await throws(() => chat.normaliseChatSpec({ cwd: path.join(profiles.paths.profiles, "personal") }), "a cwd inside the profiles dir is refused", /credentials/);
  await throws(() => chat.normaliseChatSpec({ cwd: path.resolve(os.tmpdir(), "elsewhere-xyz") }), "a cwd outside the roots is refused", /may only run under/);
  check(chat.normaliseChatSpec({ cwd: path.join(profiles.paths.work, "proj") }).cwd === path.join(profiles.paths.work, "proj"), "a cwd under work is accepted");
  await throws(() => chat.normaliseChatSpec({ orgId: "Not An Org" }), "a bad org is refused", /org id/);
  await throws(() => chat.normaliseChatSpec({ prompt: "x".repeat(chat.MAX_MESSAGE + 1) }), "an oversized prompt is refused", /capped/);
}

/* ---------------- state machine ---------------- */

console.log("\nstate machine");
{
  const n = chat.nextState;
  check(n("idle", "send") === "thinking", "idle → thinking on send");
  check(n("thinking", "ask") === "waiting", "thinking → waiting when an approval opens");
  check(n("waiting", "answered") === "thinking", "waiting → thinking when answered");
  check(n("thinking", "finished") === "idle" && n("waiting", "exit") === "idle", "a finished turn or exited child is idle");
  check(n("idle", "ask") === "idle", "an approval while idle does not invent a turn");
  check(n("thinking", "send") === "thinking", "a second send does not change a running turn");
  check(n("closed", "send") === "closed" && n("closed", "finished") === "closed", "closed is final");
  check(n("idle", "close") === "closed", "close closes");
}

/* ---------------- history parsing ---------------- */

const claudeFixture = [
  { type: "summary", summary: "x" },
  { type: "user", isMeta: true, sessionId: SID, cwd: "/w/p", timestamp: "2026-10-01T10:00:00Z", message: { role: "user", content: "<command-name>/init</command-name>" } },
  { type: "user", sessionId: SID, cwd: "/w/p", timestamp: "2026-10-01T10:00:01Z", message: { role: "user", content: "<command-name>/clear</command-name>" } },
  { type: "user", sessionId: SID, cwd: "/w/p", timestamp: "2026-10-01T10:00:02Z", message: { role: "user", content: "Fix the login bug GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123" } },
  { type: "assistant", timestamp: "2026-10-01T10:00:03Z", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Looking." }] } },
  { type: "assistant", timestamp: "2026-10-01T10:00:04Z", message: { id: "m1", role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } },
  { type: "user", timestamp: "2026-10-01T10:00:05Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "fail" }] } },
  { type: "assistant", timestamp: "2026-10-01T10:00:06Z", message: { id: "m2", role: "assistant", content: [{ type: "tool_use", id: "t2", name: "Edit", input: { file_path: "src/a.js" } }] } },
  { type: "user", timestamp: "2026-10-01T10:00:07Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "ok" }] }] } },
  { type: "assistant", timestamp: "2026-10-01T10:00:08Z", message: { id: "m3", role: "assistant", content: [{ type: "text", text: "Fixed." }] } },
  { type: "user", timestamp: "2026-10-01T10:00:09Z", message: { role: "user", content: [{ type: "text", text: "thanks" }] } },
]
  .map((o) => JSON.stringify(o))
  .join("\n") + "\nnot json at all\n";

console.log("\nclaude history");
{
  const s = chat.parseClaudeSession(claudeFixture);
  check(s.sessionId === SID && s.cwd === "/w/p", "session id and cwd come from the file");
  check(s.title.startsWith("Fix the login bug"), "title is the first thing the owner said, not a slash command", s.title);
  check(!s.title.includes("ghp_abc"), "and it is redacted");
  check(s.updatedAt === Date.parse("2026-10-01T10:00:09Z"), "updatedAt is the newest timestamp");
  check(s.messageCount === 5, "user, assistant(merged), assistant, assistant, user = 5 turns", String(s.messageCount));
  const a1 = s.turns[1];
  check(a1.role === "assistant" && a1.text === "Looking." && a1.tools.length === 1, "rows of one assistant message merge into one turn");
  check(a1.tools[0].name === "Bash" && a1.tools[0].summary === "Run: npm test" && a1.tools[0].ok === false, "a tool carries its summary and its failure");
  check(s.turns[2].tools[0].ok === true, "a successful tool_result marks ok");
  check(s.turns[4].role === "user" && s.turns[4].text === "thanks", "a text-block user message is a turn");
  check(!s.turns.some((t) => "messageId" in t), "internal merge keys do not leak");
  const capped = chat.parseClaudeSession(claudeFixture, { cap: 2 });
  check(capped.turns.length === 2 && capped.truncated && capped.messageCount === 5, "cap keeps the newest turns and says so");
}

const codexNew = [
  { timestamp: "2026-10-02T09:00:00Z", type: "session_meta", payload: { id: "0199aaaa-bbbb-cccc-dddd-eeeeffff0000", cwd: "/w/c" } },
  { timestamp: "2026-10-02T09:00:01Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>cwd</environment_context>" }] } },
  { timestamp: "2026-10-02T09:00:02Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "List the files" }] } },
  { timestamp: "2026-10-02T09:00:02Z", type: "event_msg", payload: { type: "user_message", message: "List the files" } },
  { timestamp: "2026-10-02T09:00:03Z", type: "response_item", payload: { type: "function_call", name: "shell", call_id: "k1", arguments: JSON.stringify({ command: ["bash", "-lc", "ls"] }) } },
  { timestamp: "2026-10-02T09:00:04Z", type: "response_item", payload: { type: "function_call_output", call_id: "k1", output: JSON.stringify({ output: "a b", metadata: { exit_code: 0 } }) } },
  { timestamp: "2026-10-02T09:00:05Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Two files." }] } },
]
  .map((o) => JSON.stringify(o))
  .join("\n");
const codexOld = [
  { id: "0188aaaa-bbbb-cccc-dddd-eeeeffff0000", timestamp: "2025-05-01T09:00:00Z", instructions: "" },
  { type: "message", role: "user", content: [{ type: "input_text", text: "Old question" }] },
  { type: "message", role: "assistant", content: [{ type: "output_text", text: "Old answer" }] },
]
  .map((o) => JSON.stringify(o))
  .join("\n");

console.log("\ncodex history");
{
  const s = chat.parseCodexSession(codexNew);
  check(s.sessionId === "0199aaaa-bbbb-cccc-dddd-eeeeffff0000" && s.cwd === "/w/c", "session_meta gives id and cwd");
  check(s.title === "List the files", "the environment block is not the title");
  check(s.messageCount === 2, "event_msg echoes are not counted twice", String(s.messageCount));
  check(s.turns[1].tools[0].name === "Bash" && s.turns[1].tools[0].summary === "Run: bash -lc ls" && s.turns[1].tools[0].ok === true, "a shell call is a Bash tool with its exit status");
  check(s.turns[1].text === "Two files.", "the answer joins the turn that ran the tool");
  const o = chat.parseCodexSession(codexOld);
  check(o.sessionId === "0188aaaa-bbbb-cccc-dddd-eeeeffff0000" && o.title === "Old question" && o.messageCount === 2, "the older rollout format reads too");
}

console.log("\nhistory on disk");
{
  const prof = "histprof";
  profiles.ensureProfile(prof);
  const proj = path.join(chat.claudeProjectsDir(prof), "-w-p");
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, `${SID}.jsonl`), claudeFixture);
  fs.writeFileSync(path.join(proj, "agent-0000aaaa.jsonl"), claudeFixture);
  const older = "22222222-2222-3333-4444-555555555555";
  fs.writeFileSync(path.join(proj, `${older}.jsonl`), JSON.stringify({ type: "user", sessionId: older, timestamp: "2026-09-01T00:00:00Z", message: { role: "user", content: "older chat" } }));
  const day = path.join(chat.codexSessionsDir(prof), "2026", "10", "02");
  fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(path.join(day, "rollout-2026-10-02T09-00-00-0199aaaa-bbbb-cccc-dddd-eeeeffff0000.jsonl"), codexNew);

  const all = chat.listSessions({ profile: prof });
  check(all.length === 3, "two claude sessions and one codex, sidechains skipped", String(all.length));
  check(all[0].tool === "codex" && all[1].sessionId === SID && all[2].sessionId === older, "newest first");
  const c = all.find((x) => x.sessionId === SID);
  check(c.title.startsWith("Fix the login bug") && c.cwd === "/w/p" && c.messageCount === 5 && c.profile === prof, "a summary has title, cwd, count and profile");
  check(chat.listSessions({ profile: prof, tool: "codex" }).length === 1, "filtered by tool");
  const h = chat.readSession({ profile: prof, tool: "claude", sessionId: SID });
  check(h.turns.length === 5 && h.partial === false, "one session reads into turns");
  const cx = chat.readSession({ profile: prof, tool: "codex", sessionId: "0199aaaa-bbbb-cccc-dddd-eeeeffff0000" });
  check(cx.turns.length === 2, "a codex session is found by the id in its filename");
  await throws(() => chat.readSession({ profile: prof, tool: "claude", sessionId: "33333333-0000-0000-0000-000000000000" }), "a missing session is a 404 sentence", /No claude session/);
  await throws(() => chat.listSessions({ profile: "../x" }), "a profile that is a path is refused", /profile name/);
}

/* ---------------- a claude chat ---------------- */

console.log("\na claude chat, turn by turn");
{
  const { reg, fx, events, states, ops, approvals } = makeRegistry();
  const out = await reg.start({ profile: "personal", prompt: "hello" });
  check(chat.isChatId(out.chatId) && out.sessionId === SID, "chat.started carries a chat id and the session id at once");
  const call = fx.calls[0];
  check(call.cmd === "claude" && Array.isArray(call.args), "spawned claude with array args (no shell)");
  check(call.opts.cwd === path.join(profiles.paths.work, "chats", out.chatId), "cwd defaults to work/chats/<id>");
  check(fs.existsSync(call.opts.cwd), "and the workspace exists");
  check(call.opts.env.DISPLAY === ":1", "DISPLAY=:1, so a GUI it opens is on the shared desktop");
  check(call.opts.env.XAUTHORITY === "/run/agentd-desktop/Xauthority", "XAUTHORITY set with it, or the -auth desktop refuses the GUI");
  check(call.opts.env.CLAUDE_CONFIG_DIR === path.join(profiles.profileDir("personal"), "claude"), "env is the profile's");
  check(!("AGENT_MCP_TOKEN" in call.opts.env), "the daemon's own token is not inherited");
  const cfgPath = after(call.args, "--mcp-config");
  check(!cfgPath.startsWith(call.opts.cwd + path.sep), "the MCP config is NOT inside the workspace");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  check(cfg.mcpServers.agentd.env.AGENTD_JOB_ID === out.chatId && cfg.mcpServers.agentd.env.AGENTD_JOB_TOKEN.length > 20, "the approval bridge is wired to this chat with its own secret");
  check(!cfg.mcpServers.site, "no site server without AGENT_MCP_TOKEN");
  check(JSON.parse(call.child.writes[0]).message.content[0].text === "hello", "the opening prompt went to stdin as a user message");
  check(reg.get(out.chatId).state === "thinking", "and the chat is thinking");
  await throws(() => reg.send(out.chatId, "again"), "a second message mid-turn is refused", /thinking/);

  const waiting = reg.waitTurn(out.chatId, 5000);
  const ch = call.child;
  ch.say({ type: "system", subtype: "init", session_id: SID, model: "opus", tools: [] });
  // A line split across two chunks.
  const partial = JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "Hel" } } });
  ch.stdout.emit("data", partial.slice(0, 20));
  ch.stdout.emit("data", partial.slice(20) + "\n");
  ch.say(
    { type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "a" }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "tu2", name: "Write", input: { file_path: "x.txt", content: "API_KEY=supersecretvalue123" } }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "tu3", name: "Read", input: { file_path: "x.txt" } }] } },
    { type: "control_response", response: { subtype: "success", request_id: "r" } },
    { type: "assistant", message: { content: [{ type: "text", text: "Hello there" }] } },
    { type: "result", subtype: "success", session_id: SID, result: "Hello there", num_turns: 1 }
  );
  const snap = await waiting;
  check(snap.state === "idle" && snap.text === "Hello there" && snap.sessionId === SID, "the turn ends at result with the assistant text");
  check(snap.tools.length === 3 && snap.tools[0].name === "Bash" && snap.tools[0].ok === true && snap.tools[1].ok === null, "tools: name, summary, ok");
  const types = events.map((x) => x.e.type);
  check(types.includes("delta") && types.includes("tool") && types.includes("finished") && types.includes("user"), "every stream event is broadcast as chat.event");
  check(!types.includes("control"), "an interrupt's control answer is not transcript");
  check(states.some((s) => s.state === "thinking") && states[states.length - 1].state === "idle", "chat.state follows thinking → idle");
  check(ops.length === 2, "Bash and Write land on the review timeline; Read does not", String(ops.length));
  check(ops[0].actor === `chat:${out.chatId}` && ops[0].kind === "command" && ops[0].summary === "Run: ls", "a command is attributed to chat:<id>");
  check(ops[1].kind === "file" && ops[1].summary === "Create or overwrite x.txt", "a write is a file op");
  const entry = oplog.makeEntry(ops[1]);
  check(!JSON.stringify(entry).includes("supersecretvalue123"), "and what reaches the log is redacted");

  // approvals through the bridge
  const tok = cfg.mcpServers.agentd.env.AGENTD_JOB_TOKEN;
  const bad = await reg.approve({ jobId: out.chatId, tool: "Write", input: {} }, "x".repeat(tok.length));
  check(bad.status === 403 && bad.body.allow === false, "a wrong bridge secret is refused");
  const auto = await reg.approve({ jobId: out.chatId, tool: "Read", input: { file_path: "a.txt" } }, tok);
  check(auto.body.allow === true, "a read inside the chat's cwd is auto-approved under allowlist");
  reg.send(out.chatId, "write it");
  const pending = reg.approve({ jobId: out.chatId, tool: "Write", input: { file_path: "b.txt" } }, tok);
  await tick();
  check(reg.get(out.chatId).state === "waiting", "a gated write puts the chat in waiting");
  const card = approvals.list(out.chatId)[0];
  check(card && card.jobId === out.chatId, "the card is filed under the chat id");
  approvals.answer(card.id, { allow: true });
  const ans = await pending;
  check(ans.body.allow === true && reg.get(out.chatId).state === "thinking", "answered: allowed, and back to thinking");

  // interrupt
  const wrote = ch.writes.length;
  const intr = reg.interrupt(out.chatId);
  check(intr.interrupted && JSON.parse(ch.writes[wrote]).type === "control_request", "interrupt asks Claude over its control channel first");
  await tick(40);
  check(ch.kills.includes("SIGINT"), "and SIGINTs the turn if it is still running after the grace");
  ch.exit(130);
  check(reg.get(out.chatId).state === "idle" && reg.get(out.chatId).sessionId === SID, "the child exiting leaves the chat idle and resumable");
  reg.send(out.chatId, "carry on");
  const re = fx.calls[1];
  check(re && after(re.args, "--resume") === SID && !re.args.includes("--session-id"), "the next message respawns with --resume <sessionId>");
  check(re.opts.cwd === call.opts.cwd, "in the same cwd, which is where Claude filed the session");
  re.child.say({ type: "result", subtype: "success", session_id: SID, result: "done" });
  check(reg.get(out.chatId).state === "idle", "result ends the turn");

  // close
  const closed = reg.close(out.chatId);
  check(closed.state === "closed" && re.child.kills.includes("SIGTERM") && re.child.ended, "close ends stdin and terminates the child");
  check(!fs.existsSync(path.dirname(cfgPath)), "and removes the config holding the bridge secret");
  check(fs.existsSync(call.opts.cwd), "but keeps the workspace for a resume");
  await throws(() => reg.send(out.chatId, "hi"), "a closed chat refuses messages", /closed/);
  re.child.say({ type: "result", subtype: "success", result: "late" });
  check(reg.get(out.chatId).state === "closed", "a late event does not reopen a closed chat");
  const late = await reg.approve({ jobId: out.chatId, tool: "Write", input: {} }, tok);
  check(late.status === 403, "a closed chat's secret no longer answers");
}

console.log("\nidle close, waiting, limits");
{
  const { reg, advance } = makeRegistry({ idleMs: 1000 });
  const a = await reg.start({ profile: "personal" });
  check(reg.get(a.chatId).state === "idle", "a chat started without a prompt is idle");
  const quick = await reg.waitTurn(a.chatId, 10);
  check(quick.state === "idle", "waitTurn on an idle chat answers at once");
  advance(999);
  check(reg.checkIdle().length === 0, "not closed before AGENT_CHAT_IDLE_MS");
  advance(2);
  check(reg.checkIdle()[0] === a.chatId && reg.get(a.chatId).state === "closed", "closed once idle long enough");
  check(/Idle for/.test(reg.get(a.chatId).closedReason) && reg.get(a.chatId).sessionId === SID, "with a reason, keeping its session id");

  const b = await reg.start({ profile: "personal", prompt: "think" });
  advance(10_000);
  check(reg.checkIdle().length === 0, "a thinking chat is never idle-closed");
  const t0 = Date.now();
  const snap = await reg.waitTurn(b.chatId, 30);
  check(snap.state === "thinking" && Date.now() - t0 >= 25, "waitMs elapsing returns the turn so far, still thinking");

  const lim = makeRegistry({ jobsLive: () => ({ total: 3, byProfile: () => 0 }) });
  await lim.reg.start({ profile: "other" });
  await throws(() => lim.reg.start({ profile: "other2" }), "jobs + chats at AGENT_MAX_CONCURRENT refuses", /limit/);
  const per = makeRegistry();
  await per.reg.start({ profile: "personal" });
  await per.reg.start({ profile: "personal" });
  await throws(() => per.reg.start({ profile: "personal" }), "the per-profile limit counts chats", /AGENT_MAX_PER_PROFILE/);
  const halted = makeRegistry({ isHalted: () => true });
  await throws(() => halted.reg.start({ profile: "personal" }), "nothing starts while halted", /halted/);

  const jobs = new sessions.Registry({ limits: { global: 2, perProfile: 1, perDay: 50 } });
  jobs.externalLive = () => per.reg.liveCounts();
  await throws(async () => jobs.admit({ profile: "personal", task: "t", repo: "a/b" }), "a job's admission counts open chats too", /already/);
}

/* ---------------- a codex chat ---------------- */

console.log("\na codex chat");
{
  process.env.AGENT_MCP_TOKEN = "rkmcp_TESTTOKENTESTTOKEN1234";
  const { reg, fx, ops } = makeRegistry();
  const out = await reg.start({ profile: "personal", tool: "codex", orgId: "acme" });
  check(fx.calls.length === 0 && out.sessionId === "", "a codex chat spawns nothing until the first message");
  reg.send(out.chatId, "list files");
  const c1 = fx.calls[0];
  check(c1.cmd === "codex" && c1.args[0] === "exec" && c1.args.includes("--json") && !c1.args.includes("resume"), "turn 1: codex exec --json");
  check(c1.opts.env.CODEX_HOME === path.join(profiles.profileDir("personal"), "codex") && c1.opts.env.DISPLAY === ":1", "under the profile's CODEX_HOME, on the shared display");
  check(c1.opts.env.AGENTD_SITE_MCP_TOKEN === process.env.AGENT_MCP_TOKEN && !c1.args.join(" ").includes(process.env.AGENT_MCP_TOKEN), "the site token is in env, not argv");
  check(c1.args.some((x) => x.includes('"x-org-id" = "acme"')), "with the chat's org");
  const w = reg.waitTurn(out.chatId, 5000);
  c1.child.say(
    { type: "thread.started", thread_id: "0199aaaa-bbbb-cccc-dddd-eeeeffff0001" },
    { type: "item.started", item: { id: "i1", type: "command_execution", command: "ls -la" } },
    { type: "item.completed", item: { id: "i1", type: "command_execution", exit_code: 0, aggregated_output: "a" } },
    { type: "item.completed", item: { id: "i2", type: "file_change", status: "completed", changes: [{ path: "n.txt", kind: "add" }] } },
    { type: "item.completed", item: { id: "i3", type: "agent_message", text: "Done." } },
    { type: "turn.completed", usage: {} }
  );
  check(reg.get(out.chatId).state === "thinking", "a codex turn is not over until its process exits");
  c1.child.exit(0);
  const snap = await w;
  check(snap.state === "idle" && snap.text === "Done." && snap.sessionId === "0199aaaa-bbbb-cccc-dddd-eeeeffff0001", "then idle, with the text and the thread id");
  check(snap.tools.map((t) => `${t.name}:${t.ok}`).join(",") === "Bash:true,Write:true", "tools from command_execution and file_change", snap.tools.map((t) => `${t.name}:${t.ok}`).join(","));
  check(ops.map((o) => o.kind).join(",") === "command,file", "both land on the review timeline");
  reg.send(out.chatId, "and again");
  const c2 = fx.calls[1];
  const i = c2.args.indexOf("resume");
  check(i > 0 && c2.args[i + 1] === "0199aaaa-bbbb-cccc-dddd-eeeeffff0001", "turn 2: codex exec … resume <sessionId>");
  reg.interrupt(out.chatId);
  check(c2.child.kills.includes("SIGINT"), "interrupt SIGINTs the codex turn");
  c2.child.exit(130);
  const s2 = reg.snapshot(reg.get(out.chatId));
  check(s2.state === "idle" && /130/.test(s2.error || ""), "an interrupted turn is idle and says why");
  delete process.env.AGENT_MCP_TOKEN;
}

console.log("\nresuming a past session");
{
  const prof = "resprof";
  profiles.ensureProfile(prof);
  const cwd = path.join(profiles.paths.work, "chats", "oldproj");
  fs.mkdirSync(cwd, { recursive: true });
  const proj = path.join(chat.claudeProjectsDir(prof), "-old");
  fs.mkdirSync(proj, { recursive: true });
  const rid = "44444444-2222-3333-4444-555555555555";
  fs.writeFileSync(path.join(proj, `${rid}.jsonl`), JSON.stringify({ type: "user", sessionId: rid, cwd, timestamp: "2026-10-03T00:00:00Z", message: { role: "user", content: "old" } }));
  const { reg, fx } = makeRegistry();
  const out = await reg.resume({ profile: prof, tool: "claude", sessionId: rid, prompt: "continue" });
  check(out.sessionId === rid && after(fx.calls[0].args, "--resume") === rid, "resume spawns claude --resume <sessionId>");
  check(fx.calls[0].opts.cwd === cwd, "in the cwd the session recorded");
  check(JSON.parse(fx.calls[0].child.writes[0]).message.content[0].text === "continue", "and sends the follow-up");
  const again = await reg.resume({ profile: prof, tool: "claude", sessionId: rid });
  check(again.reused && again.chatId === out.chatId && fx.calls.length === 1, "resuming a session that is already open reuses that chat");
  const hist = reg.history({ profiles: [prof] });
  check(hist[0].sessionId === rid && hist[0].liveChatId === out.chatId, "history marks a session that is open live");
  const gone = "55555555-2222-3333-4444-555555555555";
  fs.writeFileSync(path.join(proj, `${gone}.jsonl`), JSON.stringify({ type: "user", sessionId: gone, cwd: "/nowhere/at/all", message: { role: "user", content: "x" } }));
  await throws(() => reg.resume({ profile: prof, tool: "claude", sessionId: gone }), "a session whose cwd is gone or outside the roots cannot resume", /can only resume it from there/);
  const repoChat = await reg.start({ profile: prof, repo: "owner/name" });
  check(repoChat.chat.cwd === path.join(profiles.paths.work, "chats", repoChat.chatId), "a repo chat runs in its clone under work/chats/<id>");
}

/* ---------------- the HTTP routes ---------------- */

console.log("\nHTTP routes");
{
  const m = api.matchRoute;
  check(m("GET", "/chats").name === "chatList", "GET /chats");
  check(m("GET", "/chats/history?profile=p&tool=claude&sessionId=x").name === "chatHistory" && m("GET", "/chats/history?profile=p").query.profile === "p", "GET /chats/history with its query");
  check(m("POST", "/chats").name === "chatStart", "POST /chats");
  const msg = m("POST", "/chats/c_abc_123456/messages");
  check(msg.name === "chatMessage" && msg.id === "c_abc_123456", "POST /chats/:id/messages");
  check(m("POST", "/chats/c_abc_123456/interrupt").name === "chatInterrupt", "POST /chats/:id/interrupt");
  check(m("POST", "/chats/c_abc_123456/close").name === "chatClose", "POST /chats/:id/close");
  check(api.isApiPath("/chats") && api.isApiPath("/chats/x/messages") && !api.isApiPath("/chatsx"), "isApiPath covers /chats and nothing that merely starts with it");
  check(m("DELETE", "/chats") === null, "an unknown method is not a route (answers 405)");
  check(api.isApiPath("/runs") && api.isApiPath("/status"), "the existing routes still match");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
try {
  fs.rmSync(process.env.AGENT_HOME, { recursive: true, force: true });
} catch (_) {}
if (fails.length) {
  console.log("FAILURES:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
process.exit(0);
