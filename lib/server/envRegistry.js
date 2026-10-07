// PURE. The catalogue of every environment variable this deployment knows
// about, and — more importantly — which ones may be touched from inside the
// running app at all.
//
// THREE CLASSES, AND THE REASON THEY DIFFER
//
//   critical   Keys that decrypt everything else, or that would let the holder
//              mint credentials. These CANNOT live in the app's own database:
//              SECRETS_KEY sealed under SECRETS_KEY is circular, and a store
//              that hands out MCP_TOKEN_SECRET is a token-minting ladder —
//              the same privilege escalation this codebase already refuses to
//              build a tool for. Presence is reported; the VALUE is never
//              readable or writable through the app, by the UI or by MCP.
//
//   deploy     Ordinary deployment secrets — OAuth client ids and secrets,
//              API keys. They belong in the platform's environment, so they
//              are managed through the Vercel API when a token is configured.
//              Changing one does NOT affect the running process: Vercel bakes
//              the environment at build time, so it takes effect on the next
//              deployment. Every write says so rather than letting someone
//              wonder why nothing changed.
//
//   runtime    Non-secret settings the app reads at REQUEST time from
//              Firestore instead of from process.env. These are the only ones
//              that can change live, and that is the whole reason the class
//              exists — a feature flag you must redeploy to flip is not a
//              feature flag.
//
// A variable not in this catalogue is treated as `deploy` and unknown, which
// is safe: it can be written to Vercel but never read back through the app.

export class EnvError extends Error {
  constructor(message, { status = 400, code } = {}) {
    super(message);
    this.name = "EnvError";
    this.status = status;
    this.code = code;
  }
}

export const CLASSES = ["critical", "deploy", "runtime"];

// Order matters only for display; grouping is by class.
export const REGISTRY = [
  /* ---- critical: never readable or writable from inside the app ---- */
  {
    key: "SECRETS_KEY",
    cls: "critical",
    required: false,
    what: "Seals every stored password and API key.",
    why: "It decrypts the secret store, so storing it in that store is circular. Rotating it makes every stored value permanently unreadable.",
  },
  {
    key: "MCP_TOKEN_SECRET",
    cls: "critical",
    required: true,
    what: "Seals every MCP access token.",
    why: "Anything holding this can mint a token for any scope. Exposing it through a tool would be a privilege-escalation ladder, which is exactly why no token-minting tool exists.",
  },
  {
    key: "INTEGRATION_SECRET",
    cls: "critical",
    required: false,
    what: "Seals every connected-account refresh token.",
    why: "It decrypts the connected accounts; a store that could hand it out would make the sealing pointless.",
  },
  {
    key: "B2_KEY_ID",
    cls: "critical",
    required: true,
    what: "Backblaze application key id for the private bucket.",
    why: "Together with the secret it is full read/write/delete over the vault bucket.",
  },
  {
    key: "B2_APP_KEY",
    cls: "critical",
    required: true,
    what: "Backblaze application key.",
    why: "Full read/write/delete over the vault bucket.",
  },

  /* ---- deploy: platform environment, effective on next deployment ---- */
  { key: "GOOGLE_TASKS_CLIENT_ID", cls: "deploy", what: "Google Tasks OAuth client id." },
  { key: "GOOGLE_TASKS_CLIENT_SECRET", cls: "deploy", secret: true, what: "Google Tasks OAuth client secret." },
  { key: "MS_TASKS_CLIENT_ID", cls: "deploy", what: "Microsoft To Do OAuth client id." },
  { key: "MS_TASKS_CLIENT_SECRET", cls: "deploy", secret: true, what: "Microsoft To Do OAuth client secret." },
  { key: "MS_TASKS_TENANT", cls: "deploy", what: "Microsoft tenant; `common` accepts personal accounts." },
  { key: "GITHUB_CLIENT_ID", cls: "deploy", what: "GitHub OAuth app client id." },
  { key: "GITHUB_CLIENT_SECRET", cls: "deploy", secret: true, what: "GitHub OAuth app client secret." },
  { key: "LINKEDIN_CLIENT_ID", cls: "deploy", what: "LinkedIn app client id." },
  { key: "LINKEDIN_CLIENT_SECRET", cls: "deploy", secret: true, what: "LinkedIn app client secret." },
  { key: "YOUTUBE_CLIENT_ID", cls: "deploy", what: "YouTube OAuth client id." },
  { key: "YOUTUBE_CLIENT_SECRET", cls: "deploy", secret: true, what: "YouTube OAuth client secret." },
  { key: "INSTAGRAM_CLIENT_ID", cls: "deploy", what: "Instagram app client id." },
  { key: "INSTAGRAM_CLIENT_SECRET", cls: "deploy", secret: true, what: "Instagram app client secret." },
  { key: "X_CLIENT_ID", cls: "deploy", what: "X OAuth 2.0 client id." },
  { key: "X_CLIENT_SECRET", cls: "deploy", secret: true, what: "X OAuth 2.0 client secret." },
  { key: "ANALYTICS_CLIENT_ID", cls: "deploy", what: "Google Analytics OAuth client id." },
  { key: "ANALYTICS_CLIENT_SECRET", cls: "deploy", secret: true, what: "Google Analytics OAuth client secret." },
  { key: "NOTION_CLIENT_ID", cls: "deploy", what: "Notion OAuth client id." },
  { key: "NOTION_CLIENT_SECRET", cls: "deploy", secret: true, what: "Notion OAuth client secret." },
  { key: "DEVTO_API_KEY", cls: "deploy", secret: true, what: "dev.to API key for import and cross-post." },
  {
    key: "VERCEL_TOKEN",
    cls: "critical",
    what: "Vercel API token used to manage the other deployment variables.",
    why: "It can rewrite every environment variable on the project, including the critical ones. A store that could read it out would make every other guard here decorative.",
  },
  { key: "VERCEL_PROJECT_ID", cls: "deploy", what: "Which Vercel project to manage." },
  { key: "VERCEL_TEAM_ID", cls: "deploy", what: "Vercel team, if the project belongs to one." },
  { key: "NEXT_PUBLIC_RECAPTCHA_SITE_KEY", cls: "deploy", what: "App Check site key. Absent means App Check is off." },

  /* ---- runtime: Firestore, effective immediately ---- */
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

// An unknown variable is treated as `deploy`: writable to the platform, never
// readable back through the app. That is the safe default — the alternative
// would be refusing to manage anything added after this file was written.
export function classify(key) {
  const e = known(key);
  return e ? e.cls : "deploy";
}

export const isCritical = (key) => classify(key) === "critical";

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
  if (entry?.cls === "critical") {
    throw new EnvError(
      `${k} cannot be ${action}d from inside the app. ${entry.why} Set it in the Vercel dashboard or your .env.local directly.`,
      { status: 403, code: "env/critical" }
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
    manageable: (entry?.cls || classify(k)) !== "critical",
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
