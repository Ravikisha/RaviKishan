# ML Lab, parts 1–3 (API-key accounts, Hugging Face, Kaggle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Hugging Face and Kaggle accounts by pasted token (multi-account, sealed, through the account directory), and expose both platforms over MCP — full HF search/repos/commits/Jobs/usage and Kaggle search/kernels/quota/datasets/submissions — plus an audited credential export.

**Architecture:** Two new `auth: "apiKey"` providers in `lib/server/integrations.js`, stored in the existing `connectedAccounts/` collection as `kind: "access"` rows written server-side as the admin. Each platform gets a PURE shaping module (unit-tested, no network) and a thin network client. MCP tools live in a NEW file `lib/server/mlTools.js` (the 4,725-line `mcpTools.js` is not grown) and are spread into `TOOLS`.

**Tech Stack:** Next.js 12 API routes, plain-node ESM in `lib/server` (explicit `.js` imports), Firestore REST as the user, AES-GCM sealing (`seal`/`unseal`), `node scripts/*.mjs` assertion suites.

**Spec:** `docs/superpowers/specs/2026-10-07-ml-lab-design.md` (§4–§6, §10, §11).

## Global Constraints

- Every relative import inside `lib/server/` carries an explicit `.js` extension.
- `lib/server/*Shape.js` and `parseKey`/`credentialMaterial` are PURE: no `fetch`, no Firestore, no `process.env`.
- New HF repos are created **`private: true` by default**; no tool flips a repo, dataset or kernel to public; no tool deletes a repo, dataset or kernel.
- Credentials are sealed with `seal(value, "refresh")` under `INTEGRATION_SECRET`; plaintext keys are never written to Firestore, logs, audit entries or tool results (except `get_ml_credentials`).
- `get_ml_credentials` is scope `secrets`, refuses unless the account row has `agentReadable === true` (strict boolean), and writes an `auditLog` entry on every successful read.
- Tool names are snake_case; read-scope tools must not start with `create|update|delete|set|add|upload|restore|publish|import|crosspost|mark_`.
- Write-scope tools that spend money or finite quota (`hf_run_job`, `hf_inference`, `kaggle_submit`) take `dryRun` or `confirm` as specified per task.
- Inline file content to HF is capped at **10 MB per commit**; a file HF's preupload marks `lfs` is refused with the reason (LFS is out of scope).
- Never run `next build` while `next dev` is running.

## Review Focus

1. **A Kaggle `kaggle.json` pasted with surrounding whitespace / Windows line endings** — expect it to parse; pinned in Task 6 tests.
2. **An HF read-only token** — expect it to connect with a warning, and write tools to fail with a message naming the token role (not a raw 403); pinned in Task 3 (`hfError`) and Task 7 (warning).
3. **Two HF accounts connected, tool called without `accountId`** — expect the directory's `account/ambiguous` refusal listing both, never a guess; pinned in Task 2.
4. **A commit containing a binary/large file** — expect a refusal naming the file and "LFS", before any commit request; pinned in Task 3 (`planCommit`).
5. **Kaggle quota durations arriving as `"12345.6s"` strings or as numbers** — expect hours computed either way; pinned in Task 5 (`shapeQuota`).

---

### Task 1: API-key provider entries

**Files:**
- Modify: `lib/server/integrations.js` (PROVIDERS block ending ~:319; `providerConfig` :326-365)
- Modify: `pages/api/integrations/[provider]/start.js` (refuse apiKey)
- Modify: `scripts/integrations-check.mjs:64-80`, `scripts/social-check.mjs:71-80`
- Test: `scripts/integrations-check.mjs`

**Interfaces:**
- Produces: `PROVIDERS.huggingface`, `PROVIDERS.kaggle` with `auth: "apiKey"`, `keyHint: string`, `tokenPage: string`; `providerConfig(id)` returns `{configured, missing, auth}` for them without reading `p.env`.

- [ ] **Step 1: Update the pinned tests first**

In `scripts/integrations-check.mjs`, change the pinned provider list (line 64) to:
```js
  providerIds().join(",") === "google,microsoft,github,youtube,instagram,x,analytics,notion,linkedin,huggingface,kaggle",
```
and add after the multi check (~line 81):
```js
console.log("\nAPI-key providers");
{
  const { providerConfig } = await import("../lib/server/integrations.js");
  for (const id of ["huggingface", "kaggle"]) {
    check(PROVIDERS[id].auth === "apiKey", `${id} connects by pasted token`);
    check(PROVIDERS[id].env === null, `${id} needs no client credentials`);
    const saved = process.env.INTEGRATION_SECRET;
    process.env.INTEGRATION_SECRET = "x".repeat(32);
    check(providerConfig(id).configured === true, `${id} is configured once sealing is`);
    delete process.env.INTEGRATION_SECRET;
    const off = providerConfig(id);
    check(!off.configured && off.missing.join() === "INTEGRATION_SECRET", `${id} names only INTEGRATION_SECRET as missing`, off.missing.join());
    if (saved) process.env.INTEGRATION_SECRET = saved;
  }
  check(
    providerIds().filter((id) => PROVIDERS[id].auth !== "apiKey").every((id) => PROVIDERS[id].env),
    "every OAuth provider still declares its client env"
  );
}
```
In `scripts/social-check.mjs` line ~73 change the identity predicate to:
```js
  const named = p.identityFromIdToken || p.auth === "apiKey" || ["youtube", "instagram", "x", "github", "linkedin", "notion"].includes(id);
```

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/integrations-check.mjs`
Expected: FAIL — `✗` on the pinned provider list and `TypeError: Cannot read properties of undefined (reading 'auth')`.

- [ ] **Step 3: Add the providers and the config branch**

Append inside `PROVIDERS` (after `linkedin`):
```js
  // API-key providers. Neither platform needs an OAuth app for this: a
  // personal token is the documented way in, it is scoped on the provider's
  // own settings page, and pasting it costs no client registration. They are
  // multi-account like everything else; the account is identified by asking
  // the provider who the token belongs to, at connect time.
  huggingface: {
    id: "huggingface",
    label: "Hugging Face",
    multi: true,
    auth: "apiKey",
    noAccountHint: true,
    docId: "huggingface",
    scopes: [],
    env: null,
    keyHint: "hf_… — a write or fine-grained token",
    tokenPage: "https://huggingface.co/settings/tokens",
  },
  kaggle: {
    id: "kaggle",
    label: "Kaggle",
    multi: true,
    auth: "apiKey",
    noAccountHint: true,
    docId: "kaggle",
    scopes: [],
    env: null,
    keyHint: "API token, or the whole kaggle.json",
    tokenPage: "https://www.kaggle.com/settings",
  },
```
At the top of `providerConfig`, right after `const p = getProvider(id);`:
```js
  // A pasted-token provider has no client to configure: the only thing it
  // needs from the deployment is the key that seals what is pasted.
  if (p.auth === "apiKey") {
    return {
      id: p.id,
      label: p.label,
      clientId: "",
      clientSecret: "",
      borrowed: "",
      auth: "apiKey",
      configured: isSealConfigured(),
      missing: isSealConfigured() ? [] : ["INTEGRATION_SECRET"],
    };
  }
```
and add `auth: "oauth",` to the object the function returns for OAuth providers.

In `pages/api/integrations/[provider]/start.js`, immediately after the provider is resolved with `getProvider(...)`, add:
```js
    if (p.auth === "apiKey") {
      return res.status(400).json({
        error: `${p.label} is connected by pasting a token in the Accounts tab, not through a consent screen.`,
      });
    }
```
(Use whatever variable `start.js` already binds the provider to; if it does not bind one, add `const p = getProvider(req.query.provider);` above.)

- [ ] **Step 4: Run tests**

Run: `node scripts/integrations-check.mjs && node scripts/social-check.mjs`
Expected: all `✓`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/server/integrations.js "pages/api/integrations/[provider]/start.js" scripts/integrations-check.mjs scripts/social-check.mjs
git commit -m "accounts: Hugging Face and Kaggle as pasted-token providers"
```

---

### Task 2: Directory — `ml` service, no legacy lookup for key providers, `tokenFor` legacy fix

**Files:**
- Modify: `lib/server/accountDirectory.js` (`SERVICES` :62-71, `allAccounts` loop :121-126, `tokenFor` :291-299)
- Test: `scripts/accounts-check.mjs`

**Interfaces:**
- Consumes: `PROVIDERS.huggingface|kaggle` (Task 1).
- Produces: `SERVICES.ml = { id:"ml", providers:["huggingface","kaggle"], … }`; `tokenFor(idToken,{service:"ml",provider,accountId}) → {token: string, account}` (legacy rows now return a real string).

- [ ] **Step 1: Write the failing tests** — append to `scripts/accounts-check.mjs` before the summary block:

```js
console.log("\nthe ML lab is a job");
check(SERVICES.ml?.providers.join() === "huggingface,kaggle", "ml is done by Hugging Face and Kaggle");
check(servicesFor("huggingface").some((s) => s.id === "ml"), "huggingface is wired to ml");
{
  const two = [acct("huggingface", "alice"), acct("huggingface", "bob")];
  throws(() => chooseAccount(two, { service: "ml", provider: "huggingface" }), "two HF accounts and no default refuses", /alice|bob/);
  const one = chooseAccount([acct("kaggle", "ravi")], { service: "ml", provider: "kaggle" });
  check(one.accountId === "ravi" && one.chosenBy === "only", "the only Kaggle account is chosen, and says why");
}

console.log("\nthe legacy token path returns the token, not undefined");
{
  const src = (await import("node:fs")).readFileSync(new URL("../lib/server/accountDirectory.js", import.meta.url), "utf8");
  check(!/const \{ token \} = await accessTokenFor/.test(src), "tokenFor does not destructure the string accessTokenFor returns");
}
```

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/accounts-check.mjs`
Expected: FAIL on `ml is done by…` and `tokenFor does not destructure…`.

- [ ] **Step 3: Implement**

In `SERVICES` add:
```js
  ml: { id: "ml", label: "ML lab", providers: ["huggingface", "kaggle"], verbs: ["read", "write"], analytics: true },
