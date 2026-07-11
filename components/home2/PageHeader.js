import React from "react";
import { motion } from "framer-motion";

// Shared page header for every migrated inner page — keeps the home2 identity
// consistent: engineered grid, amber glow, mono eyebrow, display title.
const PageHeader = ({ eyebrow, title, accent, subtitle, children }) => {
  return (
    <section className="relative overflow-hidden border-b border-edge bg-bg pt-32 pb-16 sm:pt-36 sm:pb-20">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.5] dark:opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--c-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--c-grid) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(110% 90% at 25% 0%, #000 30%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(110% 90% at 25% 0%, #000 30%, transparent 78%)",
        }}
      />
      <div className="pointer-events-none absolute -left-32 -top-40 h-[440px] w-[440px] rounded-full bg-amber/10 blur-[120px]" />

      <div className="relative mx-auto max-w-6xl px-6">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="font-mono text-xs uppercase tracking-[0.22em] text-accentText"
        >
          {eyebrow}
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mt-4 max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight text-fg sm:text-5xl"
        >
          {title} {accent && <span className="text-accentText">{accent}</span>}
        </motion.h1>
        {subtitle && (
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg"
          >
            {subtitle}
          </motion.p>
        )}
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
};

export default PageHeader;
