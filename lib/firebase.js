// Centralized Firebase client — Firestore (db) + Auth (auth).
// getApps() guard prevents "Firebase App '[DEFAULT]' already exists" if another
// module (e.g. components/utils/database.js) also initializes the same config.
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: "AIzaSyDuDWdIMLs5CCRbPqMvwfxpbobsR4SO3w0",
  authDomain: "myportifilio-3ab5f.firebaseapp.com",
  projectId: "myportifilio-3ab5f",
  storageBucket: "myportifilio-3ab5f.appspot.com",
  messagingSenderId: "885178289992",
  appId: "1:885178289992:web:107ee346dbbea51a252d7d",
  measurementId: "G-34JFCNNQG2",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// App Check — attests that traffic comes from THIS site rather than someone
// replaying the public API key (which is an identifier, not a secret). It is
// opt-in: with no site key configured nothing changes, so a missing key can
// never lock the site out. Turn on enforcement in the Firebase console only
// after you can see tokens arriving under App Check → Metrics.
//
// The site key lives in the database like every other variable, so it is
// fetched at run time from /api/public-env rather than compiled in at build.
if (typeof window !== "undefined") {
  fetch("/api/public-env")
    .then((r) => (r.ok ? r.json() : {}))
    .then((env) => {
      const siteKey = env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
      if (!siteKey) return;
      // Lets a developer machine obtain a debug token instead of solving
      // reCAPTCHA; register the printed token in the console to allow it.
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-underscore-dangle
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      }
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    })
    // A bad key or an unreachable store must degrade to "no attestation",
    // never to a blank site.
    .catch(() => {});
}

export const db = getFirestore(app);
export const auth = getAuth(app);
// Cloud Storage — holds uploaded résumé PDFs under resumes/ (see storage.rules).
export const storage = getStorage(app);
export default app;
