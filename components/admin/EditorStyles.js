// Chrome for the Markdown editor: the Write / Preview / Side-by-side tabs,
// the pane grid, and the cover-image row.
//
// Shared between PostsPanel and the design preview for the same reason
// PostBodyStyles is shared — a preview that does not look like the real thing
// is worse than none.
//
// The important bit is the token remap on `.po-preview`. The article
// stylesheet is written against the SITE's semantic tokens (--c-fg,
// --c-surface, --c-edge…), which resolve to LIGHT-theme values unless
// `html.dark` is set. The admin is always dark and is not `html.dark`, so
// without this remap the preview renders dark text on a dark background and
// white code chips on white — which is exactly what happened.
import React from "react";

export default function EditorStyles() {
  return (
    <style jsx global>{`
      .po-img {
        cursor: pointer;
        white-space: nowrap;
      }
      .po-img input[type="file"] {
        display: none;
      }

      .po-cover {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .po-cover .admin-input {
        flex: 1;
        min-width: 0;
      }
      .po-cover-thumb {
        max-height: 150px;
        width: auto;
        border-radius: 10px;
        border: 1px solid var(--a-line, #262a35);
        object-fit: cover;
      }

      .po-editor {
        border: 1px solid var(--a-line, #262a35);
        border-radius: 12px;
        overflow: hidden;
        background: var(--a-panel, #0f1117);
      }
      .po-tabs {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 7px 8px;
        border-bottom: 1px solid var(--a-line, #262a35);
        flex-wrap: wrap;
      }
      .po-tabs button {
        background: none;
        border: none;
        color: var(--a-dim, #8b90a0);
        font: inherit;
        font-size: 12.5px;
        padding: 6px 12px;
        border-radius: 8px;
        cursor: pointer;
      }
      .po-tabs button:hover {
        color: var(--a-text, #e7e8ee);
      }
      .po-tabs button.on {
        background: var(--a-amber, #ffb020);
        color: #1a1300;
        font-weight: 600;
      }
      .po-tabs-img {
        margin-left: auto;
      }

      .po-panes {
        display: grid;
        min-height: 320px;
      }
      .po-panes.split {
        grid-template-columns: 1fr 1fr;
      }
      @media (max-width: 860px) {
        .po-panes.split {
          grid-template-columns: 1fr;
        }
      }
      .po-panes .po-body {
        border: none;
        border-radius: 0;
        resize: vertical;
        min-height: 320px;
      }
      .po-panes.split .po-body {
        border-right: 1px solid var(--a-line, #262a35);
      }

      .po-preview {
        padding: 20px 22px;
        overflow-y: auto;
        max-height: 70vh;
        font-size: 15px;

        /* Re-point the site's semantic tokens at the admin's dark palette so
           the shared article stylesheet renders correctly here. */
        --c-fg: var(--a-text, #e9ebf2);
        --c-muted: var(--a-dim, #7d8496);
        --c-bg: var(--a-void, #08090d);
        --c-surface: var(--a-raise, #171a22);
        --c-edge: var(--a-line, #1e222c);
        --c-accent: var(--a-amber, #ffb020);
        --c-accent-text: var(--a-amber, #ffb020);
        --c-accent-fg: #1a1300;
        color: var(--c-fg);
      }
      /* globals.scss pins h1-h4 to a fixed light colour and wins on
         specificity, so the preview's headings need pinning back. */
      .po-preview h1,
      .po-preview h2,
      .po-preview h3,
      .po-preview h4 {
        color: var(--a-text, #e9ebf2);
      }
      .po-preview img {
        max-width: 100%;
      }
      .po-preview pre {
        width: 100% !important;
      }
      .po-preview-empty {
        color: var(--a-dim, #8b90a0);
        font-style: italic;
      }
    `}</style>
  );
}
