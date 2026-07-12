import React, { useEffect, useMemo, useState } from "react";
import Seo from "../components/Seo";
import { motion } from "framer-motion";
import { Github, ExternalLink, Package, BookOpen, Search, X, Box, LayoutGrid } from "lucide-react";
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

/* ---- fake "vector" search: real substring relevance mapped to a cosine-ish
   0.62–0.99 score, with deterministic jitter so it reads like an embedding
   similarity but stays stable across renders. ---- */
const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// whole-word match so short queries ("go", "rag") don't match inside other
// words ("google", "storage").
const has = (text, term) => new RegExp(`\\b${esc(term)}\\b`).test(text);
function simScore(p, terms) {
  const name = (p.name || "").toLowerCase();
  const desc = (p.description || "").toLowerCase();
  const skills = (p.skills || []).join(" ").toLowerCase();
  const tags = (p.tags || []).join(" ").toLowerCase();
  let raw = 0;
  for (const t of terms) {
    if (has(name, t)) raw += 3;
    if (has(skills, t)) raw += 2;
    if (has(tags, t)) raw += 2;
    if (has(desc, t)) raw += 1;
  }
  if (raw === 0) return 0;
  const jitter = (hash(p.name + terms.join()) % 40) / 1000; // 0–0.039
  return Math.min(0.99, 0.62 + Math.min(raw, 6) * 0.055 + jitter);
}

