// Which MediaRecorder settings actually record a canvas animation?
//
// This exists because `video/webm;codecs=vp9` plus a `videoBitsPerSecond`
// produces a 110-byte file — a WebM header with no frames — while reporting
// no error at all. `isTypeSupported` returns true, `onstop` fires, and the
// result is a valid file nobody can play. The combination is silent, so the
// only way to know is to measure.
//
// Run it before changing anything about the recording in lib/devtoAssets.js:
//   node scripts/probe-recorder.mjs
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const PROBE = `
  const canvas = document.createElement("canvas");
  canvas.width = 400; canvas.height = 200;
  document.body.appendChild(canvas);
  const cx = canvas.getContext("2d");
  let t = 0, frames = 0;
  (function loop(){ t += 0.05; frames++;
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, 400, 200);
    cx.fillStyle = "#FFB020";
    cx.beginPath(); cx.arc(200 + Math.cos(t) * 90, 100, 20, 0, 6.28); cx.fill();
    requestAnimationFrame(loop); })();

  async function rec(mime, opts) {
    if (mime && !MediaRecorder.isTypeSupported(mime)) return { bytes: 0, actual: "unsupported" };
    const chunks = [];
    const r = new MediaRecorder(canvas.captureStream(30),
      mime ? { mimeType: mime, ...opts } : { ...opts });
    r.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
    const done = new Promise((res) => (r.onstop = res));
    r.start();
    await new Promise((res) => setTimeout(res, 3000));
    r.stop();
    await done;
    return { bytes: chunks.reduce((n, c) => n + c.size, 0), actual: r.mimeType };
  }

  const out = {};
  out["codecs=vp9 + bitrate"] = await rec("video/webm;codecs=vp9", { videoBitsPerSecond: 1500000 });
  out["codecs=vp9 alone"]     = await rec("video/webm;codecs=vp9", {});
  out["codecs=vp8 + bitrate"] = await rec("video/webm;codecs=vp8", { videoBitsPerSecond: 1500000 });
  out["video/webm + bitrate"] = await rec("video/webm", { videoBitsPerSecond: 1500000 });
  out["no mime at all"]       = await rec(null, {});
  out.frames = frames;
  return out;
`;

for (const headless of ["new", false]) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless,
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  try {
    const page = await browser.newPage();
    await page.bringToFront();
    await page.goto("about:blank");
    const r = await page.evaluate(`(async () => { ${PROBE} })()`);
    const { frames, ...rows } = r;
    console.log(`\n${headless === "new" ? "headless" : "headful"} — ${frames} animation frames drawn`);
    for (const [k, v] of Object.entries(rows)) {
      const kb = v.bytes > 2000 ? `${(v.bytes / 1024).toFixed(1)} KB` : `${v.bytes} bytes`;
      console.log(`  ${k.padEnd(22)} ${kb.padStart(10)}   ${v.actual}`);
    }
  } finally {
    await browser.close();
  }
}
