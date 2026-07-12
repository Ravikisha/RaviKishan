import React, { useEffect, useMemo, useState } from "react";
import { Heart, Clock, ArrowUpRight, PenLine } from "lucide-react";
import { blogPosts as seed } from "../../../lib/blogPosts";

// Blog, rendered as a desktop-OS app. Same live sourcing the /blog page uses
// (api/blogs → dev.to → seed fallback), reflowed for a window: sticky toolbar
// with tag filter, a featured lead, then a card grid. In recruiter mode the
// routed /blog page is used instead; this app is the dev-mode surface.
const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
};

const seedNorm = seed.map((s) => ({
  title: s.title, url: s.url, medium: s.medium || null,
  description: s.excerpt || "", cover: s.image || null,
  publishedAt: s.date, tags: s.tags || [],
  readingTime: s.readMins || null, reactions: s.reactions || 0, source: "dev.to",
}));

async function liveDevto() {
  const r = await fetch("https://dev.to/api/articles?username=ravikishan&per_page=100");
  if (!r.ok) throw new Error("devto");
  const data = await r.json();
  const medByKey = {};
  seedNorm.forEach((s) => { if (s.medium) medByKey[s.title.toLowerCase().slice(0, 30)] = s.medium; });
  return data.map((a) => ({
    title: a.title, url: a.url,
    medium: medByKey[a.title.toLowerCase().slice(0, 30)] || null,
    description: a.description || "", cover: a.cover_image || a.social_image || null,
    publishedAt: a.published_at, tags: a.tag_list || [],
    readingTime: a.reading_time_minutes || null,
    reactions: a.positive_reactions_count || 0, source: "dev.to",
  }));
}