const ProjectCard = ({ p, i, sim, onOpen }) => (
  <motion.article
    layout
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: (i % 6) * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    onClick={() => onOpen(p)}
    className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-edge bg-surface transition-colors hover:border-amber/40"
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
      {sim != null && (
        <span className="absolute right-3 top-3 rounded-full border border-amber/40 bg-bg/85 px-2 py-0.5 font-mono text-[10px] text-live backdrop-blur">
          {sim.toFixed(2)}
        </span>
      )}
    </div>

    <div className="flex flex-1 flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg font-bold text-fg">{p.name}</h3>
        <div
          className="flex shrink-0 items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
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

const slugify = (n) => (n || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const portOf = (p) =>
  (p.tags || []).includes("live") || p.link || p.docs ? "8080:8080" : "—";

// Projects rendered as Docker containers.
const ContainerCard = ({ p, onOpen }) => (
  <motion.article
    layout
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    onClick={() => onOpen(p)}
    className="group cursor-pointer rounded-xl border border-edge bg-surface p-4 font-mono text-[12px] transition-colors hover:border-amber/40"
  >
    <div className="flex items-center justify-between border-b border-edge pb-2.5">
      <span className="flex items-center gap-2 text-fg">
        <Box className="h-3.5 w-3.5 text-accentText" />
        {slugify(p.name)}
      </span>
      <span className="inline-flex items-center gap-1.5 text-live">
        <span className="h-1.5 w-1.5 rounded-full bg-live" />
        running
      </span>
    </div>
    <dl className="mt-2.5 space-y-1 text-muted">
      <Row k="IMAGE" v={`ravi/${slugify(p.name)}:latest`} />
      <Row k="PORTS" v={portOf(p)} />
      <Row k="STACK" v={(p.skills || []).slice(0, 3).join(", ") || "—"} />
      <Row k="CPU" v="0.3%" />
      <Row k="MEM" v="42MiB / 512MiB" />
    </dl>
    <div className="mt-2.5 border-t border-edge pt-2 text-[11px] text-accentText opacity-0 transition-opacity group-hover:opacity-100">
      $ docker inspect → view details
    </div>
  </motion.article>
);
const Row = ({ k, v }) => (
  <div className="flex gap-3">
    <dt className="w-14 shrink-0 text-edge">{k}</dt>
    <dd className="truncate text-muted">{v}</dd>
  </div>
);

// "LLM thinking" reveal — clicking a project streams fake reasoning, then shows
// the full project detail.
const THOUGHTS = [
  "parsing request…",
  "searching memory / project embeddings…",
  "evaluating architecture & trade-offs…",
  "cross-checking against 1,200+ DSA reps…",
  "confidence 0.97 ✓",
];
const ThinkingModal = ({ project: p, onClose }) => {
  const [step, setStep] = useState(0);
  const ready = step >= THOUGHTS.length;

  useEffect(() => {
    if (ready) return;
    const id = setTimeout(() => setStep((s) => s + 1), 430);
    return () => clearTimeout(id);
  }, [step, ready]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-5 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-edge bg-surface"
      >
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5 font-mono text-[11px] text-muted">
          <span className="text-accentText">reasoning</span>
          <button onClick={onClose} aria-label="Close" className="hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* thinking stream */}
        <div className="space-y-1.5 p-4 font-mono text-[12px]">
          {THOUGHTS.slice(0, step).map((t, i) => (
            <div key={i} className={i === THOUGHTS.length - 1 ? "text-live" : "text-muted"}>
              <span className="text-accentText">›</span> {t}
            </div>
          ))}
          {!ready && (
            <div className="text-muted">
              <span className="text-accentText">›</span>
              <span className="ml-2 inline-block h-3 w-1.5 animate-blink bg-accent align-middle" />
            </div>
          )}
        </div>

        {/* revealed detail */}
        {ready && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35 }}
            className="border-t border-edge"
          >
            {p.image && (
              <img
                src={"/projects/" + p.image}
                alt={p.name}
                className="h-40 w-full object-cover"
              />
            )}
            <div className="p-5">
              <h3 className="font-display text-xl font-bold text-fg">{p.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{p.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {(p.skills || []).map((s) => (
                  <span key={s} className="rounded-md border border-edge bg-bg px-2 py-0.5 font-mono text-[11px] text-muted">
                    {s}
                  </span>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {p.github && <ModalLink href={p.github} icon={Github} label="GitHub" />}
                {p.docs && <ModalLink href={p.docs} icon={BookOpen} label="Docs" />}
                {p.link && <ModalLink href={p.link} icon={ExternalLink} label="Open" />}
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};
const ModalLink = ({ href, icon: Icon, label }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-bg px-3 py-1.5 text-sm text-muted transition-colors hover:border-amber/50 hover:text-accentText"
  >
    <Icon className="h-4 w-4" />
    {label}
  </a>
);

const Projects = () => {
  const { projects, github } = useSiteContent();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [view, setView] = useState("grid");
  const [selected, setSelected] = useState(null);

  const ordered = projects || [];
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searchMode = terms.length > 0;

  // brief "encoding + retrieval" beat whenever the query changes
  useEffect(() => {
    if (!searchMode) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = setTimeout(() => setSearching(false), 550);
    return () => clearTimeout(id);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  // ranked results (search mode) vs tag-filtered order (browse mode)
  const scored = useMemo(() => {
    if (!searchMode) return null;
    return ordered
      .map((p) => ({ p, sim: simScore(p, terms) }))
      .filter((x) => x.sim > 0)
      .sort((a, b) => b.sim - a.sim);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ordered]);

  const browse =
    filter === "all"
      ? ordered
      : ordered.filter((p) => (p.tags || []).includes(filter));
  const list = searchMode
    ? scored || []
    : browse.map((p) => ({ p, sim: null }));

  return (
    <>
      <Seo
        title="Projects — Ravi Kishan"
        description="Open-source projects by Ravi Kishan — runtimes, developer tools, distributed systems and npm packages."
        path="/projects"
      />

      <main className="bg-bg font-sans text-fg antialiased">
        <PageHeader
          eyebrow="Projects"
          title="Things I've"
          accent="shipped."
          subtitle={`Open-source tools, runtimes and experiments — a slice of ${
            github?.repos || 69
          } public repositories.`}
        >
          {/* vector search bar */}
          <div className="mb-4 flex max-w-xl items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2.5 font-mono text-sm transition-colors focus-within:border-amber/50">
            <Search className="h-4 w-4 shrink-0 text-accentText" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
              placeholder="semantic search — try “distributed database” or “rust”"
              className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-muted"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="shrink-0 text-muted transition-colors hover:text-fg"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* view toggle */}
          <div className="mb-4 flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted">view</span>
            {[
              { k: "grid", label: "grid", icon: LayoutGrid },
              { k: "containers", label: "containers", icon: Box },
            ].map((v) => {
              const Icon = v.icon;
              const on = view === v.k;
              return (
                <button
                  key={v.k}
                  onClick={() => setView(v.k)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${
                    on
                      ? "border-accent bg-accent text-accentFg"
                      : "border-edge bg-surface text-muted hover:text-fg"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {v.label}
                </button>
              );
            })}
          </div>

          {/* filters — browse mode only */}
          {!searchMode && (
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
          )}
        </PageHeader>

        <section className="bg-bg py-16">
          <div className="mx-auto max-w-6xl px-6">
            {searchMode && searching ? (
              <div className="mx-auto max-w-xl rounded-xl border border-edge bg-surface p-6 font-mono text-sm">
                <div className="text-muted">
                  <span className="text-accentText">~</span> encoding “{query}” →
                  1536-d vector
                </div>
                <div className="mt-2 text-muted">
                  › scanning {ordered.length} project embeddings…
                </div>
                <div className="mt-2 flex items-center gap-2 text-accentText">
                  computing cosine similarity
                  <span className="inline-block h-3.5 w-1.5 animate-blink bg-accent" />
                </div>
              </div>
            ) : (
              <>
                {searchMode && list.length > 0 && (
                  <div className="mb-6 font-mono text-xs text-muted">
                    <span className="text-live">{list.length}</span> vectors
                    matched · cosine ≥{" "}
                    <span className="text-accentText">
                      {list[list.length - 1].sim.toFixed(2)}
                    </span>{" "}
                    · sorted by similarity
                  </div>
                )}

                <motion.div
                  layout
                  className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {list.map(({ p, sim }, i) =>
                    view === "containers" ? (
                      <ContainerCard key={p.name} p={p} onOpen={setSelected} />
                    ) : (
                      <ProjectCard key={p.name} p={p} i={i} sim={sim} onOpen={setSelected} />
                    )
                  )}
                </motion.div>

                {list.length === 0 && (
                  <p className="py-16 text-center font-mono text-sm text-muted">
                    {searchMode
                      ? "no vectors above threshold — try “rust”, “go” or “database”"
                      : "No projects in this category yet."}
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        <ClosingCTA />
      </main>

      {selected && (
        <ThinkingModal project={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
};

export default Projects;
