// What is in object storage, and what nothing points at any more.
//
// Four things write to the bucket — résumé uploads, the vault importer, blog
// images, nightly backups — and until now there was no way to see the total or
// to find the leftovers. A blog image whose post was deleted, a résumé version
// removed from the list, a test upload from six months ago: they all just sit
// there costing space.
//
// So this does not merely list objects. It cross-references every key against
// Firestore and flags the ones nothing references, which is the only part of
// the answer that actually helps you clean up.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { logAdminAction } from "../../lib/auditLog";
import { withFreshAuth } from "../../lib/reauth";

const GROUPS = [
  { prefix: "media/", label: "Blog media", hint: "Images used in posts" },
  { prefix: "vault/", label: "Vault documents", hint: "Private documents and backups" },
  { prefix: "resumes/", label: "Résumés", hint: "Uploaded CV files" },
];

const fmtSize = (n) =>
  !n ? "0 B" : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const fmtWhen = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
};

const isImage = (key) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(key);

export default function AssetsPanel({ user }) {
  const [data, setData] = useState(null);
  const [refs, setRefs] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [onlyOrphans, setOnlyOrphans] = useState(false);
  const [links, setLinks] = useState({});
  const [encrypted, setEncrypted] = useState(new Set());
  const [query, setQuery] = useState("");

  const authed = useCallback(async (body) => {
    const u = auth.currentUser;
    if (!u) throw new Error("Not signed in.");
    const res = await fetch("/api/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await u.getIdToken()}` },
      body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }, []);

  // Every storage key Firestore still points at. Anything in the bucket and
  // not in this set is a leftover.
  const loadRefs = useCallback(async () => {
    const keys = new Set();
    const add = (k) => typeof k === "string" && k && keys.add(k);

    try {
      const content = await getDoc(doc(db, "site", "content"));
      if (content.exists()) {
        const c = content.data();
        add(c.resume?.path);
        for (const v of c.resumeVersions || []) add(v.path);
        for (const v of Object.values(c.resumeByVariant || {})) add(v?.path);
      }
    } catch (_) {}

    const enc = new Set();
    try {
      const vault = await getDocs(collection(db, "vault"));
      vault.forEach((d) => {
        const v = d.data();
        add(v.key);
        // An encrypted document downloads as ciphertext — opening it from here
        // would hand you an unreadable blob, so the row says so instead.
        if (v.encrypted && v.key) enc.add(v.key);
      });
    } catch (_) {}
    setEncrypted(enc);

    // Blog images are referenced by URL inside Markdown, not by key, so the
    // key has to be recovered from the /api/media/ path the editor inserts.
    try {
      const posts = await getDocs(collection(db, "posts"));
      posts.forEach((d) => {
        const p = d.data();
        const text = `${p.body || ""} ${p.cover || ""}`;
        for (const m of text.matchAll(/\/api\/media\/([A-Za-z0-9._\-/]+)/g)) add(`media/${m[1]}`);
      });
    } catch (_) {}

    return keys;
  }, []);

  const load = useCallback(async () => {
    setErr("");
    setBusy("Reading storage…");
    try {
      const [listing, referenced] = await Promise.all([authed({ action: "list" }), loadRefs()]);
      setData(listing);
      setRefs(referenced);

      // Every object gets a signed link so it can be opened, and images can
      // show a thumbnail. Requested in batches because the signing endpoint
      // caps each call, and a bucket can hold more than one batch.
      const keys = Object.values(listing.groups || {}).flat().map((o) => o.key);
      const minted = {};
      for (let i = 0; i < keys.length; i += 60) {
        // eslint-disable-next-line no-await-in-loop
        const { urls } = await authed({ action: "urls", keys: keys.slice(i, i + 60) });
        Object.assign(minted, urls);
      }
      setLinks(minted);
    } catch (e) {
      setErr(e.message || "Could not read storage.");
    } finally {
      setBusy("");
    }
  }, [authed, loadRefs]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = (o) => async () => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete ${o.key} from storage?\n\nThis removes the bytes permanently. Any Firestore record pointing at it will break.`))
      return;
    setErr("");
    setMsg("");
    setBusy(`Deleting ${o.key}…`);
    try {
      await withFreshAuth("delete a stored file", () => authed({ action: "delete", key: o.key }));
      await logAdminAction({ action: "storage.delete", target: o.key, detail: fmtSize(o.size), user });
      setMsg(`Deleted ${o.key}.`);
      await load();
    } catch (e) {
      setErr(e.message || "Delete failed.");
    } finally {
      setBusy("");
    }
  };

  const groups = useMemo(() => {
    if (!data?.groups) return [];
    const q = query.trim().toLowerCase();
    return GROUPS.map((g) => {
      const all = (data.groups[g.prefix] || []).map((o) => ({
        ...o,
        href: links[o.key] || null,
        locked: encrypted.has(o.key),
        orphan: refs ? !refs.has(o.key) : false,
        // A backup is written by a cron and referenced by nothing; calling it
        // an orphan would be noise.
        system: o.key.startsWith("vault/_backups/"),
      }));
      const rows = all.filter((o) => {
        if (onlyOrphans && (!o.orphan || o.system)) return false;
        if (q && !o.key.toLowerCase().includes(q)) return false;
        return true;
      });
      return { ...g, rows, count: all.length, bytes: all.reduce((n, o) => n + o.size, 0), orphans: all.filter((o) => o.orphan && !o.system).length };
    });
  }, [data, refs, links, encrypted, onlyOrphans, query]);

  const totalOrphans = groups.reduce((n, g) => n + g.orphans, 0);
  const orphanBytes = groups.reduce(
    (n, g) => n + g.rows.filter((o) => o.orphan && !o.system).reduce((m, o) => m + o.size, 0),
    0
  );

  return (
    <main className="admin-main">
      <div className="vt-intro">
        <strong>Object storage.</strong> Everything this site has put in the
        Backblaze bucket, cross-referenced against Firestore. Anything marked
        unreferenced has no record pointing at it — usually a deleted post&apos;s
        image or a replaced résumé. Backups are excluded from that count on
        purpose: nothing references them by design. Every file opens through a
        signed link that lasts ten minutes.
      </div>

      <section className="ops-card">
        <div className="ops-head">
          <h3>
            {data ? `${data.total} files` : "Storage"}{" "}
            <span className="admin-sub">
              {data ? fmtSize(data.bytes) : ""}
              {data?.bucket ? ` in ${data.bucket}` : ""}
              {totalOrphans > 0 && ` · ${totalOrphans} unreferenced (${fmtSize(orphanBytes)})`}
            </span>
          </h3>
          <span className="as-head-btns">
            <label className="tk-toggle">
              <input type="checkbox" checked={onlyOrphans} onChange={(e) => setOnlyOrphans(e.target.checked)} />
              <span>Only unreferenced</span>
            </label>
            <button className="admin-ghost sm" type="button" onClick={load} disabled={!!busy}>
              {busy ? "Working…" : "Refresh"}
            </button>
          </span>
        </div>
        <input
          className="admin-input"
          style={{ marginTop: 10 }}
          placeholder="Filter by filename or path"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </section>

      {err && <div className="admin-err">{err}</div>}
      {msg && !err && <div className="rm-ok">{msg}</div>}

      {data == null && !err ? (
        <p className="admin-sub" style={{ padding: "20px 2px" }}>Reading storage…</p>
      ) : (
        groups.map((g) => (
          <section key={g.prefix} className="ops-card">
            <div className="ops-head">
              <h3>
                {g.label}{" "}
                <span className="admin-sub">
                  {g.count} {g.count === 1 ? "file" : "files"} · {fmtSize(g.bytes)}
                  {g.orphans > 0 && ` · ${g.orphans} unreferenced`}
                </span>
              </h3>
              <span className="admin-sub">{g.hint}</span>
            </div>

            {g.rows.length === 0 ? (
              <p className="admin-sub" style={{ marginTop: 10 }}>
                {g.count === 0 ? "Nothing stored here yet." : "Nothing matches the current filter."}
              </p>
            ) : (
              <div className="as-list">
                {g.rows.map((o) => (
                  <div key={o.key} className={`as-row${o.orphan && !o.system ? " orphan" : ""}`}>
                    {isImage(o.key) && !o.locked && (o.href || o.key.startsWith("media/")) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="as-thumb"
                        src={o.key.startsWith("media/") ? `/api/media/${o.key.slice("media/".length)}` : o.href}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="as-thumb as-ext">
                        {o.locked ? "\ud83d\udd12" : (o.key.split(".").pop() || "?").slice(0, 4)}
                      </span>
                    )}

                    <span className="as-main">
                      <span className="as-name">{o.key.replace(g.prefix, "")}</span>
                      <span className="as-meta">
                        {fmtSize(o.size)} · {fmtWhen(o.lastModified)}
                        {o.system && " · backup"}
                        {o.locked && " · encrypted, opens as ciphertext"}
                        {o.orphan && !o.system && " · nothing references this"}
                      </span>
                    </span>

                    <span className="as-btns">
                      {o.href && (
                        <a
                          className="admin-ghost sm"
                          href={
                            o.key.startsWith("media/")
                              ? `/api/media/${o.key.slice("media/".length)}`
                              : o.href
                          }
                          target="_blank"
                          rel="noreferrer"
                          title={
                            o.locked
                              ? "Encrypted — this downloads ciphertext. Open it from the Vault tab with your passphrase."
                              : "Open in a new tab"
                          }
                        >
                          Open
                        </a>
                      )}
                      <button className="admin-del" type="button" onClick={remove(o)} disabled={!!busy}>
                        ✕
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))
      )}

      <style jsx global>{`
        .as-head-btns {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .as-list {
          margin-top: 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .as-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 10px;
          border-radius: 10px;
          background: #101219;
          border: 1px solid transparent;
        }
        .as-row.orphan {
          border-color: #7a4a12;
          background: #17130a;
        }
        .as-thumb {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
          border-radius: 8px;
          object-fit: cover;
          border: 1px solid var(--a-line, #262a35);
          background: var(--a-void, #0a0b0f);
        }
        .as-ext {
          display: grid;
          place-items: center;
          font-family: "JetBrains Mono", monospace;
          font-size: 10px;
          color: var(--a-dim, #8b90a0);
          text-transform: lowercase;
        }
        .as-main {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
          flex: 1;
        }
        .as-name {
          font-size: 13px;
          color: var(--a-text, #e7e8ee);
          word-break: break-all;
        }
        .as-meta {
          font-size: 11.5px;
          color: var(--a-dim, #8b90a0);
        }
        .as-row.orphan .as-meta {
          color: #ffcd7a;
        }
        .as-btns {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
      `}</style>
    </main>
  );
}
