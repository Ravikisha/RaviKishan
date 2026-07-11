// Centralized Firebase client — Firestore (db) + Auth (auth).
// getApps() guard prevents "Firebase App '[DEFAULT]' already exists" if another
// module (e.g. components/utils/database.js) also initializes the same config.
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

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

export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;
