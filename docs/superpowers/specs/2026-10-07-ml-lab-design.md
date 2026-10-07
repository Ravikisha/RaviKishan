# ML Lab — Hugging Face, Kaggle, Colab: accounts, MCP, experiment runner, usage

**Date:** 7 Oct 2026 · **Status:** design approved in chat ("go for the best choices"), awaiting spec review
**Worktree:** `RaviKishan/.claude/worktrees/tasks-reconnect`

## 1. Intent

The owner wants an agent to **run ML experiments end to end**: find a model/dataset, write a notebook, run it on a GPU somewhere, collect metrics, publish the trained artefact to Hugging Face, and record what happened — triggered on demand, on a queue/schedule, and chained (training done → push model → log metrics → blog draft). Alongside it: every API reachable over MCP (incl. full HF search), credentials exposable for local CLIs, and **consumption analytics** (GPU quota, HF billing, MCP usage per token/tool).

Interpretations the owner did not state, made explicit so they can be corrected:
- "Token consumption" = **resource consumption** (Kaggle GPU/TPU hours vs weekly quota, HF Jobs minutes/cost, HF inference usage, ZeroGPU quota) **plus MCP calls per token and per tool**. Not Claude's LLM token usage.
- "Login support" = connecting an account by **pasting an API token**, multi-account, through the existing account directory. The owner's browser is logged in to all three sites; tokens may be generated there through Claude-in-Chrome, **one confirmation per token created**.

Success: from a chat client, `run_experiment` on a Kaggle GPU completes unattended, its model appears on HF, the Lab tab shows it, and `get_ml_usage` reports the GPU hours it consumed.

## 2. What each platform actually allows (verified 7 Oct 2026)

| | Auth | Runs code unattended? | Consumption data |
|---|---|---|---|
| **Hugging Face** | User access token (fine-grained), `Authorization: Bearer hf_…`. OAuth apps also exist; not needed. | **Yes — HF Jobs** `POST /api/jobs/{ns}` (Docker image + command + hardware flavor), logs/metrics/events/cancel, and **scheduled jobs** `/api/scheduled-jobs/{ns}`. Paid per minute. | **Real**: `GET /api/settings/billing/usage-v2?startDate&endDate`, `/usage/jobs`, `/api/spaces/zero-gpu/quota`. |
| **Kaggle** | API token from kaggle.com/settings → "Generate New Token", sent `Authorization: Bearer`. Legacy `kaggle.json` (username+key) → HTTP Basic. Identity via `security.OAuthService/IntrospectToken`. | **Yes — kernels**: `kernels.KernelsApiService/SaveKernel` (push + run, accelerator P100/T4 free), `GetKernelSessionStatus`, `ListKernelSessionOutput`, `CancelKernelSession`. No live logs; poll. | **Real**: `kernels.KernelsApiService/GetAcceleratorQuotaStatistics` (gpu/tpu quota + refresh time). |
| **Colab** | Google sign-in only. | **No.** Google's official Colab MCP server (Mar 2026) drives a notebook **open in the browser** and "does not support unattended runs". | None via API. |

Kaggle transport: `POST https://api.kaggle.com/v1/<service>/<Method>` with a JSON body (the `kagglesdk` RPC convention, read from its source). HF Hub spec: `https://huggingface.co/.well-known/openapi.json`.

**Consequence:** Kaggle = free unattended runner (default). HF Jobs = paid runner, opt-in per experiment. HF Hub = where artefacts land. Colab = interactive only, via Google's own MCP server registered locally — not rebuilt, not proxied.

## 3. Decomposition (built in this order; each gets its own plan)

1. **Accounts** — `huggingface` + `kaggle` as API-key providers in the directory.
2. **HF client + MCP family.**
3. **Kaggle client + MCP family.**
4. **Experiment runner** — `experiments/` collection, cron tick, chain.
5. **Usage + analytics** — consumption, HF/Kaggle growth snapshots, MCP usage counters, Lab tab.
6. **Colab** — register Google's Colab MCP server for Claude Code + guide.

Parts 1–3 are specified in detail below; 4–6 at design level (their plans will refine them).

---

## 4. Part 1 — API-key accounts

