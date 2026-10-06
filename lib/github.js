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
import { auth } from "./firebase";

const API = "https://api.github.com";

async function idToken() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  return user.getIdToken();
}

let live = null;

async function accessToken() {
  if (live && live.until > Date.now()) return live.token;
  const res = await fetch("/api/integrations/github/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await idToken()}`,
    },
    body: "{}",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error || `HTTP ${res.status}`);
    e.code = json.code || "github/disconnected";
    throw e;
  }
  // GitHub's token does not expire, but the panel still re-asks periodically so
  // that a Disconnect done in another tab takes effect without a reload.
  live = { token: json.accessToken, until: Date.now() + 10 * 60 * 1000 };
  return live.token;
}

export const forgetToken = () => {
  live = null;
};

async function call(path, { method = "GET", body, retry = true } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401 && retry) {
    live = null;
    return call(path, { method, body, retry: false });
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

export const shapeProfile = (u) => ({
  login: u.login,
  name: u.name || "",
  bio: u.bio || "",
  blog: u.blog || "",
  company: u.company || "",
  location: u.location || "",
  twitter: u.twitter_username || "",
  avatar: u.avatar_url,
  publicRepos: u.public_repos,
  followers: u.followers,
  url: u.html_url,
});

export const getProfile = async () => shapeProfile(await call("/user"));

export async function updateProfile(patch) {
  const body = {};
  if (typeof patch.name === "string") body.name = patch.name;
  if (typeof patch.bio === "string") body.bio = patch.bio;
  if (typeof patch.blog === "string") body.blog = patch.blog;
  if (typeof patch.company === "string") body.company = patch.company;
  if (typeof patch.location === "string") body.location = patch.location;
  if (typeof patch.twitter === "string") body.twitter_username = patch.twitter;
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
  pushedAt: r.pushed_at,
  url: r.html_url,
});

// Every page. 59 repositories is three requests, and an audit run over page one
// reports the clean repositories as if they were the whole picture.
export async function listRepos({ includeForks = false } = {}) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const rows = await call(`/user/repos?per_page=100&page=${page}&affiliation=owner&sort=pushed`);
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
