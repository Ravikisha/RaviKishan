// Passwords and API keys for the admin panel.
//
// The browser cannot seal or open a value itself — SECRETS_KEY lives only in
// the deployment environment, which is the whole point — so every read and
// write goes through here. Admin-gated, allow-list actions, and the reveal
// path is deliberately the narrowest thing in the file.
//
// Note what is NOT here: there is no action that returns more than one value.
// A bulk reveal would turn one mistaken call into a full credential dump, and
// nothing in the interface needs it.
import { verifyAdmin, AuthError } from "../../lib/server/verifyAdmin";
import {
  getDocument,
  listDocuments,
  createDocument,
  patchDocument,
  deleteDocument,
} from "../../lib/server/firestoreRest";
import * as store from "../../lib/server/secretStore";
import { withEnv } from "../../lib/server/envStore";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    const claims = await verifyAdmin(req);
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const { action } = req.body || {};
    // Never cached, by the service worker or anything else.
    res.setHeader("Cache-Control", "no-store");

    if (!store.isConfigured() && action !== "status") {
      return res.status(503).json({
        error: "The secret store is not configured on this deployment (missing SECRETS_KEY).",
        code: "secrets/not-configured",
      });
    }

    if (action === "status") {
      return res.status(200).json({ configured: store.isConfigured() });
    }

    if (action === "list") {
      const rows = await listDocuments(idToken, store.COLLECTION, { pageSize: 300 });
      const all = rows
        .map((r) => store.publicShape(r.__name || r.id || "", r))
        .sort((a, b) => a.name.localeCompare(b.name));
      return res.status(200).json({ secrets: all });
    }

    if (action === "reveal") {
      // THE one path that returns a plaintext value, and only ever one.
      //
      // Gated on a RECENT sign-in rather than just a valid session: the admin
      // is an installed app on a phone and Firebase keeps a session alive
      // indefinitely, so an unlocked phone should not equal reading every
      // password. `auth_time` does not move on a silent refresh, which is what
      // makes it a real check.
      const authTime = Number(claims.auth_time || 0);
      const age = Math.floor(Date.now() / 1000) - authTime;
      if (!authTime || age > 30 * 60) {
        return res.status(401).json({
          error: "Sign in again to reveal a secret — this needs a sign-in from the last 30 minutes.",
          code: "secrets/stale-auth",
        });
      }

      const id = store.assertName(req.body.name);
      const doc = await getDocument(idToken, `${store.COLLECTION}/${id}`).catch(() => null);
      const value = store.readValue(doc, { forAgent: false, name: req.body.name });

      await createDocument(idToken, "auditLog", null, {
        action: "secret.read",
        target: id,
        detail: "revealed in the admin",
        actor: claims.email || "admin",
        at: new Date().toISOString(),
      }).catch(() => {});
      await patchDocument(idToken, `${store.COLLECTION}/${id}`, {
        lastReadAt: new Date().toISOString(),
        lastReadBy: claims.email || "admin",
      }).catch(() => {});

      return res.status(200).json({ name: doc.name || id, value });
    }

    if (action === "save") {
      const { id, record } = store.buildRecord(req.body);
      const existing = await getDocument(idToken, `${store.COLLECTION}/${id}`).catch(() => null);
      if (existing) {
        // An edit with no new value must not blank the stored one.
        if (req.body.value === undefined || req.body.value === "") delete record.value;
        await patchDocument(idToken, `${store.COLLECTION}/${id}`, record);
      } else {
        await createDocument(idToken, store.COLLECTION, id, {
          ...record,
          createdAt: new Date().toISOString(),
        });
      }
      await createDocument(idToken, "auditLog", null, {
        action: existing ? "secret.update" : "secret.create",
        target: id,
        detail: `agentReadable=${record.agentReadable}`,
        actor: claims.email || "admin",
        at: new Date().toISOString(),
      }).catch(() => {});
      return res.status(200).json({ id, saved: true });
    }

    if (action === "delete") {
      const id = store.assertName(req.body.name);
      await deleteDocument(idToken, `${store.COLLECTION}/${id}`);
      await createDocument(idToken, "auditLog", null, {
        action: "secret.delete",
        target: id,
        detail: "deleted in the admin",
        actor: claims.email || "admin",
        at: new Date().toISOString(),
      }).catch(() => {});
      return res.status(200).json({ deleted: true, id });
    }

    return res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (e instanceof store.SecretError) {
      return res.status(e.status || 400).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: e.message || "That did not work." });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
