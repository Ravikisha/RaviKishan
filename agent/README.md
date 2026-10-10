# agentd

Claude Code and Codex on your own server, driven from the admin PWA. Start a
job from your phone, watch it work, approve the parts that cannot be undone.

Everything here is **free to run**: an Oracle Cloud Always Free box (or any
machine you own) plus Cloudflare Tunnel. The model usage comes from the
subscription you already have.

---

## What it is

```
  phone / laptop, anywhere
         │  admin PWA, Firebase-authenticated
         ▼
  wss://agent.<your domain>   →   Cloudflare Tunnel (no open ports)
         ▼
  agentd           authenticates, keeps the job registry, routes approvals
         ▼
  one workspace per job        git clone → claude/codex → verify → PR
```

`agentd` never executes anything itself. It spawns, supervises and streams.

---

## Set up a server

**Oracle, from your laptop** — creates the network and the Always Free A1 box
and retries "Out of host capacity" across every availability domain until it
gets one (API-key setup in `setup/oracle.md` §2a):

```bash
node agent/setup/provision-oci.mjs --dry-run                     # every command, nothing run
node agent/setup/provision-oci.mjs --ssh-cidr "$(curl -s https://checkip.amazonaws.com)/32"
```

The box provisions itself from `setup/cloud-init.yaml`. **Any other Ubuntu
box** — clone and run the same script cloud-init runs:

```bash
git clone https://github.com/Ravikisha/RaviKishan.git /opt/agentd
sudo bash /opt/agentd/agent/setup/setup.sh
```

That installs Node, git, `gh`, Claude Code and Codex; creates an unprivileged
`agent` user; writes `/etc/agentd.env`; and starts `agentd` under systemd bound
to **127.0.0.1**. It deliberately opens no port.

Then the two things that need your accounts, which cannot be scripted:

**1. The tunnel**

```bash
cloudflared tunnel login
cloudflared tunnel create agentd
cloudflared tunnel route dns agentd agent.ravikishan.me
# /etc/cloudflared/config.yml — see setup.sh for the file
cloudflared service install && systemctl start cloudflared
```

**2. Sign an account in** — from the admin's Agent tab once the tunnel is up
(see *Signing in from the panel* below), or over SSH:

```bash
sudo -u agent -H env CLAUDE_CONFIG_DIR=/home/agent/.agentd/profiles/personal/claude \
  claude auth login
```

It prints a URL. Open it anywhere, approve, done.

Check everything:

```bash
cd /opt/agentd/agent && npm run doctor
```

---

## Several accounts, several jobs

A **profile** is one signed-in account. Each has its own config directory, so
several are signed in at once and a job names the one it runs as:

```
/home/agent/.agentd/profiles/
  personal/claude   CLAUDE_CONFIG_DIR for the personal subscription
  personal/codex    CODEX_HOME
  work/claude       a different account entirely
```

Add one by running `claude auth login` with that `CLAUDE_CONFIG_DIR`, or from
the panel.

> Profiles exist so work for different **identities** stays separated — the
> credentials, history and rate limits of a personal and a work account should
> not be mixed. They are not a way to pool quota, and `pickProfile` has no
> "next free account" mode for that reason: a job names its profile.

Three limits, each for a different failure (`/etc/agentd.env`):

| variable | default | what it prevents |
|---|---|---|
| `AGENT_MAX_PER_PROFILE` | 2 | one account's jobs degrading together on its rate limit |
| `AGENT_MAX_CONCURRENT` | 4 | the box running out of memory mid-`npm install` |
| `AGENT_MAX_PER_DAY` | 50 | a background agent quietly spending the month's budget |

---

## Signing in from the panel

Per profile and per tool, over the authenticated socket — no SSH:

