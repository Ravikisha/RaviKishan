# Organisations — every login belongs to an org

Status: approved by owner 9 Oct 2026 ("migrate this entire thing to the org level, create Relax, save all current logins on it").

## Problem
Every connection (Google/Microsoft tasks, Gmail/Outlook, YouTube, Instagram, X, GitHub, LinkedIn, GA, Notion, HF, Kaggle), every saved default, identity and saved sign-in is deployment-global. The owner runs several organisations and wants each to be a self-contained workspace: its own logins, its own defaults, its own people, operable from the admin AND from MCP.

## Model
- **Org record** — `orgs/{orgId}` (admin-only collection, new rule). Fields: `name`, `description`, `website`, `color` (hex, optional), `logo` (url, optional), `note`, `createdAt`, `updatedAt`. `orgId` is a slug `^[a-z0-9][a-z0-9-]{1,39}$`, immutable once created (it is stamped on every account; renaming means changing `name`).
- **`relax` is the DEFAULT org** (`DEFAULT_ORG = "relax"`). It always exists implicitly even before its document is written, and it cannot be deleted. Everything that predates orgs belongs to it.
- **Membership is an array on the account**, not a copy of it: `connectedAccounts/<provider>__<accountId>.orgIds: string[]`. A provider account is one credential whatever orgs use it, so the same channel in two orgs is ONE document with `orgIds: ["relax","acme"]`. **Missing or empty `orgIds` ⇒ `["relax"]`.**
- **Legacy `integrations/<docId>` rows** (one per provider, no account doc to stamp) belong to `relax` ONLY and are invisible in every other org.
- **Defaults per org**: `relax` keeps reading/writing `config/accountDefaults` (no migration, live defaults keep working). Any other org uses `config/accountDefaults__<orgId>` (config/ is already admin-only). Never a dotted key inside one document — `toFields` would store a literal `"acme.tasks"`.
- **Identities** (`identities/`) gain `orgId` (missing ⇒ relax). **Secrets** (`secrets/`, including saved sign-ins `login-<provider>-<accountId>`) gain `orgId` (missing ⇒ relax); listings filter by the current org. A saved sign-in is only readable when its account is a member of the current org.
- **Global, NOT org-scoped (stated, not forgotten)**: the portfolio itself — site content, posts, résumé, gallery, short links, jobs, contacts, local notes, vault, the activity log (it records `orgId` per entry), MCP tokens. These are the owner's personal site and records.
- **Deployment-held logins** (env store): `DEVTO_API_KEY`, `TRELLO_API_KEY/TOKEN`, `OBSIDIAN_VAULT_REPO`, `VERCEL_TOKEN`, `NPM_TOKEN`, Medium user, WhatsApp agent (agentd). These are one value per deployment and **belong to Relax**. In any other org the tools that use them refuse with a sentence saying so (`DEPLOYMENT_SCOPED` in `lib/server/orgShape.js`), rather than silently acting with Relax's credential.

## Request-scoped current org (server)
`lib/server/orgContext.js` — SERVER ONLY, never imported by a browser module:
- One `AsyncLocalStorage` stored on `globalThis[Symbol.for("rk.orgContext")]` (Next dev HMR and plain-node ESM can otherwise load two instances, and the setter and reader would disagree).
- `runInOrg(orgId, fn)`, `currentOrg()` → the store's orgId or `DEFAULT_ORG` when no store is active (scripts/tests), `orgSource()` → `"explicit" | "header" | "default"`.
- `withEnv` (lib/server/envStore.js) wraps every API route: it reads `x-org-id` (validated by `ORG_ID_RE`, otherwise default) and runs the handler inside `runInOrg`. OAuth callbacks never carry the header — the org rides in the sealed state instead.
- MCP: the dispatcher runs EACH `tools/call` inside its own `runInOrg` (per call, never `enterWith` — it would leak into the next batch item). Org = `arguments.orgId` → `x-org-id` header → `DEFAULT_ORG`. `orgId` is DELETED from the arguments before the handler sees them (several handlers spread raw args into payloads). An unknown org is refused before the handler runs, listing the known orgs.

## Enforcement layer (where the filter lives)
Filtering only in `allAccounts()` is insufficient — several callers go round it. So:
- `connectedStore.shape()` passes `orgIds` (defaulted). `listAccounts(idToken, provider, { org })` filters to `org ?? currentOrg()`; `{ allOrgs: true }` returns everything (Orgs panel / migration only).
- `readAccount` / `connectedToken` refuse an account that is not a member of the current org with `ConnectedAuthError` code `account/other-org` ("… belongs to Acme, not Relax").
- `connectedAccount.readConnection` (legacy) returns null outside relax; `connectionStatus` likewise.
- `accountDirectory.allAccounts/resolveAccount/tokenFor/readDefaults/writeDefault/listIdentities` are org-aware; `writeDefault` refuses a key that does not resolve inside the org. Every resolution result and every refusal carries `orgId`.
- `chooseAccount` stays pure; it receives an org-filtered pool. Its refusal messages name the org when given `{ orgId }`.

