import React, { useEffect, useMemo, useRef, useState } from "react";
import { Brain } from "lucide-react";

// "Ravi Neural Engine" — the skill section as a live inference panel instead of a
// static diagram. Input domains fire left→right (a forward pass), particles flow
// the active wires, and the engine emits an output token. Hover a domain to inspect
// its real skills + confidence; click one for a side-effect. Pure SVG + CSS, no deps.
//
// All skills trace to lib/facts.js (marquee + systems). Numbers are playful but the
// skill lists are real.
const DOMAINS = [
  { key: "Languages", sym: "</>", conf: 99, skills: ["TypeScript", "Go", "Rust", "Python", "Java", "C++"] },
  { key: "AI / ML", sym: "◎", conf: 96, skills: ["LangGraph", "RAG", "PyTorch", "FAISS", "Agents", "MCP"] },
  { key: "Backend", sym: "{ }", conf: 98, skills: ["gRPC", "Kafka", "PostgreSQL", "Redis", "Node.js"] },
  { key: "Frontend", sym: "▢", conf: 90, skills: ["Next.js", "React", "Relax.js", "Tailwind"] },
  { key: "Systems", sym: "⚙", conf: 95, skills: ["SIMD", "CUDA", "Concurrency", "RESP", "Replication"] },
  { key: "DevOps", sym: "⬢", conf: 82, skills: ["Kubernetes", "Docker", "CI/CD", "Linux"] },
];

// Rotating output tokens — the engine's "prediction" for the input query.
const OUTPUTS = [
  "Ravi Kishan",
  "AI Engineer",
  "Quant Developer",
  "Systems Builder",
  "Patent Holder",
  "GPT Whisperer",
  "Still Debugging",
  "404: Social Life",
  "Coffee → Code",
  "Works On My Machine",
];

// Rotating engine telemetry (was: one static caption).
const TELEMETRY = [
  "epoch 421 · loss 0.003",
  "val_acc 99.1% · overfit: charming",
  "GPU RTX 3050 · 87°C (suffering)",
  "coffee level: critical",
  "stackoverflow: connected",
  "hallucination: under control",
  "git branch: main (hopefully)",
  "inference 34ms · one overtrained engineer",
];

// Click a domain node → a small, on-brand side-effect.
const EGGS = {
  Languages: "semicolon; found; happiness;",
  "AI / ML": "touched grass: 0%",
  Backend: "NullPointerException … fixed.",
  Frontend: "npm install · ETA 3 business days",
  Systems: "segfault (core dumped) · worth it",
  DevOps: "deploy → rollback → deploy → rollback…",
};

const PHASES = ["› reading input", "› embedding", "› reasoning", "› emitting token"];

const LAYERS = [
  { id: "in", labels: DOMAINS.map((d) => d.key) },
  { id: "h1", count: 5 },
  { id: "h2", count: 4 },
  { id: "out", labels: ["out"] },
];
const X = [20, 46, 68, 90]; // column x per layer (viewBox has -6..106 padding)
const yFor = (j, n) => 8 + ((j + 0.5) / n) * 56; // spread across an 8..64 band

const liOf = (id) => Number(id.split("-")[0]);

