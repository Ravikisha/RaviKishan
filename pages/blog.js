// Writing index.
//
// LOCAL ONLY. Every post listed here lives on this site and opens on this site.
// There is no external fetch and no outbound link: a reader who clicks a piece
// of writing on ravikishan.me stays on ravikishan.me.
//
// The dev.to archive is pulled in ONCE, in the admin (Writing → Import all),
// and from then on these are our copies. Imported posts still credit dev.to as
// their canonical source on the article page itself — that is attribution for
// search engines, not navigation away from the site.
//
// Presentation: not a card grid. The newest piece gets the display treatment,
// everything after it is a dense row list — the shape of a contents page
// rather than a shop. Rows carry what a reader actually sorts on: title, one
// line of what it is, and how long it takes.
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Seo from "../components/Seo";
import ClosingCTA from "../components/home2/ClosingCTA";
import { fetchPublishedPosts, toListItem } from "../lib/posts";
import { track } from "../lib/analytics";

const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
};

export default function Blog() {
  const router = useRouter();
  const [posts, setPosts] = useState([]);
  const [status, setStatus] = useState("loading");
  const [tag, setTag] = useState("all");

  useEffect(() => {
    const t = router.query?.tag;
    if (typeof t === "string" && t) setTag(t);
  }, [router.query?.tag]);

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
        setStatus("ok");
      })
      .catch(() => {
        if (cancelled) return;
        setPosts([]);
        setStatus("ok");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const topTags = useMemo(() => {
    const c = {};
    posts.forEach((p) => (p.tags || []).forEach((t) => (c[t] = (c[t] || 0) + 1)));
    return Object.entries(c)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([t]) => t);
  }, [posts]);

  const shown = tag === "all" ? posts : posts.filter((p) => (p.tags || []).includes(tag));
  const [lead, ...rest] = shown;

  const setFilter = (t) => () => {
    setTag(t);
    router.replace({ pathname: "/blog", query: t === "all" ? {} : { tag: t } }, undefined, {
      shallow: true,
    });
  };

  const Entry = ({ p, big }) => {
    const inner = (
      <>
        {p.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={big ? "wr-lead-cover" : "wr-row-cover"} src={p.cover} alt="" />
        )}
        <h2 className={big ? "wr-lead-title" : "wr-row-title"}>{p.title}</h2>
        {p.description && <p className={big ? "wr-lead-deck" : "wr-row-deck"}>{p.description}</p>}
        <div className="wr-line">
          <time>{fmtDate(p.publishedAt)}</time>
          {p.readingTime ? (
            <>
              <span className="wr-rule" aria-hidden="true" />
              <span>{p.readingTime} min</span>
            </>
          ) : null}
        </div>
      </>
    );
    // Always an internal route. Nothing on this page leaves the site.
    return (
      <Link href={p.url}>
        <a className={big ? "wr-lead" : p.cover ? "wr-row wr-row-with-cover" : "wr-row"}>{inner}</a>
      </Link>
    );
  };

  return (
    <>
      <Seo
        title="Writing — Ravi Kishan"
        description="Essays on distributed systems, systems programming and applied AI — building runtimes, interpreters and infrastructure from first principles."
        path="/blog"
      />

      <main className="wr">
        <header className="wr-head">
          <h1>Writing</h1>
          <p>
            Notes from taking systems apart — runtimes, interpreters, schedulers
            and the occasional thing that went wrong in production.
          </p>
          {topTags.length > 0 && (
            <div className="wr-filters">
              <button type="button" className={tag === "all" ? "on" : ""} onClick={setFilter("all")}>
                Everything
              </button>
              {topTags.map((t) => (
                <button key={t} type="button" className={tag === t ? "on" : ""} onClick={setFilter(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </header>

        {status === "loading" ? (
          <p className="wr-empty">Loading…</p>
        ) : posts.length === 0 ? (
          <p className="wr-empty">
            Nothing published yet. New writing appears here as soon as it goes live.
          </p>
        ) : shown.length === 0 ? (
          <p className="wr-empty">
            Nothing tagged “{tag}”.{" "}
            <button type="button" className="wr-link" onClick={setFilter("all")}>
              Show everything
            </button>
          </p>
        ) : (
          <div className="wr-body">
            {lead && <Entry p={lead} big />}
            {rest.length > 0 && (
              <ol className="wr-rows">
                {rest.map((p) => (
                  <li key={p.url}>
                    <Entry p={p} />
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        <ClosingCTA />
      </main>

      <style jsx global>{`
        .wr {
          background: var(--c-bg);
          color: var(--c-fg);
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .wr-head {
          max-width: 1060px;
          margin: 0 auto;
          padding: clamp(46px, 8vw, 92px) 24px 26px;
        }
        .wr-head h1 {
          color: var(--c-fg);
          font-family: "Space Grotesk", sans-serif;
          font-weight: 700;
          font-size: clamp(2.6rem, 8vw, 4.6rem);
          letter-spacing: -0.045em;
          line-height: 0.95;
          margin: 0;
        }
        .wr-head > p {
          margin: 18px 0 0;
          color: var(--c-muted);
          font-size: clamp(1rem, 1.7vw, 1.15rem);
          line-height: 1.6;
          max-width: 52ch;
        }
        .wr-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 26px;
        }
        .wr-filters button {
          border: 1px solid var(--c-edge);
          background: var(--c-surface);
          color: var(--c-muted);
          border-radius: 999px;
          padding: 5px 13px;
          font-size: 12.5px;
          font-family: inherit;
          cursor: pointer;
          transition: border-color 0.15s, color 0.15s;
        }
        .wr-filters button:hover {
          color: var(--c-fg);
          border-color: var(--c-muted);
        }
        .wr-filters button.on {
          color: var(--c-accent-fg);
          background: var(--c-accent);
          border-color: var(--c-accent);
          font-weight: 600;
        }

        .wr-body {
          max-width: 1060px;
          margin: 0 auto;
          padding: 8px 24px 0;
        }

        /* The newest piece is the only one that gets display type. */
        .wr-lead {
          display: block;
          text-decoration: none;
          color: inherit;
          padding: 30px 0 34px;
          border-top: 2px solid var(--c-fg);
          border-bottom: 1px solid var(--c-edge);
        }
        .wr-lead-title {
          color: var(--c-fg);
          font-family: "Space Grotesk", sans-serif;
          font-weight: 700;
          font-size: clamp(1.9rem, 4.6vw, 3.1rem);
          line-height: 1.04;
          letter-spacing: -0.035em;
          margin: 0;
          max-width: 20ch;
          text-wrap: balance;
        }
        .wr-lead:hover .wr-lead-title,
        .wr-row:hover .wr-row-title {
          color: var(--c-accent-text);
        }
        .wr-lead-cover {
          display: block;
          width: 100%;
          max-height: 360px;
          margin: 0 0 28px;
          object-fit: cover;
          border: 1px solid var(--c-edge);
        }
        .wr-lead-deck {
          margin: 14px 0 0;
          color: var(--c-muted);
          font-size: 1.05rem;
          line-height: 1.6;
          max-width: 56ch;
        }

        .wr-rows {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .wr-rows li + li .wr-row {
          border-top: 1px solid var(--c-edge);
        }
        .wr-row {
          display: grid;
          grid-template-columns: 1fr;
          text-decoration: none;
          color: inherit;
          padding: 22px 0;
          /* The row shifts right on hover rather than lifting into a card —
             a list of writing is an index, not a product grid. */
          transition: padding-left 0.18s cubic-bezier(0.2, 0.9, 0.3, 1);
        }
        .wr-row:hover {
          padding-left: 14px;
        }
        .wr-row-cover {
          display: block;
          width: 132px;
          height: 82px;
          margin: 0 0 14px;
          object-fit: cover;
          border: 1px solid var(--c-edge);
        }
        @media (min-width: 620px) {
          .wr-row-with-cover {
            grid-template-columns: 132px minmax(0, 1fr);
            column-gap: 20px;
          }
          .wr-row-with-cover .wr-row-cover {
            grid-row: 1 / span 3;
            margin: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .wr-row {
            transition: none;
          }
          .wr-row:hover {
            padding-left: 0;
          }
        }
        .wr-row-title {
          color: var(--c-fg);
          font-family: "Space Grotesk", sans-serif;
          font-weight: 600;
          font-size: clamp(1.15rem, 2.4vw, 1.5rem);
          line-height: 1.24;
          letter-spacing: -0.022em;
          margin: 0;
          max-width: 34ch;
        }
        .wr-row-deck {
          margin: 7px 0 0;
          color: var(--c-muted);
          font-size: 0.95rem;
          line-height: 1.55;
          max-width: 62ch;
        }
        .wr-line {
          margin-top: 12px;
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 12px;
          color: var(--c-muted);
        }
        .wr-rule {
          width: 18px;
          height: 1px;
          background: var(--c-edge);
        }

        .wr-empty {
          max-width: 1060px;
          margin: 0 auto;
          padding: 40px 24px 80px;
          color: var(--c-muted);
        }
        .wr-link {
          background: none;
          border: none;
          padding: 0;
          font: inherit;
          color: var(--c-accent-text);
          cursor: pointer;
          text-decoration: underline;
        }
      `}</style>
    </>
  );
}
