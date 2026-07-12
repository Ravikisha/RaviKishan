import React, { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

// Subtle "packet sniffer" ambience — faint mono request lines drift across the
// background. Purely decorative, pointer-events-none, and disabled for
// reduced-motion. Sits behind hero content.
const PACKETS = [
  { t: "GET /portfolio", s: "200 OK", top: "12%", dur: 22, delay: 0 },
  { t: "GET /projects", s: "200 OK", top: "28%", dur: 28, delay: 4 },
  { t: "POST /hire", s: "202 Accepted", top: "44%", dur: 25, delay: 9 },
  { t: "GET /sleep", s: "404 Not Found", top: "60%", dur: 30, delay: 2, err: true },
  { t: "WS /agents", s: "101 Switching", top: "74%", dur: 26, delay: 12 },
  { t: "GET /coffee", s: "200 OK", top: "88%", dur: 24, delay: 7 },
];

export default function PacketBackground() {
  const prefersReduced = useReducedMotion();
  // gate behind mount so SSR + first client render agree (no hydration mismatch)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (mounted && prefersReduced) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {PACKETS.map((p, i) => (
        <span
          key={i}
          className="packet"
          style={{ top: p.top, animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` }}
        >
          <span className="packet-arrow">›</span>
          {p.t} <span className={p.err ? "packet-err" : "packet-ok"}>{p.s}</span>
        </span>
      ))}
      <style jsx>{`
        .packet {
          position: absolute;
          left: -30%;
          white-space: nowrap;
          font-family: "JetBrains Mono", monospace;
          font-size: 11px;
          color: var(--c-muted, #8b90a0);
          opacity: 0;
          animation-name: drift;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .packet-arrow { color: var(--c-accent, #ffb020); margin-right: 6px; }
        .packet-ok { color: var(--c-live, #4ed0c0); }
        .packet-err { color: #ff6b6b; }
        @keyframes drift {
          0% { transform: translateX(0); opacity: 0; }
          8% { opacity: 0.28; }
          92% { opacity: 0.28; }
          100% { transform: translateX(160vw); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
