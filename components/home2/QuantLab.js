import React, { useMemo, useState } from "react";
import { LineChart, TrendingUp, Coffee, Moon, Wrench, Bug, Rocket, ScrollText, Award } from "lucide-react";

// $RAVI — a tongue-in-cheek "quant desk" that backtests Ravi instead of a
// market. Real backing: he built vectorized backtesting engines at Arrowhead
// (5M+ records, 4.3× via SIMD); the ticker is just pointed inward. Deterministic
// math (no Math.random) so SSR and client agree. Runs as the Quant Desk app.

const STRATS = [
  { id: "2am", name: "Ship at 2am", drift: 0.9, vol: 1.35, quip: "peak output, questionable sleep" },
  { id: "rebuild", name: "Rebuild from scratch", drift: 0.7, vol: 1.0, quip: "slow start, absurd finish" },
  { id: "rag", name: "RAG everything", drift: 0.75, vol: 0.7, quip: "retrieve, don't memorize" },
];

// milestone markers dropped on the curve (mostly real), keyed to real icons
const EVENTS = [
  { at: 0.08, icon: Moon, l: "slept 3h", color: "#818CF8" },
  { at: 0.26, icon: Bug, l: "\"it's a feature\"", color: "#FF6B6B" },
  { at: 0.46, icon: ScrollText, l: "patent published", color: "#FFB020" },
  { at: 0.66, icon: Rocket, l: "shipped Relax.js", color: "#4ED0C0" },
  { at: 0.86, icon: Award, l: "gold medal", color: "#F5C542" },
];

const N = 140;
function backtest(strat, { coffee, sleep, side }) {
  const s = STRATS.find((x) => x.id === strat) || STRATS[0];
  let eq = 1;
  const curve = [1];
  for (let i = 0; i < N; i++) {
    const n = Math.sin(i * 12.9898 + s.vol * 78.233) * 43758.5453;
    const noise = (n - Math.floor(n) - 0.5) * 2; // -1..1 deterministic
    // more coffee + side projects = more output; low sleep = more volatility
    const drift = s.drift * (0.3 + coffee * 0.09 + side * 0.05) * 0.006;
    const vol = s.vol * (0.5 + (9 - sleep) * 0.05 + coffee * 0.03 + side * 0.015) * 0.02;
    let r = drift + noise * vol;
    // Friday-afternoon prod outage: rare when running hot on no sleep
    if (i % 37 === 0 && coffee >= 6 && sleep <= 5) r -= 0.05;
    eq *= 1 + r;
    curve.push(eq);
  }
  return { curve, totalPct: (eq - 1) * 100 };
}

const Slider = ({ icon: Icon, label, value, set, min, max, step, unit }) => (
  <div>
    <div className="mb-1.5 flex items-center justify-between font-mono text-[11px]">
      <span className="inline-flex items-center gap-1.5 text-muted">
        <Icon className="h-3.5 w-3.5 text-accentText" /> {label}
      </span>
      <span className="text-accentText">{value}{unit}</span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => set(Number(e.target.value))}
      className="quant-range w-full"
    />
  </div>
);

