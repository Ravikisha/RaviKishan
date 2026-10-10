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
import { recordActivity } from "../../lib/server/activityLog.js";
import {
  getDocument,
  listDocuments,
  createDocument,
  patchDocument,
  deleteDocument,
} from "../../lib/server/firestoreRest";
import * as store from "../../lib/server/secretStore";
import { secretVisible, signInMembership } from "../../lib/server/accountDirectory";
import { withEnv } from "../../lib/server/envStore";
import { currentOrg, ensureOrgKnown } from "../../lib/server/orgContext";

// Secrets are filed per org (secretStore.secretOrg) — except a saved sign-in,
// which follows its account's membership (secretStore.secretVisibleIn). Every
// action below asks that one rule. A secret not visible here answers exactly
// like one that does not exist — this route must not become
// a way to confirm what another org holds.
const notHere = (name, org) =>
  new store.SecretError(`No secret named "${name}" in ${org}.`, { status: 404 });

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
      return res.status(200).json({ configured: store.isConfigured(), orgId: currentOrg() });
    }

    // Refuse an org that does not exist before anything is read or written.
    await ensureOrgKnown(idToken);
    const org = currentOrg();

    if (action === "list") {
      const [rows, membership] = await Promise.all([
        listDocuments(idToken, store.COLLECTION, { pageSize: 300 }),
        signInMembership(idToken, { org }),
      ]);
      const all = rows
        .filter((r) => store.secretVisibleIn(r, org, membership))
        .map((r) => store.publicShape(r.__name || r.id || "", r))
        .sort((a, b) => a.name.localeCompare(b.name));
      return res.status(200).json({ secrets: all, orgId: org });
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
      const visible = await secretVisible(idToken, doc, { org });
      const value = store.readValue(doc, { forAgent: false, name: req.body.name, org, visible });

      await recordActivity(idToken, {
        action: "secret.read",
        source: "admin",
        target: id,
        detail: "revealed in the admin",
        actor: { email: claims.email || "admin" },
      });
      await patchDocument(idToken, `${store.COLLECTION}/${id}`, {
        lastReadAt: new Date().toISOString(),
        lastReadBy: claims.email || "admin",
      }).catch(() => {});

      return res.status(200).json({ name: doc.name || id, value });
    }

    if (action === "save") {
      const { id, record } = store.buildRecord({ ...req.body, orgId: org });
      const existing = await getDocument(idToken, `${store.COLLECTION}/${id}`).catch(() => null);
      // Names are one namespace across orgs (the document id is the name), so
      // a name another org already uses is refused rather than overwritten —
      // and refused without saying whose it is.
      if (existing && !(await secretVisible(idToken, existing, { org }))) {
        return res.status(409).json({
          error: `The name "${req.body.name}" is already used by a secret outside ${org}. Choose another name.`,
          code: "secrets/name-taken",
        });
      }
      if (existing) {
        // An edit with no new value must not blank the stored one.
        if (req.body.value === undefined || req.body.value === "") delete record.value;
        // An edit does not move a secret between orgs.
        delete record.orgId;
        // Nor does an edit that names no account detach a sign-in from its
        // account — that would silently re-file it under the editing org.
        if (!record.provider) delete record.provider;
        if (!record.accountId) delete record.accountId;
        await patchDocument(idToken, `${store.COLLECTION}/${id}`, record);
      } else {
        await createDocument(idToken, store.COLLECTION, id, {
          ...record,
          createdAt: new Date().toISOString(),
        });
      }
      await recordActivity(idToken, {
        action: existing ? "secret.update" : "secret.create",
        source: "admin",
        target: id,
        detail: `agentReadable=${record.agentReadable}`,
        actor: { email: claims.email || "admin" },
      });
      return res.status(200).json({ id, saved: true });
    }

    if (action === "delete") {
      const id = store.assertName(req.body.name);
      const doc = await getDocument(idToken, `${store.COLLECTION}/${id}`).catch(() => null);
      if (doc && !(await secretVisible(idToken, doc, { org }))) throw notHere(req.body.name, org);
      await deleteDocument(idToken, `${store.COLLECTION}/${id}`);
      await recordActivity(idToken, {
        action: "secret.delete",
        source: "admin",
        target: id,
        detail: "deleted in the admin",
        actor: { email: claims.email || "admin" },
      });
      return res.status(200).json({ deleted: true, id });
    }

    return res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (e instanceof store.SecretError) {
      return res.status(e.status || 400).json({ error: e.message, code: e.code });
    }
    if (typeof e?.code === "string" && e.code.startsWith("org/")) {
      return res.status(e.status || 400).json({ error: e.message, code: e.code });
    }
    return res.status(500).json({ error: e.message || "That did not work." });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
