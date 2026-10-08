# Connecting Google Tasks and Microsoft To Do

Everything in the code is done. What is left is three things only you can do,
because they involve consoles signed in as **ravikishan63392@gmail.com**.

Set the same variables in `.env.local` (local) and in Vercel → Settings →
Environment Variables (production). None of them are needed for the rest of the
site to run: with no keys the Tasks tab shows a Connect button that explains
exactly what is missing, and nothing else changes.

---

## 1. The sealing key (required, 30 seconds)

One value, used to encrypt the stored refresh tokens. Generate it with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

```
INTEGRATION_SECRET=<that value>
```

Keep it separate from `MCP_TOKEN_SECRET` on purpose — rotating the MCP secret
should not silently drop every connected account. Rotating **this** one
disconnects both accounts, which is the emergency lever.

---

## 2. Google Tasks

**Google Cloud Console** → the project this site already uses
(`myportifilio-3ab5f`).

1. **APIs & Services → Library → Google Tasks API → Enable.**
   Without this every call answers 404, and the panel says so.
2. **APIs & Services → OAuth consent screen**
   - User type: External, Publishing status can stay *Testing*.
   - Add `ravikishan63392@gmail.com` under **Test users** — a Testing app only
     works for listed users, and a refresh token issued to a Testing app
     expires after 7 days. **Publish the app** to get a durable one.
   - Scope: `https://www.googleapis.com/auth/tasks`
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Type: **Web application**
   - Authorised redirect URIs — add **both**, exactly:
     ```
     https://ravikishan.me/api/integrations/google/callback
     http://localhost:3000/api/integrations/google/callback
     ```
     The redirect URI is part of the code exchange and must match character for
     character; if it does not, the callback says which two values disagreed.

```
GOOGLE_TASKS_CLIENT_ID=<client id>
GOOGLE_TASKS_CLIENT_SECRET=<client secret>
```

> If you ever reconnect and get "returned no refresh token", remove the app at
> <https://myaccount.google.com/permissions> and connect again. Google issues a
> refresh token on first consent; the code already forces `prompt=consent` to
> ask for a new one every time, which is the usual cause of a connection that
> quietly lasts an hour.

---

## 3. Microsoft To Do

**Azure Portal → Microsoft Entra ID → App registrations → New registration.**

1. Name it anything (`ravikishan.me tasks`).
2. Supported account types: **Accounts in any organizational directory and
   personal Microsoft accounts** — a personal Outlook/Hotmail account needs
   this one.
3. Redirect URI: platform **Web**, add both:
   ```
   https://ravikishan.me/api/integrations/microsoft/callback
   http://localhost:3000/api/integrations/microsoft/callback
   ```
4. **API permissions → Add → Microsoft Graph → Delegated** →
   `Tasks.ReadWrite`, `User.Read`, `offline_access`. Then **Grant admin
   consent** if the button is offered.
5. **Certificates & secrets → New client secret** → copy the **Value** (not the
   Secret ID; the Value is shown once).

```
MS_TASKS_CLIENT_ID=<Application (client) ID>
MS_TASKS_CLIENT_SECRET=<the secret VALUE>
MS_TASKS_TENANT=common
```

`common` accepts both a personal Microsoft account and a work/school one. Pin a
tenant id here only if you want to restrict it.

---

## 4. GitHub

