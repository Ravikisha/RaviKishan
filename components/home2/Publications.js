import React from "react";
import { motion } from "framer-motion";
import { ScrollText, ArrowUpRight, BadgeCheck } from "lucide-react";
import { useSiteContent } from "../../lib/useSiteContent";

const PubCard = ({ p, i }) => {
  const meta = [p.number, p.filed, p.date].filter(Boolean).join(" · ");
  return (
    <motion.article
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ delay: i * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-2xl border border-edge bg-surface p-6 sm:p-8"
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-amber/10 blur-3xl" />

      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-edge bg-bg text-accentText">
          <ScrollText className="h-6 w-6" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-edge bg-bg px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-muted">
              {p.type}
            </span>
            {p.status && (
              <span className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-accentText">
                <BadgeCheck className="h-3 w-3" />
                {p.status}
              </span>
            )}
          </div>

          <h3 className="mt-4 font-display text-xl font-bold leading-snug tracking-tight text-fg sm:text-2xl">
            {p.title}
          </h3>

          {meta && (
            <p className="mt-2 font-mono text-xs text-muted">{meta}</p>
          )}

          {p.abstract && (
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">
              {p.abstract}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {(p.tags || []).map((t) => (
              <span
                key={t}
                className="rounded-md border border-edge bg-bg px-2.5 py-1 font-mono text-[11px] text-muted"
              >
                {t}
              </span>
            ))}
            {p.url && (
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-accentText transition-opacity hover:opacity-80"
              >
                View publication
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
};

const Publications = () => {
  const { patents } = useSiteContent();
  if (!patents || patents.length === 0) return null;

  return (
    <section
      id="publications"
      className="relative border-t border-edge bg-bg py-24"
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
              Publications
            </p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              My research and patents
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted">
            Research that made it past review — a published patent application on
            applied AI over Indian epics.
          </p>
        </div>

        <div className="space-y-5">
          {patents.map((p, i) => (
            <PubCard key={p.title} p={p} i={i} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default Publications;
