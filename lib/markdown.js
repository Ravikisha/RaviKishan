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

// Inline and display maths. The source is carried in the element's TEXT, not
// an attribute: the HTML parser hands it back decoded, there is no length or
// quoting limit, and with JavaScript off a reader still sees the TeX rather
// than an empty box.
//
// The tokenizer deliberately refuses `$ x $` and `$5 and $10` — a lone dollar
// in prose is money far more often than it is maths, so a delimiter must hug
// its content on both sides.
const mathExtension = {
  name: "math",
  level: "inline",
  start(src) {
    const i = src.indexOf("$");
    return i === -1 ? undefined : i;
  },
  tokenizer(src) {
    const display = /^\$\$([^\n][\s\S]*?)\$\$/.exec(src);
    if (display) {
      return { type: "math", raw: display[0], text: display[1].trim(), display: true };
    }
    // Single $: no space after the opener, no space before the closer, and no
    // newline in between.
    const inline = /^\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?!\d)/.exec(src);
    if (inline) {
      return { type: "math", raw: inline[0], text: inline[1].trim(), display: false };
    }
    return undefined;
  },
  renderer(token) {
    return `<span class="pb-math" data-display="${token.display ? "1" : "0"}">${escapeHtml(
      token.text
    )}</span>`;
  },
};

marked.use({ extensions: [mathExtension] });

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
