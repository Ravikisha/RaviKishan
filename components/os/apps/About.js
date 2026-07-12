import React from "react";
import { Cpu, Boxes, BrainCircuit, MapPin } from "lucide-react";
import { useSiteContent } from "../../../lib/useSiteContent";

// About as a windowed app — bio, portrait and focus areas from the About page,
// laid out to fit an OS window. Theme-aware.
const focusMeta = {
  "Distributed Systems": {
    icon: Boxes,
    blurb: "Sharding, replication and fault tolerance — stores and load balancers that stay up when nodes don't.",
  },
  "Systems Programming": {
    icon: Cpu,
    blurb: "Low-level work in Go, Rust and C — event loops, interpreters and SIMD-vectorized engines built for speed.",
  },
  "Applied AI": {
    icon: BrainCircuit,
    blurb: "Production agentic systems on LangChain/LangGraph and RAG pipelines — measured on cost and accuracy.",
  },
};

export default function About() {
  const { identity } = useSiteContent();
  const focus = identity.focus || Object.keys(focusMeta);

  return (
    <div className="h-full overflow-y-auto bg-bg font-sans text-fg">
      <div className="mx-auto max-w-3xl px-6 py-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-accentText">About</p>
        <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-fg sm:text-3xl">
          I chase the layers <span className="text-accentText">others treat as magic.</span>
        </h2>

        {/* portrait + bio */}
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-[0.7fr_1.3fr] sm:items-start">
          <div className="relative mx-auto w-full max-w-[230px] overflow-hidden rounded-2xl border border-edge bg-surface">
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-amber/10 to-transparent" />
            <img src={identity.photo} alt={identity.name} className="relative w-full object-contain" />
            <div className="absolute inset-x-2.5 bottom-2.5 flex items-center justify-between rounded-lg border border-edge bg-bg/85 px-2.5 py-1.5 backdrop-blur">
              <span className="font-display text-xs font-semibold text-fg">{identity.name}</span>
              <span className="flex items-center gap-1 font-mono text-[10px] text-muted">
                <MapPin className="h-3 w-3" /> {identity.location}
              </span>
            </div>
          </div>

          <div className="space-y-3.5 text-sm leading-relaxed text-muted">
            <p>{identity.intro}</p>
            <p>
              I&apos;m currently an <span className="text-fg">Agentic AI Engineer at Zimyo</span>, building
              LangChain/LangGraph agents that turn natural language into multi-step HR workflows — recently
              driving LLM inference cost down ~70% with schema-constrained prompt design.
            </p>
            <p>
              Named inventor on a <span className="text-fg">published Indian patent</span>, open-source author
              with 1,000+ npm downloads and 167 GitHub stars. I care about correctness, performance and clean
              architecture — always happy to talk developer tools and building from first principles.
            </p>
          </div>
        </div>

        {/* focus areas */}
        <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.22em] text-accentText">What I work on</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {focus.map((f) => {
            const meta = focusMeta[f] || { icon: Cpu, blurb: "" };
            const Icon = meta.icon;
            return (
              <div key={f} className="rounded-xl border border-edge bg-surface p-4">
                <span className="grid h-9 w-9 place-items-center rounded-lg border border-edge bg-bg text-accentText">
                  <Icon className="h-4 w-4" />
                </span>
                <h3 className="mt-3 font-display text-sm font-bold text-fg">{f}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{meta.blurb}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
