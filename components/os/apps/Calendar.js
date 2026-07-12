import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { WD, MO, monthMatrix, ZONES, timeIn, dayIn, pad } from "../../../lib/datetime";

// Calendar & Clock. An engineered analog ring (the signature) + a live digital
// clock and world clocks (distributed systems live across regions), beside a
// navigable month grid. Today is marked in amber.
export default function Calendar() {
  const [t, setT] = useState(() => new Date());
  const [view, setView] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const h = t.getHours(), m = t.getMinutes(), s = t.getSeconds();
  const hA = ((h % 12) + m / 60) * 30;
  const mA = (m + s / 60) * 6;
  const sA = s * 6;

  const cells = monthMatrix(view.y, view.m);
  const now = new Date();
  const isThisMonth = view.y === now.getFullYear() && view.m === now.getMonth();
  const today = now.getDate();

  const shift = (d) => setView((v) => {
    const nm = v.m + d;
    return { y: v.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
  });
  const jumpToday = () => setView({ y: now.getFullYear(), m: now.getMonth() });

  return (
    <div className="cal">
      {/* left — clock */}
      <aside className="cal-clock">
        <svg className="cal-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="46" className="cal-face" />
          {Array.from({ length: 12 }).map((_, i) => (
            <line key={i} className="cal-tick" x1="50" y1="7" x2="50" y2={i % 3 === 0 ? 13 : 10}
              transform={`rotate(${i * 30} 50 50)`} />
          ))}
          <line className="cal-hand hour" x1="50" y1="50" x2="50" y2="28" transform={`rotate(${hA} 50 50)`} />
          <line className="cal-hand min" x1="50" y1="50" x2="50" y2="18" transform={`rotate(${mA} 50 50)`} />
          <line className="cal-hand sec" x1="50" y1="54" x2="50" y2="14" transform={`rotate(${sA} 50 50)`} />
          <circle cx="50" cy="50" r="2.4" className="cal-pin" />
        </svg>

        <div className="cal-digital">{pad(h)}:{pad(m)}:<span>{pad(s)}</span></div>
        <div className="cal-date">
          {t.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </div>

        <div className="cal-world">
          <p className="cal-world-h">World clocks</p>
          {ZONES.map((z) => (
            <div key={z.label} className="cal-zone">
              <span className="cal-zone-l">{z.label}<em>{z.city}</em></span>
              <span className="cal-zone-t">
                {timeIn(t, z.tz)}
                <i>{dayIn(t, z.tz)}</i>
              </span>
            </div>
          ))}
        </div>
      </aside>

      {/* right — month */}
      <main className="cal-month">
        <header className="cal-head">
          <div className="cal-title">
            <span className="cal-mo">{MO[view.m]}</span>
            <span className="cal-yr">{view.y}</span>
          </div>
          <div className="cal-nav">
            <button onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
            <button className="cal-today-btn" onClick={jumpToday}>Today</button>
            <button onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </header>

        <div className="cal-grid cal-wd">
          {WD.map((d) => <span key={d} className={d === "Sun" || d === "Sat" ? "wend" : ""}>{d}</span>)}
        </div>
        <div className="cal-grid cal-days">
          {cells.map((d, i) => {
            const isToday = isThisMonth && d === today;
            const wend = d && (i % 7 === 0 || i % 7 === 6);
            return (
              <span key={i} className={`cal-cell${d ? "" : " empty"}${isToday ? " today" : ""}${wend ? " wend" : ""}`}>
                {d || ""}
              </span>
            );
          })}
        </div>

        <p className="cal-foot">
          {t.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          <span> · week {Math.ceil((now.getDate() + new Date(view.y, view.m, 1).getDay()) / 7)}</span>
        </p>
      </main>

      <style jsx>{`
        .cal { display: grid; grid-template-columns: 260px 1fr; min-height: 100%; background: #0a0b0f; color: #e7e8ee; font-family: "Inter", sans-serif; }
        .cal-clock { padding: 26px 22px; border-right: 1px solid #1c1f29; display: flex; flex-direction: column; align-items: center; }
        .cal-ring { width: 148px; height: 148px; }
        .cal-face { fill: none; stroke: #23262f; stroke-width: 1.5; }
        .cal-tick { stroke: #3a3f4d; stroke-width: 1.4; stroke-linecap: round; }
        .cal-hand { stroke-linecap: round; }
        .cal-hand.hour { stroke: #e7e8ee; stroke-width: 3.4; }
        .cal-hand.min { stroke: #c4c7d2; stroke-width: 2.4; }
        .cal-hand.sec { stroke: #FFB020; stroke-width: 1.2; }
        .cal-pin { fill: #FFB020; }
        .cal-digital { margin-top: 18px; font-family: "JetBrains Mono", monospace; font-size: 30px; font-weight: 700; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
        .cal-digital span { color: #FFB020; }
        .cal-date { margin-top: 4px; font-family: "Space Grotesk", sans-serif; font-size: 14px; color: #8b90a0; }
        .cal-world { margin-top: 24px; width: 100%; }
        .cal-world-h { font-family: "JetBrains Mono", monospace; font-size: 9px; letter-spacing: .16em; text-transform: uppercase; color: #565b6b; padding-bottom: 10px; border-bottom: 1px solid #1c1f29; }
        .cal-zone { display: flex; align-items: center; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid #14161d; }
        .cal-zone-l { display: flex; flex-direction: column; font-family: "JetBrains Mono", monospace; font-size: 12px; color: #e7e8ee; }
        .cal-zone-l em { font-style: normal; font-family: "Inter", sans-serif; font-size: 10px; color: #6b7080; margin-top: 1px; }
        .cal-zone-t { display: flex; align-items: baseline; gap: 7px; font-family: "JetBrains Mono", monospace; font-size: 14px; font-variant-numeric: tabular-nums; color: #c4c7d2; }
        .cal-zone-t i { font-style: normal; font-size: 9px; color: #565b6b; text-transform: uppercase; }
        .cal-month { padding: 22px 24px 20px; display: flex; flex-direction: column; }
        .cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
        .cal-title { display: flex; align-items: baseline; gap: 8px; }
        .cal-mo { font-family: "Space Grotesk", sans-serif; font-size: 24px; font-weight: 700; }
        .cal-yr { font-family: "JetBrains Mono", monospace; font-size: 15px; color: #6b7080; }
        .cal-nav { display: flex; align-items: center; gap: 4px; }
        .cal-nav button { display: grid; place-items: center; height: 30px; min-width: 30px; padding: 0 8px; border: 1px solid #23262f; background: #15171e; color: #8b90a0; border-radius: 8px; cursor: pointer; transition: color .12s, border-color .12s; font-family: "JetBrains Mono", monospace; font-size: 11px; }
        .cal-nav button:hover { color: #fff; border-color: #3a3f4d; }
        .cal-today-btn { color: #FFB020 !important; }
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
        .cal-wd { margin-bottom: 6px; }
        .cal-wd span { text-align: center; font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #565b6b; padding: 4px 0; }
        .cal-wd .wend { color: #FFB020; opacity: .55; }
        .cal-days { flex: 1; gap: 2px; }
        .cal-cell { display: grid; place-items: center; aspect-ratio: 1.15; border-radius: 9px; font-family: "JetBrains Mono", monospace; font-size: 14px; color: #c4c7d2; transition: background .12s; }
        .cal-cell:not(.empty):hover { background: #15171e; }
        .cal-cell.wend { color: #8b90a0; }
        .cal-cell.today { background: #FFB020; color: #0a0b0f; font-weight: 700; box-shadow: 0 0 0 1px rgba(255,176,32,.4), 0 8px 22px rgba(255,176,32,.25); }
        .cal-foot { margin-top: 14px; padding-top: 14px; border-top: 1px solid #1c1f29; font-family: "JetBrains Mono", monospace; font-size: 11px; color: #6b7080; }
        .cal-foot span { color: #565b6b; }
        @media (max-width: 640px) {
          .cal { grid-template-columns: 1fr; }
          .cal-clock { border-right: none; border-bottom: 1px solid #1c1f29; }
        }
        @media (prefers-reduced-motion: reduce) { .cal-hand { transition: none; } }
      `}</style>
    </div>
  );
}