```
In `allAccounts`, inside `for (const id of ids) {` as the first line:
```js
    // A pasted-token provider was born multi-account; there is no legacy row to find.
    if (PROVIDERS[id].auth === "apiKey") continue;
```
Replace the legacy branch of `tokenFor`:
```js
  if (account.legacy) {
    // accessTokenFor returns the token string itself — destructuring it gave
    // every legacy caller `undefined`.
    const token = await accessTokenFor(idToken, account.provider);
    return { token, account };
  }
```

- [ ] **Step 4: Run tests**

Run: `node scripts/accounts-check.mjs && node scripts/integrations-check.mjs`
Expected: all `✓`.

- [ ] **Step 5: Commit**

```bash
git add lib/server/accountDirectory.js scripts/accounts-check.mjs
git commit -m "accounts: ml service; fix tokenFor returning undefined for legacy rows"
```

---

### Task 3: `hfShape.js` — pure Hugging Face helpers

**Files:**
- Create: `lib/server/hfShape.js`
- Create: `scripts/ml-check.mjs` (new suite, grows in Tasks 5–6)
- Modify: `package.json` scripts: `"test:ml": "node scripts/ml-check.mjs"`

**Interfaces:**
- Produces:
  - `REPO_TYPES = ["model","dataset","space"]`
  - `assertRepoId(id) → string` (throws `HfInputError`)
  - `assertRepoType(t="model") → "model"|"dataset"|"space"`
  - `apiBase(type) → "models"|"datasets"|"spaces"`; `resolvePrefix(type) → ""|"datasets/"|"spaces/"`
  - `searchQuery({search,author,filter,sort,limit,full}) → URLSearchParams`
  - `shapeRepo(raw, type) → {id,type,author,downloads,likes,tags,pipeline,lastModified,private,gated,url}`
  - `JOB_FLAVORS: string[]`; `assertFlavor(f) → string`
  - `planCommit(files, preupload) → { ok:true, totalBytes } | throws HfInputError` — `files: {path, bytes:Uint8Array}[]`, `preupload: {files:[{path,uploadMode,shouldIgnore}]}`
  - `commitNdjson({summary, description, files, deletes}) → string`
  - `hfError(status, body, role) → Error` with `.status`, readable message
  - `class HfInputError extends Error` (status 400)

- [ ] **Step 1: Write the failing test** — create `scripts/ml-check.mjs`:

```js
// ML lab — Hugging Face and Kaggle shaping, checked with no network.
//
//   node scripts/ml-check.mjs
let pass = 0;
const fails = [];
const check = (ok, name, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const throws = (fn, name, re) => {
  try { fn(); check(false, name, "it did not throw"); }
  catch (e) { check(!re || re.test(e.message), name, e.message.slice(0, 160)); }
};

const hf = await import("../lib/server/hfShape.js");

console.log("\nHugging Face: repo ids and types");
check(hf.assertRepoId("ravi/tiny-bert") === "ravi/tiny-bert", "owner/name passes");
throws(() => hf.assertRepoId("tiny-bert"), "a bare name is refused", /owner\/name/);
throws(() => hf.assertRepoId("a/b/c"), "three segments are refused", /owner\/name/);
throws(() => hf.assertRepoId("ravi/../etc"), "traversal is refused", /owner\/name/);
check(hf.assertRepoType() === "model", "type defaults to model");
throws(() => hf.assertRepoType("notebook"), "an unknown type names the real ones", /model, dataset, space/);
check(hf.apiBase("dataset") === "datasets" && hf.resolvePrefix("space") === "spaces/" && hf.resolvePrefix("model") === "", "paths per type");

console.log("\nHugging Face: search");
{
  const q = hf.searchQuery({ search: "whisper", author: "openai", sort: "downloads", limit: 500 });
  check(q.get("search") === "whisper" && q.get("author") === "openai", "search and author pass through");
  check(q.get("limit") === "100", "limit is capped at 100", q.get("limit"));
  check(q.get("direction") === "-1", "sort is descending");
  throws(() => hf.searchQuery({ sort: "stars" }), "an unknown sort names the real ones", /downloads/);
  const f = hf.searchQuery({ filter: ["text-classification", "pytorch"] });
  check(f.getAll("filter").join() === "text-classification,pytorch", "filters repeat");
}
{
  const r = hf.shapeRepo({ id: "openai/whisper-tiny", author: "openai", downloads: 5, likes: 2, tags: ["audio"], pipeline_tag: "asr", lastModified: "2026-01-01", private: false, gated: false }, "model");
  check(r.url === "https://huggingface.co/openai/whisper-tiny" && r.pipeline === "asr", "a model shapes with its url");
  check(hf.shapeRepo({ id: "x/y" }, "dataset").url === "https://huggingface.co/datasets/x/y", "a dataset url carries its prefix");
  check(hf.shapeRepo({ id: "x/y" }, "model").downloads === 0, "missing counters read 0, not undefined");
}

console.log("\nHugging Face: jobs flavors");
check(hf.assertFlavor("t4-small") === "t4-small", "a real flavor passes");
throws(() => hf.assertFlavor("rtx-4090"), "an unknown flavor names the real ones", /cpu-basic/);

console.log("\nHugging Face: commits");
{
  const enc = new TextEncoder();
  const files = [{ path: "README.md", bytes: enc.encode("# hi") }, { path: "metrics.json", bytes: enc.encode("{}") }];
  const ok = hf.planCommit(files, { files: [{ path: "README.md", uploadMode: "regular", shouldIgnore: false }, { path: "metrics.json", uploadMode: "regular", shouldIgnore: false }] });
  check(ok.ok && ok.totalBytes === 6, "regular files are accepted");
  throws(() => hf.planCommit([{ path: "model.bin", bytes: new Uint8Array(10) }], { files: [{ path: "model.bin", uploadMode: "lfs", shouldIgnore: false }] }), "an LFS file is refused by name", /model\.bin.*LFS/);
  throws(() => hf.planCommit([{ path: "big.txt", bytes: new Uint8Array(10 * 1024 * 1024 + 1) }], { files: [] }), "over 10 MB is refused before asking", /10 MB/);
  throws(() => hf.planCommit([{ path: "../x", bytes: enc.encode("a") }], { files: [] }), "a traversal path is refused", /path/);
  const nd = hf.commitNdjson({ summary: "add", files: [{ path: "a.txt", bytes: enc.encode("hi") }], deletes: ["old.txt"] }).trim().split("\n").map((l) => JSON.parse(l));
  check(nd[0].key === "header" && nd[0].value.summary === "add", "the header line comes first");
  check(nd[1].key === "file" && nd[1].value.encoding === "base64" && nd[1].value.content === "aGk=", "file content is base64");
  check(nd[2].key === "deletedFile" && nd[2].value.path === "old.txt", "a delete is its own line");
}

console.log("\nHugging Face: errors");
check(/read token/i.test(hf.hfError(403, {}, "read").message), "403 on a read token says so");
check(hf.hfError(401, {}, "").status === 401 && /revoked|reconnect/i.test(hf.hfError(401, {}, "").message), "401 says to repaste");
check(/not found/i.test(hf.hfError(404, { error: "Repository not found" }, "").message), "404 keeps HF's reason");

// (Tasks 5 and 6 append here.)

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  ✗ ${f}`); process.exit(1); }
```
Add to `package.json` scripts: `"test:ml": "node scripts/ml-check.mjs",`

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ml`
Expected: FAIL — `Cannot find module '../lib/server/hfShape.js'`.

- [ ] **Step 3: Implement `lib/server/hfShape.js`**

```js
// Hugging Face — the PURE half. No fetch, no Firestore, no environment, so
// every rule here is testable with plain node (scripts/ml-check.mjs).

export class HfInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.code = "hf/input";
  }
}

export const REPO_TYPES = ["model", "dataset", "space"];
const SEG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

export function assertRepoId(id) {
  const s = String(id || "").trim();
  const parts = s.split("/");
  if (parts.length !== 2 || !parts.every((p) => SEG.test(p) && p !== "." && p !== "..")) {
    throw new HfInputError(`"${s}" is not a repo id. Use owner/name, e.g. openai/whisper-tiny.`);
  }
  return s;
}

export function assertRepoType(t = "model") {
  const v = String(t || "model");
  if (!REPO_TYPES.includes(v)) throw new HfInputError(`Unknown repo type "${v}". Use one of ${REPO_TYPES.join(", ")}.`);
  return v;
}

export const apiBase = (type) => `${assertRepoType(type)}s`;
export const resolvePrefix = (type) => (assertRepoType(type) === "model" ? "" : `${type}s/`);

const SORTS = ["downloads", "likes", "trendingScore", "lastModified", "createdAt"];

export function searchQuery({ search, author, filter, sort, limit = 20, full } = {}) {
  const q = new URLSearchParams();
  if (search) q.set("search", String(search));
  if (author) q.set("author", String(author));
  for (const f of [].concat(filter || [])) if (f) q.append("filter", String(f));
  if (sort) {
    if (!SORTS.includes(sort)) throw new HfInputError(`Unknown sort "${sort}". Use one of ${SORTS.join(", ")}.`);
    q.set("sort", sort);
    q.set("direction", "-1");
  }
  q.set("limit", String(Math.max(1, Math.min(100, Number(limit) || 20))));
  if (full) q.set("full", "true");
  return q;
}

export function shapeRepo(raw = {}, type = "model") {
  const id = raw.id || raw.modelId || "";
  return {
    id,
    type,
    author: raw.author || id.split("/")[0] || "",
    downloads: raw.downloads || 0,
    likes: raw.likes || 0,
    tags: raw.tags || [],
    pipeline: raw.pipeline_tag || "",
    lastModified: raw.lastModified || "",
    private: !!raw.private,
    gated: raw.gated || false,
    url: `https://huggingface.co/${resolvePrefix(type)}${id}`,
  };
}

export const JOB_FLAVORS = [
  "cpu-basic", "cpu-upgrade", "cpu-performance", "cpu-xl", "sprx8", "zero-a10g",
  "t4-small", "t4-medium", "l4x1", "l4x4", "l40sx1", "l40sx4", "l40sx8",
  "a10g-small", "a10g-large", "a10g-largex2", "a10g-largex4",
  "a100-large", "a100x4", "a100x8", "h200", "h200x2", "h200x4", "h200x8",
];

export function assertFlavor(f) {
  if (!JOB_FLAVORS.includes(f)) throw new HfInputError(`Unknown hardware flavor "${f}". Use one of ${JOB_FLAVORS.join(", ")}.`);
  return f;
}

export const MAX_COMMIT_BYTES = 10 * 1024 * 1024;

const safePath = (p) => {
  const s = String(p || "");
  if (!s || s.startsWith("/") || s.split("/").some((x) => x === ".." || x === "")) {
    throw new HfInputError(`"${s}" is not a usable file path inside a repo.`);
  }
  return s;
};

// Decides, before any commit is attempted, whether these files can go in one
// inline commit. HF's preupload answer says which files must be LFS; LFS is
// not implemented here, so those are refused by name rather than half-pushed.
export function planCommit(files, preupload = { files: [] }) {
  let totalBytes = 0;
  for (const f of files) {
    safePath(f.path);
    totalBytes += f.bytes.byteLength;
  }
  if (totalBytes > MAX_COMMIT_BYTES) {
    throw new HfInputError(`This commit is ${(totalBytes / 1048576).toFixed(1)} MB; inline commits are capped at 10 MB.`);
  }
  const lfs = (preupload.files || []).filter((x) => x.uploadMode === "lfs").map((x) => x.path);
  if (lfs.length) {
    throw new HfInputError(`${lfs.join(", ")} must be uploaded through LFS, which this tool does not do. Commit small text/JSON files here and large weights from a CLI.`);
  }
  return { ok: true, totalBytes };
}

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

export function commitNdjson({ summary, description = "", files = [], deletes = [] }) {
  const lines = [{ key: "header", value: { summary: String(summary || "Update"), description } }];
  for (const f of files) lines.push({ key: "file", value: { path: safePath(f.path), content: b64(f.bytes), encoding: "base64" } });
  for (const d of deletes) lines.push({ key: "deletedFile", value: { path: safePath(d) } });
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

export function hfError(status, body = {}, role = "") {
  const said = body.error || body.message || "";
  let msg;
  if (status === 401) msg = "Hugging Face rejected the stored token (401). It was probably revoked — paste a new one in the Accounts tab.";
  else if (status === 403) msg = role === "read"
    ? "This is a read token, so Hugging Face refused a write. Paste a write or fine-grained token in the Accounts tab."
    : `Hugging Face refused this (403)${said ? `: ${said}` : ""}. A fine-grained token may be missing this permission.`;
  else if (status === 404) msg = `Not found on Hugging Face${said ? `: ${said}` : ""}.`;
  else if (status === 429) msg = "Hugging Face rate-limited this request (429). Wait a minute and retry.";
  else msg = `Hugging Face answered ${status}${said ? `: ${said}` : ""}.`;
  const e = new Error(msg);
  e.status = status;
  e.code = `hf/${status}`;
  return e;
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:ml`
Expected: all `✓`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/server/hfShape.js scripts/ml-check.mjs package.json
git commit -m "ml: pure Hugging Face helpers with test:ml"
```

---

### Task 4: `huggingface.js` — network client

**Files:**
- Create: `lib/server/huggingface.js`
- Test: `scripts/ml-check.mjs` (stubbed fetch)

**Interfaces:**
- Consumes: everything in `hfShape.js` (Task 3).
- Produces (all `async`, first arg is the token string, `fetchImpl` defaults to global `fetch`, settable via `setFetch(fn)` for tests):
  `whoami(t)`, `search(t,{type,…query})`, `getRepo(t,{type,id})`, `listFiles(t,{type,id,rev,path,recursive})`, `readFile(t,{type,id,rev,path})`, `listCommits(t,{type,id,rev})`, `createRepo(t,{type,name,organization,private=true,sdk})`, `commitFiles(t,{type,id,rev,summary,description,files,deletes})`, `searchPapers(t,{q})`, `dailyPapers(t,{date})`, `semanticSearchSpaces(t,{q})`, `searchDocs(t,{q})`, `listCollections(t,{owner,q,limit})`, `getCollection(t,{slug})`, `addToCollection(t,{slug,itemType,itemId,note})`, `spaceRuntime(t,{id})`, `restartSpace(t,{id})`, `setSpaceSecret(t,{id,key,value,description})`, `inference(t,{model,messages,maxTokens})`, `jobsHardware(t)`, `runJob(t,{namespace,image,spaceId,command,args,env,secrets,flavor,timeoutSeconds})`, `listJobs(t,{namespace})`, `getJob(t,{namespace,id})`, `jobLogs(t,{namespace,id,tail})`, `cancelJob(t,{namespace,id})`, `usage(t,{startDate,endDate})`.

- [ ] **Step 1: Write the failing test** — insert in `scripts/ml-check.mjs` before `// (Tasks 5 and 6 append here.)`:

```js
console.log("\nHugging Face client (stubbed network)");
{
  const api = await import("../lib/server/huggingface.js");
  const seen = [];
  api.setFetch(async (url, init = {}) => {
    seen.push({ url: String(url), init });
    const u = String(url);
    const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b, text: async () => JSON.stringify(b), headers: new Map() });
    if (u.endsWith("/api/whoami-v2")) return json({ name: "ravi", auth: { accessToken: { role: "write" } } });
    if (u.includes("/api/models?")) return json([{ id: "a/b", downloads: 3 }]);
    if (u.includes("/preupload/")) return json({ files: [{ path: "README.md", uploadMode: "regular", shouldIgnore: false }] });
    if (u.includes("/commit/")) return json({ commitOid: "abc", commitUrl: "https://huggingface.co/a/b/commit/abc" });
    if (u.endsWith("/api/repos/create")) return json({ url: "https://huggingface.co/ravi/new" });
    if (u.includes("/api/jobs/ravi") && init.method === "POST") return json({ id: "job1", status: { stage: "RUNNING" } });
    return json({ error: "nope" }, 404);
  });
  const who = await api.whoami("hf_x");
  check(who.name === "ravi" && seen[0].init.headers.Authorization === "Bearer hf_x", "whoami sends the bearer token");
  const found = await api.search("hf_x", { type: "model", search: "bert" });
  check(found[0].id === "a/b" && found[0].url.endsWith("/a/b"), "search returns shaped repos");
  await api.createRepo("hf_x", { type: "model", name: "new" });
  const body = JSON.parse(seen.at(-1).init.body);
  check(body.private === true && body.name === "new", "a new repo is private unless asked otherwise");
  const out = await api.commitFiles("hf_x", { type: "model", id: "ravi/new", summary: "add", files: [{ path: "README.md", content: "# x" }] });
  check(out.commitOid === "abc", "commit returns the commit");
  check(seen.at(-1).init.headers["Content-Type"] === "application/x-ndjson", "commit is sent as NDJSON");
  const job = await api.runJob("hf_x", { namespace: "ravi", image: "python:3.12", command: ["python", "-c", "print(1)"], flavor: "cpu-basic", timeoutSeconds: 600 });
  const jb = JSON.parse(seen.at(-1).init.body);
  check(job.id === "job1" && jb.dockerImage === "python:3.12" && jb.timeoutSeconds === 600, "runJob posts the documented body");
  let err;
  try { await api.getRepo("hf_x", { type: "model", id: "no/such" }); } catch (e) { err = e; }
  check(err?.status === 404, "a 404 surfaces as a translated error");
  api.setFetch(null);
}
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ml`
Expected: FAIL — `Cannot find module '../lib/server/huggingface.js'`.

- [ ] **Step 3: Implement `lib/server/huggingface.js`**

```js
// Hugging Face — the network half. Every rule worth testing lives in
// hfShape.js; this file only speaks HTTP and translates the answers.
import {
  apiBase, assertFlavor, assertRepoId, assertRepoType, commitNdjson,
  hfError, HfInputError, planCommit, resolvePrefix, searchQuery, shapeRepo,
} from "./hfShape.js";

const HUB = "https://huggingface.co";
const ROUTER = "https://router.huggingface.co";
let fetchImpl = null;
export const setFetch = (fn) => { fetchImpl = fn; };
const doFetch = (...a) => (fetchImpl || fetch)(...a);

async function hf(token, path, { method = "GET", body, raw, headers = {}, base = HUB, role = "" } = {}) {
  const init = { method, headers: { Authorization: `Bearer ${token}`, ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    if (!init.headers["Content-Type"]) init.headers["Content-Type"] = "application/json";
  }
  const res = await doFetch(`${base}${path}`, init);
  if (!res.ok) {
    let b = {};
    try { b = await res.json(); } catch (_) { /* not JSON */ }
    throw hfError(res.status, b, role);
  }
  if (raw) return res;
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

const enc = new TextEncoder();
const toBytes = (f) => {
  if (f.contentBase64) return new Uint8Array(Buffer.from(f.contentBase64, "base64"));
  if (typeof f.content === "string") return enc.encode(f.content);
  throw new HfInputError(`${f.path}: give content (text) or contentBase64.`);
};

export const whoami = (t) => hf(t, "/api/whoami-v2");

export async function search(t, { type = "model", ...q } = {}) {
  const rows = await hf(t, `/api/${apiBase(type)}?${searchQuery(q)}`);
  return (rows || []).map((r) => shapeRepo(r, type));
}

export async function getRepo(t, { type = "model", id }) {
  const r = await hf(t, `/api/${apiBase(type)}/${assertRepoId(id)}`);
  return { ...shapeRepo(r, type), cardData: r.cardData || null, siblings: (r.siblings || []).map((s) => s.rfilename), sha: r.sha || "" };
}

export const listFiles = (t, { type = "model", id, rev = "main", path = "", recursive = false }) =>
  hf(t, `/api/${apiBase(type)}/${assertRepoId(id)}/tree/${encodeURIComponent(rev)}/${path}${recursive ? "?recursive=true" : ""}`);

export const MAX_READ_BYTES = 200 * 1024;

export async function readFile(t, { type = "model", id, rev = "main", path }) {
  const res = await hf(t, `/${resolvePrefix(type)}${assertRepoId(id)}/resolve/${encodeURIComponent(rev)}/${path}`, { raw: true });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_READ_BYTES) {
    return { path, bytes: buf.byteLength, truncated: true, content: new TextDecoder().decode(buf.slice(0, MAX_READ_BYTES)) };
  }
  if (buf.some((b) => b === 0)) return { path, bytes: buf.byteLength, binary: true, content: null };
  return { path, bytes: buf.byteLength, content: new TextDecoder().decode(buf) };
}

export const listCommits = (t, { type = "model", id, rev = "main" }) =>
  hf(t, `/api/${apiBase(type)}/${assertRepoId(id)}/commits/${encodeURIComponent(rev)}`);

export async function createRepo(t, { type = "model", name, organization, private: priv = true, sdk }) {
  assertRepoType(type);
  if (!name || /[\/\s]/.test(name)) throw new HfInputError("Give the repo a bare name (no owner, no spaces).");
  if (type === "space" && !["gradio", "docker", "static"].includes(sdk)) throw new HfInputError("A Space needs sdk: gradio, docker or static.");
  const body = { name, type, private: priv !== false };
  if (organization) body.organization = organization;
  if (sdk) body.sdk = sdk;
  return hf(t, "/api/repos/create", { method: "POST", body, role: "" });
}

export async function commitFiles(t, { type = "model", id, rev = "main", summary, description = "", files = [], deletes = [] }) {
  const repo = assertRepoId(id);
  const withBytes = files.map((f) => ({ path: f.path, bytes: toBytes(f) }));
  // Size and path rules first, so an oversized commit is refused before any request.
  planCommit(withBytes, { files: [] });
  const pre = withBytes.length
    ? await hf(t, `/api/${apiBase(type)}/${repo}/preupload/${encodeURIComponent(rev)}`, {
        method: "POST",
        body: { files: withBytes.map((f) => ({ path: f.path, size: f.bytes.byteLength, sample: Buffer.from(f.bytes.slice(0, 512)).toString("base64") })) },
      })
    : { files: [] };
  planCommit(withBytes, pre);
  return hf(t, `/api/${apiBase(type)}/${repo}/commit/${encodeURIComponent(rev)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-ndjson" },
    body: commitNdjson({ summary, description, files: withBytes, deletes }),
  });
}

