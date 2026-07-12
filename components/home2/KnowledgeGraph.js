import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Share2, Shuffle } from "lucide-react";
import MacBar from "../ui/MacBar";

// Obsidian-style force-directed knowledge graph on a dark canvas (dark in both
// themes by design). Hand-rolled physics, no deps: repulsion + spring edges +
// gravity + wall bounce. Drag any node (getScreenCTM-accurate), it springs back.
// Nodes are coloured by cluster; size scales with connection count.

const DISPLAY = '"Space Grotesk", ui-sans-serif, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const CENTER_COLOR = "#FFB020";
const CLUSTER = {
  Systems: "#A78BFA",       // violet
  Distributed: "#38BDF8",   // cyan
  "Applied AI": "#34D399",  // emerald
  Languages: "#F472B6",     // pink
  Web: "#818CF8",           // indigo
  "Open Source": "#A3E635", // lime
};
const LABEL_ON = "#EDF0F6";
const LABEL_DIM = "#8B93A6";

const HUBS = Object.keys(CLUSTER);
const ITEMS = {
  Languages: ["Go", "Rust", "TypeScript", "JavaScript", "Python", "Java", "C", "C++", "Kotlin", "C#", "Bash", "SQL", "PHP", "Lua", "WASM", "Assembly"],
  Systems: ["Relax.js", "Redis Clone", "Load Balancer", "RelaxLang", "MyDocker", "SqliteC", "StyleSnap", "CommitMap", "Event Loop", "B-Tree", "WAL", "LSM Tree", "Raft", "Bloom Filter", "Ring Buffer", "Thread Pool", "Scheduler", "Interpreter"],
  Distributed: ["Distributed KV", "RelaxSearch", "RustDNS", "URL Shortener", "SnowUUID", "Sharding", "Replication", "Consistent Hashing", "Gossip", "Vector Clock", "CAP", "Leader Election", "Quorum"],
  "Applied AI": ["RAG · Patent", "LangGraph", "FAISS", "Multi-Agent", "PyTorch", "Embeddings", "Fine-tuning", "Transformers", "Attention", "Vector DB", "Reranking", "Prompt Eng", "LoRA", "Quantization", "BERTScore", "Agents", "RAG Eval"],
  Web: ["Microfrontend Blog", "ZenZip", "JorvelJS", "Portfolio", "Relaxgram", "Next.js", "React", "Tailwind", "Module Federation", "SSR", "PWA", "WebSockets", "Vite"],
  "Open Source": ["167★ GitHub", "1k+ npm", "ExpressCraft", "RelaxCSS", "RelaxIcons", "GitaVerse", "Hacktoberfest", "PyPI", "Docker Hub", "VS Code Ext", "GitHub Actions", "Packagist"],
};
const CROSS = [
  ["Go", "Distributed KV"], ["Go", "RelaxSearch"], ["Go", "RustDNS"], ["Go", "Redis Clone"], ["Go", "URL Shortener"], ["Go", "Load Balancer"],
  ["Rust", "RustDNS"], ["Rust", "Redis Clone"], ["Rust", "WASM"],
  ["TypeScript", "ZenZip"], ["TypeScript", "JorvelJS"], ["TypeScript", "Load Balancer"], ["TypeScript", "Relax.js"], ["TypeScript", "RelaxCSS"], ["TypeScript", "SnowUUID"], ["TypeScript", "Next.js"],
  ["JavaScript", "ExpressCraft"], ["JavaScript", "CommitMap"], ["JavaScript", "RelaxIcons"], ["JavaScript", "Microfrontend Blog"], ["JavaScript", "React"], ["JavaScript", "WebSockets"],
  ["Python", "FAISS"], ["Python", "PyTorch"], ["Python", "RAG · Patent"], ["Python", "Embeddings"], ["Python", "Fine-tuning"], ["Python", "Transformers"], ["Python", "SQL"],
  ["C", "SqliteC"], ["C", "RelaxLang"], ["C++", "RelaxLang"], ["Java", "RelaxLang"], ["C", "Ring Buffer"], ["C", "Interpreter"],
  ["RAG · Patent", "FAISS"], ["RAG · Patent", "LangGraph"], ["RAG · Patent", "Embeddings"], ["RAG · Patent", "Reranking"], ["RAG · Patent", "BERTScore"], ["RAG · Patent", "Vector DB"],
  ["Multi-Agent", "LangGraph"], ["Multi-Agent", "Agents"], ["Embeddings", "FAISS"], ["Embeddings", "Vector DB"], ["GitaVerse", "RAG · Patent"], ["Transformers", "Attention"], ["Fine-tuning", "LoRA"], ["Fine-tuning", "Quantization"], ["RAG Eval", "BERTScore"], ["Vector DB", "FAISS"],
  ["Relax.js", "1k+ npm"], ["Relax.js", "167★ GitHub"], ["Relax.js", "React"], ["RelaxCSS", "1k+ npm"], ["RelaxCSS", "Tailwind"], ["ExpressCraft", "1k+ npm"], ["RelaxIcons", "1k+ npm"], ["GitaVerse", "1k+ npm"], ["NexaPHP", "Packagist"], ["PHP", "Packagist"],
  ["Next.js", "React"], ["Next.js", "SSR"], ["Next.js", "Portfolio"], ["JorvelJS", "Module Federation"], ["Microfrontend Blog", "Module Federation"], ["Tailwind", "Portfolio"], ["React", "Tailwind"], ["PWA", "Portfolio"],
  ["Distributed KV", "Sharding"], ["Distributed KV", "Replication"], ["Distributed KV", "Raft"], ["RelaxSearch", "B-Tree"], ["Redis Clone", "Event Loop"], ["Redis Clone", "LSM Tree"], ["Consistent Hashing", "Sharding"], ["Leader Election", "Raft"], ["Quorum", "Replication"], ["Gossip", "Vector Clock"], ["CAP", "Replication"],
  ["MyDocker", "Bash"], ["MyDocker", "Scheduler"], ["RelaxLang", "Interpreter"], ["SqliteC", "B-Tree"], ["SqliteC", "WAL"], ["RelaxSearch", "Bloom Filter"], ["Thread Pool", "Scheduler"],
  ["GitHub Actions", "Hacktoberfest"], ["Docker Hub", "MyDocker"], ["VS Code Ext", "167★ GitHub"], ["PyPI", "Python"],
];