const SourceLinks = ({ p }) => (
  <span className="ml-auto flex items-center gap-2">
    <a
      href={p.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-md border border-edge bg-bg px-2 py-0.5 font-mono text-[10px] font-semibold text-accentText transition-colors hover:border-amber/50"
    >
      dev.to <ArrowUpRight className="h-3 w-3" />
    </a>
    {p.medium && (
      <a
        href={p.medium}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded-md border border-edge bg-bg px-2 py-0.5 font-mono text-[10px] font-semibold text-fg transition-colors hover:border-muted"
      >
        Medium <ArrowUpRight className="h-3 w-3" />
      </a>
    )}
  </span>
);

const Meta = ({ p }) => (
  <>
    {p.reactions > 0 && (
      <span className="flex items-center gap-1"><Heart className="h-3 w-3" /> {p.reactions}</span>
    )}
    {p.readingTime && (
      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {p.readingTime} min</span>
    )}
  </>
);

const Cover = ({ src, className }) =>
  src ? (
    <img src={src} alt="" loading="lazy" className={className}
      onError={(e) => { e.currentTarget.style.display = "none"; }} />
  ) : (
    <div className={`grid place-items-center bg-gradient-to-br from-amber/10 to-transparent ${className}`}>
      <PenLine className="h-8 w-8 text-accentText/40" />
    </div>
  );

const Featured = ({ p }) => (
  <div
    onClick={() => window.open(p.url, "_blank")}
    className="group mb-6 grid cursor-pointer grid-cols-1 overflow-hidden rounded-2xl border border-edge bg-surface transition-colors hover:border-amber/40 sm:grid-cols-[1.1fr_1fr]"
  >
    <div className="relative aspect-[16/10] overflow-hidden border-b border-edge bg-bg sm:border-b-0 sm:border-r">
      <Cover src={p.cover} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
      <span className="absolute left-4 top-4 rounded-md bg-accent px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-accentFg">
        Latest
      </span>
    </div>
    <div className="flex flex-col justify-center p-6">
      <p className="font-mono text-[11px] text-muted">{fmtDate(p.publishedAt)}</p>
      <h2 className="mt-2 font-display text-xl font-bold leading-tight text-fg group-hover:text-accentText sm:text-2xl">
        {p.title}
      </h2>
      {p.description && (
        <p className="mt-3 overflow-hidden text-sm leading-relaxed text-muted"
           style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
          {p.description}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {(p.tags || []).slice(0, 4).map((t) => (
          <span key={t} className="rounded-md border border-edge bg-bg px-2 py-0.5 font-mono text-[10px] text-muted">{t}</span>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-4 border-t border-edge pt-4 font-mono text-[11px] text-muted">
        <Meta p={p} />
        <SourceLinks p={p} />
      </div>
    </div>
  </div>
);

const PostCard = ({ p }) => (
  <div
    onClick={() => window.open(p.url, "_blank")}
    className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-edge bg-surface transition-colors hover:border-amber/40"
  >
    <div className="relative aspect-[16/9] overflow-hidden border-b border-edge bg-bg">
      <Cover src={p.cover} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
      {p.medium && (
        <span className="absolute right-3 top-3 rounded-md bg-bg/85 px-2 py-0.5 font-mono text-[10px] font-semibold text-muted backdrop-blur">
          ×2 platforms
        </span>
      )}
    </div>
    <div className="flex flex-1 flex-col p-5">
      <p className="font-mono text-[11px] text-muted">{fmtDate(p.publishedAt)}</p>
      <h3 className="mt-2 font-display text-base font-bold leading-snug text-fg group-hover:text-accentText">{p.title}</h3>
      {p.description && (
        <p className="mt-2 flex-1 overflow-hidden text-sm leading-relaxed text-muted"
           style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {p.description}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {(p.tags || []).slice(0, 3).map((t) => (
          <span key={t} className="rounded-md border border-edge bg-bg px-2 py-0.5 font-mono text-[10px] text-muted">{t}</span>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-4 border-t border-edge pt-3 font-mono text-[11px] text-muted">
        <Meta p={p} />
        <SourceLinks p={p} />
      </div>
    </div>
  </div>
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

export default function Blog() {
  const [posts, setPosts] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ok
  const [tag, setTag] = useState("all");

  useEffect(() => {
    let cancelled = false;
    const done = (list) => { if (!cancelled) { setPosts(list); setStatus("ok"); } };
    (async () => {
      try {
        const r = await fetch("/api/blogs");
        if (!r.ok) throw new Error("api");
        const d = await r.json();
        if ((d.posts || []).length) return done(d.posts);
        throw new Error("empty");
      } catch {
        try { done(await liveDevto()); }
        catch { done(seedNorm); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const topTags = useMemo(() => {
    const c = {};
    posts.forEach((p) => (p.tags || []).forEach((t) => (c[t] = (c[t] || 0) + 1)));
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
  }, [posts]);

  const shown = tag === "all" ? posts : posts.filter((p) => (p.tags || []).includes(tag));
  const crossposts = posts.filter((p) => p.medium).length;
  const hero = tag === "all" ? shown[0] : null;
  const rest = hero ? shown.slice(1) : shown;

  return (
    <div className="min-h-full bg-bg font-sans text-fg antialiased">
      {/* toolbar */}
      <div className="sticky top-0 z-10 border-b border-edge bg-surface/95 px-5 py-3 backdrop-blur">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accentText">
            Writing
          </p>
          {status === "ok" && posts.length > 0 && (
            <p className="font-mono text-[11px] text-muted">
              <span className="text-accentText">{posts.length}</span> posts ·{" "}
              <span className="text-accentText">{crossposts}</span> also on Medium · live
            </p>
          )}
        </div>
        {status === "ok" && posts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {["all", ...topTags].map((tg) => (
              <button
                key={tg}
                onClick={() => setTag(tg)}
                className={`rounded-full border px-3 py-1 font-mono text-[11px] capitalize transition-colors ${
                  tag === tg ? "border-accent bg-accent text-accentFg" : "border-edge bg-surface text-muted hover:text-fg"
                }`}
              >
                {tg === "all" ? `All · ${posts.length}` : tg}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* feed */}
      <div className="px-5 py-6">
        {status === "loading" && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} />)}
          </div>
        )}

        {status === "ok" && (
          <>
            {hero && <Featured p={hero} />}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {rest.map((p, i) => <PostCard key={p.url || i} p={p} />)}
            </div>
            {shown.length === 0 && (
              <p className="py-16 text-center font-mono text-sm text-muted">No posts with “{tag}”.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
