// Write and publish posts natively, instead of only linking out to dev.to and
// Medium. Posts live in `posts/{slug}` — slug as the document id, so the URL
// and the record can never drift apart.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, getDoc, writeBatch } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { logAdminAction } from "../../lib/auditLog";
import { marked } from "marked";
import PostBodyStyles from "../blog/PostBodyStyles";
import EditorStyles from "./EditorStyles";
import MarkdownToolbar, { countWords } from "./MarkdownToolbar";
import { slugify, SLUG_RE, readingMinutes, excerptFrom } from "../../lib/posts";

const nowISO = () => new Date().toISOString();
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString() : "—");

const BLANK = {
  title: "",
  slug: "",
  body: "",
  tags: "",
  cover: "",
  excerpt: "",
  published: false,
  publishedAt: "",
};

export default function PostsPanel({ user }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [editing, setEditing] = useState(null); // slug being edited, or null
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const bodyRef = useRef(null);
  const imgRef = useRef(null);
  const coverRef = useRef(null);
  const [pane, setPane] = useState("write"); // write | preview | split
  const [devto, setDevto] = useState(null); // dev.to articles, once fetched

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "posts"),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        arr.sort((a, b) =>
          (b.publishedAt || b.updatedAt || "").localeCompare(a.publishedAt || a.updatedAt || "")
        );
        setRows(arr);
      },
      (e) => setErr(e?.code || "read failed")
    );
    return () => unsub();
  }, []);

  const set = (k) => (e) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => {
      const next = { ...f, [k]: v };
      // Auto-slug from the title until the slug is edited by hand, and never
      // for an existing post — changing the slug would orphan its URL.
      if (k === "title" && !slugTouched && !editing) next.slug = slugify(v);
      return next;
    });
  };

  const reset = () => {
    setForm(BLANK);
    setEditing(null);
    setSlugTouched(false);
  };

  const edit = (r) => () => {
    setForm({
      title: r.title || "",
      slug: r.slug || r.id,
      body: r.body || "",
      tags: (r.tags || []).join(", "),
      cover: r.cover || "",
      excerpt: r.excerpt || "",
      published: !!r.published,
      publishedAt: r.publishedAt || "",
    });
    setEditing(r.id);
    setSlugTouched(true);
    setMsg("");
    setErr("");
  };

  const authed = async (url, body) => {
    const u = auth.currentUser;
    if (!u) throw new Error("Not signed in.");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await u.getIdToken()}`,
      },
      body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  };

  // Show what is on dev.to BEFORE importing any of it. Seeing the list and
  // its import state is more useful than a blind "import everything" button,
  // and it makes a partial import obvious.
  const loadDevto = async () => {
    setErr("");
    setBusy(true);
    try {
      const { posts } = await authed("/api/devto/list");
      setDevto(posts);
      setMsg(`Found ${posts.length} articles on dev.to.`);
    } catch (e) {
      setErr(e?.message || "Could not reach dev.to.");
    } finally {
      setBusy(false);
    }
  };

  const importOne = (p) => async () => {
    setErr("");
    setBusy(true);
    try {
      await setDoc(doc(db, "posts", p.slug), p, { merge: true });
      await logAdminAction({ action: "post.import", target: `/blog/${p.slug}`, detail: p.title, user });
      setMsg(`\u2713 Imported "${p.title}".`);
    } catch (e) {
      setErr(e?.message || "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  // Pull everything already on dev.to into Firestore so it reads on this site
  // instead of only linking out. Imported posts keep dev.to as their canonical
  // URL — dev.to published them first.
  const importDevto = async () => {
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      const { posts, count, duplicates } = await authed("/api/devto/list");
      const batch = writeBatch(db);
      for (const p of posts) {
        if (!p.slug) continue;
        // merge:true so a re-import refreshes bodies without discarding
        // anything added here (cover image choices, extra tags).
        batch.set(doc(db, "posts", p.slug), p, { merge: true });
      }
      await batch.commit();
      await logAdminAction({ action: "post.import", detail: `${count} from dev.to`, user });
      setMsg(
        `✓ Imported ${count} articles from dev.to.` +
          (duplicates?.length ? ` Note: duplicate slugs merged — ${duplicates.join(", ")}.` : "")
      );
    } catch (e) {
      setErr(e?.message || "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  // Push a post here up to dev.to. The dev.to copy gets canonical_url back to
  // this site, because a post written here is the original.
  const pushToDevto = (r) => async () => {
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      const out = await authed("/api/devto/publish", { post: { ...r, slug: r.id } });
      await setDoc(
        doc(db, "posts", r.id),
        { devtoId: out.id, devtoUrl: out.url, crossPostedAt: new Date().toISOString() },
        { merge: true }
      );
      await logAdminAction({
        action: "post.crosspost",
        target: `/blog/${r.id}`,
        detail: `${out.action} on dev.to`,
        user,
      });
      setMsg(`✓ ${out.action === "created" ? "Published to" : "Updated on"} dev.to — ${out.url}`);
    } catch (e) {
      setErr(e?.message || "Cross-post failed.");
    } finally {
      setBusy(false);
    }
  };

  // Upload an image and drop the Markdown at the cursor. Bytes go to the
  // private bucket under media/ and are served through /api/media/, so the URL
  // is permanent and lives on this domain.
  // `target` decides where the uploaded URL lands: inline in the body at the
  // cursor, or in the cover field. Same storage path either way.
  const uploadImage = (target) => async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\//.test(file.type)) return setErr("That is not an image.");
    if (file.size > 8 * 1024 * 1024) return setErr("Images must be under 8 MB.");

    setErr("");
    setBusy(true);
    try {
      const name = file.name.replace(/[^\w.-]+/g, "_").slice(-60);
      const key = `media/blog/${Date.now()}-${name}`;
      const { url, publicUrl } = await authed("/api/media/sign", { key });
      const put = await fetch(url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!put.ok) throw new Error(`Upload rejected (HTTP ${put.status}).`);

      if (target === "cover") {
        setForm((f) => ({ ...f, cover: publicUrl }));
        setMsg("✓ Cover image set.");
      } else {
        const md = `\n![${file.name.replace(/\.[^.]+$/, "")}](${publicUrl})\n`;
        const ta = bodyRef.current;
        if (ta) {
          const at = ta.selectionStart ?? form.body.length;
          setForm((f) => ({ ...f, body: f.body.slice(0, at) + md + f.body.slice(at) }));
        } else {
          setForm((f) => ({ ...f, body: f.body + md }));
        }
        setMsg("✓ Image inserted into the post.");
      }
    } catch (e2) {
      setErr(e2?.message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const save = (publish) => async () => {
    setErr("");
    setMsg("");
    const slug = slugify(form.slug || form.title);
    if (!form.title.trim()) return setErr("A title is required.");
    if (!SLUG_RE.test(slug))
      return setErr("Slug must be 2–60 lowercase letters, numbers or dashes.");
    if (!form.body.trim()) return setErr("The post body is empty.");

    setBusy(true);
    try {
      if (!editing) {
        const existing = await getDoc(doc(db, "posts", slug));
        if (existing.exists()) {
          setBusy(false);
          return setErr(`/blog/${slug} already exists — pick another slug.`);
        }
      }
      const published = publish ?? form.published;
      const record = {
        title: form.title.trim(),
        slug,
        body: form.body,
        excerpt: form.excerpt.trim() || excerptFrom(form.body),
        cover: form.cover.trim(),
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        readingTime: readingMinutes(form.body),
        published,
        // Provenance survives an edit here: an imported post stays attributed
        // to dev.to (and keeps its canonical) unless it is edited, at which
        // point `editedHere` unlocks pushing the change back.
        ...(editing && currentSource ? { source: currentSource, editedHere: true } : {}),
        // First publish stamps the date; later edits keep it, so republishing
        // doesn't jump a post back to the top of the index.
        publishedAt: published ? form.publishedAt || nowISO() : form.publishedAt || "",
        updatedAt: nowISO(),
        author: user?.email || "",
      };
      await setDoc(doc(db, "posts", slug), record, { merge: true });
      await logAdminAction({
        action: published ? "post.publish" : "post.draft",
        target: `/blog/${slug}`,
        detail: record.title,
        user,
      });
      setMsg(
        published ? `✓ Published — /blog/${slug}` : `✓ Saved as a draft — not public yet.`
      );
      reset();
    } catch (e) {
      setErr(e?.message || "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const togglePublish = (r) => async () => {
    try {
      await setDoc(
        doc(db, "posts", r.id),
        {
          published: !r.published,
          publishedAt: !r.published ? r.publishedAt || nowISO() : r.publishedAt || "",
          updatedAt: nowISO(),
        },
        { merge: true }
      );
      await logAdminAction({
        action: !r.published ? "post.publish" : "post.unpublish",
        target: `/blog/${r.id}`,
        detail: r.title,
        user,
      });
    } catch (e) {
      setErr(e?.message || "Update failed.");
    }
  };

  const remove = (r) => async () => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete "${r.title}"? Anyone linking to /blog/${r.id} will get a 404.`))
      return;
    try {
      await deleteDoc(doc(db, "posts", r.id));
      await logAdminAction({ action: "post.delete", target: `/blog/${r.id}`, detail: r.title, user });
      if (editing === r.id) reset();
    } catch (e) {
      setErr(e?.message || "Delete failed.");
    }
  };

  const counts = useMemo(() => {
    const pub = (rows || []).filter((r) => r.published).length;
    return { pub, draft: (rows || []).length - pub };
  }, [rows]);

  // Written here vs pulled in from dev.to. They behave differently — an
  // imported article cannot be pushed back until it is edited here — so
  // mixing them in one list made the buttons look arbitrary.
  const [mine, imported] = useMemo(() => {
    const all = rows || [];
    return [all.filter((r) => r.source !== "devto"), all.filter((r) => r.source === "devto")];
  }, [rows]);

  const previewSlug = slugify(form.slug || form.title);
  const currentSource = editing ? (rows || []).find((r) => r.id === editing)?.source : null;

  return (
    <main className="admin-main">
      {/* shared with the article page and the design preview, so what the
          Preview pane shows is what the post will look like */}
      <PostBodyStyles />
      <EditorStyles />
      <section className="ops-card">
        <div className="ops-head">
          <h3>{editing ? `Editing /blog/${editing}` : "New post"}</h3>
          <span className="po-head-btns">
            {editing && (
              <button className="admin-ghost" type="button" onClick={reset}>
                New post instead
              </button>
            )}
            <button className="admin-ghost" type="button" onClick={loadDevto} disabled={busy}>
              {devto ? "Refresh dev.to" : "Show dev.to articles"}
            </button>
          </span>
        </div>

        <div className="po-form">
          <input className="admin-input" placeholder="Title *" value={form.title} onChange={set("title")} />
          <div className="po-slug">
            <span className="lk-prefix">/blog/</span>
            <input
              className="admin-input"
              placeholder="slug"
              value={form.slug}
              disabled={!!editing}
              title={editing ? "The slug is the URL — create a new post to change it." : ""}
              onChange={(e) => {
                setSlugTouched(true);
                set("slug")(e);
              }}
            />
          </div>
          <input className="admin-input" placeholder="Tags (comma separated)" value={form.tags} onChange={set("tags")} />
          <div className="po-cover">
            <input
              className="admin-input"
              placeholder="Cover image — paste a URL or upload"
              value={form.cover}
              onChange={set("cover")}
            />
            <label className="admin-ghost po-img">
              Upload
              <input
                ref={coverRef}
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={uploadImage("cover")}
              />
            </label>
            {form.cover && (
              <button
                type="button"
                className="admin-del"
                onClick={() => setForm((f) => ({ ...f, cover: "" }))}
                title="Remove cover"
              >
                ✕
              </button>
            )}
          </div>
          {form.cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="po-cover-thumb po-wide" src={form.cover} alt="" />
          )}
          <input
            className="admin-input po-wide"
            placeholder="Excerpt — leave blank to derive it from the body"
            value={form.excerpt}
            onChange={set("excerpt")}
          />
          <div className="po-wide po-editor">
            <div className="po-tabs" role="tablist">
              {[
                ["write", "Write"],
                ["preview", "Preview"],
                ["split", "Side by side"],
              ].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={pane === k}
                  className={pane === k ? "on" : ""}
                  onClick={() => setPane(k)}
                >
                  {label}
                </button>
              ))}
              <label className="admin-ghost po-img po-tabs-img">
                Insert image
                <input
                  ref={imgRef}
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  onChange={uploadImage("body")}
                />
              </label>
            </div>

            {pane !== "preview" && (
              <MarkdownToolbar
                textareaRef={bodyRef}
                value={form.body}
                onChange={(v) => setForm((f) => ({ ...f, body: v }))}
              >
                <span className="mdt-count">
                  {countWords(form.body)} words · {readingMinutes(form.body)} min
                </span>
              </MarkdownToolbar>
            )}

            <div className={`po-panes ${pane}`}>
              {pane !== "preview" && (
                <textarea
                  ref={bodyRef}
                  className="admin-input po-body"
                  rows={20}
                  placeholder={"# Markdown\n\nHeadings, **bold**, `code`, ```fenced blocks```, lists, tables, links, images.\n\nDrop an image in with the button above."}
                  value={form.body}
                  onChange={set("body")}
                />
              )}
              {pane !== "write" && (
                // The preview renders through the SAME marked call and the
                // same .post-body styles as the live article, so what you see
                // here is what the page will actually look like.
                <div
                  className="po-preview post-body"
                  dangerouslySetInnerHTML={{
                    __html: form.body.trim()
                      ? marked.parse(form.body, { mangle: false, headerIds: false })
                      : '<p class="po-preview-empty">Nothing to preview yet.</p>',
                  }}
                />
              )}
            </div>
          </div>
          <div className="po-wide po-actions">
            <span className="admin-sub">
              {readingMinutes(form.body)} min read
              {previewSlug ? ` · /blog/${previewSlug}` : ""}
            </span>
            <span className="po-btns">
              <button className="admin-ghost" type="button" onClick={save(false)} disabled={busy}>
                Save draft
              </button>
              <button className="admin-primary" type="button" onClick={save(true)} disabled={busy}>
                {busy ? "Saving…" : "Publish"}
              </button>
            </span>
          </div>
        </div>
      </section>

      {err && <div className="admin-err">{err}</div>}
      {msg && !err && <div className="rm-ok">{msg}</div>}

      {devto && (
        <section className="ops-card">
          <div className="ops-head">
            <h3>
              On dev.to{" "}
              <span className="admin-sub">
                {devto.length} articles ·{" "}
                {devto.filter((p) => (rows || []).some((r) => r.id === p.slug)).length} already here
              </span>
            </h3>
            <button className="admin-primary" type="button" onClick={importDevto} disabled={busy}>
              {busy ? "Working…" : "Import all"}
            </button>
          </div>
          <div className="ops-list">
            {devto.map((p) => {
              const here = (rows || []).some((r) => r.id === p.slug);
              return (
                <div key={p.slug} className="ops-row">
                  <span className="vt-name">{p.title}</span>
                  <span className={`jb-stage ${here ? "live" : "dim"}`}>
                    {here ? "Imported" : "Not here yet"}
                  </span>
                  <span className="admin-sub">
                    {(p.publishedAt || "").slice(0, 10)} · {p.readingTime} min
                    {p.tags?.length ? ` · ${p.tags.join(", ")}` : ""}
                  </span>
                  <span className="ops-btns">
                    {p.devtoUrl && (
                      <a className="admin-ghost sm" href={p.devtoUrl} target="_blank" rel="noreferrer">
                        dev.to
                      </a>
                    )}
                    <button
                      className="admin-ghost sm"
                      type="button"
                      onClick={importOne(p)}
                      disabled={busy}
                      title={here ? "Re-import and refresh the body" : "Copy this article into the site"}
                    >
                      {here ? "Re-import" : "Import"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="ops-card">
        <div className="ops-head">
          <h3>
            Written here <span className="admin-sub">{mine.length}</span>
          </h3>
          <span className="admin-sub">
            {counts.pub} published · {counts.draft} draft in total
          </span>
        </div>
        {rows == null ? (
          <p className="admin-sub">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="admin-sub">
            Nothing written here yet. Start one above, or import your dev.to archive.
          </p>
        ) : (
          <div className="ops-list">
            {mine.map((r) => (
              <div key={r.id} className="ops-row">
                <span className="vt-name">{r.title}</span>
                <span className={`jb-stage ${r.published ? "live" : "dim"}`}>
                  {r.published ? "Live" : "Draft"}
                </span>
                <span className="admin-sub">
                  /blog/{r.id} · {fmt(r.publishedAt)} · {r.readingTime || 1} min
                  {r.source === "devto" && " · from dev.to"}
                  {r.devtoUrl && r.source !== "devto" && " · cross-posted"}
                </span>
                <span className="ops-btns">
                  {r.published && (
                    <a className="admin-ghost sm" href={`/blog/${r.id}`} target="_blank" rel="noreferrer">
                      View
                    </a>
                  )}
                  <button className="admin-ghost sm" type="button" onClick={edit(r)}>
                    Edit
                  </button>
                  <button className="admin-ghost sm" type="button" onClick={togglePublish(r)}>
                    {r.published ? "Unpublish" : "Publish"}
                  </button>
                  {/* An imported article already lives on dev.to; pushing it
                      back would overwrite the original with our copy. */}
                  {r.source !== "devto" && (
                    <button
                      className="admin-ghost sm"
                      type="button"
                      onClick={pushToDevto(r)}
                      disabled={busy}
                      title={r.devtoId ? "Update the dev.to copy" : "Publish a copy to dev.to"}
                    >
                      {r.devtoId ? "Sync dev.to" : "→ dev.to"}
                    </button>
                  )}
                  {r.devtoUrl && (
                    <a className="admin-ghost sm" href={r.devtoUrl} target="_blank" rel="noreferrer">
                      dev.to
                    </a>
                  )}
                  <button className="admin-del" type="button" onClick={remove(r)}>
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Imported articles live in their own list: dev.to is their original,
          so they cannot be pushed back until they are edited here, and mixing
          them with locally-written posts made those buttons look arbitrary. */}
      {imported.length > 0 && (
        <section className="ops-card">
          <div className="ops-head">
            <h3>
              Imported from dev.to <span className="admin-sub">{imported.length}</span>
            </h3>
            <span className="admin-sub">dev.to stays their canonical source</span>
          </div>
          <div className="ops-list">
            {imported.map((r) => (
              <div key={r.id} className="ops-row">
                <span className="vt-name">{r.title}</span>
                <span className={`jb-stage ${r.published ? "live" : "dim"}`}>
                  {r.published ? "Live" : "Draft"}
                </span>
                <span className="admin-sub">
                  /blog/{r.id} · {fmt(r.publishedAt)} · {r.readingTime || 1} min
                  {r.editedHere && " · edited here"}
                </span>
                <span className="ops-btns">
                  {r.published && (
                    <a className="admin-ghost sm" href={`/blog/${r.id}`} target="_blank" rel="noreferrer">
                      View
                    </a>
                  )}
                  <button className="admin-ghost sm" type="button" onClick={edit(r)}>
                    Edit
                  </button>
                  <button className="admin-ghost sm" type="button" onClick={togglePublish(r)}>
                    {r.published ? "Unpublish" : "Publish"}
                  </button>
                  {r.devtoUrl && (
                    <a className="admin-ghost sm" href={r.devtoUrl} target="_blank" rel="noreferrer">
                      dev.to
                    </a>
                  )}
                  <button className="admin-del" type="button" onClick={remove(r)}>
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <style jsx global>{`
        .mdt-count {
          margin-left: auto;
          font-size: 11.5px;
          color: var(--a-dim, #7d8496);
          padding-right: 4px;
        }
        .po-form {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 12px;
        }
        @media (max-width: 900px) {
          .po-form {
            grid-template-columns: 1fr;
          }
        }
        .po-wide {
          grid-column: 1 / -1;
        }
        .po-slug {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .po-body {
          font-family: "JetBrains Mono", monospace;
          font-size: 12.5px;
          line-height: 1.6;
        }
        .po-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .po-btns {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .po-head-btns {
          display: flex;
          gap: 8px;
        }

      `}</style>
    </main>
  );
}
