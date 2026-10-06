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

## 4. Connect, once

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
| Firestore `integrations/googleTasks`, `integrations/microsoftTasks` | the **sealed** refresh token, admin-only | no — it is ciphertext |
| The deployment environment | `INTEGRATION_SECRET` | no — it has no token attached |
| Your browser | nothing durable | no |

Both halves are needed to use an account, and they never sit in the same place.

**Disconnect** deletes the document. Rotating `INTEGRATION_SECRET` invalidates
both accounts at once.

---

## Verifying

```bash
npm run test:integrations   # 48 assertions, no network, no credentials
npm run e2e:tasks           # the board, plus every endpoint refusing anonymous callers
npm run mcp:check           # the tool registry, including the absences
```
