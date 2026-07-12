import React, { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { ArrowRight, ArrowDown, Check, RotateCcw } from "lucide-react";

// Generic animated pipeline. A "pulse" walks the stages left→right (down on
// mobile): completed stages tick green/amber, the active one pulses "processing",
// upcoming ones stay muted. Loops. Reduced-motion → all stages shown complete.
//
// stages: [{ label, sub }]   loop: draw a return arrow at the end
// io: { input, output }      shown as the pipeline's in/out payload
export default function FlowViz({ stages, loop = false, stepMs = 850, io }) {
  const reduced = useReducedMotion();
  const n = stages.length;
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(n); // n = all complete (SSR/reduced)

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted || reduced) {
      setActive(n);
      return;
    }
    let a = 0;
    setActive(0);
    const id = setInterval(() => {
      a = a > n ? 0 : a + 1; // extra beat at n = full "complete" frame, then loop
      setActive(a);
    }, stepMs);
    return () => clearInterval(id);
  }, [mounted, reduced, n, stepMs]);

  const complete = active >= n;

  return (
    <div className="rounded-xl border border-edge bg-surface p-5 sm:p-6">
      {/* input payload */}
      {io?.input && (
        <div className="mb-4 flex items-center gap-2 font-mono text-[11px] text-muted">
          <span className="text-accentText">in</span>
          <span className="text-edge">›</span>
          <span className="truncate">{io.input}</span>
        </div>
      )}

      {/* the flow */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0">
        {stages.map((s, i) => {
          const done = i < active;
          const processing = i === active && active < n;
          return (
            <React.Fragment key={s.label}>
              <div
                className={`relative flex-1 rounded-lg border px-3 py-2.5 transition-colors duration-300 ${
                  processing
                    ? "border-amber/60 bg-amber/5"
                    : done
                    ? "border-amber/30 bg-bg"
                    : "border-edge bg-bg"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`font-display text-sm font-semibold ${
                      done || processing ? "text-fg" : "text-muted"
                    }`}
                  >
                    {s.label}
                  </span>
                  {done ? (
                    <Check className="h-3.5 w-3.5 text-accentText" />
                  ) : processing ? (
                    <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_var(--c-accent)] animate-pulse" />
                  ) : (
                    <span className="h-2 w-2 rounded-full border border-edge" />
                  )}
                </div>
                <div className="mt-1 font-mono text-[10px] leading-snug text-muted">
                  {processing ? (
                    <span className="text-accentText">processing…</span>
                  ) : (
                    s.sub
                  )}
                </div>
              </div>

              {/* connector (not after the last node) */}
              {i < n - 1 && (
                <div className="flex items-center justify-center px-1 py-0.5 lg:py-0 lg:px-1.5">
                  <ArrowDown
                    className={`h-4 w-4 lg:hidden ${
                      done ? "text-accentText" : "text-edge"
                    }`}
                  />
                  <ArrowRight
                    className={`hidden h-4 w-4 lg:block ${
                      done ? "text-accentText" : "text-edge"
                    }`}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* loop-back indicator */}
      {loop && (
        <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-muted">
          <RotateCcw className="h-3.5 w-3.5 text-accentText" />
          on failure → planner retries with feedback
        </div>
      )}

      {/* output payload */}
      {io?.output && (
        <div className="mt-4 flex items-center gap-2 border-t border-edge pt-4 font-mono text-[11px]">
          <span className="text-live">out</span>
          <span className="text-edge">›</span>
          <span className={complete ? "text-fg" : "text-muted"}>
            {complete ? io.output : "awaiting pipeline…"}
          </span>
        </div>
      )}
    </div>
  );
}
