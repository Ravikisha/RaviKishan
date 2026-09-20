// The photo wall, managed.
//
// Drop in several images at once, give them a title and a category, drag the
// order with the arrows, and they appear in the Gallery app on the site. No
// redeploy — the app reads the same collection.
//
// Deleting removes BOTH the Firestore record and the bytes in storage, so the
// Assets tab does not slowly fill with orphans from here.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, writeBatch } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { logAdminAction } from "../../lib/auditLog";
import { CATEGORIES, galleryKey, publicUrlFor } from "../../lib/galleryStore";

const MAX_BYTES = 8 * 1024 * 1024;

export default function GalleryPanel({ user }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [category, setCategory] = useState("Desk");
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "gallery"),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        arr.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
        setRows(arr);
      },
      (e) => setErr(e?.code || "read failed")
    );
    return () => unsub();
  }, []);

  const authed = useCallback(async (url, body) => {
    const u = auth.currentUser;
    if (!u) throw new Error("Not signed in.");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await u.getIdToken()}` },
      body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }, []);

  const uploadFiles = async (files) => {
    if (!files.length) return;

    setErr("");
    setMsg("");
    let done = 0;
    let nextOrder = (rows || []).reduce((m, r) => Math.max(m, r.order ?? 0), 0) + 1;

    for (const file of files) {
      setBusy(`Uploading ${done + 1} of ${files.length}…`);
      try {
        if (!/^image\//.test(file.type)) throw new Error(`${file.name} is not an image.`);
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is over 8 MB.`);

        const key = galleryKey(file.name);
        const { url } = await authed("/api/media/sign", { key });
        const put = await fetch(url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!put.ok) throw new Error(`Storage rejected ${file.name} (HTTP ${put.status}).`);

        const id = key.replace(/[^\w.-]+/g, "_");
        await setDoc(doc(db, "gallery", id), {
          key,
          url: publicUrlFor(key),
          title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80),
          category,
          note: "",
          order: nextOrder++,
          uploadedAt: new Date().toISOString(),
          uploadedBy: user?.email || "",
        });
        done++;
      } catch (e2) {
        setErr(e2?.message || "Upload failed.");
        break;
      }
    }

    setBusy("");
    if (done) {
      await logAdminAction({ action: "gallery.upload", detail: `${done} image(s)`, user });
      setMsg(`✓ Added ${done} image${done === 1 ? "" : "s"} to the gallery.`);
    }
  };

  const upload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    await uploadFiles(files);
  };

  const onDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    await uploadFiles(Array.from(e.dataTransfer?.files || []));
  };

  const patch = (r, fields) => async () => {
    try {
      await setDoc(doc(db, "gallery", r.id), fields, { merge: true });
    } catch (e) {
      setErr(e?.message || "Update failed.");
    }
  };

  const edit = (r, field) => async (e) => {
    const value = e.target.value;
    try {
      await setDoc(doc(db, "gallery", r.id), { [field]: value }, { merge: true });
    } catch (e2) {
      setErr(e2?.message || "Update failed.");
    }
  };

  // Swap order values with the neighbour, in one batch so the wall never
  // renders a half-applied reorder.
  const move = (r, dir) => async () => {
    const list = rows || [];
    const i = list.findIndex((x) => x.id === r.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, "gallery", list[i].id), { order: list[j].order ?? j }, { merge: true });
      batch.set(doc(db, "gallery", list[j].id), { order: list[i].order ?? i }, { merge: true });
      await batch.commit();
    } catch (e) {
      setErr(e?.message || "Could not reorder.");
    }
  };

  const remove = (r) => async () => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Remove "${r.title || r.id}" from the gallery?\n\nThe image file is deleted too.`)) return;
    setErr("");
    setBusy("Deleting…");
    try {
      await deleteDoc(doc(db, "gallery", r.id));
      // Bytes second: a failed object delete leaves an orphan the Assets tab
      // will surface, which is better than a row pointing at nothing.
      await authed("/api/storage", { action: "delete", key: r.key });
      await logAdminAction({ action: "gallery.delete", target: r.key, detail: r.title, user });
      setMsg(`Removed ${r.title || r.id}.`);
    } catch (e) {
      setErr(e?.message || "Delete failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="admin-main">
      <div className="vt-intro">
        <strong>Gallery.</strong> These images appear on the site&apos;s photo
        wall as soon as they are uploaded — no redeploy. Order here is the order
        there. Removing one deletes the file too, so nothing is left behind in
        storage.
      </div>

      <section className="ops-card">
        <div className="ops-head gp-head">
          <div>
            <h3>
              Add photos{" "}
              <span className="admin-sub">{rows ? `${rows.length} in the wall` : ""}</span>
            </h3>
            <p className="admin-sub gp-sub">
              Several at once is fine. Up to 8 MB each. They all land in the selected category and can be reordered later.
            </p>
          </div>
          <div className="gp-add">
            <select
              className="admin-input gp-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <label className="admin-primary gp-pick">
              {busy || "Choose images"}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                disabled={!!busy}
                onChange={upload}
              />
            </label>
          </div>
        </div>

        <div
          className={`gp-dropzone ${dragActive ? "active" : ""}`}
          onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
          onDrop={onDrop}
        >
          <div className="gp-drop-inner">
            <strong>Drop images here</strong>
            <span>or click “Choose images” above</span>
          </div>
        </div>
      </section>

      {err && <div className="admin-err">{err}</div>}
      {msg && !err && <div className="rm-ok">{msg}</div>}

      {rows == null ? (
        <p className="admin-sub" style={{ padding: "20px 2px" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <div className="inbox-empty">
          <p>The wall is empty.</p>
          <span>Upload a few images and they appear on the site straight away.</span>
        </div>
      ) : (
        <div className="gp-grid">
          {rows.map((r, i) => (
            <div key={r.id} className="gp-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="gp-img" src={r.url} alt={r.title || ""} loading="lazy" />
              <div className="gp-body">
                <input
                  className="admin-input"
                  defaultValue={r.title || ""}
                  placeholder="Title"
                  onBlur={edit(r, "title")}
                />
                <div className="gp-row2">
                  <select className="admin-input" defaultValue={r.category || "Other"} onChange={edit(r, "category")}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <span className="gp-move">
                    <button className="admin-ghost sm" type="button" onClick={move(r, -1)} disabled={i === 0} title="Move earlier">
                      ↑
                    </button>
                    <button className="admin-ghost sm" type="button" onClick={move(r, 1)} disabled={i === rows.length - 1} title="Move later">
                      ↓
                    </button>
                    <button className="admin-del" type="button" onClick={remove(r)} disabled={!!busy}>
                      ✕
                    </button>
                  </span>
                </div>
                <input
                  className="admin-input"
                  defaultValue={r.note || ""}
                  placeholder="Caption shown in the lightbox"
                  onBlur={edit(r, "note")}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx global>{`
        .gp-head {
          align-items: flex-start;
        }
        .gp-add {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .gp-sub {
          margin: 8px 0 0;
          max-width: 52ch;
        }
        .gp-cat {
          width: 130px;
          padding: 8px 10px;
          font-size: 13px;
        }
        .gp-pick {
          cursor: pointer;
          display: inline-block;
        }
        .gp-pick input[type="file"] {
          display: none;
        }
        .gp-dropzone {
          margin-top: 16px;
          border: 1.5px dashed var(--a-line, #2a2f3d);
          border-radius: 14px;
          padding: 18px;
          background: rgba(255,255,255,0.01);
          transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
        }
        .gp-dropzone.active {
          border-color: var(--a-accent, #ffb020);
          background: rgba(255,176,32,0.04);
          transform: translateY(-1px);
        }
        .gp-drop-inner {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          min-height: 62px;
          color: var(--a-muted, #8d93a3);
          text-align: center;
        }
        .gp-drop-inner strong {
          color: var(--a-fg, #f6f7fb);
          font-size: 14px;
        }
        .gp-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
          gap: 12px;
        }
        .gp-card {
          border: 1px solid var(--a-line, #262a35);
          border-radius: 14px;
          overflow: hidden;
          background: var(--a-panel, #111319);
          display: flex;
          flex-direction: column;
        }
        .gp-img {
          width: 100%;
          aspect-ratio: 4 / 3;
          object-fit: cover;
          display: block;
          background: var(--a-void, #08090d);
        }
        .gp-body {
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .gp-row2 {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .gp-row2 .admin-input {
          flex: 1;
          padding: 7px 9px;
          font-size: 12.5px;
        }
        .gp-move {
          display: flex;
          gap: 5px;
        }
      `}</style>
    </main>
  );
}
