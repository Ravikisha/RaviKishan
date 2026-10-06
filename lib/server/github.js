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
  const u = await call(token, "/user");
  return {
    login: u.login,
    name: u.name || "",
    bio: u.bio || "",
    blog: u.blog || "",
    company: u.company || "",
    location: u.location || "",
    twitter: u.twitter_username || "",
    hireable: !!u.hireable,
    avatar: u.avatar_url,
    publicRepos: u.public_repos,
    followers: u.followers,
    following: u.following,
    url: u.html_url,
  };
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

// The point of the whole integration: which repositories are letting the
// profile down. Every rule here is something a visitor or GitHub search
// actually reacts to, not a style preference.
export function auditRepos(repos, { readmes = {} } = {}) {
  const findings = [];
  const add = (repo, issue, why) => findings.push({ repo: repo.name, issue, why, url: repo.url });

  for (const r of repos) {
    if (r.archived) continue;
    if (!r.description.trim()) {
      add(r, "no description", "GitHub search ranks on it, and the profile shows a blank line.");
    } else if (r.description.length > 350) {
      add(r, "description too long", `${r.description.length} characters; GitHub caps it at 350.`);
    }
    if (!r.topics.length) {
      add(r, "no topics", "Topics are how a repository is found by subject rather than by name.");
    }
    if (r.stars >= 5 && !r.homepage) {
      add(r, "no homepage link", `${r.stars} stars and nowhere pointing back at the site or docs.`);
    }
    const readme = readmes[r.name];
    if (readme === null) {
      add(r, "no README", "The repository page is empty below the file list.");
    } else if (typeof readme === "string" && readme.trim().length < 200) {
      add(r, "thin README", `${readme.trim().length} characters — too short to explain what this is.`);
    }
  }

  const byIssue = {};
  for (const f of findings) byIssue[f.issue] = (byIssue[f.issue] || 0) + 1;
  return { count: findings.length, byIssue, findings };
}
