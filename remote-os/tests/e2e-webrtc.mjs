#!/usr/bin/env node
/* End-to-end WebRTC benchmark for the remote-os supervisor, run FROM THE
 * OWNER'S PC through the real path: REST + signalling over the Cloudflare
 * tunnel (desk.ravikishan.me), media over TURN/TCP 443 (iceTransportPolicy
 * "relay"), decoded by the installed Chrome via puppeteer-core.
 *
 *   REMOTE_OS_BENCH_TOKEN=... node remote-os/tests/e2e-webrtc.mjs [720p30 1080p30 ...]
 *
 * Env:
 *   REMOTE_OS_BENCH_TOKEN  the supervisor's tunnel-only bench token (required)
 *   BASE                   default https://desk.ravikishan.me
 *   SSH_KEY / SSH_HOST     to open test pages inside the session's display
 *                          (default C:/Users/Zimyo/.ssh/oracle-agentd.key, opc@92.4.83.196)
 *   DURATION               motion measurement seconds (default 20)
 *   TRIALS                 latency trials per input kind (default 15)
 *   CHROME_PATH, HEADFUL=1
 *
 * Per profile it creates a session, opens anim.html in that session's
 * display (idle, then full-screen motion), measures over getStats():
 * decoded fps, dropped frames, bitrate, RTT, jitter, decode time, resolution,
 * plus the server's own status-channel stats and the supervisor's CPU; then
 * opens latency.html (whole screen flips black/white on click/key) and times
 * input → changed decoded frame by sampling the <video> into a canvas on
 * every requestVideoFrameCallback. Finally it stops the session.
 *
 * The page is served AS https://www.ravikishan.me/__remoteos-bench through
 * request interception, so the signalling socket carries an Origin on the
 * supervisor's allow-list — the same check a real admin page passes.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "https://desk.ravikishan.me";
const TOKEN = (process.env.REMOTE_OS_BENCH_TOKEN || "").trim();
const SSH_KEY = process.env.SSH_KEY || "C:/Users/Zimyo/.ssh/oracle-agentd.key";
const SSH_HOST = process.env.SSH_HOST || "opc@92.4.83.196";
const DURATION = Number(process.env.DURATION || 20);
const TRIALS = Number(process.env.TRIALS || 15);
const PROFILES = process.argv.slice(2).length ? process.argv.slice(2) : ["720p30", "1080p30"];
const PAGE_URL = "https://www.ravikishan.me/__remoteos-bench";
const CHROME =
  process.env.CHROME_PATH ||
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
  ].find((p) => fs.existsSync(p));

if (!TOKEN) {
  console.error("REMOTE_OS_BENCH_TOKEN is required");
  process.exit(2);
}

let pass = 0;
let fail = 0;
const check = (cond, name, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}`);
  } else {
    fail++;
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
};

async function api(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

function ssh(cmd) {
  return execFileSync("ssh", ["-i", SSH_KEY, "-o", "BatchMode=yes", SSH_HOST, cmd], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function activeSlots() {
  const out = ssh("systemctl list-units --plain --no-legend 'remote-os-session@*' | awk '{print $1}'");
  return out
    .split(/\s+/)
    .map((u) => /remote-os-session@(\d)\.service/.exec(u))
    .filter(Boolean)
    .map((m) => Number(m[1]));
}

// A kiosk Chromium on the session's display, as the session's own user.
function openInSession(slot, page) {
  ssh(
    `sudo pkill -u rdesk${slot} -f ro-bench-chr; sleep 0.5; ` +
      `sudo -u rdesk${slot} env DISPLAY=:2${slot} XAUTHORITY=/run/remote-os-session-${slot}/Xauthority ` +
      `HOME=/home/rdesk${slot} setsid chromium-browser --user-data-dir=/home/rdesk${slot}/.cache/ro-bench-chr ` +
      `--no-first-run --no-default-browser-check --disable-gpu --password-store=basic --kiosk ` +
      `--window-position=0,0 'file:///opt/remote-os/share/${page}' >/dev/null 2>&1 < /dev/null & sleep 6`,
  );
}

function closeInSession(slot) {
  try {
    ssh(`sudo pkill -u rdesk${slot} -f ro-bench-chr; true`);
  } catch {}
}

// CPU seconds of the supervisor process and the session unit's cgroup.
function cpuSample(slot) {
  const out = ssh(
    `P=$(systemctl show -p MainPID --value remote-os); ` +
      `awk '{print $14+$15}' /proc/$P/stat; getconf CLK_TCK; ` +
      `CG=$(systemctl show -p ControlGroup --value remote-os-session@${slot}); ` +
      `awk '/usage_usec/{print $2}' "/sys/fs/cgroup$CG/cpu.stat"; ` +
      // TURN legs: established TCP on :443 (browser -> coturn).
      `ss -Htn state established '( sport = :443 )' | wc -l`,
  );
  const [ticks, hz, usec, tcp443] = out.split(/\s+/).map(Number);
  return { sup: ticks / hz, sess: (usec || 0) / 1e6, t: Date.now() / 1000, tcp443 };
}

// ---- the page --------------------------------------------------------------
const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>remote-os bench</title>
<style>body{margin:0;background:#111}video{width:100%;display:block}</style></head>
<body><video id="v" autoplay playsinline muted></video><canvas id="c" width="32" height="18" style="display:none"></canvas>
<script>
window.bench = {
  log: [], status: [], ws: null, pc: null, input: null, statusDc: null, seq: 0, closeCode: null, iceServers: null,
  async connect(base, id, token) {
    const v = document.getElementById('v');
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/api/v1/sessions/' + id + '/signal');
    this.ws = ws;
    const t0 = performance.now();
    ws.onclose = (e) => { this.closeCode = e.code; };
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws error')); });
    ws.send(JSON.stringify({ type: 'auth', token }));
    const pending = [];
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout; log=' + JSON.stringify(this.log))), 30000);
      ws.onmessage = async (ev) => {
        const m = JSON.parse(ev.data);
        this.log.push(m.type + (m.code ? ':' + m.code : ''));
        if (m.type === 'ice-servers') {
          this.iceServers = m;
          const pc = new RTCPeerConnection({ iceServers: m.iceServers, iceTransportPolicy: 'relay' });
          this.pc = pc;
          pc.ontrack = (e) => { v.srcObject = e.streams[0] || new MediaStream([e.track]); v.play().catch(() => {}); };
          pc.onicecandidate = (e) => { if (e.candidate) ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate.candidate, sdpMLineIndex: e.candidate.sdpMLineIndex, sdpMid: e.candidate.sdpMid })); };
          pc.ondatachannel = (e) => {
            const dc = e.channel;
            if (dc.label === 'input') this.input = dc;
            if (dc.label === 'status') { this.statusDc = dc; dc.onmessage = (x) => { try { this.status.push(JSON.parse(x.data)); } catch {} }; }
          };
          ws.send(JSON.stringify({ type: 'ready' }));
        } else if (m.type === 'offer') {
          await this.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
          for (const c of pending.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
          const ans = await this.pc.createAnswer();
          await this.pc.setLocalDescription(ans);
          ws.send(JSON.stringify({ type: 'answer', sdp: this.pc.localDescription.sdp }));
          this.offerSdp = m.sdp;
        } else if (m.type === 'ice') {
          const c = { candidate: m.candidate, sdpMLineIndex: m.sdpMLineIndex };
          if (this.pc && this.pc.remoteDescription) await this.pc.addIceCandidate(c).catch(() => {}); else pending.push(c);
        }
      };
      const poll = setInterval(() => {
        if (v.videoWidth > 0 && this.input && this.input.readyState === 'open' && this.statusDc && this.statusDc.readyState === 'open') {
          clearInterval(poll); clearTimeout(timer);
          resolve({ ms: Math.round(performance.now() - t0), w: v.videoWidth, h: v.videoHeight, log: this.log });
        }
      }, 20);
    });
  },
  send(o) { this.input.send(JSON.stringify(Object.assign({ v: 1, seq: ++this.seq }, o))); },
  // A bare signalling socket: optional auth message, then wait for close.
  probeWs(base, id, auth, waitMs) {
    return new Promise((r) => {
      const msgs = [];
      const ws = new WebSocket(base.replace(/^http/, 'ws') + '/api/v1/sessions/' + id + '/signal');
      ws.onopen = () => { if (auth != null) ws.send(JSON.stringify({ type: 'auth', token: auth })); };
      ws.onmessage = (e) => { try { const m = JSON.parse(e.data); msgs.push(m.type + (m.code ? ':' + m.code : '')); } catch {} };
      ws.onclose = (e) => r({ code: e.code, msgs });
      setTimeout(() => { r({ code: 'open', msgs, ws }); }, waitMs);
      this.lastProbe = ws;
    });
  },
  async stats() {
    const r = await this.pc.getStats();
    let inb = null, pair = null, local = null, remote = null;
    r.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') inb = s;
      if (s.type === 'transport' && s.selectedCandidatePairId) pair = r.get(s.selectedCandidatePairId);
    });
    if (pair) { local = r.get(pair.localCandidateId); remote = r.get(pair.remoteCandidateId); }
    return { t: performance.now(), inb, pair, local: local && { type: local.candidateType, protocol: local.protocol, relayProtocol: local.relayProtocol, address: local.address, port: local.port, url: local.url }, remote: remote && { type: remote.candidateType, address: remote.address, port: remote.port } };
  },
  // Time from sending an input to the first decoded frame whose centre flips.
  async latency(kind, trials) {
    const v = document.getElementById('v');
    const c = document.getElementById('c');
    const g = c.getContext('2d', { willReadFrequently: true });
    const lum = () => { g.drawImage(v, 0, 0, 32, 18); const d = g.getImageData(8, 4, 16, 10).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; };
    const nextFrame = () => new Promise((r) => { const t = setTimeout(() => r({ now: performance.now(), stale: true }), 500); v.requestVideoFrameCallback((now, md) => { clearTimeout(t); r({ now, md }); }); });
    const out = [];
    for (let i = 0; i < trials; i++) {
      await new Promise((r) => setTimeout(r, 250 + Math.random() * 150));
      await nextFrame();
      const before = lum() > 128;
      const t0 = performance.now();
      if (kind === 'click') { this.send({ t: 'pd', b: 1, x: 0.5, y: 0.5 }); this.send({ t: 'pu', b: 1, x: 0.5, y: 0.5 }); }
      else { this.send({ t: 'kd', code: 'KeyA', key: 'a' }); this.send({ t: 'ku', code: 'KeyA', key: 'a' }); }
      let got = null;
      while (performance.now() - t0 < 3000) {
        const f = await nextFrame();
        if ((lum() > 128) !== before) { got = f.now - t0; break; }
      }
      out.push(got);
    }
    return out;
  },
};
</script></body></html>`;

// ---- per-profile run -------------------------------------------------------
const pct = (arr, p) => {
  const a = arr.filter((x) => x != null).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null;
};
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

async function measure(page, seconds) {
  const s0 = await page.evaluate(() => window.bench.stats());
  const st0 = await page.evaluate(() => window.bench.status.length);
  const rtts = [];
  for (let i = 0; i < seconds; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await page.evaluate(() => window.bench.stats());
    if (s.pair && s.pair.currentRoundTripTime != null) rtts.push(s.pair.currentRoundTripTime * 1000);
  }
  const s1 = await page.evaluate(() => window.bench.stats());
  const server = await page.evaluate((n) => window.bench.status.slice(n).filter((m) => m.t === 'stats'), st0);
  const a = s0.inb, b = s1.inb, dt = (s1.t - s0.t) / 1000;
  const frames = b.framesDecoded - a.framesDecoded;
  const avg = (k) => (server.length ? server.reduce((x, m) => x + (m[k] || 0), 0) / server.length : null);
  return {
    seconds: r1(dt),
    resolution: `${b.frameWidth}x${b.frameHeight}`,
    decodedFps: r1(frames / dt),
    framesDropped: (b.framesDropped || 0) - (a.framesDropped || 0),
    packetsLost: (b.packetsLost || 0) - (a.packetsLost || 0),
    mbitPerS: r1(((b.bytesReceived - a.bytesReceived) * 8) / dt / 1e6),
    rttMsP50: r1(pct(rtts, 0.5)),
    rttMsP95: r1(pct(rtts, 0.95)),
    jitterMs: r1((b.jitter || 0) * 1000),
    decodeMsPerFrame: r1(((b.totalDecodeTime - a.totalDecodeTime) / Math.max(1, frames)) * 1000),
    jitterBufferMs: r1(((b.jitterBufferDelay - a.jitterBufferDelay) / Math.max(1, b.jitterBufferEmittedCount - a.jitterBufferEmittedCount)) * 1000),
    keyframesDecoded: (b.keyFramesDecoded || 0) - (a.keyFramesDecoded || 0),
    pliSent: (b.pliCount || 0) - (a.pliCount || 0),
    nackSent: (b.nackCount || 0) - (a.nackCount || 0),
    retransmittedPacketsReceived: (b.retransmittedPacketsReceived || 0) - (a.retransmittedPacketsReceived || 0),
    path: s1.local
      ? `${s1.local.type}/${s1.local.relayProtocol || s1.local.protocol} ${s1.local.address}:${s1.local.port}${s1.local.url ? " via " + s1.local.url : ""} -> ${s1.remote && s1.remote.type} ${s1.remote && s1.remote.address}:${s1.remote && s1.remote.port}`
      : "unknown",
    server: {
      fps: r1(avg("fps")),
      mbitPerS: r1(avg("bitrate") / 1e6),
      encodeMs: r1(avg("encodeMs")),
      droppedInWindow: server.length ? server[server.length - 1].dropped - server[0].dropped : null,
      bitrateCapKbps: server.length ? server[server.length - 1].bitrateCapKbps : null,
      samples: server.length,
    },
  };
}

async function runProfile(browser, profile) {
  console.log(`\n== ${profile} ==`);
  const created = await api("POST", "/sessions", { name: `e2e-${profile}`, profile }, { "Idempotency-Key": `e2e-${profile}-${Date.now()}` });
  check(created.status === 201, `POST /sessions ${profile} -> 201`, created.text);
  if (created.status !== 201) return null;
  const s = created.json;
  check(s.state === "READY", `session READY on create (${s.state})`);
  const slots = activeSlots();
  const slot = slots.length === 1 ? slots[0] : slots[slots.length - 1];
  const result = { profile, id: s.id, slot };
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url() === PAGE_URL) req.respond({ status: 200, contentType: "text/html", body: PAGE_HTML });
      else req.continue();
    });
    await page.goto(PAGE_URL);
    await page.bringToFront();
    openInSession(slot, "anim.html#idle");
    const conn = await page.evaluate((b, id, t) => window.bench.connect(b, id, t), BASE, s.id, TOKEN);
    result.connectMs = conn.ms;
    check(conn.w > 0, `video decoding ${conn.w}x${conn.h} after ${conn.ms} ms`);
    check(conn.log[0] === "ice-servers", "first server message is ice-servers");
    const offer = await page.evaluate(() => window.bench.offerSdp);
    const plid = /profile-level-id=([0-9a-f]{6})/i.exec(offer || "");
    result.profileLevelId = plid && plid[1];
    result.offerHasRtx = /a=rtpmap:\d+ rtx\/90000/.test(offer || "");
    const conf = await api("GET", `/sessions/${s.id}`);
    check(conf.json && conf.json.state === "CONNECTED" && conf.json.viewer === true, "session CONNECTED with viewer");

    await new Promise((r) => setTimeout(r, 3000));
    result.idle = await measure(page, 10);
    console.log("  idle:", JSON.stringify(result.idle));

    openInSession(slot, "anim.html#full");
    await new Promise((r) => setTimeout(r, 2000));
    const c0 = cpuSample(slot);
    result.motion = await measure(page, DURATION);
    const c1 = cpuSample(slot);
    const wall = c1.t - c0.t;
    result.motion.supervisorCpuCores = r1(((c1.sup - c0.sup) / wall) * 10) / 10;
    result.motion.sessionCpuCores = r1(((c1.sess - c0.sess) / wall) * 10) / 10;
    console.log("  motion:", JSON.stringify(result.motion));
    result.motion.turnTcp443Connections = c1.tcp443;
    // Chrome can label the relayed local candidate "prflx"; the address is
    // what proves the path: the TURN server's relay (92.4.83.196, relay ports
    // 49160-49200), with the browser holding a TCP/443 leg to coturn.
    const relayed = /^relay/.test(result.motion.path) || / via turn:92\.4\.83\.196:443\?transport=tcp /.test(result.motion.path + " ");
    check(relayed && c1.tcp443 > 0, `media path is the TURN relay over TCP 443 (${result.motion.path}; tcp/443 legs ${c1.tcp443})`);
    check(result.motion.decodedFps > Number(profile.slice(-2)) * 0.8, `decoded fps ${result.motion.decodedFps} near target`);

    openInSession(slot, "latency.html");
    // Give the latency page focus for keys: one click first.
    await page.evaluate(() => { window.bench.send({ t: "pd", b: 1, x: 0.5, y: 0.5 }); window.bench.send({ t: "pu", b: 1, x: 0.5, y: 0.5 }); });
    await new Promise((r) => setTimeout(r, 800));
    const clicks = await page.evaluate((n) => window.bench.latency("click", n), TRIALS);
    const keys = await page.evaluate((n) => window.bench.latency("key", n), TRIALS);
    const lat = (a) => ({ p50: r1(pct(a, 0.5)), p95: r1(pct(a, 0.95)), min: r1(pct(a, 0)), missed: a.filter((x) => x == null).length, n: a.length });
    result.latency = { click: lat(clicks), key: lat(keys) };
    console.log("  input->display ms:", JSON.stringify(result.latency));
    check(result.latency.click.missed === 0, "every click reached the display");
    check(result.latency.key.missed === 0, "every key reached the display");

    // Live abuse of the input channel: malformed, replayed, oversized, binary,
    // wrong version, unknown type, and a 1000-message flood. The supervisor
    // must refuse them all, keep streaming, and stay healthy.
    const other = profile === "720p30" ? "1080p30" : "720p30";
    const abuse = await page.evaluate(async (other) => {
      const b = window.bench;
      const last = () => b.status.filter((m) => m.t === "stats").pop() || {};
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      await sleep(1200);
      const before = last().rejected || 0;
      const d0 = (await b.stats()).inb.framesDecoded;
      b.input.send("not json");
      b.input.send(JSON.stringify({ v: 1, seq: 1, t: "hb" })); // replayed seq
      b.input.send(JSON.stringify({ v: 1, seq: ++b.seq, t: "pm", x: 0, y: 0, pad: "a".repeat(2000) }));
      b.input.send(new Uint8Array(100));
      b.input.send(JSON.stringify({ v: 2, seq: ++b.seq, t: "hb" }));
      b.input.send(JSON.stringify({ v: 1, seq: ++b.seq, t: "exec", cmd: "id" }));
      b.input.send(JSON.stringify({ v: 1, seq: ++b.seq, t: "pm", x: 1e9, y: 0 }));
      for (let i = 0; i < 1000; i++) b.input.send(JSON.stringify({ v: 1, seq: ++b.seq, t: "hb" }));
      await sleep(1500);
      // Clipboard round trip, and a resolution change Xvfb cannot do live.
      const text = "remote-os clip " + Math.random().toString(36).slice(2);
      b.send({ t: "clip", text });
      await sleep(300);
      b.send({ t: "clip?" });
      b.send({ t: "res", profile: other });
      await sleep(2500);
      const clip = b.status.filter((m) => m.t === "clip").pop();
      const errors = b.status.filter((m) => m.t === "error");
      const d1 = (await b.stats()).inb.framesDecoded;
      return { rejected: (last().rejected || 0) - before, clipOk: !!clip && clip.text === text, errors, framesAfter: d1 - d0 };
    }, other);
    result.abuse = { rejected: abuse.rejected, clipRoundTrip: abuse.clipOk, errors: abuse.errors.map((e) => e.code), framesDecodedMeanwhile: abuse.framesAfter };
    console.log("  input abuse:", JSON.stringify(result.abuse));
    check(abuse.rejected >= 500, `malformed/oversized/replayed/flooded input refused (${abuse.rejected} rejected)`);
    check(abuse.framesAfter > 60, `stream kept flowing through the abuse (${abuse.framesAfter} frames)`);
    check(abuse.clipOk, "clipboard set + pull round trip");
    check(abuse.errors.some((e) => e.code === "profile/needs-restart"), `res ${profile}->${other} refused as needs-restart`);
    const h2 = await fetch(`${BASE}/api/v1/health`);
    check(h2.status === 200, "supervisor healthy after the abuse");

    const stats = await api("GET", `/sessions/${s.id}/stats`);
    check(stats.status === 200 && stats.json.stream && stats.json.stream.encoded > 0, "GET /stats carries live stream numbers");
    // A second viewer replaces the first: the first gets {type:"replaced"}
    // and close 4409.
    const page2 = await browser.newPage();
    await page2.setRequestInterception(true);
    page2.on("request", (req) => (req.url() === PAGE_URL ? req.respond({ status: 200, contentType: "text/html", body: PAGE_HTML }) : req.continue()));
    await page2.goto(PAGE_URL);
    await page2.evaluate((b, id, t) => window.bench.probeWs(b, id, t, 2500), BASE, s.id, TOKEN);
    await new Promise((r) => setTimeout(r, 500));
    const first = await page.evaluate(() => ({ code: window.bench.closeCode, log: window.bench.log.slice(-2) }));
    check(first.code === 4409 && first.log.includes("replaced"), `first viewer replaced -> {type:"replaced"} + 4409 (${first.code} ${first.log})`);
    await page2.close();

  } catch (e) {
    check(false, `${profile} run`, String(e && e.message ? e.message : e).slice(0, 400));
  } finally {
    closeInSession(slot);
    await page.close().catch(() => {});
    const stop = await api("POST", `/sessions/${s.id}/stop`);
    check(stop.status === 200 && stop.json.state === "STOPPED", `stop -> STOPPED (${stop.json && stop.json.state})`);
  }
  return result;
}

// ---- negative checks that need a browser origin ----------------------------
async function originChecks(browser) {
  console.log("\n== origin / auth ==");
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.url().startsWith("https://evil.example/")) req.respond({ status: 200, contentType: "text/html", body: "<!doctype html><title>x</title>" });
    else req.continue();
  });
  await page.goto("https://evil.example/");
  const code = await page.evaluate(async (base) => {
    return await new Promise((r) => {
      const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/v1/sessions/0123456789abcdef0123456789abcdef/signal");
      ws.onclose = (e) => r(e.code);
    });
  }, BASE);
  check(code === 1006, `foreign Origin upgrade refused before WS (close ${code})`);
  await page.close();
  // Signalling refusals, from an allowed origin.
  const p2 = await browser.newPage();
  await p2.setRequestInterception(true);
  p2.on("request", (req) => (req.url() === PAGE_URL ? req.respond({ status: 200, contentType: "text/html", body: PAGE_HTML }) : req.continue()));
  await p2.goto(PAGE_URL);
  const unknown = "0123456789abcdef0123456789abcdef";
  const silent = await p2.evaluate((b, id) => window.bench.probeWs(b, id, null, 8000), BASE, unknown);
  check(silent.code === 4401, `no auth within 5 s -> close 4401 (${silent.code} ${silent.msgs})`);
  const forged = await p2.evaluate((b, id) => window.bench.probeWs(b, id, "eyJhbGciOiJSUzI1NiIsImtpZCI6Ingi.e30.c2ln", 4000), BASE, unknown);
  check(forged.code === 4401, `forged token -> close 4401 (${forged.code} ${forged.msgs})`);
  const missing = await p2.evaluate((b, id, t) => window.bench.probeWs(b, id, t, 4000), BASE, unknown, TOKEN);
  check(missing.code === 4404, `authenticated, unknown session -> close 4404 (${missing.code} ${missing.msgs})`);
  await p2.close();
  const noauth = await fetch(`${BASE}/api/v1/sessions`);
  check(noauth.status === 401, "REST without token -> 401");
  const pre = await fetch(`${BASE}/api/v1/sessions`, { method: "OPTIONS", headers: { Origin: "https://www.ravikishan.me", "Access-Control-Request-Method": "POST" } });
  check(pre.status === 204 && pre.headers.get("access-control-allow-origin") === "https://www.ravikishan.me", "preflight 204 + echoed origin");
  const unk = await api("GET", "/sessions/0123456789abcdef0123456789abcdef");
  check(unk.status === 404 && unk.json.code === "session/not-found", "unknown session -> 404 session/not-found");
}

if (process.env.PROBE) {
  // Debug: connect to a fresh session and print client + server stats each second.
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: process.env.HEADFUL ? false : "new", args: ["--autoplay-policy=no-user-gesture-required"] });
  const created = await api("POST", "/sessions", { name: "probe", profile: PROFILES[0] });
  const s = created.json;
  console.log("session", created.status, s && s.state);
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => (req.url() === PAGE_URL ? req.respond({ status: 200, contentType: "text/html", body: PAGE_HTML }) : req.continue()));
  await page.goto(PAGE_URL);
  if (process.env.PROBE_PAGE) openInSession(activeSlots()[0], process.env.PROBE_PAGE);
  console.log(await page.evaluate((b, id, t) => window.bench.connect(b, id, t), BASE, s.id, TOKEN));
  for (let i = 0; i < Number(process.env.PROBE); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const c = await page.evaluate(async () => { const x = await window.bench.stats(); return { dec: x.inb && x.inb.framesDecoded, rcv: x.inb && x.inb.packetsReceived, bytes: x.inb && x.inb.bytesReceived, st: window.bench.status.length, ws: window.bench.closeCode }; });
    const srv = await api("GET", `/sessions/${s.id}/stats`);
    const st = srv.json && srv.json.stream;
    console.log(JSON.stringify(c), st && JSON.stringify({ fps: st.fps, enc: st.encoded, cap: st.captured, drop: st.dropped, br: st.bitrate }));
  }
  await browser.close();
  console.log((await api("POST", `/sessions/${s.id}/stop`)).json.state);
  process.exit(0);
}

const browser = await puppeteer.launch({
  protocolTimeout: 600000,
  executablePath: CHROME,
  headless: process.env.HEADFUL ? false : "new",
  defaultViewport: { width: 1600, height: 1000 },
  // A tab that is not frontmost gets its video-only media suspended by
  // Chrome's background optimisations, which reads as "0 frames decoded".
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-media-suspend",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-background-timer-throttling",
  ],
});
const results = [];
try {
  const health = await fetch(`${BASE}/api/v1/health`);
  check(health.status === 200, "GET /health -> 200 through the tunnel");
  await originChecks(browser);
  for (const p of PROFILES) {
    const r = await runProfile(browser, p);
    if (r) results.push(r);
  }
} finally {
  await browser.close();
}
const out = new URL("./e2e-results.json", import.meta.url);
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(`\n${pass} passed, ${fail} failed; results -> ${out.pathname}`);
process.exit(fail ? 1 : 0);
