// Accounts, and how several of them live on one box.
//
// A "profile" is one signed-in account — one Claude subscription, or one Codex
// login. Each gets its own config directory, so several can be logged in at
// once and a job says which one it runs as.
//
// WHAT A PROFILE IS NOT: a way to pool quota. Profiles exist so that work for
// different identities stays separated — a personal account and a work account
// are different people as far as every service involved is concerned, and
// their credentials, history and rate limits should not be mixed. Rotating
// profiles to get around one account's limits is a different thing with
// different terms attached, and `pickProfile` deliberately has no "least
// recently used" or "next free" mode for that reason: a job NAMES its profile.
//
// The separation is done with the config-directory environment variables the
// tools already respect, not by juggling token files:
//
//   claude   CLAUDE_CONFIG_DIR   holds credentials, history, settings
//   codex    CODEX_HOME          same idea
//
// so `claude auth login` under a given CLAUDE_CONFIG_DIR signs THAT profile in
// and leaves the others untouched.
import path from "path";
import fs from "fs";

export class ProfileError extends Error {}

// Where everything lives on the server. One root, so a backup or a wipe is one
// directory, and nothing is written outside it.
export const AGENT_HOME = process.env.AGENT_HOME || path.join(process.env.HOME || "/home/agent", ".agentd");

export const paths = {
  root: AGENT_HOME,
  profiles: path.join(AGENT_HOME, "profiles"),
  work: path.join(AGENT_HOME, "work"),
  logs: path.join(AGENT_HOME, "logs"),
};

// A profile name becomes a directory name, so it is constrained to something
// that cannot escape the profiles root or confuse a shell.
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function assertProfileName(name) {
  if (!NAME.test(String(name || ""))) {
    throw new ProfileError(
      `"${name}" is not a usable profile name. Use lowercase letters, digits, hyphen or underscore, starting with a letter or digit, 32 characters at most.`
    );
  }
  return String(name);
}

export const profileDir = (name) => path.join(paths.profiles, assertProfileName(name));

// A pasted token lives here, beside the tool's own config dir rather than in
// it: the tool never reads or rewrites this file, so `claude auth logout` or a
// version upgrade cannot leave a half-valid copy behind. Mode 600, owned by
// the agent user, and never anywhere else — not Firestore, not a log.
export const tokenFile = (name, tool) => path.join(profileDir(name), `.${tool}-token`);

export function storedToken(name, tool) {
  try {
    const t = fs.readFileSync(tokenFile(name, tool), "utf8").trim();
    return t || "";
  } catch (_) {
    return "";
  }
}

// The shared desktop's X cookie. Xvfb :1 runs with -auth (agentd-desktop
// writes a fresh MIT-MAGIC-COOKIE there at every start, mode 600, owner agent),
// so a client without this file is refused — which is what keeps the box's
// other local users (the remote-os session users, the supervisor) off the
// agent's screen and its signed-in browser. Everything that sets DISPLAY sets
// this too.
export const DESKTOP_XAUTHORITY = "/run/agentd-desktop/Xauthority";
export const desktopXauthority = () => process.env.AGENT_XAUTHORITY || process.env.XAUTHORITY || DESKTOP_XAUTHORITY;

// Variables that belong to agentd and must not reach a job. The job is code
// written by a model acting on a phone instruction; the site's MCP token is
// handed to it deliberately, through its MCP config, and only when the policy
// has an approval gate — not by inheriting the daemon's whole environment.
const DAEMON_ONLY = /^(AGENT_MCP_TOKEN|AGENT_ADMIN_EMAILS)$/;
const scrubbed = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !DAEMON_ONLY.test(k)));

