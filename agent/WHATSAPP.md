# WhatsApp

Send and read WhatsApp from your own account, through agentd, over MCP or the
admin panel.

---

## Read this first

**This connects as your personal account through an unofficial client.**
WhatsApp's terms do not permit automated use, and accounts are banned for it.
What you lose if that happens is your real conversation history — not an API
key you can reissue.

That is not a reason it cannot be built. It is your account, your messages, and
a personal assistant is not what the rule is aimed at. But it is your risk, and
it should be a decision rather than a surprise.

**The official API cannot do this.** The WhatsApp Business Cloud API works on a
separate business number which *replaces* that number in the normal app, starts
with no history, cannot read your personal chats, requires business
verification, and charges per conversation. For "read my chats and reply as
me", it is not a smaller version of this — it is a different product.

So the honest choice is this, with the risk, or nothing.

### What is deliberately missing

Three capabilities are absent, and `mcp:check` asserts they stay absent:

- **No broadcast or bulk send.** `whatsapp_send` takes one recipient, typed as
  a string rather than a list, and `assertSendable` refuses more than one in
  the pure layer so no caller can assemble bulk out of single sends.
- **No auto-reply.** Nothing sends a message you did not ask for.
- **No contact scraping for outreach.**

These are the behaviours that get accounts banned *and* the ones that reach
people who did not ask to hear from you. Both reasons are sufficient on their
own.

There is also a rate limit: a minimum gap between messages and an hourly cap,
because sending faster than a human types is what automated-behaviour detection
looks for. Tune with `WHATSAPP_MIN_GAP_MS` and `WHATSAPP_MAX_PER_HOUR`.

---

## Why it lives on your server

A WhatsApp session is a socket held open for days plus session keys written to
disk. A serverless function can do neither, so this cannot run on Vercel at any
price. It runs in `agentd` on the box you set up for the agent, and the admin
panel is a remote control for it.

**Baileys, not whatsapp-web.js.** The latter drives a real Chromium — a few
hundred MB resident, and the first thing to fall over when a 4-core ARM box is
under memory pressure. Baileys is a WebSocket and some crypto.

---

## Install

On the server:

```bash
cd /opt/agentd/agent
npm install @whiskeysockets/baileys
sudo systemctl restart agentd
```

It is an **optional** dependency: a deployment that never uses WhatsApp does
not pay for it, and a missing install reports itself rather than taking the
daemon down.

Optional environment, in `/etc/agentd.env`:

```
# Only set this if you want national numbers accepted. Without it a number
# with no country code is REFUSED rather than guessed — and a guessed country
# code is a real person's number somewhere else.
WHATSAPP_DEFAULT_COUNTRY=91

WHATSAPP_MIN_GAP_MS=3000
WHATSAPP_MAX_PER_HOUR=60
```

On Vercel, so the MCP tools know where the server is:

```
AGENT_URL=https://agent.ravikishan.me
```

---

## Connecting

Admin → **Agent** → **WhatsApp** → Connect. A QR code appears; scan it with
WhatsApp → Settings → Linked devices → Link a device.

The pairing code is rendered **locally**, as an inline SVG, not fetched from a
QR image service. While it is on screen it is a live credential, and handing it
to a third party to draw would be handing out the session.

The session is stored under the profile, so several accounts can be linked the
same way the Claude profiles are:

```
~/.agentd/profiles/personal/whatsapp/
~/.agentd/profiles/work/whatsapp/
```

**Log out** unlinks the device on your phone too and deletes the session here.
Disconnect only closes the socket. Use Log out when you mean it — a linked
device you have forgotten about is a credential you have forgotten about.

---

## What it can see

`agentd` holds what arrives **while it is connected**. It does not download
your history, and `whatsapp_read` says so plainly rather than implying a chat
is empty.

Up to 500 messages per chat are kept in memory and nothing is written to a
database. A daemon that stays up for weeks must not grow without limit, and a
full message archive is a different project with different consent questions
attached.

---

## MCP tools

| tool | scope | |
|---|---|---|
| `whatsapp_status` | read | is there a live session, as whom, how many sent this hour |
| `whatsapp_chats` | read | recent chats with names, unread counts, previews |
| `whatsapp_read` | read | one chat's cached messages, oldest first |
| `whatsapp_search` | read | across every cached message |
| `whatsapp_check_number` | read | is this number on WhatsApp at all |
| `whatsapp_send` | write | **one** message to **one** chat |
| `whatsapp_mark_read` | write | shows blue ticks to the other person |

They authenticate to agentd with the admin's own Firebase ID token, minted from
the refresh token the MCP request already carries — so there is **no shared
secret** between Vercel and the box, and agentd applies the same allow-list as
everything else.

### Addressing

A number must be in full international form: `+918765432100`. A number without
a country code is **refused**, not guessed, unless `WHATSAPP_DEFAULT_COUNTRY`
is set deliberately. Sending to the wrong JID is sending a private message to
the wrong person, and it is the one mistake here that cannot be taken back.

`whatsapp_check_number` resolves a number before you send to it.

---

## Tests

```bash
npm run test:whatsapp   # 52 assertions, no phone, no QR, no account at risk
npm run e2e:whatsapp    # 17 — the warning in every state, one compose box
```

`test:whatsapp` pins the addressing rules (device suffixes stripped, groups
distinguished, never guessing a country), the message shapes (group speaker vs
room, disappearing messages unwrapped, unknown kinds surfaced rather than
rendered blank), and every guard — one recipient, human speed, hourly cap,
broadcast lists refused.

`e2e:whatsapp` asserts the warning is present in **all four** states including
the connected one, that there is exactly one compose box and no multi-recipient
picker, and that the QR is drawn locally.

**What has not been tested:** any of it against a live account. Everything
above is verified against the pure layer and rendered markup. The first real
run is scanning a QR on the server, and the first message should go to your own
number.
