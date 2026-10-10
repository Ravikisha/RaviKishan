// BROWSER. The remote desk: WebRTC desktop sessions on the agent box.
//
// Two halves, both talking to the Rust supervisor behind desk.ravikishan.me
// (contract: docs/superpowers/specs/2026-10-11-remote-os-design.md):
//
//   DeskApi         REST over plain fetch with `Authorization: Bearer <ID
//                   token>`. The call is CROSS-ORIGIN (www.ravikishan.me or
//                   localhost:3000 → desk.ravikishan.me), so the supervisor
//                   must answer CORS for those origins; no cookies are sent.
//   DeskConnection  one viewer: signalling WebSocket (first message is the
//                   auth), an RTCPeerConnection that may ONLY use the TURN
//                   relay (iceTransportPolicy "relay" — the tunnel carries
//                   HTTP, the media rides coturn on TCP 443), the `input`
//                   DataChannel driven by InputSender, and `status` for the
//                   server's stats and clipboard.
//
// Nothing here connects on construction. The panel calls connect() from the
// owner's Connect; an unexpected drop retries three times with backoff, then
// stops and says so.
//
// The protocol's pure half — geometry, keys, the rate limiter, stats — is
// lib/server/remoteDeskShape.js, tested without a browser.
import { auth } from "./firebase";
import { InputSender, HEARTBEAT_MS, STATS_MS, MAX_RETRIES, summariseStats, closeReason, sessionList } from "./server/remoteDeskShape";

export * from "./server/remoteDeskShape";

export const DESK_URL = process.env.NEXT_PUBLIC_DESK_URL || "https://desk.ravikishan.me";

// `fresh` forces a new token: after a step-up sign-in the cached one still
// carries the OLD auth_time, which is exactly what the desk refuses.
export async function idToken(fresh = false) {
  const user = auth.currentUser;
  if (!user) {
    const e = new Error("You are not signed in.");
    e.code = "auth/no-user";
    throw e;
  }
  return user.getIdToken(!!fresh);
}

// The signalling socket's token is checked once at the start and then only
// for expiry (an ID token lasts an hour; the desk closes 4401 thirty seconds
// past it). So while a socket is open the viewer re-sends a current one this
// often. getIdToken() hands back the cached token until it is near expiry,
// so most ticks send nothing.
export const TOKEN_REFRESH_MS = 10 * 60 * 1000;

export const hostOf = (url = "") => {
  try {
    return new URL(url).host;
  } catch (_) {
    return "";
  }
};

export function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------------- REST ---------------- */

export class DeskApi {
  constructor({ base = DESK_URL, token = idToken, fetchImpl = null } = {}) {
    this.base = base.replace(/\/+$/, "");
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.host = hostOf(this.base);
  }

  async req(method, path, { body, headers = {}, auth: needsAuth = true } = {}) {
    const f = this.fetchImpl || fetch;
    const h = { ...headers };
    if (needsAuth) h.Authorization = `Bearer ${await this.token()}`;
    if (body !== undefined) h["Content-Type"] = "application/json";
    let res;
    try {
      res = await f(`${this.base}/api/v1${path}`, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
      });
    } catch (e) {
      // A refused CORS preflight and a dead host look the same from here:
      // fetch rejects with a TypeError and no status.
      const err = new Error(`${this.host} did not answer.`);
      err.code = "net/unreachable";
      err.cause = e;
      throw err;
    }
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `${this.host} answered ${res.status}.`);
      err.code = (data && data.code) || (res.status === 401 || res.status === 403 ? "auth/refused" : res.status === 404 ? "session/not-found" : `http/${res.status}`);
      err.status = res.status;
      err.error = data && data.error;
      throw err;
    }
    return data;
  }

  health() {
    return this.req("GET", "/health", { auth: false });
  }
  async sessions() {
    return sessionList(await this.req("GET", "/sessions"));
  }
  session(id) {
    return this.req("GET", `/sessions/${encodeURIComponent(id)}`);
  }
  create({ name, profile }, idempotencyKey) {
    return this.req("POST", "/sessions", { body: { name, profile }, headers: { "Idempotency-Key": idempotencyKey } });
  }
  stop(id) {
    return this.req("POST", `/sessions/${encodeURIComponent(id)}/stop`, { body: {} });
  }
  stats(id) {
    return this.req("GET", `/sessions/${encodeURIComponent(id)}/stats`);
  }
  capacity() {
    return this.req("GET", "/capacity");
  }
}

/* ---------------- one viewer ---------------- */

