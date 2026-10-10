// PURE. Turning a chat's event stream into things a person reads.
//
// The agent server forwards what Claude Code or Codex print, already parsed by
// agent/src/stream.js. Two vocabularies reach this file and both are accepted,
// because the server is being built in parallel and a renamed event must make
// the transcript show something, never go quiet:
//   stream.js     started | text | delta | thinking | thinkingDelta | tool |
//                 result (carries the tool_use id) | finished | error | system | log | raw
//   chat socket   text | delta | tool_use | tool_result | result (the turn) | error | system
// The one real collision is "result": with an id it answers a tool call, with
// no id it ends the turn.
//
// No React and no DOM here, so the fold can be checked from plain node.

const str = (v) => (v == null ? "" : String(v));

// The one line a tool card shows when it is folded shut. The literal command
// or path, never a paraphrase: "ran a shell command" is not something anyone
// can check.
export function toolLine(name = "", input = {}) {
  const i = input && typeof input === "object" ? input : {};
  if (i.command) return str(i.command);
  if (i.file_path) return str(i.file_path);
  if (i.path) return str(i.path);
  if (i.url) return str(i.url);
  if (i.pattern) return str(i.pattern) + (i.path ? ` in ${i.path}` : "");
  if (i.query) return str(i.query);
  if (i.text) return str(i.text).slice(0, 160);
  if (i.combo) return str(i.combo);
  if (i.x != null && i.y != null) return `${i.x}, ${i.y}`;
  const keys = Object.keys(i);
  if (!keys.length) return "";
  try {
    return JSON.stringify(i).slice(0, 160);
  } catch (_) {
    return "";
  }
}

// "mcp__desktop__click" reads better as "desktop click" with the server named.
export function toolName(name = "") {
  const parts = String(name || "").split("__");
  return parts[0] === "mcp" && parts.length >= 3
    ? { server: parts[1], name: parts.slice(2).join("__") }
    : { server: "", name: String(name || "tool") };
}

const kindOf = (e) => {
  const t = e?.type;
  if (t === "tool" || t === "tool_use") return "tool";
  if (t === "tool_result" || (t === "result" && e.id)) return "toolResult";
  if (t === "finished" || t === "result") return "end";
  if (t === "thinkingDelta") return "thinkingDelta";
  if (t === "started") return "started";
  return t || "raw";
};

// events → items. Each item is one thing on the page:
//   user · assistant · thinking · tool · end · error · system · log
export function foldEvents(events = []) {
  const items = [];
  const tools = new Map();
  const last = () => items[items.length - 1];

  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const k = kindOf(e);
    switch (k) {
      case "user": {
        const text = str(e.text);
        const prev = [...items].reverse().find((x) => x.kind === "user");
        // The panel shows a sent message at once; when the server echoes the
        // same words back, that is the same message, not a second one.
        if (prev && prev.local && prev.text === text && !e.local) {
          prev.local = false;
          break;
        }
        items.push({ kind: "user", text, at: e.at || 0, local: !!e.local });
        break;
      }
      case "delta": {
        const l = last();
        if (l && l.kind === "assistant" && l.streaming) l.text += str(e.text);
        else items.push({ kind: "assistant", text: str(e.text), streaming: true, at: e.at || 0 });
        break;
      }
      case "text": {
        const l = last();
        // A complete text block after its own deltas is the same words, said
        // once more in full. Replace rather than repeat.
        if (l && l.kind === "assistant" && l.streaming) {
          l.text = str(e.text) || l.text;
          l.streaming = false;
        } else items.push({ kind: "assistant", text: str(e.text), streaming: false, at: e.at || 0 });
        break;
      }
      case "thinking":
      case "thinkingDelta": {
        const l = last();
        if (l && l.kind === "thinking" && (k === "thinkingDelta" || l.open)) {
          l.text = k === "thinking" ? str(e.text) || l.text : l.text + str(e.text);
          l.open = k === "thinkingDelta";
        } else items.push({ kind: "thinking", text: str(e.text), open: k === "thinkingDelta" });
        break;
      }
      case "tool": {
        const name = e.tool || e.name || "tool";
        const input = e.input || {};
        const item = { kind: "tool", id: e.id || `t${items.length}`, name, input, line: str(e.text) || toolLine(name, input), result: null, at: e.at || 0 };
        tools.set(item.id, item);
        items.push(item);
        break;
      }
      case "toolResult": {
        const text = str(e.text ?? e.content ?? e.output);
        const hit = tools.get(e.id || e.tool_use_id);
        if (hit) hit.result = { text, isError: !!(e.isError ?? e.is_error) };
        else items.push({ kind: "tool", id: e.id || `r${items.length}`, name: "result", input: {}, line: "", result: { text, isError: !!(e.isError ?? e.is_error) } });
        break;
      }
      case "end": {
        const l = last();
        if (l && l.kind === "assistant") l.streaming = false;
        items.push({
          kind: "end",
          ok: e.ok !== false && !e.isError && e.subtype !== "error",
          turns: e.turns || e.num_turns || 0,
          ms: e.ms || e.duration_ms || 0,
          usd: e.usd ?? e.total_cost_usd ?? null,
          interrupted: !!e.interrupted,
        });
        break;
      }
      case "error":
        items.push({ kind: "error", text: str(e.text || e.error || e.message) });
        break;
      case "started":
        items.push({ kind: "system", text: `Session ${str(e.sessionId).slice(0, 8) || "started"}${e.model ? ` on ${e.model}` : ""}` });
        break;
      case "system":
        if (e.text) items.push({ kind: "system", text: str(e.text) });
        break;
      case "control":
        break;
      default:
        if (e.text) items.push({ kind: "log", text: str(e.text) });
    }
  }
  return items;
}

