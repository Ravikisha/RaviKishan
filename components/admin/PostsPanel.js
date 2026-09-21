// The writing desk.
//
// Posts live in `posts/{slug}` — slug as the document id, so the URL and the
// record can never drift apart.
//
// Design: the thing you came here to do is write, so the headline is typed at
// headline size and everything that is not the words — slug, tags, cover,
// excerpt — folds into one "Front matter" line that states the resolved URL
// and opens only when you need it. Below the desk is the library, which is
// searchable because there are dozens of pieces in it and scrolling is not
// a way to find one.
//
// Written here and imported from dev.to stay two lists: an imported article
// cannot be pushed back until it is edited here, so their actions differ and
// one merged list made those buttons look arbitrary.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, getDoc, writeBatch } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { logAdminAction } from "../../lib/auditLog";
import PostBodyStyles from "../blog/PostBodyStyles";
import EditorStyles from "./EditorStyles";
import MarkdownToolbar, { countWords } from "./MarkdownToolbar";
import { slugify, SLUG_RE, readingMinutes, excerptFrom } from "../../lib/posts";
import { renderMarkdown } from "../../lib/markdown";

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
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all"); // all | draft | live
  const [frontOpen, setFrontOpen] = useState(false);
  const deskRef = useRef(null);

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
    // The library sits below the desk; editing from row 30 otherwise looks
    // like nothing happened.
    deskRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    const q = query.trim().toLowerCase();
    const all = (rows || []).filter((r) => {
      if (status === "draft" && r.published) return false;
      if (status === "live" && !r.published) return false;
      if (!q) return true;
      return [r.title, r.id, (r.tags || []).join(" "), r.excerpt]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    return [all.filter((r) => r.source !== "devto"), all.filter((r) => r.source === "devto")];
  }, [rows, query, status]);

  const filtering = !!query.trim() || status !== "all";

  const previewSlug = slugify(form.slug || form.title);
  const currentSource = editing ? (rows || []).find((r) => r.id === editing)?.source : null;

  // One row per piece. The row itself opens the editor — an "Edit" button on
  // a row whose only purpose is to be edited is a button that says "row".
  const Row = (r) => (
    <div
      key={r.id}
      className={`po-row ${r.published ? "live" : "draft"}${editing === r.id ? " on" : ""}`}
    >
      <button
        type="button"
        className="po-row-open"
        onClick={edit(r)}
        title="Open in the editor"
      >
        <span className="po-row-title">{r.title || r.id}</span>
        <span className="po-row-meta">
          <span className={`po-state ${r.published ? "live" : "draft"}`}>
            {r.published ? "Live" : "Draft"}
          </span>
          /blog/{r.id} · {r.readingTime || 1} min ·{" "}
          {r.published ? `published ${fmt(r.publishedAt)}` : `saved ${fmt(r.updatedAt)}`}
          {r.editedHere ? " · edited here" : ""}
          {r.devtoUrl && r.source !== "devto" ? " · copy on dev.to" : ""}
        </span>
      </button>

      <span className="ops-btns po-row-acts">
        {/* A draft is openable too: firestore.rules lets the admin read an
            unpublished post, and the page says plainly that it is a draft.
            Not being able to look at your own unfinished writing was the
            single most annoying thing about this panel. */}
        <a
          className="admin-ghost sm"
          href={`/blog/${r.id}`}
          target="_blank"
          rel="noreferrer"
        >
          {r.published ? "View" : "Preview"}
        </a>
        <button className="admin-ghost sm" type="button" onClick={togglePublish(r)}>
          {r.published ? "Unpublish" : "Publish"}
        </button>
        {/* An imported article already lives on dev.to; pushing it back would
            overwrite the original with our copy. */}
        {r.source !== "devto" && (
          <button
            className="admin-ghost sm"
            type="button"
            onClick={pushToDevto(r)}
            disabled={busy}
            title={r.devtoId ? "Update the dev.to copy" : "Publish a copy to dev.to"}
          >
            {r.devtoId ? "Sync dev.to" : "Send to dev.to"}
          </button>
        )}
        {r.devtoUrl && (
          <a className="admin-ghost sm" href={r.devtoUrl} target="_blank" rel="noreferrer">
            dev.to
          </a>
        )}
        <button className="admin-del" type="button" onClick={remove(r)} title="Delete">
          ✕
        </button>
      </span>
    </div>
  );

  return (
    <main className="admin-main">
      {/* shared with the article page and the design preview, so what the
          Preview pane shows is what the post will look like */}
      <PostBodyStyles />
      <EditorStyles />
      <section className="ops-card po-desk" ref={deskRef}>
        <div className="ops-head po-desk-head">
          <div>
            <h3>{editing ? "Editing a post" : "New post"}</h3>
            <p className="admin-sub po-desk-sub">
              {editing
                ? `Live at /blog/${editing} once published. The address is fixed — start a new post to change it.`
                : "Markdown in, article out. Nothing is public until you publish it."}
            </p>
          </div>
          <span className="po-head-btns">
            {editing && (
              <button className="admin-ghost" type="button" onClick={reset}>
                Start a new post
              </button>
            )}
            <button className="admin-ghost" type="button" onClick={loadDevto} disabled={busy}>
              {devto ? "Refresh dev.to" : "Show dev.to articles"}
            </button>
          </span>
        </div>

        {/* You type the headline at headline size. It is the one loud element
            on this panel and it doubles as a check on how the title will sit
            on the article page, where it is set in the same face. */}
        <input
          className="po-title"
          placeholder="Title"
          value={form.title}
          onChange={set("title")}
          aria-label="Post title"
        />

        <details
          className="po-front"
          open={frontOpen}
          onToggle={(e) => setFrontOpen(e.target.open)}
        >
          <summary>
            <span className="po-front-label">Front matter</span>
            <span className="po-front-summary">
              {previewSlug ? `/blog/${previewSlug}` : "no address yet"}
              {form.tags.trim() ? ` · ${form.tags.split(",").filter((t) => t.trim()).length} tags` : ""}
              {form.cover ? " · cover set" : " · no cover"}
              {form.excerpt.trim() ? " · custom excerpt" : ""}
            </span>
          </summary>

          <div className="po-front-body">
            <label className="po-field">
              <span>Address</span>
              <div className="po-slug">
                <span className="lk-prefix">/blog/</span>
                <input
                  className="admin-input"
                  placeholder="slug"
                  value={form.slug}
                  disabled={!!editing}
                  title={editing ? "The address is the URL — start a new post to change it." : ""}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set("slug")(e);
                  }}
                />
              </div>
            </label>

            <label className="po-field">
              <span>Tags</span>
              <input
                className="admin-input"
                placeholder="rust, distributed systems"
                value={form.tags}
                onChange={set("tags")}
              />
            </label>

            <label className="po-field po-wide">
              <span>Cover image</span>
              <div className="po-cover">
                <input
                  className="admin-input"
                  placeholder="Paste a URL, or upload one"
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
                    title="Remove the cover image"
                  >
                    ✕
                  </button>
                )}
              </div>
            </label>

            {form.cover && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="po-cover-thumb po-wide" src={form.cover} alt="" />
            )}

            <label className="po-field po-wide">
              <span>Excerpt</span>
              <input
                className="admin-input"
                placeholder="Leave blank to take the opening lines of the post"
                value={form.excerpt}
                onChange={set("excerpt")}
              />
            </label>
          </div>
        </details>

        <div className="po-editor">
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
                placeholder={"Write in Markdown.\n\n## A heading\n\nSome prose, `inline code`, and a fenced block:\n\n```rust\nfn main() {}\n```"}
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
                    ? renderMarkdown(form.body, { mangle: false, headerIds: false })
                    : '<p class="po-preview-empty">The preview shows the article exactly as it will publish. Start typing.</p>',
                }}
              />
            )}
          </div>
        </div>

        <div className="po-actions">
          <span className="admin-sub">
            {countWords(form.body)} words · {readingMinutes(form.body)} min read
            {previewSlug ? ` · /blog/${previewSlug}` : ""}
          </span>
          <span className="po-btns">
            <button className="admin-ghost" type="button" onClick={save(false)} disabled={busy}>
              Save draft
            </button>
            <button className="admin-primary" type="button" onClick={save(true)} disabled={busy}>
              {busy ? "Saving…" : editing && form.published ? "Update" : "Publish"}
            </button>
          </span>
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
                <div key={p.slug} className="ops-row post-list-row">
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

      <section className="ops-card po-library">
        <div className="ops-head po-lib-head">
          <div>
            <h3>Library</h3>
            <p className="admin-sub po-desk-sub">
              {rows == null
                ? "Loading…"
                : `${counts.pub} published · ${counts.draft} in draft · ${(rows || []).length} in total`}
            </p>
          </div>
          <div className="po-filters">
            <input
              className="admin-input po-search"
              placeholder="Search titles, addresses and tags"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="po-seg" role="group" aria-label="Filter by state">
              {[
                ["all", "All"],
                ["draft", "Drafts"],
                ["live", "Live"],
              ].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={status === k ? "on" : ""}
                  aria-pressed={status === k}
                  onClick={() => setStatus(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <h4 className="po-group">
          Written here <span>{mine.length}</span>
        </h4>
        {rows == null ? (
          <p className="admin-sub">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="admin-sub">
            {filtering
              ? "No post written here matches that."
              : "Nothing written here yet. The desk above is empty and waiting."}
          </p>
        ) : (
          <div className="ops-list">{mine.map(Row)}</div>
        )}

        {/* Imported articles behave differently — dev.to is their original, so
            they cannot be pushed back until they are edited here. There are
            far more of them than of anything written here, so the group is
            folded away until it is asked for. */}
        {imported.length > 0 && (
          <details className="po-group-fold" open={filtering}>
            <summary>
              <h4 className="po-group">
                Imported from dev.to <span>{imported.length}</span>
              </h4>
              <span className="admin-sub">dev.to stays their canonical source</span>
            </summary>
            <div className="ops-list">{imported.map(Row)}</div>
          </details>
        )}
      </section>

      {/* Only the library lives here. Everything that is also rendered by
          /__adminpreview — the desk, the tabs, the panes — is in
          EditorStyles so the two cannot drift. */}
      <style jsx global>{`
        /* ---------- library ---------- */
        /* A nested 420px scroller inside a page that already scrolls makes a
           list of forty pieces harder to read, not easier. */
        .po-library .ops-list {
          max-height: none;
          overflow: visible;
        }
        .po-lib-head {
          align-items: flex-start;
          gap: 14px;
          flex-wrap: wrap;
        }
        .po-filters {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }
        .po-search {
          width: 260px;
          max-width: 100%;
          padding: 8px 11px;
          font-size: 13px;
        }
        .po-seg {
          display: inline-flex;
          border: 1px solid var(--a-line, #262a35);
          border-radius: 9px;
          overflow: hidden;
        }
        .po-seg button {
          background: none;
          border: none;
          color: var(--a-dim, #8b90a0);
          font: inherit;
          font-size: 12.5px;
          padding: 8px 13px;
          cursor: pointer;
        }
        .po-seg button + button {
          border-left: 1px solid var(--a-line, #262a35);
        }
        .po-seg button:hover {
          color: var(--a-text, #e7e8ee);
        }
        .po-seg button.on {
          background: var(--a-amber, #ffb020);
          color: #1a1300;
          font-weight: 600;
        }

        .po-group {
          margin: 20px 0 10px;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--a-dim, #8b90a0);
        }
        .po-group span {
          margin-left: 7px;
          color: #5c6377;
          font-weight: 400;
        }
        .po-group-fold > summary {
          display: flex;
          align-items: baseline;
          gap: 12px;
          cursor: pointer;
          list-style: none;
        }
        .po-group-fold > summary::-webkit-details-marker {
          display: none;
        }
        .po-group-fold > summary .po-group::after {
          content: " — show";
          color: #5c6377;
          font-weight: 400;
        }
        .po-group-fold[open] > summary .po-group::after {
          content: " — hide";
        }

        /* ---------- a row ---------- */
        .po-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px 16px;
          background: #12151d;
          border: 1px solid #1e222c;
          /* The left edge carries the state: dashed while it is unfinished,
             solid once it is public, amber for the one open on the desk. It
             is the same left-edge language the content editor uses. */
          border-left-width: 3px;
          border-left-style: dashed;
          border-left-color: #333a49;
        }
        .po-row.live {
          border-left-style: solid;
          border-left-color: #2f3a4a;
        }
        .po-row.on {
          border-left-style: solid;
          border-left-color: var(--a-amber, #ffb020);
          background: #161a23;
        }
        .po-row-open {
          display: flex;
          flex-direction: column;
          gap: 5px;
          align-items: flex-start;
          text-align: left;
          min-width: 0;
          padding: 14px 4px 14px 16px;
          background: none;
          border: none;
          color: inherit;
          font: inherit;
          cursor: pointer;
          transition: transform 0.14s ease;
        }
        .po-row-open:hover {
          transform: translateX(3px);
        }
        .po-row-title {
          color: #f0f1f5;
          font-family: "Space Grotesk", system-ui, sans-serif;
          font-size: 14.5px;
          font-weight: 600;
          line-height: 1.3;
          overflow-wrap: anywhere;
        }
        .po-row-open:hover .po-row-title {
          color: var(--a-amber, #ffb020);
        }
        .po-row-meta {
          display: flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: 8px;
          color: var(--a-dim, #7d8496);
          font-size: 11.5px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }
        .po-state {
          font-weight: 600;
          letter-spacing: 0.01em;
        }
        .po-state.live {
          color: var(--a-amber, #ffb020);
        }
        .po-state.draft {
          color: #7d8496;
        }
        .po-row-acts {
          margin-left: 0;
          justify-content: flex-end;
          flex-wrap: wrap;
          gap: 6px;
          padding: 10px 14px 10px 0;
        }
        .po-row-acts .admin-ghost.sm {
          padding: 6px 10px;
          border-radius: 7px;
          font-size: 12px;
        }
        .po-row-acts .admin-del {
          width: 29px;
          height: 29px;
        }

        @media (max-width: 900px) {
          .po-front-body {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 680px) {
          .po-row {
            grid-template-columns: minmax(0, 1fr);
          }
          .po-row-acts {
            justify-content: flex-start;
            padding: 0 14px 12px 16px;
          }
          .po-search {
            width: 100%;
          }
          .po-filters {
            width: 100%;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .po-row-open,
          .po-front-label::before {
            transition: none;
          }
          .po-row-open:hover {
            transform: none;
          }
        }
      `}</style>
    </main>
  );
}
