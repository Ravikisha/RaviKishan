// The review timeline: one append-only record of what was DONE on this box.
//
// Commands, file writes, desktop clicks and keys, browser navigations,
// terminal command lines, preview opens and approval decisions all land here,
// with who did them (the owner, a chat, a job, the site's MCP) and, for a
// gated action, what was decided. "Controlled and visual, not blind" needs a
// place where the visual part can be read back afterwards.
//
// NDJSON at ~/.agentd/logs/ops.ndjson, rotated to ops.ndjson.1 at 10 MB (one
// generation kept). Every summary and detail is redacted BEFORE it is written,
// because the file is read back over the socket and over the HTTP API.
import fs from "fs";
import path from "path";
import { redact } from "./policy.js";
import { paths } from "./profiles.js";

export const KINDS = ["command", "file", "desktop", "browser", "terminal", "approval", "preview"];
export const MAX_BYTES = Number(process.env.AGENT_OPLOG_MAX_BYTES || 10 * 1024 * 1024);

// Who did it. Anything else becomes "unknown" rather than being trusted as a
// label — an actor string is shown to the owner as a fact.
const ACTOR = /^(owner|mcp|unknown|(chat|job|agent):[A-Za-z0-9_.-]{1,64})$/;
export const normaliseActor = (a) => (ACTOR.test(String(a || "")) ? String(a) : "unknown");

const DETAIL_CAP = 4000;

// PURE. Redacts every string inside a detail object (bounded depth), so a
// command line or a typed string carrying a token is stored masked.
export function redactDetail(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === "string") return redact(v).slice(0, 2000);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (depth > 4) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redactDetail(x, depth + 1));
  if (typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v).slice(0, 50)) {
      // A value under a key that names a secret is dropped whatever it looks like.
      out[k] = /token|secret|password|passphrase|cookie|authorization|api_?key/i.test(k) ? "••••••••" : redactDetail(x, depth + 1);
    }
    return out;
  }
  return String(v).slice(0, 200);
}

// PURE. The entry exactly as it is written.
export function makeEntry({ actor, kind, summary, detail, decision } = {}, { now = Date.now() } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown op kind "${kind}". Known: ${KINDS.join(", ")}.`);
  const e = { at: now, actor: normaliseActor(actor), kind, summary: redact(String(summary || "")).slice(0, 500) };
  if (detail !== undefined) {
    let d = redactDetail(detail);
    const text = JSON.stringify(d);
    if (text && text.length > DETAIL_CAP) d = { truncated: text.slice(0, DETAIL_CAP) };
    e.detail = d;
  }
  if (decision !== undefined) {
    // A decision is one of three words; anything else is not recorded as one.
    e.decision = ["allowed", "denied", "auto"].includes(decision) ? decision : "denied";
  }
  return e;
}

// PURE. since (ms or ISO), actor (exact, or a prefix ending in ":"), kind (one
// or comma-separated), limit (1–1000, default 200). Newest first.
export function filterOps(entries, { since, actor, kind, limit } = {}) {
  const sinceMs = since == null || since === "" ? 0 : Number.isFinite(Number(since)) ? Number(since) : Date.parse(since) || 0;
  const kinds = kind ? String(kind).split(",").map((k) => k.trim()).filter(Boolean) : null;
  const a = actor ? String(actor) : "";
  const n = Math.max(1, Math.min(1000, Number(limit) || 200));
  const out = [];
  for (let i = entries.length - 1; i >= 0 && out.length < n; i--) {
    const e = entries[i];
    if (!e || e.at < sinceMs) continue;
    if (kinds && !kinds.includes(e.kind)) continue;
    if (a && !(a.endsWith(":") ? String(e.actor).startsWith(a) : e.actor === a)) continue;
    out.push(e);
  }
  return out;
}

const parseLines = (text) =>
  text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);

export class OpLog {
  constructor({ file = path.join(paths.logs, "ops.ndjson"), maxBytes = MAX_BYTES, now = () => Date.now() } = {}) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.now = now;
    this.listeners = new Set();
    this.size = null;
  }

  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Never throws: a failure to log must not break the action it records.
  record(op) {
    let entry;
    try {
      entry = makeEntry(op, { now: this.now() });
    } catch (_) {
      return null;
    }
    const line = `${JSON.stringify(entry)}\n`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      if (this.size == null) {
        try {
          this.size = fs.statSync(this.file).size;
        } catch (_) {
          this.size = 0;
        }
      }
      if (this.size > 0 && this.size + Buffer.byteLength(line) > this.maxBytes) this.rotate();
      fs.appendFileSync(this.file, line, { mode: 0o600 });
      this.size += Buffer.byteLength(line);
    } catch (_) {}
    for (const fn of this.listeners) {
      try {
        fn(entry);
      } catch (_) {}
    }
    return entry;
  }

  rotate() {
    try {
      fs.renameSync(this.file, `${this.file}.1`);
    } catch (_) {}
    this.size = 0;
  }

  readAll() {
    const read = (f) => {
      try {
        return fs.readFileSync(f, "utf8");
      } catch (_) {
        return "";
      }
    };
    return [...parseLines(read(`${this.file}.1`)), ...parseLines(read(this.file))];
  }

  list(filter = {}) {
    return filterOps(this.readAll(), filter);
  }
}

// The shared instance, for the daemon and for chat.js's onOp hook.
let shared = null;
export function opLog() {
  if (!shared) shared = new OpLog();
  return shared;
}
export const record = (op) => opLog().record(op);

// Approval cards → timeline entries. The asked card carries the summary; the
// answer carries the decision, so the two are joined by id.
export function approvalRecorder(log = opLog()) {
  const cards = new Map();
  return (e) => {
    if (e?.type === "approval.asked" && e.card) {
      cards.set(e.card.id, e.card);
      if (cards.size > 500) cards.delete(cards.keys().next().value);
      return null;
    }
    if (e?.type === "approval.answered") {
      const card = cards.get(e.id) || {};
      cards.delete(e.id);
      // Whose action was gated: a job's, a chat's, or the site's MCP (the
      // desktop API files its cards under "mcp").
      const id = String(e.jobId);
      const owner = /^j_/.test(id) ? `job:${id}` : /^c_/.test(id) ? `chat:${id}` : id === "mcp" ? "mcp" : "owner";
      return log.record({
        actor: owner,
        kind: "approval",
        summary: `${e.allow ? "Allowed" : e.timedOut ? "Timed out" : "Denied"}: ${card.summary || card.tool || e.id}`,
        detail: { approvalId: e.id, tool: card.tool, input: card.input, reason: e.reason },
        decision: e.allow ? "allowed" : "denied",
      });
    }
    return null;
  };
}
