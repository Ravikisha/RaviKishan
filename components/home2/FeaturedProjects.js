import React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { motion } from "framer-motion";
import { Github, ArrowUpRight, ExternalLink, Package, BookOpen } from "lucide-react";
import { useSiteContent } from "../../lib/useSiteContent";
import { openAppOrRoute } from "../../lib/openResume";

const isNpm = (p) => (p.link || "").includes("npmjs.com");

const FeaturedCard = ({ p, i }) => (
  <motion.article
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-70px" }}
    transition={{ delay: (i % 3) * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    className="group flex flex-col overflow-hidden rounded-xl border border-edge bg-surface transition-colors hover:border-amber/40"
  >
    <div className="relative aspect-[16/10] overflow-hidden border-b border-edge bg-bg">
      {p.image ? (
        <img
          src={"/projects/" + p.image}
          alt={p.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <div className="grid h-full w-full place-items-center font-mono text-xs text-muted">
          {p.name}
        </div>
      )}
      <span className="absolute left-3 top-3 rounded-full border border-edge bg-bg/85 px-2 py-0.5 font-mono text-[10px] text-accentText backdrop-blur">
        #{i + 1}
      </span>
    </div>

    <div className="flex flex-1 flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg font-bold text-fg">{p.name}</h3>
        <div className="flex shrink-0 items-center gap-1">
          {p.github && (
            <a
              href={p.github}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${p.name} on GitHub`}
              className="rounded-md p-1.5 text-muted transition-colors hover:text-fg"
            >
              <Github className="h-4 w-4" />
            </a>
          )}
          {p.docs && (
            <a
              href={p.docs}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${p.name} documentation`}
              title="Documentation site"
              className="rounded-md p-1.5 text-muted transition-colors hover:text-accentText"
            >
              <BookOpen className="h-4 w-4" />
            </a>
          )}
          {p.link && (
            <a
              href={p.link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${p.name}`}
              className="rounded-md p-1.5 text-muted transition-colors hover:text-fg"
            >
              {isNpm(p) ? (
                <Package className="h-4 w-4" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
            </a>
          )}
        </div>
      </div>

      <p
        className="mt-2 flex-1 overflow-hidden text-sm leading-relaxed text-muted"
        style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}
      >
        {p.description}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(p.skills || []).slice(0, 4).map((s) => (
          <span
            key={s}
            className="rounded-md border border-edge bg-bg px-2 py-0.5 font-mono text-[11px] text-muted"
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  </motion.article>
);

const FeaturedProjects = () => {
  const { projects } = useSiteContent();
  const router = useRouter();
  const all = projects || [];
  // Show the projects starred "featured" (in admin order); if none are starred
  // yet, fall back to the first 6 so the homepage never goes empty.
  const starred = all.filter((p) => p.featured);
  const featured = (starred.length ? starred : all).slice(0, 6);
  if (featured.length === 0) return null;

  return (
    <section id="featured" className="relative border-t border-edge bg-bg py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
              Featured projects
            </p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              What I&apos;m shipping.
            </h2>
          </div>
          <div className="max-w-sm">
            <p className="text-sm leading-relaxed text-muted">
              The work I&apos;m proudest of right now — runtimes, developer tools
              and distributed systems, open and documented.
            </p>
            <button
              type="button"
              onClick={() => openAppOrRoute("projects", "/projects", router)}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accentText transition-opacity hover:opacity-80"
            >
              Browse all projects
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((p, i) => (
            <FeaturedCard key={p.name || i} p={p} i={i} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturedProjects;
