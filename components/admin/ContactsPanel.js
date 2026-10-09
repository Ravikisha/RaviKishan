// Contacts, imported from the LinkedIn data export (Connections.csv).
//
// LinkedIn gives you the file and nothing else — no API, no search worth using.
// This parses it in the browser and writes it to the private `contacts/`
// collection so the network becomes queryable: who do I know at this company,
// who did I connect with around the time I was last job-hunting.
//
// Nothing is uploaded anywhere except your own Firestore.
import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, doc, writeBatch, deleteDoc, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { logAdminAction } from "../../lib/auditLog";
// The one model, shared with the MCP tools and the tests. A second copy of
// "what counts as the same person" would drift within a week.
import {
  shapeContact,
  parseContactText,
  dedupeChannels,
  searchContacts,
  contactId as makeContactId,
  sameAs,
  primaryEmail,
} from "../../lib/server/contactShape";

const BATCH_LIMIT = 450; // Firestore caps a batch at 500 writes

// RFC4180-ish: handles quoted fields, escaped quotes and embedded newlines,
// all of which appear in a real LinkedIn export (company names with commas,
// notes with quotes).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}

// The export starts with a "Notes:" preamble before the real header, so the
// header row has to be found rather than assumed to be first.
export function parseConnections(text) {
  const rows = parseCsv(text);
  const headerIdx = rows.findIndex(
    (r) => r[0]?.trim().toLowerCase() === "first name" && r.length >= 4
  );
  if (headerIdx === -1) return { error: "No 'First Name' header row — is this Connections.csv?" };

  const header = rows[headerIdx].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iFirst = col("first name");
  const iLast = col("last name");
  const iUrl = col("url");
  const iEmail = col("email address");
  const iCompany = col("company");
  const iPosition = col("position");
  const iOn = col("connected on");

  const out = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const first = (r[iFirst] || "").trim();
    const last = (r[iLast] || "").trim();
    const url = (r[iUrl] || "").trim();
    if (!first && !last && !url) continue;
    out.push({
      name: `${first} ${last}`.trim(),
      first,
      last,
      url,
      email: (r[iEmail] || "").trim(),
      company: (r[iCompany] || "").trim(),
      position: (r[iPosition] || "").trim(),
      connectedOn: (r[iOn] || "").trim(),
    });
  }
  return { rows: out };
}

