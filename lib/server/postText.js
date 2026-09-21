// Pure text helpers for posts. NO server dependencies — despite living in
// lib/server, this one is safe to import from client code, and lib/posts.js
// does exactly that. It sits here because lib/server is the only folder marked
// ESM, so plain node can import it without a module-type warning; that matters
// because the MCP tool registry imports it and the registry is unit-tested.
//
// It exists because these four functions had drifted into two copies. The MCP
// create_post grew its own excerpt generator that did not strip fenced code or
// images, so a post opening with a code block published an excerpt of mangled
// code while the same post written in the admin got a clean one.

export const slugify = (s) =>
  (s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;

// Rough reading time, same convention dev.to uses (~200 wpm).
export const readingMinutes = (body) =>
  Math.max(1, Math.round((String(body || "").split(/\s+/).filter(Boolean).length || 0) / 200));

export const excerptFrom = (body, max = 170) => {
  const text = String(body || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
};

/* ---------- section addressing ---------- */

// Every ATX heading in the body, with the character range of the text that
// belongs to it — from just after the heading line to just before the next
// heading of the same or a shallower level.
//
// This is what lets a post be edited a section at a time instead of by
// resending the whole article: a 3,000-word piece costs one section to fix,
// not two full copies through the model's context.
export function outlineOf(body) {
  const src = String(body || "");
  const heads = [];
  // Skip fenced code: "# not a heading" inside a block is a comment.
  const fences = [];
  for (const m of src.matchAll(/```[\s\S]*?```/g)) fences.push([m.index, m.index + m[0].length]);
  const inFence = (i) => fences.some(([a, b]) => i >= a && i < b);

  for (const m of src.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*$/gm)) {
    if (inFence(m.index)) continue;
    heads.push({
      level: m[1].length,
      heading: m[2].trim(),
      headingStart: m.index,
      bodyStart: m.index + m[0].length,
    });
  }

  return heads.map((h, i) => {
    const next = heads.slice(i + 1).find((n) => n.level <= h.level);
    const end = next ? next.headingStart : src.length;
    return { ...h, end, text: src.slice(h.bodyStart, end) };
  });
}

// Headings are matched the way a person would name one: case- and
// punctuation-insensitive, so "JIT compilation" finds "## JIT Compilation".
const normalizeHeading = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function findSection(body, heading) {
  const wanted = normalizeHeading(heading);
  if (!wanted) throw new Error("Give the heading of the section to edit.");
  const outline = outlineOf(body);
  const hits = outline.filter((h) => normalizeHeading(h.heading) === wanted);
  if (hits.length === 0) {
    const available = outline.map((h) => `${"#".repeat(h.level)} ${h.heading}`);
    throw new Error(
      `No section headed "${heading}". The post has: ${available.join(" | ") || "no headings at all"}`
    );
  }
  if (hits.length > 1)
    throw new Error(
      `"${heading}" appears ${hits.length} times in this post, so the edit is ambiguous. Rename one of them first.`
    );
  return hits[0];
}
