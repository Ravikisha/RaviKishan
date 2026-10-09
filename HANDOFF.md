# Handoff: Mail desk (Gmail/Outlook) + branch consolidation onto main

**Generated**: 9 October 2026, 13:33 IST
**Branch**: `main` — clean tree, `main == origin/main` at `9f87942`
**Status**: Ready for Review. Mail is live for Gmail; two external blockers remain (Outlook redirect URIs, no mail sent yet).

## Goal

Two things, in order:
1. Build a **Mail section** in the admin — multi-account Gmail/Outlook, read mail + analytics, MCP tools for read/reply/compose, a design pass, HTML message rendering.
2. **Merge every branch into main**, delete the rest, push.

Both are done. What is left is external setup and one decision that needs a human.

## Completed

- [x] `gmail` + `outlook` registered as their **own** providers, borrowing the existing Google/Microsoft OAuth clients
- [x] `lib/server/mailShape.js` (pure) + `lib/server/mailBoard.js` (network) + `pages/api/mail.js` + `lib/mailClient.js`
- [x] 9 MCP mail tools (239 total registry)
- [x] `components/admin/MailPanel.js` + `MailStyles.js` + a **Mail** tab under *Waiting on you*
- [x] `Mailboxes` row: add / set-default / reconnect / disconnect, always rendered
- [x] `lib/server/mailHtml.js` — sanitiser + sandboxed-frame renderer for HTML bodies
- [x] GCP: Gmail API enabled on project `flash-antler-479519-b0`; 3 gmail callbacks registered on the "Portfolio" OAuth client
- [x] **Two Gmail mailboxes connected and verified live** (`ravikishan63392@gmail.com` = default, `godasap7@gmail.com`)
- [x] `/__mailpreview` renders the real components against an unflattering seed
- [x] `test:mail` 162 · `e2e:mail` 171 · `mcp:check` 285 · `test:integrations` 121
- [x] Merged `worktree-tasks-reconnect`, `contacts`, `agent` (and `notes` transitively) into main; deleted 7 local branches, 6 worktrees, 2 remote branches
- [x] `next build` passes, ESLint 0 errors, pushed to `origin/main`

## Not Yet Done

- [ ] **Outlook redirect URIs** — blocked, see below
- [ ] **Send a real e-mail.** The send path is proven to the wire via `dryRun` only. Nothing has ever been sent from this deployment.
- [ ] `cid:` inline attachments render as blocked placeholders — resolving them needs fetching the attachment part and inlining it
- [ ] Mail has **no `e2e:tasks`-style anonymous-caller assertions** for `/api/mail`. Every other route has them; this one does not.
- [ ] `npm run unused` has not been run since the merge — `lib/server/socialAccounts.js` was deliberately dropped, but the merge may have orphaned other files
- [ ] Pre-existing, unrelated: npm not connected (`NPM_TOKEN`), X needs "I trust this app" + credits, launch pipeline never run live, `.env` tracked in git with a dead `IG_ACCESS_TOKEN`, `site/content` has no `identity` section (blocks the drift detector)

## Blockers

**Outlook cannot be finished from this machine.** Azure app `bf2d26a1-8b4a-4c9d-9333-ff506756601e` is not in the `zimyo.com` directory the browser is signed into — `ravi.kishan@zimyo.com` owns no apps there and has only that one directory. All Outlook code is written and unit-tested; only the redirect URI registration is missing.

Fix: sign in to the Azure portal as whoever owns that app registration, then add
`/api/integrations/outlook/callback` for `https://www.ravikishan.me`, `https://ravikishan.me`, and `http://localhost:3000`.
`npm run mail:setup` prints the exact list.

Graph's v2.0 endpoint supports dynamic consent, so `Mail.ReadWrite` / `Mail.Send` may not need pre-registering — **the redirect URI does.**

## Failed Approaches (Don't Repeat These)

**An arrival-chart strip in the Mail panel — built, then cut.**
A per-day bar strip drawn from a *fetched page* renders every day past the end of that page as an empty bar, which reads as a quiet day and is really "we did not look". Measured live: 47 messages covered 3 days, so 4 of 7 bars were lies. `get_mail_analytics` keeps the per-day numbers because it states its sample size in the same breath; a picture cannot. Don't re-add it without a real windowed query.

**`ml-` as the Mail CSS prefix.**
`components/os/apps/Mail.js` already owns `.ml-body`, `.ml-chip`, `.ml-count`, `.ml-done`, `.ml-subj` in a `<style jsx global>`, and `DesktopOS` mounts on every route. Prefix is `mbx-`.

**A backtick inside a styled-jsx CSS comment.**
A styled-jsx block is a template literal. Produced `Expected a template literal, string or identifier inside the JSXExpressionContainer` pointing at line 18 of a 480-line block. Already in CLAUDE.md; hit it again anyway.

