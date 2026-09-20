// Short-link manager. ravikishan.me/l/<slug> on your own domain instead of a
// third-party link-in-bio, with click counts you own.
import React, { useState } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { logAdminAction } from "../../lib/auditLog";
import { useEffect } from "react";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const slugify = (s) =>
  (s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const SITE =
  typeof window !== "undefined" ? window.location.origin : "https://ravikishan.me";

export default function LinksPanel({ user }) {
  const [rows, setRows] = useState(null);
  const [slug, setSlug] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "links"),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        arr.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
        setRows(arr);
      },
      (e) => setErr(e?.code || "read failed")
    );
    return () => unsub();
  }, []);

  const create = async () => {
    setErr("");
    setMsg("");
    const s = slugify(slug);
    if (!SLUG_RE.test(s))
      return setErr("Slug must be lowercase letters, numbers and dashes.");
    if (!/^https?:\/\//i.test(url))
      return setErr("Destination must start with http:// or https://");
    if (rows?.some((r) => r.id === s))
      return setErr(`/l/${s} already exists — delete it first or pick another slug.`);

    setBusy(true);
    try {
      await setDoc(doc(db, "links", s), {
        url: url.trim(),
        title: title.trim(),
        clicks: 0,
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: user?.email || "",
        ts: serverTimestamp(),
      });
      await logAdminAction({ action: "link.create", target: `/l/${s}`, detail: url, user });
      setMsg(`✓ ${SITE}/l/${s} → ${url}`);
      setSlug("");
      setUrl("");
      setTitle("");
    } catch (e) {
      setErr(e?.message || "Could not create the link.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (r) => async () => {
    try {
      await updateDoc(doc(db, "links", r.id), { active: r.active === false });
      await logAdminAction({
        action: "link.toggle",
        target: `/l/${r.id}`,
        detail: r.active === false ? "enabled" : "disabled",
        user,
      });
    } catch (e) {
      setErr(e?.message || "Update failed.");
    }
  };

  const remove = (r) => async () => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete /l/${r.id}? Anyone who saved that URL will get a 'not found' page.`))
      return;
    try {
      await deleteDoc(doc(db, "links", r.id));
      await logAdminAction({ action: "link.delete", target: `/l/${r.id}`, user });
    } catch (e) {
      setErr(e?.message || "Delete failed.");
    }
  };

  const copy = (r) => async () => {
    try {
      await navigator.clipboard.writeText(`${SITE}/l/${r.id}`);
      setMsg(`Copied ${SITE}/l/${r.id}`);
    } catch (_) {
      setErr("Clipboard blocked by the browser.");
    }
  };

  const totalClicks = (rows || []).reduce((n, r) => n + (r.clicks || 0), 0);

  return (
    <main className="admin-main">
      <section className="ops-card">
        <h3>New short link</h3>
        <div className="lk-form">
          <div className="lk-slug">
            <span className="lk-prefix">/l/</span>
            <input
              className="admin-input"
              placeholder="resume"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          <input
            className="admin-input"
            placeholder="https://destination…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            className="admin-input"
            placeholder="Label (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button className="admin-primary" type="button" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </section>

      {err && <div className="admin-err">{err}</div>}
      {msg && !err && <div className="rm-ok">{msg}</div>}

      <section className="ops-card">
        <div className="ops-head">
          <h3>Links</h3>
          <span className="admin-sub">
            {rows?.length || 0} links · {totalClicks} clicks total
          </span>
        </div>
        {rows == null ? (
          <p className="admin-sub">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="admin-sub">No short links yet.</p>
        ) : (
          <div className="ops-list">
            {rows.map((r) => (
              <div key={r.id} className="ops-row">
                <a
                  className="rm-file"
                  href={`/l/${r.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  /l/{r.id}
                </a>
                <span className="lk-clicks">{r.clicks || 0} clicks</span>
                <span className="admin-sub lk-dest">
                  {r.title ? `${r.title} · ` : ""}
                  {r.url}
                </span>
                <span className="ops-btns">
                  {r.active === false && <span className="lk-off">off</span>}
                  <button className="admin-ghost sm" type="button" onClick={copy(r)}>
                    Copy
                  </button>
                  <button className="admin-ghost sm" type="button" onClick={toggle(r)}>
                    {r.active === false ? "Enable" : "Disable"}
                  </button>
                  <button className="admin-del" type="button" onClick={remove(r)}>
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <style jsx global>{`
        .lk-form {
          display: grid;
          grid-template-columns: 210px 1fr 200px auto;
          gap: 10px;
          align-items: center;
          margin-top: 10px;
        }
        @media (max-width: 900px) {
          .lk-form {
            grid-template-columns: 1fr;
          }
        }
        .lk-slug {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .lk-prefix {
          font-family: "JetBrains Mono", monospace;
          font-size: 12px;
          color: #8b90a0;
        }
        .lk-clicks {
          font-family: "JetBrains Mono", monospace;
          font-size: 11px;
          color: #4ed0c0;
          min-width: 80px;
        }
        .lk-dest {
          word-break: break-all;
          flex: 1;
          min-width: 200px;
        }
        .lk-off {
          font-size: 10px;
          font-weight: 700;
          color: #ff9a9a;
          background: #2b1214;
          border-radius: 999px;
          padding: 2px 8px;
        }
      `}</style>
    </main>
  );
}
