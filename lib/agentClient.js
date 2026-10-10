// BROWSER. Talking to agentd.
//
// A WebSocket rather than fetch, because approvals are a server→client PUSH:
// the server asks a question and blocks on the answer, which polling cannot
// express without either latency or a second channel for the replies.
//
// Reconnects by job id rather than assuming the socket survived. Cloudflare
// idles out a quiet tunnel, phones suspend sockets when the screen locks, and a
// panel that only works while the connection happens to hold is a panel that
// works at a desk and fails on a train.
import { auth } from "./firebase";
import { parseFrame } from "./server/desktopStreamShape";

export const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL || "wss://agent.ravikishan.me";

// The socket is opened ONLY when the owner presses Connect. Nothing here
// connects on construction, and no panel connects on mount: an idle admin tab
// must not hold a tunnel to the box open (or keep the box streaming its screen
// to nobody). After an UNEXPECTED drop it reconnects with backoff, but only
// while the owner still wants the connection (pressed Connect, has not pressed
// Disconnect) and only three failed attempts in a row — then it stops and
// says so ("failed").
export const MAX_RECONNECTS = 3;

// A binary desktop frame: [u32 BE header length][JSON header][JPEG] — the
// layout agent/src/desktop.js packFrame writes. Parsed by a pure module that
// e2e:workbench tests without a browser.
export { parseFrame };

// An older agentd answers an unknown type with an error that carries no
// `request`. Reading the type back out of the sentence lets an awaiting caller
// (and the panels) treat it as "this server is too old" rather than as a
// stray error.
export function requestOfError(msg) {
  if (!msg || msg.type !== "error") return "";
  if (msg.request) return msg.request;
  const m = /^Unknown message "([^"]{1,60})"/.exec(String(msg.error || ""));
  return m ? m[1] : "";
}

export class AgentClient {
  constructor({ url = AGENT_URL, onEvent = () => {}, onState = () => {} } = {}) {
    this.url = url;
    this.onEvent = onEvent;
    this.onState = onState;
    this.ws = null;
    this.ready = false;
    this.closedByUs = false;
    // Whether the owner wants a connection: Connect sets it, Disconnect (and
    // giving up) clears it. Reconnecting happens only while it is set.
    this.wanted = false;
    this.failures = 0;
    this.backoff = 1000;
    // Replies a caller is awaiting (a desktop ticket, an opened terminal).
    this.waiters = new Set();
    this.frameListeners = new Set();
  }

  // The OWNER's Connect: a fresh retry budget and a socket.
  connect() {
    this.wanted = true;
    this.failures = 0;
    this.backoff = 1000;
    clearTimeout(this.retry);
    return this.open();
  }

