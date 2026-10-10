// BROWSER. GitHub for the admin panel.
//
// Same shape as lib/taskProviders.js: the credential comes from this
// deployment (/api/integrations/github/token unseals the stored token), and the
// panel then talks to api.github.com directly, which allows CORS. So no
// repository data passes through Vercel, and there is no second API surface to
// keep in step with the MCP tools.
//
// The shapes here match lib/server/github.js deliberately — the panel and the
// tools describe a repository the same way, so a field that exists in one is
// never quietly missing from the other.
import { adminJson } from "./adminFetch";
import { ANALYTICS_QUERY, analyticsVariables, shapeAnalytics, shapeViewer } from "./server/githubInsights";

export { rankRepos, repoTotals, levelsFor, ago, changeOf, SORTS, WINDOWS } from "./server/githubInsights";

const API = "https://api.github.com";

// Several GitHub accounts can be connected, so every token is per ACCOUNT.
// With two connected, asking the server for "the GitHub token" is refused as
// ambiguous — on purpose, since a README committed by the wrong account cannot
// be quietly undone — so the panel always names one.
//
// `current` is the account the unqualified functions below act as. The panel
// sets it when you pick an account; `as(accountId)` runs one call as another
// without disturbing it (the account lanes read every account at once).
const live = new Map();
let current = "";

export const setAccount = (accountId) => {
  current = accountId || "";
};
export const currentAccount = () => current;

async function accessToken(accountId = current) {
  const hit = live.get(accountId);
  if (hit && hit.until > Date.now()) return hit.token;
  // Our own route, so through adminFetch: the org header decides which
  // accounts this page may ask for. api.github.com below gets neither header.
  let json;
  try {
    json = await adminJson("/api/integrations/github/token", accountId ? { accountId } : {});
  } catch (e) {
    e.code = e.code || "github/disconnected";
    throw e;
  }
  // GitHub's token does not expire, but the panel still re-asks periodically so
  // that a Disconnect done in another tab takes effect without a reload.
  live.set(accountId, { token: json.accessToken, until: Date.now() + 10 * 60 * 1000 });
  return json.accessToken;
}

export const forgetToken = (accountId) => {
  if (accountId === undefined) live.clear();
  else live.delete(accountId);
};

async function call(path, { method = "GET", body, retry = true, account = current } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken(account)}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401 && retry) {
    live.delete(account);
    return call(path, { method, body, retry: false, account });
  }
  if (res.status === 401) {
    const e = new Error("GitHub refused the connection. Reconnect it below.");
    e.code = "github/reauth";
    throw e;
  }
  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset") || 0) * 1000;
      throw new Error(
        `GitHub's rate limit is spent. It resets at ${new Date(reset).toLocaleTimeString()}.`
      );
    }
    // Almost always a missing scope rather than a missing permission, and
    // GitHub names the scope it wanted in a header — so say which.
    const need = res.headers.get("x-accepted-oauth-scopes");
    const have = res.headers.get("x-oauth-scopes");
    throw new Error(
      `GitHub refused that.${
        need ? ` It needs the ${need} scope; this token has ${have || "none"}.` : ""
      }`
    );
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.message || msg;
      // A failed update carries a per-field reason; losing it turns a fixable
      // mistake into "Validation Failed".
      if (Array.isArray(j?.errors) && j.errors.length) {
        msg += `: ${j.errors.map((x) => x.message || `${x.field} ${x.code}`).join("; ")}`;
      }
    } catch (_) {}
    throw new Error(`GitHub: ${msg}`);
  }
  return res.status === 204 ? null : res.json();
}

const enc = encodeURIComponent;
const encPath = (p) => String(p).split("/").filter(Boolean).map(enc).join("/");

/* ---------------- profile ---------------- */

// The same shape the MCP tools return (lib/server/github.js), so a field the
// page shows is never missing from what an agent reads.
export const shapeProfile = shapeViewer;

export const getProfile = async (account = current) => shapeProfile(await call("/user", { account }));

/* ---------------- analytics ---------------- */

// One GraphQL request per account: the year of contributions, the language mix
// by bytes, organisations and totals. api.github.com/graphql allows CORS, so
// like everything else here it goes straight from the browser.
export async function getAnalytics(account = current, now = new Date()) {
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken(account)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: ANALYTICS_QUERY, variables: analyticsVariables(now) }),
  });
  if (res.status === 401) {
    live.delete(account);
    const e = new Error("GitHub refused the connection. Reconnect this account.");
    e.code = "github/reauth";
    throw e;
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.errors?.length) {
    throw new Error(`GitHub: ${(j.errors || []).map((e) => e.message).join("; ") || `HTTP ${res.status}`}`);
  }
  return shapeAnalytics(j.data.viewer, localDay(now));
}

// The calendar's days are the account's local dates, so "today" is the
// browser's local date too, not UTC's.
const localDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Fourteen days of views and clones — all the history GitHub keeps. Needs push
// access, which the owner always has; anything else answers 403 and is
// reported as unreadable rather than as zero.
export async function getTraffic(owner, repo, account = current) {
  const base = `/repos/${enc(owner)}/${enc(repo)}/traffic`;
  try {
    const [views, clones] = await Promise.all([
      call(`${base}/views`, { account }),
      call(`${base}/clones`, { account }),
    ]);
    return {
      repo,
      views: views.count || 0,
      uniques: views.uniques || 0,
      clones: clones.count || 0,
      cloners: clones.uniques || 0,
      daily: (views.views || []).map((d) => ({ date: d.timestamp.slice(0, 10), count: d.count })),
    };
  } catch (e) {
    return { repo, error: e.message };
  }
}