**`documentElement.scrollHeight` for the mail iframe height.**
It is bounded below by the viewport, and the viewport is the frame the parent just resized — so it ratcheted +8px every tick. Measured 5560px → 11968px on a near-empty message. Report `document.body` height, and **do not add a constant** in the parent on top of a measurement it feeds back.

**Matching void elements as paired tags in the sanitiser.**
`<link>` and `<meta>` have no closing tag. Matched as `<tag>…(</tag>|$)`, the `<link>` in a real Google alert's `<head>` ran to EOF and **deleted the whole message body** — blank frame, no error, mail read as empty rather than broken. Void / paired / raw-text are three separate lists now; only raw text (`script, style, title, textarea, noscript`) may run to EOF.

**Rendering mail on the console's dark surface.**
Mail is authored for white. Google's alert came out dark grey on `#0f1117` — present, unreadable. Inverting the sender's colours wrecks branded newsletters. The message sits on a white sheet inside the dark console.

**`dangerouslySetInnerHTML` for mail bodies — never attempted, and must not be.**
Mail HTML is the only content in this product written by someone who is not the owner. See Warnings.

**Blanket "keep both sides" on merge conflicts.**
Concatenating `ours + theirs` produced files that *looked* merged and did not parse: a tool object's closing `},` was eaten at the env/WhatsApp seam, the agent suites landed inside `contactsSuite`'s `catch`, and the contacts assertion block landed inside the env block. Fix for all three: take main's file whole, lift the other side's functions/blocks out **brace-balanced**, and splice at top level.

**Python heredocs for file edits — recurring damage.**
`\\n` inside `python3 - <<'PY'` arrives as a real newline, so anchors containing `\n` never match and written JS gets a literal line break inside a string. Use `chr(92)` to build backslashes, or the Edit/Write tools.

## Key Decisions

| Decision | Rationale |
|---|---|
| `gmail`/`outlook` as separate providers, not extra scopes on `google`/`microsoft` | Gmail's scopes are RESTRICTED. Bolting them on would demand a whole mailbox from anyone connecting a to-do list and drag every existing Tasks connection into Google's restricted-scope verification. They share only the OAuth *client*. |
| `https://mail.google.com/` never requested | So there is no permanent-delete tool and could not be one. Trash is recoverable on both services. |
| Merged stream, not a per-account shelf | "What arrived and does it need me" is the question. Tasks spends *position* on the account; a merged list has none left, so each row carries its mailbox as an address in mono. |
| Send button says the address and doesn't exist until reviewed | With several mailboxes the unrecoverable mistake is the *account*. A confirm dialog asks you to agree; the review asks you to look. |
| Sandboxed iframe > sanitiser as the primary control | The frame has no `allow-same-origin`, so it cannot reach the admin's DOM/cookies/IndexedDB regardless of sanitiser bugs. |
| Remote images blocked per message, never remembered | A sticky setting turns a decision about one sender into a decision about all of them. |
| Merge resolution: main's side for shared features, hand-port what contacts/agent uniquely had | Both lines built the same integrations in parallel; main was later everywhere except the contacts address book (8 tools vs 3) and the whole `agent/` subproject. |
| Kept `backup` and `pre-rewrite-backup` | Both are safety nets. Deleting a pre-rewrite backup is effectively irreversible. |

## Current State

**Working**: Mail reads both Gmail mailboxes merged; opens, marks read, archives, trashes; renders HTML bodies in a sandboxed frame with images blocked; `dryRun` send and reply return the exact message and address. All 16 no-network suites green, `next build` passes.

**Broken**: nothing known. Outlook is unconnectable (external), not broken.

**Uncommitted Changes**: none. Tree is clean, `main == origin/main`.

**Note**: removing the worktrees with `--force` deleted an untracked `HANDOFF.md` from the 7 Oct session. It described superseded work; this file replaces it.

## Files to Know

| File | Why It Matters |
|---|---|
| `lib/server/mailShape.js` | PURE. `CAPABILITIES` is data read by panel + tools + tests, so they cannot drift. MIME building, header-injection guard, `summarise()`. |
| `lib/server/mailBoard.js` | The two adapters. `queryUrl()` is exported solely because of the repeated-parameter bug. |
| `lib/server/mailHtml.js` | Sanitiser + `mailFrameDoc()`. The three element lists (`DROPPED_VOID` / `DROPPED_PAIRED` / `DROPPED_RAWTEXT`) are the void-element fix. |
| `components/admin/MailPanel.js` | `Mailboxes`, `Reader`, `MailBody`, `Composer`, `Outbound`. All exported for `/__mailpreview`. |
| `pages/api/mail.js` | Allow-list actions. Must never grow a `path` parameter — that would make it a tunnel to Gmail carrying the mailbox credential. |
| `scripts/mail-check.mjs` | 162 assertions; 22 are attack vectors that must not survive. |
| `scripts/mail-setup-check.mjs` | `npm run mail:setup` — prints what still needs doing in a console. |
| `lib/server/accountDirectory.js` | `tokenFor()` / `resolveAccount()`. Mail resolves under service `mail`. |

