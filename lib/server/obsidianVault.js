// SERVER ONLY. An Obsidian vault as a note source.
//
// Obsidian has NO cloud API. A vault is Markdown files in a folder on disk, and
// this deployment's filesystem is read-only at runtime, so there is nothing to
// talk to and nowhere to write. Pretending otherwise would mean a Connect
// button that cannot work.
//
// What DOES work, and is how most people already sync a vault: keep it in a Git
// repository. So this adapter is a thin layer over the GitHub client that
// landed with the GitHub integration — which means Obsidian support costs no
// new credential, no new consent screen and no new secret. If the vault is
// already a repo, connecting GitHub is the whole setup.
//
// Consequences, stated rather than discovered:
//   - every write is a REAL COMMIT on the default branch
//   - a note's identity is its PATH, so renaming the title moves the file
//   - metadata lives in YAML front matter, which is what Obsidian itself reads
import { listTree, getFile, putFile, GithubError } from "./github.js";
import {
  NoteError,
  shapeNote,
  parseFrontMatter,
  withFrontMatter,
  cleanTags,
  vaultPath,
  titleFrom,
} from "./noteShape.js";

// Where the vault lives. Env rather than a stored setting because it is
// deployment configuration, not content, and a wrong value should be obvious
// at boot rather than editable from a chat client.
export const vaultConfig = () => ({
  repo: process.env.OBSIDIAN_VAULT_REPO || "",
  folder: (process.env.OBSIDIAN_VAULT_FOLDER || "").replace(/^\/+|\/+$/g, ""),
});

export const isVaultConfigured = () => !!vaultConfig().repo;

export class VaultError extends Error {}

function requireVault() {
  const { repo, folder } = vaultConfig();
  if (!repo) {
    const e = new VaultError(
      "No Obsidian vault is configured. Set OBSIDIAN_VAULT_REPO to the repository holding the vault (owner/name, or just the name to use the connected account)."
    );
    e.code = "obsidian/not-configured";
    throw e;
  }
  const [a, b] = repo.split("/");
  return { owner: b ? a : "", name: b || a, folder };
}

// A note's id is its path inside the vault. Paths contain slashes, which are
// fine in a JSON value but not in a URL segment, so ids are encoded once here
// and nowhere else.
export const idFromPath = (path) => encodeURIComponent(path);
export const pathFromId = (id) => decodeURIComponent(String(id));

const isMarkdown = (p) => /\.md$/i.test(p);

// Obsidian's own conventions: `.obsidian` is the vault's config directory and
// `.trash` is where it puts deleted files. Listing either as notes would show
// the reader a workspace layout file and a tombstone.
const isHidden = (p) =>
  p.split("/").some((seg) => seg.startsWith(".")) || /^_templates?\//i.test(p);

function noteFrom(path, text, { sha } = {}) {
  const { meta, body } = parseFrontMatter(text);
  const name = path.split("/").pop().replace(/\.md$/i, "");
  const folder = path.split("/").slice(0, -1).join("/");
  return shapeNote(
    {
      id: idFromPath(path),
      // The filename IS the title in Obsidian. A front-matter `title` overrides
      // it, because some vaults set one and it should win over the slug.
      title: meta.title || name || titleFrom(body),
      body,
      tags: cleanTags(meta.tags),
      container: folder,
      containerName: folder || "(vault root)",
      pinned: String(meta.pinned) === "true",
      createdAt: meta.created || "",
      updatedAt: meta.updated || "",
      url: "",
    },
    { source: "obsidian" }
  );
}

/* ---------------- reading ---------------- */

export async function listVaultNotes(token, owner, { withBodies = false, limit = 400 } = {}) {
  const v = requireVault();
  const repoOwner = v.owner || owner;
  const tree = await listTree(token, repoOwner, v.name).catch((e) => {
    if (e instanceof GithubError && e.status === 404) {
      throw new VaultError(
        `No repository ${repoOwner}/${v.name}. Check OBSIDIAN_VAULT_REPO, and that the connected GitHub account can see it.`
      );
    }
    throw e;
  });

  let files = tree.files.filter((f) => isMarkdown(f.path) && !isHidden(f.path));
  if (v.folder) files = files.filter((f) => f.path === v.folder || f.path.startsWith(`${v.folder}/`));

  const notes = files.slice(0, limit).map((f) =>
    shapeNote(
      {
        id: idFromPath(f.path),
        title: f.path.split("/").pop().replace(/\.md$/i, ""),
        body: "",
        container: f.path.split("/").slice(0, -1).join("/"),
        containerName: f.path.split("/").slice(0, -1).join("/") || "(vault root)",
      },
      { source: "obsidian" }
    )
  );

  // Bodies are one request per file, so they are opt-in. A 400-note vault would
  // otherwise spend 400 of the 5000 hourly GitHub calls just to open a list.
  if (withBodies) {
    const out = [];
    for (const n of notes) {
      out.push(await getVaultNote(token, repoOwner, n.id).catch(() => n));
    }
    return {
      notes: out,
      truncated: tree.truncated || files.length > limit,
      total: files.length,
    };
  }

  return { notes, truncated: tree.truncated || files.length > limit, total: files.length };
}

