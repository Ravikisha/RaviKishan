// Memory: what the agents have been taught, for the admin's Memory tab.
//
// Admin-gated, one route, an ALLOW-LIST of actions — the same shape as
// /api/orgs and /api/accounts, never a pass-through. It calls the same
// memoryStore.js the MCP tools use, so the panel and an AI client cannot drift.
//
// Scoped to the request's org like every route (withEnv runs the handler in the
// org the x-org-id header names): the panel sees this org's memories plus the
// global layer and nothing of any other org's, exactly as recall does.
import { verifyAdmin, AuthError } from "../../lib/server/verifyAdmin";
import { recordActivity } from "../../lib/server/activityLog.js";
import * as memory from "../../lib/server/memoryStore.js";
import { KIND_INFO, MemoryError } from "../../lib/server/memoryShape.js";
import { withEnv } from "../../lib/server/envStore";

const audit = (idToken, claims, action, target, detail = "") =>
  recordActivity(idToken, {
    action,
    source: "admin",
    target,
    detail,
    actor: { email: claims.email || "admin" },
  });

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    const claims = await verifyAdmin(req);
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const body = req.body || {};
    const { action } = body;
    res.setHeader("Cache-Control", "no-store");

    /* ---------------- reading ---------------- */

    if (action === "kinds") return res.status(200).json({ kinds: KIND_INFO });

    if (action === "list") {
      const out = await memory.listMemories(idToken, {
        layer: body.layer,
        kinds: body.kinds,
        tags: body.tags,
        includeArchived: body.includeArchived === true,
        limit: body.limit,
      });
      return res.status(200).json({ ...out, kinds: KIND_INFO });
    }

    if (action === "search") {
      return res.status(200).json(
        await memory.searchMemories(idToken, {
          query: body.query,
          layer: body.layer,
          kinds: body.kinds,
          tags: body.tags,
          includeArchived: body.includeArchived === true,
          limit: body.limit,
        })
      );
    }

    // What an agent would be handed for this task. It counts as a use, like
    // the MCP recall — the panel offers it as "what would an agent see?".
    if (action === "recall") {
      return res.status(200).json(await memory.recall(idToken, { task: body.task, limit: body.limit, kinds: body.kinds }));
    }

    if (action === "get") {
      return res.status(200).json({ memory: await memory.getMemory(idToken, body.id) });
    }

    /* ---------------- writing ---------------- */

    if (action === "remember") {
      const out = await memory.remember(idToken, {
        text: body.text,
        kind: body.kind,
        scope: body.scope,
        tags: body.tags,
        confidence: body.confidence === undefined ? 0.9 : body.confidence,
        supersedes: body.supersedes,
        // Written by hand in the admin: the most trustworthy source there is.
        source: "admin",
      });
      await audit(idToken, claims, `memory.${out.action === "created" ? "remember" : out.action}`, out.memory.id, out.memory.kind);
      return res.status(200).json(out);
    }

    if (action === "update") {
      const { action: _a, id, ...patch } = body;
      const out = await memory.updateMemory(idToken, id, patch);
      await audit(idToken, claims, "memory.update", out.memory.id, Object.keys(patch).join(","));
      return res.status(200).json(out);
    }

    if (action === "forget") {
      const out = await memory.forgetMemory(idToken, body.id, { confirm: body.confirm === true });
      await audit(idToken, claims, `memory.${out.action === "deleted" ? "delete" : "archive"}`, out.id);
      return res.status(200).json(out);
    }

    return res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (e instanceof MemoryError || (typeof e?.code === "string" && e.code.startsWith("org/"))) {
      return res.status(e.status || 400).json({ error: e.message, code: e.code, ...(e.kinds ? { kinds: e.kinds } : {}) });
    }
    return res.status(e.status || 500).json({ error: e.message || "That did not work." });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