// A transcript read back from disk may come as TURNS rather than events.
// Turned into events so one renderer covers a live chat and a past one.
export function historyToEvents(msg = {}) {
  if (Array.isArray(msg.events)) return msg.events;
  const turns = msg.turns || msg.messages || [];
  const out = [];
  for (const t of turns) {
    if (!t) continue;
    if (t.role === "user") {
      out.push({ type: "user", text: str(t.text ?? t.content) });
      continue;
    }
    if (t.text || t.content) out.push({ type: "text", text: str(t.text ?? t.content) });
    for (const tool of t.tools || t.toolCalls || []) {
      const id = tool.id || `h${out.length}`;
      out.push({ type: "tool", id, tool: tool.name || tool.tool, input: tool.input || {} });
      if (tool.result !== undefined || tool.output !== undefined) {
        out.push({ type: "tool_result", id, text: str(tool.result ?? tool.output), isError: !!tool.isError });
      }
    }
  }
  return out;
}

// Prose and fenced code, apart. Assistant text is rendered as text, never as
// HTML: it is model output, and model output can be steered by whatever the
// model read.
export function splitFences(text = "") {
  const parts = [];
  const re = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g;
  let at = 0;
  let m;
  const s = String(text);
  while ((m = re.exec(s))) {
    if (m.index > at) parts.push({ kind: "prose", text: s.slice(at, m.index) });
    parts.push({ kind: "code", lang: m[1].trim(), text: m[2].replace(/\n$/, "") });
    at = re.lastIndex;
    if (m[0].length === 0) break;
  }
  if (at < s.length) parts.push({ kind: "prose", text: s.slice(at) });
  return parts.filter((p) => p.kind === "code" || p.text.trim());
}

// What the status line says, in words. Read aloud by a screen reader.
export function stateLine(state, { tool = "claude", pending = 0 } = {}) {
  const who = tool === "codex" ? "Codex" : "Claude";
  if (pending) return `${who} is waiting for your answer on ${pending === 1 ? "one request" : `${pending} requests`}.`;
  switch (state) {
    case "thinking":
      return `${who} is working.`;
    case "waiting":
      return `${who} is waiting for you.`;
    case "closed":
      return "This chat is closed. Resume it to carry on.";
    case "idle":
      return `${who} is ready for your next message.`;
    default:
      return "";
  }
}

// Session search: every word must match, in the title, the folder or the id.
export function matchSession(s, q) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${s.title || ""} ${s.cwd || ""} ${s.sessionId || ""} ${s.profile || ""} ${s.tool || ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}
