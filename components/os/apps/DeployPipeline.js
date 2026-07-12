import React, { useEffect, useRef, useState } from "react";
import { GitBranch, Play, RotateCcw } from "lucide-react";

// CI/CD pipeline — a fake "git push → production" deploy that streams a real
// terminal log through commit → build → test → docker → deploy → live.
const STAGES = [
  { key: "commit", label: "Commit", lines: ["$ git push origin main", "→ 3 files changed, 128 insertions(+)"] },
  { key: "build", label: "Build", lines: ["$ next build", "✓ compiled 1,740 modules · 12.4s"] },
  { key: "test", label: "Test", lines: ["$ jest --ci", "✓ 42 passed, 0 failed · 3.1s"] },
  { key: "docker", label: "Docker", lines: ["$ docker build -t ravi/portfolio:latest .", "✓ image built · 84 MB"] },
  { key: "deploy", label: "Deploy", lines: ["→ pushing to edge network…", "✓ live in 12 regions"] },
  { key: "live", label: "Live", lines: ["✓ https://ravikishan.me — 200 OK · 48ms", "deployment succeeded 🚀"] },
];

export default function DeployPipeline() {
  const [active, setActive] = useState(-1); // -1 idle, STAGES.length = done
  const [log, setLog] = useState([]);
  const bodyRef = useRef(null);
  const timers = useRef([]);

  const run = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setLog([]);
    setActive(0);
    let delay = 0;
    STAGES.forEach((s, i) => {
      timers.current.push(
        setTimeout(() => {
          setActive(i);
          setLog((l) => [...l, { k: "stage", t: `▸ ${s.label.toLowerCase()}` }, ...s.lines.map((t) => ({ k: t.startsWith("✓") ? "ok" : t.startsWith("→") ? "muted" : "cmd", t }))]);
        }, delay)
      );
      delay += 900;
    });
    timers.current.push(setTimeout(() => setActive(STAGES.length), delay));
  };

  useEffect(() => {
    run();
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [log]);

  const done = active >= STAGES.length;

  return (
    <div className="dp">
      <div className="dp-head">
        <span className="dp-repo"><GitBranch className="h-3.5 w-3.5" /> ravikishan / portfolio <span className="dp-branch">main</span></span>
        <button className="dp-run" onClick={run}>
          {done ? <><RotateCcw className="h-3 w-3" /> redeploy</> : <><Play className="h-3 w-3" /> running</>}
        </button>
      </div>

      <div className="dp-stages">
        {STAGES.map((s, i) => {
          const st = done || i < active ? "done" : i === active ? "run" : "idle";
          return (
            <React.Fragment key={s.key}>
              <div className={`dp-stage ${st}`}>
                <span className="dp-dot" />
                {s.label}
              </div>
              {i < STAGES.length - 1 && <span className={`dp-arrow ${done || i < active ? "on" : ""}`}>→</span>}
            </React.Fragment>
          );
        })}
      </div>

      <div className="dp-log" ref={bodyRef}>
        {log.map((l, i) => (
          <div key={i} className={`dp-line k-${l.k}`}>{l.t}</div>
        ))}
        {done && <div className="dp-line k-ok">✓ pipeline complete · 0 errors</div>}
        {!done && <div className="dp-cursor" />}
      </div>

      <style jsx>{`
        .dp { height: 100%; display: flex; flex-direction: column; background: #0a0b0f; color: #c4c7d2; font-family: "JetBrains Mono", monospace; font-size: 12px; }
        .dp-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #1a1d26; }
        .dp-repo { display: flex; align-items: center; gap: 7px; color: #e7e8ee; }
        .dp-branch { color: #FFB020; }
        .dp-run { display: inline-flex; align-items: center; gap: 6px; background: #16202b; border: 1px solid #23262f; color: #4ED0C0; border-radius: 6px; padding: 5px 12px; cursor: pointer; font: inherit; }
        .dp-run:hover { border-color: #4ED0C0; }
        .dp-stages { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 14px; border-bottom: 1px solid #1a1d26; }
        .dp-stage { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #23262f; border-radius: 999px; padding: 4px 11px; color: #5b6070; font-size: 11px; }
        .dp-stage .dp-dot { height: 6px; width: 6px; border-radius: 50%; background: #3a3f4c; }
        .dp-stage.done { color: #4ED0C0; border-color: rgba(78,208,192,.4); }
        .dp-stage.done .dp-dot { background: #4ED0C0; }
        .dp-stage.run { color: #FFB020; border-color: rgba(255,176,32,.5); }
        .dp-stage.run .dp-dot { background: #FFB020; box-shadow: 0 0 8px #FFB020; animation: dppulse 1s infinite; }
        @keyframes dppulse { 0%,100%{opacity:.4} 50%{opacity:1} }
        .dp-arrow { color: #2a2f3a; font-size: 12px; }
        .dp-arrow.on { color: #4ED0C0; }
        .dp-log { flex: 1; overflow-y: auto; padding: 12px 14px; line-height: 1.7; }
        .dp-line { white-space: pre-wrap; }
        .k-cmd { color: #e7e8ee; }
        .k-ok { color: #4ED0C0; }
        .k-muted { color: #7a8090; }
        .k-stage { color: #FFB020; margin-top: 6px; }
        .dp-cursor { display: inline-block; height: 13px; width: 7px; background: #FFB020; animation: dpblink 1s step-end infinite; }
        @keyframes dpblink { 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}
