// Turning a mail body into something you can READ, safely.
//
// THE WHOLE POINT, stated first because everything here follows from it:
// e-mail HTML is the only content in this entire codebase written by someone
// who is not the owner. Anyone who knows the address can put markup in front
// of this renderer. CLAUDE.md already says `dangerouslySetInnerHTML` is for
// the admin's own Markdown and must never point at anything a visitor can
// write -- a mail body is precisely that, so it never touches the page's DOM.
//
// THREE INDEPENDENT CONTROLS, in order of how much they are relied on:
//
//   1. The body renders in an IFRAME with no `allow-same-origin`. The frame is
//      an opaque origin: it cannot read the admin's DOM, its cookies, its
//      IndexedDB (which holds the Firebase session) or its localStorage. This
//      is the control that actually matters, and it does not depend on this
//      file being correct.
//   2. A Content-Security-Policy of `default-src 'none'` inside that frame,
//      so nothing loads and nothing executes unless it is named. Scripts are
//      allowed ONLY under a per-render nonce that this app generates, so a
//      <script> that survived step 3 still cannot run -- it has no nonce.
//   3. This sanitiser. Defence in depth, never the only line. A hand-rolled
//      HTML sanitiser is a thing to be suspicious of, which is exactly why it
//      sits behind the two controls above rather than in front of them.
//
// REMOTE IMAGES ARE BLOCKED BY DEFAULT, because a one-pixel image in a mail is
// how a sender learns you opened it, when, and roughly where from. Every mail
// client does this. Showing them is one click and says what it costs.

/* ---------------- what survives ---------------- */

// Elements that carry meaning in a mail body. Everything structural that
// newsletters actually use (tables are still how mail is laid out) and nothing
// that can fetch, execute, navigate or embed.
export const ALLOWED_TAGS = new Set([
  "a", "abbr", "address", "b", "big", "blockquote", "br", "caption", "center",
  "cite", "code", "col", "colgroup", "dd", "del", "div", "dl", "dt", "em",
  "figcaption", "figure", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr",
  "i", "img", "ins", "kbd", "label", "li", "mark", "nobr", "ol", "p", "pre",
  "q", "s", "samp", "small", "span", "strike", "strong", "sub", "sup", "table",
  "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul", "var",
  "wbr",
]);

// Dropped WITH their contents. A <form> is the phishing primitive; <svg> and
// <math> can carry script in attributes browsers parse differently from HTML.
export const DROPPED_PAIRED = [
  "iframe", "frameset", "object", "applet", "form", "button", "select",
  "svg", "math", "template", "audio", "video", "canvas", "map", "portal",
];

// VOID elements: there is no closing tag, so only the tag itself goes.
//
// These were once in the paired list with an "or end of document" fallback,
// and the result was the worst kind of bug. A real Google security alert
// carries a <link> in its <head> and two more inside a <div>, so the match ran
// from the first <link> all the way to EOF and DELETED THE WHOLE MESSAGE. The
// reader showed an empty frame, nothing errored anywhere, and the mail read as
// blank rather than as broken.
export const DROPPED_VOID = ["link", "meta", "base", "input", "source", "track", "area", "frame", "embed"];

// Raw-text elements: an UNCLOSED one really does swallow the rest of the
// document in a real parser, so matching to EOF is correct here and only here.
export const DROPPED_RAWTEXT = ["script", "style", "title", "textarea", "noscript"];

export const DROPPED_WHOLE = [...DROPPED_RAWTEXT, ...DROPPED_PAIRED, ...DROPPED_VOID];

// Tags whose wrapper goes but whose contents stay.
const UNWRAP = new Set(["html", "head", "body"]);

const GLOBAL_ATTR = new Set([
  "style", "class", "id", "title", "dir", "lang", "align", "valign", "width",
  "height", "bgcolor", "color", "face", "size", "border", "cellpadding",
  "cellspacing", "colspan", "rowspan", "nowrap", "span", "start", "type",
  "hspace", "vspace", "datetime",
]);
const PER_TAG_ATTR = {
  a: new Set(["href", "name", "target", "rel"]),
  img: new Set(["src", "alt", "srcset", "loading"]),
};

// A link may only go somewhere a person can go. `javascript:` is the obvious
// one; `data:` is the one people forget, because a data: URL opens a page the
// sender wrote on your browser's own screen.
const SAFE_LINK = /^(https?:|mailto:|tel:)/i;

const TRANSPARENT =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/* ---------------- helpers ---------------- */

export const looksLikeHtml = (s) => /<(?:[a-z!/]|!--)/i.test(String(s || ""));

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#34": '"',
};
const decodeEntities = (s) =>
  String(s || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, g) => {
    const k = g.toLowerCase();
    if (ENTITIES[k]) return ENTITIES[k];
    if (k[0] === "#") {
      const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return m;
  });

