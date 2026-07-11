import React, { useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Github, ArrowUpRight, Package, Star } from "lucide-react";
import { useSiteContent } from "../../lib/useSiteContent";

// Live star counts pulled straight from the GitHub REST API on mount.
function useLiveStars(systems) {
  const [stars, setStars] = useState({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      systems.map(async (s) => {
        const m = s.href.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
        if (!m) return [s.name, s.stars];
        try {
          const r = await fetch(`https://api.github.com/repos/${m[1]}`);
          if (!r.ok) return [s.name, s.stars];
          const d = await r.json();
          return [s.name, d.stargazers_count];
        } catch {
          return [s.name, s.stars];
        }
      })
    ).then((pairs) => {
      if (!cancelled) setStars(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return stars;
}

const SystemCard = ({ s, i, star }) => {
  const ref = useRef(null);

  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  return (
    <motion.article
      ref={ref}
      onMouseMove={onMove}
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ delay: i * 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-edge bg-surface p-6 transition-colors hover:border-amber/40"
    >
      {/* cursor spotlight */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(280px circle at var(--mx) var(--my), rgba(255,176,32,0.10), transparent 65%)",
        }}
      />
      <div className="relative flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-accentText">
          {s.kind}
        </span>
        <div className="flex items-center gap-1">
          {star ? (
            <span className="mr-1 inline-flex items-center gap-1 rounded-md border border-edge bg-bg px-1.5 py-0.5 font-mono text-[11px] text-muted">
              <Star className="h-3 w-3 fill-accent text-accent" />
              {star}
            </span>
          ) : null}
          {s.npm && (
            <a
              href={s.npm}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${s.name} package`}
              className="rounded-md p-1.5 text-muted transition-colors hover:text-fg"
            >
              <Package className="h-4 w-4" />
            </a>
          )}
          <a
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${s.name} on GitHub`}
            className="rounded-md p-1.5 text-muted transition-colors hover:text-fg"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </div>

      <h3 className="relative mt-4 font-display text-2xl font-bold tracking-tight text-fg">
        {s.name}
      </h3>
      <p className="relative mt-3 flex-1 text-sm leading-relaxed text-muted">
        {s.blurb}
      </p>

      <div className="relative mt-5 font-mono text-xs text-live">{s.metric}</div>

      <div className="relative mt-5 flex flex-wrap items-center gap-2">
        {s.stack.map((t) => (
          <span
            key={t}
            className="rounded-md border border-edge bg-bg px-2.5 py-1 font-mono text-[11px] text-muted"
          >
            {t}
          </span>
        ))}
        <a
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-muted transition-colors hover:text-accentText"
        >
          source
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </motion.article>
  );
};

const SystemsBuilt = () => {
  const { systems, github, identity } = useSiteContent();
  const stars = useLiveStars(systems);
  return (
    <section id="systems" className="relative bg-bg py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
              Built from first principles
            </p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              Systems, not just apps.
            </h2>
          </div>
          <div className="max-w-sm">
            <p className="text-sm leading-relaxed text-muted">
              A runtime, a search engine, a cache, a language, a distributed store
              and a load balancer — each rebuilt from the ground up.
            </p>
            <a
              href={identity.github}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accentText transition-colors hover:opacity-80"
            >
              All {github.repos} repositories on GitHub
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {systems.map((s, i) => (
            <SystemCard
              key={s.name}
              s={s}
              i={i}
              star={stars[s.name] ?? s.stars}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default SystemsBuilt;
