// Upgrades a rendered post body in the browser: maths, diagrams and running
// sketches. BROWSER ONLY — every library here is loaded with a dynamic import
// so none of it reaches the bundle of a reader who never opens a post that
// uses it. mermaid alone is larger than the rest of this site.
//
// It is shared because THREE surfaces render a post body and they must agree:
// the article page, the admin's live preview, and the Blog app on the desktop.
// A preview that cannot show a diagram is a preview you stop trusting.
//
// The markdown renderer never executes anything; it only marks the places
// (`lib/markdown.js`). All execution is decided here.

const SKETCH_RUNTIMES = {
  // Pinned. A sketch that renders today should render in a year, and "latest"
  // is how a working post quietly breaks.
  p5: "https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js",
  d3: "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js",
};

const DEFAULT_SKETCH_HEIGHT = 420;

/* ---------------- maths ---------------- */

async function renderMath(nodes) {
  // Everything up to the first await runs synchronously, and that is the point.
  //
  // katex.render REPLACES the node's content, so a second pass that reads
  // textContent reads the rendered output and typesets THAT. The equation then
  // appears two or three times over, concatenated — `$c$` rendering as "ccc".
  // Claiming the node and stashing the original TeX before awaiting the import
  // makes a repeated pass a no-op instead.
  const items = nodes.map((node) => {
    const tex = node.dataset.tex ?? node.textContent;
    node.dataset.tex = tex;
    node.classList.add("is-rendered");
    return { node, tex };
  });

  const katex = (await import("katex")).default;
  for (const { node, tex } of items) {
    const display = node.dataset.display === "1";
    try {
      katex.render(tex, node, {
        displayMode: display,
        // Show the offending TeX in place rather than throwing away the
        // paragraph it sits in.
        throwOnError: false,
        errorColor: "#d23",
        strict: false,
        // KaTeX emits visual HTML plus a MathML copy, and the MathML is what a
        // screen reader actually reads. Forcing output:"html" renders the same
        // picture and makes every equation silent.
        output: "htmlAndMathml",
      });
    } catch (e) {
      node.classList.add("is-error");
      node.title = e?.message || "Could not typeset this.";
    }
    if (display) node.classList.add("is-display");
  }
}

/* ---------------- mermaid ---------------- */

let mermaidTheme = null;

// mermaid's stock themes are lavender on light and indigo on dark, which on
// this site reads as a component borrowed from somewhere else — and purple is
// the one colour this design explicitly moved away from. So: base theme, with
// every variable pinned to the site's own tokens.
//
// The values are literal because mermaid writes them into the SVG itself and
// cannot read a CSS custom property. They mirror styles/globals.scss.
const PALETTE = {
  light: {
    bg: "#ffffff",
    surface: "#f6f7f9",
    edge: "#cfd4dd",
    fg: "#14161c",
    muted: "#5b6472",
    accent: "#ffb020",
  },
  dark: {
    bg: "#14161c",
    surface: "#1b1f27",
    edge: "#3a3f4b",
    fg: "#eceef3",
    muted: "#9aa1b2",
    accent: "#ffb020",
  },
};

async function getMermaid(dark) {
  const mermaid = (await import("mermaid")).default;
  const want = dark ? "dark" : "light";
  // Re-initialise when the theme changes, not just once.
  if (mermaidTheme !== want) {
    const c = PALETTE[want];
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      themeVariables: {
        background: "transparent",
        primaryColor: c.surface,
        primaryBorderColor: c.edge,
        primaryTextColor: c.fg,
        secondaryColor: c.surface,
        secondaryBorderColor: c.edge,
        secondaryTextColor: c.fg,
        tertiaryColor: c.bg,
        tertiaryBorderColor: c.edge,
        tertiaryTextColor: c.fg,
        lineColor: c.muted,
        textColor: c.fg,
        mainBkg: c.surface,
        nodeBorder: c.edge,
        clusterBkg: c.bg,
        clusterBorder: c.edge,
        titleColor: c.fg,
        edgeLabelBackground: c.bg,
        // The accent is reserved: notes and highlights only, never every box.
        noteBkgColor: c.accent,
        noteTextColor: "#14161c",
        noteBorderColor: c.accent,
        fontSize: "14px",
      },
    });
    mermaidTheme = want;
  }
  return mermaid;
}

