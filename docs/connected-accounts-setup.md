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
| Read name + email | **yes** — OIDC `/v2/userinfo` |
| Read headline / positions / skills | **no** — `r_fullprofile` is partner-only |
| Change the profile | **no API at any tier** |
| Search jobs | **no** self-serve API — Talent Solutions, partnerships closed |
| Apply to a job | **no API at any tier** |
| List your own posts | **no** — `r_member_social` is restricted |

So the panel publishes posts for real, and for the rest it gives the route that
works rather than a button that fails.

**LinkedIn Developer portal** → <https://www.linkedin.com/developers/apps>

1. **Create an app.** It must be attached to a LinkedIn **Page** you control —
   LinkedIn requires one even for a personal integration. Verify the app from
   the Settings tab.
2. **Products tab — add both**, each self-serve and usually instant:
   - *Sign In with LinkedIn using OpenID Connect* → `openid`, `profile`, `email`
   - *Share on LinkedIn* → `w_member_social`
3. **Auth tab → Authorized redirect URLs**, add both exactly:
   ```
   https://ravikishan.me/api/integrations/linkedin/callback
   http://localhost:3000/api/integrations/linkedin/callback
   ```
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
