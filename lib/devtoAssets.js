// Rendering the un-portable blocks into files, at cross-post time only.
//
// BROWSER ONLY, and deliberately so. mermaid needs a DOM to lay out a diagram
// and a p5 sketch needs to actually run, neither of which a Vercel function
// can do. The admin is already a browser with both libraries available, so the
// rendering happens where the post is being pushed from.
//
// Nothing here runs unless a cross-post happens. A post that never leaves this
// site never produces a file, which is the whole point.
//
// The bytes go to our own bucket under media/devto/. dev.to's uploader is a
// Rails form endpoint behind a CSRF token — POSTing to it with an API key
// returns "Invalid authenticity token" — so there is no way to put files in
// dev.to's own storage without handing over a session cookie, which is a far
// worse secret than the API key.
import { blockId } from "./server/portableMarkdown";
import { absoluteUrl } from "./canonicalUrl";

// WebP at the top of its quality range, rendered at 2x and displayed at 1x:
// visually lossless on flat diagram colours, and a fraction of the PNG.
const WEBP_QUALITY = 0.98;
const RASTER_SCALE = 2;

// VP9 compresses a canvas animation far better than VP8, and it is left to
// choose its own rate ON PURPOSE.
//
// Asking for `video/webm;codecs=vp9` AND a `videoBitsPerSecond` produces a
// 110-byte file on this Chrome: a WebM header with no frames at all. The
// recorder reports no error, `isTypeSupported` returns true, and `onstop`
// fires normally. Measured over a 3s animated canvas, headless and headful:
//
//   codecs=vp9 + bitrate     110 bytes   <- what we were shipping
//   codecs=vp9 alone        8.9-17.8 KB
//   codecs=vp8 + bitrate      32.5 KB
//   video/webm + bitrate      31.1 KB    (Chrome picks vp9 itself, and it works)
//
// So the cap we added to keep files small was the one thing making them
// empty — and dropping it gives the SMALLEST file of the five. Do not
// reintroduce a bitrate here without re-running scripts/probe-recorder.mjs.
const VIDEO_MS = 5000;

// Smaller than this and the file is a container with no frames in it; see
// the VIDEO_MS note above.
const MIN_VIDEO_BYTES = 2000;

const SKETCH_RUNTIMES = {
  p5: "https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js",
  d3: "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js",
};

/* ---------------- mermaid -> WebP ---------------- */

// Rendered on an opaque white card rather than transparent: dev.to has a dark
// mode, and a transparent diagram with dark text vanishes in it.
async function mermaidToWebp(code) {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    // mermaid draws node labels in a <foreignObject> by default, which is
    // HTML inside the SVG. Rasterising that TAINTS the canvas — toBlob then
    // fails with "Tainted canvases may not be exported" and the diagram never
    // travels. Plain <text> labels render identically here and export cleanly.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    class: { htmlLabels: false },
    themeVariables: {
      background: "#ffffff",
      primaryColor: "#f6f7f9",
      primaryBorderColor: "#cfd4dd",
      primaryTextColor: "#14161c",
      secondaryColor: "#f6f7f9",
      tertiaryColor: "#ffffff",
      lineColor: "#5b6472",
      textColor: "#14161c",
      mainBkg: "#f6f7f9",
      nodeBorder: "#cfd4dd",
      clusterBkg: "#ffffff",
      clusterBorder: "#cfd4dd",
      edgeLabelBackground: "#ffffff",
      fontSize: "14px",
    },
  });

  const { svg } = await mermaid.render(`devto-${Date.now().toString(36)}`, code.trim());

  // Measure the SVG by letting the browser lay it out once.
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-10000px;top:0;";
  holder.innerHTML = svg;
  document.body.append(holder);
  const el = holder.querySelector("svg");
  const box = el.getBoundingClientRect();
  const w = Math.max(320, Math.ceil(box.width || 800));
  const h = Math.max(120, Math.ceil(box.height || 400));
  // An SVG without explicit pixel dimensions rasterises at its default size.
  el.setAttribute("width", String(w));
  el.setAttribute("height", String(h));
  const markup = new XMLSerializer().serializeToString(el);
  holder.remove();

  const img = new Image();
  img.decoding = "sync";
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("The diagram could not be rasterised."));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = w * RASTER_SCALE;
    canvas.height = h * RASTER_SCALE;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((res) => canvas.toBlob(res, "image/webp", WEBP_QUALITY));
    if (!blob) throw new Error("This browser would not encode WebP.");
    return { blob, ext: "webp", contentType: "image/webp" };
  } finally {
    img.src = "";
  }
}

