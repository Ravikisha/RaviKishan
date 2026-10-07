// PURE. The catalogue of every environment variable this deployment knows
// about, and where each one lives.
//
// THE MODEL (chosen by the owner, Oct 2026): the deployment holds ONE variable,
// ENV_KEY. Every other variable lives in the database, in one blob sealed under
// ENV_KEY (see envStore.js), and is changed from the admin's Environment tab or
// over MCP — live on the next request, no Vercel, no redeploy.
//
// THREE CLASSES
//
//   bootstrap  ENV_KEY alone. It opens the store, so it cannot be inside it.
//
//   stored     Everything else, including any key added later. Some carry
//              `keyring: true` — the keys that seal other data (SECRETS_KEY,
//              MCP_TOKEN_SECRET, INTEGRATION_SECRET) and the vault's B2
//              credentials and location. Those are changed in the admin only,
//              after a recent sign-in: an MCP token that could set
//              MCP_TOKEN_SECRET could mint itself any scope, and one that could
//              move B2_ENDPOINT could send the vault to another server.
//
//   runtime    Non-secret settings in plain Firestore (config/runtime).
//
// No class is readable back through the app. Presence and a masked hint only.

export class EnvError extends Error {
  constructor(message, { status = 400, code } = {}) {
    super(message);
    this.name = "EnvError";
    this.status = status;
    this.code = code;
  }
}

export const CLASSES = ["bootstrap", "stored", "runtime"];

// Order matters only for display; grouping is by class.
export const REGISTRY = [
  {
    key: "ENV_KEY",
    cls: "bootstrap",
    required: true,
    what: "Opens the database that holds every other variable.",
    why: "It is the key to the store, so it cannot be kept inside it. Set once in Vercel and .env.local; changing it orphans every stored value.",
  },

  /* ---- keyring: stored, but admin-only and confirmed ---- */
  {
    key: "SECRETS_KEY",
    cls: "stored",
    keyring: true,
    what: "Seals every stored password and API key.",
    why: "It seals the password store. Changing it makes every stored secret unreadable.",
  },
  {
    key: "MCP_TOKEN_SECRET",
    cls: "stored",
    keyring: true,
    required: true,
    what: "Seals every MCP access token.",
    why: "It seals every MCP token. Changing it signs every MCP client out; a token able to set it could mint itself any scope.",
  },
  {
    key: "INTEGRATION_SECRET",
    cls: "stored",
    keyring: true,
    what: "Seals every connected-account refresh token.",
    why: "It seals every connected-account login. Changing it disconnects every account.",
  },
  {
    key: "B2_KEY_ID",
    cls: "stored",
    keyring: true,
    required: true,
    what: "Backblaze application key id for the private bucket.",
    why: "With B2_APP_KEY it is full access to the vault bucket.",
  },
  {
    key: "B2_APP_KEY",
    cls: "stored",
    keyring: true,
    required: true,
    what: "Backblaze application key.",
    why: "Full read/write/delete over the vault bucket.",
  },
  {
    key: "B2_BUCKET",
    cls: "stored",
    keyring: true,
    what: "Backblaze bucket name for the private vault.",
    why: "It decides where the vault's files go.",
  },
  {
    key: "B2_BUCKET_ID",
    cls: "stored",
    keyring: true,
    what: "Backblaze bucket id.",
    why: "It decides where the vault's files go.",
  },
  {
    key: "B2_ENDPOINT",
    cls: "stored",
    keyring: true,
    what: "Backblaze S3 endpoint.",
    why: "It decides where the vault's files go.",
  },
  {
    key: "B2_REGION",
    cls: "stored",
    keyring: true,
    what: "Backblaze region.",
    why: "It decides where the vault's files go.",
  },

  /* ---- stored ---- */
  { key: "GOOGLE_TASKS_CLIENT_ID", cls: "stored", what: "Google Tasks OAuth client id." },
  { key: "GOOGLE_TASKS_CLIENT_SECRET", cls: "stored", secret: true, what: "Google Tasks OAuth client secret." },
  { key: "MS_TASKS_CLIENT_ID", cls: "stored", what: "Microsoft To Do OAuth client id." },
  { key: "MS_TASKS_CLIENT_SECRET", cls: "stored", secret: true, what: "Microsoft To Do OAuth client secret." },
  { key: "MS_TASKS_TENANT", cls: "stored", what: "Microsoft tenant; `common` accepts personal accounts." },
  { key: "GITHUB_CLIENT_ID", cls: "stored", what: "GitHub OAuth app client id." },
  { key: "GITHUB_CLIENT_SECRET", cls: "stored", secret: true, what: "GitHub OAuth app client secret." },
  { key: "LINKEDIN_CLIENT_ID", cls: "stored", what: "LinkedIn app client id." },
  { key: "LINKEDIN_CLIENT_SECRET", cls: "stored", secret: true, what: "LinkedIn app client secret." },
  { key: "YOUTUBE_CLIENT_ID", cls: "stored", what: "YouTube OAuth client id." },
  { key: "YOUTUBE_CLIENT_SECRET", cls: "stored", secret: true, what: "YouTube OAuth client secret." },
  { key: "INSTAGRAM_CLIENT_ID", cls: "stored", what: "Instagram app client id." },
  { key: "INSTAGRAM_CLIENT_SECRET", cls: "stored", secret: true, what: "Instagram app client secret." },
  { key: "X_CLIENT_ID", cls: "stored", what: "X OAuth 2.0 client id." },
  { key: "X_CLIENT_SECRET", cls: "stored", secret: true, what: "X OAuth 2.0 client secret." },
  { key: "ANALYTICS_CLIENT_ID", cls: "stored", what: "Google Analytics OAuth client id." },
  { key: "ANALYTICS_CLIENT_SECRET", cls: "stored", secret: true, what: "Google Analytics OAuth client secret." },
  { key: "NOTION_CLIENT_ID", cls: "stored", what: "Notion OAuth client id." },
  { key: "NOTION_CLIENT_SECRET", cls: "stored", secret: true, what: "Notion OAuth client secret." },
  { key: "DEVTO_API_KEY", cls: "stored", secret: true, what: "dev.to API key for import and cross-post." },
  { key: "TRELLO_API_KEY", cls: "stored", what: "Trello API key for the Notes tab." },
  { key: "TRELLO_TOKEN", cls: "stored", secret: true, what: "Trello token for the Notes tab." },
  { key: "OBSIDIAN_VAULT_REPO", cls: "stored", what: "GitHub repo holding the Obsidian vault (owner/name)." },
  { key: "OBSIDIAN_VAULT_FOLDER", cls: "stored", what: "Folder inside the vault repo, if not the root." },
  { key: "IG_ACCESS_TOKEN", cls: "stored", secret: true, what: "Instagram token for the public gallery." },
  { key: "IG_USER_ID", cls: "stored", what: "Instagram user id for the public gallery." },
  {
    key: "NEXT_PUBLIC_RECAPTCHA_SITE_KEY",
    cls: "stored",
    what: "App Check site key, handed to the browser at run time. Absent means App Check is off.",
  },
  { key: "NEXT_PUBLIC_SITE_URL", cls: "stored", what: "The canonical site address. Defaults to https://ravikishan.me." },

  /* ---- runtime: plain Firestore, live ---- */
  {
    key: "NEXT_PUBLIC_MEDIUM_USER",
    cls: "runtime",
    what: "Medium handle the aggregator reads.",
    default: "ravikishan63392",
  },
  {
    key: "INTEGRATION_ACCOUNT",
    cls: "runtime",
    what: "The address every consent screen is pinned to.",
    default: "ravikishan63392@gmail.com",
  },
  {
    key: "INTEGRATION_GITHUB_LOGIN",
    cls: "runtime",
    what: "The GitHub handle consent is pinned to.",
    default: "Ravikisha",
  },
];

