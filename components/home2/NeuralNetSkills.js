import React, { useMemo, useState } from "react";
import { Brain } from "lucide-react";

// Interactive neural-net view of the skill domains. Hover a node → the edges
// and neurons it connects to light up, like a forward pass. Pure SVG, no deps.
const LAYERS = [
  { id: "in", labels: ["Languages", "AI / ML", "Backend", "Frontend", "Systems", "DevOps"] },
  { id: "h1", count: 5 },
  { id: "h2", count: 4 },
  { id: "out", labels: ["Ravi"] },
];

const X = [20, 46, 66, 84]; // column x per layer
const yFor = (j, n) => 8 + ((j + 0.5) / n) * 44; // spread in 8..52

const NeuralNetSkills = () => {
  const [hover, setHover] = useState(null);

  const { nodes, edges } = useMemo(() => {
    const nodes = [];
    LAYERS.forEach((layer, li) => {
      const n = layer.labels ? layer.labels.length : layer.count;
      for (let j = 0; j < n; j++) {
        nodes.push({
          id: `${li}-${j}`,
          li,
          x: X[li],
          y: yFor(j, n),
          label: layer.labels ? layer.labels[j] : null,
        });
      }
    });
    const edges = [];
    for (let li = 0; li < LAYERS.length - 1; li++) {
      const a = nodes.filter((nd) => nd.li === li);
      const b = nodes.filter((nd) => nd.li === li + 1);
      a.forEach((from) => b.forEach((to) => edges.push({ from: from.id, to: to.id })));
    }
    return { nodes, edges };
  }, []);

  const byId = (id) => nodes.find((n) => n.id === id);
  const edgeOn = (e) => hover && (e.from === hover || e.to === hover);
  const nodeOn = (id) =>
    hover &&
    (id === hover ||
      edges.some((e) => (e.from === hover && e.to === id) || (e.to === hover && e.from === id)));

  return (
    <section className="border-b border-edge bg-bg py-20">
      <div className="mx-auto max-w-4xl px-6">
        <div className="mb-8 flex items-center gap-3">
          <Brain className="h-4 w-4 text-accentText" />
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
            Skill network
          </p>
          <span className="h-px flex-1 bg-edge" />
          <span className="font-mono text-xs text-muted">
            {hover ? "forward pass" : "hover a neuron"}
          </span>
        </div>

        <div className="rounded-xl border border-edge bg-surface p-4">
          <svg viewBox="0 0 100 60" className="block h-[300px] w-full sm:h-[360px]">
            {/* edges */}
            {edges.map((e, i) => {
              const a = byId(e.from);
              const b = byId(e.to);
              const on = edgeOn(e);
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={on ? "var(--c-accent)" : "var(--c-edge)"}
                  strokeWidth={on ? 0.5 : 0.2}
                  opacity={hover ? (on ? 0.9 : 0.15) : 0.4}
                  style={{ transition: "opacity .2s, stroke .2s" }}
                />
              );
            })}
            {/* nodes */}
            {nodes.map((n) => {
              const on = n.id === hover || nodeOn(n.id);
              const isIn = n.li === 0;
              const isOut = n.li === LAYERS.length - 1;
              return (
                <g key={n.id}>
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={isOut ? 2.6 : isIn ? 2 : 1.5}
                    fill={on || (!hover && isOut) ? "var(--c-accent)" : "var(--c-surface)"}
                    stroke={on ? "var(--c-accent)" : "var(--c-edge)"}
                    strokeWidth="0.4"
                    style={{ cursor: "pointer", transition: "fill .2s" }}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                  />
                  {n.label && isIn && (
                    <text
                      x={n.x - 3}
                      y={n.y + 1}
                      textAnchor="end"
                      fontSize="2.5"
                      fontFamily="monospace"
                      fill={on ? "var(--c-fg)" : "var(--c-muted)"}
                      onMouseEnter={() => setHover(n.id)}
                      onMouseLeave={() => setHover(null)}
                      style={{ cursor: "pointer" }}
                    >
                      {n.label}
                    </text>
                  )}
                  {n.label && isOut && (
                    <text
                      x={n.x + 4}
                      y={n.y + 1}
                      fontSize="3"
                      fontFamily="monospace"
                      fill="var(--c-accent)"
                    >
                      {n.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        <p className="mt-3 font-mono text-[11px] text-muted">
          input domains → hidden layers → one slightly overtrained engineer.
        </p>
      </div>
    </section>
  );
};

export default NeuralNetSkills;
