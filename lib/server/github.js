// SERVER ONLY. The GitHub REST API, for the admin panel and the MCP tools.
//
// Hand-rolled over fetch rather than pulling in Octokit: this needs about a
// dozen endpoints, Octokit is a large dependency for that, and the one thing
// worth owning here is the error messages — "Resource not accessible by
// integration" tells you nothing about which scope you are missing, and that
// is the failure this file is most likely to hit.
//
// The repository is the product here. A repo with no description and no topics
// is invisible in GitHub search and reads as abandoned on a profile, which is
// why `auditRepos` exists alongside the plain CRUD: the useful question is not
// "what are my repos" but "which of them are letting the profile down".
const API = "https://api.github.com";

// The audit is pure and shared with the admin panel and the test suite, so
// the count a tool returns cannot disagree with the one on screen.
export { auditRepos } from "./repoAudit.js";
import { ANALYTICS_QUERY, analyticsVariables, shapeAnalytics, shapeViewer } from "./githubInsights.js";
export { rankRepos, repoTotals, shapeViewer, SORTS, WINDOWS } from "./githubInsights.js";

export class GithubError extends Error {
  constructor(message, { status, scope } = {}) {
    super(message);
    this.name = "GithubError";
    this.status = status;
    this.scope = scope;
  }
}

async function call(token, path, { method = "GET", body, raw = false } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ravikishan.me-admin",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    throw new GithubError(
      "GitHub rejected the connection. Reconnect GitHub in the admin's GitHub tab.",
      { status: 401 }
    );
  }
  if (res.status === 403 || res.status === 404) {
    // 403 here is almost always a missing scope rather than a missing
    // permission, and GitHub says which scopes the token actually has.
    const have = res.headers.get("x-oauth-scopes");
    const need = res.headers.get("x-accepted-oauth-scopes");
    const limit = res.headers.get("x-ratelimit-remaining");
    if (limit === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset") || 0) * 1000;
      throw new GithubError(
        `GitHub's rate limit is spent. It resets at ${new Date(reset).toISOString()}.`,
        { status: 403 }
      );
    }
    let detail = "";
    try {
      detail = (await res.json())?.message || "";
    } catch (_) {}
    if (res.status === 403) {
      throw new GithubError(
        `GitHub refused that (${detail || "forbidden"}).` +
          (need ? ` It needs the ${need} scope; this token has ${have || "none"}.` : ""),
        { status: 403, scope: need || "" }
      );
    }
    throw new GithubError(
      `GitHub answered 404 — that repository or path does not exist, or the token cannot see it${
        have ? ` (scopes: ${have})` : ""
      }.`,
      { status: 404 }
    );
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.message || msg;
      // A failed update usually carries a per-field reason; losing it turns a
      // fixable mistake into "Validation Failed".
      if (Array.isArray(j?.errors) && j.errors.length) {
        msg += `: ${j.errors.map((e) => e.message || `${e.field} ${e.code}`).join("; ")}`;
      }
    } catch (_) {}
    throw new GithubError(`GitHub: ${msg}`, { status: res.status });
  }
  if (res.status === 204) return null;
  return raw ? res.text() : res.json();
}

/* ---------------- identity ---------------- */

export async function getViewer(token) {
  return shapeViewer(await call(token, "/user"));
}

/* ---------------- analytics ---------------- */

export async function graphql(token, query, variables) {
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "ravikishan.me-admin",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) {
    throw new GithubError("GitHub rejected the connection. Reconnect it in the admin's GitHub tab.", { status: 401 });
  }
  if (!res.ok) throw new GithubError(`GitHub GraphQL answered ${res.status}.`, { status: res.status });
  const j = await res.json();
  if (j.errors?.length) throw new GithubError(j.errors.map((e) => e.message).join("; "));
  return j.data;
}