const W = 100;
const H = 60;
const CX = W / 2;
const CY = H / 2;

const seed = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619;
  return ((h >>> 0) % 1000) / 1000;
};

function buildGraph() {
  const nodes = [];
  const links = [];
  const add = (id, type, cluster, hi) => {
    if (nodes.some((n) => n.id === id)) return;
    let x, y;
    if (type === "center") { x = CX; y = CY; }
    else {
      const a =
        type === "hub"
          ? (HUBS.indexOf(id) / HUBS.length) * Math.PI * 2
          : (hi / HUBS.length) * Math.PI * 2 + (seed(id) - 0.5) * 0.7;
      const r = type === "hub" ? 17 : 30 + seed(id + "r") * 6;
      x = CX + Math.cos(a) * r;
      y = CY + Math.sin(a) * r * 0.7;
    }
    x = Math.round(x * 100) / 100;
    y = Math.round(y * 100) / 100;
    nodes.push({ id, type, cluster, x, y, vx: 0, vy: 0, deg: 0, pinned: false });
  };
  add("Ravi Kishan", "center", null);
  HUBS.forEach((h, hi) => {
    add(h, "hub", h);
    links.push(["Ravi Kishan", h]);
    (ITEMS[h] || []).forEach((it) => {
      add(it, "item", h, hi);
      links.push([h, it]);
    });
  });
  CROSS.forEach(([a, b]) => {
    if (nodes.some((n) => n.id === a) && nodes.some((n) => n.id === b)) links.push([a, b]);
  });
  links.forEach(([a, b]) => {
    const na = nodes.find((n) => n.id === a);
    const nb = nodes.find((n) => n.id === b);
    if (na) na.deg++;
    if (nb) nb.deg++;
  });
  return { nodes, links };
}