  async open() {
    // A generation number, bumped by close(). A connect that was waiting on
    // the ID token, or a reconnect timer that fires after close(), must not
    // open a socket nobody owns any more: the admin's Jarvis tab unmounts
    // mid-backoff routinely (switching section), and a socket that outlives
    // its panel keeps polling the box for nobody.
    const gen = (this.gen = (this.gen || 0) + 1);
    this.closedByUs = false;
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in.");
    const token = await user.getIdToken();
    if (this.closedByUs || gen !== this.gen || !this.wanted) return;

    this.onState({ status: "connecting", attempt: this.failures });

    const ws = new WebSocket(this.url);
    // Desktop frames arrive as binary messages: an ArrayBuffer is parsed in
    // place, with no Blob round trip.
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    let reachedReady = false;

    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));

    ws.onmessage = (e) => {
      if (typeof e.data !== "string") {
        this.binary(e.data);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch (_) {
        return;
      }
      if (msg.type === "error" && !msg.request) {
        const r = requestOfError(msg);
        if (r) msg.request = r;
      }
      if (msg.type === "ready") {
        reachedReady = true;
        this.ready = true;
        this.failures = 0;
        this.backoff = 1000;
        this.settle(msg);
        this.onState({ status: "connected", ...msg });
        return;
      }
      this.settle(msg);
      this.onEvent(msg);
    };

    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ready = false;
      this.rejectAll(new Error("The connection to the agent server closed."));
      if (this.closedByUs || !this.wanted) {
        this.onState({ status: "closed" });
        return;
      }
      // A socket that got as far as "ready" and then dropped starts a fresh
      // budget; one that never got there is a failed attempt.
      if (reachedReady) this.failures = 0;
      else this.failures += 1;
      this.scheduleRetry(ev && ev.reason ? String(ev.reason) : "");
    };

    ws.onerror = () => {
      // onclose always follows; reconnection is handled there so it is not
      // attempted twice.
    };
  }

  scheduleRetry(reason = "") {
    clearTimeout(this.retry);
    if (this.failures >= MAX_RECONNECTS) {
      this.wanted = false;
      this.onState({ status: "failed", attempts: this.failures, reason });
      return;
    }
    const delayMs = this.backoff;
    this.onState({ status: "reconnecting", attempt: this.failures + 1, of: MAX_RECONNECTS, delayMs, reason });
    // Backoff, capped. A phone coming out of a tunnel should not hammer the
    // server, and a server that is down should not be hammered either.
    this.retry = setTimeout(() => {
      if (this.closedByUs || !this.wanted) return;
      this.open().catch(() => {
        this.failures += 1;
        this.scheduleRetry();
      });
    }, delayMs);
    this.backoff = Math.min(this.backoff * 2, 30_000);
  }

  // The owner's Disconnect, and every unmount.
  close() {
    const had = !!this.ws || this.wanted;
    this.closedByUs = true;
    this.wanted = false;
    this.gen = (this.gen || 0) + 1;
    clearTimeout(this.retry);
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    this.rejectAll(new Error("Disconnected."));
    try {
      ws?.close();
    } catch (_) {}
    if (had) this.onState({ status: "closed" });
  }

  // "Try now" while waiting out a backoff, or Connect again after giving up.
  retryNow() {
    if (!this.wanted) return this.connect();
    if (this.ws && this.ws.readyState <= 1) return Promise.resolve();
    clearTimeout(this.retry);
    this.backoff = 1000;
    return this.open();
  }

  /* ---- binary: desktop frames ---- */
  binary(data) {
    const handle = (buf) => {
      const f = parseFrame(buf);
      if (!f) return;
      const frame = { ...f, receivedAt: Date.now() };
      for (const fn of [...this.frameListeners]) {
        try {
          fn(frame);
        } catch (_) {}
      }
    };
    if (data instanceof ArrayBuffer) handle(data);
    else if (data && typeof data.arrayBuffer === "function") data.arrayBuffer().then(handle, () => {});
  }

  // on("frame", fn) → unsubscribe. Frames are the one thing that does not
  // ride onEvent: they are bytes, many a second, and only DesktopView wants them.
  on(event, fn) {
    if (event !== "frame" || typeof fn !== "function") return () => {};
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  send(msg) {
    if (!this.ws || this.ws.readyState !== 1) throw new Error("Not connected to the agent server.");
    this.ws.send(JSON.stringify(msg));
  }

  /* ---- asking and awaiting ----
     The socket has no request ids, so a reply is matched by its TYPE (and an
     optional predicate), and a refusal by the request type the server echoes
     on every error. Every wait has a timeout: a reply that never comes must
     surface as a sentence, not as a spinner that never stops. */
  settle(msg) {
    for (const w of [...this.waiters]) {
      if (msg.type === "error" && msg.request && w.request === msg.request) {
        const e = new Error(msg.error || "Refused.");
        e.status = msg.status || 0;
        e.code = msg.code || "";
        e.request = msg.request;
        w.done(e);
      } else if (w.types.includes(msg.type) && w.match(msg)) {
        w.done(null, msg);
      }
    }
  }

  rejectAll(err) {
    for (const w of [...this.waiters]) w.done(err);
  }

  request(msg, types, { timeout = 15000, match = () => true } = {}) {
    return new Promise((resolve, reject) => {
      const w = {
        request: msg.type,
        types: [].concat(types),
        match,
        done: (err, value) => {
          clearTimeout(w.timer);
          this.waiters.delete(w);
          if (err) reject(err);
          else resolve(value);
        },
      };
      w.timer = setTimeout(() => w.done(new Error(`The agent server did not answer "${msg.type}" in ${Math.round(timeout / 1000)}s.`)), timeout);
      this.waiters.add(w);
      try {
        this.send(msg);
      } catch (e) {
        w.done(e);
      }
    });
  }

  // Re-present a FRESH token on the open socket, after a step-up sign-in. The
  // server re-verifies on any "auth" message, so a terminal refused for an old
  // sign-in can be retried without dropping every other view's connection.
  async reauth() {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in.");
    const token = await user.getIdToken(true);
    return this.request({ type: "auth", token }, ["ready"], { timeout: 15000 });
  }

  /* ---- chat ---- */
  chatList() {
    this.send({ type: "chat.list" });
  }
  chatHistory(profile, tool, sessionId) {
    this.send({ type: "chat.history", profile, tool, sessionId });
  }
  // Resolves with { chatId, sessionId } once the child is running.
  chatStart({ profile, tool, model, cwd, repo, orgId, policy, prompt } = {}) {
    const body = { type: "chat.start", profile, tool, model, orgId, policy, prompt };
    if (repo) body.repo = repo;
    else if (cwd) body.cwd = cwd;
    return this.request(body, ["chat.started"], { timeout: 60000 });
  }
  chatSend(chatId, text) {
    this.send({ type: "chat.send", chatId, text });
  }
  chatInterrupt(chatId) {
    this.send({ type: "chat.interrupt", chatId });
  }
  chatClose(chatId) {
    this.send({ type: "chat.close", chatId });
  }
  chatResume({ profile, tool, sessionId, prompt } = {}) {
    return this.request({ type: "chat.resume", profile, tool, sessionId, ...(prompt ? { prompt } : {}) }, ["chat.started"], {
      timeout: 60000,
    });
  }

  /* ---- desktop ----
     A browser cannot put a header on a WebSocket, so the VNC socket is opened
     with a one-time ticket minted over THIS authenticated one. */
  async desktopTicket() {
    const msg = await this.request({ type: "desktop.ticket" }, ["desktop.ticket", "ticket"]);
    if (!msg.ticket) throw new Error("The agent server sent no desktop ticket.");
    return msg.ticket;
  }
  // What is running on the box: {display, vnc, browser} each "up" or "down".
  // The Desktop view asks this first and uses VNC only when it is up.
  desktopStatus() {
    return this.request({ type: "desktop.status" }, ["desktop.status"], { timeout: 10000 });
  }
  // A frame for the screenshot stream. With a scale: a JPEG fitted to the
  // pane; without: the full-size PNG. width/height are always the SCREEN's.
  desktopShot({ scale, quality } = {}) {
    const q = { type: "desktop.screenshot" };
    if (scale !== undefined) q.scale = scale;
    if (quality !== undefined) q.quality = quality;
    return this.request(q, ["desktop.screenshot"], { timeout: 25000 });
  }
  // The owner driving: one validated action ({action:"click", x, y, button}
  // and the rest). Needs a sign-in from the last 30 minutes; the refusal
  // carries status 403 so the view can step up and retry.
  desktopAction(action) {
    return this.request({ ...action, type: "desktop.action" }, ["desktop.acted"], { timeout: 20000 });
  }
  // The push stream: the box sends frames as the screen changes; each is
  // acked after it is drawn. Resolves with {width, height, fps, scale,
  // quality, source, at} — `at` is the box's clock, for the latency readout.
  // An older agentd answers Unknown message, which rejects here, and the view
  // falls back to polling desktopShot.
  desktopStreamStart({ fps, scale, quality } = {}) {
    const q = { type: "desktop.stream.start" };
    if (fps !== undefined) q.fps = fps;
    if (scale !== undefined) q.scale = scale;
    if (quality !== undefined) q.quality = quality;
    return this.request(q, ["desktop.stream.started"], { timeout: 15000 });
  }
  desktopStreamUpdate(opts = {}) {
    this.send({ ...opts, type: "desktop.stream.update" });
  }
  desktopStreamStop() {
    try {
      this.send({ type: "desktop.stream.stop" });
    } catch (_) {}
  }
  desktopStreamAck(seq) {
    try {
      this.send({ type: "desktop.stream.ack", seq });
    } catch (_) {}
  }
  desktopUrl(ticket) {
    const u = new URL(this.url);
    u.pathname = "/desktop";
    u.search = `?ticket=${encodeURIComponent(ticket)}`;
    return u.toString();
  }

  /* ---- terminal ----
     Output comes back only to this socket, never broadcast. */
  termOpen({ cols = 80, rows = 24, cwd } = {}) {
    return this.request({ type: "term.open", cols, rows, ...(cwd ? { cwd } : {}) }, ["term.opened"], { timeout: 20000 });
  }
  termInput(termId, data) {
    this.send({ type: "term.input", termId, data });
  }
  termResize(termId, cols, rows) {
    this.send({ type: "term.resize", termId, cols, rows });
  }
  termClose(termId) {
    this.send({ type: "term.close", termId });
  }

  /* ---- previews ---- */
  previewList() {
    this.send({ type: "preview.list" });
  }
  // Resolves with { url, expiresAt } — the url carries a short-lived signed
  // cookie grant, because an iframe cannot send a bearer header.
  previewOpen(port) {
    return this.request({ type: "preview.open", port: Number(port) }, ["preview.open", "preview.opened", "preview"], {
      match: (m) => !m.port || Number(m.port) === Number(port),
    });
  }

  /* ---- review timeline ---- */
  opsList({ since, actor, kind, limit } = {}) {
    const q = { type: "ops.list" };
    if (since) q.since = since;
    if (actor) q.actor = actor;
    if (kind) q.kind = kind;
    if (limit) q.limit = limit;
    this.send(q);
  }

  start(job) {
    this.send({ type: "start", ...job });
  }
  stop(jobId) {
    this.send({ type: "stop", jobId });
  }
  answer(id, allow, { scope = "once", reason = "" } = {}) {
    this.send({ type: "answer", id, allow, scope, reason });
  }
  transcript(jobId) {
    this.send({ type: "transcript", jobId });
  }
  halt(reason) {
    this.send({ type: "halt", reason });
  }
  resume() {
    this.send({ type: "resume" });
  }
  addProfile(name) {
    this.send({ type: "profile.add", name });
  }
  status() {
    this.send({ type: "status" });
  }

  /* ---- signing a profile in ----
     The token travels over this authenticated socket once and is stored ON THE
     BOX; nothing here keeps it. The server answers with a status row carrying
     presence and the last four characters, never the token. */
  loginToken(profile, tool, token) {
    this.send({ type: "login.token", profile, tool, token });
  }
  loginStart(profile, tool) {
    this.send({ type: "login.start", profile, tool });
  }
  loginCode(id, code) {
    this.send({ type: "login.code", id, code });
  }
  loginCancel(id) {
    this.send({ type: "login.cancel", id });
  }
  logout(profile, tool) {
    this.send({ type: "login.logout", profile, tool });
  }

  /* ---- Claude Code features, per profile ---- */
  plugins(profile) {
    this.send({ type: "plugins.list", profile });
  }
  installPlugin(profile, name) {
    this.send({ type: "plugins.install", profile, name });
  }
  removePlugin(profile, name) {
    this.send({ type: "plugins.remove", profile, name });
  }
  addMarketplace(profile, source) {
    this.send({ type: "marketplace.add", profile, source });
  }
  skills(profile) {
    this.send({ type: "skills.list", profile });
  }
  mcpServers(profile) {
    this.send({ type: "mcp.list", profile });
  }
}