// The environment a tool runs under for a given profile. This is the whole
// multi-account mechanism — everything else is bookkeeping.
export function profileEnv(name, { tool = "claude" } = {}) {
  const dir = profileDir(name);
  const base = {
    ...scrubbed(),
    HOME: dir,
    // Neither tool should be able to reach the server operator's own dotfiles.
    XDG_CONFIG_HOME: path.join(dir, ".config"),
    XDG_CACHE_HOME: path.join(dir, ".cache"),
    // The shared desktop (agentd-desktop.service). A GUI app a job or chat
    // launches appears where the owner is watching, never on a hidden screen.
    DISPLAY: process.env.AGENT_DISPLAY || ":1",
    XAUTHORITY: desktopXauthority(),
  };

  if (tool === "claude") {
    const env = { ...base, CLAUDE_CONFIG_DIR: path.join(dir, "claude") };
    // A `claude setup-token` token, pasted in the panel. When present it wins
    // over whatever OAuth login sits in the config dir — it is the one the
    // operator chose most recently and on purpose.
    const token = storedToken(name, "claude");
    if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
    else delete env.CLAUDE_CODE_OAUTH_TOKEN;
    return env;
  }
  if (tool === "codex") {
    return { ...base, CODEX_HOME: path.join(dir, "codex") };
  }
  throw new ProfileError(`Unknown tool "${tool}". Known tools: claude, codex.`);
}

// The environment the VERIFY step runs under. It runs package scripts from a
// repo a model has just edited, with no approval gate, so it gets less than the
// agent did: the daemon's variables scrubbed as always, no subscription token,
// no config dir, and a HOME of its own — not the profile directory, where the
// pasted tokens sit one `cat ~/.claude-token` away.
export function verifyEnv(name, { home } = {}) {
  assertProfileName(name);
  const env = scrubbed();
  for (const k of Object.keys(env)) {
    if (/^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|CODEX_HOME|CLAUDE_CONFIG_DIR|GH_TOKEN|GITHUB_TOKEN)$/.test(k)) delete env[k];
  }
  if (home) {
    env.HOME = home;
    env.XDG_CONFIG_HOME = path.join(home, ".config");
    env.XDG_CACHE_HOME = path.join(home, ".cache");
  }
  return env;
}

export function ensureProfile(name) {
  const dir = profileDir(name);
  for (const d of [dir, path.join(dir, "claude"), path.join(dir, "codex"), path.join(dir, ".config"), path.join(dir, ".cache")]) {
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function listProfiles() {
  if (!fs.existsSync(paths.profiles)) return [];
  return fs
    .readdirSync(paths.profiles, { withFileTypes: true })
    .filter((e) => e.isDirectory() && NAME.test(e.name))
    .map((e) => {
      const dir = path.join(paths.profiles, e.name);
      return {
        name: e.name,
        // Presence of a credentials file is the only thing readable without
        // running the tool; `claude auth status` is authoritative and the
        // server asks it on demand rather than guessing from the filesystem.
        claude: !!storedToken(e.name, "claude") || hasCredentials(path.join(dir, "claude")),
        codex: !!storedToken(e.name, "codex") || hasCredentials(path.join(dir, "codex")),
      };
    });
}

export function hasCredentials(dir) {
  if (!fs.existsSync(dir)) return false;
  // Both tools write a credentials or auth json somewhere under their config
  // dir; the name has changed between versions, so this looks for the shape
  // rather than one filename.
  const stack = [dir];
  for (let i = 0; i < 64 && stack.length; i++) {
    const d = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) stack.push(path.join(d, e.name));
      else if (/(credential|auth|token)s?\.json$/i.test(e.name)) return true;
    }
  }
  return false;
}

// A job names its profile. If it does not, the default is used — and the
// default is a SETTING, not "whichever is free", so behaviour never depends on
// what else happens to be running.
export function pickProfile(requested, { profiles, fallback = process.env.AGENT_DEFAULT_PROFILE || "personal" } = {}) {
  const name = assertProfileName(requested || fallback);
  const known = (profiles || listProfiles()).map((p) => p.name);
  if (known.length && !known.includes(name)) {
    throw new ProfileError(
      `No profile "${name}" on this server. Known profiles: ${known.join(", ") || "none"}. Add one in the admin's Agent tab.`
    );
  }
  return name;
}
