// Memory — checked with no network and no credentials.
//
// The failures that matter are the quiet ones: an Acme memory recalled while
// working for Relax, a credential filed into a store that is recalled into
// prompts on purpose, a rephrasing filed as a second memory until recall is
// half duplicates, a refused list read turned into "nothing remembered". So most
// of this file is about refusals and isolation, driven through the REAL store
// against an in-memory Firestore behind a stubbed globalThis.fetch.
//
//   node scripts/memory-check.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

let pass = 0;
const fails = [];
const check = (ok, name, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const throws = (fn, name, { code, re } = {}) => {
  try {
    fn();
    check(false, name, "it did not throw");
  } catch (e) {
    check((!code || e.code === code) && (!re || re.test(e.message)), name, `${e.code || ""} ${e.message}`.slice(0, 160));
  }
};
const rejects = async (p, name, { code, re } = {}) => {
  try {
    await (typeof p === "function" ? p() : p);
    check(false, name, "it did not reject");
    return null;
  } catch (e) {
    check((!code || e.code === code) && (!re || re.test(e.message)), name, `${e.code || ""} ${e.message}`.slice(0, 160));
    return e;
  }
};

/* ------------------------------------------------------------------ *
 * A fake Firestore behind fetch                                       *
 * ------------------------------------------------------------------ */

const BASE =
  "https://firestore.googleapis.com/v1/projects/myportifilio-3ab5f/databases/(default)/documents";
const { toFields, fromFields } = await import("../lib/server/firestoreRest.js");

const db = new Map();
const log = [];
const unexpected = [];
const failingLists = new Set();
const failingPatches = new Set();

const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const docOut = (p, obj) => ({ name: `${BASE}/${p}`, fields: toFields(obj) });

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = (init.method || "GET").toUpperCase();
  if (!url.startsWith(`${BASE}/`)) {
    unexpected.push(`${method} ${url}`);
    throw new Error(`unexpected network call: ${method} ${url}`);
  }
  const [p, q = ""] = url.slice(BASE.length + 1).split("?");
  const params = new URLSearchParams(q);
  const segs = p.split("/");
  log.push({ method, path: p, mask: params.getAll("updateMask.fieldPaths") });

  if (method === "GET" && segs.length % 2 === 1) {
    if (failingLists.has(p)) return respond(500, { error: { message: "INTERNAL (injected)" } });
    const documents = [...db.entries()]
      .filter(([k]) => k.startsWith(`${p}/`) && k.split("/").length === segs.length + 1)
      .map(([k, v]) => docOut(k, v));
    return respond(200, { documents });
  }
  if (method === "GET") {
    return db.has(p) ? respond(200, docOut(p, db.get(p))) : respond(404, { error: { message: "NOT_FOUND" } });
  }
  if (method === "PATCH") {
    if (failingPatches.has(p)) return respond(500, { error: { message: "INTERNAL (injected)" } });
    const data = fromFields(JSON.parse(init.body || "{}").fields);
    const merged = { ...(db.get(p) || {}), ...data };
    db.set(p, merged);
    return respond(200, docOut(p, merged));
  }
  if (method === "POST") {
    const id = params.get("documentId");
    const key = `${p}/${id}`;
    if (db.has(key)) return respond(409, { error: { message: "Document already exists: " + key } });
    db.set(key, fromFields(JSON.parse(init.body || "{}").fields));
    return respond(200, docOut(key, db.get(key)));
  }
  if (method === "DELETE") {
    db.delete(p);
    return respond(200, {});
  }
  unexpected.push(`${method} ${url}`);
  throw new Error(`unexpected Firestore method ${method}`);
};

const memDocs = () => [...db.entries()].filter(([k]) => k.startsWith("memories/")).map(([k, v]) => ({ id: k.split("/")[1], ...v }));
const writes = () => log.filter((c) => c.method !== "GET");
const resetLog = () => {
  log.length = 0;
  unexpected.length = 0;
};

const shape = await import("../lib/server/memoryShape.js");
const store = await import("../lib/server/memoryStore.js");
const { runInOrg } = await import("../lib/server/orgContext.js");
const {
  KINDS,
  KIND_INFO,
  SCOPES,
  MAX_TEXT,
  MAX_TAGS,
  DEDUPE_THRESHOLD,
  normaliseText,
  tokensOf,
  similarity,
  looksSecret,
  assertNotSecret,
  clampConfidence,
  cleanTags,
  memoryShape,
  validateMemory,
  visibleIn,
  dedupeDecision,
  mergeMemory,
  recencyFactor,
  scoreMemory,
  rankMemories,
  cleanKinds,
} = shape;

const T = "test-id-token";