const escapeAttr = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A URL is read AFTER decoding entities and stripping control characters,
// because `java&#115;cript:` and `java\tscript:` both reach the parser as
// `javascript:` and a check on the raw string sees neither.
function urlScheme(raw) {
  const v = decodeEntities(raw).replace(/[\u0000- \u007f]/g, "").trim();
  return { clean: v, safe: SAFE_LINK.test(v), lower: v.toLowerCase() };
}

// CSS can still fetch (url()) and, in old engines, execute (expression,
// -moz-binding, behavior). The CSP stops the fetching; these rules mean the
// stylesheet does not even try.
export function sanitiseCss(css) {
  return String(css || "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "void(")
    .replace(/-moz-binding\s*:/gi, "void:")
    .replace(/behavior\s*:/gi, "void:")
    .replace(/javascript\s*:/gi, "void:")
    .replace(/position\s*:\s*fixed/gi, "position:static")
    .slice(0, 200000);
}

function sanitiseStyleAttr(v) {
  const out = sanitiseCss(v).replace(/[{}]/g, "");
  return out.trim();
}

const ATTR_RE =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))|([a-zA-Z_:][-a-zA-Z0-9_:.]*)/g;

function parseAttrs(raw) {
  const out = [];
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw))) {
    if (m[1]) out.push([m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? ""]);
    else if (m[5]) out.push([m[5].toLowerCase(), ""]);
  }
  return out;
}

/* ---------------- the sanitiser ---------------- */

