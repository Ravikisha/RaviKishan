// Résumé manager for the admin CMS.
//
// Takes a PDF and hands it to lib/resumeStore, which puts it in Cloud Storage
// when the project is on Blaze and in a Firestore document otherwise. It then
// points `content.resume` at the result. Every public surface (pages/resume.js
// and the desktop Résumé app) resolves that through useResumeUrl(), so the new
// file is live the moment the upload finishes — no redeploy, no rebuild.
//
// Unlike the generic field editor, this panel writes to Firestore IMMEDIATELY
// (setDoc with merge:true, touching only `resume` + `resumeVersions`). That way
// a fresh upload can't be lost by forgetting "Save & publish", and it doesn't
// publish whatever else is half-edited in the other sections.
import React, { useRef, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  uploadResume,
  deleteResume,
  useResumeUrl,
  FALLBACK_URL,
  FALLBACK_NAME,
  DEFAULT_VARIANT,
  VARIANT_LABELS,
  variantLabel,
  normalizeVariant,
} from "../../lib/resumeStore";
import { logAdminAction } from "../../lib/auditLog";

const KEEP_VERSIONS = 20;

const fmtSize = (n) =>
  !n ? "—" : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const fmtWhen = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

// Turn a Firebase error into something actionable rather than a raw code.
function explain(e) {
  const code = e?.code || "";
  if (code === "storage/canceled") return "Upload canceled.";
  if (code === "permission-denied")
    return "Firestore rejected the write (permission-denied). Publish firestore.rules — the resumeFiles/ collection needs an admin-write rule.";
  return e?.message || code || "Upload failed.";
}

// Entries are identified by storage path or Firestore doc id, whichever the
// backend gave them.
const sameEntry = (a, b) =>
  !!a && !!b && ((!!a.path && a.path === b.path) || (!!a.docId && a.docId === b.docId));

const BACKEND_LABEL = {
  storage: "Cloud Storage",
  firestore: "Firestore document",
};