async function renderMermaid(nodes, dark) {
  // Claimed synchronously, for the same reason as the maths above: the render
  // replaces the node's contents, so a repeated pass must find nothing to do.
  const items = nodes.map((node) => {
    const src = node.dataset.src ?? node.querySelector(".pb-src")?.textContent ?? "";
    node.dataset.src = src;
    node.classList.add("is-rendered");
    return { node, src };
  });

  const mermaid = await getMermaid(dark);
  let n = 0;
  for (const { node, src } of items) {
    // Only bail when the node has genuinely left the document. Bailing on a
    // cancellation flag stranded the diagram: the pass had already claimed the
    // node, React's StrictMode remount then skipped it as "done", and nothing
    // ever drew it. A remount keeps the same DOM node, so finishing is right.
    if (!node.isConnected) return;
    const id = `pb-mmd-${Date.now().toString(36)}-${n++}`;
    try {
      const { svg } = await mermaid.render(id, src.trim());
      node.innerHTML = svg;
    } catch (e) {
      // A diagram with a syntax error must not take the article down with it:
      // keep the source visible and say what went wrong.
      node.classList.add("is-error");
      const why = document.createElement("p");
      why.className = "pb-err";
      why.textContent = `Diagram error: ${e?.message || "could not parse"}`;
      node.prepend(why);
      // The stray <svg id> mermaid leaves behind on failure.
      document.getElementById(`d${id}`)?.remove();
    }
  }
}

/* ---------------- p5 / d3 sketches ---------------- */

