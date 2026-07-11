import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, Github, Linkedin, Mail } from "lucide-react";
import { useSiteContent } from "../../lib/useSiteContent";

const ClosingCTA = () => {
  const { identity } = useSiteContent();
  return (
    <section className="relative overflow-hidden border-t border-edge bg-bg py-28">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber/10 blur-[130px]" />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative mx-auto max-w-3xl px-6 text-center"
      >
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
          Open to hard problems
        </p>
        <h2 className="mt-4 font-display text-4xl font-bold leading-tight tracking-tight text-fg sm:text-5xl">
          Got a system worth
          <br />
          <span className="text-accentText">building right?</span>
        </h2>
        <p className="mx-auto mt-5 max-w-md text-base text-muted">
          Distributed backends, AI agents, or performance work that needs to go
          fast. Let&apos;s talk.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/contact">
            <a className="group inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-accentFg transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber">
              <Mail className="h-4 w-4" />
              Get in touch
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
          </Link>
          <a
            href={identity.github}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-edge bg-surface px-6 py-3 text-sm font-semibold text-fg transition-colors hover:border-muted"
          >
            <Github className="h-4 w-4 text-muted" />
            GitHub
          </a>
          <a
            href={identity.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-edge bg-surface px-6 py-3 text-sm font-semibold text-fg transition-colors hover:border-muted"
          >
            <Linkedin className="h-4 w-4 text-muted" />
            LinkedIn
          </a>
        </div>
      </motion.div>
    </section>
  );
};

export default ClosingCTA;
