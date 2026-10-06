import { marked } from "marked";
import hljs from "highlight.js/lib/common";

const aliases = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
  py: "python",
};

const languageName = (value) => {
  const raw = String(value || "").trim().split(/\s+/)[0].toLowerCase();
  return (aliases[raw] || raw).replace(/[^a-z0-9_+-]/g, "");
};

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Maths, in the forms people actually write it.
//
// There are two extensions because there are two problems.
//
// BLOCK first, and this is the important one. Display maths is normally
// written with the delimiters on their own lines:
//
//     $$
//     E = mc^2
//     $$
//
// An inline-level tokenizer never sees that as maths — by the time the inline
// lexer runs, the paragraph text begins with "$$\n", and more damagingly
// markdown has already processed escapes, so the `\\` that ends a line inside
// an `aligned` block has become a single backslash and the alignment is gone.
// A block tokenizer gets the RAW source, before any of that.
//
// It also covers the delimiters LaTeX users reach for out of habit — \[ … \]
// and a bare \begin{align} … \end{align} — which markdown otherwise renders as
// literal text with the backslashes stripped.
const DISPLAY_ENVS =
  "align|align\\*|aligned|alignat|alignat\\*|equation|equation\\*|gather|gather\\*|" +
  "gathered|multline|multline\\*|split|cases|array|matrix|pmatrix|bmatrix|vmatrix|" +
  "Vmatrix|Bmatrix|smallmatrix|CD";

const mathBlock = {
  name: "mathBlock",
  level: "block",
  start(src) {
    const m = /(?:^|\n)(?:\$\$|\\\[|\\begin\{)/.exec(src);
    return m ? m.index : undefined;
  },
  tokenizer(src) {
    // $$ … $$  (the delimiters may sit on their own lines)
    let m = /^\$\$[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*\$\$[ \t]*(?:\n+|$)/.exec(src);
    if (m) return { type: "mathBlock", raw: m[0], text: m[1].trim() };

    // \[ … \]
    m = /^\\\[[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*\\\][ \t]*(?:\n+|$)/.exec(src);
    if (m) return { type: "mathBlock", raw: m[0], text: m[1].trim() };

    // A bare \begin{align} … \end{align}. KaTeX wants the environment itself,
    // so the whole match is the maths — not just what is inside it.
    m = new RegExp(
      `^(\\\\begin\\{(${DISPLAY_ENVS})\\}[\\s\\S]*?\\\\end\\{\\2\\})[ \\t]*(?:\\n+|$)`
    ).exec(src);
    if (m) return { type: "mathBlock", raw: m[0], text: m[1].trim() };

    return undefined;
  },
  renderer(token) {
    return `<span class="pb-math" data-display="1">${escapeHtml(token.text)}</span>\n`;
  },
};

// INLINE: $x$ and \(x\).
//
// The tokenizer deliberately refuses `$ x $` and `$5 and $10` — a lone dollar
// in prose is money far more often than it is maths, so a delimiter must hug
// its content on both sides.
const mathInline = {
  name: "mathInline",
  level: "inline",
  start(src) {
    const m = /\$|\\\(/.exec(src);
    return m ? m.index : undefined;
  },
  tokenizer(src) {
    // \( … \)
    let m = /^\\\(([\s\S]+?)\\\)/.exec(src);
    if (m) return { type: "mathInline", raw: m[0], text: m[1].trim(), display: false };

    // $$ … $$ left on one line, inside a paragraph.
    m = /^\$\$([^\n]+?)\$\$/.exec(src);
    if (m) return { type: "mathInline", raw: m[0], text: m[1].trim(), display: true };

    // $ … $: no space after the opener, none before the closer, no newline.
    m = /^\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?!\d)/.exec(src);
    if (m) return { type: "mathInline", raw: m[0], text: m[1].trim(), display: false };

    return undefined;
  },
  renderer(token) {
    return `<span class="pb-math" data-display="${token.display ? "1" : "0"}">${escapeHtml(
      token.text
    )}</span>`;
  },
};

marked.use({ extensions: [mathBlock, mathInline] });

// Fenced blocks that are not code to read but something to RUN or DRAW.
// Each renders as its source, visibly, and lib/postEnhance.js upgrades it in
// the browser. Nothing here executes anything.
const BLOCK_LANGS = {
  mermaid: "pb-mermaid",
  p5: "pb-sketch",
  d3: "pb-sketch",
};

const renderer = new marked.Renderer();
renderer.code = ({ text, lang, escaped }) => {
  const language = languageName(lang);

  const special = BLOCK_LANGS[language];
  if (special) {
    // The source sits in the text content for the same reasons as the maths
    // above, and `hidden` keeps it out of the reading flow until the enhancer
    // has had its turn. If the enhancer never runs, revealing it is one CSS
    // rule away rather than a blank space in the article.
    // ```p5 height=260  — the fence's info string can size the frame.
    const h = /\bheight=(\d{2,4})\b/.exec(String(lang || ""));
    const attrs = h ? ` data-height="${h[1]}"` : "";
    return (
      `<div class="${special}" data-kind="${language}"${attrs}>` +
      `<pre class="pb-src">${escapeHtml(text)}</pre>` +
      `</div>\n`
    );
  }

  const className = language ? ` class="language-${language}"` : "";
  let output = escaped ? text : escapeHtml(text);

  if (language && hljs.getLanguage(language)) {
    output = hljs.highlight(text, { language }).value;
  }

  return `<pre><code${className}>${output}\n</code></pre>\n`;
};

// A post body must not contain its own <h1>: the page already has one, the
// article title. Articles imported from dev.to routinely open at "# Overview"
// because over there the title is chrome, not content — which gave this page
// two competing h1s, a heading styled by globals.scss (pinned to a fixed
// light-theme colour, so invisible in dark mode) and a contents rail that
// found nothing to list, because it only ever looked for h2/h3.
//
// So: when a body uses a top-level heading at all, shift the WHOLE document
// down one level. Shifting everything rather than just the h1s is what keeps
// the hierarchy — a piece written as h1/h2 stays two distinct levels.
const shiftFor = (value) => (/^#\s/m.test(String(value || "")) ? 1 : 0);

export const renderMarkdown = (value, options = {}) => {
  const shift = shiftFor(value);
  const perDoc = new marked.Renderer();
  perDoc.code = renderer.code;
  perDoc.heading = function heading({ tokens, depth }) {
    const level = Math.min(6, depth + shift);
    return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>
`;
  };
  return marked.parse(value, { ...options, renderer: perDoc });
};
