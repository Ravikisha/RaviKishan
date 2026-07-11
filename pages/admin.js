// Hidden admin CMS. Reachable only by typing the URL (/admin) — linked nowhere,
// marked noindex in _app.js. Edits are saved to Firestore `site/content`, which
// every public page reads through lib/useSiteContent.js, so changes go live
// with no redeploy.
//
// Security: writes are gated by Firebase Authentication + Firestore rules
// (see firestore.rules). The email/password live in Firebase, never in code.
import React, { useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { defaultContent, sectionMeta } from "../lib/siteContent";
import { isAdminEmail } from "../lib/adminAllowlist";

/* ---------- small pure helpers ---------- */

const clone = (v) => JSON.parse(JSON.stringify(v));

// An "emptied" version of a sample value — used when adding a new array item so
// the new row has the same shape (keys) as its siblings.
function blankLike(sample) {
  if (Array.isArray(sample)) return [];
  if (sample && typeof sample === "object") {
    const o = {};
    for (const k of Object.keys(sample)) o[k] = blankLike(sample[k]);
    return o;
  }
  if (typeof sample === "number") return 0;
  if (typeof sample === "boolean") return false;
  return "";
}

// Immutable set at a nested path, e.g. setAtPath(obj, ["experience", 0, "title"], "X")
function setAtPath(root, path, value) {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const next = Array.isArray(root) ? [...root] : { ...root };
  next[head] = setAtPath(root[head], rest, value);
  return next;
}

const titleCase = (k) =>
  k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

/* ---------- recursive field editor ---------- */

function Field({ value, path, onChange }) {
  // string
  if (typeof value === "string") {
    const long = value.length > 55 || value.includes("\n");
    return long ? (
      <textarea
        className="admin-input"
        rows={Math.min(8, Math.max(2, Math.ceil(value.length / 60)))}
        value={value}
        onChange={(e) => onChange(path, e.target.value)}
      />
    ) : (
      <input
        className="admin-input"
        value={value}
        onChange={(e) => onChange(path, e.target.value)}
      />
    );
  }

  // number
  if (typeof value === "number") {
    return (
      <input
        type="number"
        step="any"
        className="admin-input"
        value={value}
        onChange={(e) =>
          onChange(path, e.target.value === "" ? 0 : Number(e.target.value))
        }
      />
    );
  }

  // boolean
  if (typeof value === "boolean") {
    const key = path[path.length - 1];
    // "featured" gets a star toggle (drives the homepage Featured Projects).
    if (key === "featured") {
      return (
        <button
          type="button"
          onClick={() => onChange(path, !value)}
          className={`admin-star ${value ? "on" : ""}`}
          title="Show on homepage Featured Projects"
        >
          <span className="admin-star-ic">{value ? "★" : "☆"}</span>
          {value ? "Featured on homepage" : "Not featured"}
        </button>
      );
    }
    return (
      <label className="admin-bool">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(path, e.target.checked)}
        />
        <span>{value ? "true" : "false"}</span>
      </label>
    );
  }

  // null / undefined → treat as editable string
  if (value == null) {
    return (
      <input
        className="admin-input"
        value=""
        placeholder="(empty)"
        onChange={(e) => onChange(path, e.target.value)}
      />
    );
  }

  // array
  if (Array.isArray(value)) {
    const move = (from, to) => {
      if (to < 0 || to >= value.length) return;
      const arr = [...value];
      const [it] = arr.splice(from, 1);
      arr.splice(to, 0, it);
      onChange(path, arr);
    };
    const remove = (i) => onChange(path, value.filter((_, j) => j !== i));
    const add = () => {
      const template = value.length ? blankLike(value[value.length - 1]) : "";
      onChange(path, [...value, template]);
    };
    return (
      <div className="admin-array">
        {value.map((item, i) => (
          <div key={i} className="admin-array-item">
            <div className="admin-array-head">
              <span className="admin-idx">#{i + 1}</span>
              <div className="admin-array-btns">
                <button type="button" onClick={() => move(i, i - 1)} title="Move up">↑</button>
                <button type="button" onClick={() => move(i, i + 1)} title="Move down">↓</button>
                <button type="button" className="admin-del" onClick={() => remove(i)} title="Remove">✕</button>
              </div>
            </div>
            <Field value={item} path={[...path, i]} onChange={onChange} />
          </div>
        ))}
        <button type="button" className="admin-add" onClick={add}>
          + Add item
        </button>
      </div>
    );
  }

  // object
  return (
    <div className="admin-object">
      {Object.keys(value).map((k) => {
        const child = value[k];
        const isComplex =
          Array.isArray(child) || (child && typeof child === "object");
        return (
          <div key={k} className={`admin-row ${isComplex ? "complex" : ""}`}>
            <label className="admin-label">{titleCase(k)}</label>
            <Field value={child} path={[...path, k]} onChange={onChange} />
          </div>
        );
      })}
    </div>
  );
}

