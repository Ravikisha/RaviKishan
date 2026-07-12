import React, { useEffect, useRef, useState } from "react";
import { Star, GitFork, Users, Activity, Cpu } from "lucide-react";
import { useSiteContent } from "../../lib/useSiteContent";

// Desktop widgets — live glanceable panels pinned to the wallpaper (behind
// windows, macOS-style). GitHub stats + a deterministic contribution grid, a
// live session-uptime counter, and a "currently building" ticker. On-brand
// systems-engineer flair. Toggled from the desktop right-click menu.
const open = (id) => window.dispatchEvent(new CustomEvent("os:open", { detail: id }));

// deterministic 0–4 intensity so the grid is stable across SSR + renders
const cell = (r, c) => {
  let h = (r * 17 + c * 31 + 7) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return h % 5;
};
const COLS = 15, ROWS = 7;

const pad = (n) => String(n).padStart(2, "0");

export default function Widgets() {
  const { github, identity, systems } = useSiteContent();
  const g = github || {};
  const [up, setUp] = useState(0);
  const start = useRef(null);

  useEffect(() => {
    start.current = performance.now();
    const id = setInterval(() => setUp(Math.floor((performance.now() - start.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const hh = pad(Math.floor(up / 3600));
  const mm = pad(Math.floor((up % 3600) / 60));
  const ss = pad(up % 60);

  const builds = (systems || []).slice(0, 6).map((s) => s.name);

  return (
    <div className="os-widgets" aria-hidden="true">
      {/* GitHub */}
      <button className="wg wg-btn" onClick={() => open("system-monitor")}>
        <div className="wg-head"><span>GitHub</span><em>@Ravikisha</em></div>
        <div className="wg-stats">
          <span><Star className="h-3.5 w-3.5" /> {g.stars ?? 167}</span>
          <span><GitFork className="h-3.5 w-3.5" /> {g.repos ?? 69}</span>
          <span><Users className="h-3.5 w-3.5" /> {g.followers ?? 39}</span>
        </div>
        <div className="wg-grid">
          {Array.from({ length: ROWS }).map((_, r) => (
            <div key={r} className="wg-grow">
              {Array.from({ length: COLS }).map((_, c) => (
                <i key={c} data-lv={cell(r, c)} />
              ))}
            </div>
          ))}
        </div>
        <div className="wg-foot">contributing since {g.since ?? 2019}</div>
      </button>

      {/* Uptime */}
      <div className="wg">
        <div className="wg-head"><span><Activity className="h-3.5 w-3.5" /> Session uptime</span></div>
        <div className="wg-clock">{hh}:{mm}:{ss}</div>
        <div className="wg-foot"><Cpu className="h-3 w-3" /> ravi.sys · stable · 0 crashes</div>
      </div>

      {/* Currently building */}
      <div className="wg">
        <div className="wg-head"><span>Currently</span></div>
        <div className="wg-now">{identity?.now || "Agentic AI Engineer @ Zimyo"}</div>
        {builds.length > 0 && (
          <div className="wg-ticker"><div className="wg-track">
            {[...builds, ...builds].map((b, i) => <span key={i}>{b}</span>)}
          </div></div>
        )}
      </div>

      <style jsx>{`
        .os-widgets {
          position: fixed; top: ${38}px; right: 14px; width: 234px; z-index: 21;
          display: flex; flex-direction: column; gap: 12px; pointer-events: none;
        }
        .wg {
          pointer-events: auto; padding: 13px 14px; border-radius: 15px; text-align: left;
          background: color-mix(in srgb, var(--c-surface) 62%, transparent);
          border: 1px solid var(--c-edge); backdrop-filter: blur(16px) saturate(1.4);
          box-shadow: 0 12px 34px rgba(0,0,0,.22); font-family: "Inter", sans-serif;
          color: var(--c-fg); width: 100%;
        }
        .wg-btn { cursor: pointer; display: block; transition: transform .15s, border-color .15s; }
        .wg-btn:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--c-accent) 45%, var(--c-edge)); }
        .wg-head { display: flex; align-items: center; justify-content: space-between; font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--c-muted); }
        .wg-head span { display: inline-flex; align-items: center; gap: 5px; color: var(--c-accentText, var(--c-accent)); }
        .wg-head em { font-style: normal; color: var(--c-muted); text-transform: none; letter-spacing: 0; }
        .wg-stats { display: flex; gap: 14px; margin-top: 10px; font-family: "JetBrains Mono", monospace; font-size: 15px; font-weight: 700; }
        .wg-stats span { display: inline-flex; align-items: center; gap: 4px; }
        .wg-stats :global(svg) { color: var(--c-accentText, var(--c-accent)); }
        .wg-grid { margin-top: 12px; display: flex; flex-direction: column; gap: 3px; }
        .wg-grow { display: flex; gap: 3px; }
        .wg-grow i { flex: 1; aspect-ratio: 1; border-radius: 2px; background: color-mix(in srgb, var(--c-fg) 8%, transparent); }
        .wg-grow i[data-lv="1"] { background: color-mix(in srgb, #FFB020 30%, transparent); }
        .wg-grow i[data-lv="2"] { background: color-mix(in srgb, #FFB020 55%, transparent); }
        .wg-grow i[data-lv="3"] { background: color-mix(in srgb, #FFB020 78%, transparent); }
        .wg-grow i[data-lv="4"] { background: #FFB020; }
        .wg-foot { margin-top: 11px; display: flex; align-items: center; gap: 5px; font-family: "JetBrains Mono", monospace; font-size: 10px; color: var(--c-muted); }
        .wg-clock { margin-top: 8px; font-family: "JetBrains Mono", monospace; font-size: 30px; font-weight: 700; letter-spacing: -.01em; font-variant-numeric: tabular-nums; color: var(--c-fg); }
        .wg-now { margin-top: 8px; font-size: 14px; font-weight: 600; line-height: 1.3; color: var(--c-fg); }
        .wg-ticker { margin-top: 10px; overflow: hidden; border-top: 1px solid var(--c-edge); padding-top: 10px; }
        .wg-track { display: inline-flex; gap: 8px; white-space: nowrap; animation: wg-scroll 16s linear infinite; }
        .wg-track span { font-family: "JetBrains Mono", monospace; font-size: 10.5px; color: var(--c-muted); padding: 2px 8px; border: 1px solid var(--c-edge); border-radius: 5px; }
        @keyframes wg-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (max-width: 900px) { .os-widgets { display: none; } }
        @media (prefers-reduced-motion: reduce) { .wg-track { animation: none; } }
      `}</style>
    </div>
  );
}
