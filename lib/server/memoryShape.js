// PURE. What a memory IS, how two are compared and how a set is ranked — no
// I/O and no node built-ins, because the Memory panel imports this file too
// (it shows the same kinds, the same refusals and the same ranking the server
// uses, and two copies of a rule drift within an hour).
//
// WHAT A MEMORY IS
// ----------------
// ONE durable fact the owner would otherwise have to repeat to every new
// conversation: how they like things done, a decision and why it was made,
// what failed last time. Not a transcript and not a note — a note is something
// written to be read; a memory is something an agent should already know before
// it starts.
//
// TWO LAYERS, AND THE RULE THAT MATTERS
// -------------------------------------
//   global   the owner — true in every org ("never use the purple gradient").
//   org      true inside ONE org ("Acme's channel posts on Fridays").
// Recall returns the current org's memories PLUS the global ones, and never
// another org's. An Acme fact surfacing while working for Relax is the same
// class of mistake as posting with the wrong account, so `visibleIn` is the
// one predicate every read path goes through.
//
// NO EMBEDDINGS, ON PURPOSE
// -------------------------
// The owner chose not to pay for a vector store. At the scale of one person's
// memory (hundreds, not millions) a token scorer is honest and explainable —
// a result can say WHY it ranked — and it costs nothing to run.
import { DEFAULT_ORG, isOrgId } from "./orgShape.js";

export const COLLECTION = "memories";

// Each kind carries the sentence a model reads when deciding which to use, so
// the guide, the tool schema and the panel describe a kind the same way.
export const KIND_INFO = {
  preference: "How the owner likes things done — tone, tools, formats, things to avoid.",
  fact: "Something true about the owner, an org or a business that does not change often.",
  decision: "A choice that was made, WITH the reason, so it is not re-litigated.",
  lesson: "What failed or worked last time, so it is not repeated or is repeated on purpose.",
  project: "Ongoing work and where it stands.",
  person: "Someone the owner works with — who they are and how to deal with them.",
  reference: "Where something lives: a URL, a repo, a document, a resource.",
};
export const KINDS = Object.keys(KIND_INFO);
export const SCOPES = ["global", "org"];

export const MAX_TEXT = 1000;
export const MAX_TAGS = 12;
// Near-identical, not merely related. 0.8 of normalised tokens shared means a
// rephrasing of the same sentence; anything lower is a different memory.
export const DEDUPE_THRESHOLD = 0.8;
export const DEFAULT_CONFIDENCE = 0.7;
// Recency half-life. Old memories fade in rank, never out of it: a preference
// set a year ago is still a preference.
const HALF_LIFE_DAYS = 90;