**github.com → Settings → Developer settings → OAuth Apps → New OAuth App.**
(A classic *OAuth App*, not a GitHub App — a GitHub App issues installation
tokens scoped to repositories you pick, which is the wrong shape for "edit my
own profile and all my repos".)

1. Application name: anything (`ravikishan.me admin`).
2. Homepage URL: `https://ravikishan.me`
3. Authorization callback URL — an OAuth App allows **one**, so register the
   production one and add a second app for local work if you want it:
   ```
   https://ravikishan.me/api/integrations/github/callback
   ```
   For localhost, either make a second OAuth App with
   `http://localhost:3000/api/integrations/github/callback`, or temporarily
   point this one there.
4. **Generate a new client secret** and copy it — it is shown once.

```
GITHUB_CLIENT_ID=<client id>
GITHUB_CLIENT_SECRET=<client secret>
```

Scopes are requested by the code, not configured here: `public_repo` and
`user`. `public_repo` covers descriptions, topics, homepages and file contents
on public repositories; `user` is what allows the profile bio and links to be
edited. Widen to `repo` in `lib/server/integrations.js` only if private
repositories need managing from here.

**`delete_repo` is never requested**, so nothing in this app — panel or MCP —
can delete or transfer a repository, whatever it is asked to do.

> GitHub's OAuth token does **not** expire. There is no refresh token and
> nothing to renew; revoking it at
> <https://github.com/settings/applications> is what ends the connection, and
> so is pressing Disconnect in the admin.

---

## 5. Connect, once

Open **/admin → Tasks**. Each shelf shows a Connect button; it sends you to the
provider's consent screen already pointed at `ravikishan63392@gmail.com`, and
brings you back connected.

That is the only time you do this. The connection is held as a refresh token,
sealed with `INTEGRATION_SECRET`, so:

- the panel no longer asks you to reconnect every hour, and
- **the MCP tools work with no browser open at all** — which is the thing that
  was not previously possible.

To check it from an AI client, call `list_task_providers`. It reports each
account as connected, unconnected, unconfigured, or rejected, with the fix.

---

## What is stored, and where

| | holds | can it read the token? |
|---|---|---|
| Firestore `integrations/googleTasks`, `integrations/microsoftTasks`, `integrations/github` | the **sealed** token, admin-only | no — it is ciphertext |
| The deployment environment | `INTEGRATION_SECRET` | no — it has no token attached |
| Your browser | nothing durable | no |

Both halves are needed to use an account, and they never sit in the same place.

**Disconnect** deletes the document. Rotating `INTEGRATION_SECRET` invalidates
both accounts at once.

---

## Verifying

```bash
npm run test:integrations   # sealing, consent URLs, provider shapes — no network
npm run test:github         # 22 assertions over the GitHub guards and the audit
npm run e2e:tasks           # the board, plus every endpoint refusing anonymous callers
npm run mcp:check           # the tool registry, including the absences
```

---

## 5. LinkedIn

**Read this first: LinkedIn allows much less than the other three.** Verified
against LinkedIn's own documentation, not assumed:

| | |
|---|---|
| Publish a post | **yes** — `w_member_social`, self-serve, 150 requests/day |
| Edit a post | **yes, the text only** — Posts API `PARTIAL_UPDATE`; visibility, link and media are fixed once published |
| Comment, reply, edit/delete own comment | **yes** — `w_member_social` (see note below) |
| React (like, celebrate, support, love, insightful, funny) | **yes** — `w_member_social` (see note below) |
| Read comments / reactions | **no** — `r_member_social`, partner-only |
| Read name + email | **yes** — OIDC `/v2/userinfo` |
| Read headline / positions / skills | **no** — `r_fullprofile` is partner-only |
| Change the profile | **no API at any tier** |
| Search jobs | **no** self-serve API — Talent Solutions, partnerships closed |
| Apply to a job | **no API at any tier** |
| List your own posts | **no** — `r_member_social` is restricted |

So posting, editing, commenting and reacting are real; for the rest the panel
gives the route that works rather than a button that fails.

> **Comments and reactions — one documented conflict.** LinkedIn's permissions
> page says `w_member_social` is *"Post, comment and like posts on behalf of an
> authenticated member"*, but its Comments and Reactions pages name
> `w_member_social_feed` (the **Community Management API** product, which
> LinkedIn reviews). The tools use `w_member_social`. If a comment or reaction
> answers 403 while posting works, add *Community Management API* on the
> Products tab and reconnect; the error message says exactly this.

**LinkedIn Developer portal** → <https://www.linkedin.com/developers/apps>

1. **Create an app.** It must be attached to a LinkedIn **Page** you control —
   LinkedIn requires one even for a personal integration. Verify the app from
   the Settings tab.
2. **Products tab — add both**, each self-serve and usually instant:
   - *Sign In with LinkedIn using OpenID Connect* → `openid`, `profile`, `email`
   - *Share on LinkedIn* → `w_member_social`
3. **Auth tab → Authorized redirect URLs**, add each exactly. LinkedIn
   matches character for character, and the site answers on **www** (the apex
   308-redirects there), so the www URL is the one production actually sends —
   registering only the apex fails on the first click:
   ```
   https://www.ravikishan.me/api/integrations/linkedin/callback
   https://ravikishan.me/api/integrations/linkedin/callback
   http://localhost:3000/api/integrations/linkedin/callback
   ```
   Running dev on another port (e.g. 3001)? Add that one too. The LinkedIn tab
   lists every URL with a Copy button, including the one it is running on.
4. Copy the Client ID and Client Secret.

```
LINKEDIN_CLIENT_ID=<client id>
LINKEDIN_CLIENT_SECRET=<client secret>
```

> **The 60-day problem.** LinkedIn issues refresh tokens only to approved
> Marketing Developer Platform partners. A self-serve app gets a 60-day access
> token and nothing else, so this connection cannot renew itself — the LinkedIn
> shelf counts down and tells you when to press Connect again. That is the
> product, not a defect in this code. The code already handles the partner case:
> if LinkedIn ever returns a refresh token, it is sealed and used instead and
> the countdown disappears.

---

## 6. YouTube, Instagram and X — several accounts each

These three are **multi-account**: connect as many channels, Instagram accounts
and handles as you like. Each lands as its own document in `socialAccounts`,
keyed on the provider's own id for it, so reconnecting the same account updates
that row rather than adding a rival one beside it.

### What each one actually allows

| | YouTube | Instagram | X |
|---|---|---|---|
| create | upload **not offered here** (see below) | image / video / reel / story, 100 per 24h | post, thread |
| **edit** | **yes** — title, description, tags, category, privacy | **no caption edit, ever** | **no edit endpoint, any tier** |
| read | channel, videos, playlists, comments | media, comments, insights | own posts (**paid tier only**) |
| delete | video | in the app | post |
| cost | free, 10,000 quota units/day | free | **paid** — X ended its free tier on 6 Feb 2026 |

### YouTube

**Google Cloud Console**, same project as Tasks:

1. **APIs & Services → Library → YouTube Data API v3 → Enable.**
2. OAuth consent screen: add the scopes
   `youtube.force-ssl` and `youtube.readonly`.
3. Credentials → OAuth client ID → Web application → redirect URIs:
   ```
   https://ravikishan.me/api/integrations/youtube/callback
   http://localhost:3000/api/integrations/youtube/callback
   ```

```
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
```

> **Uploading is deliberately not offered.** It needs a resumable session
> carrying the file itself, which a serverless function cannot hold for a real
> video. Publish in YouTube Studio, then set the metadata from here.

### Instagram

**The account must be Professional (Business or Creator)** — free to switch in
the Instagram app. A personal account cannot be connected at all: the Basic
Display API that served them shut down on 4 December 2024.

**Meta app dashboard** → <https://developers.facebook.com/apps>

1. Create an app, add the **Instagram** product, and use **Instagram Login**
   (not Facebook Login — it needs no linked Page).
2. Permissions: `instagram_business_basic`, `instagram_business_content_publish`.
3. OAuth redirect URIs (Instagram → API setup with Instagram login → step 3 →
   **Business login settings**):
   ```
   https://www.ravikishan.me/api/integrations/instagram/callback
   https://ravikishan.me/api/integrations/instagram/callback
   https://localhost:3443/api/integrations/instagram/callback
   ```

**Meta will not save an `http://` redirect URI at all — not even for
localhost.** It answers "Error saving OAuth redirect URIs" and refuses the
whole form; remove the `http://` line and the same save succeeds. `https://localhost`
*is* accepted, which is the whole reason `npm run dev:https` exists: it is a
TLS front door on **:3443** that forwards to `next dev` on :3000 and sets
`x-forwarded-proto: https`, so `redirectUriFor()` builds an https:// callback
rather than reading the plain socket underneath it. Two terminals:

```
npm run dev          # the usual dev server, :3000
npm run dev:https    # the TLS proxy,      :3443
```

then connect at <https://localhost:3443/admin?tab=accounts> — a self-signed
certificate, so the browser warns once. It is a different ORIGIN from :3000, so
the Firebase session does not carry over and you sign in again there.

4. **Assign the Instagram Tester role, or consent fails.** While the app is in
   Development mode only an account holding a role may authorize it, and the
   refusal is `Insufficient Developer Role: Insufficient developer role` on
   instagram.com — which says nothing about roles being the fix. It is two
   steps, on two sites:
   - Meta app → **App roles → Roles → Add People → Instagram Tester**, and type
     the handle (the list is fuzzy; pick the exact match). The row goes
     **Pending**.
   - Then on instagram.com as that account: **Settings → Apps and websites →
     Tester Invites → Accept**. Only then does the consent screen appear.

```
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
```

> Instagram **fetches** the file from a public URL rather than accepting an
> upload, so media must already be reachable — a signed or expiring URL fails.
> The long-lived token lasts 60 days; the panel counts down.

### X

**X has no free tier for new developers since 6 February 2026** — access is
pay-per-usage credits, so reads in particular may refuse on billing rather than
on anything wrong here. The error says which.

**X developer portal** → <https://developer.x.com>

1. Create a project and app, then **User authentication settings**:
   - Type of App: **Web App** (confidential client)
   - Permissions: **Read and write**
   - Callback URI:
     ```
     https://ravikishan.me/api/integrations/x/callback
     http://localhost:3000/api/integrations/x/callback
     ```
2. Copy the **OAuth 2.0** Client ID and Client Secret (not the API key/secret).

```
X_CLIENT_ID=
X_CLIENT_SECRET=
```

> X requires **PKCE**. The verifier is generated per connection and sealed
> inside the OAuth state, so nothing is stored server-side between the two
> requests.

---

## 7. Google Analytics

**GA4 only.** Universal Analytics stopped collecting in July 2023 and its data
was deleted in July 2024, so a `UA-` id has nothing behind it — the tools refuse
one by name rather than returning an empty report.

Held **read-only**: the scope requested is `analytics.readonly`, so nothing
here can edit a property, change a data stream or delete an account. A
reporting section does not need write access.

Multi-account, like the social three — connect more than one Google account if
your properties live under different ones. The **property** is chosen inside an
account, because one account commonly owns several.

**Google Cloud Console**, same project as Tasks and YouTube:

1. **APIs & Services → Library → enable both:**
   - **Google Analytics Data API** (the reports)
   - **Google Analytics Admin API** (listing your properties)
   Missing either produces a 403 that names the API, and the error says so.
2. OAuth consent screen: add the scope
   `https://www.googleapis.com/auth/analytics.readonly`
3. Credentials → OAuth client ID → Web application → **Authorised redirect
   URIs**. Add all three — Google compares them character for character, and
   ravikishan.me answers on www (the apex 308s there):
   ```
   https://www.ravikishan.me/api/integrations/analytics/callback
   https://ravikishan.me/api/integrations/analytics/callback
   http://localhost:3000/api/integrations/analytics/callback
   ```
   The unconnected panel lists exactly these with Copy buttons, so there is
   nothing to retype.

```
ANALYTICS_CLIENT_ID=
ANALYTICS_CLIENT_SECRET=
```

**Both of those are optional.** With neither set, Analytics borrows the Google
client already configured for Tasks (`GOOGLE_TASKS_CLIENT_ID` /
`GOOGLE_TASKS_CLIENT_SECRET`) — one OAuth client serves several Google APIs, so
a second one would be a copy of the first. The panel says which client it is
using. Set these only to put Analytics on a client of its own.

> **Borrowing the client does not borrow its redirect URI.** The shared client
> starts out carrying only the Tasks callback, so the connection reads as fully
> configured and the consent URL reaches Google's sign-in screen — then fails
> with `Error 400: redirect_uri_mismatch` *after* you sign in, because Google
> validates the redirect late. Step 3 is not optional, whichever client is used.

Then open **/admin → Analytics**. Google Analytics sits below the first-party
counters in the same tab — the counters are about the work (résumé opened, PDF
taken, short link followed), GA answers the audience question they deliberately
do not.

> **Thresholding.** GA4 withholds rows that could identify an individual, so a
> low-traffic property can report zero rows while having real traffic. The panel
> and the tools both flag that case rather than showing it as "no traffic".

---

## 8. The secret store (passwords and API keys)

One environment variable:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

```
SECRETS_KEY=<that value>
```

Separate from `INTEGRATION_SECRET` and `MCP_TOKEN_SECRET` on purpose — rotating
one of those must not destroy the password store, and rotating this one must
not sign every account out.

> **Rotating `SECRETS_KEY` makes every stored value permanently unreadable.**
> There is no recovery path and no second copy. It is the emergency lever, not
> routine maintenance.

### What this store is, and what it is not

**It is not end-to-end encrypted, and it cannot be.** The document vault
(`vault/`) encrypts in the browser under a passphrase that never leaves your
machine — which is exactly why it has no write tool and no MCP read of its
bytes. This store exists so an **agent can read a value**, and that means the
deployment must be able to decrypt it. Those two properties are mutually
exclusive. Use the document vault for things no software should ever read;
use this for credentials you want to hand to an agent.

The blast radius is contained four ways instead:

| | |
|---|---|
| **Sealed at rest** | AES-256-GCM under `SECRETS_KEY`, which is never in the database. A Firestore leak yields ciphertext |
| **Its own MCP scope** | `secrets`, implied by nothing. Every token minted before it existed cannot touch the store |
| **Per-secret opt-in** | `agentReadable` is **off by default** — saving a password exposes it to nothing until you turn it on |
| **One at a time, audited** | Listing never returns values; each reveal writes to the append-only audit log with which token read what |

What cannot be engineered away: **an MCP token with the `secrets` scope is
equivalent to the secrets it can read.** Treat minting one as handing over
those passwords, and revoke it when a client is retired.

### Using it

**Admin → Secrets.** Copy puts a value on the clipboard rather than on the
screen; revealing on screen costs a sign-in from the last 30 minutes. The row's
left edge is amber when an agent may read it.

**From an agent:** mint a token in the MCP tab with the **Secrets** scope
ticked (it is never pre-ticked), then `list_secrets` to find a name and
`get_secret` to read one value. A secret not marked readable is refused with
instructions rather than returned.

---

## 9. Managing the variables themselves (Environment tab)

Optional. Without it the tab still works as a **checklist** — what is set, what
is missing, what each variable is for — it just cannot write to Vercel.

```
VERCEL_TOKEN=<a Vercel API token>
VERCEL_PROJECT_ID=<the project id, from Project Settings → General>
VERCEL_TEAM_ID=<only if the project belongs to a team>
```

### Three things to know before using it

1. **A change to a deployment variable takes effect on the NEXT DEPLOYMENT.**
   Vercel bakes the environment at build time. Nothing here redeploys — push a
   commit, or press Redeploy in the dashboard, once the variables are right.
2. **Five keys can never be changed from inside the app**, and the tab shows
   them as *Locked* with the reason: `SECRETS_KEY`, `MCP_TOKEN_SECRET`,
   `INTEGRATION_SECRET`, the `B2_*` pair, and `VERCEL_TOKEN` itself. They
   decrypt everything else or could mint credentials — a store that handed
   them out would make every other guard decorative. Set them in the Vercel
   dashboard or `.env.local`.
3. **No value is ever readable** — not in the UI, not over MCP. Secrets are
   written to Vercel as `sensitive`, which means Vercel itself refuses to hand
   them back afterwards. That is the correct behaviour, not a missing feature.

### Live now vs next deployment

A handful of non-secret settings are **runtime** class: stored in Firestore,
read on every request, and effective the moment you save them —
`NEXT_PUBLIC_MEDIUM_USER`, `INTEGRATION_ACCOUNT`, `INTEGRATION_GITHUB_LOGIN`.
Everything else is a deployment variable. The tab groups them exactly that way.