const BY_KEY = new Map(REGISTRY.map((e) => [e.key, e]));

export const known = (key) => BY_KEY.get(String(key || "").trim()) || null;

// Anything not catalogued is stored: that is what makes "add any variable" work.
export function classify(key) {
  const e = known(key);
  return e ? e.cls : "stored";
}

export const isBootstrap = (key) => classify(key) === "bootstrap";
export const isKeyring = (key) => !!known(key)?.keyring;
// Kept for callers written against the old name.
export const isCritical = isBootstrap;

// Env var names are a narrow alphabet, and anything else is almost certainly a
// mistake or an attempt to inject something into a shell.
export const KEY_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export function assertKey(key) {
  const k = String(key || "").trim();
  if (!KEY_RE.test(k)) {
    throw new EnvError(
      `"${k}" is not a valid environment variable name. Use capitals, digits and underscores, starting with a letter.`
    );
  }
  return k;
}

// THE guard. Every path that could read or write a value goes through this,
// so a new call site cannot forget it.
export function assertManageable(key, { action = "change" } = {}) {
  const k = assertKey(key);
  const entry = known(k);
  if (entry?.cls === "bootstrap") {
    throw new EnvError(
      `${k} cannot be ${action}d from inside the app. ${entry.why}`,
      { status: 403, code: "env/bootstrap" }
    );
  }
  return k;
}

/* ---------------- presence, without revealing anything ---------------- */

// `NEXT_PUBLIC_` variables are compiled into the browser bundle, so treating
// them as secret is theatre — anyone can read them from the page. Everything
// else is masked.
export const isPublic = (key) => String(key || "").startsWith("NEXT_PUBLIC_");

export const maskValue = (key, value) => {
  if (value === undefined || value === null || value === "") return "";
  if (isPublic(key)) return String(value);
  const v = String(value);
  return v.length <= 4 ? "••••" : `••••${v.slice(-4)}`;
};

// What the UI and the tools are allowed to see about a variable. Never the
// value of anything that is not public.
export function statusOf(key, value, extra = {}) {
  const k = String(key);
  const entry = known(k);
  const present = value !== undefined && value !== null && value !== "";
  return {
    key: k,
    cls: entry?.cls || classify(k),
    known: !!entry,
    required: !!entry?.required,
    what: entry?.what || "",
    why: entry?.why || "",
    present,
    // A missing REQUIRED variable is the single most useful thing this
    // catalogue can tell anyone.
    missing: !!entry?.required && !present,
    public: isPublic(k),
    hint: present ? maskValue(k, value) : "",
    manageable: (entry?.cls || classify(k)) !== "bootstrap",
    keyring: !!entry?.keyring,
    ...extra,
  };
}

// The whole picture, from the live process environment. Used by the UI's
// checklist and by get_env_status.
export function auditEnv(env = process.env) {
  const rows = REGISTRY.map((e) => statusOf(e.key, env[e.key]));
  return {
    rows,
    missingRequired: rows.filter((r) => r.missing).map((r) => r.key),
    counts: CLASSES.reduce((acc, c) => {
      acc[c] = rows.filter((r) => r.cls === c).length;
      return acc;
    }, {}),
  };
}