export default function ResumeManager({
  resume,
  versions,
  byVariant,
  onLocalChange,
  user,
}) {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const [variant, setVariant] = useState(DEFAULT_VARIANT);
  const fileRef = useRef(null);

  const list = Array.isArray(versions) ? versions : [];
  // The live résumé rendered exactly as a visitor gets it — a real URL for the
  // Storage backend, a blob: URL for the Firestore one.
  const liveUrl = useResumeUrl(resume);

  // Single writer for both fields — merge:true so unrelated sections keep
  // whatever is already published.
  const variants = byVariant && typeof byVariant === "object" ? byVariant : {};

  const persist = async (nextResume, nextVersions, nextVariants = variants) => {
    await setDoc(
      doc(db, "site", "content"),
      {
        resume: nextResume,
        resumeVersions: nextVersions,
        resumeByVariant: nextVariants,
      },
      { merge: true }
    );
    onLocalChange(nextResume, nextVersions, nextVariants);
  };

  // A default-variant upload becomes THE résumé; any other variant only takes
  // over its own /resume?v=<id> slot and leaves the default alone.
  const applyEntry = (entry, nextVersions) => {
    const v = normalizeVariant(entry.variant);
    if (v === DEFAULT_VARIANT) return persist(entry, nextVersions, variants);
    return persist(resume, nextVersions, { ...variants, [v]: entry });
  };

  const handleFile = async (file) => {
    setErr("");
    setMsg("");
    if (!file) return;
    setBusy(true);
    setPct(0);
    let notice = "";

    try {
      const entry = await uploadResume(file, {
        variant,
        onProgress: setPct,
        onNotice: (n) => {
          notice = n;
          setMsg(n);
        },
      });
      const key = (v) => v.path || v.docId;
      const nextVersions = [
        entry,
        ...list.filter((v) => key(v) !== key(entry)),
      ].slice(0, KEEP_VERSIONS);
      await applyEntry(entry, nextVersions);
      await logAdminAction({
        action: "resume.upload",
        target: entry.path || entry.docId,
        detail: `${entry.filename} · ${fmtSize(entry.size)} · ${entry.kind} · ${variantLabel(entry.variant)}`,
        user,
      });
      setMsg(
        `${notice ? notice + " " : ""}✓ Uploaded and live — ${entry.filename} ` +
          `(${fmtSize(entry.size)}, ${BACKEND_LABEL[entry.kind] || entry.kind}) ` +
          `as the ${variantLabel(entry.variant)} résumé` +
          `${normalizeVariant(entry.variant) === DEFAULT_VARIANT ? "." : ` — /resume?v=${normalizeVariant(entry.variant)}`}`
      );
    } catch (e) {
      setMsg("");
      setErr(explain(e));
    } finally {
      setBusy(false);
      setPct(0);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const makeLive = (v) => async () => {
    setErr("");
    setMsg("");
    try {
      await applyEntry({ ...v }, list);
      await logAdminAction({
        action: "resume.makeLive",
        target: v.path || v.docId,
        detail: v.filename,
        user,
      });
      setMsg(`✓ ${v.filename} is now the live résumé.`);
    } catch (e) {
      setErr(explain(e));
    }
  };

  const removeVersion = (v) => async () => {
    const isLive = sameEntry(resume, v);
    if (
      // eslint-disable-next-line no-alert
      !confirm(
        `Delete ${v.filename}? This can't be undone.` +
          (isLive
            ? "\n\nThis is the LIVE résumé — the site will fall back to the " +
              "previous upload, or to the bundled PDF if there is none."
            : "")
      )
    )
      return;
    setErr("");
    setMsg("");
    try {
      await deleteResume(v);
      const nextVersions = list.filter((x) => !sameEntry(x, v));
      const nextResume = isLive
        ? nextVersions[0] || {
            url: FALLBACK_URL,
            filename: FALLBACK_NAME,
            updated: resume?.updated || "",
          }
        : resume;
      await persist(nextResume, nextVersions);
      await logAdminAction({
        action: "resume.delete",
        target: v.path || v.docId,
        detail: v.filename,
        user,
      });
      setMsg(`Deleted ${v.filename}.`);
    } catch (e) {
      setErr(explain(e));
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    if (busy) return;
    handleFile(e.dataTransfer?.files?.[0]);
  };

  const backend = resume?.kind
    ? BACKEND_LABEL[resume.kind] || resume.kind
    : "bundled in /public";

  return (
    <section className="admin-section rm-panel">
      <div className="admin-section-head static">
        <span className="rm-pin">📄</span>
        <span className="admin-section-title">Résumé — upload &amp; publish</span>
        <span className="admin-section-key">resume</span>
      </div>

      <div className="admin-section-body">
        <div className="rm-live">
          <div className="rm-live-main">
            <span className="rm-badge">LIVE</span>
            <a className="rm-file" href={liveUrl} target="_blank" rel="noreferrer">
              {resume?.filename || FALLBACK_NAME}
            </a>
            <span className="rm-dim">
              {backend}
              {resume?.size ? ` · ${fmtSize(resume.size)}` : ""}
              {resume?.updated ? ` · shown as “Updated ${resume.updated}”` : ""}
            </span>
          </div>
          <div className="rm-dim rm-url">
            {resume?.kind === "firestore"
              ? `firestore: resumeFiles/${resume.docId}`
              : resume?.url || FALLBACK_URL}
          </div>
        </div>

        <div className="rm-variant">
          <label className="admin-label">Upload as</label>
          <select
            className="admin-input"
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            disabled={busy}
          >
            {Object.entries(VARIANT_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
                {id === DEFAULT_VARIANT ? " — /resume" : ` — /resume?v=${id}`}
              </option>
            ))}
          </select>
        </div>

        {Object.keys(variants).length > 0 && (
          <div className="rm-variants">
            {Object.entries(variants).map(([id, e]) => (
              <span key={id} className="rm-vchip">
                <b>{variantLabel(id)}</b>
                <a href={`/resume?v=${id}`} target="_blank" rel="noreferrer">
                  /resume?v={id}
                </a>
                <i>{e.filename}</i>
              </span>
            ))}
          </div>
        )}

        <label
          className={`rm-drop${drag ? " on" : ""}${busy ? " busy" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {busy ? (
            <>
              <strong>Uploading… {pct}%</strong>
              <span className="rm-bar">
                <i style={{ width: `${pct}%` }} />
              </span>
            </>
          ) : (
            <>
              <strong>Drop a new résumé PDF here, or click to choose</strong>
              <span className="rm-dim">
                PDF only · goes live immediately, no redeploy · up to 15 MB on
                Cloud Storage, 700 KB on the Firestore fallback
              </span>
            </>
          )}
        </label>

        {err && <div className="admin-err">{err}</div>}
        {msg && !err && <div className="rm-ok">{msg}</div>}

        {list.length > 0 && (
          <div className="rm-versions">
            <div className="rm-vhead">Previous uploads ({list.length})</div>
            {list.map((v) => {
              const live = sameEntry(resume, v);
              return (
                <div key={v.path || v.docId || v.url} className={`rm-v${live ? " live" : ""}`}>
                  {v.url ? (
                    <a className="rm-file" href={v.url} target="_blank" rel="noreferrer">
                      {v.filename}
                    </a>
                  ) : (
                    <span className="rm-file">{v.filename}</span>
                  )}
                  <span className="rm-dim">
                    {fmtWhen(v.uploadedAt)} · {fmtSize(v.size)} ·{" "}
                    {variantLabel(v.variant)}
                  </span>
                  <span className="rm-vbtns">
                    {live ? (
                      <span className="rm-badge sm">LIVE</span>
                    ) : (
                      <button type="button" className="admin-ghost sm" onClick={makeLive(v)}>
                        Make live
                      </button>
                    )}
                    <button type="button" className="admin-del" onClick={removeVersion(v)} title="Delete">
                      ✕
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style jsx global>{`
        .rm-panel .admin-section-head.static {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 12px 14px;
          background: #15171e;
          border: none;
          color: #e7e8ee;
          text-align: left;
          font-size: 13px;
        }
        .rm-pin {
          font-size: 14px;
        }
        .rm-live {
          border: 1px solid #262a35;
          border-radius: 10px;
          padding: 12px 14px;
          background: #0f1117;
          margin-bottom: 14px;
        }
        .rm-live-main {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }
        .rm-badge {
          background: #0f9e8e;
          color: #031312;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          padding: 3px 7px;
          border-radius: 999px;
        }
        .rm-badge.sm {
          font-size: 9px;
          padding: 2px 6px;
        }
        .rm-file {
          color: #ffb020;
          font-weight: 600;
          font-size: 13px;
          text-decoration: none;
          word-break: break-all;
        }
        .rm-file:hover {
          text-decoration: underline;
        }
        .rm-dim {
          color: #8b90a0;
          font-size: 12px;
        }
        .rm-url {
          margin-top: 6px;
          font-family: "JetBrains Mono", ui-monospace, monospace;
          font-size: 11px;
          word-break: break-all;
        }
        .rm-drop {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 108px;
          padding: 18px;
          border: 1.5px dashed #2f3547;
          border-radius: 10px;
          background: #0f1117;
          cursor: pointer;
          text-align: center;
          transition: border-color 0.15s, background 0.15s;
        }
        .rm-drop:hover,
        .rm-drop.on {
          border-color: #ffb020;
          background: #14161d;
        }
        .rm-drop.busy {
          cursor: progress;
          border-style: solid;
        }
        .rm-drop strong {
          font-size: 13px;
          font-weight: 600;
        }
        .rm-drop input[type="file"] {
          display: none;
        }
        .rm-bar {
          display: block;
          width: min(340px, 90%);
          height: 6px;
          border-radius: 999px;
          background: #262a35;
          overflow: hidden;
        }
        .rm-bar i {
          display: block;
          height: 100%;
          background: linear-gradient(90deg, #ffb020, #4ed0c0);
          transition: width 0.2s ease;
        }
        .rm-ok {
          margin-top: 10px;
          color: #4ed0c0;
          font-size: 12px;
        }
        .rm-versions {
          margin-top: 16px;
          border-top: 1px solid #262a35;
          padding-top: 12px;
        }
        .rm-vhead {
          color: #8b90a0;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 8px;
        }
        .rm-v {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid transparent;
        }
        .rm-v:nth-child(even) {
          background: #101219;
        }
        .rm-v.live {
          border-color: #0f9e8e55;
        }
        .rm-vbtns {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .admin-ghost.sm {
          padding: 5px 10px;
          font-size: 11px;
        }
        .rm-variant {
          display: grid;
          grid-template-columns: 90px 1fr;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
        }
        .rm-variants {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }
        .rm-vchip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #262a35;
          border-radius: 999px;
          padding: 4px 12px;
          font-size: 11.5px;
          background: #101219;
        }
        .rm-vchip b {
          color: #e7e8ee;
        }
        .rm-vchip a {
          color: #ffb020;
          font-family: "JetBrains Mono", monospace;
          font-size: 10.5px;
          text-decoration: none;
        }
        .rm-vchip i {
          color: #8b90a0;
          font-style: normal;
        }
      `}</style>
    </section>
  );
}
