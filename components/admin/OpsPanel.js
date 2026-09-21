// Operational tab: version history + rollback, the audit log, and backup export.
//
// Version history exists because publishing writes straight to the document the
// live site reads — before this, a bad edit was immediately public with no way
// back. Every publish now snapshots the PREVIOUS live content first, so
// "restore" always has something to return to.
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { logAdminAction, ACTION_LABELS } from "../../lib/auditLog";

const when = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

// Collections worth backing up. `vault` is metadata only — the bytes live in
// Backblaze and are far too large to inline, so the export records the object
// keys needed to fetch them rather than the documents themselves.
const BACKUP_COLLECTIONS = [
  "vault",
  "mail",
  "myportifilio",
  "chat",
  "resumeFiles",
  "auditLog",
];

export default function OpsPanel({ user, content, onRestore }) {
  const [versions, setVersions] = useState(null);
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "siteDrafts"),
      (snap) => {
        const arr = snap.docs
          .filter((d) => d.id.startsWith("v_"))
          .map((d) => ({ id: d.id, ...d.data() }));
        arr.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
        setVersions(arr);
      },
      (e) => setErr(`versions: ${e?.code || "read failed"}`)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "auditLog"), orderBy("at", "desc"), limit(100)),
      (snap) => setLog(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => setErr(`audit log: ${e?.code || "read failed"}`)
    );
    return () => unsub();
  }, []);

  const restore = (v) => async () => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Load the snapshot from ${when(v.savedAt)} into the editor?\n\nNothing goes live until you press Publish.`))
      return;
    setErr("");
    setMsg("");
    try {
      const snap = await getDoc(doc(db, "siteDrafts", v.id));
      if (!snap.exists()) throw new Error("Snapshot is gone.");
      onRestore(snap.data().content);
      await logAdminAction({ action: "content.restore", target: v.id, user });
      setMsg(`Loaded the ${when(v.savedAt)} snapshot into the editor. Review it, then Publish.`);
    } catch (e) {
      setErr(e?.message || "Restore failed.");
    }
  };

  const dropVersion = (v) => async () => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete the snapshot from ${when(v.savedAt)}?`)) return;
    try {
      await deleteDoc(doc(db, "siteDrafts", v.id));
    } catch (e) {
      setErr(e?.message || "Delete failed.");
    }
  };

  const runExport = async () => {
    setErr("");
    setMsg("");
    setBusy("Collecting…");
    try {
      const out = {
        exportedAt: new Date().toISOString(),
        exportedBy: user?.email || "",
        note:
          "Vault entries are metadata only. The bytes live in the private Backblaze bucket; " +
          "use the `key` field with the admin Vault tab to retrieve them.",
        siteContent: content,
        collections: {},
      };
      for (const name of BACKUP_COLLECTIONS) {
        setBusy(`Collecting ${name}…`);
        try {
          const snap = await getDocs(collection(db, name));
          out.collections[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch (e) {
          out.collections[name] = { error: e?.code || "read failed" };
        }
      }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ravikishan-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      const total = Object.values(out.collections).reduce(
        (n, v) => n + (Array.isArray(v) ? v.length : 0),
        0
      );
      await logAdminAction({
        action: "export.run",
        detail: `${total} documents across ${BACKUP_COLLECTIONS.length} collections`,
        user,
      });
      setMsg(`✓ Exported ${total} documents.`);
    } catch (e) {
      setErr(e?.message || "Export failed.");
    } finally {
      setBusy("");
    }
  };

  const logRows = useMemo(() => log || [], [log]);

  return (
    <main className="admin-main">
      <section className="ops-card">
        <div className="ops-head">
          <h3>Backup</h3>
          <button className="admin-primary" type="button" onClick={runExport} disabled={!!busy}>
            {busy || "Export everything as JSON"}
          </button>
        </div>
        <p className="admin-sub">
          Site content plus every Firestore collection, in one file. Vault entries
          come out as metadata — the bytes stay in Backblaze.
        </p>
      </section>

      {err && <div className="admin-err">{err}</div>}
      {msg && !err && <div className="rm-ok">{msg}</div>}

      <section className="ops-card">
        <h3>Version history</h3>
        <p className="admin-sub">
          A snapshot of the live content is taken automatically before each
          publish. Restoring loads it into the editor — it does not go live until
          you publish again.
        </p>
        {versions == null ? (
          <p className="admin-sub">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="admin-sub">No snapshots yet. The first publish creates one.</p>
        ) : (
          <div className="ops-list">
            {versions.map((v) => (
              <div key={v.id} className="ops-row">
                <span className="ops-when">{when(v.savedAt)}</span>
                <span className="admin-sub">{v.savedBy || ""}</span>
                <span className="ops-btns">
                  <button className="admin-ghost sm" type="button" onClick={restore(v)}>
                    Restore
                  </button>
                  <button className="admin-del" type="button" onClick={dropVersion(v)}>
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="ops-card">
        <h3>Audit log</h3>
        <p className="admin-sub">
          Append-only — entries cannot be edited or deleted, including by this
          account. Last 100 shown.
        </p>
        {log == null ? (
          <p className="admin-sub">Loading…</p>
        ) : logRows.length === 0 ? (
          <p className="admin-sub">Nothing logged yet.</p>
        ) : (
          <div className="ops-list">
            {logRows.map((r) => (
              <div key={r.id} className="ops-row">
                <span className="ops-when">{when(r.at)}</span>
                <span className="ops-action">{ACTION_LABELS[r.action] || r.action}</span>
                <span className="admin-sub ops-detail">
                  {[r.target, r.detail].filter(Boolean).join(" · ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <style jsx global>{`
        /* The .ops-* card, list and row styles used to live here, which
           meant every other tab that renders an .ops-card — Writing, Jobs,
           Gallery, Assets, Links, MCP, Contacts, Drift, Analytics, Tasks —
           got the card with no stylesheet, and its <h3> fell through to the
           colour globals.scss pins on headings: dark ink on a dark panel.
           They are in the shared Styles in pages/admin.js now. */
      `}</style>
    </main>
  );
}
