// PURE. The remote desk viewer's protocol half — no DOM, no network, no
// timers of its own (every clock and scheduler is injected). It lives in
// lib/server only because that folder is marked ESM, so plain node can import
// it: scripts/remotedesk-check.mjs drives every function here without a
// browser, and lib/remoteDesk.js re-exports it for the admin.
//
// The contract is docs/superpowers/specs/2026-10-11-remote-os-design.md,
// "Milestone 1 contract". The supervisor enforces its own limits; the ones
// here are so a well-behaved viewer never meets them.

export const PROTOCOL_VERSION = 1;
export const MAX_MSG_BYTES = 512;
export const MAX_CLIP_BYTES = 64 * 1024;
// The server allows 400/s. Staying well under it means a burst of typing on
// top of a moving pointer never reaches the server's limiter at all.
export const MAX_RATE = 250;
export const BURST = 40;
export const QUEUE_LIMIT = 256;
export const HEARTBEAT_MS = 2000;
export const STATS_MS = 1000;
export const MAX_RETRIES = 3;

export const PROFILES = [
  { id: "720p30", width: 1280, height: 720, fps: 30 },
  { id: "1080p30", width: 1920, height: 1080, fps: 30 },
  { id: "1080p60", width: 1920, height: 1080, fps: 60, alone: true },
];
export const profileById = (id) => PROFILES.find((p) => p.id === id) || null;

export const SESSION_STATES = ["CREATING", "READY", "CONNECTED", "IDLE", "STOPPING", "STOPPED", "FAILED"];
// Can a viewer attach? Only to a desktop that is up.
export const viewable = (state) => state === "READY" || state === "CONNECTED" || state === "IDLE";
export const stoppable = (state) => state === "CREATING" || viewable(state);
export const isLive = (state) => state !== "STOPPED" && state !== "FAILED";

/* ---------------- geometry ---------------- */

// The box the PICTURE occupies inside an element drawn with
// `object-fit: contain` (centred). Everything outside it is letterbox, and a
// click there is a click on nothing. `rect` is a getBoundingClientRect(), so
// CSS transforms, page zoom and fullscreen are already in it; device pixel
// ratio does not matter, because the rect and the pointer are both in CSS
// pixels and the answer is a fraction.
export function contentBox(rect, videoWidth, videoHeight) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  if (!(videoWidth > 0) || !(videoHeight > 0)) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;
const clamp01 = (n) => Math.min(1, Math.max(0, n));

