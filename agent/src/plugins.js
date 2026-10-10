// Claude Code's own features — plugins, marketplaces, skills, MCP servers —
// per profile, from the panel.
//
// Each profile is its own CLAUDE_CONFIG_DIR, so installing a plugin for
// "work" does not install it for "personal". That is the point of profiles,
// and it means every call here names one.
//
// Reads come from the files Claude Code itself keeps where that is reliable
// (installed_plugins.json, known_marketplaces.json, skills/*/SKILL.md), and
// fall back to the CLI's own listing; writes ALWAYS go through the CLI, so a
// version that changes the file layout cannot be corrupted by us writing the
// old one.
import fs from "fs";
import path from "path";
import { assertProfileName, ensureProfile, profileEnv } from "./profiles.js";
import { runCli } from "./login.js";
import { assertPluginName, assertMarketplaceSource } from "./names.js";

export class PluginError extends Error {}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
};

const claudeDir = (profile) => profileEnv(profile, { tool: "claude" }).CLAUDE_CONFIG_DIR;

async function claude(profile, args, { spawn, timeoutMs = 120_000 } = {}) {
  ensureProfile(profile);
  const env = profileEnv(profile, { tool: "claude" });
  const r = await runCli("claude", args, { env, spawn, timeoutMs });
  if (r.code !== 0) {
    throw new PluginError(`claude ${args.slice(0, 3).join(" ")} failed (${r.code}): ${(r.err || r.out).trim().slice(0, 400)}`);
  }
  return r.out;
}

// PURE: the shapes installed_plugins.json has had. v1 was { plugins: { key:
// {...} } }, v2 { plugins: { key: [ {...scope} ] } }; both become one row per
// plugin.
export function shapeInstalled(json) {
  const plugins = json?.plugins || {};
  return Object.entries(plugins).map(([key, v]) => {
    const entry = Array.isArray(v) ? v[0] || {} : v || {};
    const [name, marketplace = ""] = key.split("@");
    return { id: key, name, marketplace, version: entry.version || "", scope: entry.scope || "user", installedAt: entry.installedAt || "" };
  });
}

export async function listPlugins(profile, { spawn } = {}) {
  assertProfileName(profile);
  const dir = claudeDir(profile);
  const installed = readJson(path.join(dir, "plugins", "installed_plugins.json"));
  const markets = readJson(path.join(dir, "plugins", "known_marketplaces.json"));
  const settings = readJson(path.join(dir, "settings.json")) || {};
  const enabled = settings.enabledPlugins || {};

  let plugins = installed ? shapeInstalled(installed) : null;
  let raw = "";
  if (!plugins) {
    // No file yet (nothing installed, or a layout we do not know). The CLI's
    // own listing is the fallback, returned as text rather than guessed at.
    try {
      raw = await claude(profile, ["plugin", "list"], { spawn });
    } catch (e) {
      raw = e.message;
    }
    plugins = [];
  }
  return {
    profile,
    plugins: plugins.map((p) => ({ ...p, enabled: enabled[p.id] !== false })),
    marketplaces: Object.entries(markets || {}).map(([name, m]) => ({
      name,
      source: m?.source?.repo || m?.source?.url || m?.source?.path || "",
    })),
    raw,
  };
}

export async function installPlugin(profile, name, { spawn } = {}) {
  assertProfileName(profile);
  const n = assertPluginName(name);
  const out = await claude(profile, ["plugin", "install", n], { spawn });
  return { profile, installed: n, output: out.trim().slice(-1000) };
}

export async function removePlugin(profile, name, { spawn } = {}) {
  assertProfileName(profile);
  const n = assertPluginName(name);
  const out = await claude(profile, ["plugin", "uninstall", n], { spawn });
  return { profile, removed: n, output: out.trim().slice(-1000) };
}

export async function addMarketplace(profile, source, { spawn } = {}) {
  assertProfileName(profile);
  const s = assertMarketplaceSource(source);
  const out = await claude(profile, ["plugin", "marketplace", "add", s], { spawn });
  return { profile, added: s, output: out.trim().slice(-1000) };
}

// PURE: the name and description from a SKILL.md's front matter.
export function skillMeta(text) {
  const m = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = m ? m[1] : "";
  const get = (k) => (fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "") || "";
  return { name: get("name"), description: get("description").slice(0, 300) };
}

// Every SKILL.md under the profile's own skills/ and under installed plugins.
// Bounded: a plugin cache can be large and this answers a panel request.
export function listSkills(profile) {
  assertProfileName(profile);
  const dir = claudeDir(profile);
  const out = [];
  const roots = [
    { root: path.join(dir, "skills"), source: "user" },
    { root: path.join(dir, "plugins"), source: "plugin" },
  ];
  for (const { root, source } of roots) {
    const stack = [{ d: root, depth: 0 }];
    let visited = 0;
    while (stack.length && visited < 2000) {
      const { d, depth } = stack.pop();
      visited++;
      let entries = [];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch (_) {
        continue;
      }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory() && depth < 8 && !e.name.startsWith(".") && e.name !== "node_modules") stack.push({ d: p, depth: depth + 1 });
        else if (e.isFile() && e.name === "SKILL.md") {
          let meta = { name: "", description: "" };
          try {
            meta = skillMeta(fs.readFileSync(p, "utf8").slice(0, 4000));
          } catch (_) {}
          out.push({ name: meta.name || path.basename(d), description: meta.description, source, path: path.relative(dir, p) });
        }
      }
    }
  }
  return { profile, skills: out.sort((a, b) => a.name.localeCompare(b.name)) };
}

// PURE: server names from a codex config.toml — `[mcp_servers.<name>]`.
export function codexMcpNames(toml) {
  const names = new Set();
  for (const m of String(toml || "").matchAll(/^\s*\[mcp_servers\.("?)([A-Za-z0-9_-]+)\1\]/gm)) names.add(m[2]);
  return [...names];
}

export async function listMcp(profile, { spawn } = {}) {
  assertProfileName(profile);
  ensureProfile(profile);
  let claudeOut = "";
  try {
    claudeOut = (await claude(profile, ["mcp", "list"], { spawn, timeoutMs: 60_000 })).trim();
  } catch (e) {
    claudeOut = e.message;
  }
  const codexHome = profileEnv(profile, { tool: "codex" }).CODEX_HOME;
  let toml = "";
  try {
    toml = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  } catch (_) {}
  return {
    profile,
    claude: claudeOut,
    codex: codexMcpNames(toml),
    // Every job also gets the site's server, configured per job rather than
    // here, so it is stated rather than left for someone to wonder about.
    perJob: ["site (www.ravikishan.me/api/mcp, with the job's org)", "agentd (approvals)"],
  };
}
