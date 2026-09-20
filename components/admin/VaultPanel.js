// Private document vault.
//
// Bytes live in the private Backblaze bucket (lib/vault.js); this Firestore
// collection holds only metadata, which is what makes the vault searchable,
// taggable and expiry-aware. `vault/*` is admin-read AND admin-write in
// firestore.rules — unlike every other collection here, nothing about it is
// public.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  CATEGORIES,
  categoryOf,
  mustEncrypt,
  putObject,
  getObjectUrl,
  deleteObject,
  fmtSize,
  daysUntil,
} from "../../lib/vault";
import { logAdminAction } from "../../lib/auditLog";
import { withFreshAuth } from "../../lib/reauth";

const todayISO = () => new Date().toISOString().slice(0, 10);

function ExpiryBadge({ iso }) {
  const d = daysUntil(iso);
  if (d === null) return null;
  const cls = d < 0 ? "bad" : d <= 60 ? "warn" : "ok";
  const text =
    d < 0 ? `expired ${Math.abs(d)}d ago` : d === 0 ? "expires today" : `${d}d left`;
  return <span className={`vt-exp ${cls}`}>{text}</span>;
}

export default function VaultPanel({ user }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState("all");

  // upload form
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState("employment");
  const [tags, setTags] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [pass, setPass] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "vault"),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        arr.sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""));
        setRows(arr);
      },
      (e) => setErr(e?.code || "read failed")
    );
    return () => unsub();
  }, []);

  const needsPass = mustEncrypt(category);

  const reset = () => {
    setFile(null);
    setTags("");
    setIssuedAt("");
    setExpiresAt("");
    setNote("");
    setPass("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const upload = async () => {
    setErr("");
    setMsg("");
    if (!file) return setErr("Choose a file first.");
    if (needsPass && pass.length < 8)
      return setErr("Identity documents need a passphrase of at least 8 characters.");

    setBusy("Encrypting and uploading…");
    try {
      const meta = await putObject(file, { category, passphrase: pass });
      const id = meta.key.replace(/[^\w.-]+/g, "_");
      const record = {
        ...meta,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        issuedAt: issuedAt || null,
        expiresAt: expiresAt || null,
        note: note || "",
        uploadedAt: new Date().toISOString(),
        uploadedBy: user?.email || "",
        ts: serverTimestamp(),
      };
      await setDoc(doc(db, "vault", id), record);
      await logAdminAction({
        action: "vault.upload",
        target: meta.key,
        detail: `${meta.filename} · ${fmtSize(meta.size)}${meta.encrypted ? " · encrypted" : ""}`,
        user,
      });
      setMsg(
        `✓ ${meta.filename} stored${meta.encrypted ? " (encrypted)" : ""} — ${fmtSize(meta.size)}.`
      );
      reset();
    } catch (e) {
      setErr(e?.message || "Upload failed.");
    } finally {
      setBusy("");
    }
  };

  const open = (row) => async () => {
    setErr("");
    setMsg("");
    let passphrase = "";
    if (row.encrypted) {
      // eslint-disable-next-line no-alert
      passphrase = prompt(`Passphrase for ${row.filename}:`) || "";
      if (!passphrase) return;
    }
    setBusy(`Fetching ${row.filename}…`);
    try {
      // Identity documents are the highest-value thing in here; an unlocked
      // phone should not be enough to open one.
      const url = await withFreshAuth(
        `open ${row.category === "identity" ? "an identity document" : "this document"}`,
        () => getObjectUrl(row, passphrase)
      );
      window.open(url, "_blank", "noopener");
      // give the new tab time to read it before the URL is revoked
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      await logAdminAction({ action: "vault.open", target: row.key, user });
    } catch (e) {
      setErr(e?.message || "Could not open the document.");
    } finally {
      setBusy("");
    }
  };

  // scripts/vault-import.mjs uploads the bytes to Backblaze but cannot write
  // `vault/` — that collection is admin-only and the script has no session.
  // This takes the manifest it produced and creates the metadata as you.
  const importManifest = async (e) => {
    setErr("");
    setMsg("");
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy("Reading manifest…");
    try {
      const man = JSON.parse(await f.text());
      const entries = Array.isArray(man?.entries) ? man.entries : null;
      if (!entries?.length) throw new Error("No `entries` array in that file.");

      const batch = writeBatch(db);
      for (const en of entries) {
        if (!en.key || !en.filename) continue;
        const id = en.key.replace(/[^\w.-]+/g, "_");
        batch.set(
          doc(db, "vault", id),
          { ...en, uploadedBy: user?.email || "", ts: serverTimestamp() },
          { merge: true }
        );
      }
      setBusy(`Writing ${entries.length} records…`);
      await batch.commit();
      await logAdminAction({
        action: "vault.import",
        detail: `${entries.length} documents from manifest`,
        user,
      });
      setMsg(`✓ Imported ${entries.length} documents from the manifest.`);
    } catch (e2) {
      setErr(e2?.message || "Import failed.");
    } finally {
      setBusy("");
      e.target.value = "";
    }
  };

  const remove = (row) => async () => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete ${row.filename} from the vault? This can't be undone.`)) return;
    setErr("");
    setMsg("");
    setBusy(`Deleting ${row.filename}…`);
    try {
      await withFreshAuth("delete a vault document", () => deleteObject(row.key));
      await deleteDoc(doc(db, "vault", row.id));
      await logAdminAction({ action: "vault.delete", target: row.key, user });
      setMsg(`Deleted ${row.filename}.`);
    } catch (e) {
      setErr(e?.message || "Delete failed.");
    } finally {
      setBusy("");
    }
  };

  const visible = useMemo(() => {
    const list = rows || [];
    const q = query.trim().toLowerCase();
    return list.filter((r) => {
      if (catFilter !== "all" && r.category !== catFilter) return false;
      if (!q) return true;
      return [r.filename, r.note, r.category, ...(r.tags || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, catFilter]);

  const expiring = (rows || []).filter((r) => {
    const d = daysUntil(r.expiresAt);
    return d !== null && d <= 60;
  });

  return (
    <main className="admin-main">
      <div className="vt-intro">
        <strong>Private vault.</strong> Files are stored in a private Backblaze
        bucket — no public URLs exist. Identity documents are encrypted in this
        browser before upload; the passphrase never leaves this machine and
        cannot be recovered. Keep <code>mydocs/</code> on disk as the master copy.
      </div>

      {expiring.length > 0 && (
        <div className="vt-alert">
          {expiring.length} document{expiring.length > 1 ? "s" : ""} expiring soon:{" "}
          {expiring.map((r) => r.filename).join(", ")}
        </div>
      )}

      <section className="vt-upload">
        <div className="vt-row">
          <label className="admin-label">File</label>
          <input
            ref={fileRef}
            type="file"
            className="admin-input"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>
        <div className="vt-row">
          <label className="admin-label">Category</label>
          <select
            className="admin-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
                {c.hint ? ` — ${c.hint}` : ""}
                {c.forceEncrypt ? " (encrypted)" : ""}
              </option>
            ))}
          </select>
        </div>
        {needsPass && (
          <div className="vt-row">
            <label className="admin-label">Passphrase</label>
            <input
              className="admin-input"
              type="password"
              autoComplete="new-password"
              placeholder="min 8 characters — not recoverable"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          </div>
        )}
        <div className="vt-row">
          <label className="admin-label">Tags</label>
          <input
            className="admin-input"
            placeholder="comma,separated"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>
        <div className="vt-row vt-dates">
          <div>
            <label className="admin-label">Issued</label>
            <input
              className="admin-input"
              type="date"
              value={issuedAt}
              max={todayISO()}
              onChange={(e) => setIssuedAt(e.target.value)}
            />
          </div>
          <div>
            <label className="admin-label">Expires</label>
            <input
              className="admin-input"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>
        <div className="vt-row">
          <label className="admin-label">Note</label>
          <input
            className="admin-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="vt-actions">
          <label className="admin-ghost vt-manifest">
            Import manifest
            <input
              type="file"
              accept="application/json,.json"
              disabled={!!busy}
              onChange={importManifest}
            />
          </label>
          <button className="admin-primary" type="button" onClick={upload} disabled={!!busy}>
            {busy || "Upload to vault"}
          </button>
        </div>
      </section>

      {err && <div className="admin-err">{err}</div>}
      {msg && !err && <div className="rm-ok">{msg}</div>}

      <div className="vt-toolbar">
        <input
          className="admin-search"
          placeholder="Search filename, tag, note…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="admin-input vt-catfilter"
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {rows == null ? (
        <p className="admin-sub" style={{ padding: "20px 2px" }}>Loading vault…</p>
      ) : visible.length === 0 ? (
        <div className="inbox-empty">
          <p>Nothing here yet.</p>
          <span>Uploaded documents appear in this list.</span>
        </div>
      ) : (
        <div className="vt-list">
          {visible.map((r) => (
            <div key={r.id} className="vt-item">
              <div className="vt-main">
                <span className="vt-name">{r.filename}</span>
                {r.encrypted && <span className="vt-lock" title="Encrypted in browser">🔒</span>}
                <span className="vt-cat">{categoryOf(r.category).label}</span>
                <ExpiryBadge iso={r.expiresAt} />
              </div>
              <div className="vt-meta">
                {fmtSize(r.size)}
                {r.issuedAt ? ` · issued ${r.issuedAt}` : ""}
                {r.expiresAt ? ` · expires ${r.expiresAt}` : ""}
                {r.tags?.length ? ` · ${r.tags.join(", ")}` : ""}
                {r.note ? ` · ${r.note}` : ""}
              </div>
              <div className="vt-btns">
                <button className="admin-ghost sm" type="button" onClick={open(r)} disabled={!!busy}>
                  Open
                </button>
                <button className="admin-del" type="button" onClick={remove(r)} disabled={!!busy}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx global>{`
        .vt-intro {
          border: 1px solid #262a35;
          border-left: 3px solid #ffb020;
          border-radius: 10px;
          padding: 12px 14px;
          font-size: 12.5px;
          line-height: 1.6;
          color: #b9bdca;
          margin-bottom: 14px;
        }
        .vt-intro code {
          font-family: "JetBrains Mono", monospace;
          font-size: 11.5px;
          color: #ffb020;
        }
        .vt-alert {
          border: 1px solid #7a4a12;
          background: #221806;
          color: #ffcd7a;
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 12.5px;
          margin-bottom: 14px;
        }
        .vt-upload {
          border: 1px solid #262a35;
          border-radius: 10px;
          padding: 14px;
          background: #0f1117;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .vt-row {
          display: grid;
          grid-template-columns: 110px 1fr;
          align-items: center;
          gap: 10px;
        }
        .vt-dates {
          grid-template-columns: 1fr 1fr;
        }
        .vt-dates > div {
          display: grid;
          grid-template-columns: 110px 1fr;
          align-items: center;
          gap: 10px;
        }
        .vt-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          align-items: center;
        }
        .vt-manifest {
          cursor: pointer;
        }
        .vt-manifest input[type="file"] {
          display: none;
        }
        .vt-toolbar {
          display: flex;
          gap: 10px;
          margin: 16px 0 10px;
        }
        .vt-catfilter {
          max-width: 220px;
        }
        .vt-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .vt-item {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 4px 12px;
          padding: 10px 12px;
          border: 1px solid #1d212b;
          border-radius: 10px;
          background: #101219;
        }
        .vt-main {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .vt-name {
          font-weight: 600;
          font-size: 13px;
          color: #e7e8ee;
        }
        .vt-cat {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #8b90a0;
          border: 1px solid #2b3040;
          border-radius: 999px;
          padding: 2px 8px;
        }
        .vt-exp {
          font-size: 10.5px;
          font-weight: 700;
          border-radius: 999px;
          padding: 2px 8px;
        }
        .vt-exp.ok {
          color: #4ed0c0;
          background: #0c2724;
        }
        .vt-exp.warn {
          color: #ffcd7a;
          background: #2a1e07;
        }
        .vt-exp.bad {
          color: #ff9a9a;
          background: #2b1214;
        }
        .vt-meta {
          grid-column: 1 / 2;
          font-size: 11.5px;
          color: #8b90a0;
        }
        .vt-btns {
          grid-row: 1 / 3;
          grid-column: 2;
          display: flex;
          align-items: center;
          gap: 8px;
        }
      `}</style>
    </main>
  );
}
