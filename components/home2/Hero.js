import React, { useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Github, Linkedin, FileText, Star } from "lucide-react";
import { identity, github, chips } from "../../lib/facts";
import BuildLog from "./BuildLog";

const HeroCanvas = dynamic(() => import("./HeroCanvas"), { ssr: false });

const rise = {
  hidden: { opacity: 0, y: 16 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.06 * i, duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  }),
};

const Hero = () => {
  const reduced = useReducedMotion();
  const cardRef = useRef(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const onMove = (e) => {
    if (reduced) return;
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ x: -py * 6, y: px * 8 });
  };

  return (
    <section className="relative overflow-hidden bg-bg pt-28 pb-20 sm:pt-32 lg:pt-36">
      {/* engineered grid + accent glow */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.5] dark:opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--c-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--c-grid) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(120% 90% at 20% 0%, #000 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(120% 90% at 20% 0%, #000 30%, transparent 75%)",
        }}
      />
      <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-amber/10 blur-[120px]" />
      <div className="pointer-events-none absolute right-0 top-1/3 h-[380px] w-[380px] rounded-full bg-teal/5 blur-[130px]" />

      <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-6 lg:grid-cols-[1.02fr_0.98fr] lg:gap-10">
        {/* left — thesis */}
        <div>
          <motion.p
            variants={rise}
            initial="hidden"
            animate="show"
            custom={0}
            className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-xs uppercase tracking-[0.22em] text-muted"
          >
            <span className="text-accentText">{identity.name}</span>
            <span className="text-edge">/</span>
            <span>{identity.role}</span>
          </motion.p>

          <motion.h1
            variants={rise}
            initial="hidden"
            animate="show"
            custom={1}
            className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-fg sm:text-5xl lg:text-[3.4rem]"
          >
            I rebuild the layers
            <br />
            most people take{" "}
            <span className="text-accentText">for granted.</span>
          </motion.h1>

          <motion.p
            variants={rise}
            initial="hidden"
            animate="show"
            custom={2}
            className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg"
          >
            {identity.intro}
          </motion.p>

          <motion.div
            variants={rise}
            initial="hidden"
            animate="show"
            custom={3}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <a
              href="#systems"
              className="group inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-accentFg transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              View the systems
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
            <Link href={identity.resume}>
              <a className="inline-flex items-center gap-2 rounded-lg border border-edge bg-surface px-5 py-3 text-sm font-semibold text-fg transition-colors hover:border-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <FileText className="h-4 w-4 text-muted" />
                Résumé
              </a>
            </Link>
            <div className="ml-1 flex items-center gap-1">
              <IconLink href={identity.github} label="GitHub">
                <Github className="h-5 w-5" />
              </IconLink>
              <IconLink href={identity.linkedin} label="LinkedIn">
                <Linkedin className="h-5 w-5" />
              </IconLink>
            </div>
          </motion.div>

          {/* inline proof */}
          <motion.div
            variants={rise}
            initial="hidden"
            animate="show"
            custom={4}
            className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 font-mono text-xs text-muted"
          >
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-live shadow-[0_0_8px_var(--c-live)]" />
              {identity.now}
            </span>
            <span className="flex items-center gap-1.5">
              <Star className="h-3.5 w-3.5 text-accentText" />
              {github.stars} stars · {github.repos} repos
            </span>
            <span>Patent holder</span>
          </motion.div>
        </div>

        {/* right — portrait + 3D + terminal stack */}
        <div className="flex flex-col items-center gap-6 lg:items-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-[400px]"
            style={{ perspective: "1200px" }}
          >
            <div
              ref={cardRef}
              onMouseMove={onMove}
              onMouseLeave={() => setTilt({ x: 0, y: 0 })}
              className="group relative aspect-[4/5] rounded-2xl border border-edge bg-surface/80 shadow-2xl shadow-black/20 backdrop-blur transition-transform duration-200 ease-out dark:shadow-black/50"
              style={{
                transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                transformStyle: "preserve-3d",
              }}
            >
              {/* 3D wireframe backdrop */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                <div className="absolute inset-0 opacity-70">
                  <HeroCanvas reduced={reduced} />
                </div>
                <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-amber/10 to-transparent" />
              </div>

              {/* portrait */}
              <img
                src={identity.photo}
                alt="Ravi Kishan"
                className="absolute inset-x-0 bottom-0 mx-auto h-[96%] w-auto object-contain object-bottom drop-shadow-2xl"
                style={{ transform: "translateZ(40px)" }}
              />

              {/* corner ticks */}
              <span className="absolute left-3 top-3 h-4 w-4 border-l-2 border-t-2 border-accent/70" />
              <span className="absolute right-3 top-3 h-4 w-4 border-r-2 border-t-2 border-accent/70" />

              {/* caption bar — identity, distinct from the terminal below */}
              <div className="absolute inset-x-3 bottom-3 flex items-center justify-between rounded-lg border border-edge bg-bg/85 px-3 py-2 backdrop-blur">
                <span className="font-display text-sm font-semibold text-fg">
                  Ravi Kishan
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-live">
                  <span className="h-1.5 w-1.5 rounded-full bg-live" />
                  open to work
                </span>
              </div>
            </div>

            {/* floating proof chips — kept off the face */}
            <Chip className="-left-4 top-10" delay={0.6} reduced={reduced}>
              {chips[0]}
            </Chip>
            <Chip className="-right-2 bottom-28" delay={0.8} reduced={reduced}>
              {chips[1]}
            </Chip>
            <Chip className="-left-3 bottom-20" delay={1} reduced={reduced}>
              {chips[2]}
            </Chip>
          </motion.div>

          {/* signature terminal */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[400px]"
          >
            <BuildLog />
          </motion.div>
        </div>
      </div>
    </section>
  );
};

const Chip = ({ children, className, delay, reduced }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    className={`absolute z-10 ${className}`}
  >
    <motion.div
      animate={reduced ? {} : { y: [0, -6, 0] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay }}
      className="rounded-full border border-edge bg-surface/95 px-3 py-1.5 font-mono text-[11px] font-medium text-fg shadow-lg shadow-black/10 backdrop-blur dark:shadow-black/40"
    >
      <span className="mr-1.5 text-accentText">●</span>
      {children}
    </motion.div>
  </motion.div>
);

const IconLink = ({ href, label, children }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={label}
    className="rounded-lg p-2.5 text-muted transition-colors hover:bg-surface hover:text-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
  >
    {children}
  </a>
);

export default Hero;
