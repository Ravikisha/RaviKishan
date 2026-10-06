// The admin panel's one door to every note source.
//
// Unlike Tasks and GitHub — where the panel holds a short-lived provider token
// and calls the service directly — notes go through the server. Two reasons,
// and either on its own would be enough:
//
//   Trello authenticates with an API key and a user token in the QUERY STRING.
//   Handing those to the browser would put a non-expiring credential for every
//   board into history, into referrers and into any logging proxy on the way.
//
//   Notion's API sends no CORS headers at all, so a browser request to
//   api.notion.com is blocked before it is made. There is no browser-side
//   option to choose.
//
// So one route, admin-gated, with the action named in the body. Everything it
// does goes through noteBoard.js, which is the same module the MCP tools use —
// the panel and an AI client cannot drift apart because there is nothing to
// drift.
import { verifyAdmin, AuthError } from "../../lib/server/verifyAdmin";
import * as notes from "../../lib/server/noteBoard";
import { NoteError } from "../../lib/server/noteShape";

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

const ACTIONS = new Set([
  "sources",
  "notebooks",
  "list",
  "get",
  "create",
  "update",
  "delete",
  "search",
]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    await verifyAdmin(req);
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

    const { action, source, id, patch, query, notebook, withBodies, includeArchived } = req.body || {};
    if (!ACTIONS.has(action)) {
      return res.status(400).json({
        error: `Unknown action "${action}". Known actions: ${[...ACTIONS].join(", ")}.`,
      });
    }

    // A credential, not content.
    res.setHeader("Cache-Control", "no-store");

    switch (action) {
      case "sources":
        return res.status(200).json(await notes.sourceStatus(idToken));

      case "notebooks":
        return res.status(200).json({ notebooks: await notes.listContainers(idToken, source) });

      case "list": {
        const rows = await notes.listNotes(idToken, source, {
          container: notebook,
          withBodies: !!withBodies,
          includeArchived: includeArchived !== false,
        });
        return res.status(200).json({
          notes: [...rows],
          ...(rows.truncated ? { truncated: rows.truncated } : {}),
        });
      }

      case "get":
        return res.status(200).json({ note: await notes.getNote(idToken, source, id) });

      case "create":
        return res.status(200).json({ note: await notes.createNote(idToken, source, patch || {}) });

      case "update":
        return res.status(200).json({ note: await notes.updateNote(idToken, source, id, patch || {}) });

      case "delete":
        return res.status(200).json(await notes.deleteNote(idToken, source, id));

      case "search":
        return res.status(200).json({ notes: await notes.search(idToken, source, query) });

      default:
        return res.status(400).json({ error: "Unknown action." });
    }
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    // A source that cannot work, a note that breaks a rule, a missing
    // connection — all of these carry a sentence worth showing, so they are
    // passed through rather than flattened into "500".
    if (e instanceof NoteError) return res.status(400).json({ error: e.message });
    return res
      .status(e.status || 500)
      .json({ error: e.message || "That did not work.", code: e.code || "" });
  }
}