// A pointer position → 0..1 of the picture. `inside` says whether it landed
// on the picture; `clamp` pins a point in the letterbox to the nearest edge
// (right for a drag that leaves the picture, wrong for a press).
export function normalisePoint({ clientX, clientY }, rect, videoWidth, videoHeight, { clamp = false } = {}) {
  const box = contentBox(rect, videoWidth, videoHeight);
  if (!box || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const fx = (clientX - box.left) / box.width;
  const fy = (clientY - box.top) / box.height;
  const inside = fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1;
  if (!inside && !clamp) return { x: round5(fx), y: round5(fy), inside: false };
  return { x: round5(clamp01(fx)), y: round5(clamp01(fy)), inside };
}

// Pointer lock gives movement, not position: keep a virtual cursor in
// picture fractions and move it by the movement over the picture's size.
export function movePointer(prev, movementX, movementY, box) {
  if (!box || !(box.width > 0) || !(box.height > 0)) return prev;
  const p = prev || { x: 0.5, y: 0.5 };
  return { x: round5(clamp01(p.x + (movementX || 0) / box.width)), y: round5(clamp01(p.y + (movementY || 0) / box.height)) };
}

/* ---------------- keys, buttons, wheel ---------------- */

// Shortcuts the BROWSER keeps for itself. Sending them is pointless (the page
// never sees most of them reliably) and preventing them would trap the owner
// in a tab, so they are neither sent nor prevented.
export function isReserved(e) {
  const code = e.code || "";
  if (code === "F11") return true;
  const mod = !!(e.ctrlKey || e.metaKey);
  if (mod && (code === "KeyW" || code === "KeyT" || code === "KeyN" || code === "KeyQ")) return true;
  if (e.ctrlKey && code === "Tab") return true;
  if (e.metaKey && (code === "KeyH" || code === "KeyM" || code === "Tab")) return true;
  return false;
}

// KeyboardEvent → the wire's {t, code, key}, or null for what must not go.
// Everything else passes through untouched: the server maps code+key to a
// keysym, so the viewer does not second-guess layouts.
export function keyMessage(e, kind = "down") {
  if (!e) return null;
  if (e.isComposing || e.key === "Process" || e.keyCode === 229) return null;
  const code = String(e.code || "");
  const key = String(e.key || "");
  if (!code && (!key || key === "Unidentified")) return null;
  if (isReserved(e)) return null;
  return { t: kind === "up" ? "ku" : "kd", code: code.slice(0, 40), key: key.slice(0, 32) };
}

// DOM MouseEvent.button → X button: 0 left → 1, 1 middle → 2, 2 right → 3.
export function xButton(domButton) {
  return domButton === 0 ? 1 : domButton === 1 ? 2 : domButton === 2 ? 3 : 0;
}

// Wheel deltas in notches. A trackpad sends many small pixel deltas; they are
// accumulated so a slow two-finger scroll still scrolls, and only whole
// notches go on the wire.
export function makeWheel() {
  let ax = 0;
  let ay = 0;
  return function wheel({ deltaX = 0, deltaY = 0, deltaMode = 0 }) {
    // one notch = 100 px, 3 lines, or 1 page
    const k = deltaMode === 1 ? 1 / 3 : deltaMode === 2 ? 1 : 1 / 100;
    ax += deltaX * k;
    ay += deltaY * k;
    const dx = ax > 0 ? Math.floor(ax) : Math.ceil(ax);
    const dy = ay > 0 ? Math.floor(ay) : Math.ceil(ay);
    ax -= dx;
    ay -= dy;
    const cap = (n) => Math.max(-10, Math.min(10, n));
    return dx || dy ? { dx: cap(dx), dy: cap(dy) } : null;
  };
}

/* ---------------- bytes ---------------- */

export function utf8Bytes(s) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
  return unescape(encodeURIComponent(s)).length;
}

/* ---------------- the input sender ---------------- */

// Owns the `input` DataChannel's discipline:
//   - every message gets v:1 and a seq assigned AT SEND TIME, so seq order is
//     wire order even when the limiter holds something back
//   - pointer moves are coalesced: only the newest position waits, and it
//     goes once per animation frame (schedule is requestAnimationFrame)
//   - a token bucket keeps the total under MAX_RATE; discrete events (keys,
//     buttons, wheel) are never dropped, only queued (bounded — overflow sends
//     rel and clears, because a queue that long is a stuck link, and keys
//     replayed late are worse than keys released)
//   - held keys and buttons are tracked so a ku/pu for something never sent
//     is not sent, and rel clears them
//   - rel, hb, clip, res bypass the limiter: they are rare and must not wait
//     behind a backlog
export class InputSender {
  constructor({
    send,
    now = () => Date.now(),
    schedule = (fn) => (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(fn) : setTimeout(fn, 16)),
    later = (fn, ms) => setTimeout(fn, ms),
    rate = MAX_RATE,
    burst = BURST,
    queueLimit = QUEUE_LIMIT,
  } = {}) {
    this._send = send;
    this.now = now;
    this.schedule = schedule;
    this.later = later;
    this.rate = rate;
    this.burst = burst;
    this.queueLimit = queueLimit;
    this.seq = 0;
    this.tokens = burst;
    this.lastFill = now();
    this.queue = [];
    this.pendingMove = null;
    this.moveScheduled = false;
    this.pumpTimer = false;
    this.keys = new Set();
    this.buttons = new Set();
    this.counts = { sent: 0, coalesced: 0, refused: 0, overflow: 0 };
    this.open = true;
  }

