// Organisations: the records, who belongs to which, and the migration.
//
// Admin-gated, one route, an ALLOW-LIST of actions — the same shape as
// /api/accounts. Unlike every other route this one is deliberately NOT scoped
// to the request's org: it is the place orgs themselves are managed, so it
// names the org it acts on explicitly in each action, and its roster reads
// across all of them.
//
// What is deliberately NOT here: nothing connects, disconnects or moves a
// credential. An account is only ever filed under orgs (`assign`); consent
// still happens in /api/integrations/[provider]/{start,callback,claim}, and
// removing a login from an org is /api/accounts `forget`.
import { verifyAdmin, AuthError } from "../../lib/server/verifyAdmin";
import { recordActivity } from "../../lib/server/activityLog.js";
import * as orgs from "../../lib/server/orgStore";
import * as dir from "../../lib/server/accountDirectory";
import { currentOrg } from "../../lib/server/orgContext";
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

    // Every org with what it holds, plus the roster of every account across
    // all of them — the one place membership is seen whole.
    if (action === "list") {
      const [list, accounts] = await Promise.all([
        orgs.listOrgs(idToken, { withCounts: true }),
        dir.allAccounts(idToken, undefined, { allOrgs: true }),
      ]);
      return res.status(200).json({
        orgs: list,
        accounts: accounts.map((a) => ({ ...a, missingScopes: dir.missingScopes(a).map(dir.shortScope) })),
        services: Object.values(dir.SERVICES),
        current: currentOrg(),
      });
    }

    if (action === "get") {
      const org = await orgs.assertOrgExists(idToken, String(body.orgId || body.id || ""));
      return res.status(200).json({ org });
    }

    if (action === "overview") {
      return res.status(200).json(await orgs.orgOverview(idToken, String(body.orgId || currentOrg())));
    }

    /* ---------------- the record ---------------- */

    if (action === "create") {
      const org = await orgs.createOrg(idToken, body);
      await audit(idToken, claims, "org.create", org.id, org.name);
      return res.status(200).json({ org });
    }

    if (action === "update") {
      const id = String(body.orgId || body.id || "");
      const { action: _a, orgId: _o, ...patch } = body;
      const org = await orgs.updateOrg(idToken, id, patch);
      await audit(idToken, claims, "org.update", id, Object.keys(patch).filter((k) => k !== "id").join(","));
      return res.status(200).json({ org });
    }

    if (action === "delete") {
      const id = String(body.orgId || body.id || "");
      const out = await orgs.deleteOrg(idToken, id, { confirm: body.confirm === true });
      await audit(idToken, claims, "org.delete", id, `unassigned ${out.unassigned.length}`);
      return res.status(200).json(out);
    }

    /* ---------------- membership ---------------- */

    if (action === "assign") {
      const { provider, accountId, orgIds } = body;
      if (!provider || !accountId) {
        return res.status(400).json({ error: "Name the provider and the account." });
      }
      const out = await orgs.setAccountOrgs(idToken, provider, accountId, orgIds);
      await audit(
        idToken,
        claims,
        "org.assign",
        `${out.provider}:${out.accountId}`,
        `${out.before.join(",")} -> ${out.after.join(",")}`
      );
      return res.status(200).json(out);
    }

    /* ---------------- migration ---------------- */

    // A dry run unless told otherwise in so many words.
    if (action === "migrate") {
      const dryRun = body.dryRun !== false;
      const out = await orgs.migrateToOrgs(idToken, { dryRun });
      if (!dryRun) {
        await audit(
          idToken,
          claims,
          "org.migrate",
          "relax",
          `${out.accountsStamped.length} accounts, ${out.identitiesStamped} identities, ${out.secretsStamped} sign-ins`
        );
      }
      return res.status(200).json(out);
    }

    return res.status(400).json({ error: `Unknown action "${action}".` });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (e instanceof dir.ConnectedAuthError) {
      return res.status(409).json({ error: e.message, code: e.code || "" });
    }
    if (typeof e?.code === "string" && e.code.startsWith("org/")) {
      return res
        .status(e.status || 400)
        .json({ error: e.message, code: e.code, ...(e.plan ? { plan: e.plan } : {}), ...(e.accounts ? { accounts: e.accounts, secrets: e.secrets } : {}) });
    }
    return res.status(e.status || 500).json({ error: e.message || "That did not work." });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
