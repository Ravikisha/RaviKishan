# Memory, MCP prompts, and agent control from the admin

Status: owner-approved 10 Oct 2026. Decisions: per-org + global memory with auto-learn; Claude Code / Codex login from the admin by BOTH token paste and relayed sign-in; Oracle VM via OCI CLI; tunnel via Cloudflare `agent.ravikishan.me`.

Goal (owner's words, condensed): one server + one control app so an idea goes plan → code → test → deploy → blog → notes → portfolio → LinkedIn, and business ideas (social apps, YouTube channels) run through the same machine — driven from the admin PWA now, a phone/watch app later (voice), with full visibility of what is running and whether it is stuck, using Claude Code's and Codex's real features (skills, plugins, MCP, approvals).

## 1. Memory that grows

**Store.** Firestore `memories/{id}` (admin-only rule). A memory is ONE durable fact:
`{ scope: "global" | "org", orgId, kind, text, tags[], source, confidence (0..1), createdAt, updatedAt, lastUsedAt, uses, supersedes?, archived }`.
- `kind`: `preference` (how the owner likes things done), `fact` (about the owner/org/business), `decision` (with why), `lesson` (what failed/worked), `project` (ongoing work + state), `person`, `reference` (URL/resource).
- **Two layers**: `global` = the owner ("me") — preferences and facts true in every org; `org` = scoped to one org (filed under `orgId`, current org by default). Recall always returns the current org's memories PLUS global ones, never another org's.
- `source`: where it was learned (`mcp:<tool>`, `agent:<jobId>`, `admin`, `reflection:<sessionId>`), so a wrong memory can be traced and corrected.

**Grows by itself, safely.**
- `remember` dedupes: a new text near-identical to an existing memory (normalised token Jaccard ≥ 0.8 within the same scope+kind) UPDATES it (bumps confidence, merges tags) instead of adding a duplicate. A contradiction is recorded with `supersedes` and the old one archived, never silently overwritten.
- `reflect` takes a conversation/job summary and a list of candidate learnings and files each through `remember` — this is the "learn from the conversation" step. The MCP `initialize` instructions and every prompt tell the model to call `recall` at the start and `reflect` at the end of substantial work.
- Agent jobs: agentd prepends the recalled memories to the job prompt and, when a job finishes, asks the model for learnings in a fixed JSON block that agentd posts back through the MCP `reflect` path.
- Nothing secret ever enters memory: `remember` refuses text that looks like a credential (same key/shape heuristics as the activity log redaction + common key prefixes), with a sentence saying to use the secret store.
- `uses`/`lastUsedAt` bump on recall so stale memories can be found; ranking = text match score × confidence × recency.

**Search.** No embeddings (owner chose not to pay for them): a pure scorer (`memoryShape.js`) — every query word must match text/tags, title-ish weighting, kind/tag filters — the same shape as the notes search scorer.

**MCP** (scope: `read` for recall/list/search, `write` for remember/update/forget/reflect): `recall` (top-N for a task, current org + global, bumps uses), `search_memory`, `list_memories`, `remember`, `update_memory`, `forget_memory` (archives; `confirm` to hard-delete), `reflect`, `get_memory_guide`.
**Admin**: Memory tab (group Stored): filter by layer/kind/tag, search, edit inline, archive, confidence shown as the left-edge weight.

## 2. MCP that explains itself, and prompts

- `get_mcp_guide` (read): the map of the whole server for a model — every family, what it is for, **the access levels** (`read` < `write` < `vault` < `secrets`: what each unlocks, why `secrets` is never implied, why a token should hold the least), the org model (how to act in an org: `orgId` on any call), memory etiquette, the deliberate absences, and recommended call order per job ("ship an idea", "post about it", "review the week"). Optional `topic` to return one section.
- Every org tool and memory tool description states WHEN and WHY, not just what.
- **MCP prompts** (`prompts/list`, `prompts/get` — currently empty): templates a client exposes as slash-commands. Each takes `org` (default relax) and returns messages instructing the model which tools to call, in what order, with the org pinned:
  - `prepare_idea` (org, idea) — "go for the relax org and prepare an idea": recall memory → get_org (what resources/accounts the org has) → shape the idea into a plan using THOSE resources (which channel, which mailbox, which GitHub account) → save plan to notes → remember decisions.
  - `launch_idea` (org, idea) — the /launch pipeline in that org.
  - `org_brief` (org) — what the org has, what's waiting (mail, tasks, overdue), recent activity.
  - `plan_content` (org, topic) — blog + LinkedIn + YouTube plan for one topic using the org's accounts.
  - `weekly_review` (org) — activity log + analytics + tasks → summary → reflect.
  - `run_on_server` (org, task, repo?) — hand a coding job to agentd.

## 3. Agent server control from the admin

agentd (`agent/`) already: spawns claude/codex per job, profiles (one signed-in account each), approvals, transcripts, WhatsApp, voice. Added:
- **Login from the admin**, per profile and tool:
  - *Token*: paste a `claude setup-token` token (→ `CLAUDE_CODE_OAUTH_TOKEN`) or an OpenAI API key for Codex (`codex login --with-api-key`). Sent over the authenticated agent socket; stored ON THE BOX in the profile dir (mode 600, owned by `agent`), never in Firestore, never echoed back — status reports only presence + last-4.
  - *Relayed sign-in*: agentd runs `claude auth login` / `codex login --device-auth` for the profile, streams the URL/device code to the panel, accepts the pasted code back, reports success. Times out at 10 min and kills the child.
  - *Sign out / switch*: removes the profile's credentials.
- **Is it stuck?** Each job reports `lastEventAt`; the registry marks a running job `stalled` after `AGENT_STALL_MS` (default 5 min) with no output and not waiting on an approval (waiting on you is not stuck — it says so). Panel shows running / waiting-on-you / stalled / done with elapsed time, and Stop.
- **Claude features per profile**: list/install/remove plugins and marketplaces (`claude plugin …`), list skills, list MCP servers; Codex: config + MCP servers. Each job can name skills/plugins to enable and always gets this site's MCP server (with the job's org) so the job can use org accounts and memory.
- **Org on jobs**: a job carries `orgId`; its MCP config sends `x-org-id`; recall is injected; reflection writes back.
- **HTTP API for MCP** (token-authenticated like `/whatsapp`): `list_agent_runs`, `get_agent_run` (incl. stalled + transcript tail), `start_agent_run` (dryRun shows the exact command), `stop_agent_run`, `answer_agent_approval`, `get_agent_status` (box health, profiles + login presence, limits). Named `*_agent_run` to avoid the job TRACKER's `*_job` tools.

## 4. The box

Oracle Always Free `VM.Standard.A1.Flex` 4 OCPU / 24 GB, Ubuntu 22.04, created with the OCI CLI from `agent/setup/provision-oci.mjs` (retries across availability domains on "Out of capacity"), cloud-init = `agent/setup/cloud-init.yaml`, no ingress ports. Cloudflare Tunnel `agent.ravikishan.me` (requires ravikishan.me nameservers on Cloudflare — the owner moves them from Namecheap after Cloudflare has imported every existing record).
