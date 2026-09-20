// Hidden admin CMS. Reachable only by typing the URL (/admin) — linked nowhere,
// marked noindex in _app.js. Edits are saved to Firestore `site/content`, which
// every public page reads through lib/useSiteContent.js, so changes go live
// with no redeploy.
//
// Security: writes are gated by Firebase Authentication + Firestore rules
// (see firestore.rules). The email/password live in Firebase, never in code.
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from "firebase/auth";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  onSnapshot,
  deleteDoc,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { defaultContent, sectionMeta } from "../lib/siteContent";
import { isAdminEmail } from "../lib/adminAllowlist";
import ResumeManager from "../components/admin/ResumeManager";
import VaultPanel from "../components/admin/VaultPanel";
import OpsPanel from "../components/admin/OpsPanel";
import LinksPanel from "../components/admin/LinksPanel";
import JobsPanel from "../components/admin/JobsPanel";
import PostsPanel from "../components/admin/PostsPanel";
import DriftPanel from "../components/admin/DriftPanel";
import ContactsPanel from "../components/admin/ContactsPanel";
import McpPanel from "../components/admin/McpPanel";
import TasksPanel from "../components/admin/TasksPanel";
import AnalyticsPanel from "../components/admin/AnalyticsPanel";
import SearchPanel from "../components/admin/SearchPanel";
import AssetsPanel from "../components/admin/AssetsPanel";
import GalleryPanel from "../components/admin/GalleryPanel";
import ImageField from "../components/admin/ImageField";
import ContentSection from "../components/admin/ContentEditor";
import ContentEditorStyles from "../components/admin/ContentEditorStyles";
import {
  projectImage,
  certificateImage,
  orgLogo,
  BUNDLED_LOGOS,
} from "../lib/assetUrl";
import AdminShell from "../components/admin/AdminShell";
import { logAdminAction } from "../lib/auditLog";

// How many published snapshots to keep for rollback.
const KEEP_VERSIONS = 30;

// Tab id → label. Also the allow-list for the ?tab= deep link used by the
// installed PWA's shortcuts; "inbox" has its own button after these.
const TABS = [
  ["search", "Search"],
  ["content", "Content"],
  ["vault", "Vault"],
  ["gallery", "Gallery"],
  ["assets", "Assets"],
  ["links", "Short links"],
  ["jobs", "Jobs"],
  ["tasks", "Tasks"],
  ["posts", "Writing"],
  ["drift", "Drift"],
  ["contacts", "Contacts"],
  ["mcp", "MCP"],
  ["analytics", "Analytics"],
  ["ops", "Backup & log"],
  ["inbox", "Inbox"],
];


