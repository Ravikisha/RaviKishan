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
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Seo from "../components/Seo";
import ClosingCTA from "../components/home2/ClosingCTA";
import { fetchPublishedPosts, toListItem } from "../lib/posts";
import { fetchPublishedPostsServer } from "../lib/server/publicPosts";
import { track } from "../lib/analytics";

const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
};

export default function Blog({ initialPosts = [] }) {
  const router = useRouter();
  // Prerendered, so the archive is crawlable as a plain list of links rather
  // than an empty page that only fills in once JavaScript has run.
  const [posts, setPosts] = useState(initialPosts);
  const [status, setStatus] = useState(initialPosts.length ? "ok" : "loading");
  const [error, setError] = useState("");
  const [tag, setTag] = useState("all");
  const [search, setSearch] = useState("");
  // Full-text search over the whole archive, bodies included.
  //
  // Pagefind was the other candidate and cannot work here: it indexes static
  // HTML at build time, and these posts are fetched from Firestore in the
  // browser, so the built page contains a loading state and nothing else.
  // FlexSearch indexes at runtime, which fits a runtime-rendered archive.
  //
  // Indexing the bodies is free: fetchPublishedPosts already pulls the full
  // documents, and this page was simply throwing the body away.
  const indexRef = useRef(null);
  const bodiesRef = useRef([]);
  const [hits, setHits] = useState(null); // null = not searching
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const t = router.query?.tag;
    if (typeof t === "string" && t) setTag(t);
  }, [router.query?.tag]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError("");
    fetchPublishedPosts()
      .then((rows) => {
        if (cancelled) return;
        bodiesRef.current = rows.map((r) => ({
          id: r.slug || r.id,
          title: r.title || "",
          excerpt: r.excerpt || "",
          tags: (r.tags || []).join(" "),
          body: r.body || "",
        }));
        // A new archive invalidates whatever was indexed.
        indexRef.current = null;
        setPosts(
          rows
            .map(toListItem)
            .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
        );
        setStatus("ok");
      })
      .catch((e) => {
        if (cancelled) return;
        setPosts([]);
        setError(e?.message || "Could not load the writing archive.");
        setStatus("error");
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

  const searchTerm = search.trim();

  // The index is built on the first keystroke, not on page load: a reader who
  // never searches should not download a search engine.
  useEffect(() => {
    if (!searchTerm) {
      setHits(null);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    (async () => {
      if (!indexRef.current) {
        const { Document } = await import("flexsearch");
        const idx = new Document({
          tokenize: "forward",
          document: { id: "id", index: ["title", "excerpt", "tags", "body"] },
        });
        for (const doc of bodiesRef.current) idx.add(doc);
        if (cancelled) return;
        indexRef.current = idx;
      }
      const res = await indexRef.current.searchAsync(searchTerm, { limit: 100 });
      if (cancelled) return;
      setHits(new Set(res.flatMap((r) => r.result)));
      setSearching(false);
    })().catch(() => {
      if (!cancelled) {
        // Never leave the reader staring at an archive that refuses to filter.
        setHits(null);
        setSearching(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [searchTerm]);

  const lowered = searchTerm.toLowerCase();
  const shown = posts.filter((p) => {
    const matchesTag = tag === "all" || (p.tags || []).includes(tag);
    if (!matchesTag) return false;
    if (!searchTerm) return true;
    if (hits) return hits.has(p.url.replace("/blog/", ""));
    // Until the index is ready, fall back to the obvious substring match so
    // typing feels immediate rather than dead.
    return [p.title, p.description, ...(p.tags || [])]
      .join(" ")
      .toLowerCase()
      .includes(lowered);
  });
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
          <img
            className={big ? "wr-lead-cover" : "wr-row-cover"}
            src={p.cover}
            alt=""
            loading={big ? "eager" : "lazy"}
            decoding="async"
          />
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
          <label className="wr-search">
            <span>Search writing</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search every word of every piece"
            />
          </label>
          {searchTerm && status === "ok" && (
            <p className="wr-count" role="status" aria-live="polite">
              {searching
                ? "Searching…"
                : `${shown.length} ${shown.length === 1 ? "piece" : "pieces"} matching “${searchTerm}”`}
            </p>
          )}
        </header>

        {status === "loading" ? (
          <p className="wr-empty">Loading…</p>
        ) : status === "error" ? (
          <div className="wr-empty wr-error">
            <p>{error}</p>
            <button type="button" className="wr-link" onClick={() => window.location.reload()}>
              Try again
            </button>
          </div>
        ) : posts.length === 0 ? (
          <p className="wr-empty">
            Nothing published yet. New writing appears here as soon as it goes live.
          </p>
        ) : shown.length === 0 ? (
          <p className="wr-empty">
            {search
              ? `Nothing in the archive mentions “${search}”.`
              : `No writing carries the “${tag}” tag.`}{" "}
            <button type="button" className="wr-link" onClick={() => { setSearch(""); setFilter("all")(); }}>
              Clear filters
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
        .wr-count {
          margin: 10px 0 0;
          font-size: 12.5px;
          color: var(--c-muted);
          font-variant-numeric: tabular-nums;
        }
        .wr-search {
          display: flex;
          align-items: center;
          gap: 12px;
          max-width: 440px;
          margin-top: 24px;
          color: var(--c-muted);
          font-size: 12px;
        }
        .wr-search span {
          white-space: nowrap;
        }
        .wr-search input {
          width: 100%;
          min-width: 0;
          border: 1px solid var(--c-edge);
          border-radius: 8px;
          background: var(--c-surface);
          color: var(--c-fg);
          padding: 9px 11px;
          font: inherit;
          outline: none;
        }
        .wr-search input:focus {
          border-color: var(--c-accent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-accent) 18%, transparent);
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
                    aspect-ratio: 2.4 / 1;
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
                    aspect-ratio: 1.6 / 1;
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
        .wr-error p {
          margin: 0 0 10px;
        }
        @media (max-width: 520px) {
          .wr-search {
            align-items: stretch;
            flex-direction: column;
            gap: 6px;
          }
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

export async function getStaticProps() {
  try {
    const rows = await fetchPublishedPostsServer();
    return { props: { initialPosts: rows.map(toListItem) }, revalidate: 300 };
  } catch (_) {
    return { props: { initialPosts: [] }, revalidate: 60 };
  }
}
