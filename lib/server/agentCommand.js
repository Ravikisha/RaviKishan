// Turning a spoken sentence into a job.
//
// PURE — no imports — so it is testable without a browser or a microphone, the
// same reason noteShape.js and repoAudit.js are pure. lib/agentClient.js
// re-exports it for the panel.
//
// Deliberately NOT an intent classifier. The task text goes to the agent
// verbatim: it is a model, it can read a sentence, and a classifier in front of
// it would only be a second thing to be wrong. What this does is pull out the
// two things the SERVER needs structured — which repository, which account —
// and recognise the one phrase whose risk differs: "deploy".

export class CommandError extends Error {}

const SAFE = /[.*+?^${}()|[\]\\]/g;
const escape = (s) => String(s).replace(SAFE, "\\$&");

// The short name of a repo: "Ravikisha/RaviKishan" -> "ravikishan".
const shortName = (repo) => String(repo).split("/").pop().toLowerCase();

// A word boundary does not exist beside a non-word character, so `\b` fails for
// a repository called "c++" or a profile called "work.2": the trailing boundary
// never matches and the repo is silently never routed. These assert "not
// preceded by / not followed by a name character", which is what was meant.
const NOT_BEFORE = "(?<![\\w.+#-])";
const NOT_AFTER = "(?![\\w.+#-])";

const near = (word, name) => new RegExp(`${NOT_BEFORE}(?:${word})\\s+${escape(name)}${NOT_AFTER}`, "i");
const bare = (name) => new RegExp(`${NOT_BEFORE}${escape(name)}${NOT_AFTER}`, "i");

export function parseCommand(text, { repos = [], profiles = [], defaults = {} } = {}) {
  const said = String(text || "").trim();
  if (!said) throw new CommandError("Nothing was said.");

  const lower = said.toLowerCase();

  // Prefer an explicit "in <repo>" over a bare mention: a task that happens to
  // contain a repository's name ("rename RaviKishan in the readme") must not
  // silently retarget the job.
  const explicit = repos.find((r) => near("in|on|to|for", shortName(r)).test(lower));
  const mentioned = repos.find((r) => bare(shortName(r)).test(lower));
  const repo = explicit || mentioned || defaults.repo || "";

  const profile =
    profiles.find((p) => near("as|using", String(p).toLowerCase()).test(lower)) || defaults.profile || "";

  // "and deploy it" is a different risk from "open a PR", so it is recognised
  // rather than assumed either way. Everything else opens a pull request.
  const finish = /\bdeploy(s|ing|ed)?\b|\bship it\b/.test(lower)
    ? "deploy"
    : /\b(?:just\s+)?(?:show|give)\s+me\s+(?:a\s+|the\s+)?(?:diff|patch)\b|\bpatch only\b/.test(lower)
    ? "patch"
    : "pr";

  // Strip only the routing phrase that actually matched, so the agent is not
  // instructed to "in RaviKishan" as part of its task.
  let task = said;
  if (explicit) task = task.replace(near("in|on|to|for", shortName(explicit)), " ");
  if (profile) task = task.replace(near("as|using", String(profile).toLowerCase()), " ");
  task = task.replace(/\s{2,}/g, " ").replace(/^[,\s]+|[,\s]+$/g, "").trim();

  return { task: task || said, repo, profile, finish };
}
