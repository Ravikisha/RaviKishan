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

export const renderMarkdown = (value, options = {}) =>
  marked.parse(value, { ...options, renderer });