// Counts that make the navigation informative rather than merely clickable:
// a follow-up that is due, a document about to expire, a message nobody has
// answered. Cheap live listeners; a failure just means no dot.
function useBadges() {
  const [badges, setBadges] = useState({});

  useEffect(() => {
    const day = 86_400_000;
    const set = (k, n) => setBadges((b) => (b[k] === n ? b : { ...b, [k]: n }));

    const unsubs = [
      onSnapshot(
        collection(db, "jobs"),
        (snap) => {
          const open = new Set(["saved", "applied", "screen", "interview", "offer"]);
          const due = snap.docs.filter((d) => {
            const r = d.data();
            return open.has(r.stage) && r.nextFollowUp && Date.parse(r.nextFollowUp) <= Date.now();
          }).length;
          set("jobs", due);
        },
        () => {}
      ),
      onSnapshot(
        collection(db, "vault"),
        (snap) => {
          const soon = snap.docs.filter((d) => {
            const e = d.data().expiresAt;
            return e && Date.parse(e) - Date.now() <= 60 * day;
          }).length;
          set("vault", soon);
        },
        () => {}
      ),
      onSnapshot(
        collection(db, "mail"),
        (snap) => set("inbox", snap.docs.filter((d) => !d.data().repliedAt).length),
        () => {}
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  return badges;
}

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


/* ---------- image fields ---------- */

// The whole edited document, so a field can offer choices drawn from its
// siblings — the org-logo picker lists logos already in use.
const ContentContext = createContext(null);

// Which keys are pictures, and how each one resolves. Driven by key name so
// every image field in the content model gets an uploader, rather than two
// bespoke panels for projects and certificates.
function imageFieldFor(path) {
  const key = String(path[path.length - 1] || "");
  const section = String(path[0] || "");

  if (key === "organization")
    return {
      folder: "logos",
      resolve: orgLogo,
      kind: "logo",
      fit: "contain",
      placeholder: "Slug, URL, or upload",
    };

  if (key === "image" && section === "projects")
    return { folder: "projects", resolve: projectImage, placeholder: "Poster — filename, URL, or upload" };

  if (key === "image" && section === "certificates")
    return { folder: "certificates", resolve: certificateImage, placeholder: "Certificate image" };

  if (["image", "cover", "poster", "logo", "icon", "photo", "thumbnail", "avatar"].includes(key))
    return { folder: "content", resolve: (v) => v, placeholder: "Image URL, or upload" };

  return null;
}

// Bundled logos plus every logo already used, so the common case is a click.
function useLogoChoices() {
  const content = useContext(ContentContext);
  return useMemo(() => {
    const used = new Set(
      (content?.certificates || []).map((c) => c?.organization).filter(Boolean)
    );
    for (const b of BUNDLED_LOGOS) used.add(b);
    return [...used].sort().map((v) => ({
      value: v,
      src: orgLogo(v),
      label: v.startsWith("/") || v.startsWith("http") ? "uploaded" : v,
    }));
  }, [content]);
}

function ImageFieldRow({ value, path, onChange, spec }) {
  const logoChoices = useLogoChoices();
  return (
    <ImageField
      value={value}
      onChange={(v) => onChange(path, v)}
      folder={spec.folder}
      resolve={spec.resolve}
      placeholder={spec.placeholder}
      fit={spec.fit || "cover"}
      choices={spec.kind === "logo" ? logoChoices : []}
    />
  );
}

// ContentEditor asks this for any field it is about to render, so the image
// handling lives in one place rather than being duplicated per section.
function useImageSpecFor() {
  const logoChoices = useLogoChoices();
  return useMemo(
    () => (path) => {
      const spec = imageFieldFor(path);
      if (!spec) return null;
      return { ...spec, choices: spec.kind === "logo" ? logoChoices : [] };
    },
    [logoChoices]
  );
}

/* ---------- recursive field editor ---------- */

function Field({ value, path, onChange }) {
  // string
  if (typeof value === "string") {
    // Picture fields get an uploader with a preview instead of a bare text
    // box. The stored value keeps its existing shape either way.
    const img = imageFieldFor(path);
    if (img) return <ImageFieldRow value={value} path={path} onChange={onChange} spec={img} />;

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
    const img = imageFieldFor(path);
    if (img) return <ImageFieldRow value="" path={path} onChange={onChange} spec={img} />;
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
  // content | vault | links | jobs | posts | drift | contacts | ops | inbox
  // Seeded from ?tab=… so the installed PWA's home-screen shortcuts (see
  // public/admin.webmanifest) can open straight into Vault, Jobs or Writing.
  const [view, setView] = useState("content");
  const badges = useBadges();
  const imageSpecFor = useImageSpecFor();

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab && TABS.some(([k]) => k === tab)) setView(tab);
  }, []);

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

  // Publish. Before overwriting the document the live site reads, snapshot
  // whatever is currently live — that snapshot is what OpsPanel restores from,
  // and it is the only thing standing between a bad edit and a broken site.
  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      const liveSnap = await getDoc(doc(db, "site", "content"));
      if (liveSnap.exists()) {
        const stamp = new Date().toISOString();
        await setDoc(doc(db, "siteDrafts", `v_${stamp.replace(/[:.]/g, "-")}`), {
          content: liveSnap.data(),
          savedAt: stamp,
          savedBy: user?.email || "",
        });
        await pruneVersions();
      }
      await setDoc(doc(db, "site", "content"), content);
      await logAdminAction({ action: "content.save", user });
      setStatus("✓ Published and live. Previous version snapshotted.");
    } catch (e) {
      setStatus("Save failed: " + (e?.code || e?.message || "unknown"));
    } finally {
      setSaving(false);
    }
  };

  // Keep the snapshot list bounded so the collection can't grow forever.
  const pruneVersions = async () => {
    try {
      const snap = await getDocs(collection(db, "siteDrafts"));
      const vs = snap.docs
        .filter((d) => d.id.startsWith("v_"))
        .sort((a, b) => b.id.localeCompare(a.id));
      await Promise.all(
        vs.slice(KEEP_VERSIONS).map((d) => deleteDoc(doc(db, "siteDrafts", d.id)))
      );
    } catch (_) {
      /* pruning is housekeeping; never fail a publish over it */
    }
  };

  // Save without publishing. `/?draft=1` renders the site from this document,
  // so the change can be looked at in place before anyone else sees it.
  const saveDraft = async () => {
    setSaving(true);
    setStatus("");
    try {
      await setDoc(doc(db, "siteDrafts", "draft"), {
        content,
        savedAt: new Date().toISOString(),
        savedBy: user?.email || "",
      });
      await logAdminAction({ action: "content.draft", user });
      setStatus("✓ Draft saved — not live. Use Preview to see it.");
    } catch (e) {
      setStatus("Draft save failed: " + (e?.code || e?.message || "unknown"));
    } finally {
      setSaving(false);
    }
  };

  const previewDraft = async () => {
    await saveDraft();
    window.open("/?draft=1", "_blank", "noopener");
  };

  const resetToDefaults = () => {
    if (confirm("Replace the editor with the original file defaults? (Not saved until you press Save.)")) {
      setContent(clone(defaultContent));
      setStatus("Editor reset to file defaults (unsaved).");
      logAdminAction({ action: "content.reset", user });
    }
  };

  // The Résumé panel owns these keys, so they are kept out of the generic
  // field editor (a raw array of download URLs is not useful to hand-edit).
  const PANEL_OWNED = ["resumeVersions", "resumeByVariant"];

  // ordered sections: known ones first (sectionMeta order), then any extras
  const sections = useMemo(() => {
    if (!content) return [];
    const known = sectionMeta.filter((m) => m.key in content);
    const knownKeys = new Set(known.map((m) => m.key));
    const extra = Object.keys(content)
      .filter((k) => !knownKeys.has(k) && !PANEL_OWNED.includes(k))
      .map((k) => ({ key: k, label: titleCase(k) }));
    return [...known, ...extra];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // Résumé uploads write to Firestore themselves; mirror the result into the
  // editor state so the rest of the form stays in sync with what is published.
  const onResumeChange = (nextResume, nextVersions, nextVariants) =>
    setContent((c) => ({
      ...c,
      resume: nextResume,
      resumeVersions: nextVersions,
      resumeByVariant: nextVariants ?? c.resumeByVariant,
    }));

  // Filtering by label alone made the box useless for "where is that project";
  // it now also looks inside each section's data, and ContentEditor narrows the
  // rows within a matched section by the same term.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter((s) => {
      if (s.label.toLowerCase().includes(q) || s.key.toLowerCase().includes(q)) return true;
      try {
        return JSON.stringify(content?.[s.key] ?? "").toLowerCase().includes(q);
      } catch (_) {
        return false;
      }
    });
  }, [sections, query, content]);

  if (!content) {
    return (
      <div className="admin-login-wrap">
        <div className="admin-login"><p className="admin-sub">Loading…</p></div>
        <Styles />
      </div>
    );
  }

  return (
    <AdminShell
      tabs={TABS}
      view={view}
      onView={setView}
      email={user.email}
      badges={badges}
      onSignOut={() => signOut(auth)}
      actions={
        view === "content" ? (
          <>
            <input
              className="admin-search"
              placeholder="Filter sections"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="admin-ghost" onClick={resetToDefaults} type="button">
              Reset
            </button>
            <button className="admin-ghost" onClick={saveDraft} disabled={saving} type="button">
              Save draft
            </button>
            <button className="admin-ghost" onClick={previewDraft} disabled={saving} type="button">
              Preview
            </button>
            <button className="admin-primary" onClick={save} disabled={saving} type="button">
              {saving ? "Saving" : "Publish"}
            </button>
          </>
        ) : null
      }
    >
      {view === "content" ? (
        <ContentContext.Provider value={content}>
          <div className="admin-userline">
            <span>Signed in as <strong>{user.email}</strong></span>
            {status && <span className="admin-status">{status}</span>}
          </div>

          <main className="admin-main">
            <ContentEditorStyles />
            <ResumeManager
              resume={content.resume}
              versions={content.resumeVersions}
              byVariant={content.resumeByVariant}
              onLocalChange={onResumeChange}
              user={user}
            />
            {visible.map((s, i) => (
              <ContentSection
                key={s.key}
                k={s.key}
                label={s.label}
                value={content[s.key]}
                onChange={onChange}
                imageSpecFor={imageSpecFor}
                defaultOpen={i === 0}
                query={query}
              />
            ))}
            <div className="admin-footer-actions">
              <button className="admin-primary big" onClick={save} disabled={saving} type="button">
                {saving ? "Saving…" : "Save & publish all changes"}
              </button>
            </div>
          </main>
        </ContentContext.Provider>
      ) : view === "vault" ? (
        <VaultPanel user={user} />
      ) : view === "drift" ? (
        <DriftPanel content={content} />
      ) : view === "search" ? (
        <SearchPanel onJump={setView} />
      ) : view === "analytics" ? (
        <AnalyticsPanel />
      ) : view === "mcp" ? (
        <McpPanel user={user} />
      ) : view === "contacts" ? (
        <ContactsPanel user={user} />
      ) : view === "posts" ? (
        <PostsPanel user={user} />
      ) : view === "tasks" ? (
        <TasksPanel user={user} />
      ) : view === "jobs" ? (
        <JobsPanel user={user} />
      ) : view === "gallery" ? (
        <GalleryPanel user={user} />
      ) : view === "assets" ? (
        <AssetsPanel user={user} />
      ) : view === "links" ? (
        <LinksPanel user={user} />
      ) : view === "ops" ? (
        <OpsPanel
          user={user}
          content={content}
          onRestore={(restored) =>
            setContent({ ...clone(defaultContent), ...restored })
          }
        />
      ) : (
        <Inbox />
      )}
      <Styles />
    </AdminShell>
  );
}

