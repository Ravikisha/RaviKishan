// SERVER ONLY. One note API over four very different places.
//
// Same shape as taskBoard.js, and for the same reason: an AI client should not
// have to pick between `local_create_note`, `notion_create_page`,
// `trello_create_card` and `obsidian_write_file` — it would pick wrong. One
// vocabulary, `source` as an argument, and every difference between the four
// reported in the result rather than left to be discovered.
//
// Credentials come from four different places and that is hidden here, not in
// the tools:
//   local     the admin's own Firestore access (no third party at all)
//   notion    a sealed OAuth token from the connected-accounts store
//   trello    an API key + user token in the environment (its OAuth is 1.0a)
//   obsidian  the GitHub connection, because the vault is a Git repository
import { accessTokenFor, readConnection } from "./connectedAccount.js";
import { assertUsable, getSource, DEFAULT_SOURCE, NOTE_SOURCES } from "./noteSources.js";
import { NoteError, validatePatch, searchNotes, sortNotes, shapeNote } from "./noteShape.js";
import * as local from "./notesLocal.js";
import * as notion from "./notion.js";
import * as trello from "./trello.js";
import * as vault from "./obsidianVault.js";

export { DEFAULT_SOURCE };

/* ---------------- resolving a credential ---------------- */

async function contextFor(idToken, sourceId) {
  const source = assertUsable(sourceId);

  if (source.id === "local") return { source, idToken };

  if (source.id === "trello") {
    if (!trello.isTrelloConfigured()) {
      throw new NoteError(
        "Trello is not configured on this deployment (missing TRELLO_API_KEY and/or TRELLO_TOKEN)."
      );
    }
    return { source };
  }

  if (source.id === "notion") {
    {
      // Notion is multi-account: one login can be connected to several
      // workspaces, and they are genuinely different notebooks.
      const { tokenFor } = await import("./accountDirectory.js");
      const { token } = await tokenFor(idToken, { provider: "notion", service: "notes" });
      return { source, token };
    }
  }

  if (source.id === "obsidian") {
    if (!vault.isVaultConfigured()) {
      throw new NoteError(
        "No Obsidian vault is configured. Set OBSIDIAN_VAULT_REPO to the repository holding the vault."
      );
    }
    const { tokenFor } = await import("./accountDirectory.js");
    // "notes" rather than "code": the vault repo may well live under a
    // different GitHub account than the one that holds the projects.
    const { token } = await tokenFor(idToken, { provider: "github", service: "notes" });
    const conn = await readConnection(idToken, "github").catch(() => null);
    return { source, token, owner: conn?.email || "" };
  }

  throw new NoteError(`No adapter for ${source.id}.`);
}

/* ---------------- notebooks ---------------- */

export async function listContainers(idToken, sourceId) {
  const { source, token, idToken: fsToken, owner } = await contextFor(idToken, sourceId);
  switch (source.id) {
    case "local":
      return local.listNotebooks(fsToken);
    case "notion":
      return (await notion.listDatabases(token)).map((d) => ({
        id: d.id,
        name: d.name,
        url: d.url,
        titleProp: d.titleProp,
        tagProp: d.tagProp,
      }));
    case "trello":
      return trello.listContainers();
    case "obsidian":
      return vault.listVaultFolders(token, owner);
    default:
      return [];
  }
}

/* ---------------- reading ---------------- */

export async function listNotes(idToken, sourceId, { container, withBodies = false, includeArchived = true } = {}) {
  const ctx = await contextFor(idToken, sourceId);
  const { source, token, idToken: fsToken, owner } = ctx;

  switch (source.id) {
    case "local":
      return sortNotes(await local.listNotes(fsToken, { includeArchived }));

    case "notion": {
      const dbs = await notion.listDatabases(token);
      const wanted = container ? dbs.filter((d) => d.id === container) : dbs;
      if (container && !wanted.length) {
        throw new NoteError(
          `No Notion database ${container} is shared with this integration. list_notebooks shows the ones that are.`
        );
      }
      const out = [];
      for (const d of wanted) {
        out.push(
          ...(await notion.listPages(token, d.id, {
            containerName: d.name,
            titleProp: d.titleProp,
            tagProp: d.tagProp,
          }))
        );
      }
      return sortNotes(out.filter((n) => includeArchived || !n.archived));
    }

    case "trello": {
      const cards = await trello.listCards({ listId: container });
      return sortNotes(cards.filter((n) => includeArchived || !n.archived));
    }

    case "obsidian": {
      const { notes, truncated, total } = await vault.listVaultNotes(token, owner, { withBodies });
      const filtered = container ? notes.filter((n) => n.container === container) : notes;
      const sorted = sortNotes(filtered);
      // The flag rides on the array rather than being dropped: a silently short
      // vault is indistinguishable from missing notes.
      if (truncated) sorted.truncated = { truncated, total };
      return sorted;
    }

    default:
      return [];
  }
}

export async function getNote(idToken, sourceId, id) {
  const { source, token, idToken: fsToken, owner } = await contextFor(idToken, sourceId);
  switch (source.id) {
    case "local":
      return local.getNote(fsToken, id);
    case "notion":
      return notion.getPage(token, id);
    case "trello":
      return trello.getCard(id);
    case "obsidian":
      return vault.getVaultNote(token, owner, id);
    default:
      throw new NoteError(`No adapter for ${source.id}.`);
  }
}

