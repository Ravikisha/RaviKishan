// BROWSER. The Notes panel's client.
//
// Everything goes through /api/notes, which is admin-gated and talks to the
// same noteBoard.js the MCP tools use — see that route for why this is not a
// direct call to each service (Trello's credential would end up in the browser,
// and Notion sends no CORS headers at all).
//
// Through adminFetch, so the org header travels. Trello and the Obsidian vault
// are deployment-held logins that belong to Relax, and the server refuses them
// in any other org with a sentence saying so.
import { adminJson } from "./adminFetch";

export const SOURCES = [
  { id: "local", label: "Notes here", short: "Here" },
  { id: "notion", label: "Notion", short: "Notion" },
  { id: "trello", label: "Trello", short: "Trello" },
  { id: "obsidian", label: "Obsidian", short: "Obsidian" },
  // Listed so the panel can SAY why, rather than leaving a gap where a reader
  // would reasonably expect it.
  { id: "keep", label: "Google Keep", short: "Keep", unavailable: true },
];

export const sourceLabel = (id) => SOURCES.find((s) => s.id === id)?.label || id;

const call = (action, body = {}) => adminJson("/api/notes", { action, ...body });

export const listSources = () => call("sources");
export const listNotebooks = (source) => call("notebooks", { source }).then((j) => j.notebooks);
export const listNotes = (source, opts = {}) => call("list", { source, ...opts });
export const getNote = (source, id) => call("get", { source, id }).then((j) => j.note);
export const createNote = (source, patch) => call("create", { source, patch }).then((j) => j.note);
export const updateNote = (source, id, patch) => call("update", { source, id, patch }).then((j) => j.note);
export const deleteNote = (source, id) => call("delete", { source, id });
export const searchNotes = (source, query) => call("search", { source, query }).then((j) => j.notes);

// Re-exported from the one pure module so the panel's excerpt and the tools'
// excerpt are the same function — the duplication trap the GitHub audit fell
// into, and the reason postText.js exists.
export { excerptOf, sortNotes } from "./server/noteShape";
