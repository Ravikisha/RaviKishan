import React, { useState } from "react";
import Head from "next/head";
import { motion } from "framer-motion";
import { Github, ExternalLink, Package, BookOpen } from "lucide-react";
import { useSiteContent } from "../lib/useSiteContent";
import PageHeader from "../components/home2/PageHeader";
import ClosingCTA from "../components/home2/ClosingCTA";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "open-source", label: "Open source" },
  { key: "npm package", label: "Packages" },
  { key: "distributed", label: "Distributed" },
  { key: "machine learning", label: "AI / ML" },
  { key: "live", label: "Live" },
];

const isNpm = (p) => (p.link || "").includes("npmjs.com");

const ProjectCard = ({ p, i }) => (
  <motion.article
    layout
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: (i % 6) * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
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

      <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">
        {p.description}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(p.skills || []).map((s) => (
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

const Projects = () => {
  const { projects, github } = useSiteContent();
  const [filter, setFilter] = useState("all");

  // Order = priority = admin array order (seeded by rank in lib/siteContent.js).
  const ordered = projects || [];
  const shown =
    filter === "all"
      ? ordered
      : ordered.filter((p) => (p.tags || []).includes(filter));

  return (
    <>
      <Head>
        <title>Projects — Ravi Kishan</title>
        <meta
          name="description"
          content="Open-source projects by Ravi Kishan — runtimes, developer tools, distributed systems and npm packages."
        />
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>

      <main className="bg-bg font-sans text-fg antialiased">
        <PageHeader
          eyebrow="Projects"
          title="Things I've"
          accent="shipped."
          subtitle={`Open-source tools, runtimes and experiments — a slice of ${
            github?.repos || 69
          } public repositories.`}
        >
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full border px-4 py-1.5 font-mono text-xs transition-colors ${
                  filter === f.key
                    ? "border-accent bg-accent text-accentFg"
                    : "border-edge bg-surface text-muted hover:text-fg"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </PageHeader>

        <section className="bg-bg py-16">
          <div className="mx-auto max-w-6xl px-6">
            <motion.div
              layout
              className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
            >
              {shown.map((p, i) => (
                <ProjectCard key={p.name} p={p} i={i} />
              ))}
            </motion.div>
            {shown.length === 0 && (
              <p className="py-16 text-center font-mono text-sm text-muted">
                No projects in this category yet.
              </p>
            )}
          </div>
        </section>

        <ClosingCTA />
      </main>
    </>
  );
};

export default Projects;
