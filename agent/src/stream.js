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
      return [];
    }

    case "result":
      return [
        emit("finished", {
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

// What the server uses. `tool` picks the parser; everything downstream is the
// same shape either way.
export function makeParser(tool) {
  const splitter = new LineSplitter();
  const parse = tool === "claude" ? parseClaudeLine : parseTextLine;
  return {
    push(chunk) {
      return splitter.push(chunk).flatMap(parse);
    },
    flush() {
      return splitter.flush().flatMap(parse);
    },
  };
}

export { emit };
