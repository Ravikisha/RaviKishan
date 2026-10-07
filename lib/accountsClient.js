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
import { auth } from "./firebase";

export { finishConnect } from "./socialClient";

async function call(body) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const res = await fetch("/api/accounts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error || `HTTP ${res.status}`);
    e.code = json.code || "";
    throw e;
  }
  return json;
}

export const loadDirectory = () => call({ action: "list" });

export const resolveFor = (service) => call({ action: "resolve", service });

export const setDefaultAccount = (service, key) =>
  call({ action: "setDefault", service, key });

export const createIdentity = (identity) => call({ action: "createIdentity", ...identity });
export const deleteIdentity = (id) => call({ action: "deleteIdentity", id });
export const assignIdentity = (provider, accountId, identityId) =>
  call({ action: "assign", provider, accountId, identityId });

export const forgetAccount = (provider, accountId) =>
  call({ action: "forget", provider, accountId });

export const saveLogin = (login) => call({ action: "saveLogin", ...login });
export const forgetLogin = (provider, accountId) =>
  call({ action: "forgetLogin", provider, accountId });

// Start a consent flow, telling the callback which panel to come back to.
export async function connectProvider(provider, from = "accounts") {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const res = await fetch(`/api/integrations/${provider}/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify({ from }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Could not start the connection.");
  window.location.assign(json.url);
}