const QuantLab = () => {
  const [strat, setStrat] = useState("2am");
  const [coffee, setCoffee] = useState(5);
  const [sleep, setSleep] = useState(6);
  const [side, setSide] = useState(7);

  const r = useMemo(() => backtest(strat, { coffee, sleep, side }), [strat, coffee, sleep, side]);
  const active = STRATS.find((x) => x.id === strat) || STRATS[0];

  const min = Math.min(...r.curve), max = Math.max(...r.curve), rng = max - min || 1;
  const xy = (i) => [(i / (r.curve.length - 1)) * 100, 100 - ((r.curve[i] - min) / rng) * 100];
  const pts = r.curve.map((_, i) => xy(i).map((n) => n.toFixed(2)).join(",")).join(" ");
  const up = r.totalPct >= 0;
  const line = up ? "#4ED0C0" : "#FF6B6B";

  return (
    <div className="flex h-full flex-col bg-bg font-sans text-fg">
      {/* terminal header — strategy is part of the setup */}
      <div className="flex flex-wrap items-center gap-3 border-b border-edge px-5 py-3 font-mono text-[11px]">
        <LineChart className="h-4 w-4 text-accentText" />
        <span className="text-fg">ravi@desk</span>
        <span className="text-muted">— backtest_life.py</span>
        <span className="ml-auto flex flex-wrap gap-2">
          {STRATS.map((s) => (
            <button
              key={s.id}
              onClick={() => setStrat(s.id)}
              title={s.quip}
              className={`rounded-full border px-3 py-1 transition-colors ${
                strat === s.id ? "border-accent bg-accent text-accentFg" : "border-edge text-muted hover:text-fg"
              }`}
            >
              {s.name}
            </button>
          ))}
        </span>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[1.6fr_1fr]">
        {/* the plot + its icon markers */}
        <div className="flex flex-col rounded-xl border border-edge bg-surface p-4">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-muted">
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> productivity index · coffee-adjusted
            </span>
            <span className={up ? "text-live" : "text-[#FF6B6B]"}>{up ? "+" : ""}{r.totalPct.toFixed(0)}%</span>
          </div>

          {/* chart: stretched SVG for the line, HTML-positioned icon badges so the
              markers stay crisp instead of being squashed by preserveAspectRatio */}
          <div className="relative min-h-[220px] flex-1">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              <defs>
                <linearGradient id="qeq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={line} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={line} stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={`0,100 ${pts} 100,100`} fill="url(#qeq)" />
              <polyline points={pts} fill="none" stroke={line} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            </svg>
            {EVENTS.map((ev) => {
              const idx = Math.round(ev.at * (r.curve.length - 1));
              const [x, y] = xy(idx);
              const Icon = ev.icon;
              return (
                <span
                  key={ev.l}
                  title={ev.l}
                  className="absolute z-10 grid h-6 w-6 -translate-x-1/2 -translate-y-full place-items-center rounded-full border border-edge bg-surface shadow-sm"
                  style={{ left: `${x}%`, top: `${Math.max(11, y)}%`, color: ev.color }}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                </span>
              );
            })}
          </div>

          <div className="mt-2 flex justify-between font-mono text-[10px] text-muted">
            <span>{N} sessions (since 2019)</span>
            <span>starting capital: 1 gold medal</span>
          </div>

          {/* legend — what each icon on the curve marks */}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-edge pt-3 font-mono text-[10px] text-muted">
            {EVENTS.map((ev) => {
              const Icon = ev.icon;
              return (
                <span key={ev.l} className="inline-flex items-center gap-1.5">
                  <Icon className="h-3 w-3" style={{ color: ev.color }} strokeWidth={2.2} /> {ev.l}
                </span>
              );
            })}
          </div>
        </div>

        {/* the setup — Life Simulator */}
        <div className="flex flex-col justify-center gap-5 rounded-xl border border-edge bg-surface p-5">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted">
            <Coffee className="h-3.5 w-3.5 text-accentText" /> life simulator
          </p>
          <Slider icon={Coffee} label="Coffee" value={coffee} set={setCoffee} min={0} max={8} step={1} unit=" cups/day" />
          <Slider icon={Moon} label="Sleep" value={sleep} set={setSleep} min={3} max={9} step={1} unit=" hrs" />
          <Slider icon={Wrench} label="Side projects" value={side} set={setSide} min={0} max={10} step={1} unit="" />
          <p className="font-mono text-[10px] leading-relaxed text-muted">
            model: <span className="text-fg">{active.quip}</span>. more coffee &amp; side
            projects raise output but add variance; less sleep = bigger drawdowns.
          </p>
        </div>
      </div>

      <style jsx global>{`
        .quant-range { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 999px; background: var(--c-edge, #262a35); outline: none; }
        .quant-range::-webkit-slider-thumb { -webkit-appearance: none; height: 14px; width: 14px; border-radius: 50%; background: var(--c-accent, #FFB020); cursor: pointer; border: none; }
        .quant-range::-moz-range-thumb { height: 14px; width: 14px; border-radius: 50%; background: var(--c-accent, #FFB020); cursor: pointer; border: none; }
      `}</style>
    </div>
  );
};

export default QuantLab;