// States, in the order a good connection walks them:
//   signalling  socket open, authenticating, waiting for the offer
//   negotiating offer answered, ICE through the relay
//   live        media flowing
//   switching   the box changed the frame rate and asked for a new peer
//               ({type:"renegotiate"}): same socket, same session, new
//               RTCPeerConnection, and live again once it connects
// and the ends: reconnecting (attempt n of 3), failed, ended (bye or
// disconnect), stopped (the session itself was stopped), replaced (another
// viewer took it).
export class DeskConnection {
  constructor({
    base = DESK_URL,
    token = idToken,
    sessionId,
    WebSocketImpl = typeof WebSocket !== "undefined" ? WebSocket : null,
    PeerConnectionImpl = typeof RTCPeerConnection !== "undefined" ? RTCPeerConnection : null,
    onState = () => {},
    onTrack = () => {},
    onStats = () => {},
    onStatus = () => {},
    onSent = null,
    schedule,
    signalTimeoutMs = 15000,
  } = {}) {
    this.base = base.replace(/\/+$/, "");
    this.token = token;
    this.sessionId = sessionId;
    this.WebSocketImpl = WebSocketImpl;
    this.PeerConnectionImpl = PeerConnectionImpl;
    this.onState = onState;
    this.onTrack = onTrack;
    this.onStats = onStats;
    this.onStatus = onStatus;
    this.onSent = onSent;
    this.schedule = schedule;
    this.signalTimeoutMs = signalTimeoutMs;
    this.wanted = false;
    this.failures = 0;
    this.gen = 0;
    this.sender = null;
    this.ws = null;
    this.pc = null;
    this.state = "idle";
    this.iceServers = [];
  }

  get url() {
    return `${this.base.replace(/^http/, "ws")}/api/v1/sessions/${encodeURIComponent(this.sessionId)}/signal`;
  }

  _set(status, extra = {}) {
    this.state = status;
    this.onState({ status, ...extra });
  }

  // The owner's Connect (or Reconnect): a fresh retry budget.
  connect() {
    this.wanted = true;
    this.failures = 0;
    // Whether any socket in this run of attempts ever opened. A refused
    // upgrade (an origin the desk does not accept, answered 403) reaches the
    // browser as close 1006 with no open. So does a dead host, and that is
    // the only way to tell either from a drop mid-session.
    this.everOpened = false;
    this.switches = 0;
    clearTimeout(this.retryTimer);
    return this._open();
  }

  async _open() {
    const gen = ++this.gen;
    this._teardown();
    if (!this.WebSocketImpl || !this.PeerConnectionImpl) {
      this.wanted = false;
      this._set("failed", { code: "webrtc/unsupported", error: "This browser has no WebRTC." });
      return;
    }
    let token;
    try {
      token = await this.token();
    } catch (e) {
      this.wanted = false;
      this._set("failed", { code: e.code || "auth/no-user", error: e.message });
      return;
    }
    if (gen !== this.gen || !this.wanted) return;
    this._set("signalling", { attempt: this.failures });

    const ws = new this.WebSocketImpl(this.url);
    this.ws = ws;
    this.pendingIce = [];
    this.remoteSet = false;
    this.ended = null;
    this.lastToken = token;
    this._armSignalTimer(gen);

    ws.onopen = () => {
      if (gen !== this.gen) return;
      this._signal({ type: "auth", token });
      this.everOpened = true;
      clearInterval(this.tokenTimer);
      this.tokenTimer = setInterval(() => this._refreshToken(gen), TOKEN_REFRESH_MS);
    };
    ws.onmessage = (ev) => {
      if (gen !== this.gen) return;
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch (_) {
        return;
      }
      this._onSignal(msg, gen).catch((e) => this._drop({ code: "signal/bad", error: e.message }));
    };
    ws.onclose = (ev) => {
      if (gen !== this.gen) return;
      const code = ev && ev.code;
      const known = closeReason(code);
      if (this.ended === "replaced" || code === 4409) return this._end("replaced", known);
      if (known) {
        // A refusal is an answer, not a drop: retrying it changes nothing.
        this.wanted = false;
        this._teardown();
        return this._set("failed", { code: known.code, closeCode: code });
      }
      // 1000 after {type:"bye", reason:"session stopped"}: the session is
      // gone, and retrying would only meet 4404.
      if (this.ended === "stopped" || (code === 1000 && /stop/i.test((ev && ev.reason) || ""))) return this._end("stopped", { code: "session/stopped" });
      if (this.ended === "bye" || code === 1000) return this._end("ended");
      // The media can outlive the signalling socket (the tunnel idles out a
      // quiet socket); only a drop while still negotiating is fatal.
      if (this.state === "live" && this.pc && this.pc.connectionState === "connected") return;
      this._drop({ code: "signal/closed", closeCode: code });
    };
    ws.onerror = () => {};
  }