/* ------------------------------------------------------------------ */
console.log("\nthe module stays pure");
{
  const src = fs.readFileSync(path.join(root, "lib/server/memoryShape.js"), "utf8");
  check(!/from\s+["'](?:crypto|fs|path|async_hooks)["']/.test(src), "memoryShape imports no node built-in");
  check(!/firestoreRest|fetch\(/.test(src), "memoryShape does no I/O");
  const st = fs.readFileSync(path.join(root, "lib/server/memoryStore.js"), "utf8");
  check(/listEveryDocument/.test(st), "the store reads with the strict, paged lister");
  check(!/listDocuments\(/.test(st), "the store never uses the single-page lister");
  check(!/\.catch\(\s*\(\)\s*=>\s*\[\]/.test(st), "no read failure is turned into an empty list");
  check(/from "\.\/memoryShape\.js"/.test(st) && /from "\.\/orgContext\.js"/.test(st), "relative imports carry .js");
}

/* ------------------------------------------------------------------ */
console.log("\nkinds and layers");
{
  check(KINDS.join(",") === "preference,fact,decision,lesson,project,person,reference", "seven kinds, in spec order");
  check(KINDS.every((k) => KIND_INFO[k] && KIND_INFO[k].length > 20), "every kind carries a sentence a model can route on");
  check(SCOPES.join(",") === "global,org", "two layers: global and org");
  throws(() => validateMemory({ text: "x y z", kind: "opinion" }), "an unknown kind is refused", { code: "memory/bad-kind" });
  throws(() => validateMemory({ text: "x y z", kind: "opinion" }), "…and the refusal lists every kind", { re: /preference, fact, decision, lesson, project, person, reference/ });
  throws(() => validateMemory({ text: "x", scope: "team" }), "an unknown layer is refused", { code: "memory/bad-scope" });
  throws(() => cleanKinds(["lesson", "nope"]), "a kinds FILTER with an unknown kind is refused, not matched as nothing", { code: "memory/bad-kind" });
  check(cleanKinds("lesson, fact").join(",") === "lesson,fact", "a comma-separated kinds filter is accepted");
}

/* ------------------------------------------------------------------ */
console.log("\nvalidation");
{
  throws(() => validateMemory({ text: "   " }), "empty text is refused", { code: "memory/empty" });
  throws(() => validateMemory({ text: "a".repeat(MAX_TEXT + 1) }), "text over the cap is refused with its length", { re: new RegExp(String(MAX_TEXT + 1)) });
  const v = validateMemory({ text: "  Ship   on Fridays  " });
  check(v.text === "Ship on Fridays", "whitespace is collapsed");
  check(v.kind === "fact" && v.scope === "org", "defaults: kind fact, layer org (never global by accident)");
  check(v.confidence === shape.DEFAULT_CONFIDENCE, "default confidence");
  check(clampConfidence(4) === 1 && clampConfidence(-2) === 0, "confidence is clamped to 0..1");
  check(clampConfidence("0.456") === 0.46, "a numeric string is accepted and rounded");
  check(clampConfidence("high") === shape.DEFAULT_CONFIDENCE, "a non-number falls back to the default");
  check(cleanTags(["Dev.to", "devto", "LinkedIn", " linkedin "]).join(",") === "dev-to,devto,linkedin", "tags fold to one spelling and dedupe");
  throws(() => validateMemory({ text: "x y", tags: Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`) }), "too many tags is refused", { code: "memory/too-many-tags" });
  const p = validateMemory({ confidence: 0.3 }, { partial: true });
  check(Object.keys(p).join(",") === "confidence", "a partial validation only returns what was given");
}

/* ------------------------------------------------------------------ */
console.log("\nnothing secret enters memory");
{
  const SECRETS = [
    ["sk-ant-api03-abcdefghijklmnop1234", "Anthropic key"],
    ["key is sk-proj-ABCDEFGHijklmnop12345678", "OpenAI key"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "GitHub classic token"],
    ["github_pat_11ABCDEFG0123456789_abcdefghijklmnop", "GitHub fine-grained token"],
    ["AKIAIOSFODNN7EXAMPLE is the aws key", "AWS access key"],
    ["AIzaSyDuDWdIMLs5CCRbPqMvwfxpbobsR4SO3w0", "Google API key"],
    ["hf_abcdefghijklmnopqrstuvwxyz12", "Hugging Face token"],
    ["xoxb-123456789012-abcdefghij", "Slack token"],
    ["-----BEGIN RSA PRIVATE KEY-----\nMIIE", "private key armour"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijk", "JWT"],
    ["postgres://admin:hunter22@db.example.com/app", "connection string with password"],
    ["my gmail password is correcthorse", "password in a sentence, no digits"],
    ["password: Tr0ub4dor&3", "password with a colon"],
    ["the api key = 9f8e7d6c5b4a39281706f5e4", "api key in a sentence"],
    ["https://api.example.com/v1?token=abcdef1234567890", "URL carrying a token"],
    ["use QmFzZTY0RW5jb2RlZEtleVdpdGhNaXhlZENhc2UxMjM0", "long mixed-case key-shaped run"],
    ["npm_abcdefghijklmnopqrstuvwxyz0123456789", "npm token"],
  ];
  for (const [text, what] of SECRETS) check(looksSecret(text).secret, `refused: ${what}`);

  const SAFE = [
    "The password is stored in the secret store under login-github",
    "The token is short-lived, so refresh it",
    "Commit 3f2a9c1e8b7d6f5a4e3d2c1b0a9f8e7d6c5b4a39 fixed the feed",
    "Org id 550e8400-e29b-41d4-a716-446655440000 is Acme",
    "Prefers Space Grotesk for headings and never the purple gradient",
    "Docs live at https://ravikishan.me/blog/building-a-container-runtime",
  ];
  for (const text of SAFE) check(!looksSecret(text).secret, `not refused: "${text.slice(0, 48)}…"`);

  throws(() => assertNotSecret("ghp_abcdefghijklmnopqrstuvwxyz0123456789"), "the refusal names the secret store", { code: "memory/secret", re: /secret store \(create_secret\)/ });
  try {
    assertNotSecret("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  } catch (e) {
    check(!e.message.includes("ghp_abc"), "the refusal never echoes the credential");
  }
  throws(() => validateMemory({ text: "fine", tags: ["ghp_abcdefghijklmnopqrstuvwxyz0123456789"] }), "a credential smuggled in as a TAG is refused too", { code: "memory/secret" });
}

/* ------------------------------------------------------------------ */
console.log("\nsimilarity and dedupe");
{
  check(normaliseText("Héllo, World!") === "hello world", "normalise folds case, accents and punctuation");
  check(tokensOf("The posts are on the site").has("post"), "plurals fold and stop words drop");
  check(similarity("", "") === 0, "two empty texts are not similar");
  check(similarity("Ship blog posts on Friday mornings", "ship blog posts on friday mornings!") === 1, "a re-punctuated sentence is identical");
  const s = similarity("Owner likes the dark theme", "Owner likes the light theme");
  check(s < DEDUPE_THRESHOLD, "dark vs light theme is NOT a duplicate", `similarity ${s}`);
  check(similarity("Ravi prefers amber as the only accent colour", "Ravi prefers amber as the only accent color") < 1, "a spelling difference lowers similarity");

  const existing = [
    memoryShape({ id: "a", scope: "org", orgId: "relax", kind: "preference", text: "Publish blog posts on Friday mornings", confidence: 0.6 }),
    memoryShape({ id: "b", scope: "org", orgId: "relax", kind: "lesson", text: "Publish blog posts on Friday mornings", confidence: 0.6 }),
    memoryShape({ id: "c", scope: "org", orgId: "acme", kind: "preference", text: "Publish blog posts on Friday mornings", confidence: 0.6 }),
    memoryShape({ id: "d", scope: "org", orgId: "relax", kind: "preference", text: "Publish blog posts on Friday morning", archived: true }),
  ];
  const cand = { scope: "org", orgId: "relax", kind: "preference", text: "publish blog posts on friday mornings." };
  const d = dedupeDecision(cand, existing);
  check(d.action === "update" && d.target.id === "a", "a near-identical memory on the same shelf is UPDATED, not duplicated");
  check(dedupeDecision({ ...cand, kind: "decision" }, existing).action === "create", "the same words under another kind are a different memory");
  check(dedupeDecision({ ...cand, orgId: "beta" }, existing).action === "create", "the same words in another org are a different memory");
  check(dedupeDecision({ ...cand, scope: "global", orgId: "" }, existing).action === "create", "global and org layers never dedupe into each other");
  const near = dedupeDecision({ ...cand, text: "Publish videos on Friday" }, existing);
  check(near.action === "create" && near.nearest && near.nearest.id === "a", "a related but distinct memory is created and names its nearest neighbour");
  check(dedupeDecision(cand, [existing[3]]).action === "create", "an archived memory is never revived by dedupe");

  const m = mergeMemory(existing[0], { text: "Publish blog posts on Friday mornings, IST", tags: ["blog"], confidence: 0.5, source: "mcp:remember" }, "2026-10-10T00:00:00.000Z");
  check(m.confidence === 0.7, "hearing it again climbs a quarter of the way to certain", String(m.confidence));
  check(m.text.endsWith("IST"), "the newer phrasing wins");
  check(m.tags.includes("blog") && m.reinforced === 1 && m.lastSource === "mcp:remember", "tags merge, reinforcement counts, the new source is noted");
  check(mergeMemory({ ...existing[0], confidence: 1 }, { text: "x", confidence: 1 }).confidence === 1, "confidence never passes 1");

  // F1: Jaccard cannot see a contradiction. These score 0.82 — over the
  // threshold — and an update overwrote the owner's rule with its opposite.
  const rule = memoryShape({ id: "r", scope: "org", orgId: "relax", kind: "preference", text: "Always run npm test before pushing a branch of the relax portfolio repo", confidence: 0.9 });
  const flip = { scope: "org", orgId: "relax", kind: "preference", text: "Never run npm test before pushing a branch of the relax portfolio repo" };
  check(similarity(rule.text, flip.text) >= DEDUPE_THRESHOLD, "always/never really is over the dedupe threshold", String(similarity(rule.text, flip.text)));
  const fd = dedupeDecision(flip, [rule]);
  check(fd.action === "create" && fd.conflict?.id === "r" && fd.nearest?.id === "r", "a polarity flip is NOT merged: it is created and names the memory it contradicts", JSON.stringify(fd).slice(0, 160));
  const swap = dedupeDecision({ ...flip, text: "Always run npm test before pushing a branch of the relax portfolio repo on Monday" }, [
    memoryShape({ ...rule, text: "Always run npm test before pushing a branch of the relax portfolio repo on Friday" }),
  ]);
  check(swap.action === "create" && swap.conflict, "a one-word swap (Friday for Monday) is not merged either");
  const num = dedupeDecision({ ...flip, text: "Keep the relax portfolio homepage bundle under 200 KB of gzip javascript always" }, [
    memoryShape({ ...rule, text: "Keep the relax portfolio homepage bundle under 300 KB of gzip javascript always" }),
  ]);
  check(num.action === "create" && num.conflict, "nor a changed number");
  check(dedupeDecision({ ...flip, text: rule.text.toLowerCase() + "!" }, [rule]).action === "update", "a pure re-punctuation still dedupes");
}

/* ------------------------------------------------------------------ */
console.log("\nlayers: visibility");
{
  const g = memoryShape({ scope: "global", text: "x" });
  const r = memoryShape({ scope: "org", orgId: "relax", text: "x" });
  const a = memoryShape({ scope: "org", orgId: "acme", text: "x" });
  check(visibleIn(g, "acme") && visibleIn(g, "relax"), "global is visible in every org");
  check(visibleIn(r, "relax") && !visibleIn(r, "acme"), "a Relax memory is invisible in Acme");
  check(!visibleIn(a, "relax"), "an Acme memory is invisible in Relax");
  const legacy = memoryShape({ text: "no scope at all" });
  check(legacy.scope === "org" && legacy.orgId === "relax", "a document with no scope reads as Relax, never as global");
  check(memoryShape({ scope: "global", orgId: "acme" }).orgId === "", "a global memory carries no org");
}

/* ------------------------------------------------------------------ */
console.log("\nranking");
{
  const NOW = Date.parse("2026-10-10T00:00:00Z");
  const day = (n) => new Date(NOW - n * 86400000).toISOString();
  check(recencyFactor({ updatedAt: day(0) }, NOW) === 1, "just touched: full recency");
  check(Math.abs(recencyFactor({ updatedAt: day(90) }, NOW) - 0.75) < 0.01, "one half-life: three quarters");
  check(recencyFactor({ updatedAt: day(3650) }, NOW) >= 0.5, "old memories fade in rank, never out of it");
  check(recencyFactor({}, NOW) === 0.5, "no date reads as old, not as new");

  const rows = [
    memoryShape({ id: "tag", kind: "fact", text: "Something unrelated", tags: ["linkedin"], confidence: 0.8, updatedAt: day(1) }),
    memoryShape({ id: "text", kind: "fact", text: "LinkedIn headline must lead with systems engineer", confidence: 0.8, updatedAt: day(1) }),
    memoryShape({ id: "weak", kind: "fact", text: "LinkedIn posts go out Tuesdays", confidence: 0.2, updatedAt: day(1) }),
    memoryShape({ id: "pref", kind: "preference", text: "Never use the purple gradient", confidence: 0.9, updatedAt: day(1) }),
    memoryShape({ id: "other", kind: "project", text: "Container runtime in Go", confidence: 0.9, updatedAt: day(1) }),
    memoryShape({ id: "gone", kind: "fact", text: "LinkedIn old fact", archived: true, confidence: 1, updatedAt: day(1) }),
  ];
  const s = rankMemories(rows, "linkedin", { mode: "all", now: NOW });
  check(s.map((m) => m.id).join(",") === "tag,text,weak", "search: tag hit > text hit > low-confidence hit; non-matches and archived left out", s.map((m) => m.id).join(","));
  check(rankMemories(rows, "linkedin headline", { mode: "all", now: NOW }).map((m) => m.id).join(",") === "text", "search: every word must match, so two words narrow");
  check(rankMemories(rows, "linkedin", { mode: "all", includeArchived: true, now: NOW }).some((m) => m.id === "gone"), "search can include archived when asked");

  const r = rankMemories(rows, "write a linkedin post about the container runtime", { mode: "any", now: NOW });
  const ids = r.map((m) => m.id);
  check(ids.includes("other") && ids.includes("text") && ids.includes("pref"), "recall: any matching word counts, and a preference stays in view", ids.join(","));
  check(ids.indexOf("pref") > ids.indexOf("text"), "recall: an ambient preference ranks below a real match");
  check(!rankMemories([rows[4]], "unrelated words entirely", { mode: "any", now: NOW }).length, "recall: a non-matching project is left out");
  check(rankMemories(rows, "", { mode: "any", now: NOW }).length === 5, "recall with no task returns everything live, by confidence × recency");
  check(rankMemories(rows, "linkedin", { mode: "all", kinds: ["preference"], now: NOW }).length === 0, "a kind filter narrows");
  check(rankMemories(rows, "", { mode: "any", tags: ["linkedin"], now: NOW }).map((m) => m.id).join(",") === "tag", "a tag filter narrows");
  check(scoreMemory(rows[4], "nothing", { mode: "all", now: NOW }) === null, "scoreMemory says null, not zero, for a miss");
  const fresh = memoryShape({ id: "f", text: "deploy notes", confidence: 0.8, updatedAt: day(0) });
  const stale = memoryShape({ id: "s", text: "deploy notes", confidence: 0.8, updatedAt: day(400) });
  check(rankMemories([stale, fresh], "deploy", { now: NOW })[0].id === "f", "equal text and confidence: the recent one ranks first");
  check(rankMemories(rows, "", { limit: 2, now: NOW }).length === 2, "limit is honoured");
}

/* ------------------------------------------------------------------ */
console.log("\nthe store: remember");
db.set("orgs/acme", { name: "Acme" });

let first;
{
  resetLog();
  const r = await store.remember(T, { text: "Publish blog posts on Friday mornings", kind: "preference", tags: ["blog"], source: "mcp:remember" });
  first = r.memory;
  check(r.action === "created", "a new memory is created");
  check(first.scope === "org" && first.orgId === "relax", "outside any request it is filed under Relax");
  check(/^m_[a-z0-9]+_[0-9a-f]{10}$/.test(first.id), "ids are opaque and collision-resistant", first.id);
  check(db.get(`memories/${first.id}`)?.source === "mcp:remember", "the source is stored so a wrong memory can be traced");
  check(unexpected.length === 0, "no network beyond Firestore");

  const again = await store.remember(T, { text: "publish blog posts on friday mornings!", kind: "preference", tags: ["schedule"], source: "agent:job1" });
  check(again.action === "updated" && again.memory.id === first.id, "the same fact again UPDATES the existing memory");
  check(memDocs().length === 1, "…so there is still exactly one document");
  check(again.memory.confidence > first.confidence, "…with its confidence raised");
  check(again.memory.tags.join(",") === "blog,schedule", "…and its tags merged");
  check(db.get(`memories/${first.id}`).source === "mcp:remember", "…and its ORIGINAL source kept");

  const g = await store.remember(T, { text: "Never use the purple gradient anywhere", kind: "preference", scope: "global" });
  check(g.action === "created" && g.memory.scope === "global" && g.memory.orgId === "", "a global memory is filed with no org");

  await rejects(store.remember(T, { text: "my github token is ghp_abcdefghijklmnopqrstuvwxyz0123456789" }), "a credential is refused at the store", { code: "memory/secret" });
  // S6/F5: context is returned by every recall and listing, so it is held to
  // the same refusal as the text.
  const ctxDocs = memDocs().length;
  await rejects(store.remember(T, { text: "A harmless fact about kites", kind: "fact", context: "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz" }), "a credential in context is refused too", { code: "memory/secret" });
  check(memDocs().length === ctxDocs && !memDocs().some((d) => /sk-ant-/.test(d.context || "")), "…and nothing was written");
  check(!memDocs().some((d) => /ghp_/.test(d.text || "")), "…and nothing was written");
  await rejects(store.remember(T, { text: "x y z", kind: "vibe" }), "an unknown kind is refused at the store with the list", { code: "memory/bad-kind", re: /preference/ });
  await rejects(store.remember(T, { text: "x y z", orgId: "acme" }), "filing into an org you are not acting in is refused", { code: "memory/other-org" });
}

/* ------------------------------------------------------------------ */
console.log("\nthe store: supersede");
let replacement;
{
  const old = await store.remember(T, { text: "Deploy the portfolio from Netlify", kind: "decision" });
  const r = await store.remember(T, { text: "Deploy the portfolio from Vercel, because Netlify builds timed out", kind: "decision", supersedes: old.memory.id });
  replacement = r.memory;
  check(r.action === "superseded", "naming the memory it replaces supersedes");
  check(db.get(`memories/${old.memory.id}`).archived === true, "the old memory is archived, not overwritten");
  check(db.get(`memories/${old.memory.id}`).text === "Deploy the portfolio from Netlify", "…its text is untouched, so the history survives");
  check(db.get(`memories/${old.memory.id}`).supersededBy === replacement.id && replacement.supersedes === old.memory.id, "both point at each other");
  await rejects(store.remember(T, { text: "Deploy from Fly", kind: "decision", supersedes: old.memory.id }), "an archived memory cannot be superseded twice", { code: "memory/archived" });
  await rejects(store.remember(T, { text: "x y z", supersedes: "m_nope_0000000000" }), "superseding a missing memory is refused", { code: "memory/not-found" });
}

/* ------------------------------------------------------------------ */
console.log("\norg isolation");
{
  const acme = await runInOrg("acme", () => store.remember(T, { text: "Acme channel uploads on Fridays at noon", kind: "fact", tags: ["youtube"] }));
  check(acme.memory.orgId === "acme", "inside Acme a memory is filed under Acme");

  const relaxRecall = await store.recall(T, { task: "upload to the youtube channel on fridays" });
  check(!relaxRecall.memories.some((m) => m.orgId === "acme"), "Relax recall NEVER returns an Acme memory");
  check(relaxRecall.orgId === "relax" && relaxRecall.memories.every((m) => m.scope === "global" || m.orgId === "relax"), "Relax recall holds only Relax and global memories");

  const acmeRecall = await runInOrg("acme", () => store.recall(T, { task: "upload youtube on friday and avoid purple gradient" }));
  check(acmeRecall.memories.some((m) => m.id === acme.memory.id), "Acme recall returns Acme's memory");
  check(acmeRecall.memories.some((m) => m.scope === "global"), "Acme recall includes the global layer");
  check(!acmeRecall.memories.some((m) => m.scope === "org" && m.orgId === "relax"), "Acme recall never returns a Relax memory");
  check(acmeRecall.orgId === "acme", "the result says which org it answered for");

  await rejects(store.getMemory(T, acme.memory.id), "reading an Acme memory by id from Relax is refused", { code: "memory/not-found" });
  const e = await rejects(store.forgetMemory(T, acme.memory.id, { confirm: true }), "deleting an Acme memory from Relax is refused", { code: "memory/not-found" });
  check(e && !/acme/i.test(e.message.replace(acme.memory.id, "")), "…and the refusal does not confirm it exists elsewhere");
  check(db.has(`memories/${acme.memory.id}`), "…and it is still there");
  await rejects(store.updateMemory(T, acme.memory.id, { text: "hijacked" }), "updating an Acme memory from Relax is refused", { code: "memory/not-found" });

  const dup = await runInOrg("acme", () => store.remember(T, { text: "Publish blog posts on Friday mornings", kind: "preference" }));
  check(dup.action === "created", "the same words in another org make a separate memory, not an update of Relax's");

  await rejects(runInOrg("ghost", () => store.recall(T, { task: "x" })), "recall in an org that does not exist is refused, not answered empty", { code: "org/unknown" });

  const l = await runInOrg("acme", () => store.listMemories(T, { layer: "org" }));
  check(l.memories.every((m) => m.orgId === "acme"), "listing the org layer in Acme shows only Acme's");
  const lg = await runInOrg("acme", () => store.listMemories(T, { layer: "global" }));
  check(lg.memories.length >= 1 && lg.memories.every((m) => m.scope === "global"), "listing the global layer shows only global");
  await rejects(store.listMemories(T, { layer: "everyone" }), "an unknown layer is refused", { code: "memory/bad-scope" });
}

/* ------------------------------------------------------------------ */
console.log("\nrecall bumps uses");
{
  const before = db.get(`memories/${first.id}`).uses || 0;
  resetLog();
  const r = await store.recall(T, { task: "when do blog posts publish", now: Date.parse("2026-10-10T12:00:00Z") });
  const hit = r.memories.find((m) => m.id === first.id);
  check(!!hit, "recall finds the memory for a matching task");
  check(db.get(`memories/${first.id}`).uses === before + 1, "recall bumps uses");
  check(db.get(`memories/${first.id}`).lastUsedAt === "2026-10-10T12:00:00.000Z", "recall stamps lastUsedAt");
  check(writes().every((w) => w.mask.join(",") === "uses,lastUsedAt"), "the bump writes only the two counters (masked)");
  check(!r.memories.some((m) => m.archived), "archived memories are never recalled");
  check(typeof r.considered === "number" && r.layers && "global" in r.layers, "the result says how much was considered and from which layer");

  failingPatches.add(`memories/${first.id}`);
  const r2 = await store.recall(T, { task: "when do blog posts publish" });
  failingPatches.clear();
  check(r2.memories.some((m) => m.id === first.id), "a failed bump does not lose the recall");
  check(r2.bumpFailed && r2.bumpFailed[0].id === first.id, "…but it is REPORTED, not swallowed");

  const s0 = db.get(`memories/${first.id}`).uses;
  await store.searchMemories(T, { query: "blog" });
  check(db.get(`memories/${first.id}`).uses === s0, "search does NOT count as a use");
  await rejects(store.searchMemories(T, { query: "a" }), "a one-character search is refused", { code: "memory/bad-query" });
  const big = await store.recall(T, { task: "", limit: 999 });
  check(big.memories.length <= store.RECALL_MAX, "recall is capped");
}

/* ------------------------------------------------------------------ */
console.log("\nstrict reads");
{
  failingLists.add("memories");
  await rejects(store.recall(T, { task: "blog" }), "a refused list read FAILS recall rather than answering empty");
  await rejects(store.listMemories(T), "…and fails a listing");
  await rejects(store.remember(T, { text: "A new unrelated fact about kites", kind: "fact" }), "…and refuses to remember (it cannot dedupe without seeing everything)");
  failingLists.clear();
}

/* ------------------------------------------------------------------ */
console.log("\nupdate");
{
  const u = await store.updateMemory(T, first.id, { confidence: 0.95, tags: ["blog", "cadence"] });
  check(u.memory.confidence === 0.95 && u.memory.tags.join(",") === "blog,cadence", "confidence and tags change in place");
  await rejects(store.updateMemory(T, first.id, {}), "an empty update is refused", { code: "memory/empty-update" });
  await rejects(store.updateMemory(T, first.id, { text: "password is hunter2x" }), "an update cannot smuggle in a credential", { code: "memory/secret" });
  await rejects(store.updateMemory(T, first.id, { kind: "rumour" }), "an update to an unknown kind is refused", { code: "memory/bad-kind" });
  const moved = await runInOrg("acme", async () => {
    const m = await store.remember(T, { text: "Moving this one to global later", kind: "fact" });
    return store.updateMemory(T, m.memory.id, { scope: "global" });
  });
  check(moved.memory.scope === "global" && moved.memory.orgId === "", "moving to the global layer clears the org");
  check(db.get(`memories/${moved.memory.id}`).orgId === "", "…in the stored document too");
  await rejects(store.getMemory(T, "../orgs/acme"), "a path-shaped id is refused before any read", { code: "memory/bad-id" });
}

/* ------------------------------------------------------------------ */
console.log("\nforget: archive vs delete");
{
  const m = (await store.remember(T, { text: "Temporary fact about a kite festival", kind: "fact" })).memory;
  const a = await store.forgetMemory(T, m.id);
  check(a.action === "archived" && db.get(`memories/${m.id}`).archived === true, "forget without confirm ARCHIVES");
  check(db.has(`memories/${m.id}`), "…the document is still there");
  const r = await store.recall(T, { task: "kite festival" });
  check(!r.memories.some((x) => x.id === m.id), "…and it is no longer recalled");
  const again = await store.forgetMemory(T, m.id);
  check(again.action === "already-archived" && /confirm/.test(again.note), "forgetting it again says how to delete for good");
  const back = await store.updateMemory(T, m.id, { archived: false });
  check(back.memory.archived === false && db.get(`memories/${m.id}`).archivedAt === "", "archived:false restores it");
  const d = await store.forgetMemory(T, m.id, { confirm: true });
  check(d.action === "deleted" && !db.has(`memories/${m.id}`), "forget with confirm:true deletes for good");
  await rejects(store.forgetMemory(T, m.id, { confirm: true }), "deleting it twice says there is nothing there", { code: "memory/not-found" });
  const strict = await store.forgetMemory(T, first.id, { confirm: "yes" }).then((x) => x.action);
  check(strict === "archived", "only a real boolean true deletes — a truthy string archives");
  await store.updateMemory(T, first.id, { archived: false });
}

/* ------------------------------------------------------------------ */
console.log("\nreflect");
{
  const before = memDocs().length;
  const out = await store.reflect(T, {
    summary: "Shipped the memory feature; reviewers wanted fewer tabs.",
    source: "reflection:sess-42",
    learnings: [
      "Run the no-network suite before asking for review",
      { text: "Owner wants every panel to work at 390px", kind: "preference", tags: ["design"] },
      { text: "publish blog posts on friday mornings", kind: "preference" },
      { text: "The deploy token is ghp_abcdefghijklmnopqrstuvwxyz0123456789", kind: "fact" },
      { text: "x", kind: "gossip" },
      "Run the no-network suite before asking for review!",
    ],
  });
  check(out.created.length === 2, "two new learnings were created", JSON.stringify(out.created.map((m) => m.text)));
  check(out.updated.length === 2, "a repeat of an existing memory (or of an earlier learning) UPDATES it", String(out.updated.length));
  check(out.updated.some((m) => m.id === first.id), "the Friday learning reinforced the existing Relax preference");
  check(out.refused.length === 2, "a credential and an unknown kind are refused, not filed");
  check(out.refused.some((r) => r.code === "memory/secret" && r.text === "«withheld»"), "a refused credential is never echoed back");
  check(out.refused.some((r) => r.code === "memory/bad-kind" && /preference/.test(r.reason)), "an unknown kind is refused with the list");
  check(out.created.every((m) => m.source === "reflection:sess-42"), "learnings carry the reflection's source");
  check(out.created.every((m) => m.context.startsWith("Shipped the memory feature")), "…and the start of the summary as context");
  check(out.created.some((m) => m.kind === "lesson" && m.confidence === 0.6), "a bare sentence is filed as a lesson at 0.6");
  const dupes = memDocs().filter((d) => /no-network suite/.test(d.text || ""));
  check(dupes.length === 1, "two learnings saying the same thing in one reflection dedupe against each other");
  check(memDocs().length === before + 2, "exactly two documents were added");
  check(!memDocs().some((d) => /ghp_/.test(d.text || "")), "no credential reached Firestore");

  await rejects(store.reflect(T, { summary: "x", learnings: [] }), "an empty reflection is refused", { code: "memory/empty" });
  // The summary is filed as EVERY learning's context, and agentd builds it
  // from the job's task — where an owner types the token.
  const sumDocs = memDocs().length;
  await rejects(
    store.reflect(T, { summary: "Agent job j_1 in a/b (done): use ghp_abcdefghijklmnopqrstuvwxyz0123456789 to push the release", learnings: ["Releases need the release branch"] }),
    "a reflection whose summary carries a credential is refused whole",
    { code: "memory/secret" }
  );
  check(memDocs().length === sumDocs, "…and none of its learnings was filed with it as context");
  await rejects(store.reflect(T, { learnings: Array.from({ length: store.REFLECT_MAX + 1 }, (_, i) => `learning ${i}`) }), "too many learnings is refused", { code: "memory/too-many" });

  failingLists.add("memories");
  const e = await rejects(store.reflect(T, { learnings: ["A learning about kites and wind"] }), "a store failure aborts the reflection rather than reporting it filed");
  check(e && e.partial && Array.isArray(e.partial.created), "…and carries what had been filed before it failed");
  failingLists.clear();

  const acme = await runInOrg("acme", () => store.reflect(T, { learnings: [{ text: "Acme prefers formal tone in mail", kind: "preference" }] }));
  check(acme.orgId === "acme" && acme.created[0].orgId === "acme", "a reflection in Acme files into Acme");
}

/* ------------------------------------------------------------------ */
console.log("\nthe route, the panel, the rules");
{
  const api = fs.readFileSync(path.join(root, "pages/api/memory.js"), "utf8");
  check(/verifyAdmin\(req\)/.test(api), "/api/memory is admin-gated");
  check(/export default withEnv\(handler\)/.test(api), "/api/memory runs inside withEnv (so inside the request's org)");
  check(/Unknown action/.test(api) && !/req\.body\.path|body\.path/.test(api), "/api/memory is an allow-list, never a pass-through");
  check(/req\.method !== "POST"/.test(api), "/api/memory refuses anything but POST");
  const client = fs.readFileSync(path.join(root, "lib/memoryClient.js"), "utf8");
  check(/adminJson/.test(client) && !/fetch\(/.test(client), "the browser client goes through adminJson only");
  const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
  const mi = rules.indexOf("match /memories/{");
  check(mi > 0 && mi < rules.indexOf("match /{document=**}"), "firestore.rules has a memories match before the deny-all");
  check(/match \/memories\/\{[^}]+\}\s*\{\s*allow read, write: if isAdmin\(\);/.test(rules), "…and it is admin-only both ways");
  const rc = fs.readFileSync(path.join(root, "scripts/rules-check.mjs"), "utf8");
  check(/\["memories",/.test(rc), "rules:check asserts memories is denied to an anonymous reader");
  const admin = fs.readFileSync(path.join(root, "pages/admin.js"), "utf8");
  check(/\["memory", "Memory", "Stored"\]/.test(admin), "the Memory tab is in TABS under Stored");
  check(/view === "memory"/.test(admin), "…and the panel switch renders it");
  const app = fs.readFileSync(path.join(root, "pages/_app.js"), "utf8");
  check(/"\/__memorypreview"/.test(app), "the preview renders bare");
  const prev = fs.readFileSync(path.join(root, "pages/__memorypreview.js"), "utf8");
  check(/notFound: true/.test(prev) && /NODE_ENV === "production"/.test(prev), "the preview 404s in production");
  const panel = fs.readFileSync(path.join(root, "components/admin/MemoryPanel.js"), "utf8");
  check(!/fetch\(/.test(panel), "the panel makes no direct fetch");
  check(!/`[^`]*\/\*[^*]*`[^*]*\*\//.test(panel), "no backtick inside a CSS comment in styled-jsx");
  // The panel files into the current org unless global is chosen — the same
  // safe default as the server. "global" was the default, a cross-org leak.
  check(/const \[scope, setScope\] = useState\("org"\)/.test(panel), "the Remember form defaults to the current org, not every org");
  check(panel.indexOf("Only {orgId}") < panel.indexOf("You, every org"), "…and offers it first");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (unexpected.length) console.log(`unexpected network: ${unexpected.join("; ")}`);
if (fails.length) {
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