const NeuralNetSkills = () => {
  const [hover, setHover] = useState(null); // hovered domain index
  const [step, setStep] = useState(0); // forward-pass ticker
  const [typed, setTyped] = useState("");
  const [tele, setTele] = useState(0);
  const [toast, setToast] = useState(null);
  const [reduced, setReduced] = useState(false);
  const toastRef = useRef(null);

  // Respect prefers-reduced-motion → freeze into a fully-computed static state.
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(m.matches);
    sync();
    m.addEventListener ? m.addEventListener("change", sync) : m.addListener(sync);
    return () =>
      m.removeEventListener ? m.removeEventListener("change", sync) : m.removeListener(sync);
  }, []);

  // Forward-pass + telemetry tickers.
  useEffect(() => {
    if (reduced) return undefined;
    const pass = setInterval(() => setStep((s) => s + 1), 640);
    const t = setInterval(() => setTele((i) => (i + 1) % TELEMETRY.length), 2600);
    return () => {
      clearInterval(pass);
      clearInterval(t);
    };
  }, [reduced]);

  useEffect(() => () => clearTimeout(toastRef.current), []);

  const phase = reduced ? 3 : step % 4;
  const passId = Math.floor(step / 4);
  const outWord = OUTPUTS[passId % OUTPUTS.length];
  const firing = reduced ? -1 : step % DOMAINS.length; // which domain "lights up" now

  // Type the output token out, GPT-style, each new pass.
  useEffect(() => {
    if (reduced) {
      setTyped(outWord);
      return undefined;
    }
    setTyped("");
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setTyped(outWord.slice(0, i));
      if (i >= outWord.length) clearInterval(t);
    }, 55);
    return () => clearInterval(t);
  }, [outWord, reduced]);

  const { nodes, edges } = useMemo(() => {
    const nds = [];
    LAYERS.forEach((layer, li) => {
      const n = layer.labels ? layer.labels.length : layer.count;
      for (let j = 0; j < n; j++) {
        nds.push({ id: `${li}-${j}`, li, x: X[li], y: yFor(j, n) });
      }
    });
    const eds = [];
    for (let li = 0; li < LAYERS.length - 1; li++) {
      const a = nds.filter((nd) => nd.li === li);
      const b = nds.filter((nd) => nd.li === li + 1);
      a.forEach((from) => b.forEach((to) => eds.push({ from: from.id, to: to.id })));
    }
    return { nodes: nds, edges: eds };
  }, []);

  const byId = (id) => nodes.find((n) => n.id === id);

  const edgeLit = (e) => {
    if (hover != null) return e.from === `0-${hover}`;
    return phase > 0 && liOf(e.to) === phase;
  };
  const nodeLit = (id) => {
    if (hover != null) return id === `0-${hover}` || liOf(id) === 3;
    return liOf(id) === phase || liOf(id) === 3;
  };
  const nodeStrong = (id) => (hover != null ? id === `0-${hover}` : liOf(id) === phase);

  const focusDomain = (j) => setHover(j);
  const blurDomain = () => setHover(null);
  const fireEgg = (j) => {
    setToast(EGGS[DOMAINS[j].key]);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 2200);
  };

  const statusText =
    hover != null
      ? `› inspecting ${DOMAINS[hover].key}`
      : reduced
      ? "› ready"
      : PHASES[phase];

  const shownDomains = hover != null ? [DOMAINS[hover]] : DOMAINS;

  return (
    <section className="border-b border-edge bg-bg py-20">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mb-8 flex items-center gap-3">
          <Brain className="h-4 w-4 text-accentText" />
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
            Ravi Neural Engine
          </p>
          <span className="h-px flex-1 bg-edge" />
          <span className="font-mono text-xs text-muted">{statusText}</span>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-edge bg-surface">
          {/* faint background equations */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 select-none font-mono text-fg"
            style={{ opacity: 0.04 }}
          >
            <span className="absolute left-[8%] top-[14%] text-2xl">y = Wx + b</span>
            <span className="absolute right-[10%] top-[30%] text-xl">softmax(z)</span>
            <span className="absolute left-[16%] bottom-[18%] text-xl">Attn(Q,K,V)</span>
            <span className="absolute right-[22%] bottom-[26%] text-2xl">∇L → 0</span>
            <span className="absolute left-[44%] top-[52%] text-lg">argmax</span>
          </div>

          <div className="relative flex flex-col gap-4 p-4 md:flex-row">
            {/* the network */}
            <div className="md:w-[56%]">
              <svg
                viewBox="-6 0 112 72"
                className="block h-[280px] w-full md:h-[340px]"
                role="img"
                aria-label="Neural network of Ravi's skill domains computing a forward pass"
              >
                {edges.map((e, i) => {
                  const a = byId(e.from);
                  const b = byId(e.to);
                  const on = edgeLit(e);
                  return (
                    <line
                      key={i}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={on ? "var(--c-accent)" : "var(--c-edge)"}
                      strokeWidth={on ? 0.55 : 0.2}
                      opacity={on ? 0.95 : hover != null || phase > 0 ? 0.12 : 0.3}
                      className={on ? "nne-flow" : undefined}
                      style={{ transition: "opacity .25s, stroke .25s" }}
                    />
                  );
                })}

                {nodes.map((n) => {
                  const lit = nodeLit(n.id);
                  const strong = nodeStrong(n.id);
                  const isIn = n.li === 0;
                  const isOut = n.li === LAYERS.length - 1;
                  const r = isOut ? 3 : isIn ? 2 : 1.4;
                  const dom = isIn ? DOMAINS[Number(n.id.split("-")[1])] : null;
                  return (
                    <g key={n.id}>
                      {strong && (
                        <circle
                          cx={n.x}
                          cy={n.y}
                          r={r + 1.6}
                          fill="var(--c-accent)"
                          className="nne-halo"
                        />
                      )}
                      <g
                        role={isIn ? "button" : undefined}
                        tabIndex={isIn ? 0 : undefined}
                        aria-label={isIn ? `${dom.key} skills` : undefined}
                        style={{ cursor: isIn ? "pointer" : "default", outline: "none" }}
                        onMouseEnter={isIn ? () => focusDomain(Number(n.id.split("-")[1])) : undefined}
                        onMouseLeave={isIn ? blurDomain : undefined}
                        onFocus={isIn ? () => focusDomain(Number(n.id.split("-")[1])) : undefined}
                        onBlur={isIn ? blurDomain : undefined}
                        onClick={isIn ? () => fireEgg(Number(n.id.split("-")[1])) : undefined}
                        onKeyDown={
                          isIn
                            ? (ev) => {
                                if (ev.key === "Enter" || ev.key === " ") {
                                  ev.preventDefault();
                                  fireEgg(Number(n.id.split("-")[1]));
                                }
                              }
                            : undefined
                        }
                      >
                        <circle
                          cx={n.x}
                          cy={n.y}
                          r={r}
                          fill={lit ? "var(--c-accent)" : "var(--c-surface)"}
                          stroke={lit ? "var(--c-accent)" : "var(--c-edge)"}
                          strokeWidth="0.4"
                          style={{ transition: "fill .25s, stroke .25s" }}
                        />
                        {isIn && (
                          <text
                            x={n.x - 3.4}
                            y={n.y + 0.9}
                            textAnchor="end"
                            fontSize="2.3"
                            fontFamily="monospace"
                            fill={hover === Number(n.id.split("-")[1]) ? "var(--c-fg)" : "var(--c-muted)"}
                            style={{ transition: "fill .2s" }}
                          >
                            {dom.sym} {dom.key}
                          </text>
                        )}
                      </g>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* engine readout */}
            <div className="flex-1 rounded-lg border border-edge bg-bg/60 p-4 font-mono text-xs">
              <div className="text-muted">
                <span className="text-accentText">query ›</span>{" "}
                {'"I need an AI engineer."'}
              </div>

              <div className="mt-3 space-y-2">
                {shownDomains.map((d) => {
                  const isFiring = hover == null && firing === DOMAINS.indexOf(d);
                  return (
                    <div key={d.key}>
                      <div className="flex items-center justify-between">
                        <span className={isFiring || hover != null ? "text-fg" : "text-muted"}>
                          <span className="text-accentText">✓</span> {d.key}
                        </span>
                        <span className="text-muted">{d.conf}%</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded bg-edge">
                        <div
                          className="h-full rounded bg-accent"
                          style={{ width: `${d.conf}%`, transition: "width .4s" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {hover != null && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {DOMAINS[hover].skills.map((s) => (
                    <span
                      key={s}
                      className="rounded border border-edge bg-surface px-1.5 py-0.5 text-[10px] text-fg"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-4 border-t border-edge pt-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted">output</div>
                <div className="font-display text-lg text-accentText">
                  {typed || " "}
                  <span className="nne-caret">▌</span>
                </div>
              </div>

              <div className="mt-3 text-[10px] text-muted">{TELEMETRY[tele]}</div>
            </div>
          </div>

          {/* click side-effect */}
          {toast && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-accent/40 bg-surface px-3 py-1.5 font-mono text-[11px] text-accentText shadow-lg">
              {toast}
            </div>
          )}
        </div>

        <p className="mt-3 font-mono text-[11px] text-muted">
          hover a domain to inspect the weights · click one for side-effects · input domains →
          hidden layers → one slightly overtrained engineer.
        </p>
      </div>

      <style jsx>{`
        .nne-flow {
          stroke-dasharray: 0.5 2.4;
          stroke-linecap: round;
          animation: nneFlow 0.6s linear infinite;
        }
        .nne-caret {
          animation: nneBlink 1s step-end infinite;
        }
        .nne-halo {
          opacity: 0.22;
          animation: nneHalo 1.2s ease-in-out infinite;
        }
        @keyframes nneFlow {
          to {
            stroke-dashoffset: -5.8;
          }
        }
        @keyframes nneBlink {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0;
          }
        }
        @keyframes nneHalo {
          0%,
          100% {
            opacity: 0.12;
          }
          50% {
            opacity: 0.3;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .nne-flow,
          .nne-caret,
          .nne-halo {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
};

export default NeuralNetSkills;