  _signal(msg) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  _armSignalTimer(gen) {
    clearTimeout(this.sigTimer);
    this.sigTimer = setTimeout(() => {
      if (gen === this.gen && this.state !== "live") this._drop({ code: "signal/timeout" });
    }, this.signalTimeoutMs);
  }

  async _refreshToken(gen) {
    if (gen !== this.gen) return;
    try {
      const t = await this.token();
      if (gen !== this.gen || !t || t === this.lastToken) return;
      this.lastToken = t;
      this._signal({ type: "auth", token: t });
    } catch (_) {}
  }

  // After a step-up sign-in: a FRESH token (new auth_time) on the socket
  // that is already open. The desk accepts {type:"auth"} at any time and
  // starts taking input again; nothing else is torn down.
  async reauth() {
    const gen = this.gen;
    const t = await this.token(true);
    if (gen !== this.gen) return false;
    this.lastToken = t;
    return this._signal({ type: "auth", token: t });
  }

  async _onSignal(msg, gen) {
    switch (msg.type) {
      case "ice-servers":
        this.iceServers = msg.iceServers || [];
        // Only the first list builds a peer; a later one is kept for the
        // next renegotiation and leaves the live picture alone.
        if (this.pc) return;
        this._makePeer(this.iceServers, gen);
        this._signal({ type: "ready" });
        return;
      case "renegotiate":
        this._renegotiate(msg, gen);
        return;
      case "offer": {
        const pc = this.pc;
        if (!pc) return;
        // The offer after a renegotiation is still part of the switch.
        if (this.state !== "switching") this._set("negotiating");
        await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        this.remoteSet = true;
        for (const c of this.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (gen !== this.gen) return;
        this._signal({ type: "answer", sdp: (pc.localDescription && pc.localDescription.sdp) || answer.sdp });
        return;
      }
      case "ice": {
        if (!msg.candidate) return;
        const c = { candidate: msg.candidate, sdpMLineIndex: msg.sdpMLineIndex ?? 0 };
        if (msg.sdpMid != null) c.sdpMid = msg.sdpMid;
        if (!this.remoteSet || !this.pc) this.pendingIce.push(c);
        else await this.pc.addIceCandidate(c).catch(() => {});
        return;
      }
      case "bye":
        if (/stop/i.test(msg.reason || "")) {
          this.ended = "stopped";
          this._end("stopped", { code: "session/stopped" });
          return;
        }
        this.ended = "bye";
        this._end("ended");
        return;
      case "replaced":
        this.ended = "replaced";
        this._end("replaced");
        return;
      case "error":
        this.lastError = msg;
        return;
      default:
        return;
    }
  }

  // {type:"renegotiate", profile, width, height, fps}: the box rebuilt its
  // pipeline at a new frame rate and will send a NEW offer for a NEW peer.
  // Let go of everything first (the old input channel dies with the old
  // peer), drop the peer, keep the socket and the session, say ready again.
  // Input re-arms when the new peer's input channel opens.
  _renegotiate(msg, gen) {
    if (this.sender) this.sender.releaseAll("renegotiate");
    this._dropPeer();
    this.pendingIce = [];
    this.remoteSet = false;
    this.switches = (this.switches || 0) + 1;
    this.state = "switching";
    this.onState({ status: "switching", input: false, profile: msg.profile, width: msg.width, height: msg.height, fps: msg.fps });
    this._armSignalTimer(gen);
    this._makePeer(this.iceServers || [], gen);
    this._signal({ type: "ready" });
  }

  _makePeer(iceServers, gen) {
    if (this.pc) {
      try {
        this.pc.close();
      } catch (_) {}
    }
    // RELAY ONLY. The box is reachable for media only through coturn on 443;
    // anything else is a host candidate the browser cannot reach anyway, and
    // trying it leaks the viewer's addresses for nothing.
    const pc = new this.PeerConnectionImpl({ iceServers, iceTransportPolicy: "relay" });
    this.pc = pc;
    this.config = { iceServers, iceTransportPolicy: "relay" };
    pc.onicecandidate = (e) => {
      if (gen !== this.gen || !e.candidate || !e.candidate.candidate) return;
      this._signal({ type: "ice", candidate: e.candidate.candidate, sdpMLineIndex: e.candidate.sdpMLineIndex ?? 0, sdpMid: e.candidate.sdpMid ?? undefined });
    };
    pc.ontrack = (e) => {
      if (gen !== this.gen) return;
      const stream = (e.streams && e.streams[0]) || (typeof MediaStream !== "undefined" ? new MediaStream([e.track]) : null);
      this.onTrack(stream);
    };
    pc.ondatachannel = (e) => {
      if (gen !== this.gen) return;
      const ch = e.channel;
      if (ch.label === "input") this._bindInput(ch);
      else if (ch.label === "status") this._bindStatus(ch);
    };
    pc.onconnectionstatechange = () => {
      if (gen !== this.gen) return;
      const s = pc.connectionState;
      if (s === "connected") {
        clearTimeout(this.sigTimer);
        this.failures = 0;
        this._set("live", this.sender ? { input: true } : {});
        this._startStats(gen);
      } else if (s === "failed") {
        this._drop({ code: "ice/failed" });
      } else if (s === "disconnected" && this.state === "live") {
        this._set("live", { shaky: true });
      }
    };
  }

  _bindInput(ch) {
    const sender = new InputSender({
      send: (s, msg) => {
        if (ch.readyState !== "open") throw new Error("closed");
        ch.send(s);
        if (this.onSent) this.onSent(msg);
      },
      ...(this.schedule ? { schedule: this.schedule } : {}),
    });
    const start = () => {
      this.sender = sender;
      clearInterval(this.hbTimer);
      // A channel that replaces another (a renegotiation) starts from
      // nothing held: say so before anything else goes.
      if (this.switches) sender.releaseAll("rearm");
      sender.heartbeat();
      this.hbTimer = setInterval(() => sender.heartbeat(), HEARTBEAT_MS);
      this.onState({ status: this.state, input: true });
    };
    ch.onopen = start;
    ch.onclose = () => {
      clearInterval(this.hbTimer);
      sender.close();
      if (this.sender === sender) this.sender = null;
    };
    if (ch.readyState === "open") start();
  }

  _bindStatus(ch) {
    ch.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        if (msg && typeof msg.t === "string") this.onStatus(msg);
      } catch (_) {}
    };
  }

  _startStats(gen) {
    clearInterval(this.statsTimer);
    let prev = null;
    const tick = async () => {
      const pc = this.pc;
      if (!pc || gen !== this.gen) return;
      try {
        const report = await pc.getStats();
        const s = summariseStats(Array.from(report.values ? report.values() : report), prev);
        prev = s.next;
        this.onStats(s);
      } catch (_) {}
    };
    tick();
    this.statsTimer = setInterval(tick, STATS_MS);
  }

  _drop(reason) {
    // Let go of everything first: a drop with a key held would leave it
    // held on the box until the server notices.
    if (this.sender) this.sender.releaseAll("drop");
    this._teardown();
    if (!this.wanted) return;
    if (this.failures >= MAX_RETRIES - 1) {
      this.wanted = false;
      this.failures += 1;
      // Never opened once, and the last close was 1006: the upgrade itself
      // was refused (a foreign origin gets a 403) or nothing answered.
      const refused = !this.everOpened && reason.closeCode === 1006;
      const code = refused ? "signal/refused" : reason.code === "ice/failed" ? "ice/failed" : reason.code === "signal/timeout" ? "signal/timeout" : "signal/failed";
      return this._set("failed", { code, closeCode: reason.closeCode, detail: reason });
    }
    this.failures += 1;
    const delay = 1000 * 2 ** (this.failures - 1);
    this._set("reconnecting", { attempt: this.failures + 1, of: MAX_RETRIES, delayMs: delay, code: reason.code });
    const gen = this.gen;
    this.retryTimer = setTimeout(() => {
      if (gen === this.gen && this.wanted) this._open();
    }, delay);
  }

  _end(status, extra = {}) {
    this.wanted = false;
    this._teardown();
    this._set(status, extra);
  }

  _teardown() {
    clearTimeout(this.sigTimer);
    clearInterval(this.tokenTimer);
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close(1000);
      } catch (_) {}
    }
    this._dropPeer();
  }

  // The peer and everything riding on it, not the socket.
  _dropPeer() {
    clearInterval(this.hbTimer);
    clearInterval(this.statsTimer);
    if (this.sender) {
      this.sender.close();
      this.sender = null;
    }
    if (this.pc) {
      const pc = this.pc;
      this.pc = null;
      pc.onicecandidate = pc.ontrack = pc.ondatachannel = pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch (_) {}
    }
  }

  // The owner's Disconnect. Release, say bye, close — in that order.
  close() {
    this.wanted = false;
    this.gen += 1;
    clearTimeout(this.retryTimer);
    if (this.sender) this.sender.releaseAll("disconnect");
    this._signal({ type: "bye" });
    this._teardown();
    this.state = "ended";
  }
}
