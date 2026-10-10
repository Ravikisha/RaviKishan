# Workbench — chat, desktop, terminal and previews on the agent box

Status: owner-requested 10 Oct 2026. "Controlled and visual, not blind."

The Agent tab already runs one-shot JOBS (task → workspace → claude/codex → verify → PR). The owner wants an interactive WORKBENCH on the same box, from the admin and over MCP:

1. **Chat** — talk to Claude Code or Codex turn by turn, see every tool call, approve risky ones inline, keep history, resume any past conversation, pick the profile / model / working directory / plugins.
2. **Desktop** — a real graphical desktop on the VM, viewed and driven from the admin (remote-desktop style). The agent's browser runs ON this desktop, so when Claude browses or clicks, the owner watches it happen and can take over.
3. **Terminal** — a shell on the box in the browser.
4. **Previews** — any app the agent starts on the box (a dev server on port 3000) opened in the admin through an authenticated proxy, without opening a port.
5. **Review** — one timeline of OS-level actions (commands, file writes, desktop clicks/keys, browser navigations) with who did them (owner / agent session) and, for gated ones, the approval decision.

Everything rides the EXISTING authenticated agentd WebSocket / HTTP API through the existing Cloudflare tunnel. No new public port, ever.

## 1. Chat sessions (agent/src/chat.js)
- A chat = one long-lived child: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages` with the job-style MCP config (approval bridge + site MCP with `x-org-id`) and `--permission-prompt-tool mcp__agentd__approve`. Each owner message is written to stdin as a stream-json user message; every stdout event is parsed (reuse stream.js) and broadcast as `chat.event` to authenticated sockets.
- Resume: `--resume <sessionId>` (Claude persists sessions under `$CLAUDE_CONFIG_DIR/projects/<cwd-slug>/<sessionId>.jsonl`). History = list those files per profile (title = first user message, updatedAt, cwd, messageCount); `chat.history` reads one into displayable turns.
- Codex: each turn runs `codex exec --json` (first) / `codex exec resume <sessionId> --json` (later) with CODEX_HOME of the profile; history from `$CODEX_HOME/sessions/**.jsonl`.
- Options per chat: profile, tool, model (`--model`), cwd (a workspace under `paths.work/chats/<id>` by default, or a cloned repo URL), permission policy (reuse policy.js levels), allowed plugins/skills, orgId.
- Controls: `chat.interrupt` (SIGINT the current turn, keep session), `chat.close` (end the child), idle chats are closed after `AGENT_CHAT_IDLE_MS` (30 min) but stay resumable.
- Limits: counts toward `AGENT_MAX_CONCURRENT` / per-profile.
- Socket messages: `chat.list`, `chat.history {profile, tool, sessionId}`, `chat.start {profile, tool, model, cwd|repo, orgId, policy, prompt}` → `chat.started {chatId, sessionId}`, `chat.send {chatId, text}`, `chat.interrupt`, `chat.close`, `chat.resume {profile, tool, sessionId, prompt?}`; broadcasts `chat.event {chatId, event}` and `chat.state {chatId, state: idle|thinking|waiting|closed, sessionId}`.

## 2. Desktop (setup + agent/src/desktop.js)
- Stack (installed by setup.sh, both apt and dnf): Xvfb display `:1` 1600x900, a light window manager (xfce4 if available, else openbox) + panel, x11vnc bound to 127.0.0.1:5901 with `-localhost -nopw` (loopback only, reachable solely through agentd), Chromium (or Firefox if no Chromium), xdotool + scrot/ImageMagick `import` for screenshots. systemd units `agentd-desktop` (Xvfb+WM) and `agentd-vnc`, run as the `agent` user.
- **VNC over the agentd socket**: agentd exposes `wss://agent…/desktop` which, after the same Firebase-token auth as the main socket (token in first message, or `?ticket=` one-time ticket minted over the main socket — browsers cannot set headers on WebSocket), pipes raw bytes to 127.0.0.1:5901 (websockify semantics). The admin renders it with noVNC (`@novnc/novnc`, dynamically imported). View-only toggle default ON for safety; "Take control" switches to interactive.
- **Agent sees and acts on the same desktop**: chats and jobs get a `desktop` MCP server (agent/src/mcp-desktop.js, stdio) with `screenshot`, `click {x,y,button}`, `double_click`, `type {text}`, `key {combo}`, `scroll`, `move`, `open_url {url}`, `list_windows`, `focus_window`. Each action is logged to the review timeline and, when the chat policy says so, gated through the approval bridge first. Also offer the Playwright MCP pointed at the desktop browser (CDP on 127.0.0.1:9222 launched with `--remote-debugging-port`) so browsing is structured AND visible.
- `DISPLAY=:1` is set for chats/jobs so any GUI app they launch appears on the shared desktop.

## 3. Terminal (agent/src/terminal.js)
- `node-pty` (optionalDependency; if it fails to build, fall back to `script -qfc bash /dev/null` via child_process) running `bash -l` as `agent`, cwd selectable. Socket messages `term.open {cols, rows, cwd}` → `term.opened {termId}`, `term.input {termId, data}`, `term.resize`, `term.close`; broadcast `term.output {termId, data}` ONLY to the socket that opened it (never broadcast a shell to every viewer). Admin renders with xterm.js (dynamic import). Every command line entered (on Enter) is appended to the review timeline. Requires a fresh sign-in (auth_time < 30 min), same as other step-up actions.

## 4. Previews (agent/src/preview.js)
- `GET /preview/<port>/<path>` on agentd proxies HTTP + WebSocket upgrades to `127.0.0.1:<port>` — ports 1024–65535 except agentd's own and VNC/CDP; auth via a short-lived signed preview cookie minted over the socket (`preview.open {port}` → `{url}`), because an iframe cannot send a bearer header. `preview.list` shows listening ports owned by `agent` (`ss -tlnp`). Admin opens it in an iframe tab or a new window.

## 5. Review timeline (agent/src/oplog.js)
- Append-only NDJSON at `~/.agentd/logs/ops.ndjson`: `{at, actor: owner|chat:<id>|job:<id>|mcp, kind: command|file|desktop|browser|terminal|approval, summary, detail (redacted), decision?}`. Sources: approval bridge decisions, chat tool_use events (Bash/Edit/Write), desktop MCP actions, terminal command lines, preview opens. `ops.list {since, actor, kind}`; broadcast `ops.event`. Redact with the existing redact().

## 6. Admin UI (Agent tab → becomes "Workbench")
Sub-views: **Chat** (session list with history + resume on the left, conversation with streamed text, collapsible tool-call cards, inline approval cards, composer with profile/tool/model/cwd/org/policy chips, slash-command hints, interrupt), **Desktop** (noVNC canvas, view-only/take-control toggle, screenshot button, clipboard paste, fullscreen, side panel showing the live desktop-action log), **Terminal** (xterm), **Previews** (ports, open), **Review** (timeline with filters, approvals waiting on top), existing **Runs**, **Accounts**, **Features** (plugins/skills/MCP). Phone-first: one view at a time, bottom switcher. All existing design rules apply.

## 7. MCP (site)
Behind scope `agent` (start/act) or `read` (list/history):
`list_chat_sessions` (read), `get_chat_history` (read), `start_chat` (agent), `send_chat_message` (agent; waits up to `waitMs` for the turn to finish and returns the assistant text + tool summary), `interrupt_chat` (agent), `get_desktop_screenshot` (read; returns image content), `desktop_action` (agent; click/type/key/open_url — logged), `list_previews` (read), `get_ops_log` (read). agentd HTTP API grows matching routes (`/chats`, `/chats/:id/messages`, `/desktop/screenshot`, `/desktop/action`, `/previews`, `/ops`). Terminal is NOT exposed over MCP (a chat session already has Bash under approvals; a raw shell over MCP would bypass them).

## Safety rules that do not bend
- No new public ports; VNC/CDP/preview targets are loopback-only; every byte goes through agentd auth.
- Terminal output goes only to its opener. Desktop view-only by default.
- Desktop and terminal actions are logged; desktop MCP actions obey the chat's approval policy.
- Approval deny-by-default and deny-on-timeout are unchanged.