export async function getVaultNote(token, owner, id) {
  const v = requireVault();
  const path = pathFromId(id);
  const f = await getFile(token, v.owner || owner, v.name, path);
  return { ...noteFrom(path, f.content, { sha: f.sha }), sha: f.sha };
}

/* ---------------- writing ---------------- */

export async function createVaultNote(token, owner, { title, body, tags, pinned, container } = {}) {
  const v = requireVault();
  const folder = container !== undefined ? String(container) : v.folder;
  const path = vaultPath(title || titleFrom(body, "Untitled"), { folder });

  // Refuse rather than overwrite: creating a note that silently replaces an
  // existing file is how a vault loses a page.
  const existing = await getFile(token, v.owner || owner, v.name, path).catch(() => null);
  if (existing) {
    throw new NoteError(
      `"${path}" already exists in the vault. Open it and edit it, or give this note a different title.`
    );
  }

  const text = withFrontMatter(
    { tags: cleanTags(tags), pinned: !!pinned, extra: { created: new Date().toISOString() } },
    body || ""
  );
  await putFile(token, v.owner || owner, v.name, path, text, { message: `Add ${path}` });
  return noteFrom(path, text);
}

export async function updateVaultNote(token, owner, id, patch) {
  const v = requireVault();
  const repoOwner = v.owner || owner;
  const path = pathFromId(id);

  const current = await getFile(token, repoOwner, v.name, path);
  const { meta, body } = parseFrontMatter(current.content);

  const nextTags = patch.tags !== undefined ? cleanTags(patch.tags) : cleanTags(meta.tags);
  const nextPinned = patch.pinned !== undefined ? !!patch.pinned : String(meta.pinned) === "true";
  const nextBody = patch.body !== undefined ? String(patch.body) : body;

  const text = withFrontMatter(
    {
      tags: nextTags,
      pinned: nextPinned,
      extra: {
        ...(meta.created ? { created: meta.created } : {}),
        updated: new Date().toISOString(),
        ...(meta.title ? { title: meta.title } : {}),
      },
    },
    nextBody
  );

  // A title or folder change RENAMES the file, because a note's identity in a
  // vault is its path. Written first, old deleted after: a failure leaves a
  // duplicate, which is recoverable, rather than a hole, which is not — the
  // same ordering as the cross-service task move.
  const renamed =
    (patch.title !== undefined && patch.title !== (meta.title || path.split("/").pop().replace(/\.md$/i, ""))) ||
    (patch.container !== undefined && patch.container !== path.split("/").slice(0, -1).join("/"));

  if (renamed) {
    const folder =
      patch.container !== undefined ? String(patch.container) : path.split("/").slice(0, -1).join("/");
    const nextPath = vaultPath(patch.title ?? path.split("/").pop().replace(/\.md$/i, ""), { folder });
    if (nextPath !== path) {
      const clash = await getFile(token, repoOwner, v.name, nextPath).catch(() => null);
      if (clash) throw new NoteError(`"${nextPath}" already exists in the vault.`);
      await putFile(token, repoOwner, v.name, nextPath, text, { message: `Rename ${path} to ${nextPath}` });
      await deleteVaultFile(token, repoOwner, v.name, path, current.sha);
      return noteFrom(nextPath, text);
    }
  }

  await putFile(token, repoOwner, v.name, path, text, {
    message: `Update ${path}`,
    sha: current.sha,
  });
  return noteFrom(path, text);
}

// The contents API deletes a file with its sha, which is also what stops a
// delete racing a newer commit.
async function deleteVaultFile(token, owner, repo, path, sha) {
  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: `Delete ${path}`, sha }),
    }
  );
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json())?.message || msg;
    } catch (_) {}
    throw new VaultError(`Could not delete ${path}: ${msg}`);
  }
  return true;
}

export async function deleteVaultNote(token, owner, id) {
  const v = requireVault();
  const path = pathFromId(id);
  const current = await getFile(token, v.owner || owner, v.name, path);
  await deleteVaultFile(token, v.owner || owner, v.name, path, current.sha);
  return { deleted: id, path };
}

// Folders, derived from the files themselves — there is no folder object in a
// Git tree, and an empty folder cannot exist in one.
export async function listVaultFolders(token, owner) {
  const { notes } = await listVaultNotes(token, owner);
  const counts = new Map();
  for (const n of notes) counts.set(n.container, (counts.get(n.container) || 0) + 1);
  return [...counts.entries()]
    .map(([id, n]) => ({ id, name: id || "(vault root)", notes: n }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
