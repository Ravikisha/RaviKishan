import React from "react";

// Reusable macOS-style window title bar with FUNCTIONAL traffic lights:
// red = close, yellow = minimize, green = full screen. Icons appear on hover.
const ICON = {
  close: "M3.4 3.4l5.2 5.2M8.6 3.4l-5.2 5.2",
  min: "M3.2 6h5.6",
  full: "M3 5V3h2M9 7v2H7M7 3h2v2M5 9H3V7",
};

const Dot = ({ color, kind, onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className="grid h-3 w-3 place-items-center rounded-full"
    style={{ background: color }}
  >
    <svg
      viewBox="0 0 12 12"
      className="h-2 w-2 opacity-0 transition-opacity group-hover:opacity-100"
      fill="none"
      stroke="rgba(0,0,0,0.55)"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICON[kind]} />
    </svg>
  </button>
);

export default function MacBar({ title, right, onClose, onMin, onFull, dark = true, onBarDoubleClick }) {
  return (
    <div
      onDoubleClick={onBarDoubleClick}
      className={`flex items-center gap-3 border-b px-4 py-2.5 ${
        dark ? "border-white/10" : "border-edge"
      }`}
    >
      <span className="group flex items-center gap-2">
        <Dot color="#ff5f57" kind="close" onClick={onClose} label="Close" />
        <Dot color="#febc2e" kind="min" onClick={onMin} label="Minimize" />
        <Dot color="#28c840" kind="full" onClick={onFull} label="Full screen" />
      </span>
      {title && (
        <span className={`truncate font-mono text-[11px] ${dark ? "text-white/50" : "text-muted"}`}>
          {title}
        </span>
      )}
      {right && <span className="ml-auto flex items-center gap-2">{right}</span>}
    </div>
  );
}
