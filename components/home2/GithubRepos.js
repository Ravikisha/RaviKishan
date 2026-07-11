import React from "react";
import { motion } from "framer-motion";
import { Github, ArrowUpRight, Star, GitFork, ExternalLink } from "lucide-react";
import { useSiteContent } from "../../lib/useSiteContent";

// Language → dot color. Falls back to the accent for anything unlisted.
const LANG_COLOR = {
  JavaScript: "#F1E05A",
  TypeScript: "#3178C6",
  Go: "#00ADD8",
  Rust: "#DEA584",
  Python: "#3572A5",
  Java: "#B07219",
  "C++": "#F34B7D",
  C: "#555555",
  PHP: "#4F5D95",
  MDX: "#FCB32C",
  HTML: "#E34C26",
  CSS: "#563D7C",
};

const RepoCard = ({ r, i }) => (
  <motion.article
    initial={{ opacity: 0, y: 18 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-70px" }}
    transition={{ delay: (i % 3) * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    className="group flex flex-col rounded-xl border border-edge bg-surface p-5 transition-colors hover:border-amber/40"
  >
    <div className="flex items-center justify-between gap-3">
      <a
        href={r.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-w-0 items-center gap-2 font-mono text-sm font-semibold text-fg transition-colors hover:text-accentText"
      >
        <Github className="h-4 w-4 shrink-0 text-muted" />
        <span className="truncate">{r.name}</span>
      </a>
      <div className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-muted">
        {typeof r.stars === "number" && (
          <span className="inline-flex items-center gap-1">
            <Star className="h-3 w-3 fill-accent text-accent" />
            {r.stars}
          </span>
        )}
        {typeof r.forks === "number" && (
          <span className="inline-flex items-center gap-1">
            <GitFork className="h-3 w-3" />
            {r.forks}
          </span>
        )}
      </div>
    </div>

    <p
      className="mt-3 flex-1 overflow-hidden text-sm leading-relaxed text-muted"
      style={{
        display: "-webkit-box",
        WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical",
      }}
    >
      {r.description}
    </p>

    {Array.isArray(r.topics) && r.topics.length > 0 && (
      <div className="mt-4 flex flex-wrap gap-1.5">
        {r.topics.slice(0, 4).map((t) => (
          <span
            key={t}
            className="rounded-full border border-edge bg-bg px-2 py-0.5 font-mono text-[10px] text-muted"
          >
            {t}
          </span>
        ))}
      </div>
    )}

    <div className="mt-4 flex items-center justify-between border-t border-edge pt-3">
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted">
        {r.language && (
          <>
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: LANG_COLOR[r.language] || "var(--c-accent)" }}
            />
            {r.language}
          </>
        )}
      </span>
      {r.homepage ? (
        <a
          href={r.homepage}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-accentText transition-opacity hover:opacity-80"
        >
          live
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-muted transition-colors hover:text-accentText"
        >
          repo
          <ArrowUpRight className="h-3 w-3" />
        </a>
      )}
    </div>
  </motion.article>
);

const GithubRepos = () => {
  const { githubRepos, github, identity } = useSiteContent();
  if (!githubRepos || githubRepos.length === 0) return null;

  return (
    <section id="open-source" className="relative border-t border-edge bg-bg py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
              Open source
            </p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              More on GitHub.
            </h2>
          </div>
          <div className="max-w-sm">
            <p className="text-sm leading-relaxed text-muted">
              A slice of {github?.repos || githubRepos.length}+ public
              repositories — search engines, databases, frameworks and tools,
              each open and documented.
            </p>
            <a
              href={identity.github}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accentText transition-opacity hover:opacity-80"
            >
              View all repositories
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {githubRepos.map((r, i) => (
            <RepoCard key={r.name || i} r={r} i={i} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default GithubRepos;
