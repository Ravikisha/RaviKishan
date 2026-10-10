// npm run test:remotedesk — the remote desk viewer's protocol half, with no
// browser and no network: pointer normalisation (letterbox cases), key
// pass-through and the reserved shortcuts, the input sender's seq / size /
// rate discipline and coalescing, release-all triggers, stats, capacity,
// and the error sentences; then the supervisor as built (server stats in
// bit/s with cumulative counters, renegotiate vs needs-restart, stopped /
// 4404 / refused-origin closes, re-auth on the open socket), the last driven
// through the REAL DeskConnection against a scripted desk.
import {
  contentBox,
  normalisePoint,
  movePointer,
  keyMessage,
  isReserved,
  xButton,
  makeWheel,
  InputSender,
  bindReleaseTriggers,
  summariseStats,
  linkVerdict,
  capacityView,
  canSwitchTo,
  explainError,
  closeReason,
  sessionList,
  utf8Bytes,
  MAX_MSG_BYTES,
  MAX_CLIP_BYTES,
  MAX_RATE,
  viewable,
  stoppable,
  serverStats,
  restartPlan,
  fmtKbps,
} from "../lib/server/remoteDeskShape.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let pass = 0;
let fail = 0;
const failures = [];
function check(ok, name, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

/* ---------------- geometry ---------------- */
console.log("\ncontent box and pointer normalisation");
{
  // exact fit: no letterbox
  const b = contentBox(rect(0, 0, 1600, 900), 1920, 1080);
  check(near(b.left, 0) && near(b.top, 0) && near(b.width, 1600) && near(b.height, 900), "a 16:9 picture in a 16:9 box fills it");

  // pillarbox: element wider than the picture
  const p = contentBox(rect(100, 50, 2000, 900), 1920, 1080);
  check(near(p.height, 900) && near(p.width, 1600) && near(p.left, 300) && near(p.top, 50), "a wider box pillarboxes: bars left and right", JSON.stringify(p));

  // letterbox: element taller than the picture
  const l = contentBox(rect(0, 0, 1280, 1000), 1280, 720);
  check(near(l.width, 1280) && near(l.height, 720) && near(l.top, 140) && near(l.left, 0), "a taller box letterboxes: bars top and bottom", JSON.stringify(l));

  const centre = normalisePoint({ clientX: 640, clientY: 500 }, rect(0, 0, 1280, 1000), 1280, 720);
  check(near(centre.x, 0.5) && near(centre.y, 0.5) && centre.inside, "the box centre is the picture centre");
  const topLeft = normalisePoint({ clientX: 0, clientY: 140 }, rect(0, 0, 1280, 1000), 1280, 720);
  check(near(topLeft.x, 0) && near(topLeft.y, 0) && topLeft.inside, "the picture's top-left corner is 0,0 — not the element's");
  const bar = normalisePoint({ clientX: 640, clientY: 60 }, rect(0, 0, 1280, 1000), 1280, 720);
  check(bar && !bar.inside, "a point in the letterbox is not on the picture");
  const clamped = normalisePoint({ clientX: 640, clientY: 60 }, rect(0, 0, 1280, 1000), 1280, 720, { clamp: true });
  check(clamped.inside === false && near(clamped.x, 0.5) && near(clamped.y, 0), "clamped, a letterbox point pins to the nearest edge (for drags)", JSON.stringify(clamped));
  const pill = normalisePoint({ clientX: 300 + 400, clientY: 50 + 675 }, rect(100, 50, 2000, 900), 1920, 1080);
  check(near(pill.x, 0.25) && near(pill.y, 0.75), "pillarboxed: offsets account for the bar and the element's position", JSON.stringify(pill));
  const pillBar = normalisePoint({ clientX: 150, clientY: 400 }, rect(100, 50, 2000, 900), 1920, 1080);
  check(!pillBar.inside, "and a click in the side bar is off the picture");

  // DPR / zoom: the rect and the pointer are both CSS px, so a 2x screen or a
  // 150% zoom changes neither fraction.
  const dpr1 = normalisePoint({ clientX: 480, clientY: 270 }, rect(0, 0, 960, 540), 1920, 1080);
  const zoomed = normalisePoint({ clientX: 320, clientY: 180 }, rect(0, 0, 640, 360), 1920, 1080);
  check(near(dpr1.x, zoomed.x) && near(dpr1.y, zoomed.y) && near(dpr1.x, 0.5), "the same spot reads the same fraction at any zoom");
  // fullscreen on a 16:10 display: letterboxed top and bottom
  const fs1610 = normalisePoint({ clientX: 1440, clientY: 90 + 1620 }, rect(0, 0, 2880, 1800), 1920, 1080);
  check(near(fs1610.x, 0.5) && near(fs1610.y, 1) && fs1610.inside, "full screen on 16:10: the picture's bottom edge is y=1, above the bar", JSON.stringify(fs1610));
  // a 4:3 iPad in fullscreen
  const ipad = contentBox(rect(0, 0, 1024, 768), 1920, 1080);
  check(near(ipad.width, 1024) && near(ipad.height, 576) && near(ipad.top, 96), "full screen on 4:3: bars of 96px top and bottom");
  // no metadata yet: the element is the picture
  const noMeta = normalisePoint({ clientX: 50, clientY: 25 }, rect(0, 0, 100, 50), 0, 0);
  check(near(noMeta.x, 0.5) && near(noMeta.y, 0.5), "before the video reports its size, the element box is used");
  check(normalisePoint({ clientX: 1, clientY: 1 }, rect(0, 0, 0, 0), 1920, 1080) === null, "a zero-size element normalises nothing");
  check(normalisePoint({ clientX: NaN, clientY: 1 }, rect(0, 0, 10, 10), 10, 10) === null, "a non-number pointer normalises nothing");
  const fine = normalisePoint({ clientX: 1, clientY: 1 }, rect(0, 0, 3, 3), 3, 3);
  check(String(fine.x).length <= 7, "fractions are rounded so a message stays small", String(fine.x));

  const m = movePointer({ x: 0.5, y: 0.5 }, 160, -90, { width: 1600, height: 900 });
  check(near(m.x, 0.6) && near(m.y, 0.4), "pointer lock: movement moves the virtual cursor by the picture's size");
  const edge = movePointer({ x: 0.99, y: 0.01 }, 1000, -1000, { width: 1600, height: 900 });
  check(edge.x === 1 && edge.y === 0, "and it stops at the picture's edges");
}

/* ---------------- keys ---------------- */
console.log("\nkeys and buttons");
{
  const kd = keyMessage({ code: "KeyA", key: "a" });
  check(kd && kd.t === "kd" && kd.code === "KeyA" && kd.key === "a", "a key passes through as code + key", JSON.stringify(kd));
  const ku = keyMessage({ code: "KeyA", key: "a" }, "up");
  check(ku && ku.t === "ku", "and its release as ku");
  for (const [code, key, mods] of [
    ["Enter", "Enter", {}],
    ["Escape", "Escape", {}],
    ["F5", "F5", {}],
    ["KeyL", "l", { ctrlKey: true }],
    ["KeyC", "c", { ctrlKey: true }],
    ["Tab", "Tab", { altKey: true }],
    ["ArrowLeft", "ArrowLeft", { shiftKey: true }],
    ["Digit2", "@", { shiftKey: true }],
    ["IntlBackslash", "<", {}],
    ["MetaLeft", "Meta", {}],
  ]) {
    const m = keyMessage({ code, key, ...mods });
    check(!!m && m.code === code && m.key === key, `passes through: ${Object.keys(mods).join("+")}${Object.keys(mods).length ? "+" : ""}${code}`);
  }
  for (const [code, mods, label] of [
    ["KeyW", { ctrlKey: true }, "Ctrl+W"],
    ["KeyT", { ctrlKey: true }, "Ctrl+T"],
    ["KeyN", { ctrlKey: true }, "Ctrl+N"],
    ["KeyQ", { ctrlKey: true }, "Ctrl+Q"],
    ["KeyT", { ctrlKey: true, shiftKey: true }, "Ctrl+Shift+T"],
    ["KeyN", { ctrlKey: true, shiftKey: true }, "Ctrl+Shift+N"],
    ["Tab", { ctrlKey: true }, "Ctrl+Tab"],
    ["Tab", { ctrlKey: true, shiftKey: true }, "Ctrl+Shift+Tab"],
    ["KeyW", { metaKey: true }, "Cmd+W"],
    ["KeyH", { metaKey: true }, "Cmd+H"],
    ["KeyM", { metaKey: true }, "Cmd+M"],
    ["Tab", { metaKey: true }, "Cmd+Tab"],
    ["F11", {}, "F11"],
  ]) {
    check(isReserved({ code, ...mods }) && keyMessage({ code, key: "x", ...mods }) === null, `browser-reserved, never sent: ${label}`);
  }
  check(!isReserved({ code: "KeyW" }) && !!keyMessage({ code: "KeyW", key: "w" }), "a plain W is just a W");
  check(keyMessage({ code: "KeyA", key: "Process", isComposing: true }) === null, "an IME composition is not sent as keys");
  check(keyMessage({ code: "", key: "Unidentified" }) === null, "an unidentified key with no code is dropped");
  const long = keyMessage({ code: "KeyA", key: "x".repeat(200) });
  check(long.key.length <= 32, "a key string is capped");
  check(xButton(0) === 1 && xButton(1) === 2 && xButton(2) === 3 && xButton(3) === 0, "DOM buttons 0/1/2 → X buttons 1/2/3, others nothing");

  const wheel = makeWheel();
  check(JSON.stringify(wheel({ deltaY: 100 })) === JSON.stringify({ dx: 0, dy: 1 }), "a 100px wheel step is one notch");
  const tp = makeWheel();
  const parts = [tp({ deltaY: 30 }), tp({ deltaY: 30 }), tp({ deltaY: 30 }), tp({ deltaY: 30 })];
  check(parts.slice(0, 3).every((x) => x === null) && parts[3] && parts[3].dy === 1, "trackpad pixels accumulate into a whole notch", JSON.stringify(parts));
  check(makeWheel()({ deltaY: -3, deltaMode: 1 }).dy === -1, "3 lines up is one notch up");
  check(makeWheel()({ deltaY: 100000 }).dy === 10, "a huge fling is capped at 10 notches per event");
}

/* ---------------- the sender ---------------- */
console.log("\ninput sender: seq, size, rate, coalescing");
{
  const mkClock = () => {
    let t = 0;
    const timers = [];
    return {
      now: () => t,
      later: (fn, ms) => timers.push({ at: t + ms, fn }),
      // a millisecond at a time, so a timer set by a timer runs on time
      advance(ms) {
        for (let i = 0; i < ms; i += 1) {
          t += 1;
          for (;;) {
            timers.sort((a, b) => a.at - b.at);
            const due = timers[0];
            if (!due || due.at > t) break;
            timers.shift();
            due.fn();
          }
        }
      },
    };
  };
  const make = (opts = {}) => {
    const clock = mkClock();
    const frames = [];
    const sent = [];
    const s = new InputSender({
      send: (str, msg) => sent.push({ str, msg }),
      now: clock.now,
      later: clock.later,
      schedule: (fn) => frames.push(fn),
      ...opts,
    });
    const frame = () => frames.splice(0).forEach((f) => f());
    return { s, sent, frame, clock };
  };

  {
    const { s, sent, frame } = make();
    s.keyDown("KeyA", "a");
    s.keyUp("KeyA", "a");
    s.move(0.1, 0.2);
    frame();
    s.heartbeat();
    s.releaseAll();
    const seqs = sent.map((x) => x.msg.seq);
    check(seqs.every((q, i) => q === i + 1), "seq starts at 1 and goes up by one per message", seqs.join(","));
    check(sent.every((x) => x.msg.v === 1), "every message is v:1");
    check(sent.every((x) => JSON.parse(x.str).seq === x.msg.seq), "and the wire carries the same seq");
    check(sent.every((x) => utf8Bytes(x.str) <= MAX_MSG_BYTES), "and every message is within 512 bytes");
    check(sent.map((x) => x.msg.t).join(",") === "kd,ku,pm,hb,rel", "in the order they were made", sent.map((x) => x.msg.t).join(","));
  }
  {
    const { s, sent, frame } = make();
    for (let i = 0; i < 50; i += 1) s.move(i / 100, i / 100);
    check(sent.length === 0, "moves wait for the animation frame");
    frame();
    check(sent.length === 1 && near(sent[0].msg.x, 0.49), "fifty moves in a frame become ONE, the newest", JSON.stringify(sent.map((x) => x.msg)));
    check(s.counts.coalesced === 49, "and the other 49 are counted as coalesced");
  }
  {
    const { s, sent, frame } = make();
    s.move(0.3, 0.3);
    s.keyDown("ShiftLeft", "Shift");
    check(sent.length === 2 && sent[0].msg.t === "pm" && sent[1].msg.t === "kd", "a waiting move goes BEFORE a key, so the pointer is where you see it");
    frame();
    check(sent.length === 2, "and is not sent twice");
    s.move(0.4, 0.4);
    s.buttonDown(1, 0.41, 0.41);
    frame();
    check(sent.length === 3 && sent[2].msg.t === "pd" && near(sent[2].msg.x, 0.41), "a button carries its own position and supersedes a waiting move");
  }
  {
    const { s, sent } = make();
    check(s.keyUp("KeyZ", "z") === false && sent.length === 0, "a ku for a key never pressed is not sent");
    check(s.buttonUp(1, 0, 0) === false && sent.length === 0, "nor a pu for a button never pressed");
    s.keyDown("KeyZ", "z");
    s.keyDown("KeyZ", "z");
    check(sent.length === 2 && s.held() === 1, "auto-repeat sends kd again but holds the key once");
    s.buttonDown(3, 0.5, 0.5);
    check(s.held() === 2, "held counts keys and buttons");
    s.releaseAll("blur");
    check(s.held() === 0 && sent[sent.length - 1].msg.t === "rel", "release-all sends rel and forgets what was held");
    check(s.keyUp("KeyZ", "z") === false, "and a late ku after it is not sent");
  }
  {
    const { s, sent } = make();
    const big = "x".repeat(600);
    s.keyDown("KeyA", big);
    check(sent.length === 0 && s.counts.refused === 1, "a message over 512 bytes is refused before it is sent, and counted");
    s.keyDown("KeyB", "b");
    check(sent.length === 1 && sent[0].msg.seq === 1, "and a refused message burns no seq");
    const clip = s.clipboard("é".repeat(20000));
    check(!!clip && utf8Bytes(JSON.stringify(clip)) > MAX_MSG_BYTES, "clip has its own limit: a 40 KB clipboard goes");
    const before = sent.length;
    check(s.clipboard("x".repeat(MAX_CLIP_BYTES)) === null && sent.length === before, "and one over 64 KB is refused");
    check(s.profile("1080p60") && sent[sent.length - 1].msg.t === "res" && sent[sent.length - 1].msg.profile === "1080p60", "a profile change is t:res");
    check(s.profile("4k") === null, "and an unknown profile is not sent");
    const pull = s.pullClipboard();
    check(pull && pull.t === "clip?", "a clipboard pull is t:clip? with a seq");
  }
  {
    // the limiter: a 1000-key burst at t=0 → only the burst goes now, the
    // rest drain at MAX_RATE, none dropped, seq still strictly increasing
    const { s, sent, clock } = make({ queueLimit: 5000 });
    for (let i = 0; i < 1000; i += 1) s.keyDown(`Key${i}`, "k");
    check(sent.length === 40, "a burst sends at most the bucket's 40 at once", String(sent.length));
    clock.advance(1000);
    const perSec = sent.length - 40;
    check(perSec <= MAX_RATE + 1 && perSec >= MAX_RATE - 2, `then drains at ${MAX_RATE}/s, under the server's 400/s`, String(perSec));
    clock.advance(4000);
    check(sent.length === 1000, "and every key arrives: discrete events are queued, never dropped", String(sent.length));
    const seqs = sent.map((x) => x.msg.seq);
    check(seqs.every((q, i) => i === 0 || q === seqs[i - 1] + 1), "seq stays strictly increasing through the queue");
    // windowed rate: no 1000ms window holds more than MAX_RATE + burst
    const { s: s2, sent: sent2, clock: c2 } = make({ queueLimit: 5000 });
    const times = [];
    const origSend = s2._send;
    s2._send = (str, msg) => {
      times.push(c2.now());
      origSend(str, msg);
    };
    for (let i = 0; i < 2000; i += 1) s2.wheel(0, 1);
    c2.advance(10000);
    let worst = 0;
    for (let i = 0; i < times.length; i += 1) {
      let j = i;
      while (j < times.length && times[j] - times[i] < 1000) j += 1;
      worst = Math.max(worst, j - i);
    }
    check(worst <= MAX_RATE + 40 && sent2.length === 2000, "no one-second window carries more than the rate plus the burst", `${worst} in the worst second`);
  }
  {
    const { s, sent, frame, clock } = make();
    // pointer moves under a saturated bucket: still one per frame, never a backlog
    for (let i = 0; i < 40; i += 1) s.keyDown(`K${i}`, "k");
    s.move(0.9, 0.9);
    frame();
    const pms = () => sent.filter((x) => x.msg.t === "pm").length;
    check(pms() <= 1, "a move behind a backlog waits its turn instead of jumping it");
    clock.advance(500);
    frame();
    check(pms() === 1, "and is sent once, after the keys");
  }
  {
    const { s, sent } = make({ queueLimit: 10 });
    for (let i = 0; i < 60; i += 1) s.keyDown(`K${i}`, "k");
    const rels = sent.filter((x) => x.msg.t === "rel").length;
    check(rels >= 1 && s.counts.overflow >= 1, "a queue that overflows sends rel and clears, rather than replaying stale keys late");
  }
  {
    const { s, sent } = make();
    for (let i = 0; i < 40; i += 1) s.keyDown(`K${i}`, "k");
    const n = sent.length;
    s.heartbeat();
    s.releaseAll();
    check(sent.length === n + 2, "hb and rel bypass an empty bucket");
  }
  {
    const { s, sent } = make();
    s.close();
    s.keyDown("KeyA", "a");
    s.move(0.1, 0.1);
    s.heartbeat();
    check(sent.length === 0, "a closed sender sends nothing");
    let threw = 0;
    const t = new InputSender({
      send: () => {
        threw += 1;
        throw new Error("channel closed");
      },
    });
    t.heartbeat();
    check(threw === 1, "a channel that throws on send does not throw into the page");
  }
}

/* ---------------- release triggers ---------------- */
console.log("\nrelease-all triggers");
{
  class Target {
    constructor() {
      this.l = {};
    }
    addEventListener(t, f) {
      (this.l[t] = this.l[t] || new Set()).add(f);
    }
    removeEventListener(t, f) {
      this.l[t]?.delete(f);
    }
    fire(t) {
      for (const f of this.l[t] || []) f({ type: t });
    }
    count() {
      return Object.values(this.l).reduce((n, s) => n + s.size, 0);
    }
  }
  const win = new Target();
  const doc = new Target();
  doc.visibilityState = "visible";
  const got = [];
  const off = bindReleaseTriggers({ win, doc, onRelease: (r) => got.push(r) });
  win.fire("blur");
  check(got.join() === "blur", "window blur releases");
  doc.fire("visibilitychange");
  check(got.length === 1, "a visibilitychange to VISIBLE does not");
  doc.visibilityState = "hidden";
  doc.fire("visibilitychange");
  check(got[1] === "hidden", "a hidden tab releases");
  win.fire("pagehide");
  check(got[2] === "pagehide", "pagehide releases");
  off();
  win.fire("blur");
  check(got.length === 3 && win.count() === 0 && doc.count() === 0, "unbinding removes every listener");

  // and the sender those triggers drive
  const sent = [];
  const s = new InputSender({ send: (_, m) => sent.push(m), schedule: () => {} });
  s.keyDown("ControlLeft", "Control");
  s.buttonDown(1, 0.5, 0.5);
  const off2 = bindReleaseTriggers({ win, doc, onRelease: (r) => s.releaseAll(r) });
  win.fire("blur");
  check(sent[sent.length - 1].t === "rel" && s.held() === 0 && s.lastRelease === "blur", "a blur with Ctrl and a button held sends rel and clears both");
  off2();

  // source checks: the panel binds them, and the other hand-offs release too
  const here = path.dirname(fileURLToPath(import.meta.url));
  const panel = fs.readFileSync(path.join(here, "..", "components", "admin", "RemoteDesk.js"), "utf8");
  const conn = fs.readFileSync(path.join(here, "..", "lib", "remoteDesk.js"), "utf8");
  check(/bindReleaseTriggers\(\{ win: window, doc: document/.test(panel), "the viewer binds blur / hidden / pagehide while driving");
  check(/releaseAll\("watch"\)/.test(panel), "Drive → Watch releases");
  check(/releaseAll\("focus"\)/.test(panel), "the picture losing focus while driving releases");
  check(/releaseAll\("disconnect"\)/.test(conn) && conn.indexOf('releaseAll("disconnect")') < conn.indexOf('_signal({ type: "bye" })'), "Disconnect releases BEFORE saying bye");
  check(/releaseAll\("drop"\)/.test(conn), "a dropped connection releases before tearing down");
  check(/iceTransportPolicy: "relay"/.test(conn), "the peer connection is relay-only");
  check(/\{ type: "auth", token \}/.test(conn) && /ws\.onopen = \(\) => \{[\s\S]{0,80}_signal\(\{ type: "auth", token \}\)/.test(conn), "the first signalling message is the auth");
  check(/setInterval\(\(\) => sender\.heartbeat\(\), HEARTBEAT_MS\)/.test(conn), "heartbeat every HEARTBEAT_MS while the channel is open");
  const ctor = conn.slice(conn.indexOf("class DeskConnection"), conn.indexOf("connect() {"));
  check(!/WebSocketImpl\(|_open\(\)/.test(ctor.slice(ctor.indexOf("constructor("))), "constructing a DeskConnection opens nothing");
  check(!/connectNow\(\)|\.connect\(\)/.test(panel.slice(0, panel.indexOf("const connectNow"))), "the viewer calls connect only from handlers, after Connect");
}

/* ---------------- stats ---------------- */
console.log("\nstats");
{
  const r1 = [
    { type: "inbound-rtp", kind: "video", timestamp: 1000, bytesReceived: 0, packetsLost: 0, packetsReceived: 0, framesDecoded: 0, totalDecodeTime: 0, jitter: 0.004, frameWidth: 1920, frameHeight: 1080 },
    { type: "transport", selectedCandidatePairId: "cp1" },
    { type: "candidate-pair", id: "cp1", currentRoundTripTime: 0.042 },
  ];
  const s1 = summariseStats(r1, null);
  check(s1.rttMs === 42 && s1.jitterMs === 4 && s1.width === 1920 && s1.kbps === null && s1.lossPct === null, "the first sample: RTT, jitter, size — no rates yet", JSON.stringify(s1));
  const r2 = [
    { type: "inbound-rtp", kind: "video", timestamp: 2000, bytesReceived: 250000, packetsLost: 3, packetsReceived: 297, framesDecoded: 30, totalDecodeTime: 0.09, jitter: 0.006, frameWidth: 1920, frameHeight: 1080 },
    { type: "transport", selectedCandidatePairId: "cp1" },
    { type: "candidate-pair", id: "cp1", currentRoundTripTime: 0.05 },
  ];
  const s2 = summariseStats(r2, s1.next);
  check(s2.kbps === 2000, "bitrate is the byte delta over the reports' own timestamps", String(s2.kbps));
  check(s2.fps === 30, "fps from the frames-decoded delta when the browser gives none", String(s2.fps));
  check(s2.lossPct === 1, "loss is lost / (lost + received) over the interval", String(s2.lossPct));
  check(s2.decodeMs === 3, "decode ms is decode time per decoded frame", String(s2.decodeMs));
  const ff = summariseStats([{ type: "inbound-rtp", mediaType: "video", timestamp: 1, framesPerSecond: 59.94 }, { type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.1 }], null);
  check(ff.fps === 59.9 && ff.rttMs === 100, "browser-given fps is used, and a nominated pair stands in without a transport");
  const none = summariseStats([], null);
  check(none.fps === null && none.kbps === null, "no video yet: nothing, never zeros");
  const good = linkVerdict({ fps: 30, rttMs: 40, lossPct: 0, jitterMs: 3 }, 30);
  const bad = linkVerdict({ fps: 12, rttMs: 450, lossPct: 7, jitterMs: 30 }, 30);
  check(good.level === "good" && good.meter > 0.9 && bad.level === "slow" && bad.meter < 0.5, "the meter: long and healthy on a good link, short and slow on a bad one", `${good.meter} / ${bad.meter}`);
  check(linkVerdict(null).level === "idle" && linkVerdict(null).meter > 0, "no data reads idle, with a visible stub");
}

/* ---------------- capacity, sessions, errors ---------------- */
console.log("\ncapacity, sessions, errors");
{
  const empty = capacityView({ max: 3, running: 0 });
  check(Object.values(empty.profiles).every((p) => p.allowed), "an empty box allows every profile");
  const one = capacityView({ max: 3, running: 1 });
  check(one.profiles["1080p30"].allowed && !one.profiles["1080p60"].allowed && /only/.test(one.profiles["1080p60"].reason), "with one running, 1080p60 is refused: it runs only alone");
  const full = capacityView({ max: 3, running: 3 });
  check(full.full && !full.profiles["720p30"].allowed && /3 of 3/.test(full.profiles["720p30"].reason), "a full box refuses everything and says how full");
  const given = capacityView({ max: 3, running: 1, profiles: { "1080p60": { allowed: true } } });
  check(given.profiles["1080p60"].allowed, "the server's own verdict wins when it sends one");
  const derived = capacityView(null, [{ state: "READY" }, { state: "STOPPED" }, { state: "FAILED" }]);
  check(derived.running === 1 && derived.max === 3, "no /capacity: running derived from live sessions only");
  check(canSwitchTo("1080p60", null, 1).allowed && !canSwitchTo("1080p60", null, 2).allowed, "switching to 1080p60 is allowed only for the only session");
  check(sessionList({ sessions: [{ id: "a", state: "ready" }] })[0].state === "READY" && sessionList([{ id: "b", state: "IDLE" }]).length === 1, "sessions accepted as {sessions:[…]} or a bare array, states upper-cased");
  check(sessionList({ nope: 1 }).length === 0, "an unknown body is an empty list, not a crash");
  check(viewable("READY") && viewable("IDLE") && viewable("CONNECTED") && !viewable("STOPPING") && !viewable("FAILED"), "only a desktop that is up can be viewed");
  check(stoppable("CREATING") && !stoppable("STOPPED") && !stoppable("STOPPING"), "only a live one can be stopped");

  const net = explainError({ code: "net/unreachable" });
  check(/did not answer/.test(net.what) && /legacy/.test(net.todo) && net.legacy, "unreachable: says so, and offers the legacy stream");
  const ice = explainError({ code: "ice/failed" });
  check(/relay/.test(ice.what) && /443/.test(ice.todo) && ice.legacy, "ICE failure names the relay and port");
  check(/full/i.test(explainError({ code: "capacity/full", error: "The box is full: 3 of 3." }).what), "capacity/full repeats the server's sentence");
  check(/Stop a session/.test(explainError({ code: "capacity/full" }).todo), "and says what to do");
  check(closeReason(4401).code === "auth/refused" && closeReason(4409).code === "session/replaced" && closeReason(1006) === null, "WS close codes 4401/4403/4404/4409 are explained; others are drops");
  const any = explainError({ message: "boom" });
  check(any.what === "boom" && any.todo, "anything else still says what happened and what to do");
  for (const c of ["net/unreachable", "net/cors", "capacity/full", "session/not-found", "profile/unknown", "ice/failed", "signal/timeout", "signal/failed", "auth/refused"]) {
    const e = explainError({ code: c });
    check(!!e.what && !!e.todo && !/sorry|oops/i.test(e.what + e.todo), `${c}: a what and a todo, no apology`);
  }
}

/* ---------------- the supervisor as built ---------------- */
console.log("\nserver stats: units and cumulative counters");
{
  const m1 = { t: "stats", fps: 30, bitrate: 2400000, encodeMs: 7.46, captured: 300, encoded: 299, dropped: 1, bitrateCapKbps: 4500, rejected: 0 };
  const a = serverStats(m1, 10000, null);
  check(a.kbps === 2400, "bitrate arrives in bit/s: 2,400,000 reads as 2400 kbit/s", String(a.kbps));
  check(fmtKbps(a.kbps) === "2.4 Mbit/s", "and prints as 2.4 Mbit/s, not 2400 Mbit/s", fmtKbps(a.kbps));
  check(a.capturedFps === null && a.encodedFps === null && a.droppedPerSec === null, "one sample of cumulative counters gives no rate yet");
  check(a.droppedTotal === 1 && a.encodeMs === 7.5 && a.capKbps === 4500, "the total, the encode mean and the cap are kept", JSON.stringify(a));
  const b = serverStats({ ...m1, captured: 330, encoded: 328, dropped: 2 }, 11000, a.next);
  check(b.capturedFps === 30 && b.encodedFps === 29 && b.droppedPerSec === 1, "rates are differences over the time between two messages", JSON.stringify(b));
  const c = serverStats({ ...m1, captured: 600, encoded: 598, dropped: 2 }, 12000, b.next);
  check(c.droppedPerSec === 0 && c.droppedTotal === 2, "a total that did not move is 0/s, however large it is", JSON.stringify(c));
  const reset = serverStats({ ...m1, captured: 30, encoded: 30, dropped: 0 }, 13000, c.next);
  check(reset.capturedFps === null && reset.droppedPerSec === null, "a counter that went DOWN (a new pipeline) gives no rate, never a negative one", JSON.stringify(reset));
  check(serverStats({ t: "clip", text: "x" }, 1) === null && serverStats(null, 1) === null, "anything that is not t:stats is not stats");
  const half = serverStats({ t: "stats", bitrate: "lots" }, 1, null);
  check(half.kbps === null && half.encodeMs === null, "a field that is not a number stays empty, never zero");
}

console.log("\nprofile changes: renegotiate vs needs-restart");
{
  const view = capacityView({ max: 3, running: 2 });
  const from = { id: "s_k", name: "kontainer", profile: "1080p30" };
  const p = restartPlan(from, "720p30", view);
  check(p.allowed && p.name === "kontainer-720p30" && p.profile === "720p30", "a refused size becomes a NEW session named after the old one", JSON.stringify(p));
  const again = restartPlan({ name: "kontainer-720p30", profile: "720p30" }, "1080p30", view);
  check(again.name === "kontainer-1080p30", "and a second move does not stack suffixes", again.name);
  const sixty = restartPlan(from, "1080p60", capacityView({ max: 3, running: 1 }));
  check(!sixty.allowed && /only session/.test(sixty.reason) && /kontainer/.test(sixty.reason), "1080p60 never fits beside the running one, and it says which one", sixty.reason);
  const full = restartPlan(from, "720p30", capacityView({ max: 3, running: 3 }));
  check(!full.allowed && /3 of 3/.test(full.reason), "a full box refuses the new session and says how full", full.reason);
  check(!restartPlan(from, "4k", view).allowed, "an unknown profile is no plan");
  check(restartPlan({ id: "x".repeat(80) }, "720p30", view).name.length <= 60, "the name stays within the 60 characters the form allows");
  const nr = explainError({ code: "profile/needs-restart" });
  check(/cannot change size/.test(nr.what) && /new session/.test(nr.todo), "needs-restart says plainly that this size needs a new session", `${nr.what} ${nr.todo}`);
}

console.log("\nclose codes and refusals, as built");
{
  check(/stopped/.test(closeReason(4404).what) && /does not exist/.test(closeReason(4404).what), "4404 covers not found AND not running", closeReason(4404).what);
  const stopped = explainError({ code: "session/stopped" });
  check(/was stopped/.test(stopped.what) && !/reconnect/i.test(stopped.todo), "a stopped session says so, and does not suggest reconnecting", `${stopped.what} ${stopped.todo}`);
  const ref = explainError({ code: "signal/refused" }, { host: "desk.example.test" });
  check(/refused this page/.test(ref.what) && /www\.ravikishan\.me/.test(ref.todo) && /localhost:3000/.test(ref.todo) && /Nothing retries/.test(ref.todo) && ref.legacy, "a refused upgrade names the origins the desk accepts, and stops", ref.todo);
  const st = explainError({ code: "auth/stale-sign-in" });
  check(/30 minutes/.test(st.what) && /Sign in again/.test(st.todo), "a stale sign-in says what the desk is doing and how to bring it back", st.what);
  check(closeReason(1000) === null && closeReason(1006) === null, "1000 and 1006 are not refusals by code alone");
}

/* ---------------- DeskConnection against a scripted supervisor ---------------- */
// The real lib/remoteDesk.js, with only its Firebase import replaced, driven
// through a fake WebSocket and RTCPeerConnection that behave like the box.
console.log("\nthe connection, against a scripted desk");
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, "..", "lib", "remoteDesk.js"), "utf8");
  const shapeUrl = pathToFileURL(path.join(here, "..", "lib", "server", "remoteDeskShape.js")).href;
  const patched = src.replace(/^import \{ auth \} from "\.\/firebase";$/m, "const auth = { currentUser: null };").replace(/from "\.\/server\/remoteDeskShape"/g, `from ${JSON.stringify(shapeUrl)}`);
  check(patched !== src && !/\.\/firebase/.test(patched), "(loaded the real DeskConnection with Firebase stubbed)");
  const tmp = path.join(os.tmpdir(), `remoteDesk-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, patched);
  const { DeskConnection } = await import(pathToFileURL(tmp).href);
  fs.unlinkSync(tmp);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await wait(10);
    }
    return false;
  };

  // A desk: answers auth with the TURN list, ready with an offer, and lets
  // the test push anything on the socket or the status channel.
  function makeDesk({ refuse = false } = {}) {
    const desk = { sockets: [], pcs: [], signal: [], input: [] };
    class WS {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        desk.sockets.push(this);
        desk.ws = this;
        setTimeout(() => {
          if (refuse) {
            this.readyState = 3;
            this.onclose && this.onclose({ code: 1006, reason: "" });
            return;
          }
          this.readyState = 1;
          this.onopen && this.onopen();
        }, 2);
      }
      push(m) {
        setTimeout(() => this.readyState === 1 && this.onmessage && this.onmessage({ data: JSON.stringify(m) }), 1);
      }
      send(str) {
        const m = JSON.parse(str);
        desk.signal.push(m);
        if (m.type === "auth" && !this.authed) {
          this.authed = true;
          this.push({ type: "ice-servers", iceServers: [{ urls: ["turn:192.0.2.1:443?transport=tcp"] }], policy: "relay" });
        }
        if (m.type === "ready") this.push({ type: "offer", sdp: "v=0" });
      }
      serverClose(code, reason = "") {
        this.readyState = 3;
        setTimeout(() => this.onclose && this.onclose({ code, reason }), 1);
      }
      close() {
        this.readyState = 3;
      }
    }
    class PC {
      constructor(cfg) {
        this.cfg = cfg;
        this.connectionState = "new";
        desk.pcs.push(this);
      }
      async setRemoteDescription() {}
      async addIceCandidate() {}
      async createAnswer() {
        return { type: "answer", sdp: "v=0 answer" };
      }
      async setLocalDescription(a) {
        this.localDescription = a;
        setTimeout(() => {
          if (this.connectionState === "closed") return;
          const input = { label: "input", readyState: "open", send: (s) => desk.input.push({ pc: desk.pcs.indexOf(this), ...JSON.parse(s) }) };
          this.status = { label: "status", readyState: "open" };
          this.ondatachannel && this.ondatachannel({ channel: this.status });
          this.ondatachannel && this.ondatachannel({ channel: input });
          this.input = input;
          this.connectionState = "connected";
          this.onconnectionstatechange && this.onconnectionstatechange();
        }, 3);
      }
      async getStats() {
        return [];
      }
      close() {
        this.connectionState = "closed";
        if (this.input) this.input.readyState = "closed";
        this.closed = true;
      }
    }
    return { desk, WS, PC };
  }
  const tokens = [];
  const token = async (fresh) => {
    tokens.push(!!fresh);
    return fresh ? "fresh-token" : "token";
  };

  // 1. renegotiate: same socket, new peer, ready again, input re-armed after release-all
  {
    const { desk, WS, PC } = makeDesk();
    const states = [];
    const c = new DeskConnection({ base: "https://desk.test", token, sessionId: "s1", WebSocketImpl: WS, PeerConnectionImpl: PC, onState: (s) => states.push(s), schedule: (fn) => setTimeout(fn, 0) });
    c.connect();
    check(await until(() => c.state === "live" && c.sender), "connects and goes live with an input channel");
    c.sender.keyDown("ShiftLeft", "Shift");
    const sentBefore = desk.input.length;
    desk.ws.push({ type: "renegotiate", profile: "1080p60", width: 1920, height: 1080, fps: 60 });
    check(await until(() => states.some((s) => s.status === "switching")), "a renegotiate puts the viewer in switching");
    const sw = states.find((s) => s.status === "switching");
    check(sw.profile === "1080p60" && sw.fps === 60 && sw.input === false, "naming the new profile, with input disarmed", JSON.stringify(sw));
    check(desk.input.slice(sentBefore).some((m) => m.t === "rel" && m.pc === 0), "release-all goes on the OLD channel before it is dropped");
    check(desk.pcs[0].closed, "the old RTCPeerConnection is closed");
    check(desk.sockets.length === 1, "the signalling socket is kept: no new WebSocket");
    check(await until(() => desk.signal.filter((m) => m.type === "ready").length === 2), "ready is sent again on the same socket", desk.signal.map((m) => m.type).join(","));
    check(await until(() => desk.pcs.length === 2 && c.state === "live" && c.sender), "a new peer is built and goes live");
    check(desk.pcs[1].cfg.iceTransportPolicy === "relay" && desk.pcs[1].cfg.iceServers.length === 1, "with the same relay-only TURN list (none is re-sent)", JSON.stringify(desk.pcs[1].cfg));
    check(desk.signal.filter((m) => m.type === "auth").length === 1, "and without authenticating again");
    const onNew = desk.input.filter((m) => m.pc === 1);
    check(onNew[0] && onNew[0].t === "rel" && onNew.some((m) => m.t === "hb"), "the new channel starts with release-all, then heartbeats", onNew.map((m) => m.t).join(","));
    const fromSwitch = states.slice(states.findIndex((s) => s.status === "switching")).map((s) => s.status);
    check(!fromSwitch.includes("negotiating") && !fromSwitch.includes("signalling"), "the new offer is still part of the switch: no fall back to negotiating (which would drop Drive)", fromSwitch.join(","));
    const liveAgain = states.filter((s) => s.status === "live").pop();
    check(liveAgain && liveAgain.input === true, "and reports input re-armed once it is open");
    c.sender.keyDown("KeyA", "a");
    check(desk.input.some((m) => m.pc === 1 && m.t === "kd" && m.code === "KeyA"), "keys flow on the new channel");
    c.close();
  }

  // 2. bye "session stopped" then 1000: stopped, no retries
  {
    const { desk, WS, PC } = makeDesk();
    const states = [];
    const c = new DeskConnection({ base: "https://desk.test", token, sessionId: "s2", WebSocketImpl: WS, PeerConnectionImpl: PC, onState: (s) => states.push(s) });
    c.connect();
    await until(() => c.state === "live");
    desk.ws.push({ type: "bye", reason: "session stopped" });
    setTimeout(() => desk.ws.serverClose(1000, "session stopped"), 5);
    check(await until(() => c.state === "stopped"), "bye {reason: session stopped} ends the view as stopped", c.state);
    await wait(1300);
    check(desk.sockets.length === 1 && c.state === "stopped" && !c.wanted, "and nothing retries", `${desk.sockets.length} sockets`);
    check(states.some((s) => s.status === "stopped" && s.code === "session/stopped"), "with the code the panel explains");
  }
  {
    const { desk, WS, PC } = makeDesk();
    const c = new DeskConnection({ base: "https://desk.test", token, sessionId: "s3", WebSocketImpl: WS, PeerConnectionImpl: PC });
    c.connect();
    await until(() => c.state === "live");
    desk.pcs[0].connectionState = "checking"; // not carrying media: a close would otherwise retry
    desk.ws.serverClose(1000, "session stopped");
    check(await until(() => c.state === "stopped"), "a bare 1000 whose reason says stopped is stopped too", c.state);
  }
  {
    const { desk, WS, PC } = makeDesk();
    const states = [];
    const c = new DeskConnection({ base: "https://desk.test", token, sessionId: "s4", WebSocketImpl: WS, PeerConnectionImpl: PC, onState: (s) => states.push(s) });
    c.connect();
    await until(() => c.state === "live");
    desk.ws.serverClose(4404, "not running");
    check(await until(() => c.state === "failed"), "4404 fails at once");
    await wait(1300);
    check(desk.sockets.length === 1 && states.pop().closeCode === 4404, "and is not retried: a session that is not running stays not running");
  }

  // 3. 1006 with no open, three times: the origin/unreachable verdict
  {
    const { desk, WS, PC } = makeDesk({ refuse: true });
    const states = [];
    const c = new DeskConnection({ base: "https://desk.test", token, sessionId: "s5", WebSocketImpl: WS, PeerConnectionImpl: PC, onState: (s) => states.push(s) });
    c.connect();
    check(await until(() => c.state === "failed", 6000), "a socket refused before it opens fails after the retries", c.state);
    check(desk.sockets.length === 3, "after exactly three attempts", String(desk.sockets.length));
    const last = states.pop();
    check(last.code === "signal/refused" && last.closeCode === 1006, "as refused-or-unreachable, not as a dropped connection", JSON.stringify(last));
    check(states.filter((s) => s.status === "reconnecting").length === 2, "with the tries counted on the way");
  }
  {
    // 1006 AFTER a socket opened is a drop, not a refusal
    const { desk, WS, PC } = makeDesk();
    const states = [];
    const c = new DeskConnection({ base: "https://desk.test", token, sessionId: "s6", WebSocketImpl: WS, PeerConnectionImpl: PC, onState: (s) => states.push(s), signalTimeoutMs: 15000 });
    c.connect();
    await until(() => c.state === "live");
    desk.pcs[0].connectionState = "checking";
    desk.ws.serverClose(1006);
    check(await until(() => states.some((s) => s.status === "reconnecting")), "a 1006 after the socket had opened is a drop, and is retried");
    c.close();
  }

  // 4. re-auth on the open socket
  {
    const { desk, WS, PC } = makeDesk();
    const c = new DeskConnection({ base: "https://desk.test", token, sessionId: "s7", WebSocketImpl: WS, PeerConnectionImpl: PC });
    tokens.length = 0;
    c.connect();
    await until(() => c.state === "live");
    const ok = await c.reauth();
    const auths = desk.signal.filter((m) => m.type === "auth");
    check(ok && auths.length === 2 && auths[1].token === "fresh-token", "reauth sends a FRESH token as {type:auth} on the open socket", JSON.stringify(auths.map((a) => a.token)));
    check(tokens[tokens.length - 1] === true, "having asked Firebase to force a refresh (a new auth_time)");
    check(desk.sockets.length === 1 && desk.pcs.length === 1 && c.state === "live", "and nothing reconnects: same socket, same peer, still live");
    desk.ws.push({ type: "ice-servers", iceServers: [{ urls: ["turn:192.0.2.9:443?transport=tcp"] }], policy: "relay" });
    await wait(30);
    check(desk.pcs.length === 1 && !desk.pcs[0].closed, "a TURN list arriving mid-session does not rebuild the peer");
    c.close();
  }
}

console.log("\nthe panel, as built against the supervisor");
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const panel = fs.readFileSync(path.join(here, "..", "components", "admin", "RemoteDesk.js"), "utf8");
  const conf = panel.slice(panel.indexOf("const confirmStepUp"), panel.indexOf("// The hands-left triggers"));
  check(conf.indexOf("d.reauth()") >= 0 && conf.indexOf("d.reauth()") < conf.indexOf("c.reauth()") && conf.indexOf("c.reauth()") < conf.indexOf("setDriveState(true)"), "step-up: sign in, THEN the fresh token on the socket, THEN Drive resumes");
  check(/code === "auth\/stale-sign-in"[\s\S]{0,200}releaseAll\("stale"\)[\s\S]{0,80}setDriveState\(false\)[\s\S]{0,40}setStepUp\("server"\)/.test(panel), "the desk's stale-sign-in releases, stops driving, and asks for the sign-in");
  check(/code === "profile\/needs-restart"/.test(panel) && /api\.create\(\{ name: plan\.name, profile: plan\.profile \}, r\.key\)/.test(panel), "needs-restart offers a new session, created with the offer's own Idempotency-Key");
  check(/press\(onStopOld\)/.test(panel), "and stopping the old one takes two taps");
  check(/Switching to \$\{conn\.profile/.test(panel), "a renegotiation is shown as Switching to <profile>");
  check(/serverStats\(m, Date\.now\(\), serverPrev\.current\)/.test(panel) && !/server\.dropped \?\?/.test(panel), "server counters are shown as rates, never as raw cumulative totals");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log("failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