/* ---------- inbox (incoming: mail · contact · chat) ---------- */

const millisOf = (v) => {
  if (v?.ts?.toMillis) return v.ts.toMillis();
  if (v?.date) { const p = Date.parse(v.date); if (!Number.isNaN(p)) return p; }
  return 0;
};
const when = (ms) => (ms ? new Date(ms).toLocaleString() : "—");

// live subscription to a collection → sorted newest-first
function useCollection(name) {
  const [rows, setRows] = useState(null); // null = loading
  const [err, setErr] = useState("");
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, name),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        arr.sort((a, b) => millisOf(b) - millisOf(a));
        setRows(arr);
      },
      (e) => setErr(e?.code || "read failed")
    );
    return () => unsub();
  }, [name]);
  return { rows, err };
}

function Avatar({ text }) {
  const s = (text || "?").trim();
  const hue = [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % 360;
  return (
    <span className="inbox-av" style={{ background: `linear-gradient(140deg, hsl(${hue} 68% 55%), hsl(${(hue + 45) % 360} 68% 44%))` }}>
      {s.slice(0, 2).toUpperCase() || "??"}
    </span>
  );
}

// Reply opens the user's own mail client with the whole thread prefilled and
// records that it happened. Deliberately NOT an in-app send: that would mean a
// third-party mail API key in the deployment, and a reply that arrives from a
// sending service rather than from you. The trade is one extra click.
function replyHref({ email, from, subject, body, ms }) {
  if (!email) return null;
  const subj = subject ? (/^re:/i.test(subject) ? subject : `Re: ${subject}`) : "Re: your message";
  const quoted = String(body || "")
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  const text =
    `Hi ${String(from || "").split(" ")[0] || "there"},\n\n\n\n` +
    `On ${when(ms)}, you wrote:\n${quoted}\n`;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(text)}`;
}

function MessageCard({ from, sub, meta, body, ms, email, repliedAt, onDelete, onReplied }) {
  const href = replyHref({ email, from, subject: sub, body, ms });
  return (
    <div className={`inbox-card${repliedAt ? " replied" : ""}`}>
      <Avatar text={from} />
      <div className="inbox-card-main">
        <div className="inbox-card-top">
          <span className="inbox-from">{from || "Anonymous"}</span>
          {meta && <span className="inbox-meta">{meta}</span>}
          {repliedAt && <span className="inbox-replied">replied {when(Date.parse(repliedAt))}</span>}
          <span className="inbox-time">{when(ms)}</span>
          {href && (
            <a
              className="inbox-reply"
              href={href}
              onClick={onReplied}
              title={`Reply to ${email}`}
            >
              Reply
            </a>
          )}
          <button className="inbox-del" onClick={onDelete} title="Delete" aria-label="Delete">✕</button>
        </div>
        {sub && <div className="inbox-sub">{sub}</div>}
        {body && <div className="inbox-body">{body}</div>}
      </div>
    </div>
  );
}

function Inbox() {
  const [tab, setTab] = useState("mail");
  const mail = useCollection("mail");
  const contact = useCollection("myportifilio");
  const chat = useCollection("chat");

  const src = tab === "mail" ? mail : tab === "contact" ? contact : chat;

  const del = (name, id) => async () => {
    if (!confirm("Delete this message? This can't be undone.")) return;
    try { await deleteDoc(doc(db, name, id)); } catch (_) {}
  };

  // Stamped when the mail client is opened. It records that a reply was
  // STARTED — there is no way to know it was actually sent — which is still
  // enough to stop the same message being answered twice.
  const markReplied = (name, id) => () => {
    setDoc(doc(db, name, id), { repliedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
  };
  const coll = tab === "mail" ? "mail" : tab === "contact" ? "myportifilio" : "chat";

  const count = (c) => (c.rows == null ? "…" : c.rows.length);

  const INBOX_TABS = [
    { k: "mail", label: "Mail", c: mail },
    { k: "contact", label: "Contact", c: contact },
    { k: "chat", label: "Lobby chat", c: chat },
  ];

  return (
    <main className="admin-main">
      <div className="inbox-tabs">
        {INBOX_TABS.map((t) => (
          <button
            key={t.k}
            type="button"
            className={`inbox-tab${tab === t.k ? " on" : ""}`}
            onClick={() => setTab(t.k)}
          >
            {t.label}
            <span className="inbox-count">{count(t.c)}</span>
          </button>
        ))}
      </div>

      {src.err && <div className="admin-err" style={{ padding: "8px 2px" }}>Couldn&apos;t read messages ({src.err}). Check Firestore rules.</div>}

      {src.rows == null ? (
        <p className="admin-sub" style={{ padding: "20px 2px" }}>Loading messages…</p>
      ) : src.rows.length === 0 ? (
        <div className="inbox-empty">
          <p>No {tab === "chat" ? "chat messages" : tab === "contact" ? "contact requests" : "mail"} yet.</p>
          <span>New ones land here the moment they&apos;re sent.</span>
        </div>
      ) : (
        <div className="inbox-list">
          {src.rows.map((m) => {
            if (tab === "mail") {
              return (
                <MessageCard key={m.id} from={m.name} meta={m.email} sub={m.subject}
                  body={m.message} ms={millisOf(m)} email={m.email} repliedAt={m.repliedAt}
                  onDelete={del(coll, m.id)} onReplied={markReplied(coll, m.id)} />
              );
            }
            if (tab === "contact") {
              const from = [m.first_name, m.last_name].filter(Boolean).join(" ");
              const meta = [m.email, m.phone].filter(Boolean).join(" · ");
              return (
                <MessageCard key={m.id} from={from} meta={meta} body={m.message}
                  ms={millisOf(m)} email={m.email} repliedAt={m.repliedAt}
                  onDelete={del(coll, m.id)} onReplied={markReplied(coll, m.id)} />
              );
            }
            return (
              <MessageCard key={m.id} from={m.name} meta={m.title} body={m.text}
                ms={millisOf(m)} onDelete={del(coll, m.id)} />
            );
          })}
        </div>
      )}
    </main>
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

export function Styles() {
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
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 10px;
        color: var(--a-text, #e7e8ee);
        padding: 11px 12px;
        font-size: 14px;
        font-family: inherit;
        outline: none;
      }
      /* 16px on small screens stops iOS zooming the whole page on focus. */
      @media (max-width: 720px) {
        .admin-input {
          font-size: 16px;
        }
      }
      .admin-input:focus {
        border-color: var(--a-amber, #ffb020);
        box-shadow: 0 0 0 3px rgba(255, 176, 32, 0.14);
      }
      textarea.admin-input {
        resize: vertical;
        line-height: 1.5;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12px;
      }
      .admin-primary {
        background: var(--a-amber, #ffb020);
        color: #1a1300;
        border: none;
        border-radius: 10px;
        padding: 10px 18px;
        font-weight: 600;
        font-size: 13.5px;
        font-family: inherit;
        cursor: pointer;
        transition: filter 0.15s;
      }
      .admin-primary:hover:not(:disabled) {
        filter: brightness(1.08);
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
        max-width: 980px;
        margin: 0 auto;
        padding: 20px 20px 24px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      @media (max-width: 720px) {
        .admin-main {
          padding: 14px 14px 20px;
        }
      }
      .admin-section {
        border: 1px solid var(--a-line, #262a35);
        border-radius: 14px;
        overflow: hidden;
        background: var(--a-panel, #15171e);
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
        grid-template-columns: 160px minmax(0, 1fr);
        gap: 12px;
        align-items: start;
      }
      @media (max-width: 720px) {
        .admin-row {
          grid-template-columns: minmax(0, 1fr);
          gap: 5px;
        }
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
        color: var(--a-amber, #ffb020);
        font-size: 12.5px;
        font-weight: 600;
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

      /* ---- top view toggle (Content / Inbox) ---- */
      .admin-tabs { display: flex; gap: 4px; background: #0d0e13; border: 1px solid #262a35; border-radius: 10px; padding: 3px; }
      .admin-tab {
        background: none; border: none; color: #8b90a0; cursor: pointer;
        font-family: inherit; font-size: 13px; font-weight: 600; padding: 6px 16px; border-radius: 7px; transition: color .12s, background .12s;
      }
      .admin-tab:hover { color: #e7e8ee; }
      .admin-tab.on { background: #ffb020; color: #1a1300; }

      /* ---- inbox ---- */
      .inbox-tabs { display: flex; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
      .inbox-tab {
        display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
        background: #15171e; border: 1px solid #262a35; border-radius: 999px;
        color: #c4c7d2; font-family: inherit; font-size: 13px; font-weight: 500; padding: 7px 14px; transition: border-color .12s, color .12s;
      }
      .inbox-tab:hover { border-color: #4a5065; }
      .inbox-tab.on { border-color: #ffb020; color: #ffb020; background: rgba(255,176,32,.08); }
      .inbox-count { font-family: "JetBrains Mono", monospace; font-size: 11px; background: #0d0e13; border: 1px solid #262a35; border-radius: 6px; padding: 1px 6px; color: #8b90a0; }
      .inbox-tab.on .inbox-count { color: #ffb020; border-color: rgba(255,176,32,.4); }

      .inbox-empty { text-align: center; padding: 60px 20px; }
      .inbox-empty p { font-family: "Space Grotesk", sans-serif; font-size: 16px; font-weight: 600; color: #e7e8ee; margin: 0; }
      .inbox-empty span { display: block; margin-top: 6px; font-size: 13px; color: #8b90a0; }

      .inbox-list { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
      .inbox-card { display: flex; gap: 12px; background: #15171e; border: 1px solid #262a35; border-radius: 12px; padding: 14px 16px; }
      .inbox-av { display: grid; place-items: center; height: 38px; width: 38px; flex-shrink: 0; border-radius: 10px; color: #fff; font-family: "JetBrains Mono", monospace; font-size: 12px; font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,.3); }
      .inbox-card-main { flex: 1; min-width: 0; }
      .inbox-card-top { display: flex; align-items: baseline; gap: 10px; }
      .inbox-from { font-weight: 700; font-size: 14px; color: #e7e8ee; }
      .inbox-meta { font-family: "JetBrains Mono", monospace; font-size: 11.5px; color: #8b90a0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .inbox-time { margin-left: auto; flex-shrink: 0; font-family: "JetBrains Mono", monospace; font-size: 11px; color: #6b7080; }
      .inbox-del { flex-shrink: 0; background: none; border: 1px solid #262a35; color: #6b7080; border-radius: 6px; width: 24px; height: 24px; cursor: pointer; font-size: 12px; line-height: 1; }
      .inbox-del:hover { border-color: #ff6b6b; color: #ff6b6b; }
      .inbox-reply { flex-shrink: 0; border: 1px solid #262a35; color: #ffb020; border-radius: 6px; padding: 3px 10px; font-size: 11px; text-decoration: none; }
      .inbox-reply:hover { border-color: #ffb020; }
      .inbox-replied { flex-shrink: 0; font-size: 10px; color: #4ed0c0; background: #0c2724; border-radius: 999px; padding: 2px 8px; }
      .inbox-card.replied { opacity: .72; }
      .inbox-sub { margin-top: 5px; font-weight: 600; font-size: 13.5px; color: #e7e8ee; }
      .inbox-body { margin-top: 5px; font-size: 13.5px; line-height: 1.6; color: #b4b8c4; white-space: pre-wrap; word-break: break-word; }
    `}</style>
  );
}
