import React, { useMemo, useRef, useState } from "react";
import { useSiteContent } from "../../lib/useSiteContent";

// A 2-D "embedding space": every project is a point, clustered by its primary
// language (nearby points = related tech), coloured per language. It reads like
// a real vector-space explorer — normalized axes with ticks, a live cursor
// coordinate, and a per-point readout showing the (fake but deterministic)
// high-dimensional vector projected into 2-D. No real embeddings; the numbers
// are derived deterministically from each name so SSR and client agree.
const LANG_COLOR = {
  JavaScript: "#F1E05A",
  Typescript: "#3178C6",
  TypeScript: "#3178C6",
  Go: "#00ADD8",
  Rust: "#DEA584",
  Python: "#3572A5",
  Java: "#B07219",
  "C++": "#F34B7D",
  C: "#8b90a0",
  Php: "#4F5D95",
  css: "#563D7C",
  React: "#61DAFB",
  Laravel: "#FF2D20",
};

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619;
  return (h >>> 0) / 4294967295; // 0..1
};

const DIMS = 8; // "high-dimensional" readout width
// deterministic, well-spread pseudo-embedding in [-1,1] (varied across dims)
const vecOf = (name) => {
  const seed = hash(name) * 1000;
  return Array.from({ length: DIMS }, (_, i) => Math.sin(seed + i * 1.9 + i * i * 0.37));
};

// normalized [-1,1] → svg coord (12..88, centre 50)
const M = (n) => 50 + n * 38;
const fmt = (n) => (n >= 0 ? "+" : "") + n.toFixed(2);

