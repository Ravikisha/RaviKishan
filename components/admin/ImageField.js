// An image field for the generic content editor.
//
// Projects and certificates already had `image` / `organization` fields — they
// were just bare text inputs, so adding a poster meant dropping a file into
// public/ and redeploying. This turns any image-ish field into something you
// can upload into, and shows what is actually there.
//
// It is wired into the recursive Field editor by KEY NAME rather than bolted
// onto two bespoke panels, so every image field in the content model gets it —
// project posters, certificate images, org logos, and whatever comes next.
//
// The value keeps its existing shape: a legacy bare filename stays a bare
// filename until you replace it, and an upload writes a resolved /api/media/
// path. lib/assetUrl.js reads both.
import React, { useRef, useState } from "react";
import { auth } from "../../lib/firebase";

// Direct to object storage, never through Vercel, never re-encoded.
const MAX_BYTES = 20 * 1024 * 1024;

export default function ImageField({
  value,
  onChange,
  folder = "content",
  resolve,
  choices = [],
  fit = "cover",
  placeholder = "Filename, URL, or upload",
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [picking, setPicking] = useState(false);
  const fileRef = useRef(null);

  const src = resolve ? resolve(value) : value;

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");

    if (!/^image\//.test(file.type)) return setErr("That is not an image.");
    if (file.size > MAX_BYTES) return setErr("Images must be under 20 MB.");

    setBusy(true);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error("Not signed in.");
      const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-60);
      const key = `media/${folder}/${Date.now()}-${safe}`;

      const signed = await fetch("/api/media/sign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await u.getIdToken()}`,
        },
        body: JSON.stringify({ key }),
      });
      const json = await signed.json().catch(() => ({}));
      if (!signed.ok) throw new Error(json.error || `HTTP ${signed.status}`);

      const put = await fetch(json.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!put.ok) throw new Error(`Storage rejected the upload (HTTP ${put.status}).`);

      // A resolved path, so lib/assetUrl passes it through untouched.
      onChange(json.publicUrl);
    } catch (e2) {
      setErr(e2?.message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="imgf">
      <div className="imgf-row">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={`imgf-thumb${fit === "contain" ? " contain" : ""}`} src={src} alt="" onError={(e) => (e.currentTarget.style.opacity = 0.25)} />
        ) : (
          <span className="imgf-thumb imgf-empty" aria-hidden="true" />
        )}

        <input
          className="admin-input"
          value={value || ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />

        <label className="admin-ghost imgf-btn">
          {busy ? "Uploading…" : "Upload"}
          <input ref={fileRef} type="file" accept="image/*" disabled={busy} onChange={upload} />
        </label>

        {choices.length > 0 && (
          <button
            type="button"
            className="admin-ghost imgf-btn"
            onClick={() => setPicking((v) => !v)}
            aria-expanded={picking}
          >
            {picking ? "Close" : "Choose"}
          </button>
        )}

        {value ? (
          <button type="button" className="admin-del" onClick={() => onChange("")} title="Clear">
            ✕
          </button>
        ) : null}
      </div>

      {/* Most certificates reuse a logo that already exists. Offering those
          first means the common case needs no upload at all. */}
      {picking && choices.length > 0 && (
        <div className="imgf-picker">
          {choices.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`imgf-choice${value === c.value ? " on" : ""}`}
              title={c.value}
              onClick={() => {
                onChange(c.value);
                setPicking(false);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.src} alt="" />
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      )}

      {err && <div className="admin-err imgf-err">{err}</div>}

      <style jsx global>{`
        .imgf {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }
        .imgf-row {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .imgf-row .admin-input {
          flex: 1;
          min-width: 0;
        }
        .imgf-thumb {
          flex-shrink: 0;
          width: 46px;
          height: 46px;
          border-radius: 9px;
          object-fit: cover;
          border: 1px solid var(--a-line, #262a35);
          background: var(--a-void, #0a0b0f);
        }
        /* A logo is usually wide; cropping it to a square makes it unreadable. */
        .imgf-thumb.contain {
          object-fit: contain;
          padding: 5px;
          background: var(--a-panel, #15171e);
        }
        .imgf-empty {
          display: block;
          border-style: dashed;
        }
        .imgf-btn {
          cursor: pointer;
          white-space: nowrap;
        }
        .imgf-btn input[type="file"] {
          display: none;
        }
        .imgf-picker {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
          gap: 8px;
          padding: 10px;
          border: 1px solid var(--a-line, #262a35);
          border-radius: 10px;
          background: var(--a-void, #0f1117);
        }
        .imgf-choice {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 9px 6px;
          border: 1px solid var(--a-line, #262a35);
          border-radius: 9px;
          background: var(--a-panel, #15171e);
          color: var(--a-dim, #8b90a0);
          font: inherit;
          font-size: 11px;
          cursor: pointer;
        }
        .imgf-choice:hover {
          border-color: var(--a-amber, #ffb020);
          color: var(--a-text, #e7e8ee);
        }
        .imgf-choice.on {
          border-color: var(--a-amber, #ffb020);
          color: var(--a-text, #e7e8ee);
        }
        .imgf-choice img {
          width: 34px;
          height: 34px;
          object-fit: contain;
        }
        .imgf-choice span {
          text-align: center;
          word-break: break-word;
          line-height: 1.25;
        }
        .imgf-err {
          margin: 0;
        }
        @media (max-width: 720px) {
          .imgf-row {
            flex-wrap: wrap;
          }
          .imgf-row .admin-input {
            order: 3;
            flex-basis: 100%;
          }
        }
      `}</style>
    </div>
  );
}