// The year of contributions, the language mix by bytes, organisations and the
// headline totals — one GraphQL call. Shaped by the pure module the admin page
// uses, so this and the page cannot disagree.
export async function githubAnalytics(token, { now = new Date() } = {}) {
  const data = await graphql(token, ANALYTICS_QUERY, analyticsVariables(now));
  const shaped = shapeAnalytics(data.viewer, now.toISOString().slice(0, 10));
  // The per-day list is for drawing a calendar; a tool caller wants the
  // summary, and 365 rows would bury it.
  const { days, ...calendar } = shaped.calendar;
  return { ...shaped, calendar };
}

export async function updateProfile(token, patch) {
  const body = {};
  if (typeof patch.name === "string") body.name = patch.name;
  if (typeof patch.bio === "string") body.bio = patch.bio;
  if (typeof patch.blog === "string") body.blog = patch.blog;
  if (typeof patch.company === "string") body.company = patch.company;
  if (typeof patch.location === "string") body.location = patch.location;
  if (typeof patch.twitter === "string") body.twitter_username = patch.twitter;
  if (typeof patch.hireable === "boolean") body.hireable = patch.hireable;
  if (!Object.keys(body).length) {
    throw new GithubError("Nothing to change — pass a name, bio, blog, company, location or twitter.");
  }
  // GitHub caps the bio at 160 characters and truncates silently past it.
  if (typeof body.bio === "string" && body.bio.length > 160) {
    throw new GithubError(
      `A GitHub bio is capped at 160 characters; that one is ${body.bio.length}. Shorten it rather than letting GitHub cut it.`
    );
  }
  return getViewerShape(await call(token, "/user", { method: "PATCH", body }));
}

const getViewerShape = (u) => ({
  login: u.login,
  name: u.name || "",
  bio: u.bio || "",
  blog: u.blog || "",
  company: u.company || "",
  location: u.location || "",
  twitter: u.twitter_username || "",
  hireable: !!u.hireable,
});

/* ---------------- repositories ---------------- */

const shapeRepo = (r) => ({
  name: r.name,
  fullName: r.full_name,
  owner: r.owner?.login || "",
  description: r.description || "",
  homepage: r.homepage || "",
  topics: r.topics || [],
  stars: r.stargazers_count,
  forks: r.forks_count,
  watchers: r.subscribers_count ?? undefined,
  language: r.language || "",
  isFork: !!r.fork,
  archived: !!r.archived,
  private: !!r.private,
  defaultBranch: r.default_branch,
  hasIssues: !!r.has_issues,
  hasWiki: !!r.has_wiki,
  openIssues: r.open_issues_count,
  pushedAt: r.pushed_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  url: r.html_url,
});

// Every page, because 59 repositories is three requests and a half-list is
// worse than a slow one — an audit over page 1 reports clean repos as the
// whole picture.
export async function listRepos(token, { includeForks = false } = {}) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const rows = await call(
      token,
      `/user/repos?per_page=100&page=${page}&affiliation=owner&sort=pushed`
    );
    out.push(...rows.map(shapeRepo));
    if (rows.length < 100) break;
  }
  return includeForks ? out : out.filter((r) => !r.isFork);
}

export const getRepo = async (token, owner, repo) =>
  shapeRepo(await call(token, `/repos/${enc(owner)}/${enc(repo)}`));

const enc = encodeURIComponent;

export async function updateRepo(token, owner, repo, patch) {
  const body = {};
  if (typeof patch.description === "string") body.description = patch.description;
  if (typeof patch.homepage === "string") body.homepage = patch.homepage;
  if (typeof patch.archived === "boolean") body.archived = patch.archived;
  if (typeof patch.hasIssues === "boolean") body.has_issues = patch.hasIssues;
  if (typeof patch.hasWiki === "boolean") body.has_wiki = patch.hasWiki;
  if (typeof patch.defaultBranch === "string") body.default_branch = patch.defaultBranch;
  if (typeof patch.name === "string") body.name = patch.name;

  const topics = patch.topics;
  if (!Object.keys(body).length && !topics) {
    throw new GithubError(
      "Nothing to change — pass a description, homepage, topics, or one of the repository flags."
    );
  }

  // GitHub caps a repository description at 350 characters.
  if (typeof body.description === "string" && body.description.length > 350) {
    throw new GithubError(
      `A repository description is capped at 350 characters; that one is ${body.description.length}.`
    );
  }

  let updated = null;
  if (Object.keys(body).length) {
    updated = shapeRepo(await call(token, `/repos/${enc(owner)}/${enc(repo)}`, { method: "PATCH", body }));
  }
  if (topics) {
    // Topics live on their own endpoint and REPLACE the whole set; they are
    // not part of the repository PATCH body.
    const t = await setTopics(token, owner, repo, topics);
    if (updated) updated.topics = t;
    else updated = { ...(await getRepo(token, owner, repo)), topics: t };
  }
  return updated;
}

