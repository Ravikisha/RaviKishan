// Turning a tool's output into events the panel can render.
//
// PURE — feed it text, get events — so the whole transcript path is testable
// without starting a process, which is the only practical way to pin behaviour
// against output formats that are not ours and will change.
//
// Claude Code emits newline-delimited JSON with `--output-format stream-json`.
// Codex does not emit the same thing, so its output is treated as plain text.
// Both end up as the same event shape, because the panel should not care which
// tool produced a line.
import { redact } from "./policy.js";

// One line can be enormous (a file read echoed back), and a browser does not
// need it. Truncation is marked so a reader knows it happened.
const MAX_TEXT = 8000;

const clip = (s) => {
  const t = String(s ?? "");
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n…[${t.length - MAX_TEXT} more characters]` : t;
};

// Every event that reaches the browser goes through here. Redaction happens at
// the boundary rather than at each call site, so a new event type cannot
// forget it.
const emit = (type, fields = {}) => ({
  type,
  at: Date.now(),
  ...fields,
  ...(fields.text !== undefined ? { text: clip(redact(fields.text)) } : {}),
});

// A buffered line splitter. stdout arrives in arbitrary chunks, and a JSON
// object split across two chunks is the classic way a stream parser breaks
// under load and works in testing.
export class LineSplitter {
  constructor() {
    this.buf = "";
  }
  push(chunk) {
    this.buf += String(chunk);
    const lines = this.buf.split(/\r?\n/);
    // The last element is either an incomplete line or "". Either way it is
    // kept for the next chunk.
    this.buf = lines.pop();
    return lines.filter((l) => l.length);
  }
  flush() {
    const rest = this.buf;
    this.buf = "";
    return rest ? [rest] : [];
  }
}

// Claude Code's stream-json. Unknown message types become a `raw` event rather
// than being dropped: an output format that gains a type should make the panel
// show something unfamiliar, not go quiet.
export function parseClaudeLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (_) {
    // Not JSON at all — a warning, a stack trace, an update notice.
    return [emit("log", { text: line })];
  }

  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") {
        return [emit("started", { sessionId: msg.session_id || "", model: msg.model || "", tools: msg.tools?.length || 0 })];
      }
      return [emit("system", { text: msg.subtype || "" })];

    case "assistant": {
      const out = [];
      for (const block of msg.message?.content || []) {
        if (block.type === "text" && block.text) out.push(emit("text", { text: block.text }));
        if (block.type === "thinking" && block.thinking) out.push(emit("thinking", { text: block.thinking }));
        if (block.type === "tool_use") {
          out.push(
            emit("tool", {
              tool: block.name,
              id: block.id,
              input: block.input,
              // The one-line version the transcript shows; the approval card
              // builds its own from the same input.
              text: block.name === "Bash" ? String(block.input?.command || "") : "",
            })
          );
        }
      }
      return out;
    }

    case "user": {
      // Tool results come back as user messages.
      const out = [];
      for (const block of msg.message?.content || []) {
        if (block.type === "tool_result") {
          const text = Array.isArray(block.content)
            ? block.content.map((c) => c.text || "").join("")
            : String(block.content ?? "");
          out.push(emit("result", { id: block.tool_use_id, isError: !!block.is_error, text }));
        }
      }
      return out;
    }

    case "stream_event": {
      // --include-partial-messages: token-by-token deltas.
      const d = msg.event?.delta;
      if (d?.type === "text_delta" && d.text) return [emit("delta", { text: d.text })];
      if (d?.type === "thinking_delta" && d.thinking) return [emit("thinkingDelta", { text: d.thinking })];
      return [];
    }

    // The answer to a control_request a chat wrote on stdin (an interrupt).
    // Not transcript material; chat.js filters it out of what it broadcasts.
    case "control_response":
      return [emit("control", { subtype: msg.response?.subtype || "", requestId: msg.response?.request_id || "" })];

    case "result":
      return [
        emit("finished", {
          sessionId: msg.session_id || "",
          ok: msg.subtype === "success",
          text: msg.result || "",
          turns: msg.num_turns || 0,
          ms: msg.duration_ms || 0,
          // Reported because a background agent's cost is otherwise invisible
          // until the month ends.
          usd: msg.total_cost_usd ?? null,
        }),
      ];

    default:
      return [emit("raw", { text: line })];
  }
}

// Codex and anything else: plain text, one event per line.
export const parseTextLine = (line) => [emit("log", { text: line })];

// `codex exec --json`, as chats run it. Two generations of the format exist in
// the wild and both are mapped onto the Claude event shape, so the chat view
// renders either without knowing which tool spoke:
//   current   {type:"thread.started"|"item.started"|"item.completed"|"turn.completed"|"turn.failed"|"error", …}
//   older     {id, msg:{type:"session_configured"|"agent_message"|"exec_command_begin"|…}}
// Anything unrecognised is a `raw` event, never dropped.
const codexCmd = (c) => (Array.isArray(c) ? c.join(" ") : String(c ?? ""));

function codexItem(phase, item = {}) {
  const id = item.id || "";
  switch (item.type) {
    case "agent_message":
      return phase === "completed" && item.text ? [emit("text", { text: item.text })] : [];
    case "reasoning":
      return phase === "completed" && item.text ? [emit("thinking", { text: item.text })] : [];
    case "command_execution":
      if (phase === "started") return [emit("tool", { tool: "Bash", id, input: { command: codexCmd(item.command) }, text: codexCmd(item.command) })];
      return [emit("result", { id, isError: item.exit_code != null && item.exit_code !== 0, text: item.aggregated_output || "" })];
    case "file_change": {
      if (phase !== "completed") return [];
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const paths = changes.map((c) => c.path).filter(Boolean);
      return [
        emit("tool", { tool: changes.some((c) => c.kind === "add") && changes.every((c) => c.kind === "add") ? "Write" : "Edit", id, input: { file_path: paths[0] || "", changes }, text: paths.join(", ") }),
        emit("result", { id, isError: item.status === "failed", text: item.status || "" }),
      ];
    }
    case "mcp_tool_call":
      if (phase === "started") return [emit("tool", { tool: `mcp__${item.server || "?"}__${item.tool || "?"}`, id, input: item.arguments || {}, text: "" })];
      return [emit("result", { id, isError: item.status === "failed", text: typeof item.result === "string" ? item.result : JSON.stringify(item.result ?? item.error ?? "") })];
    case "web_search":
      return phase === "started" ? [emit("tool", { tool: "WebSearch", id, input: { query: item.query || "" }, text: item.query || "" })] : [];
    case "error":
      return [emit("error", { text: item.message || "" })];
    default:
      return phase === "completed" ? [emit("raw", { text: JSON.stringify(item) })] : [];
  }
}

export function parseCodexJsonLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (_) {
    return [emit("log", { text: line })];
  }
  if (msg && msg.msg && typeof msg.msg === "object") {
    const m = msg.msg;
    switch (m.type) {
      case "session_configured":
        return [emit("started", { sessionId: m.session_id || "", model: m.model || "", tools: 0 })];
      case "agent_message":
        return m.message ? [emit("text", { text: m.message })] : [];
      case "agent_reasoning":
        return m.text ? [emit("thinking", { text: m.text })] : [];
      case "exec_command_begin":
        return [emit("tool", { tool: "Bash", id: m.call_id || "", input: { command: codexCmd(m.command) }, text: codexCmd(m.command) })];
      case "exec_command_end":
        return [emit("result", { id: m.call_id || "", isError: m.exit_code !== 0, text: m.aggregated_output || m.stdout || m.stderr || "" })];
      case "task_complete":
        return [emit("finished", { ok: true, text: m.last_agent_message || "", turns: 1, ms: 0, usd: null })];
      case "error":
        return [emit("error", { text: m.message || "" })];
      case "agent_message_delta":
        return m.delta ? [emit("delta", { text: m.delta })] : [];
      default:
        return [];
    }
  }
  switch (msg?.type) {
    case "thread.started":
      return [emit("started", { sessionId: msg.thread_id || "", model: "", tools: 0 })];
    case "turn.started":
      return [];
    case "item.started":
      return codexItem("started", msg.item);
    case "item.updated":
      return [];
    case "item.completed":
      return codexItem("completed", msg.item);
    case "turn.completed":
      return [emit("finished", { ok: true, text: "", turns: 1, ms: 0, usd: null, usage: msg.usage || null })];
    case "turn.failed":
      return [emit("finished", { ok: false, text: msg.error?.message || "The turn failed.", turns: 1, ms: 0, usd: null })];
    case "error":
      return [emit("error", { text: msg.message || "" })];
    default:
      return [emit("raw", { text: line })];
  }
}

// What the server uses. `tool` picks the parser; everything downstream is the
// same shape either way. "codex-json" is a chat's `codex exec --json`; a job's
// codex still runs without --json and is read as text.
export function makeParser(tool) {
  const splitter = new LineSplitter();
  const parse = tool === "claude" ? parseClaudeLine : tool === "codex-json" ? parseCodexJsonLine : parseTextLine;
  return {
    push(chunk) {
      return splitter.push(chunk).flatMap(parse);
    },
    flush() {
      return splitter.flush().flatMap(parse);
    },
  };
}

// Which events are the MODEL speaking, and so feed the learnings block at the
// end of a job. Claude's stream says so (`text`, `finished`); Codex's parser
// above emits only `log` lines, so for Codex those ARE the model's words —
// without this every Codex run ended "without a learnings block" it had
// actually written.
export function isModelText(job, e) {
  if (!e || typeof e.text !== "string" || !e.text) return false;
  if (e.type === "text" || e.type === "finished") return true;
  return job?.tool === "codex" && e.type === "log";
}

export { emit };
