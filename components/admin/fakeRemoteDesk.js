// A FAKE supervisor for /__jarvispreview: the remote desk's REST API, its
// signalling socket and an RTCPeerConnection, all in the page. The viewer
// under test is the REAL RemoteDesk driving the REAL DeskConnection and
// InputSender — only the network is replaced. The "remote screen" is a canvas
// painted like a desktop and handed over as canvas.captureStream(), so the
// <video> really plays, really has a size, and getStats has numbers to report.
//
// Everything the viewer sends is recorded on window[key] for e2e:jarvis:
//   calls    REST calls (with the Idempotency-Key on a create)
//   signal   every signalling message the viewer sent, in order
//   sent     every DataChannel input message (parsed), in order
//   pcConfigs the RTCPeerConnection configurations asked for
//   wsUrls, closed (peer connections closed), bye
//   accepted / rejected  input the fake desk acted on / dropped as stale
//
// It behaves the way the supervisor as built does (the spec's "Supervisor as
// built"): a size-changing t:res is refused profile/needs-restart; a
// frame-rate-only one is applied, answered t:res on status and then
// {type:"renegotiate"} on the socket, after which a NEW offer follows the
// viewer's ready; stats carry bitrate in bit/s and cumulative counters; a
// stopped session says bye and closes 1000; a refused origin is a 1006 with
// no open. window[key + "Server"] lets the suite act as the box:
//   stopViewed()        the session is stopped elsewhere (bye + 1000)
//   close(code, reason) the socket closes with that code, no bye
//
// Preview only. Nothing in the admin imports this.
import { DeskConnection } from "../../lib/remoteDesk";

const PROFILE_SIZE = { "720p30": [1280, 720, 30], "1080p30": [1920, 1080, 30], "1080p60": [1920, 1080, 60] };

function paint(ctx, w, h, t, name) {
  const s = w / 1600;
  ctx.fillStyle = "#2b3a4a";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1b2430";
  ctx.fillRect(0, h - 32 * s, w, 32 * s);
  ctx.fillStyle = "#c9d1dc";
  ctx.font = `${15 * s}px sans-serif`;
  ctx.fillText(`Applications   Chromium   Terminal        ${name}`, 16 * s, h - 10 * s);
  ctx.fillText(new Date(t).toISOString().slice(11, 19), w - 90 * s, h - 10 * s);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(120 * s, 70 * s, 1360 * s, 760 * s * (h / w / (900 / 1600)));
  ctx.fillStyle = "#dee1e6";
  ctx.fillRect(120 * s, 70 * s, 1360 * s, 44 * s);
  ctx.fillStyle = "#111111";
  ctx.font = `bold ${44 * s}px sans-serif`;
  ctx.fillText("cgroups from scratch", 200 * s, 200 * s);
  // a moving block, so frames keep coming and fps is real
  const x = 200 * s + ((t / 8) % (1000 * s));
  ctx.fillStyle = "#0f1117";
  ctx.fillRect(x, 300 * s, 120 * s, 60 * s);
  // corner markers: the picture's true edges, for the e2e's eye
  ctx.fillStyle = "#ffb020";
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillRect(w - 8, h - 8, 8, 8);
}

