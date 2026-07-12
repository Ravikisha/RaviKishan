import React, { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

// Fake live inference dashboard — tokens/sec, latency, VRAM, throughput jitter
// around a baseline with a rolling sparkline. SSR-stable (baseline first),
// animates on mount. Illustrative only.
const METRICS = [
  { key: "tps", label: "tokens / sec", base: 128, spread: 22, unit: "" },
  { key: "lat", label: "latency", base: 240, spread: 40, unit: "ms" },
  { key: "vram", label: "VRAM", base: 7.4, spread: 0.4, unit: "GB", dp: 1 },
  { key: "rps", label: "throughput", base: 46, spread: 8, unit: "req/s" },
];

const N = 24;

function jitter(base, spread, seed) {
  // deterministic-ish wobble using a moving seed (no Math.random on server)
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return base + (s - Math.floor(s) - 0.5) * 2 * spread;
}

const InferenceMonitor = () => {
  const prefersReduced = useReducedMotion();
  // gate behind mount so SSR + first client render agree (no hydration mismatch)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const reduced = mounted ? prefersReduced : false;
  const [t, setT] = useState(0);
  const [hist, setHist] = useState(() => Array(N).fill(METRICS[0].base));
  const tick = useRef(0);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      tick.current += 1;
      setT(tick.current);
      setHist((h) => {
        const v = jitter(METRICS[0].base, METRICS[0].spread, tick.current);
        return [...h.slice(1), v];
      });
    }, 700);
    return () => clearInterval(id);
  }, [reduced]);

  const val = (m) => {
    const v = reduced ? m.base : jitter(m.base, m.spread, t + m.base);
    return m.dp ? v.toFixed(m.dp) : Math.round(v);
  };

  const max = Math.max(...hist);
  const min = Math.min(...hist);
  const pts = hist
    .map((v, i) => {
      const x = (i / (N - 1)) * 100;
      const y = 100 - ((v - min) / (max - min || 1)) * 100;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="rounded-xl border border-edge bg-surface p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between font-mono text-[11px]">
        <span className="uppercase tracking-[0.18em] text-muted">
          inference · ravi-4.8b @ int8
        </span>
        <span className="inline-flex items-center gap-1.5 text-live">
          <span className={`h-1.5 w-1.5 rounded-full bg-live ${reduced ? "" : "animate-pulse"}`} />
          serving
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {METRICS.map((m) => (
          <div key={m.key} className="rounded-lg border border-edge bg-bg px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
              {m.label}
            </div>
            <div className="mt-1 font-display text-xl font-bold text-accentText">
              {val(m)}
              <span className="ml-1 font-mono text-[11px] text-muted">{m.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* tokens/sec sparkline */}
      <div className="mt-4">
        <div className="mb-1 font-mono text-[10px] text-muted">tokens/sec · last {N}s</div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-16 w-full">
          <polyline
            points={pts}
            fill="none"
            stroke="var(--c-accent)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
};

export default InferenceMonitor;
