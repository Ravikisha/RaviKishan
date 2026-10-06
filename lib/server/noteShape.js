// What a note IS here, independent of where it lives.
//
// PURE — no imports, no network, no node APIs — because six places need it (the
// local store, the Notion adapter, the Trello adapter, the Obsidian/Git
// adapter, the MCP tools and the admin panel). The GitHub work already proved
// what happens otherwise: two copies of one function drifted inside an hour. It
// lives in lib/server because that is the one folder marked ESM, so plain node
// can import it without a bundler, which is what makes it testable.
//
// The shape is the lowest common denominator of four very different services,
// and each field exists because every source can answer it honestly:
//
//   id          opaque and source-specific. Never parsed, only handed back.
//   title       Trello calls it a card name, Notion a page title, Obsidian the
//               filename. One word for all of them.
//   body        Markdown. Trello card descriptions are Markdown, Obsidian files
//               are Markdown, Notion is blocks (converted), local is Markdown.
//   tags        Notion multi-selects, Trello labels, Obsidian #tags, local tags.
//   container   what a note sits IN: a Notion database, a Trello list, an
//               Obsidian folder, a local notebook. Flat sources report "".
//   updatedAt   ISO 8601, always UTC. Sorting notes from two services by a
//               local-time string interleaves them wrongly and silently.
//
// Anything a source cannot do is DECLARED in its capabilities rather than
// faked, so a caller is told "Trello labels are board-wide, not free text"
// instead of discovering it by losing a tag.

export const NOTE_FIELDS = ["title", "body", "tags", "container", "pinned", "archived"];

// Firestore documents stop at 1 MiB and Notion rejects a rich-text run over
// 2000 characters; 100k is well under both and already longer than anything
// written by hand in one note.
export const MAX_BODY = 100_000;
export const MAX_TITLE = 300;
export const MAX_TAGS = 30;

export class NoteError extends Error {}

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

// One ISO-8601 UTC string, whatever the source handed over: Trello and Notion
// return ISO strings, Firestore REST returns a timestampValue, and a file-backed
// note has only a commit date.
export function toIso(v) {
  if (!v) return "";
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? "" : new Date(t).toISOString();
  }
  if (typeof v === "number") return new Date(v).toISOString();
  if (v instanceof Date) return Number.isNaN(Number(v)) ? "" : v.toISOString();
  if (typeof v === "object") {
    if (typeof v.timestampValue === "string") return toIso(v.timestampValue);
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000).toISOString();
  }
  return "";
}

// Tags de-duplicate case-insensitively while keeping the first spelling seen:
// "Systems" and "systems" are one subject split across two filters, which is
// exactly what the blog's list_tags reports as nearDuplicates.
export function cleanTags(tags) {
  if (!tags) return [];
  const list = Array.isArray(tags) ? tags : str(tags).split(",");
  const seen = new Map();
  for (const raw of list) {
    const t = str(raw).trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (!seen.has(key)) seen.set(key, t);
  }
  return [...seen.values()].slice(0, MAX_TAGS);
}

// The normalised note every adapter returns and every caller receives.
export function shapeNote(raw, { source } = {}) {
  return {
    id: str(raw.id),
    source: source || str(raw.source) || "local",
    title: str(raw.title).slice(0, MAX_TITLE),
    body: str(raw.body),
    tags: cleanTags(raw.tags),
    container: str(raw.container),
    containerName: str(raw.containerName),
    pinned: !!raw.pinned,
    archived: !!raw.archived,
    createdAt: toIso(raw.createdAt),
    updatedAt: toIso(raw.updatedAt),
    url: str(raw.url),
    // True when the source will not accept a write for this note — a Trello
    // card on a closed board, a Notion page in a database the integration was
    // never shared with. The panel disables editing rather than letting a save
    // fail after the fact.
    readOnly: !!raw.readOnly,
  };
}

// Refuses before any network call, so a bad write fails on its own terms
// rather than coming back as a provider's opaque validation error.
export function validatePatch(patch, { capabilities = {}, creating = false } = {}) {
  if (!patch || typeof patch !== "object") throw new NoteError("Nothing to write.");

  const given = NOTE_FIELDS.filter((f) => patch[f] !== undefined);
  if (!given.length) throw new NoteError(`Nothing to change — pass one of ${NOTE_FIELDS.join(", ")}.`);

  if (creating && !str(patch.title).trim() && !str(patch.body).trim()) {
    throw new NoteError("A note needs a title or a body.");
  }
  if (patch.title !== undefined && str(patch.title).length > MAX_TITLE) {
    throw new NoteError(
      `A title is capped at ${MAX_TITLE} characters; that one is ${str(patch.title).length}.`
    );
  }
  if (patch.body !== undefined && str(patch.body).length > MAX_BODY) {
    throw new NoteError(
      `A note body is capped at ${MAX_BODY} characters here; that one is ${str(patch.body).length}.`
    );
  }
  if (patch.tags !== undefined && capabilities.tags === false) {
    throw new NoteError("This source has no tags. Put the keyword in the body instead.");
  }
  if (patch.container !== undefined && capabilities.containers === false) {
    throw new NoteError("This source is flat — it has no notebooks to move a note between.");
  }
  if (patch.pinned !== undefined && capabilities.pinned === false) {
    throw new NoteError("This source cannot pin a note.");
  }
  if (patch.archived !== undefined && capabilities.archive === false) {
    throw new NoteError("This source cannot archive a note; delete it or move it instead.");
  }
  return given;
}

