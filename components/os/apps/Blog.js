// Blog, rendered as a desktop-OS app.
//
// LOCAL ONLY, like the routed /blog page. This used to fetch dev.to directly
// and every card carried a "dev.to ↗" badge that sent the reader off the site
// — on a portfolio, that is handing your visitor to someone else's product at
// the moment they were most interested.
//
// Now it reads the same Firestore library the public index reads, and a post
// opens IN THIS WINDOW.
//
// It must not be a routed <Link>. DesktopOS is mounted from _app.js on every
// route, so in dev mode it is a full-screen overlay that survives a
// client-side navigation: routing to /blog/<slug> changed the URL and rendered
// the article underneath, while the desktop stayed painted on top and the
// reader saw nothing happen at all. Every other desktop app — Projects, Files,
// Certificates — keeps its detail view inside its own window, and this was the
// only one that did not.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clock, PenLine } from "lucide-react";
import { fetchPublishedPosts, toListItem, readingMinutes } from "../../../lib/posts";
import { renderMarkdown } from "../../../lib/markdown";
import PostBodyStyles from "../../blog/PostBodyStyles";

const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
};

export default function Blog() {
  // The raw documents, because the reader needs the body and toListItem drops
  // it. The list shapes are derived below.
  const [rows, setRows] = useState(null); // null = loading
  const [tag, setTag] = useState("all");
  const [openSlug, setOpenSlug] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetchPublishedPosts()
      .then((docs) => {
        if (cancelled) return;
        setRows(
          docs.sort(
            (a, b) =>
              new Date(b.publishedAt || b.updatedAt || 0) -
              new Date(a.publishedAt || a.updatedAt || 0)
          )
        );
      })
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const posts = useMemo(() => (rows || []).map(toListItem), [rows]);
  const current = useMemo(
    () => (openSlug ? (rows || []).find((r) => (r.slug || r.id) === openSlug) : null),
    [rows, openSlug]
  );

  // A fresh article starts at the top, not wherever the library was scrolled.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [openSlug]);

  // Escape closes the article before it closes the window.
  useEffect(() => {
    if (!openSlug) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpenSlug(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openSlug]);

  const tags = useMemo(() => {
    const c = {};
    (posts || []).forEach((p) => (p.tags || []).forEach((t) => (c[t] = (c[t] || 0) + 1)));
    return ["all", ...Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t)];
  }, [posts]);

  const shown = useMemo(() => {
    const all = posts || [];
    return tag === "all" ? all : all.filter((p) => (p.tags || []).includes(tag));
  }, [posts, tag]);

  const [lead, ...rest] = shown;

  if (rows === null) {
    return (
      <div className="bg-bg p-8 text-center font-sans text-sm text-muted">Loading…</div>
    );
  }

  if (!rows.length) {
    return (
      <div className="grid min-h-full place-content-center gap-2 bg-bg p-10 text-center font-sans">
        <PenLine className="mx-auto h-5 w-5 text-muted" />
        <p className="text-sm font-semibold text-fg">Nothing published yet</p>
        <p className="text-xs text-muted">New writing shows up here automatically.</p>
      </div>
    );
  }

  const Card = ({ p, big }) => (
    <button
      type="button"
      className={`blga-card${big ? " lead" : ""}`}
      onClick={() => setOpenSlug(p.url.replace("/blog/", ""))}
    >
      {p.cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="blga-cover" src={p.cover} alt="" loading="lazy" />
      )}
      <div className="blga-body">
        <h3 className={big ? "blga-lead-title" : "blga-title"}>{p.title}</h3>
        {p.description && <p className="blga-deck">{p.description}</p>}
        <div className="blga-meta">
          <time>{fmtDate(p.publishedAt)}</time>
          {p.readingTime ? (
            <span className="blga-mins">
              <Clock className="h-3 w-3" />
              {p.readingTime} min
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );

  return (
    <div className="blga">
      {/* The article renders through the same marked call and the same
          .post-body stylesheet as the routed page, so a piece read here looks
          like the piece read on the site. */}
      <PostBodyStyles />

      {current ? (
        <>
          <header className="blga-head">
            <button type="button" className="blga-back" onClick={() => setOpenSlug(null)}>
              <ArrowLeft className="h-3.5 w-3.5" />
              All writing
            </button>
            <span className="blga-count blga-reading">
              {current.readingTime || readingMinutes(current.body)} min read
            </span>
          </header>

          <div className="blga-scroll" ref={scrollRef}>
            <article className="blga-reader">
              <h1>{current.title}</h1>
              <div className="blga-reader-meta">
                <time>{fmtDate(current.publishedAt)}</time>
                {(current.tags || []).slice(0, 4).map((t) => (
                  <span key={t} className="blga-chip">
                    {t}
                  </span>
                ))}
              </div>
              {current.cover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="blga-reader-cover" src={current.cover} alt="" />
              )}
              <div
                className="post-body"
                // Authored by the single allow-listed admin through the CMS,
                // exactly as on the routed article page.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(current.body || "") }}
              />
            </article>
          </div>
        </>
      ) : (
        <>
          <header className="blga-head">
            <span className="blga-count">
              {posts.length} {posts.length === 1 ? "piece" : "pieces"}
            </span>
            <nav className="blga-filters">
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={tag === t ? "on" : ""}
                  onClick={() => setTag(t)}
                >
                  {t === "all" ? "Everything" : t}
                </button>
              ))}
            </nav>
          </header>

          <div className="blga-scroll" ref={scrollRef}>
            {lead && <Card p={lead} big />}
            {rest.length > 0 && (
              <div className="blga-grid">
                {rest.map((p) => (
                  <Card key={p.url} p={p} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <style jsx global>{`
        .blga {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--c-bg);
          color: var(--c-fg);
          font-family: Inter, sans-serif;
        }
        .blga-head {
          position: sticky;
          top: 0;
          z-index: 2;
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          padding: 11px 16px;
          border-bottom: 1px solid var(--c-edge);
          background: var(--c-surface);
        }
        .blga-count {
          font-size: 12px;
          color: var(--c-muted);
        }
        .blga-filters {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-left: auto;
        }
        .blga-filters button {
          border: 1px solid var(--c-edge);
          background: var(--c-bg);
          color: var(--c-muted);
          border-radius: 999px;
          padding: 3px 11px;
          font: inherit;
          font-size: 11.5px;
          cursor: pointer;
        }
        .blga-filters button.on {
          background: var(--c-accent);
          border-color: var(--c-accent);
          color: var(--c-accent-fg);
          font-weight: 600;
        }
        .blga-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .blga-card {
          display: block;
          width: 100%;
          text-align: left;
          font: inherit;
          padding: 0;
          cursor: pointer;
          text-decoration: none;
          color: inherit;
          border: 1px solid var(--c-edge);
          border-radius: 12px;
          overflow: hidden;
          background: var(--c-surface);
          transition: border-color 0.15s;
        }
        .blga-card:hover {
          border-color: var(--c-accent);
        }
        .blga-cover {
          width: 100%;
          height: 150px;
          object-fit: cover;
          display: block;
        }
        .blga-card.lead .blga-cover {
          height: 210px;
        }
        .blga-body {
          padding: 13px 15px 15px;
        }
        .blga-title,
        .blga-lead-title {
          color: var(--c-fg);
          font-family: "Space Grotesk", sans-serif;
          letter-spacing: -0.02em;
          margin: 0;
        }
        .blga-title {
          font-size: 14.5px;
          font-weight: 600;
          line-height: 1.3;
        }
        .blga-lead-title {
          font-size: 21px;
          font-weight: 700;
          line-height: 1.2;
        }
        .blga-deck {
          margin: 7px 0 0;
          font-size: 12.5px;
          line-height: 1.55;
          color: var(--c-muted);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .blga-meta {
          margin-top: 10px;
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 11px;
          color: var(--c-muted);
        }
        .blga-mins {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .blga-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
          gap: 14px;
        }

        /* ---- reader ---- */
        .blga-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid var(--c-edge);
          background: var(--c-bg);
          color: var(--c-fg);
          border-radius: 999px;
          padding: 4px 12px 4px 9px;
          font: inherit;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
        }
        .blga-back:hover {
          border-color: var(--c-accent);
          color: var(--c-accent-text);
        }
        .blga-reading {
          margin-left: auto;
        }
        .blga-reader {
          max-width: 68ch;
          margin: 0 auto;
          padding-bottom: 40px;
        }
        .blga-reader h1 {
          color: var(--c-fg);
          font-family: "Space Grotesk", sans-serif;
          font-size: clamp(1.5rem, 3.4vw, 2.1rem);
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.12;
          margin: 4px 0 0;
        }
        .blga-reader-meta {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin: 12px 0 18px;
          font-size: 11.5px;
          color: var(--c-muted);
        }
        .blga-chip {
          border: 1px solid var(--c-edge);
          border-radius: 999px;
          padding: 2px 9px;
        }
        .blga-reader-cover {
          width: 100%;
          border: 1px solid var(--c-edge);
          border-radius: 12px;
          margin-bottom: 22px;
          display: block;
        }
        /* The article stylesheet widens code, images and tables to the whole
           column at >=1080px of VIEWPORT, which is wider than this window. */
        .blga-reader .post-body pre,
        .blga-reader .post-body img,
        .blga-reader .post-body table {
          max-width: 100%;
        }
      `}</style>
    </div>
  );
}
