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
//
// Every action acts INSIDE the org named by the x-org-id header (withEnv lays
// it down): the list is that org's accounts, defaults and people, and any
// action naming an account refuses one that is not a member of it.
import { verifyAdmin, AuthError } from "../../lib/server/verifyAdmin";
import { recordActivity } from "../../lib/server/activityLog.js";
import {
  createDocument,
  deleteDocument,
  getDocument,
  patchDocument,
} from "../../lib/server/firestoreRest";
import * as dir from "../../lib/server/accountDirectory";
import { accountPath, connectedRecord, readAccount } from "../../lib/server/connectedStore";
import { PROVIDERS, providerConfig, getProvider, seal, isSealConfigured } from "../../lib/server/integrations";
import { parseKey, identify, KeyError } from "../../lib/server/mlKeys";
import * as secrets from "../../lib/server/secretStore";
import { withEnv } from "../../lib/server/envStore";
import { currentOrg, ensureOrgKnown, orgSource } from "../../lib/server/orgContext";
import { orgIdsOf, unionOrgs, withIdentity } from "../../lib/server/orgShape";
import { forgetFromOrg } from "../../lib/server/orgStore";

// Append-only, and never allowed to break the action it records — the same
// contract as lib/auditLog.js on the browser side.
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
      auth: p.auth || "oauth",
      keyHint: p.keyHint || "",
      tokenPage: p.tokenPage || "",
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
    // An org that does not exist is refused here, once, rather than looking
    // like an org with nothing connected.
    await ensureOrgKnown(idToken);
    const org = currentOrg();

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
        // Which org this answer is for, and whether anybody asked for it.
        orgId: org,
        orgSource: orgSource(),
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
        // Filed under the org it was made in: Acme's people are not Relax's.
        orgId: org,
        createdAt: new Date().toISOString(),
      };
      // createDocument refuses an id that already exists, which is what makes
      // "add" and "rename" different operations rather than one that can
      // silently overwrite somebody's grouping.
      await createDocument(idToken, dir.IDENTITIES, id, record).catch(async (e) => {
        if (/already exists/i.test(e.message || "")) {
          // Ids are one namespace across orgs. Editing another org's person
          // from here would quietly move them, so it is refused instead.
          const existing = await getDocument(idToken, `${dir.IDENTITIES}/${id}`).catch(() => null);
          if (existing && dir.identityOrg(existing) !== org) {
            const err = new Error(`The identity id "${id}" is already used in another org. Give this one a different name.`);
            err.status = 409;
            throw err;
          }
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
      const existing = await getDocument(idToken, `${dir.IDENTITIES}/${id}`).catch(() => null);
      if (existing && dir.identityOrg(existing) !== org) {
        return res.status(404).json({ error: `No identity "${id}" in ${org}.` });
      }
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
      // Both halves must be in this org: the account, and the person it is
      // being filed under.
      await dir.assertAccountInOrg(idToken, provider, accountId, { org });
      if (identityId) {
        const person = await getDocument(idToken, `${dir.IDENTITIES}/${identityId}`).catch(() => null);
        if (!person || dir.identityOrg(person) !== org) {
          return res.status(404).json({ error: `No identity "${identityId}" in ${org}.` });
        }
      }
      // Per org: a shared account can sit under a different person in each
      // org, so only this org's entry of the map changes (orgShape.identityIdIn).
      const current = await readAccount(idToken, provider, accountId, { org });
      if (!current) {
        return res.status(409).json({ error: "A legacy connection cannot be filed under a person. Reconnect it first." });
      }
      await patchDocument(idToken, accountPath(provider, accountId), {
        identityIds: withIdentity(current, org, String(identityId || "")),
      });
      return res.status(200).json({ provider, accountId, identityId: identityId || "" });
    }

    /* ---------------- forgetting ---------------- */

    if (action === "forget") {
      const { provider, accountId } = req.body;
      if (!provider || !accountId) {
        return res.status(400).json({ error: "Name the provider and the account." });
      }
      // Per org: orgStore.forgetFromOrg removes this org from the account and
      // deletes the credential only when no org is left using it.
      const out = await forgetFromOrg(idToken, provider, accountId, { org });
      if (!out.remaining) {
        // No per-account document. `legacy` says whether the name is this
        // org's legacy connection, which the browser removes itself.
        return res.status(200).json(out);
      }
      const { deleted, remaining } = out;
      await audit(
        idToken,
        claims,
        "account.disconnect",
        `${provider}:${accountId}`,
        deleted ? `deleted (last org: ${org})` : `removed from ${org}; still in ${remaining.join(", ")}`
      );
      // The credential is gone from here; the grant is still live at the
      // provider until it is revoked there, and saying so is the difference
      // between "disconnected" and "revoked".
      return res.status(200).json({
        ...out,
        note: deleted
          ? "The stored credential is deleted. The app may still appear in that account's connected-apps list until you remove it there."
          : `Removed from ${org} only. The credential stays, because ${remaining.join(", ")} still use${remaining.length === 1 ? "s" : ""} it.`,
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
      // A sign-in belongs to an account, so it can only be saved against an
      // account this org can see.
      await dir.assertAccountInOrg(idToken, provider, accountId, { org });
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
        orgId: org,
      });
      const existing = await getDocument(idToken, `${secrets.COLLECTION}/${id}`).catch(() => null);
      // The same rule every reader asks (secretStore.secretVisibleIn): an org
      // may only overwrite a sign-in it could also read. A record under this
      // name that belongs elsewhere — another account whose id slugs the same,
      // or a secret this org cannot see — is refused, never overwritten.
      if (existing && !(await dir.secretVisible(idToken, existing, { org }))) {
        return res.status(409).json({
          error: `A secret named "${name}" already exists outside ${org}. It was not changed.`,
          code: "secrets/name-taken",
        });
      }
      if (existing) {
        // Re-saving does not re-file it: the sign-in follows its account,
        // which may be shared, so whichever org first saved it keeps the record.
        delete record.orgId;
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
      await dir.assertAccountInOrg(idToken, provider, accountId, { org });
      const id = secrets.loginSecretName(provider, accountId);
      // Load before deleting: a record this org could not read is not this
      // org's to delete, and answers like one that is not there.
      const existing = await getDocument(idToken, `${secrets.COLLECTION}/${id}`).catch(() => null);
      // Nothing saved is a no-op, as it always was.
      if (!existing) return res.status(200).json({ deleted: id, existed: false });
      if (!(await dir.secretVisible(idToken, existing, { org }))) {
        return res.status(404).json({ error: `No sign-in is saved for ${provider} account "${accountId}" in ${org}.` });
      }
      await deleteDocument(idToken, `${secrets.COLLECTION}/${id}`);
      await audit(idToken, claims, "account.login.forget", `${provider}:${accountId}`, "sign-in deleted");
      return res.status(200).json({ deleted: id });
    }

    /*
     * Pasted-token accounts (Hugging Face, Kaggle). The key is checked with
     * the provider FIRST — the account id comes from the provider's answer,
     * never from the form — then sealed and written as the admin. Nothing
     * about the key is echoed back or written to the audit log.
     */
    if (action === "connectKey") {
      const p = getProvider(req.body.provider);
      if (p.auth !== "apiKey") {
        return res.status(400).json({ error: `${p.label} connects through its consent screen, not a pasted token.` });
      }
      if (!isSealConfigured()) {
        return res.status(503).json({
          error: "Tokens cannot be stored until INTEGRATION_SECRET is set.",
          code: "integrations/not-configured",
        });
      }
      const cred = parseKey(p.id, req.body.key);
      const who = await identify(p.id, cred);
      const path = accountPath(p.id, who.accountId);
      const existing = await getDocument(idToken, path).catch(() => null);
      const record = connectedRecord({
        provider: p.id,
        accountId: who.accountId,
        label: who.label,
        sealed: seal({ accessToken: cred.accessToken }, "refresh"),
        kind: "access",
        expiresAt: "",
        scope: who.scope,
        email: who.email,
        identityId: existing?.identityId || "",
        // UNION with whatever orgs already use this account. A document with
        // no orgIds is Relax's, so re-pasting Relax's token from Acme files it
        // under both rather than moving it out of Relax.
        orgIds: existing ? unionOrgs(orgIdsOf(existing), [org]) : [org],
      });
      // Re-pasting a token keeps the owner's export choice; a new account starts off.
      record.agentReadable = existing?.agentReadable === true;
      await patchDocument(idToken, path, record);
      await audit(idToken, claims, "account.connectKey", `${p.id}:${who.accountId}`, existing ? "token replaced" : "connected");
      return res.status(200).json({
        connected: { provider: p.id, accountId: who.accountId, label: who.label, scope: who.scope },
        warning: who.warning,
      });
    }

    if (action === "setAgentReadable") {
      const p = getProvider(req.body.provider);
      if (p.auth !== "apiKey") {
        return res.status(400).json({ error: "Only pasted-token accounts can be exported to an agent." });
      }
      const { accountId } = req.body;
      if (!accountId) return res.status(400).json({ error: "Name the account." });
      const value = req.body.value === true;
      const path = accountPath(p.id, accountId);
      // readAccount refuses an account outside this org (account/other-org).
      if (!(await readAccount(idToken, p.id, accountId, { org }))) {
        return res.status(404).json({ error: `No ${p.label} account "${accountId}" is connected.` });
      }
      await patchDocument(idToken, path, { agentReadable: value });
      await audit(idToken, claims, "account.agentReadable", `${p.id}:${accountId}`, value ? "on" : "off");
      return res.status(200).json({ provider: p.id, accountId, agentReadable: value });
    }

    return res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (e instanceof KeyError) return res.status(e.status).json({ error: e.message, code: e.code });
    if (e instanceof dir.ConnectedAuthError) {
      return res.status(409).json({ error: e.message, code: e.code || "", orgId: e.orgId || currentOrg() });
    }
    if (typeof e?.code === "string" && e.code.startsWith("org/")) {
      return res.status(e.status || 400).json({ error: e.message, code: e.code });
    }
    return res.status(e.status || 500).json({ error: e.message || "That did not work." });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