/* ---------- section panel (collapsible) ---------- */

function Section({ label, k, value, onChange, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="admin-section">
      <button
        type="button"
        className="admin-section-head"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span className="admin-section-title">{label}</span>
        <span className="admin-section-key">{k}</span>
      </button>
      {open && (
        <div className="admin-section-body">
          <Field value={value} path={[k]} onChange={onChange} />
        </div>
      )}
    </section>
  );
}

/* ---------- login ---------- */

function Login({ notice }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pw);
    } catch (e2) {
      setErr(e2?.code === "auth/invalid-credential" || e2?.code === "auth/wrong-password"
        ? "Invalid email or password."
        : e2?.message || "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setErr("");
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
      // Allow-list is enforced in AdminPage's auth listener; an unauthorized
      // account is signed out immediately and `notice` explains why.
    } catch (e2) {
      if (e2?.code !== "auth/popup-closed-by-user" && e2?.code !== "auth/cancelled-popup-request") {
        setErr(e2?.message || "Google sign-in failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-login-wrap">
      <div className="admin-login">
        <h1>Admin</h1>
        <p className="admin-sub">Restricted. Authorized account only.</p>

        <button className="admin-google" disabled={busy} type="button" onClick={google}>
          <GoogleMark />
          Continue with Google
        </button>

        <div className="admin-divider"><span>or</span></div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            className="admin-input"
            type="email"
            placeholder="Email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="admin-input"
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            required
          />
          <button className="admin-primary" disabled={busy} type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {(err || notice) && <div className="admin-err">{err || notice}</div>}
      </div>
      <Styles />
    </div>
  );
}

const GoogleMark = () => (
  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22 22-9.8 22-22c0-1.5-.2-2.6-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 15.6 2 8.3 6.8 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 46c5.5 0 10.4-2.1 14.1-5.5l-6.5-5.5c-2 1.5-4.6 2.5-7.6 2.5-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C8.2 41.1 15.5 46 24 46z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.5 5.5C41.4 36 44 30.6 44 24c0-1.5-.2-2.6-.4-3.5z" />
  </svg>
);

/* ---------- editor ---------- */

function Editor({ user }) {
  const [content, setContent] = useState(null); // null = loading
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  // load current content (Firestore doc, or seed from defaults if none)
  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, "site", "content"))
      .then((snap) => {
        if (cancelled) return;
        if (snap.exists()) {
          setContent({ ...clone(defaultContent), ...snap.data() });
          setStatus("Loaded live content from Firestore.");
        } else {
          setContent(clone(defaultContent));
          setStatus('No saved content yet — showing file defaults. Press "Save" to publish them.');
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setContent(clone(defaultContent));
        setStatus("Could not read Firestore (" + (e?.code || "error") + "). Showing file defaults.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = (path, value) =>
    setContent((c) => setAtPath(c, path, value));

  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      await setDoc(doc(db, "site", "content"), content);
      setStatus("✓ Saved and live.");
    } catch (e) {
      setStatus("Save failed: " + (e?.code || e?.message || "unknown"));
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    if (confirm("Replace the editor with the original file defaults? (Not saved until you press Save.)")) {
      setContent(clone(defaultContent));
      setStatus("Editor reset to file defaults (unsaved).");
    }
  };

  // ordered sections: known ones first (sectionMeta order), then any extras
  const sections = useMemo(() => {
    if (!content) return [];
    const known = sectionMeta.filter((m) => m.key in content);
    const knownKeys = new Set(known.map((m) => m.key));
    const extra = Object.keys(content)
      .filter((k) => !knownKeys.has(k))
      .map((k) => ({ key: k, label: titleCase(k) }));
    return [...known, ...extra];
  }, [content]);

  const visible = sections.filter(
    (s) => !query || s.label.toLowerCase().includes(query.toLowerCase()) || s.key.toLowerCase().includes(query.toLowerCase())
  );

  if (!content) {
    return (
      <div className="admin-login-wrap">
        <div className="admin-login"><p className="admin-sub">Loading…</p></div>
        <Styles />
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-brand">
          <span className="admin-dot" /> Site Admin
        </div>
        <div className="admin-top-actions">
          <input
            className="admin-search"
            placeholder="Filter sections…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="admin-ghost" onClick={resetToDefaults} type="button">
            Reset to file defaults
          </button>
          <button className="admin-primary" onClick={save} disabled={saving} type="button">
            {saving ? "Saving…" : "Save & publish"}
          </button>
          <button className="admin-ghost" onClick={() => signOut(auth)} type="button">
            Sign out
          </button>
        </div>
      </header>

      <div className="admin-userline">
        <span>Signed in as <strong>{user.email}</strong></span>
        {status && <span className="admin-status">{status}</span>}
      </div>

      <main className="admin-main">
        {visible.map((s, i) => (
          <Section
            key={s.key}
            k={s.key}
            label={s.label}
            value={content[s.key]}
            onChange={onChange}
            defaultOpen={i === 0}
          />
        ))}
        <div className="admin-footer-actions">
          <button className="admin-primary big" onClick={save} disabled={saving} type="button">
            {saving ? "Saving…" : "Save & publish all changes"}
          </button>
        </div>
      </main>
      <Styles />
    </div>
  );
}

/* ---------- page ---------- */

export default function AdminPage() {
  const [user, setUser] = useState(undefined); // undefined = checking
  const [notice, setNotice] = useState("");

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      // Allow-list gate: any account that isn't an authorized admin is signed
      // out immediately, so signing in with Google is not enough on its own.
      if (u && !isAdminEmail(u.email)) {
        setNotice(
          `${u.email || "That account"} is not authorized for admin access.`
        );
        try {
          await signOut(auth);
        } catch (_) {}
        setUser(null);
        return;
      }
      setNotice("");
      setUser(u || null);
    });
  }, []);

  if (user === undefined) {
    return (
      <div className="admin-login-wrap">
        <div className="admin-login"><p className="admin-sub">Checking session…</p></div>
        <Styles />
      </div>
    );
  }
  if (!user) return <Login notice={notice} />;
  return <Editor user={user} />;
}

