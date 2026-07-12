import React, { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useSiteContent } from "../../lib/useSiteContent";

// A `btop`-style terminal system monitor where the "system" is Ravi.
// Skills = CPU cores · metrics = memory meters · projects = process list ·
// open-source = network. Terminal-dark always (it's a TUI), JetBrains Mono.

const BLOCKS = "▁▂▃▄▅▆▇█";
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

function spark(data) {
  const max = Math.max(...data), min = Math.min(...data), r = max - min || 1;
  return data.map((v) => BLOCKS[clamp(Math.floor(((v - min) / r) * 7), 0, 7)]).join("");
}

// rolling RANDOM-WALK series. SSR-stable initial (deterministic), then a live
// random walk on the client — real-telemetry look, genuinely random values.
function useSeries(len, min, max, reduced) {
  const mid = (min + max) / 2, amp = (max - min) / 2;
  const [data, setData] = useState(() =>
    Array.from({ length: len }, (_, i) => Math.round(mid + amp * 0.55 * Math.sin(i / 2.4)))
  );
  useEffect(() => {
    if (reduced) return;
    let cur = data.slice();
    const id = setInterval(() => {
      const last = cur[cur.length - 1];
      const nv = clamp(Math.round(last + (Math.random() * 2 - 1) * amp * 0.8), min, max);
      cur = [...cur.slice(1), nv];
      setData(cur);
    }, 700);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);
  return data;
}

const CORES = [
  ["TS", 96], ["Go", 91], ["Rust", 83], ["Python", 89],
  ["C++", 78], ["Java", 81], ["React", 93], ["Node", 88],
  ["Docker", 84], ["K8s", 74], ["Redis", 79], ["gRPC", 72],
];
const LANG_ABBR = { TypeScript: "TS", JavaScript: "JS", "Node Js": "Node", "Tailwind Css": "CSS" };
const loadColor = (v) => (v >= 88 ? "#FF7A6B" : v >= 72 ? "#FFB020" : "#4ED0C0");

// current, real-life "daemons" — the stuff actually running on Ravi right now.
const DAEMONS = [
  { name: "agentic-ai @ zimyo", base: 72, st: "R" },
  { name: "langgraph-workflows", base: 46, st: "R" },
  { name: "dsa-grind --daily", base: 33, st: "R" },
  { name: "coffee.service ☕", base: 100, st: "R" },
  { name: "learning --always", base: 21, st: "R" },
  { name: "job-hunt.daemon", base: 4, st: "S" },
];

const RUNNER = {
  TypeScript: "vite dev --port 3000", Typescript: "vite dev --port 3000",
  JavaScript: "node index.js", Go: "go run .", Rust: "cargo run --release",
  Python: "uvicorn app:api", FastAPI: "uvicorn app:api", Java: "gradle bootRun",
  C: "make && ./bin", "C++": "make && ./bin", Php: "php -S 0.0.0.0:8000", css: "postcss --watch",
};
function procsFor(p) {
  const lang = (p.skills && p.skills[0]) || "";
  const compiled = ["Go", "Rust", "C", "C++", "Java"].includes(lang);
  return [
    { cmd: RUNNER[lang] || "./run.sh", st: "R", cpu: 38 },
    { cmd: compiled ? "build --release" : "tsc --watch", st: "R", cpu: 12 },
    { cmd: (p.link || "").includes("npm") ? "npm publish" : "git push origin main", st: "S", cpu: 0 },
    { cmd: "run tests --coverage", st: "✓", cpu: 0 },
  ];
}
const ST_LABEL = { R: "run", S: "sleep", "✓": "done" };
const ST_COLOR = { R: "#28c840", S: "#FFB020", "✓": "#4ED0C0" };

const Meter = ({ pct }) => (
  <span className="bt-mtr">
    <span className="bt-mtr-grad" />
    <span className="bt-mtr-cover" style={{ width: `${100 - clamp(pct, 0, 100)}%` }} />
  </span>
);

const Box = ({ n, title, right, wide, tall, children }) => (
  <div className={`bt-box${wide ? " wide" : ""}${tall ? " tall" : ""}`}>
    <span className="bt-tag"><sup>{n}</sup>{title}</span>
    {right && <span className="bt-tag-r">{right}</span>}
    <div className="bt-box-in">{children}</div>
  </div>
);

const SystemMonitor = () => {
  const reduced = useReducedMotion();
  const { projects = [], github = {}, identity = {} } = useSiteContent();
  const [t, setT] = useState(0);
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setT((n) => n + 1), 850);
    return () => clearInterval(id);
  }, [reduced]);

  const load = useSeries(52, 30, 92, reduced);
  const net = useSeries(40, 20, 70, reduced);

  const stars = github.stars ?? 167;
  const repos = github.repos ?? 69;

  // all projects → process list
  const builds = projects.map((p, i) => {
    const base = 30 + (hash(p.name) % 68);
    const live = t > 0 && !reduced ? Math.round(base + (Math.random() * 2 - 1) * 10) : base;
    return {
      pid: String(1001 + i * 7),
      name: p.name,
      lang: (p.skills && (LANG_ABBR[p.skills[0]] || p.skills[0])) || "—",
      stars: p.rank === 1 ? (p.name.length * 2) % 40 : null,
      load: clamp(live, 8, 99),
      p,
    };
  });
  const active = builds[clamp(sel, 0, builds.length - 1)] || builds[0];

  const move = (d) => setSel((s) => clamp(s + d, 0, builds.length - 1));
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter" && active?.p?.github) window.open(active.p.github, "_blank");
  };

  const memRows = [
    { k: "Patent", v: "published", pct: 100, c: "#4ED0C0" },
    { k: "GitHub ★", v: String(stars), pct: 84, c: "#FFB020" },
    { k: "npm ↓", v: "1,000+", pct: 72, c: "#FFB020" },
    { k: "DSA", v: "1,200+", pct: 96, c: "#FF7A6B" },
    { k: "GPA", v: "9.5/10", pct: 95, c: "#4ED0C0" },
    { k: "LLM cost", v: "−70%", pct: 70, c: "#FFB020" },
  ];

  const dcpu = (d) => (t > 0 && !reduced ? clamp(Math.round(d.base + (Math.random() * 2 - 1) * 8), 0, 100) : d.base);

  return (
    <div className="btop">
      <div className="bt-head">
        <span className="bt-h-l">
          <b>ravi.sys</b>
          <i className={`bt-dot${reduced ? "" : " live"}`} /> online
          <span className="bt-dim"> · Software Engineer · 4.8 GHz</span>
        </span>
        <span className="bt-h-r">
          <span className="bt-dim">refresh 700ms</span> · up 6y 2m
        </span>
      </div>

      <div className="bt-grid">
        <Box n="1" title="skills" right={`${identity.role || "Software Engineer"} · ${CORES.length} cores`} wide>
          <div className="bt-cpu">
            <pre className="bt-graph">{spark(load)}{"\n"}{spark(load.map((v) => v * 0.82 + 4))}</pre>
            <div className="bt-cores">
              {CORES.map(([name, v], i) => (
                <div className="bt-core" key={name}>
                  <span className="bt-core-id">C{i}</span>
                  <span className="bt-core-name">{name}</span>
                  <Meter pct={v} />
                  <span className="bt-core-v" style={{ color: loadColor(v) }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bt-uptime">since 2019 · 6+ yrs shipping · load avg 0.92 0.88 0.90</div>
        </Box>

        <Box n="2" title="impact" right="mem">
          {memRows.map((r) => (
            <div className="bt-mem" key={r.k}>
              <span className="bt-mem-k">{r.k}</span>
              <span className="bt-mem-v" style={{ color: r.c }}>{r.v}</span>
              <Meter pct={r.pct} />
            </div>
          ))}
        </Box>

        <Box n="3" title="open-source" right="net">
          <pre className="bt-graph teal">{spark(net)}</pre>
          <div className="bt-net">
            <div><span className="bt-dim">▼ stars</span><b>{stars}</b></div>
            <div><span className="bt-dim">▲ repos</span><b>{repos}</b></div>
            <div><span className="bt-dim">Σ commits</span><b>4.2k</b></div>
            <div><span className="bt-dim">peak</span><b>MS Ambassador</b></div>
          </div>
        </Box>

        {/* BUILDS = proc list (selectable) + RUNNING = selected detail + daemons */}
        <Box n="4" title="builds" right={`${builds.length} proc`} tall>
          <div className="bt-proc-h">
            <span>PID</span><span>PROGRAM</span><span>LANG</span><span>★</span><span>LOAD</span>
          </div>
          <div
            className="bt-proc-b"
            ref={listRef}
            tabIndex={0}
            onKeyDown={onKey}
            role="listbox"
            aria-label="builds"
          >
            {builds.map((p, i) => (
              <div
                className={`bt-proc-r${i === sel ? " sel" : ""}`}
                key={p.pid}
                onClick={() => setSel(i)}
                role="option"
                aria-selected={i === sel}
              >
                <span className="bt-dim">{p.pid}</span>
                <span className="bt-proc-n">{p.name}</span>
                <span className="bt-teal">{p.lang}</span>
                <span className="bt-amber">{p.stars ?? "·"}</span>
                <span className="bt-proc-load">
                  <Meter pct={p.load} />
                  <b style={{ color: loadColor(p.load) }}>{p.load}</b>
                </span>
              </div>
            ))}
          </div>

          {/* running processes for the selected build + personal daemons */}
          <div className="bt-run">
            <div className="bt-run-h">
              <sup>5</sup>running <span className="bt-dim">· {(active?.name || "").toLowerCase()} [{active?.pid}]</span>
            </div>
            {active && procsFor(active.p).map((pr, i, arr) => (
              <div className="bt-run-r" key={i}>
                <span className="bt-tree">{i === arr.length - 1 ? "└─" : "├─"}</span>
                <span className="bt-run-cmd">{pr.cmd}</span>
                <span className="bt-run-st" style={{ color: ST_COLOR[pr.st] }}>{ST_LABEL[pr.st]}</span>
                <span className="bt-run-cpu">{pr.cpu ? `${pr.cpu}%` : ""}</span>
              </div>
            ))}
            {active?.p?.description && (
              <div className="bt-run-desc">“{active.p.description.slice(0, 96)}{active.p.description.length > 96 ? "…" : ""}”</div>
            )}

            <div className="bt-run-h dae"><sup>6</sup>daemons <span className="bt-dim">· always on</span></div>
            {DAEMONS.map((d) => {
              const cpu = dcpu(d);
              return (
                <div className="bt-run-r" key={d.name}>
                  <span className="bt-tree">•</span>
                  <span className="bt-run-cmd">{d.name}</span>
                  <span className="bt-run-st" style={{ color: ST_COLOR[d.st] }}>{ST_LABEL[d.st]}</span>
                  <span className="bt-run-cpu" style={{ color: loadColor(cpu) }}>{cpu}%</span>
                </div>
              );
            })}
          </div>
        </Box>
      </div>

      <div className="bt-status">
        <span><b>↑↓</b> select · <b>enter</b> open repo · click a row</span>
        <span className="bt-dim">{builds.length}/69 procs · all systems nominal</span>
      </div>

      <style jsx global>{`
        .btop {
          background: #0a0b0f; color: #c4c7d2;
          font-family: "JetBrains Mono", ui-monospace, monospace;
          font-size: 12px; line-height: 1.35; padding: 12px;
        }
        .btop b { font-weight: 700; }
        .bt-dim { color: #5b6070; }
        .bt-amber { color: #FFB020; } .bt-teal { color: #4ED0C0; }
        .bt-head { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px 10px; font-size: 12px; }
        .bt-h-l b { color: #FFB020; }
        .bt-dot { display: inline-block; height: 6px; width: 6px; border-radius: 50%; background: #28c840; margin: 0 5px 0 8px; }
        .bt-dot.live { box-shadow: 0 0 6px #28c840; animation: btpulse 1.4s infinite; }
        @keyframes btpulse { 0%,100% { opacity: .4; } 50% { opacity: 1; } }
        .bt-grid { display: grid; gap: 8px; grid-template-columns: 1fr 1fr; grid-template-areas: "s1 s1" "s2 p" "s3 p"; }
        .bt-box { position: relative; border: 1px solid #23262f; border-radius: 6px; padding: 14px 12px 11px; }
        .bt-box.wide { grid-area: s1; }
        .bt-box:nth-of-type(2) { grid-area: s2; }
        .bt-box:nth-of-type(3) { grid-area: s3; }
        .bt-box.tall { grid-area: p; display: flex; flex-direction: column; }
        .bt-tag { position: absolute; top: -8px; left: 12px; padding: 0 6px; background: #0a0b0f; color: #FFB020; font-weight: 700; font-size: 11px; }
        .bt-tag sup { color: #FF7A6B; margin-right: 2px; }
        .bt-tag-r { position: absolute; top: -8px; right: 12px; padding: 0 6px; background: #0a0b0f; color: #5b6070; font-size: 10px; }
        .bt-graph { margin: 0; color: #FFB020; font-size: 13px; line-height: 1; letter-spacing: -1px; overflow: hidden; white-space: pre; opacity: .9; }
        .bt-graph.teal { color: #4ED0C0; }
        .bt-cpu { display: grid; grid-template-columns: 1.1fr 1.3fr; gap: 14px; align-items: center; }
        .bt-cores { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 14px; }
        .bt-core { display: grid; grid-template-columns: 20px 54px 1fr 22px; align-items: center; gap: 6px; }
        .bt-core-id { color: #5b6070; font-size: 10px; }
        .bt-core-name { color: #9aa1b2; font-size: 11px; }
        .bt-core-v { text-align: right; font-size: 11px; }
        .bt-uptime { margin-top: 10px; color: #5b6070; font-size: 10.5px; }
        .bt-mtr { position: relative; display: inline-block; height: 8px; width: 100%; border-radius: 2px; overflow: hidden; background: #14161c; vertical-align: middle; }
        .bt-mtr-grad { position: absolute; inset: 0; background: linear-gradient(90deg, #28c840 0%, #FFB020 58%, #FF5f57 100%); -webkit-mask: repeating-linear-gradient(90deg, #000 0 4px, transparent 4px 6px); mask: repeating-linear-gradient(90deg, #000 0 4px, transparent 4px 6px); }
        .bt-mtr-cover { position: absolute; right: 0; top: 0; bottom: 0; background: #14161c; }
        .bt-mem { display: grid; grid-template-columns: 70px 62px 1fr; align-items: center; gap: 8px; padding: 3.5px 0; }
        .bt-mem-k { color: #9aa1b2; font-size: 11px; }
        .bt-mem-v { font-size: 11px; font-weight: 700; }
        .bt-net { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 14px; margin-top: 10px; }
        .bt-net > div { display: flex; justify-content: space-between; }
        .bt-net b { color: #eceef3; }
        .bt-proc-h, .bt-proc-r { display: grid; grid-template-columns: 42px 1fr 52px 30px 90px; gap: 8px; align-items: center; }
        .bt-proc-h { color: #5b6070; font-size: 10px; padding: 0 0 6px; border-bottom: 1px solid #1a1d26; }
        .bt-proc-b { margin-top: 5px; display: flex; flex-direction: column; gap: 2px; max-height: 176px; overflow-y: auto; outline: none; }
        .bt-proc-b::-webkit-scrollbar { width: 6px; }
        .bt-proc-b::-webkit-scrollbar-thumb { background: #23262f; border-radius: 3px; }
        .bt-proc-r { padding: 3px 6px; border-radius: 3px; font-size: 11px; cursor: pointer; border-left: 2px solid transparent; }
        .bt-proc-r:hover { background: #14161c; }
        .bt-proc-r.sel { background: #16202b; border-left-color: #FFB020; }
        .bt-proc-r.sel .bt-proc-n { color: #FFB020; }
        .bt-proc-n { color: #eceef3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bt-proc-load { display: grid; grid-template-columns: 1fr 24px; align-items: center; gap: 6px; }
        .bt-proc-load b { text-align: right; }
        .bt-run { margin-top: 12px; padding-top: 4px; border-top: 1px solid #1a1d26; flex: 1; }
        .bt-run-h { color: #FFB020; font-weight: 700; font-size: 11px; margin: 8px 0 5px; }
        .bt-run-h sup { color: #FF7A6B; margin-right: 3px; }
        .bt-run-h.dae { color: #4ED0C0; }
        .bt-run-h.dae sup { color: #FF7A6B; }
        .bt-run-r { display: grid; grid-template-columns: 18px 1fr 42px 40px; align-items: center; gap: 6px; font-size: 11px; padding: 1.5px 0; }
        .bt-tree { color: #3a3f4c; text-align: center; }
        .bt-run-cmd { color: #c4c7d2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bt-run-st { font-size: 10px; }
        .bt-run-cpu { text-align: right; color: #7a8090; font-size: 10.5px; }
        .bt-run-desc { color: #6b7280; font-size: 10.5px; margin: 5px 0 2px; font-style: italic; }
        .bt-status { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding: 6px 8px 2px; font-size: 10.5px; color: #7a8090; border-top: 1px solid #1a1d26; }
        .bt-status b { color: #FFB020; }
        @media (max-width: 760px) {
          .bt-grid { grid-template-columns: 1fr; grid-template-areas: "s1" "s2" "s3" "p"; }
          .bt-cpu { grid-template-columns: 1fr; }
          .bt-cores { grid-template-columns: 1fr; }
          .bt-head { flex-direction: column; align-items: flex-start; gap: 4px; }
        }
        @media (prefers-reduced-motion: reduce) { .bt-dot.live { animation: none; } }
      `}</style>
    </div>
  );
};

export default SystemMonitor;