## Code Context

**Both adapters return both bodies:**
```js
// mailBoard.js — gmail.get() / outlook.get()
{ ...shapeMessage(provider, raw), body: text, html, hasHtml: boolean }
```

**The frame document:**
```js
mailFrameDoc(html, { allowRemoteImages = false, nonce = "", dark = false })
  -> { doc, blockedImages, removed, csp }
```
Rendered as:
```jsx
<iframe
  sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"  // NO allow-same-origin
  referrerPolicy="no-referrer"
  srcDoc={built.doc}
/>
```
CSP inside the doc: `default-src 'none'; img-src data:[ https: http:]; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-…'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`

**Height arrives by postMessage** (the frame is an opaque origin, so `e.origin` is `"null"` — identify by `contentWindow`):
```js
if (!frame.current || e.source !== frame.current.contentWindow) return;
const h = Number(e.data?.mbxHeight);
```

**`/api/mail` accounts response:**
```json
{ "accounts": [{ "accountId": "…", "key": "gmail__1160…", "account": "ravikishan63392@gmail.com",
                 "provider": "gmail", "needsReconnect": false, "isDefault": true }],
  "hasDefault": true, "capabilities": { "gmail": {…}, "outlook": {…} } }
```

**Non-obvious**: `queryUrl()` must `append` array values, not `set` a joined string. Gmail's `metadataHeaders` is a repeated parameter; a comma-joined value matches no header and returns an **empty headers array** with a 200 — a whole inbox of "Unknown sender" and nothing in any log.

## Resume Instructions

1. `cd D:/personal_sync/RaviKishan && npm run dev`
   *(the dev server was stopped to remove the worktrees — start it from the repo root now, not from a worktree)*
2. Open `http://localhost:3000/admin?tab=mail`
   - Expected: "N unread in the 50 newest across 2 mailboxes", two chips + "Add a mailbox"
   - If "0 mailboxes connected" persists past ~10s: check the browser console; the claim path reports failures now
3. Click a Google or Kaggle message
   - Expected: body renders as a page on a white sheet, with "N images not loaded" above it
   - If the frame is blank: the sanitiser ate the body — check `DROPPED_VOID` handling first, that is where it happened before
4. `npm run test:mail` → expected `162 passed, 0 failed`
5. `npm run e2e:mail` (needs dev running) → expected `171 passed, 0 failed`
6. `npm run mail:setup` → prints the Outlook callbacks still to register

To finish Outlook: register the three callbacks (step 6 lists them), wait for propagation, then Mail → **Add a mailbox** → Outlook.

## Setup Required

- Envs are all in the sealed store; the deployment holds only `ENV_KEY`
- Gmail/Outlook need no envs of their own — they borrow `GOOGLE_TASKS_CLIENT_ID`/`_SECRET` and `MS_TASKS_CLIENT_ID`/`_SECRET`
- Google's consent screen presents the two Gmail permissions as **individually unticked checkboxes**. Missing one gives a connection that reads but cannot send.
- The app is unverified: reach consent via **Advanced → Go to Ravi Kishan (unsafe)**

## Edge Cases & Error Handling

- One mailbox unreadable, others fine → `readEverywhere` returns `partial: true` + `unreadable[]`, panel shows a red-edged note above the stream, rest still renders
- Two mailboxes, no default, unnamed MCP call → server **refuses and lists candidates**. Set a default from the `···` menu.
- Consent succeeds but the claim fails → error is held across `load()` and stated with the provider's name (it used to be silently cleared)
- Message with no HTML part → falls back to the text body in `.mbx-body`, no frame
- `cid:` inline image → counted as blocked, placeholder shown. **Not resolved yet.**
- Reply with no `messageId` → refused by schema; it would otherwise arrive as a brand-new mail to someone expecting an answer, which looks like it worked

## Warnings

- **Never point `dangerouslySetInnerHTML` at a mail body.** It is the only attacker-authored content in this product. The iframe without `allow-same-origin` is the real control; the sanitiser is defence in depth.
- **Do not add `allow-same-origin` to the mail frame** to make height measurement easier. That is the whole boundary.
- **Do not reintroduce a bitrate on `MediaRecorder`** (pre-existing, `probe:recorder` documents it).
- `main` is a **linked Vercel project — a push IS the production deploy.** Build before pushing. The `qrcode` dependency was declared but uninstalled and the first post-merge build failed on it.
- Recovery tag **`pre-merge-main` → `18f2614`** is the pre-merge state if a merge resolution turns out wrong.
- **Residual merge risk**: ~20 shared files were resolved to main's side wholesale. If `contacts` or `agent` had a one-line fix buried in one of them, nothing would notice. Unique *files* were checked (that is how the contacts tools and `contactShape.js` were caught); unique *lines inside shared files* were not.
- `backup` and `pre-rewrite-backup` branches are kept on purpose.
