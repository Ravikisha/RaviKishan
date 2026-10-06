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

On a fresh Ubuntu box — Oracle Always Free ARM works, so does anything else:

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

**2. Sign an account in**

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

## Tests

```bash
npm run test:agent     # 107 assertions, no server, no network, no process spawned
npm run doctor         # is this box actually able to run a job?
npm run e2e:agent      # the approval card's safety properties, in a browser
```

`test:agent` covers the parts that must be right: which commands run unattended,
the three limits, deny-by-default and deny-on-timeout, that an allowed `git push`
does not also allow `git push --force`, that profiles never share a config
directory, that secrets are masked, and that a stream split across chunks is
reassembled.

---

## What has not been proven

`agentd` has not run against a live Claude subscription on a real server. Every
rule above is unit-tested and the panel is asserted in a browser, but the
end-to-end path — real OAuth, a real clone, a real approval from a phone — needs
a box. That is phase 0, and it is an evening.