const colorOf = (n) => (n.type === "center" ? CENTER_COLOR : CLUSTER[n.cluster] || "#94A3B8");
const radiusOf = (n) =>
  n.type === "center" ? 2.7 : n.type === "hub" ? 1.9 : Math.min(1.8, 0.9 + n.deg * 0.2);

const KnowledgeGraph = ({ bare = false }) => {
  const initial = useState(buildGraph)[0];
  const sim = useRef(initial);
  const [, tick] = useReducer((x) => x + 1, 0);
  const [hover, setHover] = useState(null);
  const [gfs, setGfs] = useState(false);
  const [gmin, setGmin] = useState(false);
  const [gclosed, setGclosed] = useState(false);

  useEffect(() => {
    if (!gfs) return;
    const onKey = (e) => e.key === "Escape" && setGfs(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gfs]);

  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const rafRef = useRef(null);
  const alphaRef = useRef(1);

  const { nodes, links } = sim.current;
  const nodeMap = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);
  const adj = useMemo(() => {
    const m = {};
    links.forEach(([a, b]) => {
      (m[a] = m[a] || new Set()).add(b);
      (m[b] = m[b] || new Set()).add(a);
    });
    return m;
  }, [links]);

  const physics = () => {
    const a = alphaRef.current;
    const n = nodes.length;
    for (let i = 0; i < n; i++) { nodes[i].vx *= 0.82; nodes[i].vy *= 0.82; }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        let d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2);
        const f = (9 / d2) * a;
        const ux = dx / d, uy = dy / d;
        nodes[i].vx += ux * f; nodes[i].vy += uy * f;
        nodes[j].vx -= ux * f; nodes[j].vy -= uy * f;
      }
    }
    for (const [ai, bi] of links) {
      const na = nodeMap[ai], nb = nodeMap[bi];
      if (!na || !nb) continue;
      const rest = na.type === "center" || nb.type === "center" ? 18 : 9;
      let dx = nb.x - na.x, dy = nb.y - na.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = 0.06 * (d - rest) * a;
      const ux = dx / d, uy = dy / d;
      na.vx += ux * f; na.vy += uy * f;
      nb.vx -= ux * f; nb.vy -= uy * f;
    }
    for (let i = 0; i < n; i++) {
      const nd = nodes[i];
      const g = nd.type === "center" ? 0.06 : 0.006;
      nd.vx += (CX - nd.x) * g * a;
      nd.vy += (CY - nd.y) * g * a;
      nd.vx = Math.max(-2.5, Math.min(2.5, nd.vx));
      nd.vy = Math.max(-2.5, Math.min(2.5, nd.vy));
      if (nd.pinned) continue;
      nd.x += nd.vx; nd.y += nd.vy;
      const mx = radiusOf(nd) + 7, my = radiusOf(nd) + 4;
      if (nd.x < mx) { nd.x = mx; nd.vx = -nd.vx * 0.5; }
      if (nd.x > W - mx) { nd.x = W - mx; nd.vx = -nd.vx * 0.5; }
      if (nd.y < my) { nd.y = my; nd.vy = -nd.vy * 0.5; }
      if (nd.y > H - my) { nd.y = H - my; nd.vy = -nd.vy * 0.5; }
    }
    alphaRef.current = Math.max(0, a * 0.99);
  };

  useEffect(() => {
    const loop = () => {
      if (alphaRef.current > 0.004 || dragRef.current) { physics(); tick(); }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toSvg = (clientX, clientY) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: CX, y: CY };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  useEffect(() => {
    const move = (e) => {
      if (!dragRef.current) return;
      const src = e.touches ? e.touches[0] : e;
      const { x, y } = toSvg(src.clientX, src.clientY);
      const nd = nodeMap[dragRef.current];
      if (nd) { nd.x = x; nd.y = y; nd.vx = 0; nd.vy = 0; }
      alphaRef.current = Math.max(alphaRef.current, 0.3);
      if (e.cancelable) e.preventDefault();
    };
    const up = () => {
      if (!dragRef.current) return;
      const nd = nodeMap[dragRef.current];
      if (nd) nd.pinned = false;
      dragRef.current = null;
      alphaRef.current = Math.max(alphaRef.current, 0.5);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeMap]);

  const startDrag = (id) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = id;
    const nd = nodeMap[id];
    if (nd) nd.pinned = true;
    setHover(id);
    alphaRef.current = Math.max(alphaRef.current, 0.4);
  };

  const shuffle = () => {
    nodes.forEach((n) => {
      if (n.type === "center") return;
      n.x = CX + (seed(n.id + alphaRef.current) - 0.5) * 64;
      n.y = CY + (seed(n.id + "y" + alphaRef.current) - 0.5) * 40;
      n.vx = 0; n.vy = 0;
    });
    alphaRef.current = 1;
  };

  const near = (id) => hover && (id === hover || (adj[hover] && adj[hover].has(id)));
  const edgeOn = (a, b) => hover && (a === hover || b === hover);

  // in a desktop-OS window the OS chrome already frames the app, so `bare` drops
  // the section wrapper + inner MacBar and lets the graph fill the window body.
  const bodyClass =
    bare || gfs ? "relative min-h-0 flex-1" : "relative h-[440px] sm:h-[560px]";

  const graphBody = (
    <div className={bodyClass}>
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="relative block h-full w-full touch-none select-none"
      >
        {/* edges */}
        {links.map(([a, b], i) => {
          const na = nodeMap[a], nb = nodeMap[b];
          if (!na || !nb) return null;
          const on = edgeOn(a, b);
          const tintNode = na.type === "center" ? nb : na;
          const stroke = on ? colorOf(tintNode) : "rgba(148,163,184,0.5)";
          return (
            <line
              key={i}
              x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
              stroke={stroke}
              strokeWidth={on ? 0.28 : 0.13}
              opacity={hover ? (on ? 0.85 : 0.05) : 0.22}
            />
          );
        })}
        {/* nodes */}
        {nodes.map((n) => {
          const on = near(n.id) || n.id === hover;
          const dragging = dragRef.current === n.id;
          const r = radiusOf(n) * (dragging ? 1.3 : 1);
          const color = colorOf(n);
          const isCenter = n.type === "center";
          const isLead = n.type !== "item";
          return (
            <g key={n.id}>
              {(on || isLead) && (
                <circle cx={n.x} cy={n.y} r={r * 1.7} fill={color} opacity={on ? 0.18 : 0.09} />
              )}
              {isCenter && (
                <circle cx={n.x} cy={n.y} r={r} fill="none" stroke={color} strokeWidth="0.35">
                  <animate attributeName="r" values={`${r};${r * 2.7}`} dur="2.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.55;0" dur="2.6s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                cx={n.x} cy={n.y} r={r}
                fill={color}
                fillOpacity={n.type === "item" && !on ? 0.62 : 1}
                stroke="rgba(255,255,255,0.28)"
                strokeWidth="0.25"
                style={{ cursor: dragging ? "grabbing" : "grab", transition: dragging ? "none" : "r .15s" }}
                onPointerDown={startDrag(n.id)}
                onMouseEnter={() => !dragRef.current && setHover(n.id)}
                onMouseLeave={() => !dragRef.current && setHover(null)}
              />
              {(isLead || on) && (
                <text
                  x={Math.max(13, Math.min(W - 13, n.x))}
                  y={n.y - r - (isCenter ? 2.2 : 1.4)}
                  textAnchor="middle"
                  fontSize={isCenter ? 2.5 : n.type === "hub" ? 1.85 : 1.55}
                  fontFamily={n.type === "item" ? MONO : DISPLAY}
                  fontWeight={isCenter ? 700 : 600}
                  fill={isCenter || on ? LABEL_ON : LABEL_DIM}
                  stroke="#0a0b10"
                  strokeWidth={isCenter ? 0.8 : 0.55}
                  paintOrder="stroke"
                  style={{ pointerEvents: "none" }}
                >
                  {n.id}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );

  const legend = (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-white/5 px-4 py-3">
      {HUBS.map((h) => (
        <button
          key={h}
          onMouseEnter={() => setHover(h)}
          onMouseLeave={() => setHover(null)}
          className="inline-flex items-center gap-1.5 font-mono text-[10px] text-[#9aa3b4] transition-colors hover:text-white"
        >
          <span className="h-2 w-2 rounded-full" style={{ background: CLUSTER[h] }} />
          {h}
        </button>
      ))}
    </div>
  );

  const shuffleBtn = (
    <button
      onClick={shuffle}
      title="Reshuffle"
      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 font-mono text-[10px] text-white/60 transition-colors hover:border-white/40 hover:text-white"
    >
      <Shuffle className="h-3 w-3" /> shuffle
    </button>
  );

  // bare: fills the OS window body, no section chrome / no MacBar
  if (bare) {
    return (
      <div
        className="flex h-full flex-col"
        style={{ background: "radial-gradient(120% 120% at 50% 0%, #14161d 0%, #0a0b10 72%)" }}
      >
        <div className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/50">
            {hover || "drag a node · it springs back"}
          </span>
          {shuffleBtn}
          <span className="hidden font-mono text-[10px] text-white/35 sm:inline">
            {nodes.length}n · {links.length}e
          </span>
        </div>
        {graphBody}
        {legend}
      </div>
    );
  }

  return (
    <section className="border-b border-edge bg-bg py-20">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mb-6 flex items-center gap-3">
          <Share2 className="h-4 w-4 text-accentText" />
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
            Knowledge graph
          </p>
          <span className="h-px flex-1 bg-edge" />
          <span className="min-w-0 truncate font-mono text-xs text-muted">
            {hover || "drag a node · it springs back"}
          </span>
        </div>

        {gclosed ? (
          <button
            onClick={() => setGclosed(false)}
            className="flex w-full items-center gap-2 rounded-2xl border border-edge bg-surface px-4 py-3 font-mono text-xs text-muted transition-colors hover:text-accentText"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" /> reopen knowledge graph
          </button>
        ) : (
          <div
            className={
              gfs
                ? "fixed inset-0 z-[100] flex flex-col"
                : "relative flex flex-col overflow-hidden rounded-2xl border border-edge"
            }
            style={{ background: "radial-gradient(120% 120% at 50% 0%, #14161d 0%, #0a0b10 72%)" }}
          >
            <MacBar
              dark
              title="knowledge.graph"
              onClose={() => setGclosed(true)}
              onMin={() => setGmin((v) => !v)}
              onFull={() => setGfs((v) => !v)}
              onBarDoubleClick={() => setGfs((v) => !v)}
              right={
                <>
                  {shuffleBtn}
                  <span className="hidden font-mono text-[10px] text-white/35 sm:inline">
                    {nodes.length}n · {links.length}e
                  </span>
                </>
              }
            />
            {gmin ? null : (
              <>
                {graphBody}
                {legend}
              </>
            )}
          </div>
        )}
        <p className="mt-3 font-mono text-[11px] text-muted">
          {nodes.length} nodes · {links.length} edges — coloured by cluster. Drag to rearrange, hover to trace links.
        </p>
      </div>
    </section>
  );
};

export default KnowledgeGraph;
