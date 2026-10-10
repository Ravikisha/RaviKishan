// Whether the person at this desktop is the owner.
//
// The ONLY gate for the Jarvis app on the public desktop. It is a UI gate, not
// the security boundary: the agent socket checks the Firebase ID token and the
// allow-list itself, so a visitor who forced this to true would get a window
// that cannot connect. What this gate guarantees is that a visitor never sees
// the app, never downloads its code (DesktopOS imports the app's definition
// only once this says yes) and never has the agent's address put in the page.
//
// A verified address is required, not just a matching one: an unverified
// e-mail/password account could otherwise claim the owner's address.
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { isAdminEmail } from "../../lib/adminAllowlist";

export const isOwner = (u) => !!u && u.emailVerified === true && isAdminEmail(u.email);

export default function useAdminGate() {
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    try {
      return onAuthStateChanged(auth, (u) => setOwner(isOwner(u)), () => setOwner(false));
    } catch (_) {
      return undefined;
    }
  }, []);
  return owner;
}
