// The contents rail that sits beside a post.
//
// Design note: long technical writing's real navigation problem is "where am I
// in this thing" — a top progress bar answers that vaguely and is the default
// everywhere. This puts the answer where the eye already is: a sticky column
// of the piece's own headings, with the active one marked by an amber
// highlighter swipe rather than a border or a colour change. That swipe is the
// one loud gesture on the page; everything else stays quiet.
//
// Headings are read from the rendered article rather than parsed from the
// Markdown, so the rail can never disagree with the page.
import React, { useEffect, useRef, useState } from "react";

export default function ArticleRail({ containerRef }) {
  const [items, setItems] = useState([]);
  const [active, setActive] = useState("");
  const [progress, setProgress] = useState(0);
  const [open, setOpen] = useState(false);
  const observer = useRef(null);

  useEffect(() => {
    const root = containerRef?.current;
    if (!root) return undefined;

    const heads = Array.from(root.querySelectorAll("h2, h3")).filter((h) => h.textContent.trim());
    heads.forEach((h, i) => {
      if (!h.id) h.id = `s-${i}-${h.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
    });
    setItems(heads.map((h) => ({ id: h.id, text: h.textContent.trim(), level: h.tagName === "H3" ? 3 : 2 })));
    if (heads[0]) setActive(heads[0].id);

    observer.current?.disconnect();
    observer.current = new IntersectionObserver(
      (entries) => {
        // The topmost heading currently in the upper band of the viewport wins,
        // which matches what a reader would call "the section I'm in".
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-10% 0px -70% 0px", threshold: 0 }
    );
    heads.forEach((h) => observer.current.observe(h));

    const onScroll = () => {
      const rect = root.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const done = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      setProgress(done);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      observer.current?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [containerRef]);

  if (items.length < 2) return null;

  const jump = (id) => (e) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(false);
  };

  const list = (
    <ol className="rail-list">
      {items.map((it) => (
        <li key={it.id} className={`rail-item l${it.level}${active === it.id ? " on" : ""}`}>
          <a href={`#${it.id}`} onClick={jump(it.id)}>
            <span className="rail-mark" aria-hidden="true" />
            <span className="rail-text">{it.text}</span>
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <aside className="rail" aria-label="Contents">
        {list}
        <div className="rail-progress" aria-hidden="true">
          <i style={{ transform: `scaleY(${progress})` }} />
        </div>
      </aside>

      {/* Mobile: the rail becomes a disclosure under the deck rather than
          disappearing, so the structure is still reachable on a phone. */}
      <details className="rail-m" open={open} onToggle={(e) => setOpen(e.target.open)}>
        <summary>Contents<span>{items.length}</span></summary>
        {list}
      </details>

      <style jsx global>{`
        .rail {
          position: sticky;
          top: 96px;
          align-self: start;
          display: none;
          padding-right: 18px;
        }
        @media (min-width: 1080px) {
          .rail {
            display: block;
          }
        }
        .rail-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .rail-item a {
          display: flex;
          align-items: baseline;
          gap: 8px;
          padding: 5px 8px;
          border-radius: 4px;
          text-decoration: none;
          color: var(--c-muted);
          font-size: 13px;
          line-height: 1.45;
          position: relative;
        }
        .rail-item.l3 a {
          padding-left: 22px;
          font-size: 12.5px;
        }
        .rail-item a:hover {
          color: var(--c-fg);
        }
        .rail-text {
          position: relative;
          z-index: 1;
        }
        /* The one bold gesture: a marker-pen swipe, skewed and slightly
           overrunning the text the way a real highlighter does. */
        .rail-mark {
          position: absolute;
          left: 2px;
          right: 2px;
          top: 50%;
          height: 1.1em;
          transform: translateY(-50%) skewX(-9deg) scaleX(0);
          transform-origin: left center;
          background: var(--c-accent);
          opacity: 0.32;
          border-radius: 2px;
          transition: transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
        }
        .rail-item.on a {
          color: var(--c-fg);
          font-weight: 600;
        }
        .rail-item.on .rail-mark {
          transform: translateY(-50%) skewX(-9deg) scaleX(1);
        }
        @media (prefers-reduced-motion: reduce) {
          .rail-mark {
            transition: none;
          }
        }
        .rail-progress {
          margin: 14px 0 0 9px;
          width: 2px;
          height: 72px;
          background: var(--c-edge);
          border-radius: 2px;
          overflow: hidden;
        }
        .rail-progress i {
          display: block;
          width: 100%;
          height: 100%;
          background: var(--c-accent);
          transform-origin: top;
        }

        .rail-m {
          border: 1px solid var(--c-edge);
          border-radius: 10px;
          margin: 0 0 30px;
          background: var(--c-surface);
        }
        @media (min-width: 1080px) {
          .rail-m {
            display: none;
          }
        }
        .rail-m summary {
          cursor: pointer;
          padding: 12px 15px;
          font-size: 14px;
          font-weight: 600;
          color: var(--c-fg);
          display: flex;
          justify-content: space-between;
        }
        .rail-m summary span {
          color: var(--c-muted);
          font-weight: 400;
        }
        .rail-m .rail-list {
          padding: 0 8px 10px;
        }
      `}</style>
    </>
  );
}
