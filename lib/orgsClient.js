// BROWSER. Organisations: the records, membership, and the one-time migration.
//
// Everything goes through /api/orgs. Unlike every other route that one is NOT
// scoped by the x-org-id header — it is where orgs themselves are managed, so
// each action names the org it acts on — but it still goes through adminFetch,
// so there is no second way of calling our own API to keep in step.
import { adminJson } from "./adminFetch";

const call = (body) => adminJson("/api/orgs", body);

// Every org with what it holds, plus the roster of every account across all of
// them (the only listing that is not filtered to the current org).
export const loadOrgs = () => call({ action: "list" });
export const orgOverview = (orgId) => call({ action: "overview", orgId });
export const createOrg = (org) => call({ action: "create", ...org }).then((j) => j.org);
export const updateOrg = (orgId, patch) => call({ action: "update", orgId, ...patch }).then((j) => j.org);

// Without `confirm` the server refuses and says what deleting would do; the
// panel shows that plan and only then asks again with confirm.
export const deleteOrg = (orgId, { confirm = false } = {}) => call({ action: "delete", orgId, confirm });

// Replace an account's membership with exactly this set. Never empty — the
// server refuses that, and the panel never asks.
export const setAccountOrgs = (provider, accountId, orgIds) =>
  call({ action: "assign", provider, accountId, orgIds });

// A dry run unless told otherwise in so many words.
export const migrateLogins = ({ apply = false } = {}) => call({ action: "migrate", dryRun: !apply });
