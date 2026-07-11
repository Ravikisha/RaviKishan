// The ONLY accounts allowed into the admin CMS. An email here is not a secret —
// the real enforcement is (a) this client check auto-signs-out anyone else, and
// (b) the Firestore rules pin writes to these same emails. Keep this list and
// firestore.rules in sync.
export const ADMIN_EMAILS = ["ravikishan63392@gmail.com"];

export const isAdminEmail = (email) =>
  !!email &&
  ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase());
