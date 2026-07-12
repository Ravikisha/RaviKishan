import React, { useMemo, useState } from "react";

// Interactive system-design diagram. Click a node → everything that DEPENDS on
// it (its upstream callers, transitively) lights up. e.g. click Redis → every
// service that touches Redis illuminates. Edges are from → to ("from uses to").
const KIND = { infra: "#4ED0C0", service: "#A78BFA", data: "#FBBF24", client: "#818CF8" };
const NODES = [
  { id: "Client", x: 8, y: 30, k: "client" },
  { id: "CDN", x: 20, y: 30, k: "infra" },
  { id: "Load Balancer", x: 33, y: 30, k: "infra" },
  { id: "API Gateway", x: 46, y: 30, k: "infra" },
  { id: "User Service", x: 60, y: 16, k: "service" },
  { id: "Order Service", x: 60, y: 44, k: "service" },
  { id: "Auth", x: 74, y: 9, k: "service" },
  { id: "Redis", x: 74, y: 30, k: "data" },
  { id: "Kafka", x: 74, y: 51, k: "data" },
  { id: "Postgres", x: 91, y: 22, k: "data" },
  { id: "Search", x: 91, y: 48, k: "data" },
];
const EDGES = [
  ["Client", "CDN"], ["CDN", "Load Balancer"], ["Load Balancer", "API Gateway"],
  ["API Gateway", "User Service"], ["API Gateway", "Order Service"],
  ["User Service", "Auth"], ["User Service", "Redis"], ["User Service", "Postgres"],
  ["Order Service", "Redis"], ["Order Service", "Kafka"], ["Order Service", "Postgres"],
  ["Auth", "Redis"], ["Kafka", "Search"],
];

export default function SystemDesignCanvas() {
  const [sel, setSel] = useState(null);

  const rev = useMemo(() => {
    const m = {};
    EDGES.forEach(([f, t]) => (m[t] = m[t] || []).push(f));
    return m;
  }, []);

  // all nodes that (transitively) depend on `id` — reverse BFS
  const dependents = useMemo(() => {
    if (!sel) return null;
    const seen = new Set([sel]);
    const q = [sel];
    while (q.length) {
      const n = q.shift();
      (rev[n] || []).forEach((p) => { if (!seen.has(p)) { seen.add(p); q.push(p); } });
    }
    return seen;
  }, [sel, rev]);

  const nodeOn = (id) => !sel || (dependents && dependents.has(id));
  const edgeOn = (f, t) => sel && dependents && dependents.has(f) && dependents.has(t);
  const byId = (id) => NODES.find((n) => n.id === id);
  const W = (id) => Math.max(9, id.length * 1.25 + 4);

  return (
    <div className="sd">
      <div className="sd-head">
        <span>system-design · request path</span>
        <span className="sd-hint">
          {sel ? (
            <><b style={{ color: "#FFB020" }}>{dependents.size - 1}</b> components depend on <b>{sel}</b> · <button className="sd-clear" onClick={() => setSel(null)}>reset</button></>
          ) : "click a node to trace its dependents"}
        </span>
      </div>
      <div className="sd-canvas">
        <svg viewBox="0 0 100 60" className="sd-svg">
          {EDGES.map(([f, t], i) => {
            const a = byId(f), b = byId(t), on = edgeOn(f, t);
            return (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={on ? "#FFB020" : "rgba(148,163,184,0.35)"}
                strokeWidth={on ? 0.5 : 0.22}
                opacity={sel ? (on ? 0.95 : 0.08) : 0.5} />
            );
          })}
          {NODES.map((n) => {
            const on = nodeOn(n.id);
            const w = W(n.id), h = 6;
            const isSel = n.id === sel;
            return (
              <g key={n.id} style={{ cursor: "pointer" }} onClick={() => setSel(isSel ? null : n.id)}
                 opacity={on ? 1 : 0.25}>
                <rect x={n.x - w / 2} y={n.y - h / 2} width={w} height={h} rx="1.4"
                  fill={isSel ? KIND[n.k] : "#14161c"}
                  stroke={KIND[n.k]} strokeWidth={isSel ? 0.5 : 0.3} />
                <text x={n.x} y={n.y + 1.1} textAnchor="middle" fontSize="2.4"
                  fontFamily="'JetBrains Mono', monospace"
                  fill={isSel ? "#0a0b0f" : on ? "#e7e8ee" : "#7a8090"}>{n.id}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="sd-legend">
        {Object.entries({ Client: "client", Infra: "infra", Service: "service", Data: "data" }).map(([lbl, k]) => (
          <span key={k}><i style={{ background: KIND[k] }} />{lbl}</span>
        ))}
      </div>
      <style jsx>{`
        .sd { height: 100%; display: flex; flex-direction: column; background: #0a0b0f; color: #c4c7d2; font-family: "JetBrains Mono", monospace; font-size: 12px; }
        .sd-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #1a1d26; color: #e7e8ee; }
        .sd-hint { color: #7a8090; font-size: 11px; }
        .sd-hint b { color: #e7e8ee; }
        .sd-clear { background: none; border: none; color: #4ED0C0; cursor: pointer; font: inherit; text-decoration: underline; }
        .sd-canvas { flex: 1; min-height: 0; padding: 8px; }
        .sd-svg { display: block; height: 100%; width: 100%; }
        .sd-legend { display: flex; gap: 16px; padding: 8px 14px; border-top: 1px solid #1a1d26; font-size: 10px; color: #7a8090; }
        .sd-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .sd-legend i { height: 8px; width: 8px; border-radius: 2px; display: inline-block; }
      `}</style>
    </div>
  );
}
