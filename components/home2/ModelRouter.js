import React, { useState } from "react";
import { motion } from "framer-motion";
import { Zap } from "lucide-react";

// Fake model-router console: pick a request profile, watch it route to the
// model that wins on the axis that matters (cost / context / reasoning /
// latency). All illustrative — no real API calls.
const MODELS = [
  { id: "opus", name: "Claude Opus", cost: 3, ctx: "200k", lat: 3, reason: 5 },
  { id: "gpt", name: "GPT-4o", cost: 3, ctx: "128k", lat: 4, reason: 4 },
  { id: "gpt-mini", name: "GPT-4o mini", cost: 5, ctx: "128k", lat: 5, reason: 3 },
  { id: "gemini", name: "Gemini 1.5 Pro", cost: 3, ctx: "1M", lat: 3, reason: 4 },
  { id: "qwen", name: "Qwen2.5-7B", cost: 5, ctx: "32k", lat: 5, reason: 3 },
];

const REQUESTS = [
  { q: "classify 10k support tickets", pick: "qwen", axis: "cost", why: "trivial task · cheapest tokens · self-hosted" },
  { q: "summarize a 200k-token contract", pick: "gemini", axis: "context", why: "only model with a 1M context window" },
  { q: "prove a graph-theory lemma", pick: "opus", axis: "reasoning", why: "top reasoning benchmark, cost is worth it" },
  { q: "realtime chat autocomplete", pick: "gpt-mini", axis: "latency", why: "lowest latency · good enough quality" },
];

const dots = (v) =>
  "●".repeat(v).padEnd(5, "○");

const ModelRouter = () => {
  const [ri, setRi] = useState(0);
  const req = REQUESTS[ri];
  const winner = req.pick;

  return (
    <div className="rounded-xl border border-edge bg-surface p-5 sm:p-6">
      {/* request selector */}
      <div className="mb-5 flex flex-wrap gap-2">
        {REQUESTS.map((r, i) => (
          <button
            key={r.q}
            onClick={() => setRi(i)}
            className={`rounded-full border px-3 py-1.5 font-mono text-[11px] transition-colors ${
              i === ri
                ? "border-accent bg-accent text-accentFg"
                : "border-edge bg-bg text-muted hover:text-fg"
            }`}
          >
            {r.q}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2 font-mono text-[11px] text-muted">
        <span className="text-accentText">route</span>
        <span className="text-edge">›</span>
        optimising for <span className="text-live">{req.axis}</span>
      </div>

      {/* candidate models */}
      <div className="space-y-2">
        {MODELS.map((m) => {
          const won = m.id === winner;
          return (
            <motion.div
              key={m.id}
              layout
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                won ? "border-amber/60 bg-amber/5" : "border-edge bg-bg"
              }`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  won ? "bg-accent shadow-[0_0_8px_var(--c-accent)]" : "bg-edge"
                }`}
              />
              <span className={`w-36 shrink-0 font-display text-sm font-semibold ${won ? "text-fg" : "text-muted"}`}>
                {m.name}
              </span>
              <div className="hidden flex-1 gap-4 font-mono text-[10px] text-muted sm:flex">
                <span>ctx {m.ctx}</span>
                <span title="cheaper = more dots">cost {dots(m.cost)}</span>
                <span title="faster = more dots">lat {dots(m.lat)}</span>
                <span title="stronger = more dots">iq {dots(m.reason)}</span>
              </div>
              {won && (
                <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 font-mono text-[10px] font-semibold text-accentFg">
                  <Zap className="h-3 w-3" />
                  routed
                </span>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mt-4 border-t border-edge pt-4 font-mono text-[11px]">
        <span className="text-live">decision</span>
        <span className="mx-2 text-edge">›</span>
        <span className="text-fg">{MODELS.find((m) => m.id === winner).name}</span>
        <span className="text-muted"> — {req.why}</span>
      </div>
    </div>
  );
};

export default ModelRouter;
