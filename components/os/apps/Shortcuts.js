import React, { useState } from "react";
import { SHORTCUTS, isMac } from "../../../lib/shortcuts";

// Keyboard-shortcuts cheat sheet, as a desktop-OS app. Auto-detects the platform
// and shows those key caps; a segmented control lets you peek at the other set.
export default function Shortcuts() {
  const detectedMac = isMac();
  const [mac, setMac] = useState(detectedMac);
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];

  return (
    <div className="sc">
      <div className="sc-head">
        <div>
          <p className="sc-eyebrow">Keyboard</p>
          <h2 className="sc-title">Shortcuts</h2>
        </div>
        <div className="sc-seg" role="tablist" aria-label="Platform">
          <button className={mac ? "on" : ""} onClick={() => setMac(true)}>macOS</button>
          <button className={!mac ? "on" : ""} onClick={() => setMac(false)}>Windows</button>
        </div>
      </div>

      <p className="sc-note">
        Showing <b>{mac ? "macOS" : "Windows"}</b> keys · detected{" "}
        <b>{detectedMac ? "Mac" : "Windows / Linux"}</b>.
      </p>

      {groups.map((g) => (
        <div key={g} className="sc-group">
          <p className="sc-glabel">{g}</p>
          <div className="sc-list">
            {SHORTCUTS.filter((s) => s.group === g).map((s) => (
              <div key={s.id} className="sc-row">
                <span className="sc-desc">{s.desc}</span>
                <span className="os-kbd">
                  {(mac ? s.mac : s.win).map((k, i) => (
                    <kbd key={i}>{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <style jsx>{`
        .sc {
          min-height: 100%;
          padding: 22px 24px 28px;
          background: var(--c-bg);
          color: var(--c-fg);
          font-family: "Inter", sans-serif;
        }
        .sc-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px;
        }
        .sc-eyebrow {
          font-family: "JetBrains Mono", monospace;
          font-size: 11px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--c-accentText, var(--c-accent));
        }
        .sc-title {
          margin-top: 4px;
          font-family: "Space Grotesk", "Inter", sans-serif;
          font-size: 26px;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .sc-seg {
          display: inline-flex;
          padding: 3px;
          border: 1px solid var(--c-edge);
          border-radius: 10px;
          background: var(--c-surface);
        }
        .sc-seg button {
          border: none;
          background: none;
          cursor: pointer;
          padding: 5px 12px;
          border-radius: 7px;
          font-family: "JetBrains Mono", monospace;
          font-size: 11px;
          color: var(--c-muted);
          transition: all 0.15s;
        }
        .sc-seg button.on {
          background: var(--c-accent);
          color: var(--c-accentFg, #0a0b0f);
          font-weight: 700;
        }
        .sc-note {
          margin-top: 10px;
          font-family: "JetBrains Mono", monospace;
          font-size: 11.5px;
          color: var(--c-muted);
        }
        .sc-note b { color: var(--c-fg); font-weight: 600; }
        .sc-group { margin-top: 22px; }
        .sc-glabel {
          font-family: "JetBrains Mono", monospace;
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--c-muted);
          padding-bottom: 8px;
          border-bottom: 1px solid var(--c-edge);
        }
        .sc-list { margin-top: 6px; }
        .sc-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 11px 2px;
          border-bottom: 1px solid var(--c-edge);
        }
        .sc-row:last-child { border-bottom: none; }
        .sc-desc { font-size: 13.5px; color: var(--c-fg); }
      `}</style>
    </div>
  );
}