/* ---------------- writing ---------------- */

export async function createNote(idToken, sourceId, patch) {
  const { source, token, idToken: fsToken, owner } = await contextFor(idToken, sourceId);
  validatePatch(patch, { capabilities: source.capabilities, creating: true });

  switch (source.id) {
    case "local":
      return local.createNote(fsToken, patch);

    case "notion": {
      if (!patch.container) {
        throw new NoteError(
          "Notion needs a database to put the page in — pass container, from list_notebooks."
        );
      }
      const db = (await notion.listDatabases(token)).find((d) => d.id === patch.container);
      if (!db) {
        throw new NoteError(
          `No Notion database ${patch.container} is shared with this integration. Share it in Notion, then try again.`
        );
      }
      return notion.createPage(token, db.id, {
        title: patch.title,
        body: patch.body,
        tags: patch.tags,
        titleProp: db.titleProp,
        tagProp: db.tagProp,
      });
    }

    case "trello":
      return trello.createCard(patch.container, { title: patch.title, body: patch.body });

    case "obsidian":
      return vault.createVaultNote(token, owner, patch);

    default:
      throw new NoteError(`No adapter for ${source.id}.`);
  }
}

export async function updateNote(idToken, sourceId, id, patch) {
  const { source, token, idToken: fsToken, owner } = await contextFor(idToken, sourceId);
  validatePatch(patch, { capabilities: source.capabilities });

  switch (source.id) {
    case "local":
      return local.updateNote(fsToken, id, patch);

    case "notion": {
      // A page holding blocks this converter cannot rebuild is refused BEFORE
      // the write, because updating a body deletes every child first.
      const existing = await notion.getPage(token, id);
      notion.assertWritable(existing);
      const db = existing.container
        ? (await notion.listDatabases(token)).find((d) => d.id === existing.container)
        : null;
      return notion.updatePage(token, id, patch, { titleProp: db?.titleProp, tagProp: db?.tagProp });
    }

    case "trello":
      return trello.updateCard(id, patch);

    case "obsidian":
      return vault.updateVaultNote(token, owner, id, patch);

    default:
      throw new NoteError(`No adapter for ${source.id}.`);
  }
}

export async function deleteNote(idToken, sourceId, id) {
  const { source, token, idToken: fsToken, owner } = await contextFor(idToken, sourceId);
  switch (source.id) {
    case "local":
      return local.deleteNote(fsToken, id);
    case "notion":
      // Notion's API has no hard delete. Archiving IS deleting there, and it is
      // reversible — better than what it replaces, so it is not disguised.
      await notion.updatePage(token, id, { archived: true });
      return { deleted: id, note: "Notion archives rather than deletes; the page can be restored from its trash." };
    case "trello":
      return trello.deleteCard(id);
    case "obsidian":
      return vault.deleteVaultNote(token, owner, id);
    default:
      throw new NoteError(`No adapter for ${source.id}.`);
  }
}

/* ---------------- search ---------------- */

// Notion and Trello each have a real search endpoint and theirs is better than
// ours — it sees pages this integration can reach but has not listed. Local and
// Obsidian have none, so they are searched in memory with the shared scorer.
export async function search(idToken, sourceId, query, { limit = 50 } = {}) {
  const { source, token, idToken: fsToken, owner } = await contextFor(idToken, sourceId);

  switch (source.id) {
    case "notion":
      return (await notion.searchPages(token, query)).slice(0, limit);
    case "trello":
      return (await trello.searchCards(query)).slice(0, limit);
    case "local":
      return searchNotes(await local.listNotes(fsToken), query, { limit });
    case "obsidian": {
      const { notes } = await vault.listVaultNotes(token, owner, { withBodies: true });
      return searchNotes(notes, query, { limit });
    }
    default:
      return [];
  }
}

/* ---------------- what each place can do ---------------- */

export async function sourceStatus(idToken) {
  const out = [];
  for (const s of Object.values(NOTE_SOURCES)) {
    const row = {
      source: s.id,
      label: s.label,
      available: s.available,
      capabilities: s.capabilities,
      ...(s.limits ? { limits: s.limits } : {}),
      // How to get the credentials, carried through to the panel so an
      // unconfigured source is a route rather than a dead end.
      ...(s.setup ? { setup: s.setup } : {}),
    };

    if (!s.available) {
      out.push({ ...row, connected: false, detail: s.reason, alternative: s.alternative });
      continue;
    }
    if (!s.needsConnection) {
      out.push({ ...row, connected: true, detail: "Always available. Stored here, in Firestore." });
      continue;
    }

    try {
      await contextFor(idToken, s.id);
      out.push({ ...row, connected: true, detail: `${s.label} is connected.` });
    } catch (e) {
      out.push({ ...row, connected: false, detail: e?.message || `${s.label} is not connected.` });
    }
  }
  return { default: DEFAULT_SOURCE, sources: out };
}

export const capabilitiesOf = (sourceId) => getSource(sourceId).capabilities;