// First meaningful line, for a list row. Deliberately NOT the first 160
// characters: a note opening with a heading or a code fence would show "###"
// and nothing else — the same bug create_post's excerpt generator had.
export function excerptOf(body, max = 160) {
  const text = str(body)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^---[\s\S]*?^---/m, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// A note's own title, when the source does not store one. Obsidian uses the
// filename; a local note pasted in as a wall of text has neither, so the first
// heading or first line stands in.
export function titleFrom(body, fallback = "Untitled") {
  const heading = /^\s{0,3}#{1,6}\s+(.+)$/m.exec(str(body));
  if (heading) return heading[1].trim().slice(0, MAX_TITLE);
  const first = excerptOf(body, MAX_TITLE);
  return first ? first.slice(0, 80) : fallback;
}

// Search across sources, in memory. There is no cross-service search endpoint
// and there never will be, so the honest options are "search one service at a
// time" or "load and filter" — and at the scale of a personal note collection
// the second is both simpler and better. Same reasoning as the admin's unified
// search over Firestore collections.
//
// SCORED, not filtered: a word in the title almost always means the note is
// about that, and a word in a tag nearly as much. A plain substring filter puts
// a passing mention above the note actually named for the term.
export function searchNotes(notes, query, { limit = 50 } = {}) {
  const q = str(query).trim().toLowerCase();
  if (q.length < 2) throw new NoteError("Give at least two characters to search for.");
  const terms = q.split(/\s+/).filter(Boolean);

  const scored = [];
  for (const n of notes) {
    const title = str(n.title).toLowerCase();
    const body = str(n.body).toLowerCase();
    const tags = (n.tags || []).map((t) => String(t).toLowerCase());

    let score = 0;
    let missed = false;
    for (const t of terms) {
      const inTitle = title.includes(t);
      const inTag = tags.some((x) => x.includes(t));
      const inBody = body.includes(t);
      if (!inTitle && !inTag && !inBody) {
        missed = true;
        break;
      }
      if (inTitle) score += title === t ? 12 : 6;
      if (inTag) score += 4;
      if (inBody) score += 1;
    }
    // Every term must appear somewhere: two words should NARROW the result,
    // not widen it, which is what an any-term match would do.
    if (missed) continue;
    if (n.archived) score -= 2;
    scored.push({ note: n, score });
  }

  scored.sort(
    (a, b) => b.score - a.score || String(b.note.updatedAt).localeCompare(String(a.note.updatedAt))
  );
  return scored.slice(0, limit).map((s) => ({ ...s.note, score: s.score }));
}

// One ordering, used by every source, so the list does not reshuffle its logic
// when you switch between them: pinned first, archived last, newest within each.
export function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    if (!!a.archived !== !!b.archived) return a.archived ? 1 : -1;
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
}

/* ---------------- Obsidian front matter ---------------- */

// An Obsidian note is a Markdown file whose metadata lives in YAML front
// matter. Parsed by hand rather than with a YAML dependency, because exactly
// three keys matter and a full YAML parser would accept documents this writer
// could never produce — a round trip that silently rewrites someone's vault is
// worse than one that refuses.
export function parseFrontMatter(text) {
  const src = str(text);
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { meta: {}, body: src };

  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();
    if (/^\[.*\]$/.test(value)) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((x) => x.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }
    meta[key] = value;
  }
  // Strip the blank line that conventionally follows the closing fence, so a
  // body does not begin with whitespace that then grows by one line on every
  // read-write cycle.
  return { meta, body: src.slice(m[0].length).replace(/^\r?\n+/, "") };
}

export function withFrontMatter({ tags = [], pinned = false, extra = {} } = {}, body = "") {
  const lines = [];
  if (tags.length) lines.push(`tags: [${cleanTags(tags).join(", ")}]`);
  if (pinned) lines.push("pinned: true");
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === "") continue;
    lines.push(`${k}: ${v}`);
  }
  if (!lines.length) return str(body);
  return `---\n${lines.join("\n")}\n---\n\n${str(body).replace(/^\n+/, "")}`;
}

// A vault path is a file path, and a note title is arbitrary text. Anything
// that could escape the vault root or break a filesystem is removed here
// rather than at the adapter, so every caller gets the same rule.
export function vaultPath(title, { folder = "" } = {}) {
  const name = str(title)
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\.+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (!name) throw new NoteError("That title has no usable characters for a filename.");
  const dir = str(folder)
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .join("/");
  return `${dir ? `${dir}/` : ""}${name}.md`;
}