### Provider entries (`lib/server/integrations.js`)
Add `huggingface` and `kaggle` with a new field **`auth: "apiKey"`** (OAuth providers implicitly `"oauth"`):
```js
huggingface: { id: "huggingface", label: "Hugging Face", multi: true, auth: "apiKey",
               docId: "huggingface", scopes: [], env: null, keyHint: "hf_…  (huggingface.co/settings/tokens)" },
kaggle:      { id: "kaggle", label: "Kaggle", multi: true, auth: "apiKey",
               docId: "kaggle", scopes: [], env: null, keyHint: "Token from kaggle.com/settings → API, or kaggle.json" },
```
- `providerConfig()`: for `auth === "apiKey"`, `configured = isSealConfigured()`, `missing = ["INTEGRATION_SECRET"]` if not; never reads `p.env`.
- `/api/integrations/[provider]/start|callback` refuse an apiKey provider with 400 "connect by pasting a token".
- No `docId` legacy record will ever exist; `docId` is set only because `allAccounts` reads it.

### Connecting = pasting, validated server-side
New action **`connectKey`** on `pages/api/accounts.js` (admin-gated, existing route):
1. Body `{ provider, key }` (Kaggle also accepts the pasted `kaggle.json` text → `{username,key}`).
2. **Validate by calling the provider** before storing anything:
   - HF: `GET /api/whoami-v2` → `accountId = name`, label = `fullname || name`, scope = the token's `auth.accessToken.role` (`read`/`write`/`fineGrained`) — a read token is stored but flagged, because publishing models needs write.
   - Kaggle: `IntrospectToken` → username (Bearer token); for `kaggle.json`, Basic auth against `ListKernels` with `user=<username>` page 1.
   A rejected key returns 400 with the provider's reason; nothing is written.
3. Seal `{ accessToken: key, basic?: {username,key} }` with `seal(..., "refresh")` under `INTEGRATION_SECRET` and `patchDocument(idToken, connectedAccounts/<provider>__<accountId>, connectedRecord({ kind: "access", expiresAt: null, … }))` **as the admin** (the server already writes this collection with the caller's idToken for token rotation — no new credential, rules unchanged).
4. Audit `account.connectKey`.
- `connectedToken()`: `kind:"access"` with `expiresAt` null must not be treated as expired (check, and fix if it is).
- Re-pasting the same account updates its row (same doc id).

### Directory
- New service in `SERVICES`: `ml: { id:"ml", label:"ML lab", providers:["huggingface","kaggle"], verbs:["read","write"], analytics:true }`. Two services would be over-engineering: the job is one, and `chooseAccount` already takes `provider`.
- **Fix** `tokenFor()` legacy branch: `accessTokenFor` returns a string, so `const { token } = …` yields `undefined` today. Assign directly. Add an assertion to `test:accounts`.
- Update the pinned lists: `integrations-check.mjs` provider order and multi, `accounts-check.mjs` service coverage.

### Accounts panel
`providerSummary()` gains `auth` and `keyHint`. In "Connect an account", an apiKey provider renders a **paste row** (password input + Connect) instead of the OAuth button; on success the roster refreshes. Same visual language — no new colour.

### Exposing credentials (for local CLIs / scripts)
MCP tool **`get_ml_credentials`** — scope **`secrets`**, audited (`ml.credentials.read`), refuses unless the account's row carries **`agentReadable: true`** (default false, toggled in the panel, exactly like the secret store's flag). Returns, per provider, ready-to-use material: HF → `{ HF_TOKEN }`; Kaggle → `{ KAGGLE_API_TOKEN }` or `{ kaggleJson }`. Description carries the existing handling rule (use, never echo). Rationale: the owner explicitly asked to "expose credentials"; this is the `secrets/` side of the trade the codebase already made, with the same three guards.

---

## 5. Part 2 — Hugging Face (`lib/server/huggingface.js` + `hf_*` MCP tools)

Client: `hf(token, path, {method, query, body})` over `https://huggingface.co`, translating 401 (bad token), 403 (token role too weak — names the role it has), 404, 429 (`Retry-After`).

