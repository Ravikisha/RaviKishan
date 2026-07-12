import React, { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Gauge } from "lucide-react";

// Tongue-in-cheek "model confidence" meter for the skills page. Bars fill on
// scroll-into-view. Mostly honest; the last one is the joke.
const SKILLS = [
  { n: "TypeScript", c: 96 },
  { n: "Go", c: 92 },
  { n: "Python", c: 94 },
  { n: "Rust", c: 84 },
  { n: "Distributed systems", c: 90 },
  { n: "Applied AI / RAG", c: 91 },
  { n: "System design", c: 88 },
  { n: "CSS", c: 34, note: "still Googling flexbox" },
];

const ConfidenceMeter = () => {
  const reduced = useReducedMotion();
  const ref = useRef(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (reduced) {
      setShow(true);
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
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

  return (
    <section className="border-b border-edge bg-bg py-20" ref={ref}>
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-8 flex items-center gap-3">
          <Gauge className="h-4 w-4 text-accentText" />
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
            Model confidence
          </p>
          <span className="h-px flex-1 bg-edge" />
          <span className="font-mono text-xs text-muted">self-reported</span>
        </div>

        <div className="space-y-4">
          {SKILLS.map((s, i) => {
            const low = s.c < 50;
            return (
              <div key={s.n}>
                <div className="mb-1 flex items-baseline justify-between font-mono text-xs">
                  <span className="text-fg">
                    {s.n}
                    {s.note && (
                      <span className="ml-2 text-muted">— {s.note}</span>
                    )}
                  </span>
                  <span className={low ? "text-muted" : "text-accentText"}>
                    {s.c}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface">
                  <div
                    className={`h-full rounded-full ${
                      low ? "bg-muted" : "bg-accent"
                    }`}
                    style={{
                      width: show ? `${s.c}%` : "0%",
                      transition: reduced
                        ? "none"
                        : `width .9s cubic-bezier(.16,1,.3,1) ${i * 80}ms`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default ConfidenceMeter;