/* ---------------- p5 / d3 -> WebP or WebM ---------------- */

// The sketch keeps running in a sandbox with no same-origin access, so the
// parent cannot reach into it to grab the pixels. Instead the frame hands its
// own output back over postMessage — which a sandboxed frame is allowed to do.
function captureDocument(kind, code, { video, width, height }) {
  const runtime = SKETCH_RUNTIMES[kind];
  const prelude = kind === "d3" ? 'const el = document.getElementById("root");\n' : "";

  // Top level, not inside a callback: p5's global mode only sees globals.
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#fff;overflow:hidden;
    font:13px Inter,ui-sans-serif,system-ui,sans-serif;color:#14161c}
  #root{width:${width}px;height:${height}px}
  canvas,svg{display:block}
</style></head><body>
<div id="root"></div>
<script>
  var TOKEN = ${JSON.stringify(String(Date.now()))};
  function fail(msg){ parent.postMessage({ rkCapture: TOKEN, error: String(msg) }, "*"); }
  window.addEventListener("error", function (e) { fail(e.message || "sketch error"); });

  function findCanvas(){ return document.querySelector("canvas"); }
  function findSvg(){ return document.querySelector("svg"); }

  function sendImage(){
    var c = findCanvas();
    if (c) {
      c.toBlob(function (b) {
        parent.postMessage({ rkCapture: TOKEN, blob: b, type: "image/webp" }, "*");
      }, "image/webp", ${WEBP_QUALITY});
      return;
    }
    var s = findSvg();
    if (!s) return fail("The sketch drew neither a canvas nor an svg.");
    // Rasterise the svg inside the frame; the parent only receives pixels.
    var box = s.getBoundingClientRect();
    var w = Math.max(320, Math.ceil(box.width || ${width}));
    var h = Math.max(120, Math.ceil(box.height || ${height}));
    s.setAttribute("width", w); s.setAttribute("height", h);
    var markup = new XMLSerializer().serializeToString(s);
    var img = new Image();
    img.onload = function () {
      var cv = document.createElement("canvas");
      cv.width = w * ${RASTER_SCALE}; cv.height = h * ${RASTER_SCALE};
      var cx = cv.getContext("2d");
      cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, cv.width, cv.height);
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(function (b) {
        parent.postMessage({ rkCapture: TOKEN, blob: b, type: "image/webp" }, "*");
      }, "image/webp", ${WEBP_QUALITY});
    };
    img.onerror = function(){ fail("The chart could not be rasterised."); };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
  }

  function sendVideo(){
    var c = findCanvas();
    if (!c) return sendImage();
    var mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      .find(function (m) { return window.MediaRecorder && MediaRecorder.isTypeSupported(m); });
    if (!mime) return sendImage();
    var chunks = [];
    var rec = new MediaRecorder(c.captureStream(30), { mimeType: mime });
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      var blob = new Blob(chunks, { type: mime });
      // A WebM container with no frames in it is about 110 bytes, and it is
      // a perfectly valid file: nothing downstream can tell it from a real
      // recording until a reader clicks the link and gets nothing. Refuse it
      // here, so the sketch travels as its still image alone.
      if (blob.size < ${MIN_VIDEO_BYTES}) {
        return fail("The recording captured no frames (" + blob.size + " bytes).");
      }
      parent.postMessage({ rkCapture: TOKEN, blob: blob, type: mime }, "*");
    };
    rec.start();
    setTimeout(function () { try { rec.stop(); } catch (e) { fail(e.message); } }, ${VIDEO_MS});
  }

  window.addEventListener("load", function () {
    // Let the sketch settle before capturing: a p5 draw loop on its first
    // frame is usually an empty canvas.
    setTimeout(${video ? "sendVideo" : "sendImage"}, 1200);
  });
