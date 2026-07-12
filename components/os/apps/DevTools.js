import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// DEV MODE — the profiler HUD (konami / `devmode` CLI) rebuilt as a desktop-OS
// app so it can be moved, minimized, maximized and closed with the standard
// window chrome. Runs its own FPS / frame / viewport / scroll / DOM sampler and
// paints the page grid + section inspector as full-screen overlays (portaled to
// <body>, styled by the global .dev-grid / .dev-inspect classes that
// components/eggs/Easter.js injects). Independent of the CLI path.
export default function DevTools() {
  const [perf, setPerf] = useState({
    fps: 60, ms: 16, w: 0, h: 0, scroll: 0, nodes: 0, theme: "dark",
  });
  const [grid, setGrid] = useState(false);
  const [inspect, setInspect] = useState(false);
  const [boxes, setBoxes] = useState([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // live FPS / frame-time / viewport / scroll / DOM-node profiler
  useEffect(() => {
    let raf, frames = 0, last = performance.now();
    const loop = (t) => {
      frames++;
      if (t - last >= 500) {
        const fps = Math.round((frames * 1000) / (t - last));
        const scrollable = Math.max(1, document.body.scrollHeight - window.innerHeight);
        setPerf({
          fps,
          ms: +(1000 / Math.max(1, fps)).toFixed(1),
          w: window.innerWidth,
          h: window.innerHeight,
          scroll: Math.min(100, Math.max(0, Math.round((window.scrollY / scrollable) * 100))),
          nodes: document.getElementsByTagName("*").length,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
        });
        frames = 0;
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // inspector — outline every open app window (label = app name) plus any page
  // sections, so it works across all apps in dev mode, not just the hidden page.
  useEffect(() => {
    if (!inspect) { setBoxes([]); return; }
    let raf;
    const measure = (el, label) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, width: r.width, height: r.height, label };
    };
    const compute = () => {
      const out = [];
      // each visible app window, labelled with its app name (before the "— tag")
      document.querySelectorAll(".os-win").forEach((w, i) => {
        if (w.classList.contains("min")) return;
        const t = w.querySelector(".os-title-tx");
        const label = (t ? t.textContent.split("—")[0].trim() : "") || `window ${i + 1}`;
        out.push(measure(w, label));
      });
      // any real page sections (recruiter surfaces / app-rendered <section>s)
      document.querySelectorAll("main section, .os-body section").forEach((s, i) => {
        const h = s.querySelector("h1, h2, h3");
        const label = s.id || (h && h.textContent.trim().slice(0, 26)) || `section ${i + 1}`;
        out.push(measure(s, label));
      });
      setBoxes(out.filter((b) => b.height > 4 && b.top < window.innerHeight && b.top + b.height > 0));
      raf = requestAnimationFrame(compute);
    };
    raf = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(raf);
  }, [inspect]);

  const openConsole = () =>
    window.dispatchEvent(new CustomEvent("os:open", { detail: "terminal" }));

  const stats = [
    { k: "FPS", v: perf.fps, cls: perf.fps >= 55 ? "g" : perf.fps >= 30 ? "a" : "r" },
    { k: "FRAME", v: `${perf.ms}ms` },
    { k: "VIEW", v: `${perf.w}×${perf.h}` },
    { k: "SCROLL", v: `${perf.scroll}%` },
    { k: "NODES", v: perf.nodes },
    { k: "THEME", v: perf.theme },
  ];

  return (
    <div className="dt">
      <div className="dt-head">
        <span className="dt-dot" />
        DEV MODE
        <span className="dt-sub">sampling · 2Hz</span>
      </div>

      <div className="dt-stats">
        {stats.map((s) => (
          <div key={s.k} className="dt-stat">
            <span>{s.k}</span>
            <b className={s.cls || ""}>{s.v}</b>
          </div>
        ))}
      </div>

      <div className="dt-toggles">
        <button className={grid ? "on" : ""} onClick={() => setGrid((v) => !v)}>grid</button>
        <button className={inspect ? "on" : ""} onClick={() => setInspect((v) => !v)}>inspect</button>
        <button onClick={openConsole}>console</button>
      </div>

      <p className="dt-hint">
        Grid &amp; inspect draw over every open app. Press <kbd>`</kbd> anywhere
        for the console.
      </p>

      {/* full-screen overlays — portaled to body, styled by Easter's globals */}
      {mounted &&
        createPortal(
          <>
            {grid && <div className="dev-grid" aria-hidden="true" />}
            {inspect && (
              <div className="dev-inspect" aria-hidden="true">
                {boxes.map((b, i) => (
                  <div
                    key={i}
                    className="dev-box"
                    style={{ top: b.top, left: b.left, width: b.width, height: b.height }}
                  >
                    <span className="dev-box-tag">{b.label}</span>
                    <span className="dev-box-dim">
                      {Math.round(b.width)}×{Math.round(b.height)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>,
          document.body
        )}

      <style jsx>{`
        .dt {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 20px;
          background: #0a0b0f;
          color: #c4c7d2;
          font-family: "JetBrains Mono", ui-monospace, monospace;
        }
        .dt-head {
          display: flex;
          align-items: center;
          gap: 9px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.16em;
          color: #34d399;
        }
        .dt-dot {
          height: 8px;
          width: 8px;
          border-radius: 50%;
          background: #34d399;
          box-shadow: 0 0 8px #34d399;
          animation: dt-blink 1.4s infinite;
        }
        @keyframes dt-blink {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        .dt-sub { margin-left: auto; font-size: 10px; letter-spacing: 0.08em; color: #6b7080; }
        /* 2-column stat grid with hairline dividers (matches the compact HUD) */
        .dt-stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1px;
          background: #20242f;
          border: 1px solid #20242f;
          border-radius: 10px;
          overflow: hidden;
        }
        .dt-stat {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 13px 16px;
          background: #0d0e13;
        }
        .dt-stat span { font-size: 10px; letter-spacing: 0.1em; color: #6b7080; }
        .dt-stat b { font-size: 15px; color: #e7e8ee; font-weight: 700; }
        .dt-stat b.g { color: #28c840; }
        .dt-stat b.a { color: #ffb020; }
        .dt-stat b.r { color: #ff6b6b; }
        .dt-toggles { display: flex; gap: 10px; }
        .dt-toggles button {
          flex: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #15171e;
          border: 1px solid #262a35;
          color: #8b90a0;
          border-radius: 9px;
          padding: 10px 12px;
          font-family: inherit;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .dt-toggles button:hover { color: #e7e8ee; border-color: #3a3f4d; }
        .dt-toggles button.on {
          background: #34d399;
          border-color: #34d399;
          color: #06251b;
          font-weight: 700;
        }
        .dt-hint { font-size: 10px; line-height: 1.6; color: #565b6b; margin-top: auto; }
        .dt-hint kbd {
          font-family: inherit;
          color: #8b90a0;
          background: #15171e;
          border: 1px solid #262a35;
          border-radius: 4px;
          padding: 0 5px;
        }
        @media (prefers-reduced-motion: reduce) {
          .dt-dot { animation: none; }
        }
      `}</style>
    </div>
  );
}
