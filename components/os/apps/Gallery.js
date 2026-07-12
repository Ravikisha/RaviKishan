import React, { useEffect, useMemo, useState } from "react";
import { X, ChevronLeft, ChevronRight, Camera } from "lucide-react";

// Gallery — a photo wall. A masonry grid of shots, filterable by category, with
// a quiet lightbox (arrow keys, counter). Placeholder images are stock photos
// from Pexels for now; swap `SHOTS` for real ones (or wire a source) later.
const px = (id, w) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`;

const SHOTS = [
  { id: "3861958", title: "Deploy window", category: "Desk", note: "The screen glow at 2am, when the pipeline finally goes green." },
  { id: "1181671", title: "The classics", category: "Desk", note: "Re-reading the fundamentals between two hard bugs." },
  { id: "3184465", title: "The handoff", category: "Builds", note: "Where a design doc becomes something that ships." },
  { id: "3861969", title: "In the machine", category: "Builds", note: "Down among the bytes — profiling a hot path." },
  { id: "2379004", title: "Between talks", category: "Talks", note: "Hallway track, the part of a conference that actually sticks." },
  { id: "1704488", title: "Golden hour", category: "Field", note: "Chasing the light after a long build week." },
  { id: "1391498", title: "Campus, late", category: "Field", note: "Empty steps, the quiet that good work needs." },
  { id: "220453", title: "Field notes", category: "People", note: "A portrait between problems." },
  { id: "415829", title: "Studio light", category: "People", note: "One frame, controlled light." },
  { id: "733872", title: "Natural light", category: "People", note: "No setup, just the window." },
];

const CATS = ["All", ...Array.from(new Set(SHOTS.map((s) => s.category)))];

export default function Gallery() {
  const [cat, setCat] = useState("All");
  const [open, setOpen] = useState(null);

  const shots = useMemo(() => (cat === "All" ? SHOTS : SHOTS.filter((s) => s.category === cat)), [cat]);
  const item = open != null ? shots[open] : null;
  const nav = (d) => setOpen((i) => (i == null ? 0 : (i + d + shots.length) % shots.length));

  useEffect(() => {
    if (open == null) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(null);
      else if (e.key === "ArrowRight") nav(1);
      else if (e.key === "ArrowLeft") nav(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shots.length]);

  return (
    <div className="gl">
      <header className="gl-head">
        <div className="gl-title">
          <Camera className="h-4 w-4" />
          <h2>Gallery</h2>
          <span className="gl-n">{shots.length} shot{shots.length === 1 ? "" : "s"}</span>
        </div>
        <nav className="gl-filters">
          {CATS.map((c) => (
            <button key={c} className={`gl-chip${cat === c ? " on" : ""}`} onClick={() => { setCat(c); setOpen(null); }}>
              {c}
            </button>
          ))}
        </nav>
      </header>

      <div className="gl-wall">
        {shots.map((s, i) => (
          <button key={s.id} className="gl-item" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} onClick={() => setOpen(i)}>
            <img src={px(s.id, 600)} alt={s.title} loading="lazy" />
            <span className="gl-ov">
              <span className="gl-cat">{s.category}</span>
              <span className="gl-cap">{s.title}</span>
            </span>
          </button>
        ))}
      </div>

      {item && (
        <div className="gl-box" onClick={() => setOpen(null)}>
          <button className="gl-x" onClick={() => setOpen(null)} aria-label="Close"><X className="h-5 w-5" /></button>
          <button className="gl-arw l" onClick={(e) => { e.stopPropagation(); nav(-1); }} aria-label="Previous"><ChevronLeft className="h-6 w-6" /></button>
          <button className="gl-arw r" onClick={(e) => { e.stopPropagation(); nav(1); }} aria-label="Next"><ChevronRight className="h-6 w-6" /></button>
          <figure className="gl-fig" onClick={(e) => e.stopPropagation()}>
            <img src={px(item.id, 1200)} alt={item.title} />
            <figcaption>
              <div className="gl-fc-top">
                <span className="gl-fc-cat">{item.category}</span>
                <span className="gl-count">{open + 1} / {shots.length}</span>
              </div>
              <h3>{item.title}</h3>
              {item.note && <p>{item.note}</p>}
            </figcaption>
          </figure>
        </div>
      )}

      <style jsx>{`
        .gl { min-height: 100%; background: var(--c-bg); color: var(--c-fg); font-family: "Inter", sans-serif; }
        .gl-head { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--c-edge); background: color-mix(in srgb, var(--c-surface) 90%, transparent); backdrop-filter: blur(10px); }
        .gl-title { display: flex; align-items: center; gap: 9px; color: var(--c-accentText, var(--c-accent)); }
        .gl-title h2 { font-family: "Space Grotesk", sans-serif; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; color: var(--c-fg); }
        .gl-n { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--c-muted); }
        .gl-filters { display: flex; flex-wrap: wrap; gap: 6px; }
        .gl-chip { padding: 5px 12px; border-radius: 999px; border: 1px solid var(--c-edge); background: var(--c-surface); color: var(--c-muted); font-family: "JetBrains Mono", monospace; font-size: 11px; cursor: pointer; transition: color .12s, border-color .12s; }
        .gl-chip:hover { color: var(--c-fg); }
        .gl-chip.on { border-color: var(--c-accent); background: var(--c-accent); color: var(--c-accentFg, #0a0b0f); font-weight: 600; }

        /* masonry wall — varied heights read like a gallery, not a feed */
        .gl-wall { column-count: 4; column-gap: 12px; padding: 16px 18px 22px; }
        .gl-item { break-inside: avoid; margin: 0 0 12px; width: 100%; display: block; position: relative; overflow: hidden; border-radius: 12px; border: 1px solid var(--c-edge); background: var(--c-surface); cursor: pointer; padding: 0; animation: gl-in .5s both cubic-bezier(.16,1,.3,1); }
        .gl-item img { width: 100%; height: auto; display: block; transition: transform .5s cubic-bezier(.16,1,.3,1); }
        .gl-item:hover img { transform: scale(1.05); }
        .gl-ov { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; padding: 12px; text-align: left; background: linear-gradient(transparent 45%, rgba(0,0,0,.72)); opacity: 0; transition: opacity .22s; }
        .gl-item:hover .gl-ov { opacity: 1; }
        .gl-cat { font-family: "JetBrains Mono", monospace; font-size: 9.5px; letter-spacing: .18em; text-transform: uppercase; color: var(--c-accent, #FFB020); }
        .gl-cap { font-family: "Space Grotesk", sans-serif; font-size: 14px; font-weight: 700; color: #fff; }
        @keyframes gl-in { from { opacity: 0; transform: translateY(12px); } }
        @media (max-width: 900px) { .gl-wall { column-count: 3; } }
        @media (max-width: 620px) { .gl-wall { column-count: 2; column-gap: 8px; } .gl-item { margin-bottom: 8px; } }

        .gl-box { position: fixed; inset: 0; z-index: 300002; display: grid; place-items: center; padding: 44px; background: rgba(0,0,0,.86); backdrop-filter: blur(8px); animation: gl-fade .18s ease; }
        @keyframes gl-fade { from { opacity: 0; } }
        .gl-x { position: absolute; top: 18px; right: 18px; background: rgba(255,255,255,.1); border: none; color: #fff; border-radius: 9px; padding: 8px; cursor: pointer; }
        .gl-arw { position: absolute; top: 50%; transform: translateY(-50%); display: grid; place-items: center; background: rgba(255,255,255,.08); border: none; color: #fff; width: 46px; height: 66px; border-radius: 12px; cursor: pointer; }
        .gl-arw.l { left: 18px; } .gl-arw.r { right: 18px; }
        .gl-arw:hover, .gl-x:hover { background: rgba(255,255,255,.2); }
        .gl-fig { max-width: 940px; width: 100%; margin: 0; background: #0d0e13; border: 1px solid #23262f; border-radius: 16px; overflow: hidden; box-shadow: 0 30px 90px rgba(0,0,0,.65); }
        .gl-fig img { width: 100%; max-height: 64vh; object-fit: contain; background: #06070a; display: block; }
        .gl-fig figcaption { padding: 16px 22px 20px; }
        .gl-fc-top { display: flex; align-items: center; justify-content: space-between; }
        .gl-fc-cat { font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: #FFB020; }
        .gl-count { font-family: "JetBrains Mono", monospace; font-size: 11px; color: #6b7080; }
        .gl-fig h3 { margin-top: 8px; font-family: "Space Grotesk", sans-serif; font-size: 22px; font-weight: 700; color: #F4F5F8; }
        .gl-fig p { margin-top: 6px; font-size: 13.5px; line-height: 1.6; color: #9aa0b0; max-width: 60ch; }
        @media (max-width: 620px) { .gl-box { padding: 14px; } .gl-arw { display: none; } }
        @media (prefers-reduced-motion: reduce) { .gl-item, .gl-box { animation: none; } .gl-item img { transition: none; } }
      `}</style>
    </div>
  );
}
