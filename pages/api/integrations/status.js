// What the Tasks, GitHub and LinkedIn panels ask on load: which accounts are
// connected, as whom, and -- when one is not -- exactly what is missing.
//
// Every provider in one round trip, because the panels render them side by
// side and two sequential requests make one column appear late.
//
// It answers from the DIRECTORY rather than from the single-account store.
// Each provider can hold several accounts now, and a panel that reads only
// `integrations/<docId>` reports a freshly connected account as not connected
// -- consent succeeds, the record is written, and the panel still says
// Connect. The legacy rows are in the directory's pool too, so a panel that
// was working carries on unchanged.
import { verifyAdmin, AuthError } from "../../../lib/server/verifyAdmin";
import { connectionStatus } from "../../../lib/server/connectedAccount";
import { providerIds, getProvider, providerConfig } from "../../../lib/server/integrations";
import { allAccounts, missingScopes, shortScope } from "../../../lib/server/accountDirectory";
import { withEnv } from "../../../lib/server/envStore";
import { currentOrg, ensureOrgKnown, isOrgError } from "../../../lib/server/orgContext";

// The shape the panels already render, built from a directory row. `accounts`
// is new and additive: a panel that only reads the top-level fields keeps
// working, and one that wants to offer a chooser has the list.
function shapeFor(id, rows) {
  const p = getProvider(id);
  const cfg = providerConfig(id);
  const base = { provider: p.id, label: p.label, configured: cfg.configured, missing: cfg.missing };

  if (!cfg.configured) {
    return {
      ...base,
      connected: false,
      accounts: [],
      detail: `${p.label} is not set up on this deployment. Missing: ${cfg.missing.join(", ")}.`,
    };
  }
  if (!rows.length) {
    return {
      ...base,
      connected: false,
      accounts: [],
      detail: `No ${p.label} account is connected. Press Connect to sign in.`,
    };
  }

  // The one reported at the top level is the one that would ACT: a live
  // account before an expired one, and the most recently connected of those.
  // Reporting an expired account as the headline while a working one sits
  // below it is how a panel says "reconnect" about something that is fine.
  const live = rows.filter((r) => r.expiresInDays === null || r.expiresInDays > 0);
  const lead = (live.length ? live : rows)
    .slice()
    .sort((a, b) => String(b.connectedAt).localeCompare(String(a.connectedAt)))[0];

  const who = lead.email || lead.label || "this account";
  const days = lead.expiresInDays;
  const detail =
    days !== null && days <= 0
      ? `The connection for ${who} expired. Press Connect to sign in again.`
      : days !== null && days <= 7
      ? `Connected as ${who}, but this token expires in ${days} day${days === 1 ? "" : "s"}. ${p.label} issues refresh tokens only to approved partners, so reconnecting by hand is the only way to extend it.`
      : days !== null
      ? `Connected as ${who}. This token expires in ${days} days — ${p.label} does not issue a refresh token to a self-serve app, so it has to be reconnected by hand.`
      : rows.length > 1
      ? `Connected as ${who}, and ${rows.length - 1} other account${rows.length > 2 ? "s" : ""}.`
      : `Connected as ${who}.`;

  return {
    ...base,
    connected: days === null || days > 0,
    email: lead.email || lead.label,
    accountId: lead.accountId,
    connectedAt: lead.connectedAt,
    expiresAt: lead.expiresAt || "",
    expiresInDays: days,
    legacy: !!lead.legacy,
    detail,
    accounts: rows.map((r) => ({
      accountId: r.accountId,
      key: r.key,
      label: r.label,
      email: r.email,
      expiresInDays: r.expiresInDays,
      legacy: r.legacy,
      missingScopes: missingScopes(r).map(shortScope),
    })),
  };
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    await verifyAdmin(req);
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

    // Outside the catch below: an org that does not exist is an error to
    // report, not a reason to fall back to the unscoped legacy reader.
    await ensureOrgKnown(idToken);
    const all = await allAccounts(idToken).catch((e) => {
      if (isOrgError(e)) throw e;
      return null;
    });
    let providers;
    if (all) {
      providers = providerIds().map((id) =>
        shapeFor(
          id,
          all.filter((a) => a.provider === id)
        )
      );
    } else {
      // The directory could not be read at all. Rather than report every
      // provider as disconnected -- which would have the panels offering
      // Connect for accounts that are fine -- fall back to the single-account
      // reader, which at least answers for the legacy connections. Those are
      // Relax's alone, and connectionStatus reports "not connected" for them
      // in any other org rather than lending Relax's logins out.
      providers = await Promise.all(
        providerIds().map((id) =>
          connectionStatus(idToken, id).catch((e) => ({
            provider: id,
            connected: false,
            detail: e?.message || "This account could not be checked.",
          }))
        )
      );
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ providers, orgId: currentOrg() });
  } catch (e) {
    if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
    if (isOrgError(e)) return res.status(e.status || 400).json({ error: e.message, code: e.code });
    return res.status(500).json({ error: e.message || "Could not read the connections." });
  }
}

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
