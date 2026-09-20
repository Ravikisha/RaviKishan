// Formatting controls for the Markdown editor.
//
// Every action works on the CURRENT SELECTION and restores it afterwards, so
// the cursor never jumps to the end of the document — which is the thing that
// makes most in-page markdown toolbars annoying enough to stop using.
//
// Wrapping is a toggle: pressing bold on already-bold text unwraps it, the
// same as every editor people already know.
import React from "react";

// label, title, the markers, and whether it acts on whole lines
const ACTIONS = [
  { id: "bold", label: "B", title: "Bold  (Ctrl+B)", wrap: "**", style: { fontWeight: 800 } },
  { id: "italic", label: "I", title: "Italic  (Ctrl+I)", wrap: "_", style: { fontStyle: "italic" } },
  { id: "code", label: "`", title: "Inline code", wrap: "`" },
  { id: "strike", label: "S", title: "Strikethrough", wrap: "~~", style: { textDecoration: "line-through" } },
  { sep: true },
  { id: "h2", label: "H2", title: "Heading", line: "## " },
  { id: "h3", label: "H3", title: "Subheading", line: "### " },
  { id: "quote", label: "❝", title: "Quote", line: "> " },
  { id: "ul", label: "•", title: "Bullet list", line: "- " },
  { id: "ol", label: "1.", title: "Numbered list", line: "1. " },
  { sep: true },
  { id: "link", label: "Link", title: "Link  (Ctrl+K)" },
  { id: "block", label: "Code", title: "Code block" },
  { id: "rule", label: "—", title: "Divider" },
];

export default function MarkdownToolbar({ textareaRef, value, onChange, children }) {
  const apply = (action) => {
    const ta = textareaRef?.current;
    if (!ta) return;

    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = value.slice(start, end);
    let next = value;
    let caret = [start, end];

    if (action.wrap) {
      const w = action.wrap;
      const already =
        value.slice(Math.max(0, start - w.length), start) === w &&
        value.slice(end, end + w.length) === w;
      if (already) {
        // toggle off
        next = value.slice(0, start - w.length) + selected + value.slice(end + w.length);
        caret = [start - w.length, end - w.length];
      } else {
        next = value.slice(0, start) + w + selected + w + value.slice(end);
        caret = [start + w.length, end + w.length];
      }
    } else if (action.line) {
      // Prefix every line the selection touches, so it works on one line or
      // on a whole list.
      const from = value.lastIndexOf("\n", start - 1) + 1;
      const toRaw = value.indexOf("\n", end);
      const to = toRaw === -1 ? value.length : toRaw;
      const block = value.slice(from, to);
      const lines = block.split("\n");
      const allPrefixed = lines.every((l) => l.startsWith(action.line));
      const out = lines
        .map((l, i) => {
          if (allPrefixed) return l.slice(action.line.length);
          const p = action.id === "ol" ? `${i + 1}. ` : action.line;
          return p + l;
        })
        .join("\n");
      next = value.slice(0, from) + out + value.slice(to);
      const delta = out.length - block.length;
      caret = [start + (allPrefixed ? -action.line.length : action.line.length), end + delta];
    } else if (action.id === "link") {
      const text = selected || "link text";
      const snippet = `[${text}](https://)`;
      next = value.slice(0, start) + snippet + value.slice(end);
      // land the cursor inside the URL, which is what you type next
      caret = [start + text.length + 3, start + snippet.length - 1];
    } else if (action.id === "block") {
      const body = selected || "code";
      const nl = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
      const snippet = `${nl}\`\`\`\n${body}\n\`\`\`\n`;
      next = value.slice(0, start) + snippet + value.slice(end);
      caret = [start + nl.length + 3, start + nl.length + 3];
    } else if (action.id === "rule") {
      const nl = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
      const snippet = `${nl}\n---\n\n`;
      next = value.slice(0, start) + snippet + value.slice(end);
      caret = [start + snippet.length, start + snippet.length];
    }

    onChange(next);
    // Restore the selection after React has written the new value.
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret[0], caret[1]);
    });
  };

  // The three shortcuts people actually have in muscle memory.
  const onKeyDown = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    const hit = k === "b" ? "bold" : k === "i" ? "italic" : k === "k" ? "link" : null;
    if (!hit) return;
    e.preventDefault();
    apply(ACTIONS.find((a) => a.id === hit));
  };

  return (
    <div className="mdt" onKeyDown={onKeyDown}>
      {ACTIONS.map((a, i) =>
        a.sep ? (
          <span key={`s${i}`} className="mdt-sep" aria-hidden="true" />
        ) : (
          <button
            key={a.id}
            type="button"
            className="mdt-btn"
            title={a.title}
            aria-label={a.title}
            style={a.style}
            onMouseDown={(e) => e.preventDefault()} // keep the selection
            onClick={() => apply(a)}
          >
            {a.label}
          </button>
        )
      )}
      {children}

      <style jsx global>{`
        .mdt {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-wrap: wrap;
          padding: 6px 8px;
          border-bottom: 1px solid var(--a-line, #1e222c);
        }
        .mdt-btn {
          min-width: 30px;
          height: 28px;
          padding: 0 8px;
          border: none;
          border-radius: 7px;
          background: none;
          color: var(--a-dim, #7d8496);
          font: inherit;
          font-size: 12.5px;
          line-height: 1;
          cursor: pointer;
        }
        .mdt-btn:hover {
          background: var(--a-raise, #171a22);
          color: var(--a-text, #e9ebf2);
        }
        .mdt-sep {
          width: 1px;
          height: 17px;
          background: var(--a-line, #1e222c);
          margin: 0 5px;
        }
      `}</style>
    </div>
  );
}

// Exported so the editor can show a word / reading-time readout without
// duplicating the maths.
export const countWords = (s) => String(s || "").split(/\s+/).filter(Boolean).length;