export function fakeRemoteDesk({ unreachable = false, iceFail = false, stale = false, staleServer = false, originRefused = false, solo = false, key = "__rd" } = {}) {
  const log = (window[key] = {
    calls: [],
    signal: [],
    sent: [],
    pcConfigs: [],
    wsUrls: [],
    closed: 0,
    bye: 0,
    reauths: 0,
    accepted: [],
    rejected: [],
    staleWarnings: 0,
  });
  const now = Date.now();
  let sessions = [
    { id: "s_kontainer", name: "kontainer", profile: "1080p30", state: "READY", width: 1920, height: 1080, fps: 30, createdAt: new Date(now - 25 * 60000).toISOString() },
    { id: "s_notes", name: "notes-panel", profile: "720p30", state: "IDLE", width: 1280, height: 720, fps: 30, createdAt: new Date(now - 3 * 3600000).toISOString() },
    { id: "s_render", name: "blog-render", profile: "1080p60", state: "FAILED", width: 1920, height: 1080, fps: 60, createdAt: new Date(now - 26 * 3600000).toISOString() },
  ];
  if (solo) sessions = sessions.slice(0, 1);
  const byKey = new Map();
  // The server drops input from a token signed in > 30 min ago, and says so
  // once on status; a fresh {type:"auth"} brings it back.
  let fresh = !staleServer;
  const fail = (code, error) => Object.assign(new Error(error), { code, error });
  const later = (ms, fn) => setTimeout(fn, ms);
  const running = () => sessions.filter((s) => s.state !== "STOPPED" && s.state !== "FAILED").length;

  const api = {
    host: "desk.example.test",
    async sessions() {
      log.calls.push({ method: "GET", path: "/sessions" });
      if (unreachable) throw fail("net/unreachable", "desk.example.test did not answer.");
      return sessions.map((s) => ({ ...s }));
    },
    async capacity() {
      log.calls.push({ method: "GET", path: "/capacity" });
      if (unreachable) throw fail("net/unreachable", "desk.example.test did not answer.");
      return { max: 3, running: running() };
    },
    async create(body, idem) {
      log.calls.push({ method: "POST", path: "/sessions", body, idem });
      // The same Idempotency-Key replays the same session (200), as the box does.
      if (idem && byKey.has(idem)) return { ...byKey.get(idem) };
      if (running() >= 3) throw fail("capacity/full", "The box is full: 3 of 3 sessions are running.");
      const [width, height, fps] = PROFILE_SIZE[body.profile] || [];
      if (!width) throw fail("profile/unknown", `No profile ${body.profile}.`);
      // The box answers READY: POST waits for the display to come up.
      const s = { id: `s_${body.name.replace(/\W+/g, "")}`, name: body.name, profile: body.profile, state: "READY", width, height, fps, createdAt: new Date().toISOString() };
      sessions = [s, ...sessions];
      if (idem) byKey.set(idem, s);
      return { ...s };
    },
    async stop(id) {
      log.calls.push({ method: "POST", path: `/sessions/${id}/stop` });
      const s = sessions.find((x) => x.id === id);
      if (!s) throw fail("session/not-found", "No such session.");
      s.state = "STOPPING";
      later(400, () => (s.state = "STOPPED"));
      return { ...s };
    },
  };

  let current = null; // the session being signalled
  let currentWs = null;
  let currentPc = null;
  class FakeWS {
    constructor(url) {
      log.wsUrls.push(url);
      this.url = url;
      this.readyState = 0;
      const id = decodeURIComponent((/sessions\/([^/]+)\/signal/.exec(url) || [])[1] || "");
      current = sessions.find((s) => s.id === id) || null;
      currentWs = this;
      if (originRefused) {
        // HTTP 403 on the upgrade: the browser never opens, and reports 1006.
        later(20, () => {
          this.readyState = 3;
          this.onerror && this.onerror({});
          this.onclose && this.onclose({ code: 1006, reason: "" });
        });
        return;
      }
      later(15, () => {
        this.readyState = 1;
        this.onopen && this.onopen();
      });
    }
    // The box closing the socket (stop, 4404, a drop): no further sends.
    _serverClose(code, reason = "") {
      if (this.readyState !== 1) return;
      this.readyState = 3;
      later(5, () => this.onclose && this.onclose({ code, reason }));
    }
    _reply(m, ms = 10) {
      later(ms,() => this.readyState === 1 && this.onmessage && this.onmessage({ data: JSON.stringify(m) }));
    }
    send(str) {
      const m = JSON.parse(str);
      log.signal.push(m);
      if (m.type === "auth") {
        if (m.token === "fresh-id-token") fresh = true;
        // The first auth on a socket is answered with the TURN list; a
        // re-auth is answered with nothing, as on the box.
        if (!this.authed) {
          this.authed = true;
          this._reply({ type: "ice-servers", iceServers: [{ urls: ["turn:192.0.2.10:443?transport=tcp"], username: "1760000000:s", credential: "fake" }], policy: "relay" });
        }
      } else if (m.type === "ready") {
        // A second ready on one socket follows a renegotiation: the box is
        // rebuilding its pipeline, which takes a moment.
        const ms = this.readies ? 700 : 10;
        this.readies = (this.readies || 0) + 1;
        this._reply({ type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=fake\r\n" }, ms);
        this._reply({ type: "ice", candidate: "candidate:1 1 tcp 1 10.0.0.118 9 typ host tcptype passive", sdpMLineIndex: 0 }, ms);
      } else if (m.type === "bye") {
        log.bye += 1;
      }
    }
    close() {
      this.readyState = 3;
    }
  }

  class FakePC {
    constructor(cfg) {
      log.pcConfigs.push(cfg);
      this.cfg = cfg;
      this.connectionState = "new";
      this.timers = [];
      this.bytes = 0;
      this.frames = 0;
      this.t0 = Date.now();
    }
    async setRemoteDescription(d) {
      this.remote = d;
    }
    async addIceCandidate(c) {
      (this.remoteIce = this.remoteIce || []).push(c);
    }
    async createAnswer() {
      return { type: "answer", sdp: "v=0\r\no=- 2 1 IN IP4 0.0.0.0\r\ns=answer\r\n" };
    }
    async setLocalDescription(a) {
      this.localDescription = a;
      later(30, () => this._go());
    }
    _go() {
      if (this.connectionState === "closed") return;
      currentPc = this;
      this.onicecandidate && this.onicecandidate({ candidate: { candidate: "candidate:2 1 tcp 1 192.0.2.10 443 typ relay raddr 0.0.0.0 rport 0", sdpMLineIndex: 0, sdpMid: "0" } });
      if (iceFail) {
        this.connectionState = "failed";
        this.onconnectionstatechange && this.onconnectionstatechange();
        return;
      }
      const s = current || sessions[0];
      const [w, h, fps] = PROFILE_SIZE[s.profile] || [1920, 1080, 30];
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      this.canvas = canvas;
      const draw = () => paint(ctx, canvas.width, canvas.height, Date.now(), s.name);
      draw();
      this.timers.push(setInterval(draw, 1000 / Math.min(fps, 30)));
      const stream = canvas.captureStream(fps);
      this.stream = stream;

      const status = { label: "status", readyState: "open", onmessage: null };
      const toStatus = (m) => later(20, () => status.readyState === "open" && status.onmessage && status.onmessage({ data: JSON.stringify(m) }));
      const ws = currentWs;
      let warned = false;
      const input = {
        label: "input",
        readyState: "open",
        send: (str) => {
          const m = JSON.parse(str);
          log.sent.push(m);
          const acting = /^(pm|pd|pu|wh|kd|ku|clip)$/.test(m.t);
          if (acting && !fresh) {
            log.rejected.push(m);
            if (!warned) {
              warned = true;
              log.staleWarnings += 1;
              toStatus({ t: "error", code: "auth/stale-sign-in", error: "Driving needs a sign-in from the last 30 minutes; input is being ignored. Sign in again." });
            }
            return;
          }
          if (acting) log.accepted.push(m);
          if (m.t === "clip?") toStatus({ t: "clip", text: "copied on the box: docker compose up -d" });
          if (m.t === "res" && PROFILE_SIZE[m.profile]) {
            const [nw, nh, nf] = PROFILE_SIZE[m.profile];
            if (nw !== w || nh !== h) {
              // Xvfb cannot resize: a new size is a new session.
              toStatus({ t: "error", code: "profile/needs-restart", error: `This session runs at ${w}×${h}; ${m.profile} needs a new session.` });
              return;
            }
            if (m.profile === "1080p60" && running() > 1) {
              toStatus({ t: "error", code: "capacity/full", error: "1080p60 runs only when it is the only session." });
              return;
            }
            s.profile = m.profile;
            s.fps = nf;
            toStatus({ t: "res", profile: m.profile, width: nw, height: nh, fps: nf });
            // The pipeline is rebuilt at the new rate: this peer is done,
            // and the socket asks for a new one.
            later(60, () => {
              this._stopMedia();
              ws && ws._reply({ type: "renegotiate", profile: m.profile, width: nw, height: nh, fps: nf });
            });
          }
        },
        close() {},
      };
      this.channels = [status, input];
      this.ondatachannel && this.ondatachannel({ channel: status });
      this.ondatachannel && this.ondatachannel({ channel: input });
      // The box's own numbers: bitrate in bit/s, encode ms a mean over the
      // second, captured / encoded / dropped CUMULATIVE since this pipeline
      // started (so a renegotiation starts them again from zero).
      const counters = { captured: 0, encoded: 0, dropped: 0, ticks: 0 };
      this.timers.push(
        setInterval(() => {
          counters.ticks += 1;
          counters.captured += fps;
          counters.encoded += fps - (counters.ticks % 2);
          counters.dropped += counters.ticks % 2;
          toStatus({
            t: "stats",
            fps: Math.min(fps, 30),
            bitrate: 2400000,
            bitrateCapKbps: 4500,
            encodeMs: 7.5,
            width: canvas.width,
            height: canvas.height,
            captured: counters.captured,
            encoded: counters.encoded,
            dropped: counters.dropped,
            keyframes: 1,
            rejected: log.rejected.length,
            profile: s.profile,
          });
        }, 1000)
      );
      this.ontrack && this.ontrack({ track: stream.getVideoTracks()[0], streams: [stream] });
      this.connectionState = "connected";
      this.onconnectionstatechange && this.onconnectionstatechange();
    }
    async getStats() {
      const t = Date.now();
      const secs = (t - this.t0) / 1000;
      this.bytes = Math.round(secs * 230000);
      this.frames = Math.round(secs * 30);
      return new Map([
        [
          "in",
          {
            id: "in",
            type: "inbound-rtp",
            kind: "video",
            timestamp: t,
            bytesReceived: this.bytes,
            packetsReceived: Math.round(secs * 200),
            packetsLost: Math.round(secs * 0.4),
            framesDecoded: this.frames,
            totalDecodeTime: this.frames * 0.0031,
            jitter: 0.0042,
            frameWidth: this.canvas ? this.canvas.width : 0,
            frameHeight: this.canvas ? this.canvas.height : 0,
          },
        ],
        ["tr", { id: "tr", type: "transport", selectedCandidatePairId: "cp" }],
        ["cp", { id: "cp", type: "candidate-pair", currentRoundTripTime: 0.038 }],
      ]);
    }
    _stopMedia() {
      this.timers.forEach(clearInterval);
      this.timers = [];
      (this.channels || []).forEach((ch) => (ch.readyState = "closed"));
    }
    close() {
      if (this.connectionState === "closed") return;
      this.connectionState = "closed";
      log.closed += 1;
      this._stopMedia();
      if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
    }
  }

  // The suite acting as the box.
  window[`${key}Server`] = {
    stopViewed() {
      const s = current;
      if (s) s.state = "STOPPED";
      const ws = currentWs;
      if (!ws) return;
      ws._reply({ type: "bye", reason: "session stopped" });
      later(30, () => ws._serverClose(1000, "session stopped"));
    },
    close(code, reason = "") {
      const ws = currentWs;
      if (ws) ws._serverClose(code, reason);
    },
    get pc() {
      return currentPc;
    },
  };

  return {
    api,
    makeConnection: (opts) => {
      return new DeskConnection({
        ...opts,
        base: "https://desk.example.test",
        // A forced refresh (after a step-up sign-in) is a token with a new
        // auth_time; the fake desk tells them apart by value.
        token: async (forceFresh) => (forceFresh ? "fresh-id-token" : "fake-id-token"),
        WebSocketImpl: FakeWS,
        PeerConnectionImpl: FakePC,
      });
    },
    isFresh: async () => {
      if (stale && !log.reauths) return false;
      return true;
    },
    reauth: async () => {
      log.reauths += 1;
      return true;
    },
  };
}
