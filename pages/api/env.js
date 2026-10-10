// Environment variables for the admin panel.
//
// Admin-gated, allow-list actions. There is no action that returns the VALUE
// of anything: presence, source and a masked hint are all the panel needs, and
// a read is the part that leaks.
//
// Every variable lives in the database (lib/server/envStore.js); ENV_KEY is the
// one that stays in the deployment. Routing and the keyring rules live in
// lib/server/envWrite.js, shared with the MCP tools.
import { verifyAdmin, AuthError } from "../../lib/server/verifyAdmin";
import { recordActivity } from "../../lib/server/activityLog.js";
import { createDocument } from "../../lib/server/firestoreRest";
import * as reg from "../../lib/server/envRegistry";
import { withEnv } from "../../lib/server/envStore";
import { currentOrg } from "../../lib/server/orgContext";
import { assertDeploymentScope, deploymentScopedFamily } from "../../lib/server/orgShape";
import { envStatus, importEnv, removeEnv, writeEnv } from "../../lib/server/envWrite";

// One shape for every entry, defined in lib/server/activityLog.js. This used
// to be a local copy in each of three routes, and all three wrote `actor`
// where the browser wrote `email` — so the activity summary attributed every
// env, secret and account change to "unknown".
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
    const { action } = req.body || {};
    res.setHeader("Cache-Control", "no-store");
    const opts = { by: claims.email || "admin", via: "admin", claims };

    if (action === "status") {
      return res.status(200).json(await envStatus(idToken));
    }

    // Every write below changes the deployment's environment, which holds
    // Relax's logins (orgShape.DEPLOYMENT_SCOPED "env"). Reading the status is
    // fine anywhere; changing it is done from Relax.
    if (action === "set" || action === "delete" || action === "import") {
      assertDeploymentScope(deploymentScopedFamily("env"), currentOrg());
    }

    if (action === "set") {
      const out = await writeEnv(idToken, req.body.key, String(req.body.value ?? ""), opts);
      await audit(idToken, claims, "env.set", out.key, `${out.where}, in the admin`);
      return res.status(200).json(out);
    }

    if (action === "delete") {
      const out = await removeEnv(idToken, req.body.key, opts);
      await audit(idToken, claims, "env.delete", out.key, "in the admin");
      return res.status(200).json(out);
    }

    if (action === "import") {
      const out = await importEnv(idToken, String(req.body.text || ""), opts);
      await audit(
        idToken,
        claims,
        "env.import",
        `${out.imported} keys`,
        [...out.created, ...out.updated, ...out.settings].join(", ").slice(0, 300)
      );
      return res.status(200).json(out);
    }

    return res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (typeof e?.code === "string" && e.code.startsWith("org/")) {
      return res.status(e.status || 403).json({ error: e.message, code: e.code });
    }
    if (e instanceof reg.EnvError) {
      return res.status(e.status || 400).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: e.message || "That did not work." });
  }
}

export default withEnv(handler);
