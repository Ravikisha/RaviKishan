// One search box across everything.
//
// The admin grew six separate search boxes — vault, contacts, jobs, posts,
// links, inbox — and "where did I put that" became a question of which tab to
// guess first. This searches them all at once and jumps you to the right tab.
//
// Firestore has no cross-collection search, so this loads each collection once
// and filters in memory. That is fine at this scale (~1,100 contacts is the
// biggest, a few hundred KB) and it means substring matching works on every
// field rather than only on prefixes of an indexed one.
import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../lib/firebase";

// collection → how to turn a document into a search result
const SOURCES = [
  {
    name: "vault",
    tab: "vault",
    kind: "Document",
    title: (r) => r.filename,
    sub: (r) => [r.category, (r.tags || []).join(", "), r.note].filter(Boolean).join(" · "),
    text: (r) => [r.filename, r.category, r.note, ...(r.tags || [])],
  },
  {
    name: "jobs",
    tab: "jobs",
    kind: "Job",
    title: (r) => `${r.role} at ${r.company}`,
    sub: (r) => [r.stage, r.location, r.appliedAt].filter(Boolean).join(" · "),
    text: (r) => [r.company, r.role, r.location, r.notes, r.jdText, r.stage],
  },
  {
    name: "contacts",
    tab: "contacts",
    kind: "Contact",
    title: (r) => r.name,
    sub: (r) => [r.position, r.company].filter(Boolean).join(" · "),
    text: (r) => [r.name, r.company, r.position, r.email],
    href: (r) => r.url || null,
  },
  {
    name: "posts",
    tab: "posts",
    kind: "Post",
    title: (r) => r.title,
    sub: (r) => `${r.published ? "live" : "draft"} · /blog/${r.id}`,
    text: (r) => [r.title, r.excerpt, r.body, ...(r.tags || [])],
    href: (r) => (r.published ? `/blog/${r.id}` : null),
  },
  {
    name: "links",
    tab: "links",
    kind: "Link",
    title: (r) => `/l/${r.id}`,
    sub: (r) => [r.title, r.url, `${r.clicks || 0} clicks`].filter(Boolean).join(" · "),
    text: (r) => [r.id, r.title, r.url],
    href: (r) => `/l/${r.id}`,
  },
  {
    name: "mail",
    tab: "inbox",
    kind: "Mail",
    title: (r) => r.subject || `Message from ${r.name || "someone"}`,
    sub: (r) => [r.name, r.email].filter(Boolean).join(" · "),
    text: (r) => [r.name, r.email, r.subject, r.message],
  },
  {
    name: "myportifilio",
    tab: "inbox",
    kind: "Contact form",
    title: (r) => `${r.name || "Someone"} wrote in`,
    sub: (r) => [r.email, r.message].filter(Boolean).join(" · ").slice(0, 120),
    text: (r) => [r.name, r.email, r.message, r.subject],
  },
];

const hay = (vals) => vals.filter(Boolean).join(" ").toLowerCase();

export default function SearchPanel({ onJump }) {
  const [data, setData] = useState({});
  const [q, setQ] = useState("");
  const [errs, setErrs] = useState({});

  useEffect(() => {
    const unsubs = SOURCES.map((src) =>
      onSnapshot(
        collection(db, src.name),
        (snap) =>
          setData((d) => ({
            ...d,
            [src.name]: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
          })),
        (e) => setErrs((x) => ({ ...x, [src.name]: e?.code || "read failed" }))
      )
    );
    return () => unsubs.forEach((u) => u());
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    const out = [];
    for (const src of SOURCES) {
      for (const r of data[src.name] || []) {
        const text = hay(src.text(r));
        if (!text.includes(term)) continue;
        // Rank a title hit above a body hit, so "zimyo" surfaces the offer
        // letter before a job note that merely mentions it.
        const titleHit = String(src.title(r) || "").toLowerCase().includes(term);
        out.push({
          key: `${src.name}/${r.id}`,
          kind: src.kind,
          tab: src.tab,
          title: src.title(r) || "(untitled)",
          sub: src.sub(r) || "",
          href: src.href ? src.href(r) : null,
          score: titleHit ? 0 : 1,
        });
      }
    }
    return out.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title)).slice(0, 80);
  }, [q, data]);

  const loaded = Object.keys(data).length;
  const totalDocs = Object.values(data).reduce((n, arr) => n + arr.length, 0);
  const failed = Object.keys(errs);

  const byKind = useMemo(() => {
    const c = {};
    for (const r of results) c[r.kind] = (c[r.kind] || 0) + 1;
    return c;
  }, [results]);

  return (
    <main className="admin-main">
      <input
        className="admin-input sr-box"
        autoFocus
        placeholder="Search everything — documents, jobs, contacts, posts, links, messages…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <p className="admin-sub sr-meta">
        {loaded < SOURCES.length ? "Loading…" : `${totalDocs.toLocaleString("en-US")} records indexed`}
        {failed.length > 0 && ` · couldn't read: ${failed.join(", ")}`}
        {results.length > 0 &&
          ` · ${Object.entries(byKind).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ")}`}
      </p>

      {q.trim().length >= 2 && results.length === 0 && (
        <div className="inbox-empty">
          <p>Nothing matches “{q.trim()}”.</p>
        </div>
      )}

      <div className="vt-list">
        {results.map((r) => (
          <div key={r.key} className="vt-item">
            <div className="vt-main">
              <span className="vt-cat">{r.kind}</span>
              <span className="vt-name">{r.title}</span>
            </div>
            <div className="vt-meta">{r.sub}</div>
            <div className="vt-btns">
              {r.href && (
                <a className="admin-ghost sm" href={r.href} target="_blank" rel="noreferrer">
                  Open
                </a>
              )}
              <button className="admin-ghost sm" type="button" onClick={() => onJump?.(r.tab)}>
                Go to {r.tab}
              </button>
            </div>
          </div>
        ))}
      </div>

      <style jsx global>{`
        .sr-box {
          font-size: 15px;
          padding: 13px 15px;
        }
        .sr-meta {
          margin: 8px 2px 14px;
        }
      `}</style>
    </main>
  );
}