Pure helpers in `lib/server/hfShape.js` (unit-tested): repo id validation (`ns/name`, type ∈ model|dataset|space), search-query builder, result shaping (id, author, downloads, likes, tags, pipeline_tag, lastModified, gated, private), commit-payload builder (NDJSON per HF commit API: header line + one `file` line per file, base64 content), hardware-flavor validation for Jobs.

| Tool | Scope | API |
|---|---|---|
| `hf_whoami` | read | `GET /api/whoami-v2` |
| `hf_search` | read | `GET /api/{models,datasets,spaces}` with `search, author, filter, sort (downloads/likes/trending/lastModified), limit≤100, full`; `type: "all"` fans out to all three |
| `hf_search_papers` | read | `GET /api/papers/search?q=` + `GET /api/daily_papers` |
| `hf_semantic_search_spaces` | read | `GET /api/spaces/semantic-search?q=` |
| `hf_search_docs` | read | `GET /api/docs/search?q=` |
| `hf_get_repo` | read | `GET /api/{type}s/{id}` (card data, siblings, downloads, likes) |
| `hf_list_files` | read | `GET /api/{type}s/{id}/tree/{rev}/{path}` |
| `hf_read_file` | read | `GET /{id}/resolve/{rev}/{path}` — text only, capped at 200 KB, binary refused with size |
| `hf_list_commits` | read | `GET /api/{type}s/{id}/commits/{rev}` |
| `hf_list_my_repos` | read | `GET /api/{type}s?author=<me>` |
| `hf_list_collections` / `hf_get_collection` | read | `GET /api/collections?owner=` / `GET /api/collections/{ns}/{slug}` |
| `hf_create_repo` | write | `POST /api/repos/create` — **`private: true` by default** |
| `hf_commit_files` | write | `POST /api/{type}s/{id}/commit/{rev}` — files as `{path, content|contentBase64|sourceUrl}`; ≤ 10 MB total inline (bigger files need LFS/Xet: refused with that reason, see Out of scope) |
| `hf_delete_file` | write | commit with `deletedFile` op, `confirm: true` |
| `hf_add_to_collection` | write | `POST /api/collections/{ns}/{slug}/items` |
| `hf_space_status` / `hf_restart_space` | read / write | runtime via `GET /api/spaces/{id}`; restart via `POST /api/spaces/{id}/restart` (verified against the spec at implementation; refused with reason if absent) |
| `hf_set_space_secret` | write | `POST /api/spaces/{id}/secrets` |
| `hf_inference` | write | Inference Providers router `POST https://router.huggingface.co/v1/chat/completions` (OpenAI-compatible) — `write` because it spends money |
| `hf_jobs_hardware` | read | `GET /api/jobs/hardware` (flavours + price) |
| `hf_run_job` | write | `POST /api/jobs/{ns}` — image or space, command, env, flavor, timeout; **`dryRun`** returns the cost estimate (price × timeout) without starting |
| `hf_list_jobs` / `hf_get_job` / `hf_job_logs` | read | `GET /api/jobs/{ns}[/{id}[/logs]]` (logs tail-capped) |
| `hf_cancel_job` | write | `POST /api/jobs/{ns}/{id}/cancel` |
| `hf_usage` | read | billing `usage-v2` for a range + `usage/jobs` + ZeroGPU quota, shaped with the previous-window delta (same rule as GA) |

Deliberate absences: no repo **delete**, no visibility flip private→public (`update` settings tool refuses `private:false`; making a model public is a disclosure), no token minting.

## 6. Part 3 — Kaggle (`lib/server/kaggle.js` + `kaggle_*` MCP tools)

Client: `kg(cred, "service.Name", "Method", body)` → `POST https://api.kaggle.com/v1/service.Name/Method`, Bearer or Basic. Pure helpers in `lib/server/kaggleShape.js`: kernel metadata builder (id `user/slug`, title, `code_file` content, language python, kernel_type notebook|script, `enable_gpu`, `enable_internet`, accelerator, dataset/competition/model sources), slug validation, accelerator alias map (`T4 → NvidiaTeslaT4`, `P100 → NvidiaTeslaP100`), status normalisation (`queued/running/complete/error/cancel*` → one vocabulary), quota shaping (used/limit/hours left/refresh time).

