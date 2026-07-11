# Hidden Admin CMS — setup & usage

A private, unlinked admin page lets you edit everything the site shows —
identity/hero, stats, build-log, "systems built" (your GitHub repo cards),
experience, education, credentials, skills marquee, and the Projects / Skills /
Certificates pages. Edits save to Firebase Firestore and go **live instantly**
for all visitors — no rebuild, no redeploy.

- **URL:** `https://ravikishan.me/admin` (locally `http://localhost:3000/admin`)
- **Linked from:** nowhere. You reach it only by typing the URL.
- **Login:** Google sign-in **or** email + password (both stored in Firebase,
  never in code).
- **Authorized account:** only emails in `lib/adminAllowlist.js` (currently
  `ravikishan63392@gmail.com`). Any other account — even a valid Google login —
  is signed out instantly and cannot write. To change who's allowed, edit that
  file **and** the matching list in `firestore.rules`.

---

## One-time Firebase setup (you must do this — it can't be done from code)

Firebase project: **myportifilio-3ab5f** (already configured in the app).

### 1. Enable the sign-in methods
Firebase console → **Authentication** → **Sign-in method**:
- **Email/Password** → Enable → Save.
- **Google** → Enable → pick a support email → Save.

### 2. Your admin account
- **Email/password:** Authentication → **Users** → **Add user** → your email +
  strong password.
- **Google:** just sign in with Google on `/admin` — no pre-creation needed.

Only the email(s) in the allow-list get in; there is **no signup flow** in the
app, so no one can create an admin account through the site.

> Note: writes require a **verified email**. Google logins are verified
> automatically. If you use the manual email/password account and saves are
> refused, verify that address (Authentication → Users → ⋮ → or trigger a
> verification email) — or just log in with Google, which is simplest.

### 3. Publish the security rules  ← this is what actually protects it
Firestore Database → **Rules** → replace the contents with the rules from
[`firestore.rules`](../firestore.rules) in this repo → **Publish**.

These rules make `site/content` **readable by everyone but writable only by the
authorized admin email(s)** — so even if someone discovers the `/admin` URL and
signs in with their own Google account, they cannot change anything. They also
keep the existing contact form working. **Until you publish these rules, saving
may fail and/or the content could be world-writable — don't skip this step.**

---

## First run

1. Go to `/admin` and sign in.
2. The editor loads your current site content. If nothing is saved in Firestore
   yet, it shows the values straight from the code files as a starting point and
   says so.
3. Press **Save & publish** once to write that baseline into Firestore. From then
   on the site reads your edited values.

## Everyday use

- Open a section, edit fields, add/remove/reorder list items (projects,
  experience, skills, repos, certificates…), then **Save & publish**.
- Changes are live immediately — refresh any public page to see them.
- **Reset to file defaults** reloads the original code values into the editor
  (nothing is saved until you press Save), useful to undo before saving.
- **Sign out** when done.

## How it works (for future maintenance)

- `lib/facts.js` + `components/data_projects.js` / `data_pl.js` / `data_cert.js`
  remain the **defaults / seed** and the fallback if Firestore is unreachable.
- `lib/siteContent.js` assembles those into one editable object shape.
- `lib/useSiteContent.js` provides that object to every page: it starts from the
  defaults (so server + first render match) then swaps in the Firestore doc.
- Pages/components read content via `useSiteContent()` instead of importing the
  static files directly.
- `pages/admin.js` is the editor; it's rendered bare and `noindex` via
  `pages/_app.js` (the `router.pathname === "/admin"` branch).

To add a new editable section: add it to `defaultContent` in `lib/siteContent.js`
(and `sectionMeta` for a nice label), then read it in the relevant component via
`useSiteContent()`. The admin editor picks it up automatically.
