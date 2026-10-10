// SERVER ONLY. Memory: what the owner has taught the agents, filed so the next
// conversation starts already knowing it.
//
// Firestore `memories/{id}`, read and written over REST AS THE SIGNED-IN USER
// like every other store here — the collection is admin-only in
// firestore.rules, so the rules stay the boundary and there is no service
// account to bypass them. The rules of what a memory is, how two are compared
// and how a set is ranked live in memoryShape.js (pure, shared with the panel).
//
// THE ORG IS NEVER A PARAMETER
// ----------------------------
// Which org a call acts in comes from currentOrg() — set once at the edge by
// withEnv or the MCP dispatcher — exactly like the account directory. A store
// function that took an `orgId` argument would be one more place to forget it,
// and the one forgotten would read another org's memories.
//
// EVERY READ IS STRICT
// --------------------
// listEveryDocument, never a catch that turns a refused read into an empty
// list. Recall that silently answers "nothing remembered" is worse than an
// error: the agent then proceeds as if it had been told nothing, and the owner
// repeats himself without knowing why.
import crypto from "crypto";
import { createDocument, deleteDocument, getDocument, listEveryDocument, patchDocument } from "./firestoreRest.js";
import { currentOrg, ensureOrgKnown } from "./orgContext.js";
import {
  COLLECTION,
  KINDS,
  MemoryError,
  assertNotSecret,
  cleanKinds,
  cleanTags,
  dedupeDecision,
  describeLayers,
  memoryShape,
  mergeMemory,
  normaliseText,
  rankMemories,
  validateMemory,
  visibleIn,
} from "./memoryShape.js";

export { COLLECTION, KINDS, MemoryError };

// Big enough to be useful in a prompt, small enough not to drown it.
export const RECALL_DEFAULT = 8;
export const RECALL_MAX = 30;
// A reflection is a handful of learnings, not a transcript re-filed line by line.
export const REFLECT_MAX = 25;

