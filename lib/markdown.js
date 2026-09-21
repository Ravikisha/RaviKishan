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

const renderer = new marked.Renderer();
renderer.code = ({ text, lang, escaped }) => {
  const language = languageName(lang);
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
