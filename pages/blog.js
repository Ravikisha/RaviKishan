import React, { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { motion } from "framer-motion";
import { Heart, Clock, ArrowUpRight, PenLine } from "lucide-react";
import PageHeader from "../components/home2/PageHeader";
import ClosingCTA from "../components/home2/ClosingCTA";

const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const SourceBadge = ({ source }) => (
  <span
    className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${
      source === "Medium"
        ? "bg-fg/10 text-fg"
        : "bg-accent/15 text-accentText"
    }`}
  >
    {source}
  </span>
);

const PostCard = ({ p, i }) => (
  <motion.a
    href={p.url}
    target="_blank"
    rel="noopener noreferrer"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: (i % 6) * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    className="group flex flex-col overflow-hidden rounded-xl border border-edge bg-surface transition-colors hover:border-amber/40"
  >
    <div className="relative aspect-[16/9] overflow-hidden border-b border-edge bg-bg">
      {p.cover ? (
        <img
          src={p.cover}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <div className="grid h-full w-full place-items-center bg-gradient-to-br from-amber/10 to-transparent">
          <PenLine className="h-8 w-8 text-accentText/40" />
        </div>
      )}
      <div className="absolute left-3 top-3">
        <SourceBadge source={p.source} />
      </div>
    </div>

    <div className="flex flex-1 flex-col p-5">
      <p className="font-mono text-[11px] text-muted">{fmtDate(p.publishedAt)}</p>
      <h3 className="mt-2 font-display text-lg font-bold leading-snug text-fg group-hover:text-accentText">
        {p.title}
      </h3>
      {p.description && (
        <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">
          {p.description}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(p.tags || []).slice(0, 3).map((t) => (
          <span
            key={t}
            className="rounded-md border border-edge bg-bg px-2 py-0.5 font-mono text-[10px] text-muted"
          >
            {t}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-4 border-t border-edge pt-3 font-mono text-[11px] text-muted">
        {p.reactions > 0 && (
          <span className="flex items-center gap-1">
            <Heart className="h-3 w-3" /> {p.reactions}
          </span>
        )}
        {p.readingTime && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {p.readingTime} min
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-accentText opacity-0 transition-opacity group-hover:opacity-100">
          Read <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  </motion.a>
);

const Skeleton = () => (
  <div className="flex flex-col overflow-hidden rounded-xl border border-edge bg-surface">
    <div className="aspect-[16/9] animate-pulse bg-edge/40" />
    <div className="space-y-3 p-5">
      <div className="h-3 w-24 animate-pulse rounded bg-edge/40" />
      <div className="h-4 w-full animate-pulse rounded bg-edge/40" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-edge/40" />
    </div>
  </div>
);

// dev.to is CORS-friendly — fallback if the /api route isn't available
// (e.g. a fully static export). Medium can only come from the API route.
async function clientDevtoFallback() {
  const r = await fetch("https://dev.to/api/articles?username=ravikishan&per_page=100");
  if (!r.ok) throw new Error("devto");
  const data = await r.json();
  return data.map((a) => ({
    title: a.title,
    url: a.url,
    description: a.description || "",
    cover: a.cover_image || a.social_image || null,
    publishedAt: a.published_at,
    tags: a.tag_list || [],
    readingTime: a.reading_time_minutes || null,
    reactions: a.positive_reactions_count || 0,
    source: "dev.to",
  }));
}

const Blog = () => {
  const [posts, setPosts] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/blogs");
        if (!r.ok) throw new Error("api");
        const d = await r.json();
        if (!cancelled) {
          setPosts(d.posts || []);
          setStatus("ok");
        }
      } catch {
        try {
          const fallback = await clientDevtoFallback();
          if (!cancelled) {
            setPosts(fallback);
            setStatus("ok");
          }
        } catch {
          if (!cancelled) setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sources = useMemo(
    () => ["all", ...Array.from(new Set(posts.map((p) => p.source)))],
    [posts]
  );
  const shown = filter === "all" ? posts : posts.filter((p) => p.source === filter);

  return (
    <>
      <Head>
        <title>Blog — Ravi Kishan</title>
        <meta
          name="description"
          content="Writing by Ravi Kishan on systems programming, distributed systems and building developer tools from scratch — from dev.to and Medium."
        />
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>

      <main className="bg-bg font-sans text-fg antialiased">
        <PageHeader
          eyebrow="Writing"
          title="Notes from"
          accent="building things."
          subtitle="Deep-dives on the systems I build from scratch — runtimes, search engines, container runtimes and more. Pulled live from dev.to and Medium, de-duplicated."
        >
          {status === "ok" && posts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {sources.map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`rounded-full border px-4 py-1.5 font-mono text-xs capitalize transition-colors ${
                    filter === s
                      ? "border-accent bg-accent text-accentFg"
                      : "border-edge bg-surface text-muted hover:text-fg"
                  }`}
                >
                  {s === "all" ? `All · ${posts.length}` : s}
                </button>
              ))}
            </div>
          )}
        </PageHeader>

        <section className="bg-bg py-16">
          <div className="mx-auto max-w-6xl px-6">
            {status === "loading" && (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} />
                ))}
              </div>
            )}

            {status === "error" && (
              <div className="mx-auto max-w-md rounded-xl border border-edge bg-surface p-10 text-center">
                <PenLine className="mx-auto h-8 w-8 text-muted" />
                <p className="mt-4 text-sm text-muted">
                  Couldn&apos;t load the posts right now. Read them directly on{" "}
                  <a
                    href="https://dev.to/ravikishan"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accentText hover:underline"
                  >
                    dev.to
                  </a>{" "}
                  or{" "}
                  <a
                    href="https://medium.com/@ravikishan63392"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accentText hover:underline"
                  >
                    Medium
                  </a>
                  .
                </p>
              </div>
            )}

            {status === "ok" && (
              <motion.div
                layout
                className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
              >
                {shown.map((p, i) => (
                  <PostCard key={p.url || i} p={p} i={i} />
                ))}
              </motion.div>
            )}
          </div>
        </section>

        <ClosingCTA />
      </main>
    </>
  );
};

export default Blog;
