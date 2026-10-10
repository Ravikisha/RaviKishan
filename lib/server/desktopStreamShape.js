// PURE and browser-safe (it lives in lib/server only because that folder is
// ESM, so plain node — e2e:workbench — can import it without a bundler).
//
// The viewer's half of agentd's desktop push stream: reading a binary frame,
// and deciding what to ask the box for. agent/src/desktop.js holds the box's
// half (packFrame, flow control, capture); the wire format is shared:
//
//   [u32 BE header length][UTF-8 JSON header][JPEG bytes]
//   header {seq, takenAt, imageWidth, imageHeight, width, height, skipped}
//   a keepalive is {keepalive: true, …} with no image, and is not acked.

export const MAX_HEADER = 16 * 1024;

// → {header, image: Uint8Array} or null for anything malformed.
export function parseFrame(buf) {
  if (!buf || typeof buf.byteLength !== "number" || buf.byteLength < 4) return null;
  const dv = new DataView(buf);
  const n = dv.getUint32(0);
  if (n < 2 || n > MAX_HEADER || 4 + n > buf.byteLength) return null;
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
  } catch (_) {
    return null;
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) return null;
  return { header, image: new Uint8Array(buf, 4 + n) };
}

// The quality ladder. Level 0 is what a healthy link gets; each step down
// trades pixels and JPEG quality (and, near the bottom, rate) for a frame
// that arrives at all. `mul` multiplies the scale the pane needs.
export const STREAM_LEVELS = [
  { mul: 1, quality: 65, fps: 8 },
  { mul: 0.85, quality: 55, fps: 8 },
  { mul: 0.7, quality: 45, fps: 6 },
  { mul: 0.55, quality: 38, fps: 5 },
  { mul: 0.4, quality: 30, fps: 4 },
];

// Even a large 2x pane does not get the full-size screen by default: at
// q:v 6 an 800 px frame measured ~90 KB on the box, and the owner's link is
// ~200 ms away. Level 0 tops out here.
export const STREAM_MAX_SCALE = 0.6;

// The bounds agentd enforces (assertStreamOptions refuses outside them).
export const BOUNDS = { fps: [1, 15], scale: [0.25, 1], quality: [30, 90] };

// The settings for a ladder level and a pane that wants `fit`. Always inside
// BOUNDS, scale in 0.05 steps so a pixel of resize does not restart capture.
export function streamSettings(level, fit = 0.5) {
  const l = STREAM_LEVELS[Math.max(0, Math.min(STREAM_LEVELS.length - 1, Math.trunc(Number(level) || 0)))];
  const base = Math.min(STREAM_MAX_SCALE, Number(fit) > 0 ? Number(fit) : 0.5);
  const scale = Math.min(1, Math.max(0.25, Math.round(base * l.mul * 20) / 20));
  return { fps: l.fps, scale, quality: l.quality };
}

// How the link is doing over the last 3 s of frames:
//   idle  nothing arrived (an unchanged screen sends nothing — not slowness)
//   slow  the box held frames back for flow control (header.skipped), or
//         they arrive late (median > 900 ms)
//   ok    otherwise
// Arrival RATE alone cannot say "slow": the box drops duplicate frames at the
// source, so a still screen and a choked link both deliver few frames. The
// box's own count of frames it held back can tell them apart.
export const LINK_WINDOW_MS = 3000;
export function assessLink(samples = [], now = Date.now()) {
  const recent = samples.filter((s) => now - s.at <= LINK_WINDOW_MS);
  if (!recent.length) return "idle";
  const skipped = recent.reduce((n, s) => n + (s.skipped || 0), 0);
  const lat = recent
    .map((s) => s.latency)
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
  const median = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
  if (skipped >= 2 || median > 900) return "slow";
  return "ok";
}

// One adaptation step, called once a second. → {level, slowFor, okFor,
// changed}. Down after 3 s slow, up after 10 s healthy; idle seconds count
// toward neither (a still screen says nothing about the link).
export function adaptStep({ level = 0, slowFor = 0, okFor = 0 } = {}, link, stepMs = 1000) {
  if (link === "slow") {
    const s = slowFor + stepMs;
    if (s >= 3000 && level < STREAM_LEVELS.length - 1) return { level: level + 1, slowFor: 0, okFor: 0, changed: true };
    return { level, slowFor: s, okFor: 0, changed: false };
  }
  if (link === "ok") {
    const o = okFor + stepMs;
    if (o >= 10_000 && level > 0) return { level: level - 1, slowFor: 0, okFor: 0, changed: true };
    return { level, slowFor: 0, okFor: o, changed: false };
  }
  return { level, slowFor, okFor, changed: false };
}

// Box-to-screen delay for one frame. takenAt is the BOX's clock and
// receivedAt ours, so the offset between the clocks (box − local, estimated
// from the start reply's midpoint) has to come out first.
export function frameLatency(takenAt, receivedAt, offset = 0) {
  if (!Number.isFinite(takenAt) || !Number.isFinite(receivedAt)) return NaN;
  return Math.max(0, receivedAt - (takenAt - (Number(offset) || 0)));
}

// The box clock minus ours, from a request sent at t0, answered at t1, whose
// reply says the box's time was `at`.
export function clockOffset(at, t0, t1) {
  return Number.isFinite(at) && Number.isFinite(t0) && Number.isFinite(t1) ? at - (t0 + t1) / 2 : 0;
}