export async function updateProfile(patch) {
  const body = {};
  if (typeof patch.name === "string") body.name = patch.name;
  if (typeof patch.bio === "string") body.bio = patch.bio;
  if (typeof patch.blog === "string") body.blog = patch.blog;
  if (typeof patch.company === "string") body.company = patch.company;
  if (typeof patch.location === "string") body.location = patch.location;
  if (typeof patch.twitter === "string") body.twitter_username = patch.twitter;
  if (typeof patch.hireable === "boolean") body.hireable = patch.hireable;
  return shapeProfile(await call("/user", { method: "PATCH", body }));
}

/* ---------------- repositories ---------------- */

export const shapeRepo = (r) => ({
  name: r.name,
  fullName: r.full_name,
  owner: r.owner?.login || "",
  description: r.description || "",
  homepage: r.homepage || "",
  topics: r.topics || [],
  stars: r.stargazers_count,
  forks: r.forks_count,
  language: r.language || "",
  isFork: !!r.fork,
  archived: !!r.archived,
  private: !!r.private,
  defaultBranch: r.default_branch,
  watchers: r.watchers_count,
  openIssues: r.open_issues_count,
  pushedAt: r.pushed_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  url: r.html_url,
});

// Every page. 59 repositories is three requests, and an audit run over page one
// reports the clean repositories as if they were the whole picture.
export async function listRepos({ includeForks = false, account = current } = {}) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const rows = await call(`/user/repos?per_page=100&page=${page}&affiliation=owner&sort=pushed`, {
      account,
    });
    out.push(...rows.map(shapeRepo));
    if (rows.length < 100) break;
  }
  return includeForks ? out : out.filter((r) => !r.isFork);
}

export async function updateRepo(owner, repo, patch) {
  const body = {};
  if (typeof patch.description === "string") body.description = patch.description;
  if (typeof patch.homepage === "string") body.homepage = patch.homepage;
  if (typeof patch.archived === "boolean") body.archived = patch.archived;

  let updated = null;
  if (Object.keys(body).length) {
    updated = shapeRepo(await call(`/repos/${enc(owner)}/${enc(repo)}`, { method: "PATCH", body }));
  }
  if (patch.topics) {
    const names = await setTopics(owner, repo, patch.topics);
    if (updated) updated.topics = names;
  }
  return updated;
}

// Topics live on their OWN endpoint and replace the whole set — they are not
// part of the repository PATCH body. That is the usual reason an edit appears
// to save while the topics do not change.
export async function setTopics(owner, repo, topics) {
  const clean = [...new Set(topics.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  const bad = clean.filter((t) => !/^[a-z0-9][a-z0-9-]{0,49}$/.test(t));
  if (bad.length) {
    throw new Error(
      `Not valid GitHub topics (lowercase letters, digits and hyphens): ${bad.join(", ")}.`
    );
  }
  if (clean.length > 20) throw new Error(`GitHub allows 20 topics; that is ${clean.length}.`);
  const out = await call(`/repos/${enc(owner)}/${enc(repo)}/topics`, {
    method: "PUT",
    body: { names: clean },
  });
  return out.names || [];
}

export async function createRepo({ name, description, homepage, private: priv }) {
  return shapeRepo(
    await call("/user/repos", {
      method: "POST",
      body: {
        name,
        description: description || undefined,
        homepage: homepage || undefined,
        private: !!priv,
        // Without a first commit there is no default branch, and every later
        // file write fails on a branch that does not exist.
        auto_init: true,
      },
    })
  );
}

/* ---------------- the README ---------------- */

// GitHub wraps its base64 at 60 columns and atob rejects the newlines; and the
// content is UTF-8, so a README with an em dash or an emoji comes back mangled
// unless it is decoded as bytes rather than as Latin-1.
export const b64decode = (s) => {
  const raw = atob(String(s).replace(/\s/g, ""));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
};

export const b64encode = (s) => {
  const bytes = new TextEncoder().encode(s);
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw);
};

export async function getReadme(owner, repo) {
  try {
    const f = await call(`/repos/${enc(owner)}/${enc(repo)}/readme`);
    return { path: f.path, sha: f.sha, content: b64decode(f.content || ""), url: f.html_url };
  } catch (e) {
    // No README is a state the panel renders, not an error it reports.
    if (/404/.test(e.message)) {
      return { path: "README.md", sha: "", content: "", missing: true };
    }
    throw e;
  }
}

export async function writeReadme(owner, repo, { path, sha, content, message }) {
  const body = {
    message: message || (sha ? "Update README.md" : "Add README.md"),
    content: b64encode(content),
  };
  // The sha is what stops an edit silently overwriting a newer commit: without
  // it GitHub refuses rather than clobbering.
  if (sha) body.sha = sha;
  const out = await call(
    `/repos/${enc(owner)}/${enc(repo)}/contents/${encPath(path || "README.md")}`,
    { method: "PUT", body }
  );
  return { sha: out.content?.sha, commit: out.commit?.sha, url: out.content?.html_url };
}

/* ---------------- what is letting the profile down ---------------- */

// One implementation, shared with lib/server/github.js and pinned by
// npm run test:github. There were briefly two, and they had already drifted:
// this one grew `byRepo` and `repos` while the server's did not, so the
// panel's count and the MCP tool's count came from different code.
export { auditRepos } from "./server/repoAudit";
