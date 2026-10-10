// Which view of the workbench you are in.
//
// On a desk it is a row at the top: the five workbench views, a hairline, then
// the older agent views. On a phone there is room for one view at a time, so
// the row becomes a bar at the bottom — above the admin's own section bar —
// with the five views you use while something is running, and More for the
// rest. A view hidden under More that is open shows its own name on the More
// button, so the bar never claims you are nowhere.
//
// A badge is a count of something that wants you, never decoration.
import React, { useEffect, useRef, useState } from "react";

export const PRIMARY = [
  ["chat", "Chat"],
  ["desktop", "Desktop"],
  ["terminal", "Terminal"],
  ["previews", "Previews"],
  ["review", "Review"],
];
export const SECONDARY = [
  ["runs", "Runs"],
  ["accounts", "Accounts"],
  ["features", "Features"],
  ["whatsapp", "WhatsApp"],
];

function Item({ k, label, view, badge, onView, extra = "" }) {
  const b = badge?.[k];
  return (
    <button
      type="button"
      role="tab"
      aria-selected={view === k}
      className={`wb-sw${view === k ? " on" : ""}${extra}`}
      onClick={() => onView(k)}
      data-view={k}
    >
      <span>{label}</span>
      {b ? <em className={b.tone ? `t-${b.tone}` : ""}>{b.text}</em> : null}
    </button>
  );
}

export default function WorkbenchSwitcher({ view, onView, badges = {} }) {
  const [more, setMore] = useState(false);
  const box = useRef(null);
  const sec = SECONDARY.find(([k]) => k === view);

  useEffect(() => {
    if (!more) return undefined;
    const close = (e) => {
      if (e.key === "Escape" || (e.type === "pointerdown" && !box.current?.contains(e.target))) setMore(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [more]);

  const moreBadge = SECONDARY.map(([k]) => badges[k]).find(Boolean);

  return (
    <nav className="wb-switch" aria-label="Workbench views" ref={box}>
      <div className="wb-switch-in" role="tablist">
        {PRIMARY.map(([k, label]) => (
          <Item key={k} k={k} label={label} view={view} badge={badges} onView={onView} />
        ))}
        <span className="wb-sw-rule" aria-hidden="true" />
        {SECONDARY.map(([k, label]) => (
          <Item key={k} k={k} label={label} view={view} badge={badges} onView={onView} extra=" wb-sw-sec" />
        ))}
        <button
          type="button"
          className={`wb-sw wb-sw-more${sec ? " on" : ""}`}
          aria-expanded={more}
          aria-haspopup="true"
          onClick={() => setMore((m) => !m)}
        >
          <span>{sec ? sec[1] : "More"}</span>
          {!sec && moreBadge ? <em className={moreBadge.tone ? `t-${moreBadge.tone}` : ""}>{moreBadge.text}</em> : null}
        </button>
      </div>
      {more ? (
        <div className="wb-more-sheet" role="menu">
          {SECONDARY.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="menuitem"
              className={view === k ? "on" : ""}
              onClick={() => {
                onView(k);
                setMore(false);
              }}
            >
              {label}
              {badges[k] ? <em className={badges[k].tone ? `t-${badges[k].tone}` : ""}>{badges[k].text}</em> : null}
            </button>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