const newId = () => `m_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------------ *
 * Reading                                                             *
 * ------------------------------------------------------------------ */

// Every memory THIS org can see: its own plus the global layer. Never another
// org's — that filter is applied here, before anything is ranked or returned.
async function visibleMemories(idToken) {
  const org = currentOrg();
  const rows = await listEveryDocument(idToken, COLLECTION);
  return rows.map((r) => memoryShape(r)).filter((m) => visibleIn(m, org));
}

// One memory by id, refused when it belongs to another org. The refusal reads
// exactly like "no such memory": confirming that an id exists elsewhere would
// leak the other org's memory through its error message.
export async function getMemory(idToken, id) {
  const key = String(id || "").trim();
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(key)) {
    throw new MemoryError(`"${key}" is not a memory id.`, "memory/bad-id");
  }
  const doc = await getDocument(idToken, `${COLLECTION}/${key}`);
  const m = doc ? memoryShape({ ...doc, id: key }) : null;
  if (!m || !visibleIn(m, currentOrg())) {
    throw new MemoryError(`There is no memory "${key}" in this org.`, "memory/not-found", 404);
  }
  return m;
}

// `layer`: "all" (this org + global), "global", or "org" (this org only).
function byLayer(memories, layer = "all") {
  if (!layer || layer === "all") return memories;
  if (layer === "global") return memories.filter((m) => m.scope === "global");
  if (layer === "org") return memories.filter((m) => m.scope === "org");
  throw new MemoryError(`"${layer}" is not a layer. Use all, global or org.`, "memory/bad-scope");
}

export async function listMemories(idToken, { layer = "all", kinds, tags, includeArchived = false, limit = 100 } = {}) {
  const kindList = cleanKinds(kinds);
  const tagList = cleanTags(tags);
  const all = byLayer(await visibleMemories(idToken), layer);
  const rows = all
    .filter((m) => includeArchived || !m.archived)
    .filter((m) => !kindList.length || kindList.includes(m.kind))
    .filter((m) => !tagList.length || tagList.every((t) => m.tags.includes(t)))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const cap = Math.max(1, Math.min(500, Number(limit) || 100));
  return {
    orgId: currentOrg(),
    memories: rows.slice(0, cap),
    total: rows.length,
    truncated: rows.length > cap,
    layers: describeLayers(rows),
    tags: tagVocabulary(all),
  };
}

// The tags in use, most used first — so a new memory reuses "linkedin" rather
// than inventing "linked-in".
function tagVocabulary(memories) {
  const n = new Map();
  for (const m of memories) if (!m.archived) for (const t of m.tags) n.set(t, (n.get(t) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
}

// Every word must match — a search narrows. Does NOT count as a use: looking
// something up in the panel is not an agent relying on it.
export async function searchMemories(idToken, { query, layer = "all", kinds, tags, includeArchived = false, limit = 20 } = {}) {
  const q = normaliseText(query);
  if (q.length < 2) throw new MemoryError("Give at least two characters to search for.", "memory/bad-query");
  const pool = byLayer(await visibleMemories(idToken), layer);
  const memories = rankMemories(pool, q, { mode: "all", kinds: cleanKinds(kinds), tags, includeArchived, limit });
  return { orgId: currentOrg(), query: String(query), memories, total: memories.length };
}

// What an agent should know before it starts on `task`. The current org's
// memories plus the global layer, ranked by match × confidence × recency, with
// preferences and lessons kept in view even when no word matches.
//
// Recall COUNTS as a use: `uses` and `lastUsedAt` are how a stale memory is
// found later. A bump that fails is REPORTED (bumpFailed), not swallowed and
// not fatal — the agent still gets what it asked for, and the result says the
// counters are behind.
export async function recall(idToken, { task = "", limit = RECALL_DEFAULT, kinds, tags, now = Date.now() } = {}) {
  await ensureOrgKnown(idToken);
  const cap = Math.max(1, Math.min(RECALL_MAX, Number(limit) || RECALL_DEFAULT));
  const pool = await visibleMemories(idToken);
  const memories = rankMemories(pool, task, { mode: "any", kinds: cleanKinds(kinds), tags, limit: cap, now });

  const stamp = new Date(now).toISOString();
  const bumpFailed = [];
  await Promise.all(
    memories.map(async (m) => {
      try {
        await patchDocument(idToken, `${COLLECTION}/${m.id}`, { uses: m.uses + 1, lastUsedAt: stamp });
        m.uses += 1;
        m.lastUsedAt = stamp;
      } catch (e) {
        bumpFailed.push({ id: m.id, error: e.message });
      }
    })
  );

  return {
    orgId: currentOrg(),
    task: String(task || ""),
    memories,
    considered: pool.filter((m) => !m.archived).length,
    layers: describeLayers(memories),
    ...(bumpFailed.length ? { bumpFailed } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Writing                                                             *
 * ------------------------------------------------------------------ */

// File one memory. Three outcomes, and the result says which:
//   created     nothing like it existed
//   updated     a near-identical memory on the same layer and kind existed;
//               it was reinforced (confidence up, tags merged) rather than
//               duplicated
//   superseded  the caller named the memory this one REPLACES; the old one is
//               archived with a pointer forward, never overwritten, so a
//               contradiction keeps its history
// The org is the current one; an `orgId` different from it is refused rather
// than honoured, because filing into an org you are not acting in is how a
// fact ends up somewhere it will never be recalled.
export async function remember(idToken, input = {}, { now = nowIso() } = {}) {
  const org = await ensureOrgKnown(idToken);
  if (input.orgId && input.orgId !== org) {
    throw new MemoryError(
      `This call is acting in "${org}", not "${input.orgId}". Act in that org (orgId on the call) to file a memory there.`,
      "memory/other-org"
    );
  }
  const fields = validateMemory(input);
  const candidate = {
    ...fields,
    orgId: fields.scope === "global" ? "" : org,
    source: fields.source || "admin",
  };
  const context = String(input.context || "").replace(/\s+/g, " ").trim().slice(0, 240);
  // The context travels with the memory into every recall and listing, so it
  // is held to the same refusal as the text. Checked on what is STORED (the
  // first 240 characters) — a secret past the cut never lands.
  assertNotSecret(context);

  if (input.supersedes) {
    const old = await getMemory(idToken, input.supersedes);
    if (old.archived) {
      throw new MemoryError(
        `Memory "${old.id}" is already archived${old.supersededBy ? ` (superseded by ${old.supersededBy})` : ""}. Supersede the current one instead.`,
        "memory/archived"
      );
    }
    const id = newId();
    const record = {
      ...candidate,
      context,
      supersedes: old.id,
      createdAt: now,
      updatedAt: now,
      uses: 0,
      archived: false,
    };
    await createDocument(idToken, COLLECTION, id, record);
    // Written AFTER the new one exists: a failure here leaves two live
    // memories (visible, fixable) rather than none.
    await patchDocument(idToken, `${COLLECTION}/${old.id}`, {
      archived: true,
      archivedAt: now,
      supersededBy: id,
      updatedAt: now,
    });
    return {
      action: "superseded",
      memory: memoryShape({ ...record, id }),
      superseded: { ...old, archived: true, archivedAt: now, supersededBy: id },
    };
  }

  const pool = await visibleMemories(idToken);
  const decision = dedupeDecision(candidate, pool);
  if (decision.action === "update") {
    const patch = mergeMemory(decision.target, candidate, now);
    await patchDocument(idToken, `${COLLECTION}/${decision.target.id}`, patch);
    return {
      action: "updated",
      similarity: decision.similarity,
      memory: memoryShape({ ...decision.target, ...patch }),
    };
  }

  const id = newId();
  const record = { ...candidate, context, createdAt: now, updatedAt: now, uses: 0, archived: false };
  await createDocument(idToken, COLLECTION, id, record);
  return {
    action: "created",
    memory: memoryShape({ ...record, id }),
    ...(decision.nearest ? { nearest: decision.nearest } : {}),
    ...(decision.conflict ? { conflict: decision.conflict } : {}),
  };
}

// Change a memory in place: text, kind, tags, confidence, layer, or bring an
// archived one back (`archived: false`). Moving a memory to the org layer
// files it under the CURRENT org.
export async function updateMemory(idToken, id, patch = {}, { now = nowIso() } = {}) {
  const m = await getMemory(idToken, id);
  const fields = validateMemory(patch, { partial: true });
  delete fields.source;
  if (!Object.keys(fields).length) {
    throw new MemoryError("Nothing to change — give text, kind, tags, confidence, scope or archived.", "memory/empty-update");
  }
  if (fields.scope) fields.orgId = fields.scope === "global" ? "" : currentOrg();
  if (fields.archived === false) {
    fields.archivedAt = "";
  } else if (fields.archived === true && !m.archived) {
    fields.archivedAt = now;
  }
  fields.updatedAt = now;
  await patchDocument(idToken, `${COLLECTION}/${m.id}`, fields);
  return { memory: memoryShape({ ...m, ...fields }) };
}

// Archive by default: an archived memory is never recalled but can be read and
// restored, which is the right default for something an agent filed on its
// own. `confirm: true` deletes the document for good.
export async function forgetMemory(idToken, id, { confirm = false, now = nowIso() } = {}) {
  const m = await getMemory(idToken, id);
  if (confirm === true) {
    await deleteDocument(idToken, `${COLLECTION}/${m.id}`);
    return { action: "deleted", id: m.id, text: m.text, note: "Deleted for good — there is no copy to restore from." };
  }
  if (m.archived) {
    return {
      action: "already-archived",
      id: m.id,
      note: "Already archived. Pass confirm: true to delete it for good.",
    };
  }
  await patchDocument(idToken, `${COLLECTION}/${m.id}`, { archived: true, archivedAt: now, updatedAt: now });
  return {
    action: "archived",
    id: m.id,
    note: "Archived: it will not be recalled. update_memory with archived:false brings it back; confirm:true deletes it for good.",
  };
}

// The "learn from the conversation" step. Each learning is filed through
// `remember`, so it is deduped, refused if it looks like a credential, and
// stamped with where it came from. A refusal of ONE learning never stops the
// rest; it is listed with its reason so the caller can fix and resend it.
//
// A learning is a sentence (filed as a lesson) or { text, kind, tags,
// confidence, scope, supersedes }. The summary is not filed as a memory — it
// is a description of a conversation, not a durable fact — but each memory
// carries the start of it as `context`, so "why does it think that?" has an
// answer.
export async function reflect(idToken, { summary = "", learnings = [], source = "" } = {}, { now = nowIso() } = {}) {
  await ensureOrgKnown(idToken);
  const list = Array.isArray(learnings) ? learnings : [];
  if (!list.length) {
    throw new MemoryError(
      "Nothing to reflect: give learnings as a list of sentences or { text, kind } objects.",
      "memory/empty"
    );
  }
  if (list.length > REFLECT_MAX) {
    throw new MemoryError(
      `${list.length} learnings is more than ${REFLECT_MAX}. Keep the ones that will matter next time.`,
      "memory/too-many"
    );
  }
  const ctx = String(summary || "").replace(/\s+/g, " ").trim().slice(0, 240);
  // Refused for the WHOLE reflection, not per learning: the summary is filed
  // on every one of them, and agentd builds it from the job's task — which is
  // exactly where an owner types "deploy using token …".
  assertNotSecret(ctx);
  const src = String(source || "reflection").slice(0, 120);

  const out = { orgId: currentOrg(), created: [], updated: [], superseded: [], refused: [] };
  // In order, not in parallel: two learnings in one reflection that say the
  // same thing must dedupe against each other, which parallel writes cannot.
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    const item =
      typeof raw === "string"
        ? { text: raw, kind: "lesson" }
        : raw && typeof raw === "object"
          ? { kind: "lesson", ...raw }
          : { text: "" };
    if (item.confidence === undefined) item.confidence = 0.6;
    try {
      const r = await remember(idToken, { ...item, source: item.source || src, context: ctx }, { now });
      if (r.action === "created") out.created.push(r.memory);
      else if (r.action === "updated") out.updated.push({ ...r.memory, similarity: r.similarity });
      else out.superseded.push({ memory: r.memory, replaced: r.superseded.id });
    } catch (e) {
      // Only a refusal of the LEARNING is per-item. A Firestore failure means
      // the store is unreachable; carrying on would report most of a
      // reflection as filed when none of it was.
      if (!(e instanceof MemoryError)) {
        e.partial = out;
        throw e;
      }
      // A learning refused AS a credential is never echoed back — the result
      // goes into a transcript, which is the place it was refused to keep it out of.
      const shown = e.code === "memory/secret" ? "«withheld»" : String(item.text || "").slice(0, 120);
      out.refused.push({ index: i, text: shown, code: e.code, reason: e.message });
    }
  }
  return out;
}
