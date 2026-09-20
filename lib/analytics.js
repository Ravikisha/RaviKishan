// First-party, cookie-free counters.
//
// GA4 is already wired for audience analytics, but reading it means opening
// Google's UI. These are the handful of numbers that belong next to the thing
// they measure: résumé views and downloads, page views, short-link clicks.
//
// HONESTY ABOUT THE NUMBERS: writes come from the browser, so a determined
// person could inflate them. The rules constrain each write to +1 on one
// allow-listed counter of the CURRENT day's document, which stops casual
// tampering and bulk rewriting, but these are indicative figures — not
// billing-grade. The same caveat already applies to the short-link clicks.
//
// Nothing identifying is recorded: no cookie, no IP, no user agent. A counter
// per day per event name, and that is all.
import { doc, setDoc, increment, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

// Only these may be incremented; the Firestore rule enforces the same list.
export const COUNTERS = [
  "pageView",
  "resumeView",
  "resumeDownload",
  "resumeCopyLink",
  "projectsView",
  "contactSubmit",
  "blogView",
];

export const dayId = (d = new Date()) => d.toISOString().slice(0, 10);

// One count per event per tab, so a refresh-happy visitor doesn't skew things.
const seen = new Set();

export function track(name, { once = true } = {}) {
  if (typeof window === "undefined") return;
  if (!COUNTERS.includes(name)) return;
  const key = `${name}:${dayId()}`;
  if (once) {
    if (seen.has(key)) return;
    seen.add(key);
    try {
      const k = `an:${key}`;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
    } catch (_) {
      /* private mode — in-memory dedupe above still applies */
    }
  }
  // Fire and forget: analytics must never delay or break a page.
  setDoc(
    doc(db, "stats", dayId()),
    { [name]: increment(1), updatedAt: serverTimestamp() },
    { merge: true }
  ).catch(() => {});
}
