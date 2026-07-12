import React from "react";
import Seo from "../components/Seo";
import { motion } from "framer-motion";
import { Cpu, Boxes, BrainCircuit, Layers } from "lucide-react";
import { useSiteContent } from "../lib/useSiteContent";
import PageHeader from "../components/home2/PageHeader";
import ExperienceTimeline from "../components/home2/ExperienceTimeline";
import ClosingCTA from "../components/home2/ClosingCTA";

const focusMeta = {
  "Distributed Systems": {
    icon: Boxes,
    blurb:
      "Sharding, replication and fault tolerance — key-value stores and load balancers that stay up when nodes don't.",
  },
  "Systems Programming": {
    icon: Cpu,
    blurb:
      "Low-level work in Go, Rust and C — event loops, interpreters and SIMD-vectorized engines built for speed.",
  },
  "Applied AI": {
    icon: BrainCircuit,
    blurb:
      "Production agentic systems on LangChain/LangGraph and RAG pipelines — measured on cost and retrieval accuracy.",
  },
};

const About = () => {
  const { identity } = useSiteContent();
  const focus = identity.focus || Object.keys(focusMeta);

  return (
    <>
      <Seo
        title="About — Ravi Kishan"
        description="Ravi Kishan — software engineer working in distributed systems, systems programming and applied AI. The story behind the builds."
        path="/about"
        type="profile"
      />

      <main className="bg-bg font-sans text-fg antialiased">
        <PageHeader
          eyebrow="About"
          title="I chase the layers"
          accent="others treat as magic."
          subtitle="The fastest way I understand a system is to rebuild it — so I keep building the parts most people take for granted."
        />

        {/* bio + portrait */}
        <section className="border-b border-edge bg-bg py-20">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="relative mx-auto w-full max-w-[340px] overflow-hidden rounded-2xl border border-edge bg-surface"
            >
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-amber/10 to-transparent" />
              <img
                src={identity.photo}
                alt={identity.name}
                className="relative w-full object-contain"
              />
              <div className="absolute inset-x-3 bottom-3 flex items-center justify-between rounded-lg border border-edge bg-bg/85 px-3 py-2 backdrop-blur">
                <span className="font-display text-sm font-semibold text-fg">
                  {identity.name}
                </span>
                <span className="font-mono text-[11px] text-muted">
                  {identity.location}
                </span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ delay: 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-5 text-base leading-relaxed text-muted sm:text-lg"
            >
              <p>{identity.intro}</p>
              <p>
                I&apos;m currently an{" "}
                <span className="text-fg">Agentic AI Engineer at Zimyo</span>,
                building LangChain/LangGraph agents that turn natural language
                into multi-step HR workflows — recently driving LLM inference
                cost down ~70% with schema-constrained prompt design. Before
                that, at Arrowhead Capital, I built a vectorized backtesting
                engine over 5M+ records and the pipelines behind it.
              </p>
              <p>
                I&apos;m a named inventor on a{" "}
                <span className="text-fg">published Indian patent</span> for a
                multilingual RAG system over the Bhagavad Gita, and an
                open-source author with 1,000+ npm downloads and 167 GitHub
                stars. I care about correctness, performance and clean
                architecture — and I&apos;m always happy to talk developer
                tools, infrastructure and building from first principles.
              </p>
            </motion.div>
          </div>
        </section>

        {/* focus areas */}
        <section className="border-b border-edge bg-bg py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mb-10 flex items-center gap-3">
              <Layers className="h-4 w-4 text-accentText" />
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
                What I work on
              </p>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {focus.map((f, i) => {
                const meta = focusMeta[f] || { icon: Cpu, blurb: "" };
                const Icon = meta.icon;
                return (
                  <motion.div
                    key={f}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-80px" }}
                    transition={{ delay: i * 0.08, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                    className="rounded-xl border border-edge bg-surface p-6"
                  >
                    <span className="grid h-11 w-11 place-items-center rounded-lg border border-edge bg-bg text-accentText">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-5 font-display text-xl font-bold text-fg">
                      {f}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted">
                      {meta.blurb}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        <ExperienceTimeline />
        <ClosingCTA />
      </main>
    </>
  );
};

export default About;