| | Claude Code | Codex |
|---|---|---|
| **paste a token** | `claude setup-token` output → stored as `<profile>/.claude-token` (mode 600) and injected as `CLAUDE_CODE_OAUTH_TOKEN` | an OpenAI API key → `codex login --with-api-key`, fed on **stdin** so it never appears in `ps` |
| **relayed sign-in** | agentd runs `claude auth login` under the profile's `CLAUDE_CONFIG_DIR` and relays the URL; you paste the code back | `codex login --device-auth`; the URL and device code are relayed |
| **sign out** | the tool's own logout, then the files go regardless | same |

A token never comes back out: status is presence, method (`token` / `oauth`)
and the **last four** characters. It is never written to Firestore or a log.
A relayed sign-in is cancelled after `AGENT_LOGIN_TIMEOUT_MS` (10 minutes) and
its child killed; one per profile and tool at a time.

---

## Is it stuck?

Every event a job emits stamps `lastEventAt`. A **running** job silent for
`AGENT_STALL_MS` (5 minutes) becomes `stalled` and the panel is told; the next
line it prints makes it `running` again. A job blocked on an approval is
`waiting`, never `stalled` — waiting on you is the system working, and leaving
`waiting` restarts the clock so a slow approval does not read as stuck. Every
job leaves the server with `elapsedMs`, `idleMs` and `pendingApprovals`.

---

## Claude Code's own features

