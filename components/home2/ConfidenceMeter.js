import React, { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Gauge } from "lucide-react";

// "Model card" for the skills page — reframes a self-rating chart as an AI model's
// own diagnostics readout. Each capability has a status tag, a benchmark bar, a
// decimal inference confidence (with gentle live calibration), and evidence on hover.
// The last row is the joke. Evidence lines trace to lib/facts.js (systems + patent).
const SKILLS = [
  { n: "TypeScript", c: 96, status: "MASTERED", ev: "14 repos · Relax.js runtime · SSR + hydration" },
  { n: "Go", c: 92, status: "PRODUCTION READY", ev: "distributed KV store · load balancer · search engine" },
  { n: "Python", c: 94, status: "PRODUCTION READY", ev: "RAG pipelines · vectorized backtests · patent" },
  { n: "Rust", c: 84, status: "CURRENTLY OBSESSED", ev: "Redis clone · memory-safe · zero GC" },
  { n: "Distributed systems", c: 90, status: "BATTLE-TESTED", ev: "sharding · replication · fault tolerance" },
  { n: "Applied AI / RAG", c: 91, status: "TRAINING", ev: ">95% retrieval · 5 languages · LangGraph" },
  { n: "System design", c: 88, status: "STABLE", ev: "trade-offs first · whiteboard-ready" },
  { n: "CSS", c: 34, status: "IT DEPENDS", note: "still Googling flexbox", ev: "margin: auto (prayer-based)" },
];

const CHECKPOINT = "v2026.07";
const EGG = "stackoverflow → accepted answer found · confidence +12%";

const ConfidenceMeter = () => {
  const reduced = useReducedMotion();
  const ref = useRef(null);
  const toastRef = useRef(null);
  const [show, setShow] = useState(false);
  const [tick, setTick] = useState(0); // drives calibration jitter + header status
  const [open, setOpen] = useState(null); // hovered/focused row index
  const [toast, setToast] = useState(null);
  const [boost, setBoost] = useState(false); // CSS easter-egg boost

  useEffect(() => {
    if (reduced) {
      setShow(true);
      return undefined;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShow(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  // Gentle "live" recalibration — deterministic (no random → no hydration mismatch).
  useEffect(() => {
    if (reduced) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 2400);
    return () => clearInterval(t);
  }, [reduced]);

  useEffect(() => () => clearTimeout(toastRef.current), []);

  const recalibrating = !reduced && tick % 5 === 4;

  const fireEgg = (i) => {
    const s = SKILLS[i];
    if (s.n === "CSS") {
      setBoost(true);
      setToast(EGG);
      clearTimeout(toastRef.current);
      toastRef.current = setTimeout(() => {
        setToast(null);
        setBoost(false);
      }, 2400);
      return;
    }
    setToast(`${s.n} :: ${s.status.toLowerCase()} — receipts in /projects`);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 2000);
  };

  return (
    <section className="border-b border-edge bg-bg py-20" ref={ref}>
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-2 flex items-center gap-3">
          <Gauge className="h-4 w-4 text-accentText" />
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
            Model card
          </p>
          <span className="h-px flex-1 bg-edge" />
          <span className="font-mono text-xs text-muted">
            {recalibrating ? "recalibrating…" : "weights frozen"}
          </span>
        </div>
        <p className="mb-8 font-mono text-[11px] text-muted">
          checkpoint {CHECKPOINT} · 8 capabilities · inference{" "}
          <span className="text-live">READY</span>
        </p>

        <div className="space-y-4">
          {SKILLS.map((s, i) => {
            const low = s.c < 50;
            const boosted = boost && s.n === "CSS";
            const shownC = boosted ? 46 : s.c;
            // decimal confidence with ±1 live jitter (never on the joke row)
            const jitter = reduced || low ? 0 : ((tick + i) % 3) - 1;
            const conf = Math.min(99, Math.max(0, shownC + jitter)) / 100;
            const active = open === i;
            const isTraining = s.status === "TRAINING";
            return (
              <div
                key={s.n}
                role="button"
                tabIndex={0}
                onMouseEnter={() => setOpen(i)}
                onMouseLeave={() => setOpen(null)}
                onFocus={() => setOpen(i)}
                onBlur={() => setOpen(null)}
                onClick={() => fireEgg(i)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    fireEgg(i);
                  }
                }}
                className="cursor-pointer rounded outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <div className="mb-1 flex items-baseline justify-between font-mono text-xs">
                  <span className="text-fg">
                    {s.n}
                    {s.note && <span className="ml-2 text-muted">— {s.note}</span>}
                  </span>
                  <span className="flex items-center gap-2.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-[1px] text-[9px] uppercase tracking-[0.12em] ${
                        low
                          ? "border-edge text-muted"
                          : isTraining
                          ? "border-live/40 text-live"
                          : "border-accent/40 text-accentText"
                      }`}
                    >
                      {isTraining && <span className="cm-dot h-1 w-1 rounded-full bg-live" />}
                      {s.status}
                    </span>
                    <span
                      className={`tabular-nums ${low ? "text-muted" : "text-accentText"}`}
                    >
                      {conf.toFixed(2)}
                    </span>
                  </span>
                </div>

                <div className="relative h-2 overflow-hidden rounded-full bg-surface">
                  <div
                    className={`h-full rounded-full ${low ? "bg-muted" : "bg-accent"}`}
                    style={{
                      width: show ? `${shownC}%` : "0%",
                      transition: reduced
                        ? "none"
                        : `width .9s cubic-bezier(.16,1,.3,1) ${i * 80}ms`,
                    }}
                  />
                  {active && !reduced && !low && (
                    <span className="cm-scan pointer-events-none absolute inset-y-0 left-0 w-1/3" />
                  )}
                </div>

                <div
                  className="overflow-hidden font-mono text-[10px] text-muted"
                  style={{
                    maxHeight: active ? 20 : 0,
                    opacity: active ? 1 : 0,
                    transition: reduced ? "none" : "max-height .25s, opacity .25s",
                  }}
                >
                  <span className="mt-1 inline-block">↳ {s.ev}</span>
                </div>
              </div>
            );
          })}
        </div>

        {toast && (
          <div className="pointer-events-none mt-6 inline-flex rounded-md border border-accent/40 bg-surface px-3 py-1.5 font-mono text-[11px] text-accentText shadow-sm">
            {toast}
          </div>
        )}
      </div>

      <style jsx>{`
        .cm-scan {
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.45),
            transparent
          );
          animation: cmScan 1.4s ease-in-out infinite;
        }
        .cm-dot {
          animation: cmPulse 1.1s ease-in-out infinite;
        }
        @keyframes cmScan {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(400%);
          }
        }
        @keyframes cmPulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.2;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .cm-scan,
          .cm-dot {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
};

export default ConfidenceMeter;