// Document id: the LinkedIn vanity slug, so re-importing updates a person in
// place instead of duplicating them.
export function contactId(c) {
  const slug = (c.url || "").replace(/\/+$/, "").split("/").pop();
  if (slug && /^[\w.-]{2,}$/.test(slug)) return slug.toLowerCase();
  const fallback = `${c.name}-${c.company}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return fallback.replace(/^-+|-+$/g, "").slice(0, 60) || "unknown";
}

export default function ContactsPanel({ user }) {
  const [rows, setRows] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "contacts"),
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (e) => setErr(e?.code || "read failed")
    );
    return () => unsub();
  }, []);

  const onFile = async (e) => {
    setErr("");
    setMsg("");
    setParsed(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = parseConnections(text);
      if (res.error) return setErr(res.error);
      if (!res.rows.length) return setErr("No connections found in that file.");
      setParsed(res.rows);
      setMsg(`Parsed ${res.rows.length} connections. Review, then import.`);
    } catch (e2) {
      setErr(e2?.message || "Could not read the file.");
    }
  };

  const doImport = async () => {
    if (!parsed) return;
    setErr("");
    setBusy("Importing…");
    try {
      let written = 0;
      for (let i = 0; i < parsed.length; i += BATCH_LIMIT) {
        const chunk = parsed.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);
        for (const c of chunk) {
          batch.set(doc(db, "contacts", contactId(c)), { ...c, importedAt: new Date().toISOString() }, { merge: true });
        }
        await batch.commit();
        written += chunk.length;
        setBusy(`Importing… ${written}/${parsed.length}`);
      }
      await logAdminAction({
        action: "contacts.import",
        detail: `${written} connections`,
        user,
      });
      setMsg(`✓ Imported ${written} connections.`);
      setParsed(null);
    } catch (e) {
      setErr(e?.message || "Import failed.");
    } finally {
      setBusy("");
    }
  };

  const remove = (r) => async () => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Remove ${r.name} from contacts?`)) return;
    try {
      await deleteDoc(doc(db, "contacts", r.id));
    } catch (e) {
      setErr(e?.message || "Delete failed.");
    }
  };

  const companies = useMemo(() => {
    const c = {};
    for (const r of rows || []) if (r.company) c[r.company] = (c[r.company] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [rows]);

  // Shaped once, so a LinkedIn import and a typed contact render identically
  // and the search sees channels, tags and notes rather than four scalars.
  const people = useMemo(() => (rows || []).map((r) => shapeContact(r, { id: r.id })), [rows]);

  const visible = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return people.slice(0, 100);
    try {
      return searchContacts(people, q, { limit: 100 });
    } catch (_) {
      // Fewer than two characters: show the head of the list rather than an
      // error, because the box is being typed into.
      return people.slice(0, 100);
    }
  }, [people, query]);

  return (
    <main className="admin-main">
      <AddContact people={people} user={user} onDone={(m) => setMsg(m)} onError={(e) => setErr(e)} />

      <section className="ops-card">
        <h3>Import from the LinkedIn export</h3>
        <p className="admin-sub">
          Pick <code>Connections.csv</code> out of your LinkedIn data export. It
          is parsed in this browser and written straight to your own Firestore —
          it is not uploaded anywhere else. Re-importing updates people in place
          rather than duplicating them.
        </p>
        <div className="ct-import">
          <input className="admin-input" type="file" accept=".csv,text/csv" onChange={onFile} />
          <button className="admin-primary" type="button" onClick={doImport} disabled={!parsed || !!busy}>
            {busy || (parsed ? `Import ${parsed.length}` : "Import")}
          </button>
        </div>
        {parsed && (
          <div className="ct-preview">
            {parsed.slice(0, 3).map((c, i) => (
              <div key={i} className="admin-sub">
                {c.name} · {c.position || "—"} · {c.company || "—"} · {c.connectedOn}
              </div>
            ))}
            <div className="admin-sub">…and {Math.max(0, parsed.length - 3)} more</div>
          </div>
        )}
      </section>

      {err && <div className="admin-err">{err}</div>}
      {msg && !err && <div className="rm-ok">{msg}</div>}

      {companies.length > 0 && (
        <section className="ops-card">
          <h3>Where your network works</h3>
          <div className="ct-companies">
            {companies.map(([name, n]) => (
              <button
                key={name}
                type="button"
                className="ct-chip"
                onClick={() => setQuery(name)}
                title={`Filter to ${name}`}
              >
                {name} <b>{n}</b>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="vt-toolbar">
        <input
          className="admin-search"
          placeholder="Search name, company, role…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="admin-sub" style={{ alignSelf: "center" }}>
          {rows == null ? "…" : `${rows.length} contacts`}
        </span>
      </div>

      {rows == null ? (
        <p className="admin-sub" style={{ padding: "20px 2px" }}>Loading…</p>
      ) : visible.length === 0 ? (
        <div className="inbox-empty">
          <p>{rows.length ? "No matches." : "No contacts imported yet."}</p>
          <span>{rows.length ? "Try another search." : "Pick Connections.csv above."}</span>
        </div>
      ) : (
        <div className="vt-list">
          {visible.map((r) => (
            <div key={r.id} className="vt-item">
              <div className="vt-main">
                {r.url ? (
                  <a className="vt-name" href={r.url} target="_blank" rel="noreferrer">{r.name}</a>
                ) : (
                  <span className="vt-name">{r.name}</span>
                )}
                {r.company && <span className="vt-cat">{r.company}</span>}
              </div>
              <div className="vt-meta">
                {r.position || "—"}
                {r.connectedOn ? ` · connected ${r.connectedOn}` : ""}
              </div>
              {r.channels?.length ? (
                <div className="ct-channels">
                  {r.channels.map((c) => (
                    <span className={`ct-ch ct-ch-${c.kind}`} key={`${c.kind}:${c.key}`}>
                      <i>{c.kind}</i>
                      {c.kind === "email" ? (
                        <a href={`mailto:${c.value}`}>{c.value}</a>
                      ) : c.kind === "phone" ? (
                        <a href={`tel:${c.value.replace(/[^\d+]/g, "")}`}>{c.value}</a>
                      ) : c.kind === "url" ? (
                        <a href={c.value} target="_blank" rel="noreferrer noopener">
                          {c.value.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        c.value
                      )}
                      {c.label ? <b>{c.label}</b> : null}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="vt-btns">
                <button className="admin-del" type="button" onClick={remove(r)}>✕</button>
              </div>
            </div>
          ))}
          {rows.length > visible.length && (
            <p className="admin-sub" style={{ padding: "8px 2px" }}>
              Showing {visible.length} of {rows.length} — narrow the search to see others.
            </p>
          )}
        </div>
      )}

      <ContactsStyles />
    </main>
  );
}

/* ================= adding one, in any form ================= */

// The point of this panel is no longer only the CSV. You can paste an e-mail
// signature, a line from a message, or just a phone number, and the channels
// are read out of it — the fields are there for correcting what it got, not
// for typing everything by hand.
export function AddContact({ people, user, onDone, onError, initialText = "" }) {
  // `initialText` exists only so /__contactspreview can show the parser mid-read
  // without a browser automating keystrokes into it.
  const [text, setText] = useState(initialText);
  const [open, setOpen] = useState(!!initialText);
  const [saving, setSaving] = useState(false);

  // Parsed on every keystroke so you can see what it understood BEFORE you
  // save. A parser you cannot see is one you stop trusting.
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return parseContactText(text);
    } catch (_) {
      return null;
    }
  }, [text]);

  const draft = useMemo(
    () => (parsed ? shapeContact({ ...parsed, source: "manual" }) : null),
    [parsed]
  );

  // Checked live, because discovering the duplicate after saving means two
  // records to merge instead of one decision to make.
  const clash = useMemo(
    () => (draft && draft.channels.length ? people.find((c) => sameAs(draft, c)) : null),
    [draft, people]
  );

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const taken = new Set(people.map((c) => c.id));
      let id = makeContactId(draft);
      for (let n = 2; taken.has(id); n++) id = makeContactId(draft, { suffix: String(n) });

      const now = new Date().toISOString();
      await setDoc(
        doc(db, "contacts", id),
        {
          name: draft.name,
          company: draft.company,
          position: draft.position,
          note: draft.note,
          tags: draft.tags,
          channels: draft.channels,
          source: "manual",
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
      await logAdminAction({
        action: "contacts.add",
        target: id,
        detail: draft.name || primaryEmail(draft),
        user,
      });
      setText("");
      setOpen(false);
      onDone(`Saved ${draft.name || primaryEmail(draft) || id}.`);
    } catch (e) {
      onError(e?.message || "Could not save that contact.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="ops-card ct-add">
      <ContactsStyles />
      <h3>Add a contact</h3>
      <p className="admin-sub">
        Paste anything — a signature, a line from a message, an address and a phone number.
        The ways of reaching them are read out of it; whatever is left becomes the note.
      </p>

      <textarea
        className="admin-input"
        placeholder={"Asha Menon\nStaff Engineer, Northwind\nasha@northwind.co.in | +91 98765 43210\nMet at the Rust meetup."}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
      />

      {open && draft ? (
        <>
          <div className="ct-parsed">
            <span className="ct-parsed-name">{draft.name || "(no name found)"}</span>
            {draft.channels.map((c) => (
              <span className={`ct-ch ct-ch-${c.kind}`} key={`${c.kind}:${c.key}`}>
                <i>{c.kind}</i>
                {c.value}
              </span>
            ))}
            {draft.channels.length === 0 ? (
              <span className="admin-sub">No address, phone or link found — it will be saved by name only.</span>
            ) : null}
          </div>

          {draft.note ? (
            <p className="admin-sub" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
              Note: {draft.note}
            </p>
          ) : null}

          {clash ? (
            <p className="ct-dupe">
              {clash.name || clash.id} already has one of those — saving this would be a second
              record for the same person. Add to them instead, or save anyway and merge later.
            </p>
          ) : null}

          <div className="ct-import">
            <button
              className="admin-primary"
              type="button"
              onClick={save}
              disabled={saving || (!draft.name && draft.channels.length === 0)}
            >
              {saving ? "Saving…" : clash ? "Save anyway" : "Save contact"}
            </button>
            <button className="admin-ghost" type="button" onClick={() => { setText(""); setOpen(false); }}>
              Clear
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

/* ================= styles ================= */

// Rendered by ContactsPanel AND by AddContact, because AddContact is used on
// its own in /__contactspreview and a stylesheet that only mounts with the
// whole panel is one that silently does not apply there. Same reason
// PostBodyStyles and TasksStyles exist as components.
export function ContactsStyles() {
  return (
    <style jsx global>{`
        .ct-add textarea {
          width: 100%;
          min-height: 132px;
          font-family: inherit;
          font-size: 13px;
          line-height: 1.5;
          resize: vertical;
        }
        .ct-parsed {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          align-items: center;
          margin-top: 10px;
        }
        .ct-parsed-name {
          font-family: "Space Grotesk", sans-serif;
          font-size: 14px;
          color: #e7e8ee;
          margin-right: 4px;
        }
        .ct-dupe {
          margin-top: 9px;
          font-size: 12px;
          color: #ffb020;
          line-height: 1.5;
        }
        .ct-channels {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 6px;
        }
        .ct-ch {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          border: 1px solid #262a35;
          border-radius: 999px;
          padding: 2px 9px;
          color: #b9bdca;
        }
        .ct-ch i {
          font-style: normal;
          font-size: 10px;
          color: #6b7285;
        }
        .ct-ch a {
          color: #b9bdca;
        }
        .ct-ch b {
          font-weight: 500;
          color: #6b7285;
        }
        .ct-ch-email {
          border-color: #2c3a33;
        }
        .ct-ch-phone {
          border-color: #3a3326;
        }
        .ct-import {
          display: flex;
          gap: 10px;
          align-items: center;
          margin-top: 10px;
          flex-wrap: wrap;
        }
        .ct-import .admin-input {
          flex: 1;
          min-width: 240px;
        }
        .ct-preview {
          margin-top: 10px;
          border-top: 1px solid #262a35;
          padding-top: 8px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .ct-companies {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }
        .ct-chip {
          border: 1px solid #262a35;
          background: #101219;
          color: #b9bdca;
          border-radius: 999px;
          padding: 5px 12px;
          font-size: 12px;
          cursor: pointer;
        }
        .ct-chip:hover {
          border-color: #ffb020;
        }
        .ct-chip b {
          color: #ffb020;
        }
      `}</style>
  );
}
