// What a plugin, a skill, a marketplace and an org are allowed to be called.
//
// PURE. Every one of these strings ends up as an ARGUMENT to the claude or
// codex CLI, and an argument that begins with "-" is a flag. The spawns are
// array-form (no shell), so there is no quoting to break — but `claude plugin
// install --dangerously-skip-permissions` is still a thing a crafted name could
// become. So the rule for each is a shape it must match, never a list of
// characters it must avoid.
import { isOrgId, DEFAULT_ORG } from "../../lib/server/orgShape.js";

export class NameError extends Error {}

// `name` or `name@marketplace`, the way `claude plugin install` takes it.
const PLUGIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(@[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$/;
// A skill is a directory name under skills/, optionally namespaced by its
// plugin the way Claude Code shows it (`plugin:skill`).
const SKILL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(:[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$/;
// A marketplace is a GitHub `owner/repo` or an https git URL. Nothing local:
// a filesystem path would let a panel request read any directory this user
// can see and register it as a source of code to run.
const GH_REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const HTTPS = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~\/-]+(\.git)?$/;

export function assertPluginName(name) {
  const s = String(name ?? "");
  if (!PLUGIN.test(s)) {
    throw new NameError(
      `"${s.slice(0, 80)}" is not a plugin name. Use name or name@marketplace — letters, digits, dot, hyphen, underscore, starting with a letter or digit.`
    );
  }
  return s;
}

export function assertSkillName(name) {
  const s = String(name ?? "");
  if (!SKILL.test(s)) {
    throw new NameError(`"${s.slice(0, 80)}" is not a skill name. Use skill or plugin:skill.`);
  }
  return s;
}

export function assertMarketplaceSource(source) {
  const s = String(source ?? "");
  if (GH_REPO.test(s) || HTTPS.test(s)) return s;
  throw new NameError(
    `"${s.slice(0, 120)}" is not a marketplace source. Give a GitHub owner/repo or an https:// git URL; local paths are refused on purpose.`
  );
}

// An org id from a job. Empty means "the default org", resolved HERE so the
// MCP header and the recall call can never disagree about which one it was.
export function resolveOrg(orgId) {
  if (orgId === undefined || orgId === null || orgId === "") return DEFAULT_ORG;
  if (!isOrgId(orgId)) {
    throw new NameError(`"${String(orgId).slice(0, 60)}" is not an org id. Org ids are lowercase letters, digits and hyphens.`);
  }
  return orgId;
}

export const cleanList = (list, assert, { max = 20, label = "item" } = {}) => {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length > max) throw new NameError(`At most ${max} ${label}s per job.`);
  return [...new Set(arr.map(assert))];
};
