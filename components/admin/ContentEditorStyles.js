// Styles for the content editor.
//
// Kept beside the component but in its own file so the design preview can
// render it without pulling the whole admin page in.
//
// The one bold gesture: an expanded row grows a full-height amber edge — the
// same highlighter language the blog's contents rail uses, so the two surfaces
// read as one system rather than two products.
import React from "react";

export default function ContentEditorStyles() {
  return (
    <style jsx global>{`
      /* ---------- section ---------- */
      .ce-section {
        border: 1px solid var(--a-line, #1e222c);
        border-radius: 14px;
        background: var(--a-panel, #111319);
        overflow: hidden;
      }
      .ce-head {
        display: flex;
        align-items: center;
        gap: 11px;
        width: 100%;
        padding: 14px 16px;
        background: none;
        border: none;
        color: var(--a-text, #e9ebf2);
        text-align: left;
        cursor: pointer;
        font: inherit;
      }
      .ce-head:hover {
        background: var(--a-raise, #171a22);
      }
      .ce-head-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1;
      }
      .ce-head-title {
        font-family: "Space Grotesk", sans-serif;
        font-weight: 700;
        font-size: 15px;
        letter-spacing: -0.015em;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .ce-head-title i {
        font-style: normal;
        font-size: 11px;
        font-weight: 700;
        color: var(--a-dim, #7d8496);
        background: var(--a-void, #08090d);
        border: 1px solid var(--a-line, #1e222c);
        border-radius: 999px;
        padding: 1px 8px;
      }
      .ce-head-sub {
        font-size: 12px;
        color: var(--a-dim, #7d8496);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ce-body {
        padding: 4px 16px 16px;
      }

      /* ---------- caret ---------- */
      .ce-caret {
        flex-shrink: 0;
        width: 7px;
        height: 7px;
        border-right: 2px solid var(--a-dim, #7d8496);
        border-bottom: 2px solid var(--a-dim, #7d8496);
        transform: rotate(-45deg);
        transition: transform 0.18s ease;
        margin-left: 2px;
      }
      .ce-caret.on {
        transform: rotate(45deg);
        border-color: var(--a-amber, #ffb020);
      }
      @media (prefers-reduced-motion: reduce) {
        .ce-caret {
          transition: none;
        }
      }

      /* ---------- array ---------- */
      .ce-array-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 10px 0 8px;
      }
      .ce-array-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--a-text, #e9ebf2);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .ce-array-label i {
        font-style: normal;
        font-size: 11px;
        color: var(--a-dim, #7d8496);
      }
      .ce-empty {
        color: var(--a-dim, #7d8496);
        font-size: 13px;
        padding: 10px 2px;
        margin: 0;
      }
      .ce-rows {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      /* ---------- row ---------- */
      .ce-row {
        border: 1px solid var(--a-line, #1e222c);
        border-radius: 11px;
        background: var(--a-void, #0b0d12);
        overflow: hidden;
        position: relative;
      }
      .ce-row.open {
        border-color: #2a2f3c;
      }
      /* the one bold gesture */
      .ce-row.open::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: var(--a-amber, #ffb020);
      }
      .ce-row-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 10px 7px 8px;
      }
      .ce-row-main {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
        background: none;
        border: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        padding: 2px;
      }
      .ce-thumb {
        flex-shrink: 0;
        width: 34px;
        height: 34px;
        border-radius: 8px;
        object-fit: cover;
        border: 1px solid var(--a-line, #1e222c);
        background: var(--a-panel, #111319);
      }
      .ce-thumb-none {
        display: block;
        border-style: dashed;
      }
      .ce-row-text {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
      }
      .ce-row-title {
        font-size: 13.5px;
        font-weight: 500;
        color: var(--a-text, #e9ebf2);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ce-row-sub {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ce-row-btns {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
      }
      .ce-row-btns button {
        width: 26px;
        height: 26px;
        border-radius: 7px;
        border: 1px solid var(--a-line, #1e222c);
        background: none;
        color: var(--a-dim, #7d8496);
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
      }
      .ce-row-btns button:hover:not(:disabled) {
        color: var(--a-text, #e9ebf2);
        border-color: #3a3f4d;
      }
      .ce-row-btns button:disabled {
        opacity: 0.32;
        cursor: default;
      }
      .ce-row-btns .admin-del:hover {
        border-color: #ff6b6b;
        color: #ff6b6b;
      }
      .ce-row-body {
        padding: 4px 12px 14px 14px;
        border-top: 1px solid var(--a-line, #1e222c);
      }

      /* ---------- fields ---------- */
      .ce-fields {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        padding-top: 12px;
      }
      @media (max-width: 820px) {
        .ce-fields {
          grid-template-columns: 1fr;
        }
      }
      .ce-field {
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
      }
      .ce-field.wide {
        grid-column: 1 / -1;
      }
      .ce-label {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
        font-weight: 500;
      }
      /* The shared textarea rule sets a monospace face, which is right for a
         Markdown body and wrong for a project description. */
      textarea.admin-input.ce-area {
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        font-size: 13.5px;
        line-height: 1.6;
        resize: vertical;
      }
      .ce-nested {
        border-left: 2px solid var(--a-line, #1e222c);
        padding-left: 12px;
      }

      /* ---------- chips ---------- */
      .ce-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        padding: 7px 8px;
        border: 1px solid var(--a-line, #1e222c);
        border-radius: 10px;
        background: var(--a-void, #08090d);
        min-height: 42px;
      }
      .ce-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px 4px 10px;
        border-radius: 999px;
        background: var(--a-raise, #171a22);
        border: 1px solid var(--a-line, #1e222c);
        font-size: 12.5px;
        color: var(--a-text, #e9ebf2);
      }
      .ce-chip button {
        background: none;
        border: none;
        color: var(--a-dim, #7d8496);
        cursor: pointer;
        font-size: 10px;
        line-height: 1;
        padding: 3px;
        border-radius: 50%;
      }
      .ce-chip button:hover {
        color: #ff6b6b;
      }
      .ce-chip-add {
        flex: 1;
        min-width: 90px;
        background: none;
        border: none;
        outline: none;
        color: var(--a-text, #e9ebf2);
        font: inherit;
        font-size: 13px;
        padding: 4px 2px;
      }
      .ce-chip-add::placeholder {
        color: #4d5464;
      }

      /* ---------- toggle ---------- */
      .ce-toggle {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        align-self: flex-start;
        padding: 7px 13px 7px 7px;
        border-radius: 999px;
        border: 1px solid var(--a-line, #1e222c);
        background: var(--a-void, #08090d);
        color: var(--a-dim, #7d8496);
        font: inherit;
        font-size: 12.5px;
        cursor: pointer;
      }
      .ce-knob {
        width: 15px;
        height: 15px;
        border-radius: 50%;
        background: #3a3f4d;
        transition: background 0.16s;
      }
      .ce-toggle.on {
        color: var(--a-text, #e9ebf2);
        border-color: var(--a-amber, #ffb020);
      }
      .ce-toggle.on .ce-knob {
        background: var(--a-amber, #ffb020);
      }
      @media (prefers-reduced-motion: reduce) {
        .ce-knob {
          transition: none;
        }
      }
    `}</style>
  );
}