export async function setTopics(token, owner, repo, topics) {
  // GitHub's rules, enforced here so a bad one names itself rather than coming
  // back as "Validation Failed": lowercase, digits and hyphens, 50 chars, 20 max.
  const clean = [...new Set(topics.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  const bad = clean.filter((t) => !/^[a-z0-9][a-z0-9-]{0,49}$/.test(t));
  if (bad.length) {
    throw new GithubError(
      `These topics are not valid GitHub topics (lowercase letters, digits and hyphens, starting with a letter or digit): ${bad.join(", ")}.`
    );
  }
  if (clean.length > 20) {
    throw new GithubError(`GitHub allows at most 20 topics; that is ${clean.length}.`);
  }
  const out = await call(token, `/repos/${enc(owner)}/${enc(repo)}/topics`, {
    method: "PUT",
    body: { names: clean },
  });
  return out.names || [];
}

export async function createRepo(token, { name, description, homepage, private: priv, autoInit = true }) {
  const made = await call(token, "/user/repos", {
    method: "POST",
    body: {
      name,
      description: description || undefined,
      homepage: homepage || undefined,
      private: !!priv,
      // Without a first commit the repo has no default branch, and every
      // file write afterwards fails on a branch that does not exist yet.
      auto_init: autoInit,
    },
  });
  return shapeRepo(made);
}

/* ---------------- files, including the README ---------------- */

// The contents API is the only way to write a file without a git client, and
// it needs the blob sha of what is being replaced — without it GitHub refuses
// rather than overwriting, which is the behaviour you want.
// Every file in a repository in ONE request, which is what makes an Obsidian
// vault usable: the contents API lists a directory at a time, and a vault with
// forty folders would be forty round trips before the first note is read.
// `truncated` is Git's own flag for a tree too large to return whole — it is
// surfaced rather than swallowed, because a silently short vault looks exactly
// like missing notes.
export async function listTree(token, owner, repo, { ref = "HEAD" } = {}) {
  const t = await call(
    token,
    `/repos/${enc(owner)}/${enc(repo)}/git/trees/${enc(ref)}?recursive=1`
  );
  return {
    truncated: !!t.truncated,
    files: (t.tree || [])
      .filter((n) => n.type === "blob")
      .map((n) => ({ path: n.path, sha: n.sha, size: n.size || 0 })),
  };
}

export async function getFile(token, owner, repo, path, { ref } = {}) {
  const q = ref ? `?ref=${enc(ref)}` : "";
  const f = await call(token, `/repos/${enc(owner)}/${enc(repo)}/contents/${encPath(path)}${q}`);
  if (Array.isArray(f)) {
    throw new GithubError(`"${path}" is a directory, not a file.`);
  }
  return {
    path: f.path,
    sha: f.sha,
    size: f.size,
    content: f.content ? Buffer.from(f.content, "base64").toString("utf8") : "",
    url: f.html_url,
  };
}

// Each segment encoded, but the slashes kept: a path is a path.
const encPath = (p) =>
  String(p)
    .split("/")
    .filter(Boolean)
    .map(enc)
    .join("/");

export async function getReadme(token, owner, repo) {
  const f = await call(token, `/repos/${enc(owner)}/${enc(repo)}/readme`);
  return {
    path: f.path,
    sha: f.sha,
    size: f.size,
    content: Buffer.from(f.content || "", "base64").toString("utf8"),
    url: f.html_url,
  };
}

export async function putFile(token, owner, repo, path, content, { message, sha, branch } = {}) {
  const body = {
    message: message || `Update ${path}`,
    content: Buffer.from(String(content), "utf8").toString("base64"),
  };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;

  try {
    const out = await call(token, `/repos/${enc(owner)}/${enc(repo)}/contents/${encPath(path)}`, {
      method: "PUT",
      body,
    });
    return { path: out.content?.path, sha: out.content?.sha, commit: out.commit?.sha, url: out.content?.html_url };
  } catch (e) {
    // The one failure worth translating: writing without a sha over a file
    // that exists, or with a stale sha after someone else pushed.
    if (e.status === 409 || /sha/i.test(e.message || "")) {
      throw new GithubError(
        `${e.message} — read the file first and pass its current sha, so an edit cannot silently overwrite a newer commit.`,
        { status: e.status }
      );
    }
    throw e;
  }
}

/* ---------------- many files, ONE commit ---------------- */

// `putFile` is one commit per file. That is right for editing a README and
// wrong for everything else: scaffolding a project writes thirty files, and
// doing it a file at a time means thirty commits, thirty round trips, and a
// repository whose history is "Add package.json", "Add tsconfig.json", "Add
// src/index.ts" — thirty entries that say nothing about what was built.
//
// The Git Data API builds a commit the way git does: write the objects, build
// a tree, point a commit at it, move the branch. Four calls regardless of file
// count, one commit, and the working tree is never half-written — the branch
// moves once, at the end, or not at all.
//
// Text goes INLINE in the tree. GitHub accepts `content` on a tree entry and
// writes the blob itself, which removes one round trip per file; only binary
// needs a real blob upload, because a tree entry's content field is utf-8.
export const MAX_COMMIT_FILES = 100;
// A tree request carrying a few MB of inline content is the thing that times
// out, and it fails as a flat 502 that says nothing about size.
export const MAX_COMMIT_BYTES = 6 * 1024 * 1024;

export async function commitFiles(
  token,
  owner,
  repo,
  { files = [], message, branch, deletions = [] } = {}
) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length && !deletions.length)
    throw new GithubError("Nothing to commit — pass at least one file or deletion.");
  if (list.length + deletions.length > MAX_COMMIT_FILES)
    throw new GithubError(
      `${list.length + deletions.length} paths in one commit; the cap is ${MAX_COMMIT_FILES}. Split it.`
    );
  for (const f of list) {
    if (!f || typeof f.path !== "string" || !f.path.trim())
      throw new GithubError("Every file needs a path.");
    // A leading slash or a .. segment resolves somewhere the caller did not
    // mean, and git will happily store it.
    if (f.path.startsWith("/") || f.path.split("/").includes(".."))
      throw new GithubError(`"${f.path}" must be a repo-relative path with no .. segments.`);
    if (typeof f.content !== "string" && typeof f.contentBase64 !== "string")
      throw new GithubError(`"${f.path}" needs content or contentBase64.`);
  }
  const bytes = list.reduce(
    (n, f) => n + (f.content ? Buffer.byteLength(f.content, "utf8") : (f.contentBase64?.length || 0) * 0.75),
    0
  );
  if (bytes > MAX_COMMIT_BYTES)
    throw new GithubError(
      `That commit carries about ${Math.round(bytes / 1024)} KB; the cap is ${Math.round(
        MAX_COMMIT_BYTES / 1024
      )} KB. Split it, or add large files from CI instead.`
    );

  const base = `/repos/${enc(owner)}/${enc(repo)}`;

  // Which branch, and where it is now. Asking the repo rather than assuming
  // "main": a repo created from a template or an older default is on master,
  // and the write would fail on a ref that does not exist.
  let ref = branch;
  if (!ref) {
    const info = await call(token, base);
    ref = info.default_branch || "main";
  }
  let head;
  try {
    head = await call(token, `${base}/git/ref/heads/${encPath(ref)}`);
  } catch (e) {
    if (e.status === 404)
      throw new GithubError(
        `Branch "${ref}" does not exist in ${owner}/${repo}. A repository created without an initial commit has no branch at all — create it with autoInit, or name an existing branch.`,
        { status: 404 }
      );
    throw e;
  }
  const headSha = head.object?.sha;
  const headCommit = await call(token, `${base}/git/commits/${enc(headSha)}`);
  const baseTree = headCommit.tree?.sha;

  // Binary needs a blob of its own; text rides inline.
  const tree = [];
  for (const f of list) {
    const entry = { path: f.path, mode: f.mode || "100644", type: "blob" };
    if (typeof f.contentBase64 === "string") {
      const blob = await call(token, `${base}/git/blobs`, {
        method: "POST",
        body: { content: f.contentBase64, encoding: "base64" },
      });
      entry.sha = blob.sha;
    } else {
      entry.content = f.content;
    }
    tree.push(entry);
  }
  // A null sha is how git records a deletion in a tree.
  for (const path of deletions) tree.push({ path, mode: "100644", type: "blob", sha: null });

  const newTree = await call(token, `${base}/git/trees`, {
    method: "POST",
    body: { base_tree: baseTree, tree },
  });
  const commit = await call(token, `${base}/git/commits`, {
    method: "POST",
    body: {
      message: message || `Add ${list.length} file${list.length === 1 ? "" : "s"}`,
      tree: newTree.sha,
      parents: [headSha],
    },
  });
  // The branch moves last. Everything before this is unreferenced objects that
  // GitHub will collect, so a failure part-way leaves the branch untouched
  // rather than half-written.
  await call(token, `${base}/git/refs/heads/${encPath(ref)}`, {
    method: "PATCH",
    body: { sha: commit.sha },
  });

  return {
    branch: ref,
    commit: commit.sha,
    files: list.map((f) => f.path),
    deleted: deletions,
    url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
  };
}

