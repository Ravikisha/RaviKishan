// The authentication centre's API.
//
// One admin-gated route with an allow-list of actions, never a proxied path —
// the same rule as /api/social and /api/linkedin. It exists at all because the
// directory reads from TWO Firestore collections and the legacy single-account
// store, and a browser doing that itself would have to know which provider
// lives where, which is exactly the knowledge this release removes from every
// caller.
//
// What is deliberately NOT here: nothing starts or finishes an OAuth consent.
// That stays in /api/integrations/[provider]/{start,callback,claim}, because
// consent happens in a browser in front of the person whose account it is.
import { verifyAdmin, AuthError } from "../../lib/server/verifyAdmin";
import {
  createDocument,
  deleteDocument,
  getDocument,
  patchDocument,
} from "../../lib/server/firestoreRest";
import * as dir from "../../lib/server/accountDirectory";
import { accountPath } from "../../lib/server/connectedStore";
import { PROVIDERS, providerConfig } from "../../lib/server/integrations";
import * as secrets from "../../lib/server/secretStore";
import { withEnv } from "../../lib/server/envStore";

// Append-only, and never allowed to break the action it records — the same
// contract as lib/auditLog.js on the browser side.
const audit = (idToken, claims, action, target, detail = "") =>
  createDocument(idToken, "auditLog", null, {
    action,
    target,
    detail,
    actor: claims.email || "admin",
    at: new Date().toISOString(),
  }).catch(() => {});