</script>
<script src="${runtime}" crossorigin="anonymous"></script>
<script>
${prelude}${code}
</script>
</body></html>`;
}

async function captureSketch(kind, code, { video = false, height = 420 } = {}) {
  const width = 960;
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  // ON SCREEN, deliberately. Parked off-canvas the frame gets no
  // requestAnimationFrame ticks, so a p5 draw loop never advances, the canvas
  // never repaints and captureStream records a 0-byte video. It sits behind
  // the page and ignores the pointer; the export is a few seconds long.
  frame.style.cssText =
    `position:fixed;right:8px;bottom:8px;width:${width}px;height:${height}px;` +
    "border:0;opacity:0.015;pointer-events:none;z-index:0;";
  frame.srcdoc = captureDocument(kind, code, { video, width, height });

  const budget = (video ? VIDEO_MS : 0) + 20000;
  try {
    document.body.append(frame);
    const msg = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`The ${kind} sketch did not respond in time.`)), budget);
      const onMessage = (e) => {
        if (e.source !== frame.contentWindow || !e.data?.rkCapture) return;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(e.data);
      };
      window.addEventListener("message", onMessage);
    });
    if (msg.error) throw new Error(msg.error);
    if (!msg.blob) throw new Error(`The ${kind} sketch produced nothing.`);
    const isVideo = String(msg.type).startsWith("video/");
    return { blob: msg.blob, ext: isVideo ? "webm" : "webp", contentType: msg.type };
  } finally {
    frame.srcdoc = "";
    frame.remove();
  }
}

/* ---------------- one block -> one file ---------------- */

// Rendering only: no network, no upload, no publish. Exported so
// /__exportcheck can prove the renderer produces usable files without
// touching storage or dev.to.
export async function renderBlockForExport(block) {
  if (block.kind === "mermaid") return mermaidToWebp(block.code);

  const height = block.height || 420;
  const still = await captureSketch(block.kind, block.code, { video: false, height });
  if (block.kind !== "p5") return still;

  // p5 animates, so it also travels as a short video. But dev.to cannot embed
  // an arbitrary video file — markdown image syntax pointing at a .webm is a
  // broken image — so the still is what readers SEE inline and the video is
  // offered as a link beside it.
  try {
    const motion = await captureSketch("p5", block.code, { video: true, height });
    return { ...still, video: motion };
  } catch (e) {
    // The still is enough to cross-post, so a failed recording is not fatal —
    // but it must not be silent either. Swallowing this is how a 110-byte
    // video shipped for weeks looking like "no video recorded".
    return { ...still, videoError: e?.message || "the recording failed" };
  }
}

/* ---------------- upload ---------------- */

async function uploadAsset({ blob, ext, contentType }, id, getToken) {
  const key = `media/devto/${id}.${ext}`;
  const res = await fetch("/api/media/sign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await getToken()}`,
    },
    body: JSON.stringify({ key }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Could not sign the upload (HTTP ${res.status}).`);

  const put = await fetch(json.url, { method: "PUT", body: blob, headers: { "Content-Type": contentType } });
  if (!put.ok) throw new Error(`Storage rejected the upload (HTTP ${put.status}).`);
  // dev.to needs an absolute URL, and it must be the canonical host — an image
  // src pointing at localhost renders as a broken image for every reader.
  return { url: absoluteUrl(json.publicUrl), bytes: blob.size, key };
}

/* ---------------- the whole job ---------------- */

// Renders every block that has no asset yet and returns the id -> URL map to
// merge into the post. `known` is whatever a previous cross-post already made,
// so pushing an unchanged post twice uploads nothing.
export async function buildDevtoAssets(blocks, { known = {}, getToken, onProgress = () => {} } = {}) {
  const assets = { ...known };
  const made = [];
  const failed = [];

  let done = 0;
  for (const block of blocks) {
    const id = block.id || blockId(block.kind, block.code);
    done += 1;
    if (assets[id]) continue;

    onProgress(`Rendering ${block.kind} (${done} of ${blocks.length})…`);
    try {
      const file = await renderBlockForExport(block);

      onProgress(`Uploading ${block.kind} (${Math.round(file.blob.size / 1024)} KB)…`);
      const up = await uploadAsset(file, id, getToken);
      made.push({ id, kind: block.kind, ...up });

      if (file.video) {
        onProgress(`Uploading ${block.kind} video (${Math.round(file.video.blob.size / 1024)} KB)…`);
        const vid = await uploadAsset(file.video, `${id}-motion`, getToken);
        made.push({ id: `${id}-motion`, kind: `${block.kind} video`, ...vid });
        assets[id] = { image: up.url, video: vid.url };
      } else {
        assets[id] = up.url;
      }
    } catch (e) {
      // One broken diagram must not stop the cross-post: that block travels as
      // a line pointing at the original instead.
      failed.push({ id, kind: block.kind, error: e?.message || "render failed" });
    }
  }

  return { assets, made, failed };
}
