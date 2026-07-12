import React, { useEffect, useRef, useState } from "react";

// First-visit boot sequence for the desktop-OS. Streams a themed boot log, then
// fades to reveal the desktop. Shows once per browser session (sessionStorage),
// and is skipped in recruiter mode and under reduced-motion — recruiters and
// a11y users go straight to content.
const SEQ = [
  { t: "raviOS 4.8.0 (relax-kernel) — Ravi Kishan", c: "accent" },
  { t: "POST … cpu ok · mem ok · gpu RTX 3050 ok", c: "dim" },
  { t: "mount /skills ............ 50+ loaded", c: "out" },
  { t: "mount /projects .......... 69 repos", c: "out" },
  { t: "mount /writing ........... dev.to synced", c: "out" },
  { t: "mount /patents ........... 1 granted", c: "out" },
  { t: "starting window-manager .. ok", c: "out" },
  { t: "loading applications ..... 15 ok", c: "out" },
  { t: "neural coprocessor ....... online", c: "ok" },
  { t: "welcome, guest — press any key.", c: "amber" },
];

export default function BootScreen() {
  const [show, setShow] = useState(false);
  const [n, setN] = useState(0); // lines revealed
  const [done, setDone] = useState(false);
  const timers = useRef([]);

  const finish = () => {
    timers.current.forEach(clearTimeout);
    setDone(true);
    setTimeout(() => {
      setShow(false);
      try { sessionStorage.setItem("os:booted", "1"); } catch (_) {}
    }, 650);
  };

  useEffect(() => {
    let skip = false;
    try {
      if (sessionStorage.getItem("os:booted")) skip = true;
      if ((localStorage.getItem("mode") || "recruiter") !== "dev") skip = true; // boot only in dev
    } catch (_) {}
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) skip = true;
    if (skip) { try { sessionStorage.setItem("os:booted", "1"); } catch (_) {} return; }

    setShow(true);
    let i = 0;
    const step = () => {
      i += 1;
      setN(i);
      if (i < SEQ.length) {
        timers.current.push(setTimeout(step, 150 + Math.random() * 170));
      } else {
        timers.current.push(setTimeout(finish, 900));
      }
    };
    timers.current.push(setTimeout(step, 300));
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!show) return;
    const skip = () => finish();
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;
  const pct = Math.round((n / SEQ.length) * 100);

  return (
    <div className={`os-boot${done ? " done" : ""}`} onClick={finish}>
      <div className="os-boot-in">
        <div className="os-boot-brand">
          <span className="os-boot-diamond" />
          raviOS
        </div>
        <div className="os-boot-log">
          {SEQ.slice(0, n).map((l, i) => (
            <div key={i} className={`os-boot-line k-${l.c}`}>{l.t}</div>
          ))}
          <span className="os-boot-cursor" />
        </div>
        <div className="os-boot-bar"><span style={{ width: `${pct}%` }} /></div>
        <button className="os-boot-skip" onClick={finish}>skip →</button>
      </div>

      <style jsx>{`
        .os-boot {
          position: fixed; inset: 0; z-index: 500000; cursor: pointer;
          display: grid; place-items: center; padding: 24px;
          background: radial-gradient(130% 130% at 50% 30%, #0a0c11 0%, #050609 70%, #030406 100%);
          transition: opacity .6s ease;
        }
        .os-boot.done { opacity: 0; pointer-events: none; }
        .os-boot-in { width: 100%; max-width: 460px; font-family: "JetBrains Mono", monospace; }
        .os-boot-brand {
          display: flex; align-items: center; gap: 10px; margin-bottom: 20px;
          font-family: "Space Grotesk", sans-serif; font-size: 24px; font-weight: 700; color: #F4F5F8;
        }
        .os-boot-diamond { height: 12px; width: 12px; border-radius: 3px; background: #FFB020; transform: rotate(45deg); box-shadow: 0 0 16px rgba(255,176,32,.6); }
        .os-boot-log { min-height: 210px; font-size: 12.5px; line-height: 1.8; }
        .os-boot-line { white-space: pre-wrap; animation: boot-in .18s ease; }
        @keyframes boot-in { from { opacity: 0; transform: translateY(2px); } }
        .k-accent { color: #FFB020; } .k-dim { color: #565b6b; } .k-out { color: #c4c7d2; }
        .k-ok { color: #4ED0C0; } .k-amber { color: #FFB020; }
        .os-boot-cursor {
          display: inline-block; height: 13px; width: 7px; background: #FFB020;
          vertical-align: middle; animation: boot-blink 1s steps(2) infinite;
        }
        @keyframes boot-blink { 50% { opacity: 0; } }
        .os-boot-bar { margin-top: 22px; height: 3px; border-radius: 3px; background: #1a1d25; overflow: hidden; }
        .os-boot-bar span { display: block; height: 100%; background: linear-gradient(90deg, #FFB020, #FFCB5C); transition: width .3s ease; }
        .os-boot-skip {
          margin-top: 18px; background: none; border: none; cursor: pointer;
          font-family: inherit; font-size: 11px; letter-spacing: .1em; color: #565b6b; transition: color .15s;
        }
        .os-boot-skip:hover { color: #c4c7d2; }
      `}</style>
    </div>
  );
}
