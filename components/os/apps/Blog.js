// Blog, rendered as a desktop-OS app.
//
// LOCAL ONLY, like the routed /blog page. This used to fetch dev.to directly
// and every card carried a "dev.to ↗" badge that sent the reader off the site
// — on a portfolio, that is handing your visitor to someone else's product at
// the moment they were most interested.
//
// Now it reads the same Firestore library the public index reads, and a card
// opens the post here.
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock, PenLine } from "lucide-react";
import { fetchPublishedPosts, toListItem } from "../../../lib/posts";

const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
};

export default function Blog() {
  const [posts, setPosts] = useState(null); // null = loading
  const [tag, setTag] = useState("all");

  useEffect(() => {
    let cancelled = false;
    fetchPublishedPosts()
      .then((rows) => {
        if (cancelled) return;
        setPosts(
          rows
            .map(toListItem)
            .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
        );
      })
      .catch(() => !cancelled && setPosts([]));
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (posts === null) {
    return (
      <div className="bg-bg p-8 text-center font-sans text-sm text-muted">Loading…</div>
    );
  }

  if (!posts.length) {
    return (
      <div className="grid min-h-full place-content-center gap-2 bg-bg p-10 text-center font-sans">
        <PenLine className="mx-auto h-5 w-5 text-muted" />
        <p className="text-sm font-semibold text-fg">Nothing published yet</p>
        <p className="text-xs text-muted">New writing shows up here automatically.</p>
      </div>
    );
  }

  const Card = ({ p, big }) => (
    <Link href={p.url}>
      <a className={`blga-card${big ? " lead" : ""}`}>
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
      </a>
    </Link>
  );

  return (
    <div className="blga">
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

      <div className="blga-scroll">
        {lead && <Card p={lead} big />}
        {rest.length > 0 && (
          <div className="blga-grid">
            {rest.map((p) => (
              <Card key={p.url} p={p} />
            ))}
          </div>
        )}
      </div>

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
      `}</style>
    </div>
  );
}
