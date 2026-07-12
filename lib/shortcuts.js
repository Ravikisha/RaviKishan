import React from "react";

// Single source of truth for the desktop-OS keyboard shortcuts. Each entry lists
// the key caps per platform; the UI + the DesktopOS handler both read from here.
// Combos are chosen to avoid browser/OS-reserved ones (no ⌘W/Ctrl+W tab-close,
// no ⌘M system-minimize, no Ctrl+J downloads).
export const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");

export const SHORTCUTS = [
  { id: "search",     group: "Navigation", desc: "Search & open apps",        mac: ["⌘", "K"],       win: ["Ctrl", "K"] },
  { id: "shortcuts",  group: "Navigation", desc: "Show keyboard shortcuts",   mac: ["⌘", "/"],       win: ["Ctrl", "/"] },
  { id: "terminal",   group: "Navigation", desc: "Open Terminal",             mac: ["⌘", "⌥", "T"],  win: ["Ctrl", "Alt", "T"] },
  { id: "console",    group: "Navigation", desc: "Toggle command console",    mac: ["`"],            win: ["`"] },
  { id: "fullscreen", group: "Windows",    desc: "Full-screen focused window", mac: ["⌘", "↩"],      win: ["Ctrl", "Enter"] },
  { id: "snapLeft",   group: "Windows",    desc: "Snap window to left half",  mac: ["⌘", "⌥", "←"],  win: ["Ctrl", "Alt", "←"] },
  { id: "snapRight",  group: "Windows",    desc: "Snap window to right half", mac: ["⌘", "⌥", "→"],  win: ["Ctrl", "Alt", "→"] },
  { id: "maximize",   group: "Windows",    desc: "Tile window to fill",       mac: ["⌘", "⌥", "↑"],  win: ["Ctrl", "Alt", "↑"] },
  { id: "center",     group: "Windows",    desc: "Center / restore window",   mac: ["⌘", "⌥", "↓"],  win: ["Ctrl", "Alt", "↓"] },
  { id: "minimize",   group: "Windows",    desc: "Minimize focused window",   mac: ["⌘", "⌥", "M"],  win: ["Ctrl", "Alt", "M"] },
  { id: "close",      group: "Windows",    desc: "Close focused window",      mac: ["⌘", "⌫"],       win: ["Ctrl", "Backspace"] },
  { id: "cycle",      group: "Windows",    desc: "Cycle windows",             mac: ["⌘", "→"],       win: ["Ctrl", "→"] },
  { id: "recruiter",  group: "Modes",      desc: "Toggle recruiter / dev mode", mac: ["⌘", "⇧", "R"], win: ["Ctrl", "Shift", "R"] },
  { id: "escape",     group: "Modes",      desc: "Close menu · exit full-screen", mac: ["Esc"],      win: ["Esc"] },
];

export const shortcutById = (id) => SHORTCUTS.find((s) => s.id === id);

// key caps for the CURRENT platform
export const keysFor = (s) => (isMac() ? s.mac : s.win);

// Shared keycap renderer (relies on the global `.os-kbd` styles in DesktopOS).
export function Kbd({ keys = [] }) {
  return (
    <span className="os-kbd">
      {keys.map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  );
}