/* ---------------- time, for "is it stuck" ---------------- */

// A job row carries elapsedMs / idleMs as measured when the server SENT it.
// Between broadcasts the panel keeps counting from the moment it received the
// row, and from the last transcript event it saw — so "quiet for 4m" keeps
// growing on screen without the server having to tick every client.
export function liveTimes(job, { now, receivedAt, lastSeen }) {
  const live = ["queued", "running", "waiting", "stalled"].includes(job.state);
  const since = live && receivedAt ? Math.max(0, now - receivedAt) : 0;
  const elapsed = (job.elapsedMs || 0) + (job.startedAt ? since : 0);
  let idle = live ? (job.idleMs || 0) + since : 0;
  if (live && lastSeen && lastSeen > (receivedAt || 0)) idle = Math.min(idle, now - lastSeen);
  return { elapsed, idle, live };
}

// "45s", "6m", "1h 12m". Coarse on purpose: a job that has been quiet for
// 4m 37s and one quiet for 4m 52s are the same answer to "is it stuck".
export function dur(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
}

// Comma or space separated names, as typed into a hint field.
export const splitNames = (s) =>
  [...new Set(String(s || "").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];

/* ---------------- voice ---------------- */

// The "say something and it happens" half. Browser-native Web Speech API —
// no key, no service, no cost, and nothing leaves the device except the text
// you would have typed anyway.
//
// Support is uneven: Chrome and Edge have it, Firefox does not, and iOS Safari
// requires a user gesture per utterance. So this is an ENHANCEMENT — the panel
// is fully usable by typing, and the microphone button simply does not appear
// where the API is missing. It is never the only way to do something.
export const speechSupported = () =>
  typeof window !== "undefined" &&
  !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export function listen({ onText, onEnd = () => {}, onError = () => {} } = {}) {
  const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Impl) throw new Error("This browser has no speech recognition.");

  const rec = new Impl();
  rec.lang = navigator.language || "en-US";
  rec.continuous = false;
  // Interim results make it feel responsive; only the final one is submitted.
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    const last = e.results[e.results.length - 1];
    onText(last[0].transcript, last.isFinal);
  };
  rec.onerror = (e) => onError(e.error || "speech failed");
  rec.onend = onEnd;
  rec.start();
  return () => rec.stop();
}

// Spoken status, for when the phone is in a pocket. Short on purpose: reading a
// transcript aloud is noise, "two approvals waiting" is information.
export function say(text, { enabled = true } = {}) {
  if (!enabled || typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 240));
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch (_) {
    // A browser that refuses to speak is not a failure worth surfacing.
  }
}

/* ---------------- turning a sentence into a job ---------------- */

// One implementation, in a pure module, so it can be tested without a browser.
// The same reason noteShape.js and repoAudit.js are pure — and the GitHub audit
// already showed what a second copy does within an hour.
export { parseCommand, CommandError } from "./server/agentCommand";