  _fill() {
    const t = this.now();
    const dt = Math.max(0, t - this.lastFill);
    this.lastFill = t;
    this.tokens = Math.min(this.burst, this.tokens + (dt * this.rate) / 1000);
  }
  _take() {
    this._fill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  // Encode and send now. Returns the message sent, or null if refused.
  _emit(body, limit = MAX_MSG_BYTES) {
    if (!this.open) return null;
    const msg = { v: PROTOCOL_VERSION, seq: this.seq + 1, ...body };
    const s = JSON.stringify(msg);
    if (utf8Bytes(s) > limit) {
      this.counts.refused += 1;
      return null;
    }
    this.seq += 1;
    this.counts.sent += 1;
    try {
      this._send(s, msg);
    } catch (_) {
      // a channel that closed under us: the server releases on close
    }
    return msg;
  }

  _pump() {
    while (this.queue.length && this._take()) this._emit(this.queue.shift());
    if (this.queue.length && !this.pumpTimer) {
      this.pumpTimer = true;
      const wait = Math.max(1, Math.ceil(((1 - this.tokens) * 1000) / this.rate));
      this.later(() => {
        this.pumpTimer = false;
        this._pump();
      }, wait);
    }
  }

  _discrete(body) {
    if (!this.open) return false;
    if (this.queue.length >= this.queueLimit) {
      this.counts.overflow += 1;
      this.releaseAll("overflow");
      return false;
    }
    this.queue.push(body);
    this._pump();
    return true;
  }

  // The newest position wins; it goes on the next frame.
  move(x, y) {
    if (!this.open) return;
    if (this.pendingMove) this.counts.coalesced += 1;
    this.pendingMove = { x, y };
    if (!this.moveScheduled) {
      this.moveScheduled = true;
      this.schedule(() => this.flushMove());
    }
  }
  flushMove() {
    this.moveScheduled = false;
    const m = this.pendingMove;
    if (!m) return;
    // Behind a backlog of discrete events a move would jump the queue, so it
    // waits its turn as the queue's last item instead.
    if (this.queue.length) {
      this.pendingMove = null;
      this._discrete({ t: "pm", x: m.x, y: m.y });
      return;
    }
    if (this._take()) {
      this.pendingMove = null;
      this._emit({ t: "pm", x: m.x, y: m.y });
    } else {
      this.moveScheduled = true;
      this.schedule(() => this.flushMove());
    }
  }
  // A move that is still waiting goes BEFORE a key or wheel, so the remote
  // pointer is where the owner sees it. A button carries its own position, so
  // the waiting move is simply superseded.
  _moveFirst() {
    if (!this.pendingMove) return;
    const m = this.pendingMove;
    this.pendingMove = null;
    this._discrete({ t: "pm", x: m.x, y: m.y });
  }

  buttonDown(b, x, y) {
    if (!b) return false;
    this.pendingMove = null;
    this.buttons.add(b);
    return this._discrete({ t: "pd", b, x, y });
  }
  buttonUp(b, x, y) {
    if (!this.buttons.has(b)) return false;
    this.pendingMove = null;
    this.buttons.delete(b);
    return this._discrete({ t: "pu", b, x, y });
  }
  wheel(dx, dy) {
    if (!dx && !dy) return false;
    this._moveFirst();
    return this._discrete({ t: "wh", dx, dy });
  }
  keyDown(code, key) {
    this._moveFirst();
    this.keys.add(code);
    return this._discrete({ t: "kd", code, key });
  }
  keyUp(code, key) {
    if (!this.keys.has(code)) return false;
    this.keys.delete(code);
    return this._discrete({ t: "ku", code, key });
  }
  held() {
    return this.keys.size + this.buttons.size;
  }

  // Drops anything not yet sent (it would arrive stale) and lets go of
  // everything. Sent even with nothing held: it costs one message and the
  // server's view of "held" may differ from ours.
  releaseAll(reason = "") {
    this.queue = [];
    this.pendingMove = null;
    this.keys.clear();
    this.buttons.clear();
    this.lastRelease = reason;
    return this._emit({ t: "rel" });
  }
  heartbeat() {
    return this._emit({ t: "hb" });
  }
  clipboard(text) {
    const s = String(text == null ? "" : text);
    return this._emit({ t: "clip", text: s }, MAX_CLIP_BYTES);
  }
  pullClipboard() {
    return this._emit({ t: "clip?" });
  }
  profile(id) {
    if (!profileById(id)) return null;
    return this._emit({ t: "res", profile: id });
  }
  close() {
    this.open = false;
    this.queue = [];
    this.pendingMove = null;
  }
}

/* ---------------- release-all triggers ---------------- */

// Everything that means "the owner's hands just left": the window lost focus,
// the tab was hidden, the page is going away. Returns the unbinder.
export function bindReleaseTriggers({ win, doc, onRelease }) {
  const blur = () => onRelease("blur");
  const vis = () => {
    if (doc.visibilityState === "hidden") onRelease("hidden");
  };
  const hide = () => onRelease("pagehide");
  win.addEventListener("blur", blur);
  doc.addEventListener("visibilitychange", vis);
  win.addEventListener("pagehide", hide);
  return () => {
    win.removeEventListener("blur", blur);
    doc.removeEventListener("visibilitychange", vis);
    win.removeEventListener("pagehide", hide);
  };
}

/* ---------------- stats ---------------- */

// RTCStatsReport values → the readout. `prev` is the previous call's `next`;
// rates are deltas over the reports' own timestamps, never over wall time
// guessed here. A field the browser does not report stays null — shown as
// nothing, never as zero.
export function summariseStats(reports, prev = null) {
  const list = Array.isArray(reports) ? reports : Array.from(reports || []);
  const inbound = list.find((r) => r.type === "inbound-rtp" && (r.kind === "video" || r.mediaType === "video"));
  const transport = list.find((r) => r.type === "transport" && r.selectedCandidatePairId);
  let pair = transport ? list.find((r) => r.id === transport.selectedCandidatePairId) : null;
  if (!pair) pair = list.find((r) => r.type === "candidate-pair" && (r.selected || (r.nominated && r.state === "succeeded")));
  if (!inbound) return { fps: null, kbps: null, rttMs: pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null, jitterMs: null, lossPct: null, decodeMs: null, width: null, height: null, next: null };

  const ts = inbound.timestamp || 0;
  const cur = {
    ts,
    bytes: inbound.bytesReceived || 0,
    lost: Math.max(0, inbound.packetsLost || 0),
    recv: inbound.packetsReceived || 0,
    frames: inbound.framesDecoded || 0,
    decode: inbound.totalDecodeTime || 0,
  };
  const dt = prev && ts > prev.ts ? (ts - prev.ts) / 1000 : 0;
  const d = (k) => (prev ? cur[k] - prev[k] : 0);

  let fps = inbound.framesPerSecond != null ? inbound.framesPerSecond : null;
  if (fps == null && dt > 0) fps = d("frames") / dt;
  const kbps = dt > 0 && d("bytes") >= 0 ? (d("bytes") * 8) / dt / 1000 : null;
  const pkts = d("lost") + d("recv");
  const lossPct = prev && pkts > 0 ? (Math.max(0, d("lost")) / pkts) * 100 : prev ? 0 : null;
  const decodeMs = prev && d("frames") > 0 ? (d("decode") / d("frames")) * 1000 : null;

  return {
    fps: fps == null ? null : Math.round(fps * 10) / 10,
    kbps: kbps == null ? null : Math.round(kbps),
    rttMs: pair && pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
    jitterMs: inbound.jitter != null ? Math.round(inbound.jitter * 1000 * 10) / 10 : null,
    lossPct: lossPct == null ? null : Math.round(lossPct * 10) / 10,
    decodeMs: decodeMs == null ? null : Math.round(decodeMs * 10) / 10,
    width: inbound.frameWidth || null,
    height: inbound.frameHeight || null,
    next: cur,
  };
}

// The meter: one length for "how is the picture getting here". The worst of
// three things decides it — round trip, loss, and frame rate against the
// profile's — and the verdict colours it.
export function linkVerdict(s, targetFps = 30) {
  if (!s || (s.fps == null && s.rttMs == null)) return { level: "idle", meter: 0.05, words: "no measurements yet" };
  const rttPart = s.rttMs == null ? 1 : 1 - Math.min(1, s.rttMs / 800);
  const lossPart = s.lossPct == null ? 1 : 1 - Math.min(1, s.lossPct / 10);
  const fpsPart = s.fps == null || !targetFps ? 1 : Math.min(1, s.fps / targetFps);
  const meter = Math.max(0.05, Math.min(rttPart, lossPart, fpsPart));
  const slow = (s.lossPct != null && s.lossPct >= 5) || (s.rttMs != null && s.rttMs >= 400) || (s.jitterMs != null && s.jitterMs >= 80);
  return {
    level: slow ? "slow" : "good",
    meter: Math.round(meter * 100) / 100,
    words: slow ? "the link is struggling" : "the link is healthy",
  };
}

// The supervisor's own numbers, from {t:"stats"} on the status channel. The
// units are the server's: `bitrate` is bit/s, `encodeMs` is a mean over the
// last second, and captured / encoded / dropped are CUMULATIVE since the
// pipeline started — so a rate is a difference over the time between two
// messages. `at` is when this message arrived (the server stamps none);
// `prev` is the previous call's `next`. A counter that went DOWN means a new
// pipeline (a renegotiation, a reconnect): no rate for that interval, rather
// than a negative one.
export function serverStats(msg, at, prev = null) {
  if (!msg || msg.t !== "stats") return null;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const cur = { at, captured: num(msg.captured), encoded: num(msg.encoded), dropped: num(msg.dropped) };
  const dt = prev && at > prev.at ? (at - prev.at) / 1000 : 0;
  const rate = (k) => {
    if (!dt || cur[k] == null || prev[k] == null || cur[k] < prev[k]) return null;
    return Math.round(((cur[k] - prev[k]) / dt) * 10) / 10;
  };
  const bitrate = num(msg.bitrate);
  return {
    kbps: bitrate == null ? null : Math.round(bitrate / 1000),
    capKbps: num(msg.bitrateCapKbps),
    encodeMs: num(msg.encodeMs) == null ? null : Math.round(msg.encodeMs * 10) / 10,
    fps: num(msg.fps),
    capturedFps: rate("captured"),
    encodedFps: rate("encoded"),
    droppedPerSec: rate("dropped"),
    droppedTotal: cur.dropped,
    rejected: num(msg.rejected),
    keyframes: num(msg.keyframes),
    width: num(msg.width),
    height: num(msg.height),
    profile: typeof msg.profile === "string" ? msg.profile : null,
    next: cur,
  };
}

// A size-changing profile request is refused by the box
// (profile/needs-restart: Xvfb cannot resize). The way through is a NEW
// session at that size, beside the running one. This is that offer: the name
// it would get, and whether the box has room for it with the old one still
// running (it counts, so 1080p60 — alone only — never fits beside it).
export function restartPlan(from, profileId, view) {
  const p = profileById(profileId);
  if (!p) return { allowed: false, reason: "Unknown profile.", name: "", profile: profileId };
  const base = String((from && (from.name || from.id)) || "desk").replace(/-(720p30|1080p30|1080p60)$/, "");
  const name = `${base}-${p.id}`.slice(0, 60);
  const verdict = view && view.profiles && view.profiles[p.id];
  if (verdict && !verdict.allowed) {
    const why = p.alone ? `${p.id} runs only when it is the only session, and ${from?.name || "this one"} is still running.` : verdict.reason;
    return { allowed: false, reason: why, name, profile: p.id };
  }
  return { allowed: true, reason: "", name, profile: p.id };
}

export function fmtKbps(kbps) {
  if (kbps == null) return "";
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbit/s` : `${Math.round(kbps)} kbit/s`;
}

/* ---------------- capacity ---------------- */

// The server's /capacity, or — if it sent no per-profile verdicts — the same
// rules derived here: at most `max` live sessions, and 1080p60 only alone.
export function capacityView(cap, sessions = []) {
  const live = sessions.filter((s) => isLive(s.state)).length;
  const max = cap && Number.isFinite(cap.max) ? cap.max : 3;
  const running = cap && Number.isFinite(cap.running) ? cap.running : live;
  const profiles = {};
  for (const p of PROFILES) {
    const given = cap && cap.profiles && cap.profiles[p.id];
    if (given && typeof given.allowed === "boolean") {
      profiles[p.id] = { allowed: given.allowed, reason: given.reason || "" };
    } else if (running >= max) {
      profiles[p.id] = { allowed: false, reason: `The box is full: ${running} of ${max} sessions are running.` };
    } else if (p.alone && running > 0) {
      profiles[p.id] = { allowed: false, reason: "1080p60 runs only when it is the only session." };
    } else {
      profiles[p.id] = { allowed: true, reason: "" };
    }
  }
  return { max, running, full: running >= max, profiles };
}

// For a profile CHANGE on a running session: the session itself does not
// count against "alone".
export function canSwitchTo(profileId, view, sessionCount) {
  const p = profileById(profileId);
  if (!p) return { allowed: false, reason: "Unknown profile." };
  if (p.alone && sessionCount > 1) return { allowed: false, reason: "1080p60 runs only when it is the only session." };
  return { allowed: true, reason: "" };
}

/* ---------------- errors ---------------- */

const CLOSE = {
  4401: { code: "auth/refused", what: "The desk refused your sign-in.", todo: "Sign out and in again. The account must be on the agent allow-list." },
  4403: { code: "auth/forbidden", what: "The desk does not allow this account or this page.", todo: "Check the allow-list on the box, and that this origin is one the supervisor accepts." },
  4404: { code: "session/not-found", what: "That session is not running: it was stopped, or it does not exist.", todo: "Refresh the list and pick another, or start one." },
  4409: { code: "session/replaced", what: "Another viewer took this session.", todo: "Reconnect to take it back." },
};
export function closeReason(code) {
  return CLOSE[code] || null;
}

// Any failure → what happened, and what to do about it. Nothing apologises
// and nothing is vague.
export function explainError(err = {}, { host = "desk.ravikishan.me" } = {}) {
  const code = err.code || "";
  if (code === "net/unreachable")
    return { code, what: `${host} did not answer.`, todo: "The supervisor or its tunnel may be down. Try again, or switch to the legacy stream.", legacy: true };
  if (code === "net/cors")
    return { code, what: `${host} answered, but not to this page.`, todo: "The supervisor must send CORS headers for this origin (see the Remote OS contract).", legacy: true };
  if (code === "capacity/full") return { code, what: err.error || "The box is full.", todo: "Stop a session before starting another." };
  if (code === "session/not-found") return { code, what: "That session is not running: it was stopped, or it does not exist.", todo: "Refresh the list and pick another, or start one." };
  if (code === "profile/unknown") return { code, what: err.error || "The box does not know that profile.", todo: "Pick 720p30, 1080p30 or 1080p60." };
  if (code === "ice/failed")
    return { code, what: "The video could not get through the relay.", todo: "coturn on the box may be down, or this network blocks TCP 443 to it. Reconnect, or use the legacy stream.", legacy: true };
  if (code === "signal/timeout") return { code, what: "The desk accepted the connection but never sent a picture.", todo: "Reconnect. If it repeats, the session's pipeline did not start — stop it and start a new one." };
  if (code === "signal/failed")
    return { code, what: `Lost the connection to ${host} three times in a row.`, todo: "Nothing retries now. Reconnect when it is back, or use the legacy stream.", legacy: true };
  if (code === "signal/refused")
    return {
      code,
      what: `${host} refused this page, or could not be reached.`,
      todo: "The desk accepts only www.ravikishan.me, ravikishan.me and localhost:3000, and refuses any other origin before the socket opens. From one of those, the desk or its tunnel is down. Nothing retries now.",
      legacy: true,
    };
  if (code === "session/stopped") return { code, what: "This session was stopped.", todo: "It will not come back. Start another below, or view a different one." };
  if (code === "profile/needs-restart")
    return { code, what: err.error || "A running desktop cannot change size.", todo: "That size needs a new session. Start one beside this one." };
  if (code === "auth/stale-sign-in")
    return { code, what: "The desk is ignoring your input: your sign-in is more than 30 minutes old.", todo: "Sign in again and driving resumes." };
  if (code === "auth/no-user") return { code, what: "You are not signed in.", todo: "Sign in to the admin again." };
  if (/^auth\//.test(code)) return { code, what: err.error || "The desk refused your sign-in.", todo: "Sign out and in again. The account must be on the agent allow-list." };
  const closed = closeReason(err.closeCode);
  if (closed) return closed;
  return { code: code || "unknown", what: err.error || err.message || "Something failed.", todo: "Try again." };
}

/* ---------------- sessions ---------------- */

export function sessionList(body) {
  const rows = Array.isArray(body) ? body : body && Array.isArray(body.sessions) ? body.sessions : [];
  return rows.filter((s) => s && s.id).map((s) => ({ ...s, state: String(s.state || "").toUpperCase() }));
}
