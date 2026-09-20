// Step-up re-authentication for the operations that actually matter.
//
// Why this exists: the admin is now an installed app on a phone, and Firebase
// keeps the session alive in IndexedDB indefinitely. That is the right default
// for editing site copy, and the wrong one for opening an identity document or
// minting a token that can act as you from any AI client. An unlocked phone
// should not equal unlimited access.
//
// True multi-factor is not available here: the account signs in with Google,
// so its second factor belongs to the Google account, and Firebase's own MFA
// needs an Identity Platform upgrade. What IS enforceable client-side is
// freshness — how long ago the user actually proved who they are — so
// sensitive actions demand a recent sign-in and trigger one if it is stale.
import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "firebase/auth";
import { auth } from "./firebase";

// How recently the user must have proven who they are, in seconds.
export const FRESHNESS_SECONDS = 30 * 60;

// Seconds since the last real authentication, or null if unknown.
export async function secondsSinceAuth() {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    // auth_time is when credentials were last presented — it does NOT move
    // when the ID token is silently refreshed, which is exactly the property
    // needed here.
    const res = await user.getIdTokenResult();
    const authTime = Date.parse(res.authTime);
    if (Number.isNaN(authTime)) return null;
    return Math.floor((Date.now() - authTime) / 1000);
  } catch (_) {
    return null;
  }
}

export async function isFresh(maxAge = FRESHNESS_SECONDS) {
  const age = await secondsSinceAuth();
  return age !== null && age <= maxAge;
}

// Re-prove identity. Google accounts re-run the popup; password accounts are
// prompted for the password. Throws on cancel so the caller aborts.
export async function reauthenticate() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");

  const usesGoogle = (user.providerData || []).some((p) => p.providerId === "google.com");
  if (usesGoogle) {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await reauthenticateWithPopup(user, provider);
    return true;
  }

  // eslint-disable-next-line no-alert
  const pw = prompt("Confirm your password to continue:");
  if (!pw) throw new Error("Cancelled.");
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw));
  return true;
}

// Wrap a sensitive action: verifies freshness, re-authenticates if stale, then
// runs it. Returns whatever the action returns.
//
//   await withFreshAuth("open an identity document", () => getObjectUrl(row, pass));
export async function withFreshAuth(reason, action, maxAge = FRESHNESS_SECONDS) {
  if (!(await isFresh(maxAge))) {
    // eslint-disable-next-line no-alert
    const go = confirm(
      `For security, confirm it's you before you ${reason}.\n\n` +
        `Your last sign-in was more than ${Math.round(maxAge / 60)} minutes ago.`
    );
    if (!go) throw new Error("Cancelled.");
    await reauthenticate();
  }
  return action();
}