const EmbeddingSpace = () => {
  const { projects } = useSiteContent();
  const [hoverName, setHoverName] = useState(null);
  const [pinName, setPinName] = useState(null);
  const [cursor, setCursor] = useState(null); // live cursor coords in [-1,1]
  const svgRef = useRef(null);

  const { points, clusters, counts } = useMemo(() => {
    const list = projects || [];
    const langOf = (p) => (p.skills && p.skills[0]) || "Other";
    const langs = Array.from(new Set(list.map(langOf)));
    const centers = {};
    langs.forEach((l, i) => {
      const a = (i / langs.length) * Math.PI * 2;
      centers[l] = { nx: Math.cos(a) * 0.62, ny: Math.sin(a) * 0.62, lang: l };
    });
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    const cnt = {};
    const pts = list.map((p) => {
      const l = langOf(p);
      const c = centers[l];
      cnt[l] = (cnt[l] || 0) + 1;
      const nx = clamp(c.nx + (hash(p.name) - 0.5) * 0.36);
      const ny = clamp(c.ny + (hash(p.name + "y") - 0.5) * 0.36);
      return { name: p.name, lang: l, nx, ny, color: LANG_COLOR[l] || "#8b90a0" };
    });
    return { points: pts, clusters: Object.values(centers), counts: cnt };
  }, [projects]);

  const activeName = hoverName || pinName;
  const active = points.find((p) => p.name === activeName);
  const vec = active ? vecOf(active.name) : null;
  const norm = vec ? Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) : 0;

  const TICKS = [-1, -0.5, 0, 0.5, 1];

  const onMove = (e) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // svg preserves aspect (meet): the drawing is a centred square of side=min
    const side = Math.min(r.width, r.height);
    const ox = r.left + (r.width - side) / 2;
    const oy = r.top + (r.height - side) / 2;
    const sx = ((e.clientX - ox) / side) * 100;
    const sy = ((e.clientY - oy) / side) * 100;
    setCursor({ nx: (sx - 50) / 38, ny: (sy - 50) / 38 });
  };

  return (
    <div className="rounded-xl border border-edge bg-surface p-5 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-muted">
        <span className="uppercase tracking-[0.18em]">
          embedding space · {points.length} vectors · {DIMS}-d → 2-d
        </span>
        <span className="text-accentText">
          {active
            ? `${active.name} · ${active.lang}`
            : cursor
            ? `cursor  x ${fmt(cursor.nx)}  y ${fmt(cursor.ny)}`
            : "hover a point"}
        </span>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-edge bg-bg">
        <svg
          ref={svgRef}
          viewBox="0 0 100 100"
          className="block h-[300px] w-full sm:h-[380px]"
          onMouseMove={onMove}
          onMouseLeave={() => setCursor(null)}
          onClick={() => setPinName(null)}
        >
          {/* grid at tick positions */}
          {TICKS.map((t) => (
            <g key={`g${t}`} stroke="var(--c-edge)" strokeWidth="0.12">
              <line x1={M(t)} y1={M(-1)} x2={M(t)} y2={M(1)} />
              <line x1={M(-1)} y1={M(t)} x2={M(1)} y2={M(t)} />
            </g>
          ))}
          {/* centre axes */}
          <g stroke="var(--c-muted)" strokeWidth="0.2" opacity="0.5">
            <line x1={M(-1)} y1={M(0)} x2={M(1)} y2={M(0)} />
            <line x1={M(0)} y1={M(-1)} x2={M(0)} y2={M(1)} />
          </g>
          {/* axis tick numbers */}
          {TICKS.map((t) => (
            <g key={`t${t}`} fill="var(--c-muted)" fontFamily="monospace" fontSize="2.3">
              <text x={M(t)} y={M(1) + 4} textAnchor="middle">{t}</text>
              {t !== 0 && <text x={M(-1) - 1.5} y={M(t) + 0.8} textAnchor="end">{t}</text>}
            </g>
          ))}

          {/* cluster halos */}
          {clusters.map((c) => (
            <circle key={c.lang} cx={M(c.nx)} cy={M(c.ny)} r="12"
              fill={(LANG_COLOR[c.lang] || "#8b90a0") + "12"} />
          ))}

          {/* crosshair to the axes for the active point */}
          {active && (
            <g stroke={active.color} strokeWidth="0.25" strokeDasharray="1.2 1.2" opacity="0.7">
              <line x1={M(active.nx)} y1={M(active.ny)} x2={M(active.nx)} y2={M(-1)} />
              <line x1={M(active.nx)} y1={M(active.ny)} x2={M(-1)} y2={M(active.ny)} />
            </g>
          )}

          {/* points */}
          {points.map((p) => {
            const dim = active && active.lang !== p.lang;
            const on = active && active.name === p.name;
            return (
              <circle
                key={p.name}
                cx={M(p.nx)}
                cy={M(p.ny)}
                r={on ? 2.9 : 1.7}
                fill={p.color}
                opacity={dim ? 0.16 : 1}
                stroke={on ? "var(--c-fg)" : "none"}
                strokeWidth="0.5"
                style={{ cursor: "pointer", transition: "opacity .2s, r .15s" }}
                onMouseEnter={() => setHoverName(p.name)}
                onMouseLeave={() => setHoverName(null)}
                onClick={(e) => { e.stopPropagation(); setPinName(p.name === pinName ? null : p.name); }}
              />
            );
          })}
        </svg>

        {/* per-point vector readout — the "numbers" behind the dot */}
        {active && vec && (
          <div className="pointer-events-none absolute right-3 top-3 w-[188px] rounded-lg border border-edge bg-surface/95 p-3 font-mono text-[10px] shadow-lg backdrop-blur">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: active.color }} />
              <span className="truncate font-semibold text-fg">{active.name}</span>
            </div>
            <div className="mt-2 flex justify-between text-muted">
              <span>x <span className="text-fg">{fmt(active.nx)}</span></span>
              <span>y <span className="text-fg">{fmt(active.ny)}</span></span>
              <span>‖v‖ <span className="text-fg">{norm.toFixed(2)}</span></span>
            </div>
            <div className="mt-2 space-y-1">
              {vec.map((v, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-4 text-muted">d{i}</span>
                  <span className="relative h-1.5 flex-1 rounded-full bg-edge">
                    <span
                      className="absolute top-0 h-full rounded-full"
                      style={{
                        background: active.color,
                        left: v < 0 ? `${50 + v * 50}%` : "50%",
                        width: `${Math.abs(v) * 50}%`,
                      }}
                    />
                    <span className="absolute inset-y-0 left-1/2 w-px bg-muted/40" />
                  </span>
                  <span className="w-8 text-right text-fg">{fmt(v)}</span>
                </div>
              ))}
            </div>
            {pinName === active.name && (
              <div className="mt-2 text-[9px] uppercase tracking-wider text-accentText">pinned · click to release</div>
            )}
          </div>
        )}
      </div>

      {/* language legend with cluster counts */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[10px] text-muted">
        {clusters.map((c) => (
          <button
            key={c.lang}
            onMouseEnter={() => setHoverName(points.find((p) => p.lang === c.lang)?.name || null)}
            onMouseLeave={() => setHoverName(null)}
            className="inline-flex items-center gap-1.5 transition-colors hover:text-fg"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: LANG_COLOR[c.lang] || "#8b90a0" }} />
            {c.lang} <span className="text-fg">· {counts[c.lang] || 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default EmbeddingSpace;