const providerSummary = () =>
  Object.values(PROVIDERS).map((p) => {
    const cfg = providerConfig(p.id);
    return {
      id: p.id,
      label: p.label,
      configured: cfg.configured,
      missing: cfg.missing,
      borrowed: cfg.borrowed || "",
      services: dir.servicesFor(p.id).map((s) => s.id),
      scopes: p.scopes || [],
    };
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

    /* ---------------- reading ---------------- */

    if (action === "list") {
      const [accounts, identities, defaults] = await Promise.all([
        dir.allAccounts(idToken),
        dir.listIdentities(idToken),
        dir.readDefaults(idToken),
      ]);
      return res.status(200).json({
        accounts: accounts.map((a) => ({
          ...a,
          // Computed here rather than in the panel so the API and the MCP
          // tools cannot disagree about whether a connection is complete.
          missingScopes: dir.missingScopes(a).map(dir.shortScope),
        })),
        identities,
        defaults,
        services: Object.values(dir.SERVICES),
        providers: providerSummary(),
        secretsConfigured: secrets.isConfigured(),
      });
    }

    // Which account would act, and WHY that one. The panel shows this beside
    // each service so the resolution rule is visible before it matters rather
    // than after something was posted by the wrong account.
    if (action === "resolve") {
      try {
        const account = await dir.resolveAccount(idToken, {
          service: req.body.service,
          provider: req.body.provider,
          accountId: req.body.accountId,
        });
        return res.status(200).json({ ok: true, account });
      } catch (e) {
        return res.status(200).json({ ok: false, error: e.message, code: e.code || "" });
      }
    }

    /* ---------------- defaults ---------------- */

    if (action === "setDefault") {
      const out = await dir.writeDefault(idToken, req.body.service, req.body.key);
      await audit(idToken, claims, "account.default", `${out.service}=${out.key}`);
      return res.status(200).json(out);
    }

    /* ---------------- identities ---------------- */

    if (action === "createIdentity") {
      const label = String(req.body.label || "").trim();
      if (!label) return res.status(400).json({ error: "An identity needs a name." });
      const id =
        String(req.body.id || label)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40) || `identity-${Date.now()}`;
      const record = {
        label,
        email: String(req.body.email || ""),
        note: String(req.body.note || ""),
        createdAt: new Date().toISOString(),
      };
      // createDocument refuses an id that already exists, which is what makes
      // "add" and "rename" different operations rather than one that can
      // silently overwrite somebody's grouping.
      await createDocument(idToken, dir.IDENTITIES, id, record).catch(async (e) => {
        if (/already exists/i.test(e.message || "")) {
          await patchDocument(idToken, `${dir.IDENTITIES}/${id}`, record);
          return;
        }
        throw e;
      });
      return res.status(200).json({ id, ...record });
    }

    if (action === "deleteIdentity") {
      const id = String(req.body.id || "");
      if (!id) return res.status(400).json({ error: "Which identity?" });
      await deleteDocument(idToken, `${dir.IDENTITIES}/${id}`);
      return res.status(200).json({ deleted: id });
    }

    // Put an account under an identity. Only the per-account store can hold
    // this — a legacy row has no document of its own to write it on, which is
    // one more reason to reconnect it.
    if (action === "assign") {
      const { provider, accountId, identityId } = req.body;
      if (!provider || !accountId) {
        return res.status(400).json({ error: "Name the provider and the account." });
      }
      await patchDocument(idToken, accountPath(provider, accountId), {
        identityId: String(identityId || ""),
      });
      return res.status(200).json({ provider, accountId, identityId: identityId || "" });
    }

    /* ---------------- forgetting ---------------- */

    if (action === "forget") {
      const { provider, accountId } = req.body;
      if (!provider || !accountId) {
        return res.status(400).json({ error: "Name the provider and the account." });
      }
      await deleteDocument(idToken, accountPath(provider, accountId));
      await audit(idToken, claims, "account.disconnect", `${provider}:${accountId}`);
      // The credential is gone from here; the grant is still live at the
      // provider until it is revoked there, and saying so is the difference
      // between "disconnected" and "revoked".
      return res.status(200).json({
        forgotten: `${provider}__${accountId}`,
        note: "The stored credential is deleted. The app may still appear in that account's connected-apps list until you remove it there.",
      });
    }

    /* ---------------- saved sign-ins ---------------- *
     *
     * A password is NOT a connection. It cannot be used to call an API, and
     * nothing here ever signs in with it — it is kept so the owner has it
     * when a provider asks for it by hand, and it is sealed by the same
     * secret store as every other credential, with the same agentReadable
     * flag defaulting to off.
     */

    if (action === "saveLogin") {
      if (!secrets.isConfigured()) {
        return res.status(503).json({
          error: "Sign-ins cannot be saved until SECRETS_KEY is set on this deployment.",
          code: "secrets/not-configured",
        });
      }
      const { provider, accountId, username, password, notes, url, agentReadable } = req.body;
      if (!provider || !accountId) {
        return res.status(400).json({ error: "Name the provider and the account." });
      }
      if (!username) return res.status(400).json({ error: "A sign-in needs a username or address." });
      const name = secrets.loginSecretName(provider, accountId);
      const { id, record } = secrets.buildRecord({
        name,
        value: password === undefined ? undefined : String(password),
        kind: "password",
        username: String(username),
        url: url ? String(url) : "",
        notes: notes ? String(notes) : "",
        tags: ["login", String(provider)],
        agentReadable: agentReadable === true,
        provider,
        accountId,
      });
      const existing = await getDocument(idToken, `${secrets.COLLECTION}/${id}`).catch(() => null);
      if (existing) {
        await patchDocument(idToken, `${secrets.COLLECTION}/${id}`, record);
      } else {
        await createDocument(idToken, secrets.COLLECTION, id, {
          ...record,
          createdAt: new Date().toISOString(),
        });
      }
      await audit(idToken, claims, "account.login.save", `${provider}:${accountId}`, "sign-in saved");
      // The value is never echoed back, not even the one just supplied.
      return res.status(200).json({ saved: id, name });
    }

    if (action === "forgetLogin") {
      const { provider, accountId } = req.body;
      if (!provider || !accountId) {
        return res.status(400).json({ error: "Name the provider and the account." });
      }
      const id = secrets.loginSecretName(provider, accountId);
      await deleteDocument(idToken, `${secrets.COLLECTION}/${id}`);
      return res.status(200).json({ deleted: id });
    }

    return res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (e instanceof dir.ConnectedAuthError) {
      return res.status(409).json({ error: e.message, code: e.code || "" });
    }
    return res.status(e.status || 500).json({ error: e.message || "That did not work." });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