/* ---------- scoped styles (self-contained, dark) ---------- */

function Styles() {
  return (
    <style jsx global>{`
      .admin-login-wrap,
      .admin-shell {
        min-height: 100vh;
        background: #0d0e13;
        color: #e7e8ee;
        font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
      }
      .admin-login-wrap {
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .admin-login {
        width: 100%;
        max-width: 340px;
        background: #15171e;
        border: 1px solid #262a35;
        border-radius: 14px;
        padding: 28px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .admin-login h1 {
        font-size: 20px;
        font-weight: 700;
        margin: 0;
      }
      .admin-sub {
        color: #8b90a0;
        font-size: 13px;
        margin: 0 0 6px;
      }
      .admin-input {
        width: 100%;
        background: #0d0e13;
        border: 1px solid #2b3040;
        border-radius: 8px;
        color: #e7e8ee;
        padding: 9px 11px;
        font-size: 13px;
        font-family: inherit;
        outline: none;
      }
      .admin-input:focus {
        border-color: #ffb020;
      }
      textarea.admin-input {
        resize: vertical;
        line-height: 1.5;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12px;
      }
      .admin-primary {
        background: #ffb020;
        color: #1a1300;
        border: none;
        border-radius: 8px;
        padding: 9px 16px;
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
      }
      .admin-primary:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .admin-primary.big {
        padding: 12px 22px;
        font-size: 14px;
      }
      .admin-ghost {
        background: transparent;
        color: #c4c7d2;
        border: 1px solid #2b3040;
        border-radius: 8px;
        padding: 8px 14px;
        font-size: 13px;
        cursor: pointer;
      }
      .admin-ghost:hover {
        border-color: #4a5065;
      }
      .admin-err {
        color: #ff6b6b;
        font-size: 12px;
      }
      .admin-google {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        width: 100%;
        background: #fff;
        color: #1f2328;
        border: 1px solid #2b3040;
        border-radius: 8px;
        padding: 10px 14px;
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
      }
      .admin-google:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .admin-divider {
        display: flex;
        align-items: center;
        gap: 10px;
        color: #6b7080;
        font-size: 11px;
      }
      .admin-divider::before,
      .admin-divider::after {
        content: "";
        flex: 1;
        height: 1px;
        background: #262a35;
      }
      /* shell */
      .admin-topbar {
        position: sticky;
        top: 0;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        padding: 12px 20px;
        background: #101219;
        border-bottom: 1px solid #262a35;
      }
      .admin-brand {
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .admin-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #ffb020;
        box-shadow: 0 0 10px #ffb020;
      }
      .admin-top-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }
      .admin-search {
        background: #0d0e13;
        border: 1px solid #2b3040;
        border-radius: 8px;
        color: #e7e8ee;
        padding: 8px 11px;
        font-size: 13px;
        width: 160px;
      }
      .admin-userline {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        padding: 10px 20px;
        font-size: 12px;
        color: #8b90a0;
        border-bottom: 1px solid #1c1f29;
      }
      .admin-status {
        color: #ffb020;
      }
      .admin-main {
        max-width: 900px;
        margin: 0 auto;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .admin-section {
        border: 1px solid #262a35;
        border-radius: 12px;
        overflow: hidden;
        background: #15171e;
      }
      .admin-section-head {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px;
        background: transparent;
        border: none;
        color: #e7e8ee;
        cursor: pointer;
        text-align: left;
        font-size: 14px;
      }
      .admin-section-title {
        font-weight: 600;
      }
      .admin-section-key {
        margin-left: auto;
        font-family: "JetBrains Mono", monospace;
        font-size: 11px;
        color: #6b7080;
      }
      .admin-section-body {
        padding: 4px 16px 18px;
        border-top: 1px solid #1c1f29;
      }
      .admin-object {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-top: 12px;
      }
      .admin-row {
        display: grid;
        grid-template-columns: 160px 1fr;
        gap: 12px;
        align-items: start;
      }
      .admin-row.complex {
        grid-template-columns: 1fr;
        gap: 6px;
      }
      .admin-label {
        font-size: 12px;
        color: #9aa0b0;
        padding-top: 8px;
        font-weight: 500;
      }
      .admin-row.complex > .admin-label {
        padding-top: 0;
        color: #ffb020;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: 11px;
      }
      .admin-array {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .admin-array-item {
        border: 1px solid #262a35;
        border-radius: 10px;
        padding: 10px 12px;
        background: #0f1118;
      }
      .admin-array-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .admin-idx {
        font-family: "JetBrains Mono", monospace;
        font-size: 11px;
        color: #6b7080;
      }
      .admin-array-btns button {
        background: #1a1d27;
        border: 1px solid #2b3040;
        color: #c4c7d2;
        border-radius: 6px;
        width: 26px;
        height: 26px;
        margin-left: 4px;
        cursor: pointer;
        font-size: 12px;
      }
      .admin-array-btns .admin-del:hover {
        border-color: #ff6b6b;
        color: #ff6b6b;
      }
      .admin-add {
        align-self: flex-start;
        background: transparent;
        border: 1px dashed #3a4052;
        color: #ffb020;
        border-radius: 8px;
        padding: 7px 14px;
        font-size: 12px;
        cursor: pointer;
      }
      .admin-bool {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: #c4c7d2;
      }
      .admin-star {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        border-radius: 8px;
        border: 1px solid #2b3040;
        background: #0f1118;
        color: #8b90a0;
        padding: 7px 12px;
        font-size: 13px;
        font-weight: 600;
      }
      .admin-star .admin-star-ic {
        font-size: 16px;
        line-height: 1;
        color: #6b7080;
      }
      .admin-star.on {
        border-color: #ffb020;
        color: #ffb020;
        background: rgba(255, 176, 32, 0.08);
      }
      .admin-star.on .admin-star-ic {
        color: #ffb020;
      }
      .admin-footer-actions {
        padding: 16px 0 60px;
        display: flex;
        justify-content: center;
      }
    `}</style>
  );
}