| Tool | Scope | RPC |
|---|---|---|
| `kaggle_whoami` | read | `IntrospectToken` |
| `kaggle_search_datasets` | read | `datasets.DatasetApiService/ListDatasets` (search, sort, size, file type, tags) |
| `kaggle_search_competitions` | read | `competitions.CompetitionApiService/ListCompetitions` |
| `kaggle_search_notebooks` | read | `kernels.KernelsApiService/ListKernels` |
| `kaggle_search_models` | read | `models.ModelApiService/ListModels` |
| `kaggle_get_dataset` / `kaggle_list_dataset_files` | read | `GetDataset` / `ListDatasetFiles` |
| `kaggle_get_competition` / `kaggle_leaderboard` / `kaggle_list_submissions` | read | `GetCompetition` / `GetLeaderboard` / `ListSubmissions` |
| `kaggle_push_kernel` | write | `SaveKernel` — notebook (ipynb JSON) or script text + metadata; runs immediately unless `run:false` |
| `kaggle_kernel_status` | read | `GetKernelSessionStatus` |
| `kaggle_kernel_output` | read | `ListKernelSessionOutput` — file list with download URLs + log (log only populated once complete) |
| `kaggle_cancel_kernel` | write | `CancelKernelSession` |
| `kaggle_get_kernel` | read | `GetKernel` (source + metadata) |
| `kaggle_quota` | read | `GetAcceleratorQuotaStatistics` |
| `kaggle_create_dataset_version` | write | `CreateDatasetVersion` (small files inline via `UploadDatasetFile` flow) |
| `kaggle_submit` | write | `CreateSubmission` (after `StartSubmissionUpload`) — `confirm: true`, because daily submission slots are finite |

Deliberate absences: no dataset/kernel **delete**, no making a private kernel or dataset public.

Note: the exact JSON field names of each request are taken from the `kagglesdk` request classes at implementation time (`to_dict` names), and pinned by a no-network test of the request builders.

---

## 7. Part 4 — Experiment runner (design level)

**`experiments/{id}`** (admin-only rule): `{ title, runner: "kaggle"|"hfjobs", account, source: { notebook|script, inline or hf/github ref }, inputs: { datasets[], competition?, model? }, accelerator, params, chain: { pushToHf?: {repo, private:true, files:[globs]}, logMetrics: true, blogDraft?: bool, submitTo?: competition }, state, history[], remote: { kernelSlug|jobId, version }, metrics, outputs[], cost: { gpuMinutes, usd? }, createdAt, startedAt, finishedAt, error }`.

**State machine** (pure, `lib/server/experimentMachine.js`, exhaustively tested): `queued → submitted → running → succeeded | failed | cancelled → publishing → published | publish_failed`. Every transition appends to `history`; illegal transitions throw. A run stuck in `running` past its `timeout` is marked `failed: timeout` and cancelled remotely.

**Metrics contract:** the notebook writes `metrics.json` to its output dir (Kaggle `/kaggle/working`, HF Jobs: printed as a final `##METRICS {json}` log line). Absent file = `metrics: null`, never `{}`.

**Tick:** `POST /api/lab/tick`, authenticated exactly like `/api/backup/run` (MCP token, `read`+`write`, revocation checked, `idTokenFor` → Firestore as the admin). One tick: submit queued runs (respecting quota: refuse to submit a GPU run when Kaggle quota < requested timeout), poll running ones, execute chain steps for finished ones. Idempotent — each step checks state first, so overlapping ticks cannot double-submit.

