import React, { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

// Reveals `text` token-by-token (word level) like an LLM generating, with a
// blinking cursor. SEO-safe: the FULL text is rendered on the server and on the
// first client paint, so crawlers and no-JS users always see it; the animation
// only kicks in after mount. Layout is reserved (un-revealed tokens are kept in
// flow at opacity 0) so nothing below jumps as it types.
//
// Props:
//   text         string to stream
//   run          begin when true (lets a parent sequence multiple streams)
//   speed        ms per token (default 42)
//   accentLast   colour the final word with the accent
//   keepCursor   keep the blinking cursor after completion
//   onDone       called once when fully revealed
export default function TokenStream({
  text = "",
  run = true,
  speed = 42,
  accentLast = false,
  keepCursor = false,
  onDone,
  className = "",
}) {
  const reduced = useReducedMotion();
  const tokens = text.split(/(\s+)/); // words + whitespace preserved
  const total = tokens.length;
  const lastWord = (() => {
    for (let i = total - 1; i >= 0; i--) if (tokens[i].trim()) return i;
    return -1;
  })();

  const [mounted, setMounted] = useState(false);
  const [n, setN] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || !run) return;
    if (reduced) {
      setN(total);
      if (!doneRef.current) { doneRef.current = true; onDone && onDone(); }
      return;
    }
    setN(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= total) {
        clearInterval(id);
        if (!doneRef.current) { doneRef.current = true; onDone && onDone(); }
      }
    }, speed);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, run]);

  // full text pre-mount (SSR/first paint) and when reduced-motion
  const full = !mounted || reduced;
  const count = full ? total : run ? n : 0;
  const complete = count >= total;
  const showCursor = !full && (!complete || keepCursor) && (run || false);

  const tokenClass = (i) =>
    accentLast && i === lastWord && (complete || full) ? "text-accentText" : "";

  return (
    <span className={className} aria-label={text}>
      {tokens.map((t, i) =>
        i < count ? (
          <span key={i} className={tokenClass(i)}>
            {t}
          </span>
        ) : null
      )}
      {showCursor && (
        <span className="ml-0.5 inline-block h-[0.85em] w-[0.5ch] translate-y-[0.08em] animate-blink bg-accent align-middle" />
      )}
      {/* reserve layout: un-revealed tokens kept in flow, invisible */}
      <span aria-hidden="true" style={{ opacity: 0 }}>
        {tokens.map((t, i) => (i >= count ? t : "")).join("")}
      </span>
    </span>
  );
}
