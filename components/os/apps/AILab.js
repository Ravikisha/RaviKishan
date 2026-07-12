import React, { useState } from "react";
import { motion } from "framer-motion";
import { Cpu, Search, Split, Activity, Grid3x3 } from "lucide-react";
import FlowViz from "../../home2/FlowViz";
import ModelRouter from "../../home2/ModelRouter";
import InferenceMonitor from "../../home2/InferenceMonitor";
import EmbeddingSpace from "../../home2/EmbeddingSpace";

// AI Lab — dev-mode desktop app (removed from the recruiter page). Same live
// pipelines as before, re-housed in a console-framed window with Ravi's real
// applied-AI work and a straight face that keeps slipping. Facts are true; the
// jokes are load-bearing.
const TABS = [
  {
    key: "rag",
    label: "RAG Pipeline",
    icon: Search,
    quip: "patent-pending enlightenment — now generally available",
    note:
      "My actual patent. The Government of India said yes to doing RAG over the Bhagavad Gita — >95% retrieval accuracy across 5 languages. Krishna: act without attachment to results. The reranker: attaches score 0.98 to every result anyway.",
    log: 'retrieved "karma yoga" in 5 languages; still procrastinated the demo',
    io: {
      input: '"How does the Gita define karma yoga?"',
      output: "grounded answer + citations · >95% retrieval · 5 languages",
    },
    stages: [
      { label: "Query", sub: "user question" },
      { label: "Embed", sub: "OpenAI · 1536-d" },
      { label: "Retrieve", sub: "FAISS top-k" },
      { label: "Rerank", sub: "cross-encoder" },
      { label: "Context", sub: "prompt assembly" },
      { label: "LLM", sub: "generate + cite" },
      { label: "Response", sub: "BLEU / BERTScore" },
    ],
  },
  {
    key: "agents",
    label: "Multi-Agent Workflow",
    icon: Cpu,
    quip: "payroll runs itself; I take the credit",
    note:
      "At Zimyo I convinced LangChain + LangGraph to run payroll so a human doesn't have to. One English sentence → a runnable workflow across 5+ HR modules, zero manual config. Bonus round: cut the LLM bill 70% by teaching the model to stop talking after one call.",
    log: "planner → coder → reviewer → 'lgtm' → prod. nobody reviewed the reviewer",
    io: {
      input: '"Run payroll for the Gurugram team this month"',
      output: "executable workflow graph · 5+ HR modules · 0 manual config",
    },
    loop: true,
    stages: [
      { label: "Planner", sub: "decompose goal" },
      { label: "Researcher", sub: "gather context" },
      { label: "Coder", sub: "build graph" },
      { label: "Reviewer", sub: "critique" },
      { label: "Evaluator", sub: "score + gate" },
    ],
  },
  {
    key: "router",
    label: "Model Router",
    icon: Split,
    quip: "a bouncer for tokens",
    note:
      "Every prompt gets routed to whichever model wins on the axis that matters — cost, context length, latency or raw reasoning. The expensive model only gets called when the cheap one panics.",
    log: "routed 1 prompt to the big model, 99 to the cheap one. the bill is happy",
    Comp: ModelRouter,
  },
  {
    key: "inference",
    label: "Inference Monitor",
    icon: Activity,
    quip: "the dashboard I stare at instead of sleeping",
    note:
      "Live serving metrics — tokens/sec, latency, VRAM, throughput. The exact dashboard that sits behind a self-hosted model in production and quietly decides my mood.",
    log: "tok/s up · VRAM sweating · latency behaving for now",
    Comp: InferenceMonitor,
  },
  {
    key: "embed",
    label: "Embedding Space",
    icon: Grid3x3,
    quip: "my repos have opinions about each other",
    note:
      "Every project I've built, squished into a 2-D vector space and clustered by language — the same intuition behind semantic search and retrieval. Turns out the Go repos sit together, smug.",
    log: "projected 69 repos into 2-D; the interpreters are still arguing about syntax",
    Comp: EmbeddingSpace,
  },
];

export default function AILab() {
  const [tab, setTab] = useState("rag");
  const active = TABS.find((t) => t.key === tab) || TABS[0];

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      {/* console header */}
      <div className="border-b border-edge px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-accentText">
          <span className="h-1.5 w-1.5 rounded-full bg-live shadow-[0_0_8px_var(--c-live)] animate-pulse" />
          applied-ai
          <span className="text-muted">{"// live"}</span>
        </div>
        <h2 className="mt-1.5 font-display text-xl font-bold tracking-tight text-fg">
          How the AI actually runs<span className="text-accentText">.</span>
        </h2>
        <p className="mt-1 font-mono text-[11px] text-muted">{active.quip}</p>
      </div>

      {/* tab pills */}
      <div className="ail-tabs flex gap-2 overflow-x-auto border-b border-edge px-5 py-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex flex-shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 font-mono text-[11px] transition-colors ${
                on
                  ? "border-accent bg-accent text-accentFg"
                  : "border-edge bg-surface text-muted hover:text-fg"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* scrollable viz body */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <motion.div
          key={active.key}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-muted">{active.note}</p>
          {active.stages ? (
            <FlowViz stages={active.stages} loop={active.loop} io={active.io} />
          ) : (
            <active.Comp />
          )}
          <div className="mt-4 flex items-start gap-2 font-mono text-[11px] text-muted">
            <span className="text-live">$</span>
            <span className="italic">{active.log}</span>
          </div>
        </motion.div>
      </div>

      <style jsx>{`
        .ail-tabs { scrollbar-width: none; }
        .ail-tabs::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
