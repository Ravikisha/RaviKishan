// What happened, who did it, and when — for the MCP server and the API routes.
//
// WHY THIS EXISTS
// ---------------
// `lib/auditLog.js` records what the admin does IN THE BROWSER. It is opt-in
// per call site: a panel has to remember to call it. That worked while the
// only way to change anything was to click something.
//
// It does not work now. There are 130-odd MCP tools, 67 of which mutate, and
// exactly the secret and ML-credential ones recorded anything. So an agent
// could publish a post, retarget a short link, delete a task, rewrite the site
// content or push a LinkedIn post and leave NO trace at all — while the same
// action taken by hand two minutes earlier left one. The log was most complete
// for the actor least likely to surprise you.
//
// A record that depends on 130 call sites remembering to write it is not a
// record. So this is wired at the ONE place every tool call passes through,
// the dispatcher in pages/api/mcp/index.js, which makes it impossible for a
// new tool to arrive unlogged — the same reasoning as `writeBody()` for post
// snapshots and one pure `auditRepos` for the GitHub audit.
//
// FOUR RULES, each of which is a bug if broken
// --------------------------------------------
// 1. LOGGING MUST NEVER BREAK THE THING BEING LOGGED. Every failure here is
//    swallowed. A lost line is an acceptable cost; a failed publish because
//    the log write failed is not. Same rule as the browser module.
//
// 2. THE LOG MUST NOT BECOME A SECOND SECRET STORE. `create_secret` carries a
//    password in its arguments; `update_env_var` carries a credential;
//    `upload_blog_image` carries megabytes of base64. Recording arguments
//    verbatim would put all of it in a collection that is admin-readable but
//    NOT encrypted, with none of the handling the secret store has. So values
//    are redacted by KEY NAME against a deny-list, and anything long is cut.
//    `test:activity` asserts a known password cannot survive into an entry.
//
// 3. READING THE LOG MUST NOT GROW THE LOG. Otherwise one `get_audit_log` call
//    adds an entry, the next call reports it, and the log fills with the
//    history of being read.
//
// 4. NOTHING WRITES AN ARBITRARY ENTRY. There is no `log_activity` tool and no
//    API action that takes an entry body. A log anyone can write to says only
//    that someone wrote to it. Entries come from the dispatcher recording what
//    actually ran. `mcp:check` asserts the absence.
import { createDocument, listDocuments } from "./firestoreRest.js";

export const ACTIVITY_COLLECTION = "auditLog";

// Reads are recorded too, so "what did that agent do" has a complete answer
// rather than a list of the damage with the reconnaissance missing. They are
// marked `kind: "read"` and the viewer hides them by default, because a list
// where 77 of every 100 lines is a lookup is a list nobody reads.
//
// Set this to false to stop recording reads entirely. It is a real trade and
// it is stated rather than hidden: every read is one more Firestore write.
export const LOG_READS = true;

// Tools whose whole job is to read this log. Recording them would mean the
// log fills with the history of being looked at (rule 3).
export const NEVER_LOGGED = new Set(["get_audit_log", "get_activity_summary"]);

/* ---------------- redaction ---------------- */

// Matched against the KEY, not the value. A value-based heuristic ("does this
// look like a token") fails in both directions: it misses a password that
// looks like a word, and it redacts a blog title that happens to look random.
// The key is what the schema already tells us, so it is the thing to trust.
const SECRET_KEY = /^(value|secret|password|passphrase|token|api_?key|client_?secret|refresh_?token|access_?token|authorization|cookie|private_?key|credential)s?$/i;

// Big payloads: never useful in a log, and they are what makes an entry
// expensive to store and impossible to read.
const BULK_KEY = /^(contentBase64|body|markdown|content|html|caption|text|jdText|notes|description)$/i;

const MAX_STRING = 160;
const MAX_KEYS = 24;

const sizeOf = (v) => {
  try {
    return JSON.stringify(v).length;
  } catch {
    return 0;
  }
};