export const searchPapers = (t, { q }) => hf(t, `/api/papers/search?q=${encodeURIComponent(q)}`);
export const dailyPapers = (t, { date } = {}) => hf(t, `/api/daily_papers${date ? `?date=${encodeURIComponent(date)}` : ""}`);
export const semanticSearchSpaces = (t, { q }) => hf(t, `/api/spaces/semantic-search?q=${encodeURIComponent(q)}`);
export const searchDocs = (t, { q }) => hf(t, `/api/docs/search?q=${encodeURIComponent(q)}`);

export function listCollections(t, { owner, q, limit = 20 } = {}) {
  const p = new URLSearchParams();
  if (owner) p.set("owner", owner);
  if (q) p.set("q", q);
  p.set("limit", String(Math.min(100, limit)));
  return hf(t, `/api/collections?${p}`);
}
export const getCollection = (t, { slug }) => hf(t, `/api/collections/${slug}`);
export const addToCollection = (t, { slug, itemType, itemId, note }) =>
  hf(t, `/api/collections/${slug}/items`, { method: "POST", body: { item: { type: itemType, id: itemId }, ...(note ? { note } : {}) } });

export const spaceRuntime = (t, { id }) => hf(t, `/api/spaces/${assertRepoId(id)}/runtime`);
export const restartSpace = (t, { id }) => hf(t, `/api/spaces/${assertRepoId(id)}/restart`, { method: "POST" });
export const setSpaceSecret = (t, { id, key, value, description = "" }) =>
  hf(t, `/api/spaces/${assertRepoId(id)}/secrets`, { method: "POST", body: { key, value, description } });

export const inference = (t, { model, messages, maxTokens = 512 }) =>
  hf(t, "/v1/chat/completions", { method: "POST", base: ROUTER, body: { model, messages, max_tokens: maxTokens } });

export const jobsHardware = (t) => hf(t, "/api/jobs/hardware");

export function runJob(t, { namespace, image, spaceId, command, args = [], env = {}, secrets = {}, flavor = "cpu-basic", timeoutSeconds = 1800 }) {
  if (!namespace) throw new HfInputError("Name the namespace (your username) to run the job under.");
  if (!image === !spaceId) throw new HfInputError("Give exactly one of image (a Docker image) or spaceId.");
  if (!Array.isArray(command) || !command.length) throw new HfInputError("command must be a non-empty array, e.g. [\"python\", \"train.py\"].");
  const body = { command, arguments: args, environment: env, flavor: assertFlavor(flavor), timeoutSeconds: Math.max(60, Number(timeoutSeconds) || 1800) };
  if (image) body.dockerImage = image; else body.spaceId = spaceId;
  if (Object.keys(secrets).length) body.secrets = secrets;
  return hf(t, `/api/jobs/${encodeURIComponent(namespace)}`, { method: "POST", body });
}
export const listJobs = (t, { namespace }) => hf(t, `/api/jobs/${encodeURIComponent(namespace)}`);
export const getJob = (t, { namespace, id }) => hf(t, `/api/jobs/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`);
export async function jobLogs(t, { namespace, id, tail = 200 }) {
  const res = await hf(t, `/api/jobs/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/logs`, { raw: true });
  const lines = (await res.text()).split("\n");
  return { lines: lines.slice(-Math.min(2000, tail)), totalLines: lines.length };
}
export const cancelJob = (t, { namespace, id }) =>
  hf(t, `/api/jobs/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/cancel`, { method: "POST" });

