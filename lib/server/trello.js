// SERVER ONLY. Trello as a note source.
//
// A Trello card is a note with a name and a description, so the mapping is the
// cleanest of the four — but two things do NOT map, and both are declared in
// noteSources.js rather than discovered at save time:
//
//   LABELS ARE NOT TAGS. A Trello label is a board-scoped object with an id and
//   a colour. Writing an arbitrary tag would mean creating a label on the board,
//   which is a bigger act than tagging a note and would litter the board for
//   everyone else on it. So labels are READ as tags and never written.
//
//   LISTS ARE NOT FOLDERS. A card lives in a list on exactly one board, so
//   "move to another notebook" means choosing a list, and crossing boards means
//   choosing a list on the other board.
//
// Auth is an API key plus a user token, NOT OAuth. Trello's OAuth is 1.0a,
// which does not fit a registry built entirely around the OAuth 2.0 code flow,
// and a user-generated token never expires — so bending the registry around it
// would make every other provider carry the cost for no benefit.
import { shapeNote, toIso } from "./noteShape.js";

const API = "https://api.trello.com/1";

export class TrelloError extends Error {}

export const isTrelloConfigured = () => !!(process.env.TRELLO_API_KEY && process.env.TRELLO_TOKEN);

function creds() {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) {
    const e = new TrelloError(
      "Trello is not configured on this deployment (missing TRELLO_API_KEY and/or TRELLO_TOKEN)."
    );
    e.code = "trello/not-configured";
    throw e;
  }
  return { key, token };
}

async function call(path, { method = "GET", query = {} } = {}) {
  const { key, token } = creds();
  // The credentials ride in the query string because that is the only thing
  // Trello accepts — which is also why this must never be called from the
  // browser: the URL would carry a bearer credential into history and logs.
  const q = new URLSearchParams({ ...query, key, token });
  const res = await fetch(`${API}${path}?${q}`, { method });

  if (res.status === 401) {
    throw new TrelloError(
      "Trello rejected the key or token. Regenerate the token at trello.com/power-ups/admin and update TRELLO_TOKEN."
    );
  }
  if (res.status === 404) {
    throw new TrelloError("Trello answered 404 — that board, list or card does not exist, or this token cannot see it.");
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.text()) || msg;
    } catch (_) {}
    throw new TrelloError(`Trello: ${String(msg).slice(0, 200)}`);
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

/* ---------------- boards and lists ---------------- */

export async function listBoards() {
  const boards = await call("/members/me/boards", {
    query: { fields: "name,url,closed", filter: "open" },
  });
  return (boards || [])
    .filter((b) => !b.closed)
    .map((b) => ({ id: b.id, name: b.name, url: b.url || "" }));
}

// The containers a note can sit in: every open list across every open board,
// named "Board / List" because a bare "To do" is ambiguous across five boards.
export async function listContainers() {
  const boards = await listBoards();
  const out = [];
  for (const b of boards) {
    const lists = await call(`/boards/${b.id}/lists`, { query: { fields: "name,closed" } });
    for (const l of (lists || []).filter((x) => !x.closed)) {
      out.push({ id: l.id, name: `${b.name} / ${l.name}`, board: b.id, boardName: b.name, list: l.name });
    }
  }
  return out;
}

/* ---------------- cards as notes ---------------- */

const cardToNote = (c, containerName = "") =>
  shapeNote(
    {
      id: c.id,
      title: c.name,
      body: c.desc || "",
      // Read-only on purpose; see the header.
      tags: (c.labels || []).map((l) => l.name || l.color).filter(Boolean),
      container: c.idList,
      containerName,
      archived: !!c.closed,
      createdAt: c.id ? toIso(new Date(parseInt(String(c.id).slice(0, 8), 16) * 1000)) : "",
      updatedAt: toIso(c.dateLastActivity),
      url: c.shortUrl || c.url || "",
    },
    { source: "trello" }
  );

// A Trello card id encodes its creation time in its first 8 hex characters,
// the same as a Mongo ObjectId. There is no createdAt field on a card, and a
// note list with no creation date is worse than one derived from the id.
export const createdFromCardId = (id) =>
  toIso(new Date(parseInt(String(id).slice(0, 8), 16) * 1000));

export async function listCards({ listId, boardId } = {}) {
  const fields = "name,desc,closed,idList,dateLastActivity,shortUrl,labels";
  if (listId) {
    const cards = await call(`/lists/${listId}/cards`, { query: { fields } });
    return (cards || []).map((c) => cardToNote(c));
  }

  const containers = await listContainers();
  const byList = new Map(containers.map((c) => [c.id, c.name]));
  const boards = boardId ? [{ id: boardId }] : await listBoards();

  const out = [];
  for (const b of boards) {
    const cards = await call(`/boards/${b.id}/cards`, { query: { fields, filter: "all" } });
    for (const c of cards || []) out.push(cardToNote(c, byList.get(c.idList) || ""));
  }
  return out;
}

export async function getCard(cardId) {
  const c = await call(`/cards/${cardId}`, {
    query: { fields: "name,desc,closed,idList,dateLastActivity,shortUrl,labels" },
  });
  return cardToNote(c);
}

export async function createCard(listId, { title, body } = {}) {
  if (!listId) throw new TrelloError("Trello needs a list to put the card in — pass a container id.");
  const c = await call("/cards", {
    method: "POST",
    query: { idList: listId, name: title || "Untitled", desc: body || "" },
  });
  return cardToNote(c);
}

export async function updateCard(cardId, patch) {
  const query = {};
  if (patch.title !== undefined) query.name = String(patch.title);
  if (patch.body !== undefined) query.desc = String(patch.body);
  if (patch.archived !== undefined) query.closed = patch.archived ? "true" : "false";
  if (patch.container !== undefined) query.idList = String(patch.container);
  if (!Object.keys(query).length) throw new TrelloError("Nothing to change on that card.");
  const c = await call(`/cards/${cardId}`, { method: "PUT", query });
  return cardToNote(c);
}

// Trello's DELETE is a hard delete with no undo, unlike archiving — which is
// why the tool layer asks for confirmation and offers archive first.
export async function deleteCard(cardId) {
  await call(`/cards/${cardId}`, { method: "DELETE" });
  return { deleted: cardId };
}

export async function searchCards(query) {
  const d = await call("/search", {
    query: { query, modelTypes: "cards", card_fields: "name,desc,closed,idList,dateLastActivity,shortUrl,labels", cards_limit: "50" },
  });
  return (d?.cards || []).map((c) => cardToNote(c));
}