export function sanitiseMailHtml(input, { allowRemoteImages = false } = {}) {
  let html = String(input || "");
  const removed = { scripts: 0, frames: 0, handlers: 0, links: 0, other: 0 };
  let blockedImages = 0;
  let css = "";

  // Comments go first and whole. A conditional comment hides real markup from
  // one parser and shows it to another, so leaving them in means sanitising
  // something and shipping an unsanitised copy of it beside it.
  html = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  html = html.replace(/<![^>]*>/g, "").replace(/<\?[\s\S]*?\?>/g, "");

  // Keep the stylesheet's text before the element is dropped: mail is laid out
  // with <style>, and throwing it away turns a newsletter into a column of
  // unstyled fragments.
  html = html.replace(/<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi, (_m, body) => {
    css += `\n${sanitiseCss(body)}`;
    return "";
  });

  const tally = (tag) => {
    if (tag === "script") removed.scripts++;
    else if (/frame|object|embed|portal/.test(tag)) removed.frames++;
    else removed.other++;
  };

  // Raw text first: an unclosed one legitimately runs to the end of the
  // document, in a real parser too.
  for (const tag of DROPPED_RAWTEXT) {
    if (tag === "style") continue; // already lifted out above
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?(?:<\\/${tag}\\s*>|$)`, "gi"), () => {
      tally(tag);
      return "";
    });
  }

  // Paired: the closing tag is REQUIRED. Without that requirement an element
  // that merely happens to be unclosed takes the rest of the message with it.
  for (const tag of DROPPED_PAIRED) {
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), () => {
      tally(tag);
      return "";
    });
  }

  // Whatever is left of either set -- a stray opener, a stray closer -- plus
  // every void element, loses only itself.
  for (const tag of [...DROPPED_RAWTEXT, ...DROPPED_PAIRED, ...DROPPED_VOID]) {
    html = html.replace(new RegExp(`<\\/?${tag}\\b[^>]*?>`, "gi"), () => {
      tally(tag);
      return "";
    });
  }

  html = html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g, (m, slash, rawName, rawAttrs) => {
    const name = rawName.toLowerCase();
    if (UNWRAP.has(name)) return "";
    if (!ALLOWED_TAGS.has(name)) {
      removed.other++;
      return ""; // unwrap: the tag goes, its text stays
    }
    if (slash) return `</${name}>`;

    const kept = [];
    let imgBlocked = false;

    for (const [attr, value] of parseAttrs(rawAttrs)) {
      // Every inline handler, in one rule. This is the single commonest way
      // script reaches a page through markup.
      if (attr.startsWith("on")) {
        removed.handlers++;
        continue;
      }
      if (attr === "srcset") continue; // a second image source to police; not worth keeping
      if (attr === "style") {
        const s = sanitiseStyleAttr(value);
        if (s) kept.push(`style="${escapeAttr(s)}"`);
        continue;
      }
      if (attr === "href") {
        const { clean, safe } = urlScheme(value);
        if (!safe) {
          removed.links++;
          continue;
        }
        kept.push(`href="${escapeAttr(clean)}"`);
        continue;
      }
      if (attr === "src" && name === "img") {
        const { clean, lower } = urlScheme(value);
        if (lower.startsWith("data:image/")) {
          kept.push(`src="${escapeAttr(clean)}"`);
        } else if (lower.startsWith("cid:")) {
          // An inline attachment. Resolving it means fetching the part and
          // inlining it; until that exists it is reported, not silently blank.
          imgBlocked = true;
        } else if (/^https?:/i.test(lower)) {
          if (allowRemoteImages) kept.push(`src="${escapeAttr(clean)}"`);
          else imgBlocked = true;
        } else {
          imgBlocked = true;
        }
        continue;
      }
      // `background="…"` on a table cell is a remote image wearing a different
      // attribute name, and it is how a tracker survives an img-only block.
      if (attr === "background") {
        if (allowRemoteImages) kept.push(`background="${escapeAttr(urlScheme(value).clean)}"`);
        else blockedImages++;
        continue;
      }
      const allowed = GLOBAL_ATTR.has(attr) || PER_TAG_ATTR[name]?.has(attr);
      if (allowed) kept.push(value === "" ? attr : `${attr}="${escapeAttr(decodeEntities(value))}"`);
    }

    if (name === "img" && imgBlocked) {
      blockedImages++;
      kept.push(`src="${TRANSPARENT}"`, 'class="mbx-blocked-img"');
    }
    if (name === "a") {
      // Opening in the same frame would navigate the sandbox; opening in the
      // parent is not possible without same-origin. A new tab is the only
      // behaviour that works and it is also the right one.
      kept.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
    }

    const attrs = kept.length ? ` ${kept.join(" ")}` : "";
    return `<${name}${attrs}>`;
  });

  return { html, css: css.trim(), blockedImages, removed };
}

/* ---------------- the document the frame renders ---------------- */

// `nonce` is generated per render by the caller. It is what lets OUR height
// reporter run while an author <script> -- which has no nonce, and has in any
// case been removed above -- cannot.
// `dark` defaults to FALSE, and that is a decision rather than an oversight.
//
// A mail is authored against a white background: Google's own alerts set
// near-black text and no background, so rendering one on this console's dark
// surface produced dark grey on #0f1117 -- the message was there and could not
// be read. Inverting the sender's colours is the other option and it wrecks
// every branded newsletter. So the message sits on a white sheet inside the
// dark console, the way a piece of paper sits on a desk.
export function mailFrameDoc(body, { allowRemoteImages = false, nonce = "", dark = false } = {}) {
  const { html, css, blockedImages, removed } = sanitiseMailHtml(body, { allowRemoteImages });

  const csp = [
    "default-src 'none'",
    // Remote images are a request the SENDER can observe, so they are named
    // here only once the reader has asked for them. data: is always fine --
    // it is already in the message.
    allowRemoteImages ? "img-src data: https: http:" : "img-src data:",
    "style-src 'unsafe-inline'",
    "font-src data:",
    // Without a nonce nothing executes at all. With one, only the reporter
    // below does: an author <script> carries no nonce, and has already been
    // removed by the sanitiser.
    nonce ? `script-src 'nonce-${nonce}'` : "script-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

  const fg = dark ? "#c4c7d2" : "#1f2328";
  const bg = dark ? "#0f1117" : "#ffffff";
  const link = dark ? "#ffc55c" : "#9a5b00";
  // The placeholder has to follow the sheet it sits on, or a dark swatch lands
  // in the middle of a white newsletter and reads as a rendering fault rather
  // than as an image somebody chose not to load.
  const holdBg = dark ? "#1a1d27" : "#f1f2f5";
  const holdEdge = dark ? "#3a4052" : "#c8ccd4";

  // The frame has no `allow-same-origin`, so the parent cannot measure it and
  // it cannot reach the parent's DOM. postMessage across an opaque origin is
  // the only channel, and the parent identifies it by contentWindow rather
  // than by origin -- an opaque origin reports itself as "null".
  // It reports the BODY's height, not documentElement.scrollHeight.
  //
  // documentElement.scrollHeight is bounded below by the viewport, and the
  // viewport here is the iframe the parent is about to resize -- so every tick
  // measured at least what the parent had just set and the frame ratcheted
  // upward forever. Measured live on a near-empty message: 5560px, then
  // 11968px, climbing 8px at a time. The body's height is content-driven, so
  // it settles and can also shrink back.
  const resize = nonce
    ? `<script nonce="${nonce}">(function(){var l=0;function t(){var b=document.body;if(!b)return;` +
      `var h=Math.max(b.scrollHeight,b.offsetHeight,b.getBoundingClientRect().height);` +
      `if(Math.abs(h-l)>1){l=h;parent.postMessage({mbxHeight:h},"*")}}` +
      `addEventListener("load",t);addEventListener("resize",t);setInterval(t,400);t()})();</script>`
    : "";

  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html,body{margin:0;padding:0;height:auto;background:${bg};color:${fg};font:14px/1.6 Inter,ui-sans-serif,system-ui,sans-serif;word-break:break-word;}
body{padding:2px 2px 12px;overflow:hidden;}
img{max-width:100%;height:auto;}
img.mbx-blocked-img{min-width:16px;min-height:16px;background:${holdBg};border:1px dashed ${holdEdge};border-radius:3px;}
a{color:${link};}
table{max-width:100%;border-collapse:collapse;}
pre{white-space:pre-wrap;}
*{max-width:100%;}
${css}
</style></head><body>${html}${resize}</body></html>`;

  return { doc, blockedImages, removed, csp };
}

/* ---------------- the plain-text view ---------------- */

export function htmlToText(input) {
  let s = String(input || "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)\s*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
