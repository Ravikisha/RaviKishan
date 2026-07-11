import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useSiteContent } from "../../lib/useSiteContent";

function CountUp({ value, suffix }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  const decimals = value % 1 !== 0 ? 1 : 0;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "-60px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setN(value);
      return;
    }
    let raf;
    const start = performance.now();
    const dur = 1100;
    const tick = (t) => {
      const p = Math.min((t - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, reduced]);

  const display =
    value >= 1000
      ? Math.round(n).toLocaleString()
      : n.toFixed(decimals);

  return (
    <span ref={ref}>
      {display}
      {suffix}
    </span>
  );
}

const StatStrip = () => {
  const { stats, marquee } = useSiteContent();
  const row = [...marquee, ...marquee];
  return (
    <section className="relative border-y border-edge bg-bg">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-6 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: i * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="border-edge px-5 py-9 sm:px-7 [&:nth-child(odd)]:border-r lg:border-r lg:[&:last-child]:border-r-0"
          >
            <div className="font-display text-4xl font-bold tracking-tight text-accentText sm:text-5xl">
              <CountUp value={s.value} suffix={s.suffix} />
            </div>
            <div className="mt-2 max-w-[210px] font-mono text-xs leading-relaxed text-muted">
              {s.label}
            </div>
          </motion.div>
        ))}
      </div>

      <div className="relative overflow-hidden border-t border-edge py-4">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-bg to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-bg to-transparent" />
        <div className="flex w-max animate-marquee gap-8 whitespace-nowrap will-change-transform">
          {row.map((t, i) => (
            <span
              key={i}
              className="font-mono text-sm text-muted/70 transition-colors hover:text-accentText"
            >
              {t}
              <span className="ml-8 text-edge">/</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StatStrip;