Per profile, because each profile is its own `CLAUDE_CONFIG_DIR`:
`plugins.list` / `plugins.install` / `plugins.remove` / `marketplace.add`
(through `claude plugin …`), `skills.list` (every `SKILL.md` under the
profile's skills and installed plugins), `mcp.list` (`claude mcp list`, and
the servers in codex's `config.toml`). Every name is shape-checked before it
becomes an argument (`src/names.js`) — a plugin called
`--dangerously-skip-permissions` is refused, and a marketplace must be a
GitHub `owner/repo` or an https URL, never a local path.

A job can name `skills` (named in its prompt) and `plugins` (enabled for that
run only, through a per-run `--settings` file — the profile's own settings are
not changed).

---

## The site, the org, and memory

Every job carries an `orgId` (default `relax`). With `AGENT_MCP_TOKEN` set:

- **The site's MCP server is configured for the job** — `https://www.ravikishan.me/api/mcp`
  with `x-org-id: <org>` — so the agent can use that org's accounts, notes
  and memory. Claude gets it in its per-job `--mcp-config`; Codex through `-c
  mcp_servers.site.*` overrides that name the token's env var rather than the
  token. **Not** for a `yolo` job: an agent with no approval gate must not
  hold a token.
- **Recall before:** agentd calls the site's `recall` tool with the task and
  org and prepends the results to the prompt.
- **Reflect after:** the prompt asks the model to end with a fenced
  ```` ```json {"learnings":[…]} ```` block; agentd parses the last one from
  the transcript and files it through `reflect`, with `source: agent:<jobId>`.

Both fail soft. An unreachable site or a refused token is one line in the
transcript; the job's outcome never depends on memory.

The per-job config (which holds the approval secret and the site token) lives
in `work/<jobId>.agentd/`, **beside** the clone, never inside it — inside, the
final `git add -A` would have committed it — and is deleted when the job ends.

---

## The HTTP API (for the site's MCP tools)

Authenticated like `/whatsapp`: `Authorization: Bearer <Firebase ID token>`,
checked against the allow-list. These are the same operations the socket
uses, not a second implementation.

| route | tool | |
|---|---|---|
| `GET /status` | `get_agent_status` | box health (load, memory, disk), profiles with login presence per tool, limits, counts incl. `stalled` |
| `GET /runs?live=1&limit=50` | `list_agent_runs` | newest first |
| `GET /runs/:id?tail=100` | `get_agent_run` | the run, its pending approvals, the transcript tail (≤500) |
| `POST /runs` | `start_agent_run` | `{task, repo, profile?, tool?, orgId?, policy?, finish?, base?, verify?, skills?, plugins?, disposable?, dryRun?}`; `dryRun` returns the exact argv and per-job config with secrets masked, and creates nothing |
| `POST /runs/:id/stop` | `stop_agent_run` | |
| `POST /approvals/:id` | `answer_agent_approval` | `{allow, reason?, scope?: "once"\|"session"}` — only `allow: true` allows |

A refusal (a limit, a bad name) answers 400 with its sentence; a bug answers 500.

---

## Approvals

This is the part that makes it feel like Claude Code rather than a cron job you
cannot argue with.

Claude Code is started with `--permission-prompts host` and
`--permission-prompt-tool mcp__agentd__approve`, so when it would prompt a human
it calls our bridge instead. The bridge asks `agentd` over loopback, `agentd`
pushes the question to your panel, and the tool call blocks until you answer.

Two rules that do not bend:

- **Deny by default.** Only an explicit `true` allows. A malformed answer, an
  unreachable server, a 500 — all refusals.
- **Deny on timeout.** A sleeping phone must never become a yes. After
  `AGENT_APPROVAL_TIMEOUT_MS` (default 10 minutes) the call is refused and the
  job stops there, which is recoverable. The card shows the countdown.

Policies, per job:

| policy | behaviour |
|---|---|
| `manual` | every tool asks |
| `allowlist` | reads and a short list of read-only shell commands run; writes, pushes and deploys ask |
| `yolo` | nothing asks — **only** for a job marked `disposable` with no credentials mounted, and both conditions are enforced |

Some commands always ask whatever the policy: `sudo`, `rm -rf`, `git push`,
`git reset --hard`, piping curl into a shell, anything touching `.env` or
`~/.ssh`, `npm publish`, and any `deploy`.

---

## Voice

The panel uses the browser's own Web Speech API — no key, no service, no cost,
and nothing leaves the device except the text you would have typed.

It is an **enhancement**: the microphone button only appears where the API
exists (Chrome and Edge; not Firefox), and everything it does can be typed.
Spoken text goes to the agent **verbatim** — `parseCommand` only pulls out which
repository and which account you named, and notices the word "deploy", because
that is a different risk from opening a PR.

---

## Security

This is the most dangerous thing in the project. It clones repositories, runs
commands, holds credentials and can deploy. More than the vault — the vault
leaks, this one acts.

1. **No inbound ports.** `agentd` binds to 127.0.0.1; Cloudflare Tunnel connects
   outward. `npm run doctor` fails if it is bound anywhere else.
2. **Every request carries a Firebase ID token**, verified against Google's
   published certificates and checked against the allow-list — the same
   technique as the site, and deliberately not firebase-admin, which would put a
   service-account key on a box that already runs arbitrary code.
3. A WebSocket **re-checks on every action**. A socket opened an hour ago is not
   proof of anything now.
4. **Per-job approval secrets.** A job can only answer its own approvals, so a
   compromised runner cannot approve another job's push.
5. **Output is redacted** before it leaves the server — env assignments, bearer
   tokens, provider keys, private key blocks. A mitigation, not a guarantee: it
   catches the realistic accident (`cat .env`, a stack trace), not a determined
   exfiltration.
6. **A kill switch.** `Stop everything` in the panel halts the registry; nothing
   new starts until you resume.
7. systemd runs it with `ProtectSystem=strict`, `ProtectHome=read-only`,
   `NoNewPrivileges` and one writable path.

---

## Desktop, terminal, previews, review

Spec: `docs/superpowers/specs/2026-10-10-workbench-design.md` §2–§5. Code: `src/{desktop,terminal,preview,oplog,workbench,mcp-desktop}.js`.

- **Desktop.** `setup.sh` installs Xvfb `:1` (1600x900) + XFCE (`dbus-launch --exit-with-session xfce4-session`; openbox fallback), x11vnc on **127.0.0.1:5901** (`-localhost -nopw`) and chromium-browser with CDP on **127.0.0.1:9222**, as units `agentd-desktop`, `agentd-vnc`, `agentd-browser` (User=agent). Nothing listens beyond loopback; `npm run doctor` fails if 5901 or 9222 ever does.
- **Viewing it.** The panel sends `desktop.ticket {viewOnly}` on the authenticated socket and gets a one-time ticket good for 60 seconds, then opens `wss://agent…/desktop?ticket=…` with the `binary` subprotocol (noVNC). Bytes are piped to 5901. **View-only is enforced here**: keyboard, pointer and clipboard messages are dropped before x11vnc sees them. An interactive ticket (`viewOnly: false`) needs a sign-in from the last 30 minutes.
- **Agents on it.** Every job and chat gets the `desktop` MCP server (`mcp-desktop.js`; off with `AGENT_DESKTOP=0`) and, with `AGENT_PLAYWRIGHT_MCP=1`, Playwright attached over CDP. Each call goes to `POST /internal/desktop` (loopback, per-run secret) where it is validated, gated by the run's policy (allowlist: screenshot and list_windows pass, every action asks) and logged. A yes at Claude's permission prompt is a one-time pass, so one click is not asked about twice.
- **Terminal.** `term.open {cols, rows, cwd}` → `term.opened {termId}`, then `term.input`, `term.resize`, `term.close`; `term.output` / `term.exit` go **only to the opening socket**. Needs a fresh sign-in. node-pty if it built, otherwise `script -qfc "bash -l" /dev/null` (no resize). Each command line typed lands in the timeline; a closed socket kills its shells.
- **Previews.** `preview.list` (from `ss -tlnpH`, this user's listeners only) and `preview.open {port}` → `{url, path, expiresAt}`. The URL carries a 2-minute single-use token that becomes an HttpOnly cookie scoped to `/preview/<port>/`. Ports 1024–65535, never 7777/5901/9222. Apps that request absolute paths need a base path (`/preview/<port>/`).
- **Review.** `~/.agentd/logs/ops.ndjson` (10 MB, one rotation). `ops.list {since, actor, kind, limit}`; every entry is broadcast as `ops.event`. Approval decisions, job Bash/Write/Edit requests, desktop actions, terminal lines and preview opens all land here, redacted.
- **HTTP API** for the site's MCP: `GET /desktop/screenshot` (image/png), `POST /desktop/action`, `GET /previews`, `GET /ops`. A site-MCP action that has to ask waits at most `AGENT_DESKTOP_API_WAIT_MS` (15 s) and is then refused with its card withdrawn; `AGENT_DESKTOP_API_POLICY=yolo` lets it act unasked.

## Tests

```bash
npm run test:agent     # 263 assertions, no server, no network, no process spawned
npm run doctor         # is this box actually able to run a job?
npm run e2e:agent      # the approval card's safety properties, in a browser
```

`test:agent` covers the parts that must be right: which commands run unattended,
the three limits, deny-by-default and deny-on-timeout, that an allowed `git push`
does not also allow `git push --force`, that profiles never share a config
directory, that secrets are masked, and that a stream split across chunks is
reassembled — plus the stall rule (waiting is never stalled), token storage
(last four only, codex key on stdin not argv), the relayed sign-in's timeout
and kill, flag-shaped plugin names refused before anything spawns, the
recall/reflect calls against a stubbed fetch, that the per-job config sits
outside the clone, the HTTP route table, and the OCI script's pure parts
(capacity detection, back-off, no `/0` SSH, image choice, base64 user-data).

---

## What has not been proven

`agentd` has not run against a live Claude subscription on a real server. Every
rule above is unit-tested and the panel is asserted in a browser, but the
end-to-end path — real OAuth, a real clone, a real approval from a phone — needs
a box. That is phase 0, and it is an evening.

Also unproven against the real CLIs, and worth checking first on the box:
whether `claude auth login` prints its URL and reads the pasted code with
stdin as a pipe rather than a TTY (if it insists on a TTY, the relayed sign-in
needs a pty wrapper — the token path does not); the exact `claude plugin`
subcommand spellings for the installed version; and `provision-oci.mjs`
against a real tenancy (its dry run and pure parts are tested, the OCI calls
are not).
