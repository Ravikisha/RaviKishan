// Turning a post into something another platform can render.
//
// This site renders maths, mermaid diagrams and running p5/d3 sketches.
// dev.to renders exactly one of those: it has a native KaTeX liquid tag, and
// no diagram support, no raw HTML and no JavaScript at all. (Checked against
// its editor guide, not assumed.)
//
// So each block is handled on its merits:
//
//   maths    -> {% katex %} / {% katex inline %}. Lossless, no files, free.
//   mermaid  -> an image we rendered and host, plus a line back to the live one.
//   p5 / d3  -> a still frame we host, plus a line back to the interactive one.
//
// Nothing is rendered or stored unless a cross-post actually happens. A post
// that never leaves this site never produces a single file.
//
// This module is PURE — it decides what the portable Markdown should say, and
// is handed the asset URLs by whoever did the rendering. It lives in
// lib/server only because that is the one folder marked ESM, so node can
// import it and unit-test it; the browser imports it too.

export const PORTABLE_KINDS = ["mermaid", "p5", "d3"];

// Stable, short, and dependency-free. The id has to survive a reload and a
// different machine so a second cross-post reuses the image it already made
// instead of uploading another copy.
export function blockId(kind, code) {
  const s = `${kind}\n${String(code).trim()}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  return `${kind}-${h1.toString(36)}${h2.toString(36)}`.slice(0, 28);
}

// Every fenced block that cannot travel as text. Returned in document order,
// with the exact source so a renderer can reproduce it.
export function listPortableBlocks(markdown) {
  const out = [];
  const re = /^```([ \t]*[A-Za-z0-9_+-]+[^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;
  for (const m of String(markdown || "").matchAll(re)) {
    const info = m[1].trim();
    const kind = info.split(/\s+/)[0].toLowerCase();
    if (!PORTABLE_KINDS.includes(kind)) continue;
    const code = m[2].replace(/\s+$/, "");
    out.push({
      kind,
      code,
      info,
      id: blockId(kind, code),
      height: Number((/\bheight=(\d{2,4})\b/.exec(info) || [])[1]) || null,
    });
  }
  return out;
}

const CAPTION = {
  mermaid: "Diagram from",
  p5: "A frame from the interactive sketch in",
  d3: "Chart from",
};

/* ---------- maths ---------- */

// Same delimiter rules as lib/markdown.js, so what travels is what the reader
// saw here: a dollar must hug its content, which keeps "$5 and $10" as money.
function convertMath(src) {
  let out = String(src || "");

  // Display first — otherwise the inline rule eats the opening of a $$ block.
  out = out.replace(/\$\$([^\n][\s\S]*?)\$\$/g, (_m, tex) => `{% katex %}${tex.trim()}{% endkatex %}`);
  out = out.replace(
    /\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?!\d)/g,
    (_m, tex) => `{% katex inline %}${tex.trim()}{% endkatex %}`
  );
  return out;
}

// Code fences are the one place a `$` is certainly not maths, so maths is
// converted around them rather than inside them.
function mapOutsideFences(src, fn) {
  const parts = String(src || "").split(/(^```[\s\S]*?^```[ \t]*$)/gm);
  return parts.map((part) => (part.startsWith("```") ? part : fn(part))).join("");
}

/* ---------- the whole post ---------- */

// `assets` maps a block id to a hosted URL. A block with no asset still
// travels — as the line pointing at the live version — because half a diagram
// is worse than an honest sentence.
export function toPortableMarkdown(markdown, { assets = {}, canonicalUrl = "" } = {}) {
  const src = String(markdown || "");
  const missing = [];
  const used = [];

  const re = /^```([ \t]*[A-Za-z0-9_+-]+[^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;
  let out = src.replace(re, (whole, info, code) => {
    const kind = info.trim().split(/\s+/)[0].toLowerCase();
    if (!PORTABLE_KINDS.includes(kind)) return whole;

    const id = blockId(kind, code.replace(/\s+$/, ""));
    // An asset is either a URL, or { image, video } when the block animates.
    const asset = assets[id];
    const image = typeof asset === "string" ? asset : asset?.image;
    const video = typeof asset === "string" ? null : asset?.video;
    const where = canonicalUrl ? `[the original](${canonicalUrl})` : "the original";

    if (!image) {
      missing.push({ kind, id });
      return `> ${CAPTION[kind]} ${where} — it does not render here.`;
    }
    used.push({ kind, id, url: image, video: video || undefined });

    const alt = `${kind} ${kind === "mermaid" ? "diagram" : "visualisation"}`;
    // dev.to cannot embed a video file, so the still is what renders inline
    // and the recording is offered as a link next to it.
    const caption = video
      ? `*${CAPTION[kind]} ${where} — [watch it run](${video}).*`
      : `*${CAPTION[kind]} ${where}.*`;
    return `![${alt}](${image})\n\n${caption}`;
  });

  out = mapOutsideFences(out, convertMath);
  return { markdown: out, missing, used };
}
