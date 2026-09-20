// The admin chrome: navigation, header, and the shared visual language every
// panel inherits.
//
// Layout concept — a console with a spine. Twelve sections do not fit in a tab
// row, and the previous one simply overflowed off the side of a phone. So:
//
//   desktop  a fixed left rail, sections stacked, with one amber bar that
//            SLIDES between them. That bar is the only moving object in the
//            whole interface; everything else holds still.
//   mobile   no nav bar at all until you ask for one. A sticky footer shows
//            where you are; tapping it raises a full-height sheet of big tap
//            targets. This is a tool used one-handed for thirty seconds.
//
// The rail also carries information, not just links: a section with something
// waiting — an overdue follow-up, a document about to expire, unread mail —
// gets a dot. The navigation tells you where to GO, not merely where you can.
import React, { useEffect, useRef, useState } from "react";

export default function AdminShell({
  tabs,
  view,
  onView,
  title,
  actions,
  email,
  onSignOut,
  badges = {},
  children,
}) {
  const [sheet, setSheet] = useState(false);
  const listRef = useRef(null);
  const [marker, setMarker] = useState({ top: 0, height: 0, ready: false });

  // Position the sliding marker from the real DOM rather than from an index,
  // so it stays correct whatever the labels wrap to.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-tab="${view}"]`);
    if (!el) return;
    setMarker({ top: el.offsetTop, height: el.offsetHeight, ready: true });
  }, [view, tabs]);

  // Escape closes the sheet, and the body must not scroll behind it.
  useEffect(() => {
    if (!sheet) return undefined;
    const onKey = (e) => e.key === "Escape" && setSheet(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [sheet]);

  const go = (k) => () => {
    onView(k);
    setSheet(false);
  };

  const current = tabs.find(([k]) => k === view);
  const currentLabel = current ? current[1] : title;

  return (
    <div className="ad">
      {/* ---------- desktop rail ---------- */}
      <nav className="ad-rail" aria-label="Sections">
        <div className="ad-brand">
          <span className="ad-dot" aria-hidden="true" />
          <span>Control</span>
        </div>

        <div className="ad-list" ref={listRef}>
          <span
            className="ad-marker"
            aria-hidden="true"
            style={{
              transform: `translateY(${marker.top}px)`,
              height: marker.height,
              opacity: marker.ready ? 1 : 0,
            }}
          />
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              data-tab={k}
              className={`ad-item${view === k ? " on" : ""}`}
              aria-current={view === k ? "page" : undefined}
              onClick={go(k)}
            >
              <span>{label}</span>
              {badges[k] ? (
                <i className="ad-badge" title={`${badges[k]} need attention`}>
                  {badges[k] > 9 ? "9+" : badges[k]}
                </i>
              ) : null}
            </button>
          ))}
        </div>

        <div className="ad-foot">
          <span className="ad-who" title={email}>{email}</span>
          <button type="button" className="ad-signout" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </nav>

      {/* ---------- main column ---------- */}
      <div className="ad-main">
        <header className="ad-top">
          <h1>{currentLabel}</h1>
          {actions ? <div className="ad-actions">{actions}</div> : null}
        </header>
        <div className="ad-content">{children}</div>
      </div>

      {/* ---------- mobile: footer + sheet ---------- */}
      <button
        type="button"
        className="ad-mobile-bar"
        onClick={() => setSheet(true)}
        aria-expanded={sheet}
      >
        <span className="ad-mobile-now">{currentLabel}</span>
        <span className="ad-mobile-hint">{tabs.length} sections</span>
        <span className="ad-chev" aria-hidden="true" />
      </button>

      {sheet && (
        <div className="ad-sheet-wrap" role="dialog" aria-modal="true" aria-label="Sections">
          <button className="ad-scrim" type="button" aria-label="Close" onClick={() => setSheet(false)} />
          <div className="ad-sheet">
            <div className="ad-sheet-grip" aria-hidden="true" />
            <div className="ad-sheet-list">
              {tabs.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`ad-sheet-item${view === k ? " on" : ""}`}
                  onClick={go(k)}
                >
                  <span>{label}</span>
                  {badges[k] ? <i className="ad-badge">{badges[k] > 9 ? "9+" : badges[k]}</i> : null}
                </button>
              ))}
            </div>
            <div className="ad-sheet-foot">
              <span className="ad-who">{email}</span>
              <button type="button" className="ad-signout" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        :root {
          --a-void: #08090d;
          --a-panel: #111319;
          --a-raise: #171a22;
          --a-line: #1e222c;
          --a-dim: #7d8496;
          --a-text: #e9ebf2;
          --a-amber: #ffb020;
          --a-live: #4ed0c0;
        }

        .ad {
          min-height: 100vh;
          min-height: 100dvh;
          background: var(--a-void);
          color: var(--a-text);
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
          display: grid;
          grid-template-columns: 1fr;
        }
        @media (min-width: 1000px) {
          .ad {
            grid-template-columns: 236px minmax(0, 1fr);
          }
        }

        /* ---- rail ---- */
        .ad-rail {
          display: none;
          position: sticky;
          top: 0;
          height: 100vh;
          height: 100dvh;
          flex-direction: column;
          border-right: 1px solid var(--a-line);
          background: var(--a-panel);
          padding: 20px 12px 14px;
        }
        @media (min-width: 1000px) {
          .ad-rail {
            display: flex;
          }
        }
        .ad-brand {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 0 10px 18px;
          font-family: "Space Grotesk", sans-serif;
          font-weight: 700;
          font-size: 15px;
          letter-spacing: -0.02em;
        }
        .ad-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--a-amber);
        }
        .ad-list {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 1px;
          overflow-y: auto;
          flex: 1;
          margin: 0 -4px;
          padding: 0 4px;
        }
        /* The single moving object. */
        .ad-marker {
          position: absolute;
          left: 0;
          width: 3px;
          border-radius: 0 3px 3px 0;
          background: var(--a-amber);
          transition: transform 0.26s cubic-bezier(0.2, 0.9, 0.3, 1), height 0.26s;
        }
        @media (prefers-reduced-motion: reduce) {
          .ad-marker {
            transition: none;
          }
        }
        .ad-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          text-align: left;
          background: none;
          border: none;
          color: var(--a-dim);
          font: inherit;
          font-size: 13.5px;
          padding: 9px 12px;
          border-radius: 9px;
          cursor: pointer;
        }
        .ad-item:hover {
          color: var(--a-text);
          background: var(--a-raise);
        }
        .ad-item.on {
          color: var(--a-text);
          font-weight: 600;
        }
        .ad-item span {
          flex: 1;
        }
        .ad-badge {
          font-style: normal;
          font-size: 10.5px;
          font-weight: 700;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 999px;
          background: var(--a-amber);
          color: #1a1300;
          display: grid;
          place-items: center;
        }
        .ad-foot {
          border-top: 1px solid var(--a-line);
          padding-top: 12px;
          margin-top: 10px;
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        .ad-who {
          font-size: 11.5px;
          color: var(--a-dim);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          padding: 0 10px;
        }
        .ad-signout {
          align-self: flex-start;
          margin: 0 6px;
          background: none;
          border: 1px solid var(--a-line);
          color: var(--a-dim);
          border-radius: 8px;
          padding: 5px 11px;
          font: inherit;
          font-size: 12px;
          cursor: pointer;
        }
        .ad-signout:hover {
          border-color: #ff6b6b;
          color: #ff6b6b;
        }

        /* ---- main ---- */
        .ad-main {
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .ad-top {
          position: sticky;
          top: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
          padding: 18px 20px 14px;
          background: color-mix(in srgb, var(--a-void) 88%, transparent);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid var(--a-line);
        }
        .ad-top h1 {
          color: var(--a-text);
          font-family: "Space Grotesk", sans-serif;
          font-weight: 700;
          font-size: clamp(1.35rem, 3.2vw, 1.85rem);
          letter-spacing: -0.032em;
          margin: 0;
          flex: 1;
          min-width: 0;
        }
        .ad-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .ad-content {
          padding: 0 0 96px;
        }
        @media (min-width: 1000px) {
          .ad-content {
            padding-bottom: 40px;
          }
        }

        /* ---- mobile nav ---- */
        .ad-mobile-bar {
          position: fixed;
          left: 12px;
          right: 12px;
          bottom: 12px;
          bottom: calc(12px + env(safe-area-inset-bottom));
          z-index: 60;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 13px 16px;
          border-radius: 14px;
          border: 1px solid var(--a-line);
          background: var(--a-raise);
          box-shadow: 0 10px 34px rgba(0, 0, 0, 0.55);
          color: var(--a-text);
          font: inherit;
          cursor: pointer;
        }
        @media (min-width: 1000px) {
          .ad-mobile-bar {
            display: none;
          }
        }
        .ad-mobile-now {
          font-family: "Space Grotesk", sans-serif;
          font-weight: 700;
          font-size: 14.5px;
          letter-spacing: -0.02em;
        }
        .ad-mobile-hint {
          margin-left: auto;
          font-size: 11.5px;
          color: var(--a-dim);
        }
        .ad-chev {
          width: 9px;
          height: 9px;
          border-right: 2px solid var(--a-amber);
          border-top: 2px solid var(--a-amber);
          transform: rotate(-45deg);
          margin-bottom: 2px;
        }

        .ad-sheet-wrap {
          position: fixed;
          inset: 0;
          z-index: 90;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
        }
        .ad-scrim {
          position: absolute;
          inset: 0;
          background: rgba(4, 5, 8, 0.72);
          border: none;
          padding: 0;
          cursor: pointer;
        }
        .ad-sheet {
          position: relative;
          background: var(--a-panel);
          border-top: 1px solid var(--a-line);
          border-radius: 20px 20px 0 0;
          padding: 10px 12px calc(14px + env(safe-area-inset-bottom));
          max-height: 88vh;
          display: flex;
          flex-direction: column;
          animation: ad-rise 0.24s cubic-bezier(0.2, 0.9, 0.3, 1);
        }
        @keyframes ad-rise {
          from {
            transform: translateY(14%);
            opacity: 0.4;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .ad-sheet {
            animation: none;
          }
        }
        .ad-sheet-grip {
          width: 38px;
          height: 4px;
          border-radius: 999px;
          background: var(--a-line);
          margin: 4px auto 12px;
        }
        .ad-sheet-list {
          overflow-y: auto;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .ad-sheet-item {
          display: flex;
          align-items: center;
          gap: 8px;
          text-align: left;
          padding: 15px 14px;
          border-radius: 12px;
          border: 1px solid var(--a-line);
          background: var(--a-raise);
          color: var(--a-dim);
          font: inherit;
          font-size: 14px;
          cursor: pointer;
        }
        .ad-sheet-item span {
          flex: 1;
        }
        .ad-sheet-item.on {
          border-color: var(--a-amber);
          color: var(--a-text);
          font-weight: 600;
        }
        .ad-sheet-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          border-top: 1px solid var(--a-line);
          margin-top: 12px;
          padding-top: 12px;
        }

        /* visible keyboard focus everywhere in the admin */
        .ad :focus-visible,
        .ad-sheet :focus-visible {
          outline: 2px solid var(--a-amber);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