// Sketches run in a sandboxed iframe with NO allow-same-origin, so the frame
// gets an opaque origin: it cannot reach this page's DOM, cookies, storage or
// Firebase session. That is not because the author is untrusted — the admin
// writes every post — but because a sketch is a program, and a program with an
// infinite loop should freeze its own frame rather than the article around it.
function sketchDocument(kind, code) {
  const runtime = SKETCH_RUNTIMES[kind];
  // d3 draws INTO something, so hand it the container. p5 makes its own canvas.
  const prelude = kind === "d3" ? 'const el = document.getElementById("root");\n' : "";

  // The sketch runs at the TOP LEVEL of its own script tag, deliberately.
  //
  // p5's global mode works by looking for `setup` and `draw` as globals once
  // the window has loaded. Wrapping the sketch in a load listener — or in a
  // try/catch — makes those functions local to that closure, p5 finds nothing
  // and silently draws no canvas at all. That is why errors are caught with
  // window.onerror here instead of a try block.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html,body { margin:0; padding:0; background:transparent; overflow:hidden;
    font:13px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; color:#8b90a0; }
  #root { width:100%; height:100%; }
  canvas, svg { max-width:100%; display:block; }
  .pb-frame-err { padding:12px 14px; color:#d23; font-family:ui-monospace, monospace;
    white-space:pre-wrap; font-size:12px; }
</style>
</head>
<body>
<div id="root"></div>
<script>
  window.addEventListener("error", function (e) {
    var box = document.createElement("div");
    box.className = "pb-frame-err";
    box.textContent = (e.message || "Sketch error") + (e.lineno ? " (line " + e.lineno + ")" : "");
    document.body.replaceChildren(box);
  });
</script>
<script src="${runtime}" crossorigin="anonymous"></script>
<script>
${prelude}${code}
</script>
</body>
</html>`;
}

function renderSketches(nodes) {
  const restorers = [];
  for (const node of nodes) {
    const kind = node.dataset.kind;
    if (!SKETCH_RUNTIMES[kind]) continue;
    const srcEl = node.querySelector(".pb-src");
    const code = srcEl?.textContent || "";
    const height = Number(node.dataset.height) || DEFAULT_SKETCH_HEIGHT;

    const frame = document.createElement("iframe");
    frame.className = "pb-frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("loading", "lazy");
    frame.setAttribute("title", `${kind} sketch`);
    frame.style.height = `${height}px`;
    frame.srcdoc = sketchDocument(kind, code);

    // Keep the source, collapsed, so a reader can see how the thing they are
    // looking at was made. That is most of the point of a sketch in a post.
    const details = document.createElement("details");
    details.className = "pb-src-toggle";
    const summary = document.createElement("summary");
    summary.textContent = `${kind} source`;
    details.append(summary);
    if (srcEl) details.append(srcEl);

    node.replaceChildren(frame, details);
    node.classList.add("is-rendered");

    // React runs an effect, cleans it up and runs it again — in development
    // StrictMode does this on every mount. The cleanup below used to remove
    // the iframe while leaving `is-rendered` behind, so the second pass
    // skipped the node and the sketch was gone for good. Put the container
    // back exactly as it was found.
    restorers.push(() => {
      // enhancePostBody is async, so a cleanup can land AFTER the next pass
      // has already put its own iframe in this container. If that happened,
      // this frame is detached and restoring would wipe the live one.
      if (frame.parentNode !== node) {
        frame.srcdoc = "";
        frame.remove();
        return;
      }
      frame.srcdoc = "";
      frame.remove();
      if (srcEl) node.replaceChildren(srcEl);
      node.classList.remove("is-rendered");
    });
  }
  return restorers;
}

/* ---------------- entry point ---------------- */

// Returns a dispose function SYNCHRONOUSLY. It used to return a promise of
// one, which looked tidier and was wrong: React mounts, cleans up and mounts
// again (StrictMode does it on every mount in development). The first pass
// marked each container `is-rendered` immediately but only un-marked it when
// its promise resolved — so the second pass found nothing to do, and the first
// pass's late cleanup then tore down what little was there. Net result: no
// sketches at all, and no error anywhere to explain it.
//
// Handing back the disposer synchronously means a cleanup always disposes the
// pass it belongs to, in order.
//
// Safe to call on a body that uses none of this: it does nothing and imports
// nothing.
export function enhancePostBody(root, { dark = false } = {}) {
  if (!root) return () => {};

  const math = Array.from(root.querySelectorAll(".pb-math:not(.is-rendered)"));
  const diagrams = Array.from(root.querySelectorAll(".pb-mermaid:not(.is-rendered)"));
  const sketches = Array.from(root.querySelectorAll(".pb-sketch:not(.is-rendered)"));

  // Synchronous, so the DOM is consistent the moment this returns.
  const restoreSketches = sketches.length ? renderSketches(sketches) : [];

  if (math.length) renderMath(math).catch(() => {});
  if (diagrams.length) {
    renderMermaid(diagrams, dark).catch(() => {});
  }

  // mermaid writes its colours INTO the SVG, so a diagram rendered in light
  // mode stays light after the reader flips the theme — dark text on a dark
  // page, i.e. gone. Watch the root class and redraw when it changes.
  let isDark = dark;
  const observer =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => {
          const nowDark = document.documentElement.classList.contains("dark");
          if (nowDark === isDark) return;
          isDark = nowDark;
          const drawn = Array.from(root.querySelectorAll(".pb-mermaid.is-rendered"));
          if (!drawn.length) return;
          // The source was stashed on the node, so a redraw needs no markup.
          drawn.forEach((n) => n.classList.remove("is-rendered"));
          renderMermaid(drawn, nowDark).catch(() => {});
        });
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => {
    observer?.disconnect();
    // An iframe left in the document keeps its animation loop running after
    // React has moved on.
    restoreSketches.forEach((restore) => restore());
  };
}

export const usesEnhancement = (html) =>
  typeof html === "string" && /pb-math|pb-mermaid|pb-sketch/.test(html);