## OAuth / connection writes
- `makeState({ … , orgId })` seals the org; `readState` returns it. `/start` takes the org from the current org context (x-org-id). `/callback` stamps `orgIds: [orgId]` into the record and appends `&org=<orgId>` to the redirect so the panel reopens in the same org.
- **Writes UNION membership, never replace it.** Browser `finishConnect` writes `orgIds: arrayUnion(...record.orgIds)` with `setDoc(..., { merge: true })`; server `connectKey` merges with the existing array. A plain merge would evict the account from its other orgs.
- Pre-existing bug fixed here: `lib/taskProviders.js` `finishConnect` wrote the multi-account google/microsoft record into the legacy `integrations/` doc, ignoring the claim's `collection/docId`. It now delegates to `socialClient.finishConnect`.
- **Disconnect from an org removes that org from `orgIds`; the credential document is deleted only when no org is left.** Browser direct `deleteDoc` disconnects go through `/api/accounts` `forget` instead.

## API
`pages/api/orgs.js` (admin-gated, allow-list actions): `list` (with per-org account/service counts), `get`, `create`, `update`, `delete` (refuses relax; refuses while any account would be left with no org unless `confirm` and it then only unassigns), `assign` (set an account's orgs — never empty), `migrate` (idempotent, `dryRun`: writes `orgs/relax` if missing, stamps `orgIds:["relax"]` on every connectedAccounts doc that lacks it, `orgId:"relax"` on identities and secrets lacking it; reports counts).
`/api/accounts` and everything else act inside the current org automatically via the header.

## Browser
- `lib/orgState.js` — current org: `?org=` → localStorage `rk-org` → `relax`. `setOrg(id)` writes both and **reloads the admin** at the same tab: module-level token caches (`taskProviders`, `github`), per-account selections and panel state all belong to the previous org, and a reload is the one way to guarantee none survives.
- `lib/adminFetch.js` — the ONE authed fetch for same-origin `/api/*` calls: adds `Authorization` and `x-org-id`. Every private helper (socialClient, taskProviders.ours, github.accessToken, accountsClient, mailClient, notesClient, linkedinClient, GaPanel, YouTubePanel, SecretsPanel, GithubPanel, LinkedInPanel inline fetches) moves onto it. NEVER on direct provider calls (Google/Graph/api.github.com) — a custom header forces a CORS preflight they reject.
- Browser Firestore reads of `connectedAccounts` filter by org client-side (missing ⇒ relax).
- `useTabInUrl` preserves `?org=`.
- **AdminShell**: the brand slot becomes the org switcher (org name + colour dot; menu of orgs + "Manage orgs"). The current org name is the rail's identity: "which org am I acting in" is the one question every panel now depends on.
- **Orgs tab** (group Access, beside Accounts): one row per org with what it holds (accounts per service), create/edit form, delete; the account roster across ALL orgs with an org membership chip set per account (the one place membership is edited); "Bring existing logins into Relax" migration control with dry-run counts.
- `/__orgspreview` renders the real Orgs panel parts against a fixed seed (dev-only, `notFound` in production).

## MCP
- `orgId` is advertised (optional, never required) on every tool that resolves an account (flag set computed in `listToolsFor` by declared `accountId` or an explicit `ORG_SCOPED` list), described without the words password/secret/token.
- New tools: `list_orgs` (read), `get_org` (read: record + accounts by service + defaults + gaps), `create_org` (write), `update_org` (write), `set_account_orgs` (write; refuses an empty set; reports before/after), `delete_org` (write, `confirm: true`, refuses relax), `migrate_logins_to_org` (write, `dryRun`).
- `list_accounts`, `whoami_for`, `get_account_services`, `set_default_account` report the org they acted in. `initialize` instructions explain orgs.
- Spanning tools (`list_all_tasks`, `read_all_mail`, `list_youtube_channels`) span every account **in the current org**, not every org.
- Deployment-scoped tools refuse outside relax. Activity log entries carry `orgId`.
- Deliberate absences kept: nothing connects/disconnects an account; nothing moves a credential to a different deployment.

## Tests
`npm run test:orgs` (no network) — org id validation, membership defaulting, union semantics, defaults path per org, the per-org filter, `chooseAccount` per org, state sealing the org, ALS singleton + per-call isolation + default fallback, dispatcher stripping `orgId`, deployment-scoped refusal. Existing suites updated, `mcp:check` asserts the new family + absences, `rules:check` asserts `orgs` is denied anonymously, `e2e:orgs` drives `/__orgspreview`.