export async function usage(t, { startDate, endDate } = {}) {
  const q = new URLSearchParams();
  if (startDate) q.set("startDate", startDate);
  if (endDate) q.set("endDate", endDate);
  const [billing, jobs, zeroGpu] = await Promise.all([
    hf(t, `/api/settings/billing/usage-v2?${q}`).catch((e) => ({ error: e.message })),
    hf(t, "/api/settings/billing/usage/jobs").catch((e) => ({ error: e.message })),
    hf(t, "/api/spaces/zero-gpu/quota").catch((e) => ({ error: e.message })),
  ]);
  return { billing, jobs, zeroGpu };
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:ml`
Expected: all `✓`.

- [ ] **Step 5: Commit**

```bash
git add lib/server/huggingface.js scripts/ml-check.mjs
git commit -m "ml: Hugging Face client (search, repos, commits, collections, spaces, jobs, usage)"
```

---

### Task 5: `kaggleShape.js` — pure Kaggle helpers

**Files:**
- Create: `lib/server/kaggleShape.js`
- Test: `scripts/ml-check.mjs`

**Interfaces:**
- Produces:
  - `class KaggleInputError extends Error` (status 400)
  - `splitRef(ref) → {owner, slug}` (throws on bad `owner/slug`)
  - `ACCELERATORS` alias map; `machineShape(acc) → string|null`
  - `kernelRequest({ref,title,source,kind:"notebook"|"script",language:"python"|"r",accelerator,internet,isPrivate=true,datasets,competitions,kernels,models,timeoutSeconds}) → ApiSaveKernelRequest JSON`
  - `notebookFromCells(cells:{type:"code"|"markdown",source:string}[]) → string` (ipynb JSON text)
  - `normalizeStatus(s) → "queued"|"running"|"complete"|"error"|"cancelled"|"unknown"`
  - `seconds(d) → number` (accepts number, `"123.5s"`, `{seconds,nanos}`)
  - `shapeQuota(resp) → { refreshesAt, gpu:{usedHours,limitHours,leftHours}, tpu:{…} }`
  - `sortFor(kind, sort) → enum string`; `authHeader(token) → "Bearer …"|"Basic …"`
  - `kaggleError(status, body) → Error`

- [ ] **Step 1: Write the failing test** — insert before `// (Tasks 5 and 6 append here.)`:

```js
const kg = await import("../lib/server/kaggleShape.js");

console.log("\nKaggle: refs, accelerators, kernels");
check(kg.splitRef("ravi/titanic-baseline").slug === "titanic-baseline", "owner/slug splits");
throws(() => kg.splitRef("titanic"), "a bare slug is refused", /owner\/slug/);
check(kg.machineShape("T4") === "NvidiaTeslaT4" && kg.machineShape("p100") === "NvidiaTeslaP100", "aliases map to Kaggle's names");
check(kg.machineShape(undefined) === null, "no accelerator is CPU");
throws(() => kg.machineShape("RTX9000"), "an unknown accelerator names the real ones", /T4/);
{
  const r = kg.kernelRequest({ ref: "ravi/exp-1", title: "Exp 1", source: "print(1)", kind: "script", accelerator: "T4", datasets: ["owner/ds"] });
  check(r.slug === "ravi/exp-1" && r.newTitle === "Exp 1" && r.text === "print(1)", "slug, title and text");
  check(r.kernelType === "script" && r.language === "python", "script in python by default");
  check(r.isPrivate === true && r.enableGpu === true && r.machineShape === "NvidiaTeslaT4", "private, GPU on, shape set");
  check(r.datasetDataSources.join() === "owner/ds", "dataset sources pass through");
  check(kg.kernelRequest({ ref: "ravi/x", title: "x", source: "1", kind: "script" }).enableGpu === false, "no accelerator, no GPU");
  throws(() => kg.kernelRequest({ ref: "ravi/x", title: "x", source: "1", kind: "script", isPrivate: false }), "making a kernel public is refused", /private/);
}
{
  const nb = JSON.parse(kg.notebookFromCells([{ type: "markdown", source: "# hi" }, { type: "code", source: "x = 1\nprint(x)" }]));
  check(nb.nbformat === 4 && nb.cells.length === 2 && nb.cells[1].cell_type === "code", "cells build a v4 notebook");
  check(nb.cells[1].source.join("") === "x = 1\nprint(x)", "source round-trips");
}

console.log("\nKaggle: status and quota");
check(kg.normalizeStatus("COMPLETE") === "complete" && kg.normalizeStatus("CANCEL_ACKNOWLEDGED") === "cancelled", "statuses normalise");
check(kg.normalizeStatus("kernelworkerstatus.running") === "running", "a prefixed enum still normalises");
check(kg.normalizeStatus("WAT") === "unknown", "an unknown status is unknown, not an error");
check(kg.seconds("3600s") === 3600 && kg.seconds(90) === 90 && kg.seconds({ seconds: 60, nanos: 5e8 }) === 60.5, "durations parse in every shape");
{
  const q = kg.shapeQuota({ quotaRefreshTime: "2026-10-10T00:00:00Z", gpuQuota: { timeUsed: "36000s", totalTimeAllowed: "108000s" }, tpuQuota: { timeUsed: 0, totalTimeAllowed: "72000s" } });
  check(q.gpu.usedHours === 10 && q.gpu.limitHours === 30 && q.gpu.leftHours === 20, "GPU hours used/limit/left");
  check(q.tpu.leftHours === 20 && q.refreshesAt === "2026-10-10T00:00:00Z", "TPU and refresh time");
}

console.log("\nKaggle: sorting, auth, errors");
check(kg.sortFor("datasets", "votes") === "DATASET_SORT_BY_VOTES", "dataset sort maps");
check(kg.sortFor("kernels", "votes") === "VOTE_COUNT", "kernel sort maps");
throws(() => kg.sortFor("datasets", "stars"), "an unknown sort names the real ones", /hottest/);
check(kg.authHeader("KGAT_abc") === "Bearer KGAT_abc", "a token is a bearer");
check(kg.authHeader("Basic cmF2aTprZXk=") === "Basic cmF2aTprZXk=", "a legacy key stays basic");
check(/repaste|paste/i.test(kg.kaggleError(401, {}).message), "401 says to paste a new token");
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ml` — Expected: FAIL, `Cannot find module '../lib/server/kaggleShape.js'`.

- [ ] **Step 3: Implement `lib/server/kaggleShape.js`**

```js
// Kaggle — the PURE half. Field names follow kagglesdk's request classes
// (camelCase JSON); enum values are sent as their string names.

export class KaggleInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.code = "kaggle/input";
  }
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
export function splitRef(ref) {
  const parts = String(ref || "").trim().split("/");
  if (parts.length !== 2 || !parts.every((p) => SLUG.test(p))) {
    throw new KaggleInputError(`"${ref}" is not a Kaggle reference. Use owner/slug, e.g. ravi/titanic-baseline.`);
  }
  return { owner: parts[0], slug: parts[1] };
}

export const ACCELERATORS = {
  p100: "NvidiaTeslaP100",
  t4: "NvidiaTeslaT4",
  t4x2: "NvidiaTeslaT4",
  t4highmem: "NvidiaTeslaT4Highmem",
  l4: "NvidiaL4",
  l4x1: "NvidiaL4X1",
  a100: "NvidiaTeslaA100",
  h100: "NvidiaH100",
  tpu: "TpuV38",
};
const SHAPES = new Set(Object.values(ACCELERATORS));

export function machineShape(acc) {
  if (!acc) return null;
  if (SHAPES.has(acc)) return acc;
  const hit = ACCELERATORS[String(acc).toLowerCase()];
  if (!hit) throw new KaggleInputError(`Unknown accelerator "${acc}". Use one of ${Object.keys(ACCELERATORS).map((k) => k.toUpperCase()).join(", ")} (free tier: P100, T4).`);
  return hit;
}

export function kernelRequest({
  ref, title, source, kind = "notebook", language = "python", accelerator,
  internet = true, isPrivate = true, datasets = [], competitions = [], kernels = [], models = [], timeoutSeconds,
}) {
  splitRef(ref);
  if (isPrivate === false) throw new KaggleInputError("Kernels are kept private here; publish one from kaggle.com if you mean to.");
  if (!["notebook", "script"].includes(kind)) throw new KaggleInputError("kind must be notebook or script.");
  if (!["python", "r"].includes(language)) throw new KaggleInputError("language must be python or r.");
  if (!title) throw new KaggleInputError("A kernel needs a title.");
  if (!source) throw new KaggleInputError("A kernel needs source (notebook JSON or script text).");
  const shape = machineShape(accelerator);
  const req = {
    slug: ref,
    newTitle: title,
    text: source,
    language,
    kernelType: kind,
    isPrivate: true,
    enableGpu: !!shape && shape !== "TpuV38",
    enableTpu: shape === "TpuV38",
    enableInternet: !!internet,
    datasetDataSources: datasets,
    competitionDataSources: competitions,
    kernelDataSources: kernels,
    modelDataSources: models,
  };
  if (shape) req.machineShape = shape;
  if (timeoutSeconds) req.sessionTimeoutSeconds = Math.max(60, Number(timeoutSeconds));
  return req;
}

export function notebookFromCells(cells = []) {
  const lines = (s) => String(s).split(/(?<=\n)/);
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { name: "python3", display_name: "Python 3", language: "python" }, language_info: { name: "python" } },
    cells: cells.map((c) =>
      c.type === "markdown"
        ? { cell_type: "markdown", metadata: {}, source: lines(c.source) }
        : { cell_type: "code", metadata: {}, execution_count: null, outputs: [], source: lines(c.source) }
    ),
  });
}

const STATUS = {
  QUEUED: "queued", NEW_SCRIPT: "queued", RUNNING: "running", COMPLETE: "complete",
  ERROR: "error", CANCEL_REQUESTED: "cancelled", CANCEL_ACKNOWLEDGED: "cancelled",
};
export function normalizeStatus(s) {
  const key = String(s || "").split(".").pop().toUpperCase();
  return STATUS[key] || "unknown";
}

export function seconds(d) {
  if (d == null) return 0;
  if (typeof d === "number") return d;
  if (typeof d === "string") return parseFloat(d) || 0;
  if (typeof d === "object") return (Number(d.seconds) || 0) + (Number(d.nanos) || 0) / 1e9;
  return 0;
}

const hours = (s) => Math.round((s / 3600) * 100) / 100;
const quotaOf = (q = {}) => {
  const used = seconds(q.timeUsed);
  const limit = seconds(q.totalTimeAllowed);
  return { usedHours: hours(used), limitHours: hours(limit), leftHours: hours(Math.max(0, limit - used)) };
};
export function shapeQuota(r = {}) {
  return { refreshesAt: r.quotaRefreshTime || "", gpu: quotaOf(r.gpuQuota), tpu: quotaOf(r.tpuQuota) };
}

const SORTS = {
  datasets: { hottest: "DATASET_SORT_BY_HOTTEST", votes: "DATASET_SORT_BY_VOTES", updated: "DATASET_SORT_BY_UPDATED", active: "DATASET_SORT_BY_ACTIVE", published: "DATASET_SORT_BY_PUBLISHED", relevance: "DATASET_SORT_BY_RELEVANCE", usability: "DATASET_SORT_BY_USABILITY", downloads: "DATASET_SORT_BY_DOWNLOAD_COUNT" },
  competitions: { grouped: "COMPETITION_SORT_BY_GROUPED", best: "COMPETITION_SORT_BY_BEST", prize: "COMPETITION_SORT_BY_PRIZE", deadline: "COMPETITION_SORT_BY_EARLIEST_DEADLINE", teams: "COMPETITION_SORT_BY_NUMBER_OF_TEAMS", relevance: "COMPETITION_SORT_BY_RELEVANCE", recent: "COMPETITION_SORT_BY_RECENTLY_CREATED" },
  kernels: { hotness: "HOTNESS", comments: "COMMENT_COUNT", created: "DATE_CREATED", run: "DATE_RUN", relevance: "RELEVANCE", score: "SCORE_DESCENDING", views: "VIEW_COUNT", votes: "VOTE_COUNT" },
  models: { hotness: "LIST_MODELS_ORDER_BY_HOTNESS", downloads: "LIST_MODELS_ORDER_BY_DOWNLOAD_COUNT", votes: "LIST_MODELS_ORDER_BY_VOTE_COUNT", notebooks: "LIST_MODELS_ORDER_BY_NOTEBOOK_COUNT", published: "LIST_MODELS_ORDER_BY_PUBLISH_TIME", updated: "LIST_MODELS_ORDER_BY_UPDATE_TIME" },
};
export function sortFor(kind, sort) {
  if (!sort) return undefined;
  const hit = SORTS[kind]?.[sort];
  if (!hit) throw new KaggleInputError(`Unknown sort "${sort}" for ${kind}. Use one of ${Object.keys(SORTS[kind] || {}).join(", ")}.`);
  return hit;
}
export const SORT_NAMES = Object.fromEntries(Object.entries(SORTS).map(([k, v]) => [k, Object.keys(v)]));

// A legacy kaggle.json key is stored pre-encoded as "Basic …" so the rest of
// the system can treat every credential as one opaque string.
export const authHeader = (token) => (String(token).startsWith("Basic ") ? String(token) : `Bearer ${token}`);

export function kaggleError(status, body = {}) {
  const said = body.message || body.error || "";
  let msg;
  if (status === 401) msg = "Kaggle rejected the stored token (401). It expired or was revoked — generate a new one at kaggle.com/settings and paste it in the Accounts tab.";
  else if (status === 403) msg = `Kaggle refused this (403)${said ? `: ${said}` : ""}. For a competition, accept its rules on kaggle.com first.`;
  else if (status === 404) msg = `Not found on Kaggle${said ? `: ${said}` : ""}.`;
  else if (status === 429) msg = "Kaggle rate-limited this request (429). Wait and retry.";
  else msg = `Kaggle answered ${status}${said ? `: ${said}` : ""}.`;
  const e = new Error(msg);
  e.status = status;
  e.code = `kaggle/${status}`;
  return e;
}
```

- [ ] **Step 4: Run tests** — `npm run test:ml` → all `✓`.

- [ ] **Step 5: Commit**

```bash
git add lib/server/kaggleShape.js scripts/ml-check.mjs
git commit -m "ml: pure Kaggle helpers (kernels, accelerators, quota, sorts)"
```

---

### Task 6: `kaggle.js` client + pasted-key parsing (`mlKeys.js`)

**Files:**
- Create: `lib/server/kaggle.js`
- Create: `lib/server/mlKeys.js`
- Test: `scripts/ml-check.mjs`

**Interfaces:**
- Consumes: `kaggleShape.js` (Task 5), `huggingface.whoami` (Task 4).
- Produces:
  - `kaggle.js`: `setFetch(fn)`, `call(token, service, method, body)`, `introspect(token)`, `searchDatasets(t,{search,sort,user,page,pageSize})`, `searchCompetitions(t,{search,sort,category,page})`, `searchKernels(t,{search,sort,user,competition,dataset,page,pageSize})`, `searchModels(t,{search,sort,owner,pageSize})`, `getDataset(t,{ref})`, `listDatasetFiles(t,{ref})`, `getCompetition(t,{name})`, `leaderboard(t,{name,pageSize})`, `listSubmissions(t,{name})`, `pushKernel(t, kernelRequestJson)`, `kernelStatus(t,{ref})`, `kernelOutput(t,{ref})`, `getKernel(t,{ref})`, `cancelKernel(t,{sessionId})`, `quota(t)`, `uploadBlob(t,{kind:"dataset"|"submission", competition?, fileName, bytes})`, `createDatasetVersion(t,{ref,notes,files})`, `submit(t,{competition,fileName,bytes,description})`.
  - `mlKeys.js`: `KeyError`, `parseKey(provider, raw) → {accessToken}` (Kaggle legacy → `accessToken: "Basic <b64>"`, plus `legacyUser`), `credentialMaterial(provider, accessToken) → object`, `identify(provider, cred) → {accountId,label,email,scope,warning}`.

- [ ] **Step 1: Write the failing tests** — insert before `// (Tasks 5 and 6 append here.)`:

```js
console.log("\npasted keys");
{
  const k = await import("../lib/server/mlKeys.js");
  check(k.parseKey("huggingface", "  hf_" + "a".repeat(34) + "\n").accessToken === "hf_" + "a".repeat(34), "an HF token is trimmed");
  throws(() => k.parseKey("huggingface", "sk-123"), "a non-HF token is refused with where to get one", /huggingface\.co\/settings\/tokens/);
  const legacy = k.parseKey("kaggle", '\r\n{"username":"ravi","key":"0123456789abcdef"}\r\n');
  check(legacy.accessToken === "Basic " + Buffer.from("ravi:0123456789abcdef").toString("base64") && legacy.legacyUser === "ravi", "kaggle.json becomes a basic credential");
  check(k.parseKey("kaggle", "KGAT_" + "b".repeat(30)).accessToken.startsWith("KGAT_"), "a Kaggle token stays a token");
  throws(() => k.parseKey("kaggle", '{"username":"ravi"}'), "kaggle.json without a key is refused", /key/);
  throws(() => k.parseKey("kaggle", ""), "an empty paste is refused", /Paste/);
  throws(() => k.parseKey("github", "x"), "an OAuth provider cannot take a pasted key", /not connected with a pasted token/);
  const m1 = k.credentialMaterial("huggingface", "hf_x");
  check(m1.env.HF_TOKEN === "hf_x", "HF material is HF_TOKEN");
  const m2 = k.credentialMaterial("kaggle", "Basic " + Buffer.from("ravi:key1").toString("base64"));
  check(m2.kaggleJson.username === "ravi" && m2.kaggleJson.key === "key1", "a legacy Kaggle key becomes kaggle.json again");
  check(k.credentialMaterial("kaggle", "KGAT_x").env.KAGGLE_API_TOKEN === "KGAT_x", "a Kaggle token becomes KAGGLE_API_TOKEN");
}

console.log("\nKaggle client (stubbed network)");
{
  const api = await import("../lib/server/kaggle.js");
  const seen = [];
  api.setFetch(async (url, init = {}) => {
    seen.push({ url: String(url), init });
    const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b, text: async () => JSON.stringify(b) });
    if (String(url).endsWith("/IntrospectToken")) return json({ active: true, username: "ravi" });
    if (String(url).endsWith("/GetAcceleratorQuotaStatistics")) return json({ gpuQuota: { timeUsed: "3600s", totalTimeAllowed: "108000s" } });
    if (String(url).endsWith("/GetKernelSessionStatus")) return json({ status: "RUNNING" });
    if (String(url).endsWith("/SaveKernel")) return json({ ref: "ravi/exp-1", url: "https://www.kaggle.com/code/ravi/exp-1", versionNumber: 1 });
    return json({ message: "no" }, 404);
  });
  const who = await api.introspect("KGAT_x");
  check(who.username === "ravi", "introspect returns the username");
  check(seen[0].url === "https://api.kaggle.com/v1/security.OAuthService/IntrospectToken", "RPC url is service/method");
  check(seen[0].init.method === "POST" && seen[0].init.headers.Authorization === "Bearer KGAT_x", "POST with a bearer token");
  check(JSON.parse(seen[0].init.body).token === "KGAT_x", "the token is introspected in the body");
  const q = await api.quota("KGAT_x");
  check(q.gpu.usedHours === 1 && q.gpu.leftHours === 29, "quota comes back shaped");
  const st = await api.kernelStatus("KGAT_x", { ref: "ravi/exp-1" });
  const sb = JSON.parse(seen.at(-1).init.body);
  check(st.status === "running" && sb.userName === "ravi" && sb.kernelSlug === "exp-1", "status asks by userName + kernelSlug");
  const pushed = await api.pushKernel("KGAT_x", { slug: "ravi/exp-1", newTitle: "x", text: "1", kernelType: "script", language: "python", isPrivate: true });
  check(pushed.url.includes("/code/ravi/exp-1"), "push returns the kernel url");
  let err;
  try { await api.getDataset("KGAT_x", { ref: "no/such" }); } catch (e) { err = e; }
  check(err?.status === 404, "a 404 surfaces translated");
  api.setFetch(null);
}
```

- [ ] **Step 2: Run to verify failure** — `npm run test:ml` → FAIL, missing `mlKeys.js`.

- [ ] **Step 3: Implement `lib/server/kaggle.js`**

```js
// Kaggle — the network half. kagglesdk's convention, read from its source:
// every call is POST https://api.kaggle.com/v1/<service>/<Method> with a JSON
// body, authenticated by a bearer token (or HTTP Basic for a legacy key).
import { authHeader, kaggleError, KaggleInputError, normalizeStatus, shapeQuota, sortFor, splitRef } from "./kaggleShape.js";

const BASE = "https://api.kaggle.com/v1";
let fetchImpl = null;
export const setFetch = (fn) => { fetchImpl = fn; };
const doFetch = (...a) => (fetchImpl || fetch)(...a);

export async function call(token, service, method, body = {}) {
  const res = await doFetch(`${BASE}/${service}/${method}`, {
    method: "POST",
    headers: { Authorization: authHeader(token), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let b = {};
    try { b = await res.json(); } catch (_) { /* not JSON */ }
    throw kaggleError(res.status, b);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

const K = "kernels.KernelsApiService";
const D = "datasets.DatasetApiService";
const C = "competitions.CompetitionApiService";
const M = "models.ModelApiService";

export const introspect = (t) => call(t, "security.OAuthService", "IntrospectToken", { token: t });

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && v !== null));

export const searchDatasets = (t, { search, sort, user, page = 1, pageSize = 20 } = {}) =>
  call(t, D, "ListDatasets", clean({ search, sortBy: sortFor("datasets", sort), user, page, pageSize: Math.min(100, pageSize) }));
export const searchCompetitions = (t, { search, sort, category, page = 1 } = {}) =>
  call(t, C, "ListCompetitions", clean({ search, sortBy: sortFor("competitions", sort), category, page }));
export const searchKernels = (t, { search, sort, user, competition, dataset, page = 1, pageSize = 20 } = {}) =>
  call(t, K, "ListKernels", clean({ search, sortBy: sortFor("kernels", sort), user, competition, dataset, page, pageSize: Math.min(100, pageSize) }));
export const searchModels = (t, { search, sort, owner, pageSize = 20 } = {}) =>
  call(t, M, "ListModels", clean({ search, sortBy: sortFor("models", sort), owner, pageSize: Math.min(100, pageSize) }));

export function getDataset(t, { ref }) {
  const { owner, slug } = splitRef(ref);
  return call(t, D, "GetDataset", { ownerSlug: owner, datasetSlug: slug });
}
export function listDatasetFiles(t, { ref }) {
  const { owner, slug } = splitRef(ref);
  return call(t, D, "ListDatasetFiles", { ownerSlug: owner, datasetSlug: slug, pageSize: 200 });
}
export const getCompetition = (t, { name }) => call(t, C, "GetCompetition", { competitionName: name });
export const leaderboard = (t, { name, pageSize = 50 }) => call(t, C, "GetLeaderboard", { competitionName: name, pageSize });
export const listSubmissions = (t, { name }) => call(t, C, "ListSubmissions", { competitionName: name, pageSize: 50 });

export const pushKernel = (t, request) => call(t, K, "SaveKernel", request);

export async function kernelStatus(t, { ref }) {
  const { owner, slug } = splitRef(ref);
  const r = await call(t, K, "GetKernelSessionStatus", { userName: owner, kernelSlug: slug });
  return { ref, status: normalizeStatus(r.status), raw: r.status || "", failureMessage: r.failureMessage || "" };
}
export async function kernelOutput(t, { ref }) {
  const { owner, slug } = splitRef(ref);
  const r = await call(t, K, "ListKernelSessionOutput", { userName: owner, kernelSlug: slug, pageSize: 100 });
  return { files: (r.files || []).map((f) => ({ name: f.fileName, url: f.url })), log: r.log || "", next: r.nextPageToken || "" };
}
export function getKernel(t, { ref }) {
  const { owner, slug } = splitRef(ref);
  return call(t, K, "GetKernel", { userName: owner, kernelSlug: slug });
}
export const cancelKernel = (t, { sessionId }) => call(t, K, "CancelKernelSession", { kernelSessionId: Number(sessionId) });
export const quota = async (t) => shapeQuota(await call(t, K, "GetAcceleratorQuotaStatistics", {}));

// Uploads are two steps: ask for a signed URL + token, PUT the bytes there,
// then hand the token to the create call.
export async function uploadBlob(t, { kind, competition, fileName, bytes }) {
  const meta = { fileName, contentLength: bytes.byteLength, lastModifiedEpochSeconds: Math.floor(Date.now() / 1000) };
  const start = kind === "submission"
    ? await call(t, C, "StartSubmissionUpload", { competitionName: competition, ...meta })
    : await call(t, D, "UploadDatasetFile", meta);
  if (!start.createUrl || !start.token) throw new KaggleInputError("Kaggle did not return an upload URL.");
  const put = await doFetch(start.createUrl, { method: "PUT", body: bytes, headers: { "Content-Type": "application/octet-stream" } });
  if (!put.ok) throw kaggleError(put.status, {});
  return start.token;
}

export async function createDatasetVersion(t, { ref, notes, files }) {
  const { owner, slug } = splitRef(ref);
  const tokens = [];
  for (const f of files) tokens.push({ token: await uploadBlob(t, { kind: "dataset", fileName: f.name, bytes: f.bytes }) });
  return call(t, D, "CreateDatasetVersion", { ownerSlug: owner, datasetSlug: slug, body: { versionNotes: notes || "Update", files: tokens } });
}

export async function submit(t, { competition, fileName, bytes, description }) {
  const token = await uploadBlob(t, { kind: "submission", competition, fileName, bytes });
  return call(t, C, "CreateSubmission", { competitionName: competition, blobFileTokens: token, submissionDescription: description || "" });
}
```

- [ ] **Step 4: Implement `lib/server/mlKeys.js`**

```js
// Pasted-token accounts. Parsing and credential shaping are pure; identify()
// is the one network call, made BEFORE anything is stored, so a bad key never
// becomes a row.
import { whoami as hfWhoami } from "./huggingface.js";
import { introspect, quota } from "./kaggle.js";

export class KeyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.code = "account/bad-key";
  }
}

export function parseKey(provider, raw) {
  const text = String(raw || "").trim();
  if (provider !== "huggingface" && provider !== "kaggle") {
    throw new KeyError(`${provider} is not connected with a pasted token.`);
  }
  if (!text) throw new KeyError("Paste a token first.");
  if (provider === "huggingface") {
    if (!/^hf_[A-Za-z0-9]{20,}$/.test(text)) {
      throw new KeyError("A Hugging Face token starts with hf_ — create one at huggingface.co/settings/tokens.");
    }
    return { accessToken: text };
  }
  if (text.startsWith("{")) {
    let j;
    try { j = JSON.parse(text); } catch (_) { throw new KeyError("That looks like kaggle.json but is not valid JSON."); }
    if (!j.username) throw new KeyError('kaggle.json needs a "username".');
    if (!j.key) throw new KeyError('kaggle.json needs a "key".');
    const user = String(j.username).trim();
    return { accessToken: `Basic ${Buffer.from(`${user}:${String(j.key).trim()}`).toString("base64")}`, legacyUser: user };
  }
  if (/\s/.test(text) || text.length < 20) {
    throw new KeyError("A Kaggle token is one long string from kaggle.com/settings → API → Generate New Token, or paste the whole kaggle.json.");
  }
  return { accessToken: text };
}

// What a local CLI needs, from the one stored string.
export function credentialMaterial(provider, accessToken) {
  if (provider === "huggingface") return { env: { HF_TOKEN: accessToken } };
  if (String(accessToken).startsWith("Basic ")) {
    const [username, ...rest] = Buffer.from(accessToken.slice(6), "base64").toString("utf8").split(":");
    const key = rest.join(":");
    return { kaggleJson: { username, key }, env: { KAGGLE_USERNAME: username, KAGGLE_KEY: key } };
  }
  return { env: { KAGGLE_API_TOKEN: accessToken } };
}

export async function identify(provider, cred) {
  if (provider === "huggingface") {
    const j = await hfWhoami(cred.accessToken).catch((e) => {
      throw new KeyError(e.status === 401 ? "Hugging Face rejected that token. Create a new one and paste it again." : e.message, e.status === 401 ? 400 : 502);
    });
    const role = j.auth?.accessToken?.role || "";
    return {
      accountId: j.name,
      label: j.fullname || j.name,
      email: j.email || "",
      scope: role,
      warning: role === "read" ? "This is a read token: search and reading work, but creating repos, committing and running Jobs need a write or fine-grained token." : "",
    };
  }
  if (cred.legacyUser) {
    // A legacy key cannot be introspected; the quota call needs a real
    // signed-in user, so it proves the key is live.
    await quota(cred.accessToken).catch((e) => {
      throw new KeyError(e.status === 401 ? "Kaggle rejected that kaggle.json. Generate a new token and paste it." : e.message, e.status === 401 ? 400 : 502);
    });
    return { accountId: cred.legacyUser, label: cred.legacyUser, email: "", scope: "legacy-key", warning: "" };
  }
  const j = await introspect(cred.accessToken).catch((e) => {
    throw new KeyError(e.status === 401 ? "Kaggle rejected that token. Generate a new one and paste it." : e.message, e.status === 401 ? 400 : 502);
  });
  if (!j.active || !j.username) throw new KeyError("Kaggle says that token is not active. Generate a new one.");
  return { accountId: j.username, label: j.username, email: "", scope: j.scope || "", warning: "" };
}
```

- [ ] **Step 5: Run tests** — `npm run test:ml` → all `✓`.

- [ ] **Step 6: Commit**

```bash
git add lib/server/kaggle.js lib/server/mlKeys.js scripts/ml-check.mjs
git commit -m "ml: Kaggle RPC client and pasted-key parsing/identity"
```

---

### Task 7: Connect by paste — `/api/accounts` actions + Accounts panel

**Files:**
- Modify: `pages/api/accounts.js` (imports; `providerSummary`; new actions before `return res.status(400)…Unknown action`)
- Modify: `lib/accountsClient.js` (add `connectKey`, `setAgentReadable`)
- Modify: `components/admin/AccountsPanel.js` (connect section :364-395; styles)
- Modify: `scripts/e2e-check.js` — only if it holds the `e2e:tasks` anonymous-refusal list for `/api/accounts`; add `connectKey` and `setAgentReadable` to that list.

**Interfaces:**
- Consumes: `parseKey`, `identify`, `KeyError` (Task 6); `seal`, `getProvider`, `isSealConfigured` (integrations); `connectedRecord`, `accountPath` (connectedStore).
- Produces: POST `/api/accounts {action:"connectKey", provider, key}` → `{connected:{provider,accountId,label,scope}, warning}`; `{action:"setAgentReadable", provider, accountId, value:boolean}` → `{provider,accountId,agentReadable}`. Account rows gain `agentReadable: boolean`.

- [ ] **Step 1: Implement the route actions**

Add imports to `pages/api/accounts.js`:
```js
import { PROVIDERS, providerConfig, getProvider, seal, isSealConfigured } from "../../lib/server/integrations";
import { accountPath, connectedRecord } from "../../lib/server/connectedStore";
import { parseKey, identify, KeyError } from "../../lib/server/mlKeys";
```
(replace the two existing import lines for `integrations` and `connectedStore`.)

In `providerSummary()` add to the returned object:
```js
      auth: p.auth || "oauth",
      keyHint: p.keyHint || "",
      tokenPage: p.tokenPage || "",
```
Before the final `Unknown action` return, add:
```js
    /*
     * Pasted-token accounts (Hugging Face, Kaggle). The key is checked with
     * the provider FIRST — the account id comes from the provider's answer,
     * never from the form — then sealed and written as the admin. Nothing
     * about the key is echoed back or written to the audit log.
     */
    if (action === "connectKey") {
      const p = getProvider(req.body.provider);
      if (p.auth !== "apiKey") {
        return res.status(400).json({ error: `${p.label} connects through its consent screen, not a pasted token.` });
      }
      if (!isSealConfigured()) {
        return res.status(503).json({ error: "Tokens cannot be stored until INTEGRATION_SECRET is set.", code: "integrations/not-configured" });
      }
      const cred = parseKey(p.id, req.body.key);
      const who = await identify(p.id, cred);
      const path = accountPath(p.id, who.accountId);
      const existing = await getDocument(idToken, path).catch(() => null);
      const record = connectedRecord({
        provider: p.id,
        accountId: who.accountId,
        label: who.label,
        sealed: seal({ accessToken: cred.accessToken }, "refresh"),
        kind: "access",
        expiresAt: "",
        scope: who.scope,
        email: who.email,
        identityId: existing?.identityId || "",
      });
      record.agentReadable = existing?.agentReadable === true;
      await patchDocument(idToken, path, record);
      await audit(idToken, claims, "account.connectKey", `${p.id}:${who.accountId}`, existing ? "token replaced" : "connected");
      return res.status(200).json({
        connected: { provider: p.id, accountId: who.accountId, label: who.label, scope: who.scope },
        warning: who.warning,
      });
    }

    if (action === "setAgentReadable") {
      const p = getProvider(req.body.provider);
      if (p.auth !== "apiKey") return res.status(400).json({ error: "Only pasted-token accounts can be exported to an agent." });
      const { accountId } = req.body;
      if (!accountId) return res.status(400).json({ error: "Name the account." });
      const value = req.body.value === true;
      const path = accountPath(p.id, accountId);
      if (!(await getDocument(idToken, path).catch(() => null))) {
        return res.status(404).json({ error: `No ${p.label} account "${accountId}" is connected.` });
      }
      await patchDocument(idToken, path, { agentReadable: value });
      await audit(idToken, claims, "account.agentReadable", `${p.id}:${accountId}`, value ? "on" : "off");
      return res.status(200).json({ provider: p.id, accountId, agentReadable: value });
    }
```
In the `catch`, before the generic return, add:
```js
    if (e instanceof KeyError) return res.status(e.status).json({ error: e.message, code: e.code });
```

- [ ] **Step 2: Client helpers** — append to `lib/accountsClient.js`:
```js
export const connectKey = (provider, key) => call({ action: "connectKey", provider, key });
export const setAgentReadable = (provider, accountId, value) =>
  call({ action: "setAgentReadable", provider, accountId, value: value === true });
```

- [ ] **Step 3: Panel paste row** — in `AccountsPanel.js` add `connectKey, setAgentReadable` to the `accountsClient` import, and add a component above the panel's default export:
```jsx
// A pasted-token provider has no consent screen to send you to, so its row is
// the form itself. The key is never kept in state after it is sent.
function KeyConnect({ p, held, onDone }) {
  const [key, setKey] = useState("");
  const [state, setState] = useState({ busy: false, err: "", note: "" });
  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true, err: "", note: "" });
    try {
      const out = await connectKey(p.id, key);
      setKey("");
      setState({ busy: false, err: "", note: `${out.connected.label} connected.${out.warning ? ` ${out.warning}` : ""}` });
      onDone();
    } catch (er) {
      setState({ busy: false, err: er.message, note: "" });
    }
  };
  return (
    <li className={`ac-prov ac-key${p.configured ? "" : " off"}`}>
      <form onSubmit={submit}>
        <span className="ac-prov-name">{p.label}</span>
        <span className="ac-prov-held">{held ? `${held} connected` : p.configured ? "Paste a token" : `Needs ${p.missing.join(", ")}`}</span>
        <input
          className="admin-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={p.keyHint}
          value={key}
          disabled={!p.configured || state.busy}
          onChange={(e) => setKey(e.target.value)}
        />
        <button type="submit" disabled={!p.configured || !key.trim() || state.busy}>
          {state.busy ? "Checking…" : "Connect"}
        </button>
        {p.tokenPage ? (
          <a href={p.tokenPage} target="_blank" rel="noreferrer" className="ac-key-link">Get a token</a>
        ) : null}
        {state.err ? <p className="ac-key-err">{state.err}</p> : null}
        {state.note ? <p className="ac-key-note">{state.note}</p> : null}
      </form>
    </li>
  );
}
```
In the connect section's `providers.map`, return `<KeyConnect key={p.id} p={p} held={held} onDone={refresh} />` when `p.auth === "apiKey"`, else the existing `<li>`.

In each account row of the roster (where per-account controls such as the identity `<select>` render), for rows whose provider is `huggingface` or `kaggle` and that are not legacy, add:
```jsx
<label className="ac-agent">
  <input
    type="checkbox"
    checked={account.agentReadable === true}
    onChange={(e) =>
      act("Saving…", () => setAgentReadable(account.provider, account.accountId, e.target.checked))
    }
  />
  Agent may read this token
</label>
```
(`account` is the row variable used in that map; `act` already exists at :169. If `accountShape` in `accountDirectory.js` drops unknown fields, add `agentReadable: a.agentReadable === true` to its returned object.)

Styles (inside the panel's `<Styles />` block):
```css
.ac-key form { display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; padding: 12px 14px; border: 1px solid var(--ad-line, #2a2a2a); }
.ac-key .admin-input { grid-column: 1 / -1; font-family: "JetBrains Mono", monospace; }
.ac-key button { grid-column: 1; justify-self: start; }
.ac-key-link { grid-column: 2; align-self: center; font-size: 13px; }
.ac-key-err { grid-column: 1 / -1; color: #ff6b6b; margin: 0; font-size: 13px; }
.ac-key-note { grid-column: 1 / -1; margin: 0; font-size: 13px; }
.ac-agent { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; }
```

- [ ] **Step 4: Verify in the browser**

With `next dev` running from this worktree: open `http://localhost:3000/admin?tab=accounts`. Expected: "Hugging Face" and "Kaggle" rows show a token field. Paste `hf_bad` → inline error naming huggingface.co/settings/tokens, nothing stored. Then run `node scripts/accounts-check.mjs && npm run test:ml` → all `✓`.

- [ ] **Step 5: Commit**

```bash
git add pages/api/accounts.js lib/accountsClient.js components/admin/AccountsPanel.js lib/server/accountDirectory.js
git commit -m "accounts: connect Hugging Face and Kaggle by pasted token"
```

---

### Task 8: MCP — Hugging Face family in `lib/server/mlTools.js`

**Files:**
- Create: `lib/server/mlTools.js`
- Modify: `lib/server/mcpTools.js` (import + spread at the end of `TOOLS`)
- Modify: `scripts/mcp-check.mjs` (`EXPECTED.huggingface`)

**Interfaces:**
- Consumes: `directory.tokenFor` (`./accountDirectory.js`), `./huggingface.js` (Task 4).
- Produces: `export const ML_TOOLS = [...]`; `export async function mlCtx(idToken, provider, accountId) → {token, account}`.

- [ ] **Step 1: Pin the family first** — add to `EXPECTED` in `scripts/mcp-check.mjs`:
```js
    huggingface: [
      "hf_whoami", "hf_search", "hf_search_papers", "hf_daily_papers", "hf_semantic_search_spaces", "hf_search_docs",
      "hf_get_repo", "hf_list_files", "hf_read_file", "hf_list_commits", "hf_list_my_repos",
      "hf_list_collections", "hf_get_collection", "hf_create_repo", "hf_commit_files", "hf_delete_file",
      "hf_add_to_collection", "hf_space_status", "hf_restart_space", "hf_set_space_secret", "hf_inference",
      "hf_jobs_hardware", "hf_run_job", "hf_list_jobs", "hf_get_job", "hf_job_logs", "hf_cancel_job", "hf_usage",
    ],
```
Run: `npm run mcp:check` → Expected: `✗ every huggingface tool is still registered`.

- [ ] **Step 2: Create `lib/server/mlTools.js`**

```js
// MCP tools for the ML lab: Hugging Face and Kaggle. Kept out of mcpTools.js
// (already ~4,700 lines) and spread into TOOLS there, so the registry, scope
// filtering and mcp:check treat them exactly like every other family.
import * as directory from "./accountDirectory.js";
import * as hf from "./huggingface.js";

const str = { type: "string" };
const accountArg = { type: "string", description: "Which connected account. Optional when only one of that provider is connected." };
const repoType = { type: "string", enum: ["model", "dataset", "space"], description: "Default model." };

export async function mlCtx(idToken, provider, accountId) {
  return directory.tokenFor(idToken, { service: "ml", provider, accountId });
}
const hfTok = async (idToken, accountId) => (await mlCtx(idToken, "huggingface", accountId)).token;
const hfMe = async (idToken, accountId) => {
  const { token, account } = await mlCtx(idToken, "huggingface", accountId);
  return { token, me: account.accountId };
};

const HF_TOOLS = [
  {
    name: "hf_whoami",
    description: "The connected Hugging Face account: username, orgs, token role (read/write/fineGrained). Start here to see which account a tool will act as.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg } },
    handler: async (a, { idToken }) => {
      const j = await hf.whoami(await hfTok(idToken, a.accountId));
      return { name: j.name, fullname: j.fullname, orgs: (j.orgs || []).map((o) => o.name), role: j.auth?.accessToken?.role || "", isPro: !!j.isPro };
    },
  },
  {
    name: "hf_search",
    description: "Search the Hugging Face Hub for models, datasets or Spaces (type: model|dataset|space|all). Filter by author or tags (e.g. text-classification, pytorch), sort by downloads|likes|trendingScore|lastModified|createdAt, limit ≤ 100.",
    scope: "read",
    inputSchema: {
      type: "object",
      properties: {
        accountId: accountArg,
        type: { type: "string", enum: ["model", "dataset", "space", "all"] },
        search: str, author: str,
        filter: { type: "array", items: str },
        sort: str, limit: { type: "number" },
      },
    },
    handler: async (a, { idToken }) => {
      const t = await hfTok(idToken, a.accountId);
      const q = { search: a.search, author: a.author, filter: a.filter, sort: a.sort, limit: a.limit };
      if ((a.type || "model") !== "all") return hf.search(t, { type: a.type || "model", ...q });
      const [models, datasets, spaces] = await Promise.all(["model", "dataset", "space"].map((type) => hf.search(t, { type, ...q })));
      return { models, datasets, spaces };
    },
  },
  {
    name: "hf_search_papers",
    description: "Search papers indexed on Hugging Face (arXiv-backed) by free text. Returns ids, titles, summaries and linked repos.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, q: str }, required: ["q"] },
    handler: async (a, { idToken }) => hf.searchPapers(await hfTok(idToken, a.accountId), { q: a.q }),
  },
  {
    name: "hf_daily_papers",
    description: "Hugging Face's daily papers feed, optionally for a date (YYYY-MM-DD). Good for staying current on what is new.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, date: str } },
    handler: async (a, { idToken }) => hf.dailyPapers(await hfTok(idToken, a.accountId), { date: a.date }),
  },
  {
    name: "hf_semantic_search_spaces",
    description: "Semantic (meaning-based) search over Hugging Face Spaces — 'a demo that removes image backgrounds' finds apps whose names never say so.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, q: str }, required: ["q"] },
    handler: async (a, { idToken }) => hf.semanticSearchSpaces(await hfTok(idToken, a.accountId), { q: a.q }),
  },
  {
    name: "hf_search_docs",
    description: "Search Hugging Face documentation (transformers, datasets, hub, …) and return matching pages.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, q: str }, required: ["q"] },
    handler: async (a, { idToken }) => hf.searchDocs(await hfTok(idToken, a.accountId), { q: a.q }),
  },
  {
    name: "hf_get_repo",
    description: "One Hugging Face repo (model, dataset or Space): card data, file list, downloads, likes, tags, gating, last commit sha.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, type: repoType, id: str }, required: ["id"] },
    handler: async (a, { idToken }) => hf.getRepo(await hfTok(idToken, a.accountId), { type: a.type, id: a.id }),
  },
  {
    name: "hf_list_files",
    description: "List files in a Hugging Face repo at a revision and path, with sizes; recursive optional.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, type: repoType, id: str, rev: str, path: str, recursive: { type: "boolean" } }, required: ["id"] },
    handler: async (a, { idToken }) => hf.listFiles(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_read_file",
    description: "Read a text file from a Hugging Face repo (README, config.json, metrics). Text only, first 200 KB; a binary file returns its size and no content.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, type: repoType, id: str, rev: str, path: str }, required: ["id", "path"] },
    handler: async (a, { idToken }) => hf.readFile(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_list_commits",
    description: "Commit history of a Hugging Face repo at a revision.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, type: repoType, id: str, rev: str }, required: ["id"] },
    handler: async (a, { idToken }) => hf.listCommits(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_list_my_repos",
    description: "Repos owned by the connected account (or an org it belongs to): models, datasets or Spaces, private ones included.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, type: repoType, owner: str } },
    handler: async (a, { idToken }) => {
      const { token, me } = await hfMe(idToken, a.accountId);
      return hf.search(token, { type: a.type || "model", author: a.owner || me, limit: 100, sort: "lastModified" });
    },
  },
  {
    name: "hf_list_collections",
    description: "List Hugging Face collections, by owner and/or a search term.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, owner: str, q: str, limit: { type: "number" } } },
    handler: async (a, { idToken }) => hf.listCollections(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_get_collection",
    description: "One Hugging Face collection by its slug (namespace/slug-id), with its items.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, slug: str }, required: ["slug"] },
    handler: async (a, { idToken }) => hf.getCollection(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_create_repo",
    description: "Create a Hugging Face model, dataset or Space repo. PRIVATE by default — pass private:false only when the owner asked for a public repo. A Space needs sdk (gradio|docker|static).",
    scope: "write",
    inputSchema: { type: "object", properties: { accountId: accountArg, type: repoType, name: str, organization: str, private: { type: "boolean" }, sdk: str }, required: ["name"] },
    handler: async (a, { idToken }) => hf.createRepo(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_commit_files",
    description: "Commit text/JSON files to a Hugging Face repo in one commit (model cards, configs, metrics, small scripts). Each file: {path, content} or {path, contentBase64}. ≤ 10 MB total; files HF requires LFS for (weights) are refused by name — push those from a CLI.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        accountId: accountArg, type: repoType, id: str, rev: str, summary: str, description: str,
        files: { type: "array", items: { type: "object", properties: { path: str, content: str, contentBase64: str }, required: ["path"] } },
      },
      required: ["id", "summary", "files"],
    },
    handler: async (a, { idToken }) => hf.commitFiles(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_delete_file",
    description: "Delete files from a Hugging Face repo as one commit. Needs confirm:true. Git history keeps the old content.",
    scope: "write",
    inputSchema: { type: "object", properties: { accountId: accountArg, type: repoType, id: str, rev: str, paths: { type: "array", items: str }, confirm: { type: "boolean" } }, required: ["id", "paths"] },
    handler: async (a, { idToken }) => {
      if (a.confirm !== true) return { isError: true, error: `Deleting ${a.paths.join(", ")} from ${a.id} needs confirm:true.` };
      return hf.commitFiles(await hfTok(idToken, a.accountId), { type: a.type, id: a.id, rev: a.rev, summary: `Delete ${a.paths.join(", ")}`, files: [], deletes: a.paths });
    },
  },
  {
    name: "hf_add_to_collection",
    description: "Add a model, dataset, Space, paper or collection to one of your Hugging Face collections, with an optional note (≤ 500 chars).",
    scope: "write",
    inputSchema: { type: "object", properties: { accountId: accountArg, slug: str, itemType: { type: "string", enum: ["paper", "collection", "space", "model", "dataset"] }, itemId: str, note: str }, required: ["slug", "itemType", "itemId"] },
    handler: async (a, { idToken }) => hf.addToCollection(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_space_status",
    description: "A Space's runtime: stage (RUNNING, BUILDING, SLEEPING, RUNTIME_ERROR…), hardware and error message if any.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, id: str }, required: ["id"] },
    handler: async (a, { idToken }) => hf.spaceRuntime(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_restart_space",
    description: "Restart a Hugging Face Space (e.g. after changing a secret or when stuck).",
    scope: "write",
    inputSchema: { type: "object", properties: { accountId: accountArg, id: str }, required: ["id"] },
    handler: async (a, { idToken }) => hf.restartSpace(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_set_space_secret",
    description: "Set a secret on a Hugging Face Space (key/value; the value is never returned). The Space must be restarted to read it.",
    scope: "write",
    inputSchema: { type: "object", properties: { accountId: accountArg, id: str, key: str, value: str, description: str }, required: ["id", "key", "value"] },
    handler: async (a, { idToken }) => {
      await hf.setSpaceSecret(await hfTok(idToken, a.accountId), a);
      return { id: a.id, key: a.key, set: true, note: "Restart the Space for it to take effect." };
    },
  },
  {
    name: "hf_inference",
    description: "Run a chat completion on a model through Hugging Face Inference Providers (OpenAI-compatible router). Spends the account's inference credits — keep maxTokens small.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: { accountId: accountArg, model: str, messages: { type: "array", items: { type: "object", properties: { role: str, content: str } } }, maxTokens: { type: "number" } },
      required: ["model", "messages"],
    },
    handler: async (a, { idToken }) => hf.inference(await hfTok(idToken, a.accountId), a),
  },
  {
    name: "hf_jobs_hardware",
    description: "Hardware flavors available to Hugging Face Jobs with their per-hour prices. Read this before hf_run_job to pick and cost a flavor.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg } },
    handler: async (a, { idToken }) => hf.jobsHardware(await hfTok(idToken, a.accountId)),
  },
  {
    name: "hf_run_job",
    description: "Run a command on Hugging Face Jobs (paid per minute): a Docker image OR a Space, a command array, env, secrets, a hardware flavor and a timeout. dryRun:true returns the worst-case cost (flavor price × timeout) without starting anything — do that first.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        accountId: accountArg, namespace: str, image: str, spaceId: str,
        command: { type: "array", items: str }, args: { type: "array", items: str },
        env: { type: "object" }, secrets: { type: "object" }, flavor: str, timeoutSeconds: { type: "number" }, dryRun: { type: "boolean" },
      },
      required: ["command", "flavor"],
    },
    handler: async (a, { idToken }) => {
      const { token, me } = await hfMe(idToken, a.accountId);
      const namespace = a.namespace || me;
      if (a.dryRun) {
        const hw = await hf.jobsHardware(token);
        const row = (Array.isArray(hw) ? hw : hw.hardware || []).find((h) => h.name === a.flavor || h.flavor === a.flavor);
        const perHour = row?.unitCostUSD ?? row?.pricePerHour ?? row?.price ?? null;
        const hours = (a.timeoutSeconds || 1800) / 3600;
        return { dryRun: true, namespace, flavor: a.flavor, timeoutSeconds: a.timeoutSeconds || 1800, maxCostUSD: perHour == null ? null : Math.round(perHour * hours * 100) / 100, priceRow: row || null };
      }
      return hf.runJob(token, { ...a, namespace });
    },
  },
  {
    name: "hf_list_jobs",
    description: "Hugging Face Jobs in a namespace (default: your username), newest first, with status.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, namespace: str } },
    handler: async (a, { idToken }) => {
      const { token, me } = await hfMe(idToken, a.accountId);
      return hf.listJobs(token, { namespace: a.namespace || me });
    },
  },
  {
    name: "hf_get_job",
    description: "One Hugging Face Job: status stage, flavor, timing, command.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, namespace: str, id: str }, required: ["id"] },
    handler: async (a, { idToken }) => {
      const { token, me } = await hfMe(idToken, a.accountId);
      return hf.getJob(token, { namespace: a.namespace || me, id: a.id });
    },
  },
  {
    name: "hf_job_logs",
    description: "The last N lines (default 200, max 2000) of a Hugging Face Job's logs.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, namespace: str, id: str, tail: { type: "number" } }, required: ["id"] },
    handler: async (a, { idToken }) => {
      const { token, me } = await hfMe(idToken, a.accountId);
      return hf.jobLogs(token, { namespace: a.namespace || me, id: a.id, tail: a.tail });
    },
  },
  {
    name: "hf_cancel_job",
    description: "Cancel a running Hugging Face Job (stops billing).",
    scope: "write",
    inputSchema: { type: "object", properties: { accountId: accountArg, namespace: str, id: str }, required: ["id"] },
    handler: async (a, { idToken }) => {
      const { token, me } = await hfMe(idToken, a.accountId);
      return hf.cancelJob(token, { namespace: a.namespace || me, id: a.id });
    },
  },
  {
    name: "hf_usage",
    description: "What the Hugging Face account has consumed: billing usage for a date range (YYYY-MM-DD, default this month), Jobs usage, and the ZeroGPU quota. A part HF refuses (e.g. a read token on billing) comes back as {error} rather than failing the rest.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, startDate: str, endDate: str } },
    handler: async (a, { idToken }) => {
      const now = new Date();
      const start = a.startDate || `${now.toISOString().slice(0, 8)}01`;
      return hf.usage(await hfTok(idToken, a.accountId), { startDate: start, endDate: a.endDate || now.toISOString().slice(0, 10) });
    },
  },
];

export const ML_TOOLS = [...HF_TOOLS];
```

In `lib/server/mcpTools.js` add near the other imports:
```js
import { ML_TOOLS } from "./mlTools.js";
```
and change the end of the `TOOLS` array from `  },\n];` to `  },\n  ...ML_TOOLS,\n];` (the closing `];` right before `export const toolByName`).

- [ ] **Step 3: Run checks**

Run: `npm run mcp:check && npm run test:ml`
Expected: `✓ every huggingface tool is still registered`, `✓ and every huggingface tool still has a body`, read-scope naming rule passes; overall exit 0 (the known live-block `profile has a name` line only appears with `MCP_TOKEN` set and is not a regression).

- [ ] **Step 4: Commit**

```bash
git add lib/server/mlTools.js lib/server/mcpTools.js scripts/mcp-check.mjs
git commit -m "mcp: Hugging Face family (search, repos, commits, collections, spaces, jobs, usage)"
```

---

### Task 9: MCP — Kaggle family

**Files:**
- Modify: `lib/server/mlTools.js`
- Modify: `scripts/mcp-check.mjs` (`EXPECTED.kaggle`)

**Interfaces:**
- Consumes: `mlCtx` (Task 8), `./kaggle.js` + `./kaggleShape.js` (Tasks 5–6).
- Produces: `KAGGLE_TOOLS` appended into `ML_TOOLS`.

- [ ] **Step 1: Pin the family** — add to `EXPECTED`:
```js
    kaggle: [
      "kaggle_whoami", "kaggle_search_datasets", "kaggle_search_competitions", "kaggle_search_notebooks", "kaggle_search_models",
      "kaggle_get_dataset", "kaggle_list_dataset_files", "kaggle_get_competition", "kaggle_leaderboard", "kaggle_list_submissions",
      "kaggle_push_kernel", "kaggle_kernel_status", "kaggle_kernel_output", "kaggle_get_kernel", "kaggle_cancel_kernel",
      "kaggle_quota", "kaggle_create_dataset_version", "kaggle_submit",
    ],
```
Run `npm run mcp:check` → Expected: `✗ every kaggle tool is still registered`.

- [ ] **Step 2: Add the tools** — in `lib/server/mlTools.js` add imports:
```js
import * as kg from "./kaggle.js";
import { kernelRequest, notebookFromCells, SORT_NAMES } from "./kaggleShape.js";
```
and before `export const ML_TOOLS`:
```js
const kgTok = async (idToken, accountId) => (await mlCtx(idToken, "kaggle", accountId)).token;
const kgMe = async (idToken, accountId) => {
  const { token, account } = await mlCtx(idToken, "kaggle", accountId);
  return { token, me: account.accountId };
};
const enc = new TextEncoder();
const bytesOf = (f) => (f.contentBase64 ? new Uint8Array(Buffer.from(f.contentBase64, "base64")) : enc.encode(String(f.content ?? "")));
const MAX_UPLOAD = 10 * 1024 * 1024;

const KAGGLE_TOOLS = [
  {
    name: "kaggle_whoami",
    description: "The connected Kaggle account (username) and this week's GPU/TPU quota. Start here before pushing a kernel.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg } },
    handler: async (a, { idToken }) => {
      const { token, me } = await kgMe(idToken, a.accountId);
      return { username: me, quota: await kg.quota(token) };
    },
  },
  {
    name: "kaggle_search_datasets",
    description: `Search Kaggle datasets by text, owner, sort (${SORT_NAMES.datasets.join("|")}), page.`,
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, search: str, sort: str, user: str, page: { type: "number" }, pageSize: { type: "number" } } },
    handler: async (a, { idToken }) => kg.searchDatasets(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_search_competitions",
    description: `Search Kaggle competitions by text, category, sort (${SORT_NAMES.competitions.join("|")}).`,
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, search: str, sort: str, category: str, page: { type: "number" } } },
    handler: async (a, { idToken }) => kg.searchCompetitions(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_search_notebooks",
    description: `Search Kaggle notebooks (kernels) by text, author, competition or dataset; sort (${SORT_NAMES.kernels.join("|")}). Good for finding strong baselines to learn from.`,
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, search: str, sort: str, user: str, competition: str, dataset: str, page: { type: "number" }, pageSize: { type: "number" } } },
    handler: async (a, { idToken }) => kg.searchKernels(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_search_models",
    description: `Search Kaggle Models by text and owner; sort (${SORT_NAMES.models.join("|")}).`,
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, search: str, sort: str, owner: str, pageSize: { type: "number" } } },
    handler: async (a, { idToken }) => kg.searchModels(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_get_dataset",
    description: "One Kaggle dataset by owner/slug: title, size, license, usability, versions.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, ref: str }, required: ["ref"] },
    handler: async (a, { idToken }) => kg.getDataset(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_list_dataset_files",
    description: "Files in a Kaggle dataset (owner/slug) with sizes — read before referencing paths under /kaggle/input in a kernel.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, ref: str }, required: ["ref"] },
    handler: async (a, { idToken }) => kg.listDatasetFiles(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_get_competition",
    description: "One Kaggle competition by its url name (e.g. titanic): deadline, metric, reward, whether you have entered.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, name: str }, required: ["name"] },
    handler: async (a, { idToken }) => kg.getCompetition(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_leaderboard",
    description: "The public leaderboard of a Kaggle competition (top N).",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, name: str, pageSize: { type: "number" } }, required: ["name"] },
    handler: async (a, { idToken }) => kg.leaderboard(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_list_submissions",
    description: "Your submissions to a Kaggle competition with their public scores and status.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, name: str }, required: ["name"] },
    handler: async (a, { idToken }) => kg.listSubmissions(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_push_kernel",
    description: "Create or update a PRIVATE Kaggle notebook/script and run it on Kaggle (free GPU: accelerator T4 or P100; weekly quota — check kaggle_whoami). Give either source (notebook JSON or script text) or cells [{type:code|markdown, source}]. ref is your-username/slug. Inputs mount under /kaggle/input; write outputs (and metrics.json) to /kaggle/working. Poll kaggle_kernel_status, then read kaggle_kernel_output.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: {
        accountId: accountArg, ref: str, title: str, kind: { type: "string", enum: ["notebook", "script"] }, language: { type: "string", enum: ["python", "r"] },
        source: str, cells: { type: "array", items: { type: "object", properties: { type: str, source: str } } },
        accelerator: str, internet: { type: "boolean" }, timeoutSeconds: { type: "number" },
        datasets: { type: "array", items: str }, competitions: { type: "array", items: str }, kernels: { type: "array", items: str }, models: { type: "array", items: str },
      },
      required: ["ref", "title"],
    },
    handler: async (a, { idToken }) => {
      const { token, me } = await kgMe(idToken, a.accountId);
      if (!a.ref.startsWith(`${me}/`)) return { isError: true, error: `ref must be under your own account: ${me}/<slug>.` };
      const kind = a.cells ? "notebook" : a.kind || "script";
      const source = a.cells ? notebookFromCells(a.cells) : a.source;
      const out = await kg.pushKernel(token, kernelRequest({ ...a, kind, source }));
      if (out.error) return { isError: true, error: out.error, invalid: { tags: out.invalidTags, datasets: out.invalidDatasetSources, competitions: out.invalidCompetitionSources, kernels: out.invalidKernelSources, models: out.invalidModelSources } };
      return { ref: out.ref || a.ref, url: out.url, version: out.versionNumber, next: "Poll kaggle_kernel_status every minute or two; output is available once it reads complete." };
    },
  },
  {
    name: "kaggle_kernel_status",
    description: "Status of your Kaggle kernel's latest run: queued | running | complete | error | cancelled, with the failure message on error.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, ref: str }, required: ["ref"] },
    handler: async (a, { idToken }) => kg.kernelStatus(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_kernel_output",
    description: "Output files (with download URLs) and the run log of a Kaggle kernel. The log is only filled once the run is complete or errored.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, ref: str }, required: ["ref"] },
    handler: async (a, { idToken }) => {
      const out = await kg.kernelOutput(await kgTok(idToken, a.accountId), a);
      return { ...out, log: out.log.length > 20000 ? `…${out.log.slice(-20000)}` : out.log };
    },
  },
  {
    name: "kaggle_get_kernel",
    description: "A Kaggle kernel's metadata and source (its code), e.g. to study or fork a public baseline.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg, ref: str }, required: ["ref"] },
    handler: async (a, { idToken }) => kg.getKernel(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_cancel_kernel",
    description: "Cancel a running Kaggle kernel session by its numeric session id (stops spending GPU quota).",
    scope: "write",
    inputSchema: { type: "object", properties: { accountId: accountArg, sessionId: { type: "number" } }, required: ["sessionId"] },
    handler: async (a, { idToken }) => kg.cancelKernel(await kgTok(idToken, a.accountId), a),
  },
  {
    name: "kaggle_quota",
    description: "This week's Kaggle GPU and TPU quota: hours used, limit, hours left, and when it refreshes.",
    scope: "read",
    inputSchema: { type: "object", properties: { accountId: accountArg } },
    handler: async (a, { idToken }) => kg.quota(await kgTok(idToken, a.accountId)),
  },
  {
    name: "kaggle_create_dataset_version",
    description: "Publish a new version of one of your Kaggle datasets from small files (≤ 10 MB total): [{name, content|contentBase64}] plus version notes. Visibility is unchanged.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: { accountId: accountArg, ref: str, notes: str, files: { type: "array", items: { type: "object", properties: { name: str, content: str, contentBase64: str }, required: ["name"] } } },
      required: ["ref", "files"],
    },
    handler: async (a, { idToken }) => {
      const files = a.files.map((f) => ({ name: f.name, bytes: bytesOf(f) }));
      const total = files.reduce((n, f) => n + f.bytes.byteLength, 0);
      if (total > MAX_UPLOAD) return { isError: true, error: `These files are ${(total / 1048576).toFixed(1)} MB; the limit here is 10 MB.` };
      return kg.createDatasetVersion(await kgTok(idToken, a.accountId), { ref: a.ref, notes: a.notes, files });
    },
  },
  {
    name: "kaggle_submit",
    description: "Submit a predictions file to a Kaggle competition. Uses one of a FINITE number of daily submissions, so it needs confirm:true. You must have accepted the competition's rules on kaggle.com.",
    scope: "write",
    inputSchema: {
      type: "object",
      properties: { accountId: accountArg, competition: str, fileName: str, content: str, contentBase64: str, description: str, confirm: { type: "boolean" } },
      required: ["competition", "fileName"],
    },
    handler: async (a, { idToken }) => {
      if (a.confirm !== true) return { isError: true, error: `Submitting to ${a.competition} spends a daily submission; call again with confirm:true.` };
      const bytes = bytesOf(a);
      if (bytes.byteLength > MAX_UPLOAD) return { isError: true, error: "Submission files over 10 MB are not sent from here." };
      return kg.submit(await kgTok(idToken, a.accountId), { competition: a.competition, fileName: a.fileName, bytes, description: a.description });
    },
  },
];
```
Change the export to `export const ML_TOOLS = [...HF_TOOLS, ...KAGGLE_TOOLS];`.

- [ ] **Step 3: Run checks** — `npm run mcp:check && npm run test:ml` → kaggle family `✓`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/server/mlTools.js scripts/mcp-check.mjs
git commit -m "mcp: Kaggle family (search, kernels push/status/output, quota, datasets, submit)"
```

---

### Task 10: `get_ml_credentials` + containment assertions

**Files:**
- Modify: `lib/server/mlTools.js`
- Modify: `scripts/mcp-check.mjs` (new block after the `EXPECTED` loop)

**Interfaces:**
- Consumes: `credentialMaterial` (Task 6); `getDocument`, `createDocument` from `./firestoreRest.js`; `accountPath` from `./connectedStore.js`; `unseal` from `./integrations.js`.
- Produces: tool `get_ml_credentials` (scope `secrets`).

- [ ] **Step 1: Write the failing assertions** — add to `scripts/mcp-check.mjs` after the EXPECTED loop block:

```js
console.log("\nML lab: what must stay absent");
{
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const ml = TOOLS.filter((t) => /^(hf|kaggle)_/.test(t.name) || t.name === "get_ml_credentials");
  check(!ml.some((t) => /delete_(repo|dataset|kernel)|make_public|set_visibility/.test(t.name)), "no ML tool deletes a repo/dataset/kernel or flips visibility");
  const cred = TOOLS.find((t) => t.name === "get_ml_credentials");
  check(cred?.scope === "secrets", "get_ml_credentials needs the secrets scope", cred?.scope);
  check(/HANDLING/.test(cred?.description || ""), "and carries the handling rule");
  const { listToolsFor } = await import("../lib/server/mcpTools.js");
  const offered = listToolsFor(["read", "write", "vault"]).map((t) => t.name);
  check(!offered.includes("get_ml_credentials"), "read+write+vault tokens are not offered it");
  const create = TOOLS.find((t) => t.name === "hf_create_repo");
  check(/PRIVATE by default/.test(create.description), "hf_create_repo says private by default");
  for (const n of ["hf_delete_file", "kaggle_submit"]) {
    const out = await TOOLS.find((t) => t.name === n).handler({ id: "a/b", paths: ["x"], competition: "c", fileName: "f" }, { idToken: "" });
    check(out?.isError === true && /confirm/.test(out.error), `${n} refuses without confirm, before any I/O`);
  }
}
```
Run `npm run mcp:check` → Expected: `✗ get_ml_credentials needs the secrets scope`.

- [ ] **Step 2: Implement** — in `lib/server/mlTools.js` add imports:
```js
import { getDocument, createDocument } from "./firestoreRest.js";
import { accountPath } from "./connectedStore.js";
import { unseal, getProvider } from "./integrations.js";
import { credentialMaterial } from "./mlKeys.js";
```
and the tool, appended to `ML_TOOLS`:
```js
const CREDENTIAL_TOOLS = [
  {
    name: "get_ml_credentials",
    description:
      "The raw API credential for a connected Hugging Face or Kaggle account, as ready-to-use material: HF → env.HF_TOKEN; Kaggle → env.KAGGLE_API_TOKEN, or kaggleJson + env.KAGGLE_USERNAME/KAGGLE_KEY for a legacy key. Refused unless the owner switched on 'Agent may read this token' for that account in the Accounts tab. Every read is audited. HANDLING: this is for USE in the step that needs it (an env var for a CLI, ~/.kaggle/kaggle.json). Do not echo it into the conversation, a commit, a log, or a file you were not asked to write. Prefer the hf_*/kaggle_* tools, which never expose it.",
    scope: "secrets",
    inputSchema: { type: "object", properties: { provider: { type: "string", enum: ["huggingface", "kaggle"] }, accountId: accountArg }, required: ["provider"] },
    handler: async (a, { idToken, claims }) => {
      const p = getProvider(a.provider);
      const { account } = await mlCtx(idToken, p.id, a.accountId);
      const doc = await getDocument(idToken, accountPath(p.id, account.accountId)).catch(() => null);
      if (!doc?.secret) return { isError: true, error: `No ${p.label} account "${account.accountId}" is connected.` };
      if (doc.agentReadable !== true) {
        return { isError: true, error: `${p.label} account ${account.label} is not readable by an agent. The owner can switch on "Agent may read this token" in the admin's Accounts tab.` };
      }
      const { accessToken } = unseal(doc.secret, "refresh");
      await createDocument(idToken, "auditLog", null, {
        action: "ml.credentials.read",
        target: `${p.id}:${account.accountId}`,
        detail: "read over MCP",
        actor: `mcp:${claims?.jti || "token"}`,
        at: new Date().toISOString(),
      }).catch(() => {});
      return { provider: p.id, accountId: account.accountId, ...credentialMaterial(p.id, accessToken) };
    },
  },
];
```
`export const ML_TOOLS = [...HF_TOOLS, ...KAGGLE_TOOLS, ...CREDENTIAL_TOOLS];`

- [ ] **Step 3: Run checks** — `npm run mcp:check && npm run test:ml && npm run test:accounts && npm run test:integrations && npm run test:social` → all exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/server/mlTools.js scripts/mcp-check.mjs
git commit -m "mcp: get_ml_credentials behind secrets scope, agentReadable and audit"
```

---

### Task 11: Live smoke + docs

**Files:**
- Create: `scripts/ml-live.mjs`; `package.json` script `"ml:live": "node scripts/ml-live.mjs"`
- Modify: `D:\personal_sync\CLAUDE.md` — new section "ML lab (Hugging Face, Kaggle)"

**Interfaces:**
- Consumes: `huggingface.js`, `kaggle.js`, `kaggleShape.js` with tokens from env `HF_TOKEN`, `KAGGLE_API_TOKEN` (local only, never committed).

- [ ] **Step 1: Write `scripts/ml-live.mjs`**

```js
// Live smoke for the ML lab. Needs real tokens in the environment and costs
// nothing: a CPU-only Kaggle script and reads on Hugging Face.
//
//   HF_TOKEN=hf_… KAGGLE_API_TOKEN=… node scripts/ml-live.mjs
const hf = await import("../lib/server/huggingface.js");
const kg = await import("../lib/server/kaggle.js");
const { kernelRequest } = await import("../lib/server/kaggleShape.js");

const { HF_TOKEN, KAGGLE_API_TOKEN } = process.env;
if (!HF_TOKEN || !KAGGLE_API_TOKEN) { console.log("Set HF_TOKEN and KAGGLE_API_TOKEN."); process.exit(2); }

const me = await hf.whoami(HF_TOKEN);
console.log("HF:", me.name, me.auth?.accessToken?.role);
console.log("HF search:", (await hf.search(HF_TOKEN, { search: "bert", limit: 3 })).map((r) => r.id).join(", "));
const who = await kg.introspect(KAGGLE_API_TOKEN);
console.log("Kaggle:", who.username, JSON.stringify(await kg.quota(KAGGLE_API_TOKEN)));
const ref = `${who.username}/ml-lab-smoke`;
const pushed = await kg.pushKernel(KAGGLE_API_TOKEN, kernelRequest({ ref, title: "ml lab smoke", kind: "script", source: 'import json\njson.dump({"ok": 1}, open("metrics.json", "w"))\nprint("hello")' }));
console.log("pushed:", pushed.url || pushed.error);
for (let i = 0; i < 30; i++) {
  const s = await kg.kernelStatus(KAGGLE_API_TOKEN, { ref });
  console.log("status:", s.status);
  if (["complete", "error", "cancelled"].includes(s.status)) break;
  await new Promise((r) => setTimeout(r, 20000));
}
const out = await kg.kernelOutput(KAGGLE_API_TOKEN, { ref });
console.log("outputs:", out.files.map((f) => f.name).join(", "));
process.exit(out.files.some((f) => f.name === "metrics.json") ? 0 : 1);
```

- [ ] **Step 2: Run it (only once tokens exist)**

Run: `HF_TOKEN=… KAGGLE_API_TOKEN=… npm run ml:live`
Expected: HF username + role, three search ids, Kaggle username + quota, `status: complete` within ~10 minutes, `outputs: metrics.json…`, exit 0. If a Kaggle RPC answers 400 on a field name, compare the body with the matching `_fields` list in `kagglesdk` (`pip download kagglesdk --no-deps`) and fix `kaggleShape.js`/`kaggle.js` plus the stub test.

- [ ] **Step 3: Document** — add to `D:\personal_sync\CLAUDE.md`, after the "Accounts — the authentication centre" section:

```markdown
## ML lab (Hugging Face, Kaggle)
`lib/server/{hfShape,huggingface,kaggleShape,kaggle,mlKeys,mlTools}.js`. Spec: `RaviKishan/docs/superpowers/specs/2026-10-07-ml-lab-design.md`.
- **Connected by pasted token, not OAuth** (`auth: "apiKey"` on the provider). `/api/accounts` `connectKey` asks the provider who the token belongs to BEFORE storing anything, seals it under `INTEGRATION_SECRET` and writes `connectedAccounts/<provider>__<user>` as the admin (`kind: "access"`, no expiry). A Kaggle `kaggle.json` is stored pre-encoded as `Basic …` so every credential is one opaque string.
- Job: `ml` in `SERVICES`. Tools resolve through `tokenFor(…, {service:"ml"})` — two HF accounts and no default refuses.
- **Kaggle is RPC, not REST**: `POST https://api.kaggle.com/v1/<service>/<Method>`, camelCase fields from kagglesdk's request classes, enums as their string names. Quota is real (`GetAcceleratorQuotaStatistics`).
- **HF commits are NDJSON** after a `preupload` check; a file HF wants in LFS is refused by name (LFS not implemented), 10 MB cap.
- **Safe by default**: new HF repos private; nothing deletes a repo/dataset/kernel or makes anything public; `kaggle_submit` and `hf_delete_file` need `confirm`; `hf_run_job` has `dryRun` for a worst-case cost.
- `get_ml_credentials` = `secrets` scope + per-account `agentReadable` (Accounts tab checkbox) + audit, same trade as the secret store.
- `tokenFor()` used to destructure the STRING `accessTokenFor` returns, so every legacy-row caller got `undefined`; fixed here.
- Colab has no unattended API — see the spec; use Google's Colab MCP server locally.
- Tests: `npm run test:ml` (no network), `mcp:check` families `huggingface`/`kaggle` + absences, `npm run ml:live` with real tokens.
```

- [ ] **Step 4: Full verification**

Run: `npm run test:ml && npm run test:accounts && npm run test:integrations && npm run test:social && npm run mcp:check`
Expected: every suite exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/ml-live.mjs package.json
git commit -m "ml: live smoke script"
```
(`D:\personal_sync\CLAUDE.md` is outside this git repo; it is saved, not committed.)
