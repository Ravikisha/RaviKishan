import React, { useEffect, useRef, useState } from "react";
import { buildLog } from "../../lib/facts";

// The signature element: a live "build log" that types out Ravi's real
// artifacts and metrics, like one of his own runtimes booting up.
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const BuildLog = () => {
  const [typed, setTyped] = useState("");
  const [line, setLine] = useState(0);
  const [phase, setPhase] = useState("cmd"); // cmd -> out -> next
  const [done, setDone] = useState([]); // completed {cmd,out}
  const timer = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDone(buildLog);
      setLine(buildLog.length);
      return;
    }
    if (line >= buildLog.length) return;

    const current = buildLog[line];
    if (phase === "cmd") {
      if (typed.length < current.cmd.length) {
        timer.current = setTimeout(
          () => setTyped(current.cmd.slice(0, typed.length + 1)),
          38
        );
      } else {
        timer.current = setTimeout(() => setPhase("out"), 340);
      }
    } else if (phase === "out") {
      timer.current = setTimeout(() => {
        setDone((d) => [...d, current]);
        setTyped("");
        setPhase("cmd");
        setLine((l) => l + 1);
      }, 520);
    }
    return () => clearTimeout(timer.current);
  }, [typed, phase, line]);

  const running = line < buildLog.length;

  return (
    <div className="relative w-full max-w-[520px] rounded-xl border border-line bg-[#0D0E13]/95 shadow-2xl shadow-black/60 backdrop-blur">
      {/* amber glow seam */}
      <div className="pointer-events-none absolute -inset-px rounded-xl bg-gradient-to-b from-amber/20 via-transparent to-transparent opacity-60" />
      {/* window chrome */}
      <div className="relative flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#2A2D36]" />
        <span className="h-3 w-3 rounded-full bg-[#2A2D36]" />
        <span className="h-3 w-3 rounded-full bg-[#2A2D36]" />
        <span className="ml-3 font-mono text-xs text-mist">ravi@systems — build</span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-teal">
          <span className="h-1.5 w-1.5 rounded-full bg-teal shadow-[0_0_8px_#4ED0C0]" />
          live
        </span>
      </div>

      {/* log body */}
      <div className="relative min-h-[268px] space-y-3 p-4 font-mono text-[13px] leading-relaxed sm:text-sm">
        {done.map((l, i) => (
          <LogLine key={i} cmd={l.cmd} out={l.out} />
        ))}
        {running && (
          <div>
            <div className="flex text-chalk">
              <span className="mr-2 select-none text-amber">$</span>
              <span>
                {typed}
                {phase === "cmd" && (
                  <span className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-blink bg-amber align-middle" />
                )}
              </span>
            </div>
            {phase === "out" && (
              <div className="mt-1 flex pl-4 text-mist">
                <span className="mr-2 text-teal">✓</span>
                <span>{buildLog[line].out}</span>
              </div>
            )}
          </div>
        )}
        {!running && (
          <div className="flex items-center pt-1 text-chalk">
            <span className="mr-2 select-none text-amber">$</span>
            <span className="h-4 w-2 animate-blink bg-amber" />
          </div>
        )}
      </div>
    </div>
  );
};

const LogLine = ({ cmd, out }) => (
  <div>
    <div className="flex text-chalk">
      <span className="mr-2 select-none text-amber">$</span>
      <span>{cmd}</span>
    </div>
    <div className="mt-1 flex pl-4 text-mist">
      <span className="mr-2 text-teal">✓</span>
      <span>{out}</span>
    </div>
  </div>
);

export default BuildLog;