export class MemoryError extends Error {
  constructor(message, code = "memory/bad-input", status = 400, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

const str = (v) => (v === undefined || v === null ? "" : String(v));

/* ------------------------------------------------------------------ *
 * Text                                                                *
 * ------------------------------------------------------------------ */

// Words that carry no meaning about WHICH memory a sentence is. Without this,
// "the owner likes the dark theme" and "the owner likes the light theme" share
// most of their tokens and would be merged as duplicates.
const STOP = new Set(
  "a an and are as at be been but by can do does for from has have he her his i if in into is it its me my of on or our she so than that the their them then there these they this to too us was we were what when which who will with you your".split(
    " "
  )
);

export function normaliseText(text) {
  return str(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// A crude plural fold ("posts" ≈ "post") — enough that a rephrasing is still
// recognised as one, and cheap enough to explain.
const fold = (w) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);

export function tokensOf(text) {
  const out = new Set();
  for (const w of normaliseText(text).split(" ")) {
    if (!w || STOP.has(w)) continue;
    out.add(fold(w));
  }
  return out;
}

// Token Jaccard: |A ∩ B| / |A ∪ B|. Two empty sets are NOT similar — a memory
// made of stop words must not swallow every other one.
export function similarity(a, b) {
  const A = a instanceof Set ? a : tokensOf(a);
  const B = b instanceof Set ? b : tokensOf(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const t of A) if (B.has(t)) both++;
  return both / (A.size + B.size - both);
}

/* ------------------------------------------------------------------ *
 * The secret refusal                                                  *
 * ------------------------------------------------------------------ */

// Memory is unencrypted, readable by every token with `read`, and recalled
// into prompts on purpose. A credential that lands here is a credential handed
// to every agent and printed into transcripts — so it is refused at the door,
// with the place it should go instead.
//
// The activity log redacts by KEY name because it sees structured arguments.
// A memory is free text, so this matches the VALUE: the fixed prefixes real
// credentials carry, private-key armour, JWTs, a password stated in a
// sentence, and a long mixed-case-and-digit run that reads like a key.
const PREFIXES = [
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/, "an Anthropic API key"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/, "an OpenAI-style API key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, "a GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, "a GitHub token"],
  [/\bglpat-[A-Za-z0-9_-]{16,}/, "a GitLab token"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "a Google API key"],
  [/\bya29\.[0-9A-Za-z_-]{20,}/, "a Google access token"],
  [/\bhf_[A-Za-z0-9]{20,}/, "a Hugging Face token"],
  [/\bnpm_[A-Za-z0-9]{30,}/, "an npm token"],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/, "a Stripe key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, "a signed token (JWT)"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]{3,}@/i, "a URL with a password in it"],
];

// Words that follow "password is" in a sentence ABOUT a password rather than
// one CONTAINING it: "the password is stored in the secret store".
const NOT_A_VALUE = new Set(
  "stored kept saved in on at the a an not never rotated managed held set changed required needed missing same different secret secrets vault there here hidden encrypted sealed".split(
    " "
  )
);

export function looksSecret(text) {
  const s = str(text);
  for (const [re, what] of PREFIXES) if (re.test(s)) return { secret: true, reason: what };

  // A password stated in a sentence. Any single non-filler word after the
  // verb counts, because a real password needs no digits to be a password.
  const pw = /\b(?:password|passwd|pwd|passphrase|pin)\b\s*(?:is|was|=|:|->)\s*["'`]?([^\s"'`,;]+)/i.exec(s);
  if (pw && !NOT_A_VALUE.has(pw[1].toLowerCase()) && pw[1].length >= 4) {
    return { secret: true, reason: "a password" };
  }

  // A key or token stated in a sentence — here the value must also LOOK like
  // one, or "the token is short-lived" would be refused.
  const kv = /\b(?:api[ _-]?key|secret|token|client[ _-]?secret|access[ _-]?key|private[ _-]?key)\b\s*(?:is|was|=|:|->)\s*["'`]?([A-Za-z0-9_\-./+=]{16,})/i.exec(s);
  if (kv) return { secret: true, reason: "a key or token" };

  // A query string naming a credential: ?token=…, &api_key=…
  if (/[?&](?:token|access_token|api_?key|key|secret|sig|signature|password)=[^&\s]{12,}/i.test(s)) {
    return { secret: true, reason: "a URL carrying a credential" };
  }

  // A bare high-entropy run: long, AND mixing upper, lower and digits. That
  // second condition is what lets a git sha, a UUID or a hex id through (all
  // one case) while catching the base64-ish shape of most keys.
  for (const m of s.match(/[A-Za-z0-9_\-+/=]{32,}/g) || []) {
    if (/[A-Z]/.test(m) && /[a-z]/.test(m) && /[0-9]/.test(m) && !/^https?:/.test(m)) {
      return { secret: true, reason: "a long key-shaped string" };
    }
  }
  return { secret: false, reason: "" };
}

export function assertNotSecret(text) {
  const { secret, reason } = looksSecret(text);
  if (secret) {
    throw new MemoryError(
      `That looks like ${reason}. Memory is not encrypted and is recalled into prompts on purpose, so a credential never goes in it — keep it in the secret store (create_secret) and remember only its NAME.`,
      "memory/secret"
    );
  }
}

/* ------------------------------------------------------------------ *
 * Shape and validation                                                *
 * ------------------------------------------------------------------ */

export function clampConfidence(v, fallback = DEFAULT_CONFIDENCE) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

// Tags are a vocabulary, so they are folded to one spelling: "Dev.to" and
// "devto" splitting one subject across two filters is how tags stop working.
export function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",") : [];
  const out = [];
  for (const t of list) {
    const v = normaliseText(t).replace(/ /g, "-").slice(0, 40);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, MAX_TAGS);
}

export function assertKind(kind) {
  if (!KINDS.includes(kind)) {
    throw new MemoryError(
      `"${str(kind)}" is not a kind of memory. Use one of: ${KINDS.join(", ")}.`,
      "memory/bad-kind",
      400,
      { kinds: KINDS }
    );
  }
  return kind;
}

export function assertScope(scope) {
  if (!SCOPES.includes(scope)) {
    throw new MemoryError(
      `"${str(scope)}" is not a layer. Use "global" (true in every org) or "org" (true in this org only).`,
      "memory/bad-scope"
    );
  }
  return scope;
}

// A stored document to the one shape every caller sees. Documents missing a
// field read as the safest value: no scope means the default org (never
// global — a fact quietly promoted to every org is the leak this guards), no
// confidence means the default, no `archived` means live.
export function memoryShape(doc = {}) {
  const scope = SCOPES.includes(doc.scope) ? doc.scope : "org";
  return {
    id: str(doc.id),
    scope,
    orgId: scope === "global" ? "" : isOrgId(doc.orgId) ? doc.orgId : DEFAULT_ORG,
    kind: KINDS.includes(doc.kind) ? doc.kind : "fact",
    text: str(doc.text),
    tags: cleanTags(doc.tags),
    source: str(doc.source),
    lastSource: str(doc.lastSource),
    context: str(doc.context),
    confidence: clampConfidence(doc.confidence),
    createdAt: str(doc.createdAt),
    updatedAt: str(doc.updatedAt || doc.createdAt),
    lastUsedAt: str(doc.lastUsedAt),
    uses: Number.isFinite(Number(doc.uses)) ? Number(doc.uses) : 0,
    reinforced: Number.isFinite(Number(doc.reinforced)) ? Number(doc.reinforced) : 0,
    supersedes: str(doc.supersedes),
    supersededBy: str(doc.supersededBy),
    archived: doc.archived === true,
    archivedAt: str(doc.archivedAt),
  };
}

// Input from a tool, the panel or a reflection to the fields that get stored.
// `partial` validates only what was given (an update); a full one needs text.
export function validateMemory(input = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || input.text !== undefined) {
    const text = str(input.text).replace(/\s+/g, " ").trim();
    if (!text) throw new MemoryError("A memory needs text — one sentence that is worth knowing next time.", "memory/empty");
    if (text.length > MAX_TEXT) {
      throw new MemoryError(
        `A memory is one fact, not a document: ${text.length} characters is over the ${MAX_TEXT} limit. Split it, or put the long version in notes and remember where it is.`,
        "memory/too-long"
      );
    }
    assertNotSecret(text);
    out.text = text;
  }
  if (!partial || input.kind !== undefined) out.kind = assertKind(input.kind === undefined ? "fact" : input.kind);
  if (!partial || input.scope !== undefined) out.scope = assertScope(input.scope === undefined ? "org" : input.scope);
  if (!partial || input.tags !== undefined) {
    const raw = Array.isArray(input.tags) ? input.tags : typeof input.tags === "string" ? input.tags.split(",") : [];
    if (raw.length > MAX_TAGS) {
      throw new MemoryError(`At most ${MAX_TAGS} tags — ${raw.length} were given.`, "memory/too-many-tags");
    }
    for (const t of raw) assertNotSecret(t);
    out.tags = cleanTags(raw);
  }
  if (!partial || input.confidence !== undefined) out.confidence = clampConfidence(input.confidence);
  if (input.source !== undefined) out.source = str(input.source).slice(0, 120);
  if (input.archived !== undefined) out.archived = input.archived === true;
  return out;
}

/* ------------------------------------------------------------------ *
 * Layers                                                              *
 * ------------------------------------------------------------------ */

// The one predicate. Global is visible everywhere; an org memory only in its
// own org. Everything that reads goes through this.
export const visibleIn = (m, orgId) => m.scope === "global" || m.orgId === (orgId || DEFAULT_ORG);

// Two memories compete for dedupe only on the same layer, the same org and the
// same kind — a decision and a lesson can say similar words and both be right.
const sameShelf = (a, b) => a.scope === b.scope && a.kind === b.kind && (a.scope === "global" || a.orgId === b.orgId);

/* ------------------------------------------------------------------ *
 * Dedupe and merge                                                    *
 * ------------------------------------------------------------------ */

// What `remember` should do with a candidate, given every memory it can see.
// Never decides a CONTRADICTION on its own — telling "the owner now prefers X"
// from "X is preferred" needs judgement, so superseding is an explicit act of
// the caller (`supersedes: id`), not a guess here.
//
// Jaccard alone cannot see that. "Always run npm test before pushing a branch
// of the relax portfolio repo" and "Never run…" score 0.82, and an update
// would have overwritten the owner's rule with its opposite at HIGHER
// confidence. So a near match is only merged when the difference is a
// refinement — words added or dropped — never when one side says something the
// other contradicts: a polarity word, a number, or a SWAP (each side holds a
// word the other lacks: Friday for Monday, one account for another). Those
// come back as `create` with `nearest` and `conflict`, so the caller decides
// whether to supersede.
const POLARITY = new Set(
  "not no never always don doesn didn won isn aren wasn weren shouldn cannot cant without avoid stop only except nor neither none".split(" ")
);

export function contradicts(a, b) {
  const A = a instanceof Set ? a : tokensOf(a);
  const B = b instanceof Set ? b : tokensOf(b);
  const onlyA = [...A].filter((t) => !B.has(t));
  const onlyB = [...B].filter((t) => !A.has(t));
  const diff = [...onlyA, ...onlyB];
  if (diff.some((t) => POLARITY.has(t) || /\d/.test(t))) return true;
  return onlyA.length > 0 && onlyB.length > 0;
}

export function dedupeDecision(candidate, existing = []) {
  const toks = tokensOf(candidate.text);
  let best = null;
  let conflict = null;
  for (const m of existing) {
    if (m.archived || !sameShelf(m, candidate)) continue;
    const other = tokensOf(m.text);
    const s = similarity(toks, other);
    if (s >= DEDUPE_THRESHOLD && contradicts(toks, other)) {
      if (!conflict || s > conflict.similarity) conflict = { target: m, similarity: s };
      continue;
    }
    if (!best || s > best.similarity) best = { target: m, similarity: s };
  }
  if (best && best.similarity >= DEDUPE_THRESHOLD) {
    return { action: "update", target: best.target, similarity: round2(best.similarity) };
  }
  if (conflict) {
    return {
      action: "create",
      nearest: { id: conflict.target.id, similarity: round2(conflict.similarity) },
      conflict: {
        id: conflict.target.id,
        text: conflict.target.text,
        note: "This reads like it CONTRADICTS an existing memory rather than repeating it, so both are kept. If the new one replaces the old, call again with supersedes set to that id.",
      },
    };
  }
  return { action: "create", nearest: best && best.similarity > 0 ? { id: best.target.id, similarity: round2(best.similarity) } : null };
}

const round2 = (n) => Math.round(n * 100) / 100;

// Hearing the same thing again is evidence: confidence climbs a quarter of the
// way to certain, never past it. The newer phrasing wins (it is how the fact is
// said NOW); the original source is kept, so a wrong memory can still be
// traced to where it was first learned.
export function mergeMemory(existing, candidate, now = new Date().toISOString()) {
  const top = Math.max(existing.confidence, clampConfidence(candidate.confidence, existing.confidence));
  return {
    text: candidate.text || existing.text,
    tags: cleanTags([...existing.tags, ...(candidate.tags || [])]),
    confidence: round2(Math.min(1, top + (1 - top) * 0.25)),
    lastSource: str(candidate.source || ""),
    reinforced: (existing.reinforced || 0) + 1,
    updatedAt: now,
  };
}

/* ------------------------------------------------------------------ *
 * Ranking                                                             *
 * ------------------------------------------------------------------ */

const DAY = 86400000;

export function recencyFactor(m, now = Date.now()) {
  const t = Date.parse(m.lastUsedAt || m.updatedAt || m.createdAt || "");
  if (!Number.isFinite(t)) return 0.5;
  const ageDays = Math.max(0, (Number(now) - t) / DAY);
  return round3(0.5 + 0.5 * Math.pow(0.5, ageDays / HALF_LIFE_DAYS));
}
const round3 = (n) => Math.round(n * 1000) / 1000;

// Kinds that are about the owner's way of working apply to almost any task, so
// recall keeps them in view even when no word matches — the point of a
// preference is that nobody thought to ask for it.
const AMBIENT = new Set(["preference", "lesson"]);

const termsOf = (query) => [...tokensOf(query)];

// How well ONE memory answers a query.
//   mode "all"  (search): every term must appear in text or tags, or null.
//   mode "any"  (recall): a task is a sentence, so the share of its terms that
//                appear; ambient kinds keep a floor when nothing matched.
// Returns null when the memory should not be shown at all.
export function scoreMemory(m, query, { mode = "all", now = Date.now() } = {}) {
  const terms = Array.isArray(query) ? query : termsOf(query);
  const base = m.confidence * recencyFactor(m, now);
  if (!terms.length) return round3(base);

  const words = tokensOf(m.text);
  const text = normaliseText(m.text);
  const tags = m.tags.map((t) => t.replace(/-/g, " "));
  let hits = 0;
  let weight = 0;
  for (const t of terms) {
    const inTag = tags.some((x) => x === t || x.split(" ").includes(t));
    const exact = words.has(t);
    const partial = !exact && t.length >= 3 && text.includes(t);
    if (!inTag && !exact && !partial) {
      if (mode === "all") return null;
      continue;
    }
    hits++;
    weight += (inTag ? 3 : 0) + (exact ? 2 : partial ? 1 : 0);
  }
  if (mode === "all") return round3((weight / terms.length) * base);
  if (!hits) return AMBIENT.has(m.kind) ? round3(0.15 * base) : null;
  return round3((hits / terms.length) * (1 + weight / terms.length) * base);
}

// The ranked list every reader returns. Filters first (kind, tag, archived),
// then score, then the tie-breaks a person would use: more confident, then
// more recently touched.
export function rankMemories(memories, query = "", { mode = "all", kinds, tags, limit = 20, includeArchived = false, now = Date.now() } = {}) {
  const kindSet = kinds && kinds.length ? new Set(kinds) : null;
  const tagList = tags && tags.length ? cleanTags(tags) : null;
  const terms = termsOf(query);
  const out = [];
  for (const m of memories) {
    if (m.archived && !includeArchived) continue;
    if (kindSet && !kindSet.has(m.kind)) continue;
    if (tagList && !tagList.every((t) => m.tags.includes(t))) continue;
    const score = scoreMemory(m, terms, { mode, now });
    if (score === null) continue;
    out.push({ ...m, score });
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      b.confidence - a.confidence ||
      String(b.updatedAt).localeCompare(String(a.updatedAt))
  );
  return out.slice(0, Math.max(1, Math.min(200, Number(limit) || 20)));
}

// Validates a kinds filter so an unknown kind is refused WITH the list rather
// than quietly matching nothing.
export function cleanKinds(kinds) {
  if (kinds === undefined || kinds === null || kinds === "") return [];
  const list = Array.isArray(kinds) ? kinds : String(kinds).split(",");
  return list.map((k) => assertKind(String(k).trim()));
}

// A one-line summary for the panel and the recall preamble.
export function describeLayers(memories) {
  const g = memories.filter((m) => m.scope === "global").length;
  return { global: g, org: memories.length - g };
}