// A tag plus a GitHub release. This is what starts a publish: the release
// workflow triggers on it, so nothing here talks to a registry.
export async function createRelease(token, owner, repo, { tag, name, body, target, draft = false }) {
  if (!tag) throw new GithubError("A release needs a tag.");
  const out = await call(token, `/repos/${enc(owner)}/${enc(repo)}/releases`, {
    method: "POST",
    body: {
      tag_name: tag,
      name: name || tag,
      body: body || "",
      draft: !!draft,
      ...(target ? { target_commitish: target } : {}),
    },
  });
  return { tag: out.tag_name, url: out.html_url, id: out.id, draft: out.draft };
}

// Convenience: read, replace, write — with the sha handled, because forgetting
// it is the single most common way this call fails.
export async function writeReadme(token, owner, repo, content, { message } = {}) {
  let sha;
  let path = "README.md";
  try {
    const existing = await getReadme(token, owner, repo);
    sha = existing.sha;
    path = existing.path;
  } catch (e) {
    if (e.status !== 404) throw e;
    // No README yet: create one.
  }
  return putFile(token, owner, repo, path, content, {
    message: message || (sha ? "Update README.md" : "Add README.md"),
    sha,
  });
}

/* ---------------- what the profile is doing wrong ---------------- */

// Reading pinned repositories needs GraphQL; there is no REST endpoint and no
// mutation to SET them, which is why this is read-only and says so.
export async function listPinned(token, login) {
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "ravikishan.me-admin",
    },
    body: JSON.stringify({
      query: `query($login:String!){user(login:$login){pinnedItems(first:6,types:REPOSITORY){nodes{... on Repository{name description stargazerCount url}}}}}`,
      variables: { login },
    }),
  });
  if (!res.ok) throw new GithubError(`GitHub GraphQL answered ${res.status}.`);
  const j = await res.json();
  if (j.errors?.length) throw new GithubError(j.errors.map((e) => e.message).join("; "));
  return (j.data?.user?.pinnedItems?.nodes || []).map((n) => ({
    name: n.name,
    description: n.description || "",
    stars: n.stargazerCount,
    url: n.url,
  }));
}