**Cron:** `.github/workflows/lab-tick.yml` every 15 min + `workflow_dispatch`, same secret `MCP_TOKEN` (needs `write` added to the token's scopes — the owner re-mints it). Fails the workflow only on a non-200, not on a failed experiment.

**Scheduled experiments:** `experimentSchedules/{id}` `{ cron, template }`; the tick materialises due runs. (HF's own scheduled-jobs API is exposed as tools but the Lab keeps one scheduler so Kaggle and HF behave the same.)

**Chain:** `pushToHf` downloads named outputs (Kaggle output URLs) and commits them to a **private** HF repo with a generated model card (metrics table, source link, run id); `blogDraft` creates an unpublished `posts/` draft from a template with the metrics; `submitTo` submits the predictions file (requires the experiment to carry `confirmSubmit: true`).

**MCP:** `create_experiment`, `run_experiment` (create + submit now), `list_experiments`, `get_experiment`, `cancel_experiment`, `retry_experiment`, `create_experiment_schedule`, `list_experiment_schedules`, `delete_experiment_schedule` (confirm).

**Notify:** a `useBadges()` entry — `waiting` for runs finished since last viewed, `late` for failed.

## 8. Part 5 — Usage + analytics (design level)

- **Consumption** (`get_ml_usage`): Kaggle quota (live), HF billing usage-v2 + jobs + ZeroGPU (live), and **per-experiment** GPU minutes/cost from `experiments/` (exact for what we launched). Each number labelled with its source.
- **Growth snapshots:** nightly `scripts/sync-ml-metrics.mjs` (folded into the existing `sync-metrics` workflow, no secret — public HF API) records HF repo downloads/likes per owned repo and Kaggle public profile counters where public, into `lib/mlMetrics.json`; deltas computed like `metrics.json`.
- **MCP usage:** `pages/api/mcp/index.js` increments `mcpUsage/{YYYY-MM-DD}` `{ [tokenId]: { [tool]: n } , total }` per `tools/call` (fire-and-forget, never blocks or fails the call; admin-only rule). Tools: `get_mcp_usage` (by day, token, tool, errors). Panel section in the existing **MCP** tab.
- **Lab tab** (`components/admin/LabPanel.js`, group "Publish"): quota meters (Kaggle GPU hours left this week, HF spend this month) → run queue (left-edge state language: dashed queued, amber running, solid succeeded, red failed) → expandable run row (metrics, outputs, chain status, logs link) → schedules. `/__labpreview` dev-only with an unflattering seed.

## 9. Part 6 — Colab (design level)

- Register Google's official Colab MCP server in the user-level Claude Code config (`claude mcp add …` per its README), runtime mode where available. No server code in this repo.
- `get_ml_capabilities` (read) returns the table in §2 so a model asked to "run this in Colab unattended" learns in one call to route to Kaggle.
- Notebooks the agent writes are also saveable to the HF repo / GitHub so Colab can open them via URL (`colab.research.google.com/github/...`) — `colab_open_url` helper tool (read, pure).

## 10. Error handling (all parts)

- Every guard refuses **before** I/O with a reason naming the fix (bad repo id, unknown accelerator, read-only token on a write, quota insufficient, missing confirm).
- Provider errors translated, never raw: HF 403 names the token role; Kaggle 401 says the token was revoked/expired and to repaste; 429 surfaces retry time.
- Two accounts of a provider and none chosen → existing `account/ambiguous` refusal.

## 11. Testing

- `npm run test:ml` (no network): hfShape + kaggleShape builders/validators, commit NDJSON, accelerator map, status normalisation, quota shaping, experiment state machine (every legal and illegal transition), chain idempotency against stubbed fetch.
- `npm run test:accounts` += apiKey provider resolution + the legacy `tokenFor` fix. `test:integrations` pinned lists updated.
- `mcp:check`: `EXPECTED.huggingface`, `EXPECTED.kaggle`, `EXPECTED.lab`, `EXPECTED.mlusage`; absences (no repo/dataset/kernel delete, no visibility flip, `get_ml_credentials` is `secrets`-scoped with a handling rule, read-scoped tools offer no mutator).
- `e2e:tasks` += `/api/accounts connectKey` and `/api/lab/tick` refuse anonymous, forged token, GET.
- Live smoke (`ML_LIVE=1`): whoami on both, a tiny CPU Kaggle kernel pushed → polled → output read → committed to a private HF repo → deleted by hand.

## 12. Out of scope (now)

- Uploading files > 10 MB to HF (LFS/Xet protocol) — the chain refuses with the reason; outputs are expected to be small models/adapters/metrics. Revisit if needed.
- Colab Enterprise (Vertex AI, paid GCP).
- Kaggle/HF OAuth app flows (paste-token is simpler and equally multi-account).
- Claude/LLM token accounting.
