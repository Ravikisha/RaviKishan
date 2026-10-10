// Browser side of the authentication centre.
//
// Everything goes through /api/accounts rather than straight to Firestore,
// because the directory merges two collections plus the legacy single-account
// store and the whole point of this release is that no caller has to know
// which provider lives where.
//
// The one exception is claiming a connection: that still runs through the
// shared integrations flow, because the credential is sealed into a cookie the
// SERVER sets and the BROWSER writes — see lib/socialClient.js.
//
// Every action acts in the CURRENT ORG — adminFetch sends it as x-org-id — so
// the list, the defaults, the people, saved sign-ins and pasted keys are all
// that org's without any call here having to name it.
import { adminJson } from "./adminFetch";

export { finishConnect } from "./socialClient";

const call = (body) => adminJson("/api/accounts", body);

export const loadDirectory = () => call({ action: "list" });

export const resolveFor = (service) => call({ action: "resolve", service });

export const setDefaultAccount = (service, key) =>
  call({ action: "setDefault", service, key });

export const createIdentity = (identity) => call({ action: "createIdentity", ...identity });
export const deleteIdentity = (id) => call({ action: "deleteIdentity", id });
export const assignIdentity = (provider, accountId, identityId) =>
  call({ action: "assign", provider, accountId, identityId });

// Per org: takes the current org off the account, and deletes the credential
// only when no org is left using it. Returns {removedFrom, deleted, remaining}.
export const forgetAccount = (provider, accountId) =>
  call({ action: "forget", provider, accountId });

export const saveLogin = (login) => call({ action: "saveLogin", ...login });
export const forgetLogin = (provider, accountId) =>
  call({ action: "forgetLogin", provider, accountId });

// Start a consent flow, telling the callback which panel to come back to.
// The org rides in the x-org-id header and /start seals it into the OAuth
// state, so the account is filed under the org the consent was started in.
export async function connectProvider(provider, from = "accounts") {
  const json = await adminJson(`/api/integrations/${provider}/start`, { from });
  if (!json.url) throw new Error("Could not start the connection.");
  window.location.assign(json.url);
}

// Pasted-token accounts (Hugging Face, Kaggle): the server checks the key with
// the provider before storing it, so a bad paste never becomes a row.
export const connectKey = (provider, key) => call({ action: "connectKey", provider, key });
export const setAgentReadable = (provider, accountId, value) =>
  call({ action: "setAgentReadable", provider, accountId, value: value === true });
