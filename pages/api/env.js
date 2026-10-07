// Environment variables for the admin panel.
//
// Admin-gated, allow-list actions. Note what is absent: there is no action
// that returns the VALUE of anything. Presence, class, and a masked hint are
// all the panel needs, and a read is the part that leaks.
import { verifyAdmin, AuthError } from "../../lib/server/verifyAdmin";
import { createDocument } from "../../lib/server/firestoreRest";
import * as reg from "../../lib/server/envRegistry";
import * as vercel from "../../lib/server/vercelEnv";
import * as runtime from "../../lib/server/runtimeConfig";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    const claims = await verifyAdmin(req);
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const { action } = req.body || {};
    res.setHeader("Cache-Control", "no-store");

    if (action === "status") {
      const stored = await runtime.readAll(idToken).catch(() => ({}));
      const audit = reg.auditEnv();
      // A runtime variable's real state is the stored value, which the process
      // environment does not know about — so the audit row is corrected here
      // rather than reporting it as missing.
      const rows = audit.rows.map((r) =>
        r.cls === "runtime"
          ? {
              ...r,
              present: !!runtime.resolve(r.key, stored),
              hint: runtime.resolve(r.key, stored),
              stored: stored[r.key] ?? null,
              source: stored[r.key] ? "stored" : process.env[r.key] ? "environment" : "default",
            }
          : r
      );
      return res.status(200).json({
        rows,
        missingRequired: rows.filter((r) => r.missing).map((r) => r.key),
        counts: audit.counts,
        vercel: { configured: vercel.isConfigured() },
        redeployNote: vercel.REDEPLOY_NOTE,
      });
    }

    if (action === "listVercel") {
      if (!vercel.isConfigured()) return res.status(200).json({ configured: false, vars: [] });
      const rows = await vercel.listEnv();
      return res.status(200).json({
        configured: true,
        vars: rows.map((r) => ({ ...r, cls: reg.classify(r.key) })),
      });
    }

    if (action === "set") {
      // Refused before any network call, so a critical key never leaves here.
      const key = reg.assertManageable(req.body.key, { action: "change" });
      const cls = reg.classify(key);
      const out =
        cls === "runtime"
          ? await runtime.setValue(idToken, key, String(req.body.value ?? ""))
          : await vercel.setEnv(key, String(req.body.value ?? ""), {
              targets: req.body.target,
              comment: req.body.comment,
            });
      await createDocument(idToken, "auditLog", null, {
        action: "env.set",
        target: key,
        detail: `class=${cls}, in the admin`,
        actor: claims.email || "admin",
        at: new Date().toISOString(),
      }).catch(() => {});
      return res.status(200).json({ ...out, cls });
    }

    if (action === "delete") {
      const key = reg.assertManageable(req.body.key, { action: "delete" });
      const cls = reg.classify(key);
      const out =
        cls === "runtime"
          ? await runtime.removeValue(idToken, key)
          : await vercel.deleteEnv(key, { targets: req.body.target });
      await createDocument(idToken, "auditLog", null, {
        action: "env.delete",
        target: key,
        detail: `class=${cls}, in the admin`,
        actor: claims.email || "admin",
        at: new Date().toISOString(),
      }).catch(() => {});
      return res.status(200).json({ ...out, cls });
    }

    return res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (e instanceof reg.EnvError || e instanceof vercel.VercelError) {
      return res.status(e.status || 400).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: e.message || "That did not work." });
  }
}
