// DESIGN PREVIEWS ONLY (/__workbenchpreview, /__jarvispreview). A stand-in
// for agentd's push stream that a fake client can mix in: real JPEG bytes,
// packed in the real wire format ([u32 BE header length][JSON header][JPEG])
// and read back through the REAL parseFrame, so the preview exercises the
// same decode → canvas → ack path the admin does against the box.
//
// Everything it is asked is kept on window under `key` (starts, stops,
// updates, acks) so the e2e suites can read back what the view did.
import { parseFrame } from "../../../lib/agentClient";

async function jpegOf(svg, width, height, label) {
  const img = new Image();
  img.src = `data:image/svg+xml;base64,${window.btoa(svg)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  // A changing corner, so consecutive frames really differ.
  ctx.fillStyle = "#1b2430";
  ctx.fillRect(width - 90, height - 18, 90, 18);
  ctx.fillStyle = "#c9d1dc";
  ctx.font = "11px sans-serif";
  ctx.fillText(label, width - 84, height - 5);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.7));
  return new Uint8Array(await blob.arrayBuffer());
}

export function packFrame(header, bytes = new Uint8Array(0)) {
  const h = new TextEncoder().encode(JSON.stringify(header));
  const buf = new ArrayBuffer(4 + h.length + bytes.length);
  new DataView(buf).setUint32(0, h.length);
  new Uint8Array(buf, 4, h.length).set(h);
  new Uint8Array(buf, 4 + h.length).set(bytes);
  return buf;
}

// → the stream half of a fake client: {on, desktopStreamStart,
// desktopStreamUpdate, desktopStreamStop, desktopStreamAck, stopStream}.
export function fakeDesktopStream({ svg, key = "__fakeStream", screen = { width: 1600, height: 900 }, everyMs = 400 } = {}) {
  const listeners = new Set();
  const log = (window[key] = { starts: [], stops: 0, updates: [], acks: [], frames: 0 });
  let timer = null;
  let seq = 0;
  let opts = { fps: 8, scale: 0.5, quality: 65 };
  const emit = (buf) => {
    const f = parseFrame(buf);
    if (!f) return;
    const frame = { ...f, receivedAt: Date.now() };
    for (const fn of [...listeners]) fn(frame);
  };
  const tick = async () => {
    const w = Math.max(2, Math.round(screen.width * opts.scale));
    const h = Math.max(2, Math.round(screen.height * opts.scale));
    const bytes = await jpegOf(svg, w, h, new Date().toLocaleTimeString());
    if (!timer) return;
    seq += 1;
    log.frames += 1;
    emit(packFrame({ seq, takenAt: Date.now() - 40, imageWidth: w, imageHeight: h, width: screen.width, height: screen.height, skipped: 0 }, bytes));
  };
  const stopStream = () => {
    clearInterval(timer);
    timer = null;
  };
  return {
    on(event, fn) {
      if (event !== "frame") return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async desktopStreamStart(o = {}) {
      log.starts.push(o);
      opts = { ...opts, ...o };
      stopStream();
      timer = setInterval(tick, everyMs);
      tick();
      return { type: "desktop.stream.started", ...screen, ...opts, source: "ffmpeg", at: Date.now() };
    },
    desktopStreamUpdate(o = {}) {
      log.updates.push(o);
      opts = { ...opts, ...o };
    },
    desktopStreamStop() {
      log.stops += 1;
      stopStream();
    },
    desktopStreamAck(s) {
      log.acks.push(s);
    },
    stopStream,
  };
}