// Say what a value WAS without saying what it SAID. "a 2,431-character string"
// is the useful half of a blog body in a log; the body itself is not.
const elide = (v) => {
  if (typeof v === "string") return `«${v.length} chars»`;
  if (Array.isArray(v)) return `«${v.length} items»`;
  if (v && typeof v === "object") return `«${Object.keys(v).length} fields»`;
  return "«elided»";
};

export function redact(value, key = "", depth = 0) {
  if (SECRET_KEY.test(key)) return "«redacted»";
  if (value == null) return value;

  if (typeof value === "string") {
    if (BULK_KEY.test(key) && value.length > MAX_STRING) return elide(value);
    // A data: URI is a payload wearing a string's clothes.
    if (/^data:/i.test(value)) return `«data uri, ${value.length} chars»`;
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "…" : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (depth >= 3) return elide(value);

  if (Array.isArray(value)) {
    if (value.length > 10) return `«${value.length} items»`;
    return value.map((v) => redact(v, key, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    let n = 0;
    for (const [k, v] of Object.entries(value)) {
      if (n++ >= MAX_KEYS) {
        out["…"] = `«${Object.keys(value).length - MAX_KEYS} more fields»`;
        break;
      }
      out[k] = redact(v, k, depth + 1);
    }
    return out;
  }
  return elide(value);
}

/* ---------------- what a call was about ---------------- */

// The one identifier a person would use to find the thing again. Ordered:
// the first match wins, so a post is reported by its slug rather than by the
// accountId that happened to come along with it.
const TARGET_KEYS = [
  "slug", "id", "postId", "videoId", "mediaId", "taskId", "commentId",
  "name", "key", "path", "repo", "title", "secretName",
  "accountId", "provider", "source", "section", "collection",
];

export function targetOf(args) {
  if (!args || typeof args !== "object") return "";
  for (const k of TARGET_KEYS) {
    const v = args[k];
    if (typeof v === "string" && v.trim()) return v.slice(0, 80);
    if (typeof v === "number") return String(v);
  }
  return "";
}

// A sentence a person reads, not a dump. The arguments are already redacted
// before they reach here.
export function describeCall(name, safeArgs) {
  const parts = [];
  for (const [k, v] of Object.entries(safeArgs || {})) {
    if (v === undefined || v === null || v === "") continue;
    const printed =
      typeof v === "string" || typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : elide(v);
    parts.push(`${k}=${printed}`);
    if (parts.length >= 6) break;
  }
  const line = parts.join(" ");
  return line.length > 300 ? line.slice(0, 300) + "…" : line;
}

/* ---------------- the entry ---------------- */

// Built in one place so every field is always present. A log whose rows have
// different shapes depending on which path wrote them cannot be filtered.
export function shapeEntry({
  action,
  kind = "write",
  source = "mcp",
  target = "",
  detail = "",
  ok = true,
  error = "",
  ms = null,
  actor = {},
  at = new Date().toISOString(),
}) {
  return {
    action: String(action || "unknown"),
    kind: kind === "read" ? "read" : "write",
    source: String(source || "mcp"),
    target: String(target || "").slice(0, 80),
    detail: String(detail || "").slice(0, 300),
    ok: !!ok,
    error: String(error || "").slice(0, 200),
    ms: typeof ms === "number" && Number.isFinite(ms) ? Math.round(ms) : null,
    // WHICH token, never the token. `jti` is the opaque id the revocation list
    // already uses, and the label is what the owner typed when minting it.
    tokenId: String(actor.jti || "").slice(0, 64),
    tokenLabel: String(actor.label || "").slice(0, 60),
    email: String(actor.email || "").slice(0, 120),
    at,
  };
}

/* ---------------- writing ---------------- */

// Returns nothing and throws nothing — rule 1. Callers do not await a result
// they cannot act on, but they SHOULD await the promise so a serverless
// function is not torn down mid-write.
export async function recordActivity(idToken, entry) {
  try {
    await createDocument(idToken, ACTIVITY_COLLECTION, null, shapeEntry(entry));
  } catch {
    /* deliberately silent — see rule 1 */
  }
}

// Record one MCP tool call. The dispatcher calls exactly this, so a tool
// added tomorrow is logged without anyone remembering to do anything.
export async function recordToolCall(idToken, { tool, args, claims, ok, error, ms }) {
  if (!tool || NEVER_LOGGED.has(tool.name)) return;
  const kind = tool.scope === "read" ? "read" : "write";
  if (kind === "read" && !LOG_READS) return;

  const safe = redact(args || {});
  await recordActivity(idToken, {
    action: `mcp.${tool.name}`,
    kind,
    source: "mcp",
    target: targetOf(args),
    detail: describeCall(tool.name, safe),
    ok,
    error,
    ms,
    actor: { jti: claims?.jti, label: claims?.label, email: claims?.email },
  });
}

/* ---------------- reading ---------------- */

// Pure, so every filter is tested without a network.
export function matchesFilter(row, f = {}) {
  if (!row) return false;
  if (f.kind && row.kind !== f.kind) return false;
  if (f.source && row.source !== f.source) return false;
  if (f.okOnly && !row.ok) return false;
  if (f.failedOnly && row.ok) return false;
  if (f.action && !String(row.action || "").includes(f.action)) return false;
  if (f.since && String(row.at || "") < f.since) return false;
  if (f.until && String(row.at || "") > f.until) return false;
  if (f.q) {
    // Every word must appear, so two words narrow rather than widen — the
    // same rule as the note search and the tasks board lens.
    const hay = `${row.action} ${row.target} ${row.detail} ${row.tokenLabel} ${row.email}`.toLowerCase();
    const words = String(f.q).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

export const byNewest = (a, b) => String(b.at || "").localeCompare(String(a.at || ""));

// Entries written before this module existed carry {action, target, detail,
// email, at} and nothing else. Defaulting `kind` to "write" is what keeps them
// visible: the viewer hides reads by default, and an undefined kind is not
// "write", so without this every historical entry would vanish from the
// default view the moment the filter was added. A log that silently drops its
// own history is worse than one with no filter at all.
export function normaliseRow(r = {}) {
  return {
    ...r,
    kind: r.kind === "read" ? "read" : "write",
    source: r.source || "admin",
    ok: r.ok === undefined ? true : !!r.ok,
    target: r.target || "",
    detail: r.detail || "",
    // Three API routes each kept their own audit helper and all three wrote
    // `actor` where the browser wrote `email`. Unified now, but the rows
    // already in the collection still say `actor`, and dropping them would
    // make every env, secret and account change in the history read as
    // "unknown".
    email: r.email || r.actor || "",
    at: r.at || "",
  };
}

// What happened, grouped — the answer to "what did that agent actually do",
// which a list of 300 rows does not give you.
export function summarise(rows = []) {
  const counts = {};
  const failures = [];
  const actors = {};
  let reads = 0;
  let writes = 0;
  let first = "";
  let last = "";

  for (const r of rows) {
    counts[r.action] = (counts[r.action] || 0) + 1;
    if (r.kind === "read") reads++;
    else writes++;
    if (!r.ok) failures.push({ at: r.at, action: r.action, target: r.target, error: r.error });
    const who = r.tokenLabel || r.email || r.source || "unknown";
    actors[who] = (actors[who] || 0) + 1;
    const at = String(r.at || "");
    if (at && (!first || at < first)) first = at;
    if (at && (!last || at > last)) last = at;
  }

  return {
    entries: rows.length,
    writes,
    reads,
    failed: failures.length,
    from: first,
    to: last,
    byAction: Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([action, count]) => ({ action, count })),
    byActor: Object.entries(actors)
      .sort((a, b) => b[1] - a[1])
      .map(([actor, count]) => ({ actor, count })),
    failures: failures.slice(0, 20),
  };
}

// Firestore cannot sort this collection without a composite index per filter
// combination, and there are too many combinations to deploy. At the scale of
// an audit log for one person, reading a page and filtering in JS is the right
// trade — the same call as the LinkedIn post history and the unified search.
export async function readActivity(idToken, { pageSize = 400 } = {}) {
  const rows = await listDocuments(idToken, ACTIVITY_COLLECTION, {
    pageSize: Math.min(1000, Math.max(1, pageSize)),
  });
  return rows.map(normaliseRow).sort(byNewest);
}
