// The shared desktop: one real X display on this box, watched and driven from
// the admin, and acted on by the agents — the same screen, so when Claude
// clicks the owner sees it happen and can take over.
//
// Four parts, all loopback-only:
//   Xvfb :1 + XFCE        agentd-desktop.service
//   x11vnc 127.0.0.1:5901 agentd-vnc.service      (-localhost -nopw)
//   chromium, CDP 9222    agentd-browser.service  (--remote-debugging-address=127.0.0.1)
//   this file             the ONLY way any of it is reached from outside
//
// The VNC stream rides `wss://agent…/desktop?ticket=…`, websockify-style:
// binary frames in, raw RFB bytes to 127.0.0.1:5901, and back. A browser
// cannot put a bearer header on a WebSocket, so the main (already
// authenticated) socket mints a one-time ticket that lives 60 seconds.
//
// View-only is enforced HERE, not trusted to noVNC: a view-only connection's
// keyboard, pointer and clipboard messages are dropped before they reach
// x11vnc, and anything this parser does not recognise closes the connection.
//
// Every action is spawned with ARRAY arguments (never a shell) and DISPLAY=:1.
import net from "net";
import crypto from "crypto";
import { spawn } from "child_process";
import { record as recordOp } from "./oplog.js";
import { allowedEmails } from "./auth.js";

export class DesktopError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const DISPLAY = process.env.AGENT_DISPLAY || ":1";
export const VNC_PORT = Number(process.env.AGENT_VNC_PORT || 5901);
// Xvfb :1 requires this cookie (see profiles.js); every capture and input
// tool agentd spawns carries it.
export const XAUTHORITY = () => process.env.AGENT_XAUTHORITY || process.env.XAUTHORITY || "/run/agentd-desktop/Xauthority";
export const CDP_PORT = Number(process.env.AGENT_CDP_PORT || 9222);
export const SCREEN = { width: 1600, height: 900 };

/* ---------------- tickets ---------------- */

export const TICKET_TTL_MS = 60_000;
const hashTicket = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

// One-time, short-lived, bound to the user who minted it. Stored by hash, so
// a heap dump does not hand out live tickets. Redeeming DELETES the ticket
// whether or not it is still valid — a ticket is tried once.
export class Tickets {
  constructor({ ttlMs = TICKET_TTL_MS, now = () => Date.now(), max = 64 } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.max = max;
    this.map = new Map();
  }

  sweep() {
    const t = this.now();
    for (const [k, v] of this.map) if (v.expiresAt <= t) this.map.delete(k);
  }

  mint(claims, { viewOnly = true, purpose = "desktop" } = {}) {
    const email = String(claims?.email || "").toLowerCase();
    if (!claims || !email) throw new DesktopError("Authenticate first.", 401);
    this.sweep();
    if (this.map.size >= this.max) throw new DesktopError("Too many desktop tickets are open. Wait a minute and try again.", 429);
    const ticket = crypto.randomBytes(24).toString("base64url");
    const expiresAt = this.now() + this.ttlMs;
    // Only an explicit false is interactive.
    const vo = viewOnly !== false;
    this.map.set(hashTicket(ticket), { email, sub: String(claims.sub || ""), viewOnly: vo, purpose, expiresAt });
    return { ticket, expiresAt, viewOnly: vo };
  }

  redeem(ticket, { purpose = "desktop", allowed = allowedEmails } = {}) {
    if (typeof ticket !== "string" || !ticket) return null;
    const key = hashTicket(ticket);
    const t = this.map.get(key);
    this.map.delete(key);
    if (!t) return null;
    if (t.expiresAt <= this.now()) return null;
    if (t.purpose !== purpose) return null;
    // Re-checked at redemption: an e-mail removed from the allow-list within
    // the ticket's minute does not get in on it.
    if (!allowed().includes(t.email)) return null;
    return t;
  }
}

/* ---------------- RFB view-only filter ---------------- */

// PURE. Parses the CLIENT→server half of RFB just enough to drop input.
// Handshake: 12-byte version; for 3.7+ a 1-byte security choice (and a
// 16-byte response if VNC auth were chosen — x11vnc here runs -nopw, so it is
// None); then the 1-byte ClientInit. After that, whole messages.
const INPUT_TYPES = new Set([4, 5, 6, 248, 251, 252]);
export class RfbClientFilter {
  constructor() {
    this.stage = "version";
    this.buf = Buffer.alloc(0);
    this.dropped = 0;
  }

  // Bytes needed for the message at the head of the buffer, or 0 if more
  // bytes are needed to know, or -1 if the type is unknown.
  static messageLength(b) {
    if (!b.length) return 0;
    switch (b[0]) {
      case 0:
        return 20; // SetPixelFormat
      case 2:
        return b.length < 4 ? 0 : 4 + 4 * b.readUInt16BE(2); // SetEncodings
      case 3:
        return 10; // FramebufferUpdateRequest
      case 4:
        return 8; // KeyEvent
      case 5:
        return 6; // PointerEvent
      case 6:
        return b.length < 8 ? 0 : 8 + b.readUInt32BE(4); // ClientCutText
      case 150:
        return 10; // EnableContinuousUpdates
      case 248:
        // QEMU client message; only the extended key event (subtype 0) is known.
        if (b.length < 2) return 0;
        return b[1] === 0 ? 12 : -1;
      case 251:
        return b.length < 8 ? 0 : 8 + 16 * b[6]; // SetDesktopSize
      case 252:
        return 4; // xvp
      default:
        return -1;
    }
  }

  // → { out: Buffer to forward, error?: string }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out = [];
    for (;;) {
      if (this.stage === "version") {
        if (this.buf.length < 12) break;
        const v = this.buf.subarray(0, 12).toString("latin1");
        const m = /^RFB (\d{3})\.(\d{3})\n$/.exec(v);
        if (!m) return { out: Buffer.concat(out), error: "Not an RFB client." };
        out.push(this.buf.subarray(0, 12));
        this.buf = this.buf.subarray(12);
        this.stage = Number(m[2]) >= 7 ? "security" : "init";
        continue;
      }
      if (this.stage === "security") {
        if (this.buf.length < 1) break;
        const type = this.buf[0];
        out.push(this.buf.subarray(0, 1));
        this.buf = this.buf.subarray(1);
        if (type === 1) this.stage = "init";
        else if (type === 2) this.stage = "vncauth";
        else return { out: Buffer.concat(out), error: `Security type ${type} is not supported here.` };
        continue;
      }
      if (this.stage === "vncauth") {
        if (this.buf.length < 16) break;
        out.push(this.buf.subarray(0, 16));
        this.buf = this.buf.subarray(16);
        this.stage = "init";
        continue;
      }
      if (this.stage === "init") {
        if (this.buf.length < 1) break;
        out.push(this.buf.subarray(0, 1));
        this.buf = this.buf.subarray(1);
        this.stage = "messages";
        continue;
      }
      // messages
      const len = RfbClientFilter.messageLength(this.buf);
      if (len < 0) return { out: Buffer.concat(out), error: `Unknown RFB message type ${this.buf[0]}; a view-only connection closes rather than guess.` };
      if (len === 0 || this.buf.length < len) break;
      const msg = this.buf.subarray(0, len);
      this.buf = this.buf.subarray(len);
      if (INPUT_TYPES.has(msg[0])) this.dropped++;
      else out.push(msg);
    }
    return { out: Buffer.concat(out) };
  }
}

/* ---------------- the VNC pipe ---------------- */

// websockify semantics: each binary frame from the browser is written to the
// TCP socket, each TCP chunk becomes one binary frame. `connect` is injectable
// so the test can point it at a fake server.
export function pipeToVnc(ws, { host = "127.0.0.1", port = VNC_PORT, viewOnly = true, connect = net.connect, onEnd = () => {} } = {}) {
  const tcp = connect({ host, port });
  const filter = viewOnly ? new RfbClientFilter() : null;
  let ended = false;
  const end = (code, reason) => {
    if (ended) return;
    ended = true;
    try {
      tcp.destroy();
    } catch (_) {}
    try {
      if (ws.readyState === 1) ws.close(code, reason);
    } catch (_) {}
    onEnd({ code, reason, dropped: filter?.dropped || 0 });
  };

  tcp.on("data", (d) => {
    if (ws.readyState !== 1) return;
    ws.send(d, { binary: true });
    // Back-pressure: a phone on a slow link must not make the daemon buffer
    // the whole framebuffer stream in memory.
    if (ws.bufferedAmount > 8 * 1024 * 1024) {
      tcp.pause();
      const t = setInterval(() => {
        if (ws.readyState !== 1 || ws.bufferedAmount < 1024 * 1024) {
          clearInterval(t);
          tcp.resume();
        }
      }, 50);
    }
  });
  tcp.on("error", (e) => end(1011, `The desktop is not reachable (${e.code || e.message}).`.slice(0, 120)));
  tcp.on("close", () => end(1000, "The desktop closed the connection."));

  ws.on("message", (data) => {
    const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
    if (!filter) {
      tcp.write(buf);
      return;
    }
    const r = filter.push(buf);
    if (r.out.length) tcp.write(r.out);
    if (r.error) end(4403, r.error.slice(0, 120));
  });
  ws.on("close", () => end(1000, "closed"));
  return { tcp, filter, end };
}

// noVNC asks for the "binary" subprotocol; anything else (the old base64
// mode) is not offered.
export const handleProtocols = (protocols) => (protocols.has("binary") ? "binary" : false);

export const isDesktopUpgrade = (rawUrl) => new URL(rawUrl || "/", "http://x").pathname.replace(/\/+$/, "") === "/desktop";

/* ---------------- actions ---------------- */

export const ACTIONS = ["click", "double_click", "move", "type", "key", "scroll", "open_url", "focus_window", "list_windows", "screenshot"];
export const READ_ACTIONS = new Set(["screenshot", "list_windows"]);
export const KEY_COMBO = /^[A-Za-z0-9_]{1,24}(\+[A-Za-z0-9_]{1,24}){0,3}$/;
const COORD_MAX = 10_000;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

const coord = (v, name) => {
  const n = Number(v);
  if (v === undefined || v === null || v === "" || typeof v === "boolean" || !Number.isInteger(n) || n < 0 || n > COORD_MAX) {
    throw new DesktopError(`${name} must be a whole number of pixels from 0 to ${COORD_MAX}.`);
  }
  return n;
};

// PURE. The same shapes the site's assertDesktopAction allows, checked again
// on the box, plus the two looks (screenshot, list_windows) the stdio MCP
// server needs. Returns a NEW object holding only known fields.
export function assertAction(raw = {}) {
  const a = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const action = String(a.action ?? "");
  if (!ACTIONS.includes(action)) throw new DesktopError(`"${action.slice(0, 30)}" is not a desktop action. Actions: ${ACTIONS.join(", ")}.`);
  if (action === "screenshot" || action === "list_windows") return { action };
  if (action === "click" || action === "double_click" || action === "move") {
    const out = { action, x: coord(a.x, "x"), y: coord(a.y, "y") };
    if (action !== "move") {
      const button = a.button === undefined || a.button === "" ? "left" : String(a.button);
      if (!["left", "right", "middle"].includes(button)) throw new DesktopError(`button must be left, right or middle, not "${button.slice(0, 20)}".`);
      out.button = button;
    }
    return out;
  }
  if (action === "type") {
    const text = typeof a.text === "string" ? a.text : "";
    if (!text) throw new DesktopError("type needs text.");
    if (text.length > 2000) throw new DesktopError(`text is ${text.length} characters; type at most 2000 at a time.`);
    if (CONTROL.test(text)) throw new DesktopError("text may not carry control characters. Use key for Enter, Escape, Tab and combos.");
    return { action, text };
  }
  if (action === "key") {
    const combo = String(a.combo ?? "").trim();
    if (!KEY_COMBO.test(combo)) throw new DesktopError(`"${combo.slice(0, 40)}" is not a key combo. Use key names joined by + (Return, ctrl+l), letters, digits and _ only, at most four keys.`);
    return { action, combo };
  }
  if (action === "scroll") {
    const direction = String(a.direction ?? "down");
    if (!["up", "down", "left", "right"].includes(direction)) throw new DesktopError(`direction must be up, down, left or right, not "${direction.slice(0, 20)}".`);
    const amount = a.amount === undefined ? 3 : Number(a.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 20) throw new DesktopError("amount must be a whole number of notches from 1 to 20.");
    const out = { action, direction, amount };
    if (a.x !== undefined || a.y !== undefined) Object.assign(out, { x: coord(a.x, "x"), y: coord(a.y, "y") });
    return out;
  }
  if (action === "open_url") {
    const url = String(a.url ?? "").trim();
    if (url.length > 2048) throw new DesktopError("That URL is over 2048 characters.");
    let u;
    try {
      u = new URL(url);
    } catch (_) {
      throw new DesktopError(`"${url.slice(0, 60)}" is not a URL.`);
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new DesktopError(`Only http and https pages open on the desktop — not ${u.protocol}`);
    return { action, url: u.toString() };
  }
  const window = String(a.window ?? "").trim();
  if (!window || window.length > 120 || CONTROL.test(window)) throw new DesktopError("focus_window needs window: part of the window's title, up to 120 characters.");
  return { action, window };
}

const BUTTON = { left: "1", middle: "2", right: "3" };
const WHEEL = { up: "4", down: "5", left: "6", right: "7" };
// xdotool's --name is a regular expression; a title is matched literally.
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// PURE. The xdotool argv for an action (already through assertAction). One
// invocation, chained — xdotool runs the commands in order.
export function xdotoolArgs(a) {
  switch (a.action) {
    case "move":
      return ["mousemove", "--sync", String(a.x), String(a.y)];
    case "click":
      return ["mousemove", "--sync", String(a.x), String(a.y), "click", BUTTON[a.button]];
    case "double_click":
      return ["mousemove", "--sync", String(a.x), String(a.y), "click", "--repeat", "2", "--delay", "120", BUTTON[a.button]];
    case "type":
      // "--" so a text starting with a hyphen is typed, never parsed as a flag.
      return ["type", "--clearmodifiers", "--delay", "12", "--", a.text];
    case "key":
      return ["key", "--clearmodifiers", "--", a.combo];
    case "scroll": {
      const pre = a.x !== undefined ? ["mousemove", "--sync", String(a.x), String(a.y)] : [];
      return [...pre, "click", "--repeat", String(a.amount), "--delay", "40", WHEEL[a.direction]];
    }
    case "focus_window":
      return ["search", "--limit", "1", "--name", escapeRegex(a.window), "windowactivate", "--sync"];
    case "list_windows":
      return ["search", "--onlyvisible", "--name", "."];
    default:
      throw new DesktopError(`${a.action} is not an xdotool action.`);
  }
}

// PURE. The one line the timeline and the approval card show.
export function describeAction(a) {
  switch (a.action) {
    case "click":
      return `Click ${a.button} at (${a.x}, ${a.y})`;
    case "double_click":
      return `Double-click ${a.button} at (${a.x}, ${a.y})`;
    case "move":
      return `Move the pointer to (${a.x}, ${a.y})`;
    case "type":
      return `Type "${a.text.length > 80 ? `${a.text.slice(0, 80)}…` : a.text}"`;
    case "key":
      return `Press ${a.combo}`;
    case "scroll":
      return `Scroll ${a.direction} ${a.amount}${a.x !== undefined ? ` at (${a.x}, ${a.y})` : ""}`;
    case "open_url":
      return `Open ${a.url}`;
    case "focus_window":
      return `Focus "${a.window}"`;
    case "list_windows":
      return "List windows";
    case "screenshot":
      return "Screenshot";
    default:
      return a.action;
  }
}

export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || !buf.subarray(0, 8).equals(PNG_MAGIC)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/* ---------------- screenshots for the stream ---------------- */

// The admin's Desktop view works WITHOUT VNC: on a box where x11vnc cannot
// run (SELinux enforcing, the owner's choice), it polls screenshots. A
// full-size PNG of a 1600x900 desktop is ~1 MB a frame; a JPEG fitted to a
// phone's pane is ~30 KB. So the socket asks for a scale and a quality, and
// the answer carries the REAL screen size, because a click on a scaled image
// has to land on screen pixels.
export const SHOT = { minScale: 0.25, maxScale: 1, minQuality: 30, maxQuality: 95, quality: 70 };

// PURE. → {format:"png"} or {format:"jpeg", scale, quality}. Asking for a
// scale or a quality implies JPEG; asking for PNG with either is refused
// rather than silently ignored.
export function assertShotOptions(raw = {}) {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const format = o.format === undefined || o.format === "" ? (o.scale !== undefined || o.quality !== undefined ? "jpeg" : "png") : String(o.format);
  if (format !== "png" && format !== "jpeg") throw new DesktopError(`format must be png or jpeg, not "${format.slice(0, 20)}".`);
  if (format === "png") {
    if (o.scale !== undefined || o.quality !== undefined) throw new DesktopError("scale and quality apply to a JPEG screenshot only.");
    return { format };
  }
  const scale = o.scale === undefined ? 1 : typeof o.scale === "number" ? o.scale : NaN;
  if (!Number.isFinite(scale) || scale < SHOT.minScale || scale > SHOT.maxScale) throw new DesktopError(`scale must be a number from ${SHOT.minScale} to ${SHOT.maxScale}.`);
  const quality = o.quality === undefined ? SHOT.quality : typeof o.quality === "number" ? o.quality : NaN;
  if (!Number.isInteger(quality) || quality < SHOT.minQuality || quality > SHOT.maxQuality) throw new DesktopError(`quality must be a whole number from ${SHOT.minQuality} to ${SHOT.maxQuality}.`);
  return { format, scale, quality };
}

// PURE. ImageMagick's import argv for those options.
export function screenshotArgs(o = { format: "png" }) {
  if (o.format !== "jpeg") return ["-window", "root", "png:-"];
  const args = ["-window", "root"];
  if (o.scale < 1) args.push("-resize", `${Math.round(o.scale * 1000) / 10}%`);
  args.push("-quality", String(o.quality), "jpeg:-");
  return args;
}

// PURE. A JPEG's pixel size, from its first start-of-frame marker.
export function jpegSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

// Whether something listens on a loopback port. Never throws.
export function probePort(port, { host = "127.0.0.1", timeoutMs = 1000, connect = net.connect } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let s;
    const end = (ok) => {
      if (done) return;
      done = true;
      try {
        s?.destroy();
      } catch (_) {}
      resolve(ok);
    };
    try {
      s = connect({ host, port });
    } catch (_) {
      return end(false);
    }
    s.setTimeout?.(timeoutMs, () => end(false));
    s.on("connect", () => end(true));
    s.on("error", () => end(false));
  });
}

const desktopEnv = (display) => {
  const env = { ...process.env, DISPLAY: display, XAUTHORITY: XAUTHORITY() };
  for (const k of ["AGENT_MCP_TOKEN", "AGENT_ADMIN_EMAILS", "AGENT_PREVIEW_SECRET"]) delete env[k];
  return env;
};

// Runs a binary with array args, collects stdout as a Buffer.
export function runCapture(cmd, args, { env, timeoutMs = 15_000, maxBytes = 12 * 1024 * 1024, spawnFn = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return reject(e);
    }
    const chunks = [];
    let size = 0;
    let err = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (_) {}
      reject(new DesktopError(`${cmd} took longer than ${Math.round(timeoutMs / 1000)}s.`, 504));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      size += d.length;
      if (size > maxBytes) {
        try {
          child.kill("SIGKILL");
        } catch (_) {}
        return;
      }
      chunks.push(d);
    });
    child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new DesktopError(e.code === "ENOENT" ? `${cmd} is not installed — run agent/setup/setup.sh.` : `${cmd} could not start (${e.message}).`, 503));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (size > maxBytes) return reject(new DesktopError(`${cmd} produced more than ${maxBytes} bytes.`, 502));
      if (code !== 0) return reject(new DesktopError(`${cmd} failed (${code}): ${String(err).trim().slice(0, 300) || "no output"}. Is agentd-desktop running?`, 502));
      resolve(Buffer.concat(chunks));
    });
  });
}

// PURE. The CDP "open a tab" URL. Chrome reads the query verbatim (unescaped)
// as the address, so it is component-encoded.
export const cdpNewTabUrl = (url, port = CDP_PORT) => `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`;

export class Desktop {
  constructor({ run = runCapture, fetchFn = (...a) => globalThis.fetch(...a), display = DISPLAY, cdpPort = CDP_PORT, vncPort = VNC_PORT, probe = probePort } = {}) {
    this.run = run;
    this.fetch = fetchFn;
    this.display = display;
    this.cdpPort = cdpPort;
    this.vncPort = vncPort;
    this.probe = probe;
    this.screen = null; // the real screen size, once known
  }

  // The X screen's size, asked of the display once and remembered.
  async screenSize() {
    if (this.screen) return this.screen;
    const out = String(await this.run("xdotool", ["getdisplaygeometry"], { env: desktopEnv(this.display), timeoutMs: 5000 }));
    const m = /^(\d{2,5})\s+(\d{2,5})/.exec(out.trim());
    if (!m) throw new DesktopError("The display did not say its size.", 502);
    this.screen = { width: Number(m[1]), height: Number(m[2]) };
    return this.screen;
  }

  // No options: a full-size PNG ({png, width, height}), as the agents' MCP
  // tools and GET /desktop/screenshot always had. With {scale, quality} or
  // {format:"jpeg"}: a JPEG, its own size, and the SCREEN's size.
  async screenshot(opts = {}) {
    const o = assertShotOptions(opts);
    const image = await this.run("import", screenshotArgs(o), { env: desktopEnv(this.display), timeoutMs: 20_000 });
    if (o.format === "png") {
      const size = pngSize(image);
      if (!size) throw new DesktopError("The screenshot was not a PNG. Is agentd-desktop running?", 502);
      this.screen = { ...size };
      return { png: image, image, format: "png", mime: "image/png", ...size, imageWidth: size.width, imageHeight: size.height, scale: 1 };
    }
    const size = jpegSize(image);
    if (!size) throw new DesktopError("The screenshot was not a JPEG. Is ImageMagick installed with JPEG support?", 502);
    let screen;
    try {
      screen = o.scale === 1 ? { ...size } : await this.screenSize();
    } catch (_) {
      // Fall back to undoing the scale; off by a pixel at most.
      screen = { width: Math.round(size.width / o.scale), height: Math.round(size.height / o.scale) };
    }
    if (o.scale === 1) this.screen = { ...size };
    return { image, format: "jpeg", mime: "image/jpeg", width: screen.width, height: screen.height, imageWidth: size.width, imageHeight: size.height, scale: o.scale, quality: o.quality };
  }

  // Cheap: is the X display answering, is anything listening for VNC, is the
  // desktop browser's CDP up. Each probe is bounded and none throws.
  async status() {
    const [display, vnc, browser] = await Promise.all([
      this.screenSize()
        .then(() => "up")
        .catch(() => {
          this.screen = null;
          return "down";
        }),
      Promise.resolve(this.probe(this.vncPort)).then((ok) => (ok ? "up" : "down"), () => "down"),
      Promise.resolve()
        .then(() => this.fetch(`http://127.0.0.1:${this.cdpPort}/json/version`, { signal: AbortSignal.timeout(2000) }))
        .then((r) => (r && r.ok ? "up" : "down"), () => "down"),
    ]);
    return { display, vnc, browser, screen: display === "up" ? this.screen : null };
  }

  async listWindows() {
    let ids = [];
    try {
      ids = String(await this.run("xdotool", xdotoolArgs({ action: "list_windows" }), { env: desktopEnv(this.display) }))
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s))
        .slice(0, 60);
    } catch (e) {
      // xdotool search exits 1 when nothing matches: an empty desktop.
      if (/failed \(1\)/.test(e.message)) return { windows: [] };
      throw e;
    }
    const windows = [];
    for (const id of ids) {
      try {
        const title = String(await this.run("xdotool", ["getwindowname", id], { env: desktopEnv(this.display) })).trim();
        if (title) windows.push({ id, title: title.slice(0, 200) });
      } catch (_) {}
    }
    return { windows };
  }

  async openUrl(url) {
    let res;
    try {
      // PUT: Chrome 111+ refuses GET on /json/new.
      res = await this.fetch(cdpNewTabUrl(url, this.cdpPort), { method: "PUT", signal: AbortSignal.timeout(10_000) });
    } catch (e) {
      throw new DesktopError(`The desktop browser is not answering on 127.0.0.1:${this.cdpPort} (${e.message}). Check agentd-browser.service.`, 503);
    }
    if (!res.ok) throw new DesktopError(`The desktop browser refused to open a tab (${res.status}).`, 502);
    const tab = await res.json().catch(() => ({}));
    if (tab.id && /^[A-Za-z0-9-]{1,64}$/.test(tab.id)) {
      try {
        await this.fetch(`http://127.0.0.1:${this.cdpPort}/json/activate/${tab.id}`, { signal: AbortSignal.timeout(5000) });
      } catch (_) {}
    }
    return { tabId: tab.id || null, url };
  }

  // `a` has been through assertAction.
  async act(a) {
    if (a.action === "screenshot") return this.screenshot();
    if (a.action === "list_windows") return this.listWindows();
    if (a.action === "open_url") return this.openUrl(a.url);
    await this.run("xdotool", xdotoolArgs(a), { env: desktopEnv(this.display) });
    return {};
  }
}

/* ---------------- the gate ---------------- */

// PURE. Whether an action runs unasked. The same three levels as
// policy.decide: yolo asks nothing; manual asks everything; allowlist lets the
// two LOOKS through and asks for every action that changes the screen — a
// click can press "Pay", a key can be Return.
export function desktopDecision({ policy = "allowlist", action } = {}) {
  const p = ["manual", "allowlist", "yolo"].includes(policy) ? policy : "manual";
  if (p === "yolo") return { allow: true, reason: "Policy is yolo: nothing is asked." };
  if (p === "manual") return { allow: false, reason: "Policy is manual: every desktop action asks." };
  if (READ_ACTIONS.has(action)) return { allow: true, reason: "It only looks." };
  return { allow: false, reason: "It acts on the shared desktop, so it asks." };
}

// A desktop tool call from Claude Code already went through its permission
// prompt (mcp__agentd__approve) and the owner said yes there. A yes on THAT
// card is a one-time pass here, for the identical action within a minute, so
// the owner is not asked twice for one click. Anything else asks.
const PASS_TTL_MS = 60_000;
const passKey = (callerId, a) => `${callerId}::${JSON.stringify(a)}`;

export class DesktopGate {
  constructor({ desktop = new Desktop(), approvals, log = recordOp, now = () => Date.now() } = {}) {
    this.desktop = desktop;
    this.approvals = approvals;
    this.log = log;
    this.now = now;
    this.passes = new Map();
  }

  // From an approval card for mcp__desktop__<action> that was answered yes.
  noteApproved(callerId, tool, input) {
    const m = /^mcp__desktop__([a-z_]+)$/.exec(String(tool || ""));
    if (!m) return false;
    let a;
    try {
      a = assertAction({ ...(input || {}), action: m[1] });
    } catch (_) {
      return false;
    }
    const t = this.now();
    for (const [k, exp] of this.passes) if (exp <= t) this.passes.delete(k);
    this.passes.set(passKey(callerId, a), t + PASS_TTL_MS);
    return true;
  }

  consumePass(callerId, a) {
    const k = passKey(callerId, a);
    const exp = this.passes.get(k);
    this.passes.delete(k);
    return !!exp && exp > this.now();
  }

  // → { ok, denied?, reason, decision, result? }. Logs exactly one entry per
  // acting call, whatever the outcome; the two looks are not logged (a
  // screenshot every few seconds would bury the actions).
  async run({ callerId, actor, policy, action: raw, waitMs }) {
    const a = assertAction(raw);
    const kind = a.action === "open_url" ? "browser" : "desktop";
    const log = (decision, extra = {}) => {
      if (READ_ACTIONS.has(a.action) && decision !== "denied") return;
      this.log({ actor, kind, summary: describeAction(a), detail: { ...a, ...extra }, decision });
    };

    let decision = "auto";
    let reason = "";
    const d = desktopDecision({ policy, action: a.action });
    if (!d.allow) {
      if (this.consumePass(callerId, a)) {
        decision = "allowed";
        reason = "Approved at the permission prompt.";
      } else if (!this.approvals) {
        log("denied", { reason: "No approval route." });
        return { ok: false, denied: true, decision: "denied", reason: "Nothing can approve this, so it was refused." };
      } else {
        const ans = await this.approvals.ask(callerId, { tool: "Desktop", input: a, cwd: "" }, { timeoutMs: waitMs });
        if (ans.allow !== true) {
          log("denied", { reason: ans.reason });
          return { ok: false, denied: true, decision: "denied", reason: ans.reason || "Denied." };
        }
        decision = "allowed";
        reason = ans.reason || "Allowed.";
      }
    } else reason = d.reason;

    try {
      const result = await this.desktop.act(a);
      log(decision);
      return { ok: true, action: a.action, decision, reason, result };
    } catch (e) {
      log(decision, { error: e.message });
      throw e;
    }
  }
}

/* ---------------- callers of the loopback desktop endpoint ---------------- */

// Chats register here (jobs are known to server.js through their approval
// token). The stdio MCP server inside a chat or job presents the same
// per-run secret the approval bridge does.
const callers = new Map();
export function registerDesktopCaller(id, { token, policy = "allowlist" } = {}) {
  if (!id || !token) throw new DesktopError("A desktop caller needs an id and a token.");
  callers.set(String(id), { token: String(token), policy });
}
export const unregisterDesktopCaller = (id) => callers.delete(String(id));
export const desktopCaller = (id) => callers.get(String(id)) || null;

export function tokenMatches(expected, given) {
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- the push stream ---------------- */

// The Desktop view used to ask for a frame, wait for it, draw it and ask
// again — so the tunnel's round trip (350–470 ms measured) sat inside the
// frame loop and the owner saw 1–2 fps. The stream turns that round: the box
// PUSHES frames as WebSocket binary messages and the browser acks each one
// after drawing it. Flow control keeps the link honest — at most two frames
// un-acked and nothing new while the socket's own buffer is over 256 KB — so
// a slow link gets fewer, FRESHER frames, never a growing queue.
//
// Capture is ONE long-lived ffmpeg x11grab per viewer (MJPEG to a pipe, split
// on the JPEG markers), falling back to an ImageMagick `import` per frame when
// ffmpeg is missing or keeps dying. An idle desktop costs ~nothing: mpdecimate
// drops duplicate frames at the SOURCE (two MJPEG encodes of one screen are
// not promised to be byte-identical, so comparing JPEG bytes alone is not
// enough), and a frame byte-identical to the last one SENT is never sent
// either (that is what catches the import path). A header-only keepalive goes
// out at most every 5 s so the viewer can tell a still screen from a dead
// stream.
//
// Wire format of a frame: [u32 BE header length][UTF-8 JSON header][JPEG].
// Header: {seq, takenAt, imageWidth, imageHeight, width, height, skipped} —
// width and height are the SCREEN's, so a click on the scaled image maps back. A
// keepalive carries keepalive:true and no image, and is not acked.
export const STREAM = {
  minFps: 1,
  maxFps: 15,
  fps: 8,
  minScale: 0.25,
  maxScale: 1,
  scale: 0.5,
  minQuality: 30,
  maxQuality: 90,
  quality: 65,
  maxInFlight: 2,
  maxBuffered: 256 * 1024,
  keepaliveMs: 5000,
  ackTimeoutMs: 4000,
  maxHeader: 16 * 1024,
};

// PURE. Validates a start/update message, merged onto `base` (the stream's
// current settings) — an update may carry one field. Out of range is REFUSED,
// not clamped: the viewer's adaptation should learn the bounds, not be lied to.
export function assertStreamOptions(raw = {}, base = { fps: STREAM.fps, scale: STREAM.scale, quality: STREAM.quality }) {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = { ...base };
  if (o.fps !== undefined) {
    if (typeof o.fps !== "number" || !Number.isInteger(o.fps) || o.fps < STREAM.minFps || o.fps > STREAM.maxFps) throw new DesktopError(`fps must be a whole number from ${STREAM.minFps} to ${STREAM.maxFps}.`);
    out.fps = o.fps;
  }
  if (o.scale !== undefined) {
    if (typeof o.scale !== "number" || !Number.isFinite(o.scale) || o.scale < STREAM.minScale || o.scale > STREAM.maxScale) throw new DesktopError(`scale must be a number from ${STREAM.minScale} to ${STREAM.maxScale}.`);
    out.scale = Math.round(o.scale * 1000) / 1000;
  }
  if (o.quality !== undefined) {
    if (typeof o.quality !== "number" || !Number.isInteger(o.quality) || o.quality < STREAM.minQuality || o.quality > STREAM.maxQuality) throw new DesktopError(`quality must be a whole number from ${STREAM.minQuality} to ${STREAM.maxQuality}.`);
    out.quality = o.quality;
  }
  return out;
}

// PURE. quality 30–90 → MJPEG -q:v 22–2 (lower q:v is better and bigger).
// The default 65 lands on 10: measured on the box, q:v 6 at 800 px wide was
// ~90 KB a frame — too much for a ~200 ms link at 8 fps.
export const mjpegQ = (quality) => Math.max(2, Math.min(31, Math.round(2 + (STREAM.maxQuality - quality) / 3)));

const even = (n) => Math.max(2, 2 * Math.round(n / 2));

// PURE. The ffmpeg argv for a stream. Array args, never a shell.
//   mpdecimate    drops a frame identical to the last KEPT one at the source.
//                 hi/lo/frac are set so only a real duplicate is dropped — a
//                 typed character must never be decimated away.
//   passthrough   so ffmpeg does not re-duplicate those frames to hold a rate
//   flush_packets so each JPEG leaves the pipe whole, not one frame late
export function ffmpegArgs({ fps, scale, quality }, { display = DISPLAY, screen = null } = {}) {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "x11grab", "-draw_mouse", "1", "-framerate", String(fps)];
  if (screen) args.push("-video_size", `${screen.width}x${screen.height}`);
  args.push("-i", display);
  const filters = ["mpdecimate=hi=64:lo=1:frac=0"];
  if (scale < 1) {
    filters.push(screen ? `scale=${even(screen.width * scale)}:${even(screen.height * scale)}:flags=bilinear` : `scale=trunc(iw*${scale}/2)*2:-2:flags=bilinear`);
  }
  args.push("-vf", filters.join(","), "-fps_mode", "passthrough", "-c:v", "mjpeg", "-pix_fmt", "yuvj420p", "-q:v", String(mjpegQ(quality)), "-f", "image2pipe", "-flush_packets", "1", "-");
  return args;
}

const EMPTY = Buffer.alloc(0);

// PURE. One binary frame.
export function packFrame(header, image = EMPTY) {
  const h = Buffer.from(JSON.stringify(header), "utf8");
  const img = Buffer.isBuffer(image) ? image : EMPTY;
  const out = Buffer.allocUnsafe(4 + h.length + img.length);
  out.writeUInt32BE(h.length, 0);
  h.copy(out, 4);
  img.copy(out, 4 + h.length);
  return out;
}

// PURE. The inverse; null for anything malformed.
export function unpackFrame(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  const n = buf.readUInt32BE(0);
  if (n < 2 || n > STREAM.maxHeader || 4 + n > buf.length) return null;
  let header;
  try {
    header = JSON.parse(buf.subarray(4, 4 + n).toString("utf8"));
  } catch (_) {
    return null;
  }
  if (!header || typeof header !== "object") return null;
  return { header, image: buf.subarray(4 + n) };
}

// Splits an MJPEG byte stream into whole JPEGs. It walks the marker segments
// rather than searching for FF D9 anywhere, because the entropy-coded data is
// the only place a marker search is valid (there, a literal FF is stuffed as
// FF 00), and a chunk boundary may fall anywhere — including between the FF
// and the D9.
export class JpegSplitter {
  constructor({ maxBytes = 8 * 1024 * 1024 } = {}) {
    this.maxBytes = maxBytes;
    this.dropped = 0;
    this.reset();
  }

  reset() {
    this.buf = EMPTY;
    this.pos = 0;
    this.state = "seek";
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    const out = [];
    for (;;) {
      const b = this.buf;
      if (this.state === "seek") {
        let i = -1;
        for (let k = b.indexOf(0xff); k >= 0 && k + 1 < b.length; k = b.indexOf(0xff, k + 1)) {
          if (b[k + 1] === 0xd8) {
            i = k;
            break;
          }
        }
        if (i < 0) {
          // Keep a trailing FF: it may be the first half of the next SOI.
          this.buf = b.length && b[b.length - 1] === 0xff ? b.subarray(b.length - 1) : EMPTY;
          break;
        }
        this.buf = b.subarray(i);
        this.pos = 2;
        this.state = "segments";
        continue;
      }
      if (this.state === "segments") {
        const p = this.pos;
        if (p + 2 > b.length) break;
        if (b[p] !== 0xff) {
          // Not a JPEG after all: drop the SOI and look again.
          this.dropped++;
          this.buf = b.subarray(1);
          this.state = "seek";
          continue;
        }
        const m = b[p + 1];
        if (m === 0xff) {
          this.pos = p + 1;
          continue;
        }
        if (m === 0xd9) {
          out.push(Buffer.from(b.subarray(0, p + 2)));
          this.buf = b.subarray(p + 2);
          this.pos = 0;
          this.state = "seek";
          continue;
        }
        if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
          this.pos = p + 2;
          continue;
        }
        if (p + 4 > b.length) break;
        const len = b.readUInt16BE(p + 2);
        if (len < 2) {
          this.dropped++;
          this.buf = b.subarray(1);
          this.state = "seek";
          continue;
        }
        if (p + 2 + len > b.length) break;
        this.pos = p + 2 + len;
        if (m === 0xda) this.state = "entropy";
        continue;
      }
      // Entropy-coded data: the next FF that is not FF00 / RSTn / fill is a marker.
      let i = b.indexOf(0xff, this.pos);
      let found = false;
      while (i >= 0 && i + 1 < b.length) {
        const n = b[i + 1];
        if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) {
          i = b.indexOf(0xff, i + 2);
          continue;
        }
        if (n === 0xff) {
          i = i + 1;
          continue;
        }
        found = true;
        break;
      }
      if (!found) {
        // Resume from the last FF seen (it may pair with the next chunk).
        this.pos = i >= 0 ? i : b.length;
        break;
      }
      this.pos = i;
      this.state = "segments";
    }
    if (this.buf.length > this.maxBytes) {
      this.dropped++;
      this.reset();
    }
    return out;
  }
}

// Whether ffmpeg is known missing: remembered for ten minutes, so every new
// viewer does not pay a failed spawn, and setup.sh installing it later is
// picked up without a restart.
export const ffmpegState = { missingUntil: 0 };

// One viewer's stream. Everything that touches the world is injected:
//   send(buf)     the socket's binary send        buffered()  ws.bufferedAmount
//   isOpen()      ws.readyState === 1             screenSize() {width,height}
//   capture(o)    import screenshot → {image}     spawnFn     child_process.spawn
export class DesktopStream {
  constructor({
    send,
    buffered = () => 0,
    isOpen = () => true,
    screenSize = async () => ({ ...SCREEN }),
    capture = null,
    spawnFn = spawn,
    ffmpeg = process.env.AGENT_DESKTOP_FFMPEG || "ffmpeg",
    display = DISPLAY,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    setRepeat = setInterval,
    clearRepeat = clearInterval,
    state = ffmpegState,
    kickSettleMs = 60,
    onFallback = () => {},
  } = {}) {
    Object.assign(this, { sendRaw: send, buffered, isOpen, screenSize, capture, spawnFn, ffmpeg, display, now, setTimer, clearTimer, setRepeat, clearRepeat, state, kickSettleMs, onFallback });
    this.opts = { fps: STREAM.fps, scale: STREAM.scale, quality: STREAM.quality };
    this.screen = { ...SCREEN };
    this.running = false;
    this.gen = 0;
    this.seq = 0;
    this.inflight = new Map(); // seq → sentAt
    this.lastSent = null;
    this.lastSentAt = 0;
    this.latest = null; // the newest frame held back by flow control
    this.held = 0;
    this.urgentUntil = 0;
    this.failures = [];
    this.source = null;
    this.child = null;
    this.timer = null;
    this.stats = { captured: 0, sent: 0, unchanged: 0, skippedInFlight: 0, skippedBuffered: 0, keepalives: 0, restarts: 0 };
  }

  async start(raw = {}) {
    this.opts = assertStreamOptions(raw);
    try {
      this.screen = await this.screenSize();
    } catch (_) {
      this.screen = { ...SCREEN };
    }
    this.running = true;
    this.lastSentAt = this.now();
    this.beat = this.setRepeat(() => this.tick(), 1000);
    this.beat?.unref?.();
    this.useFfmpeg = this.state.missingUntil <= this.now() && this.ffmpeg !== "0";
    this.launch();
    return { width: this.screen.width, height: this.screen.height, ...this.opts, source: this.source };
  }

  update(raw = {}) {
    if (!this.running) throw new DesktopError("No desktop stream is running on this connection.");
    const next = assertStreamOptions(raw, this.opts);
    const changed = next.fps !== this.opts.fps || next.scale !== this.opts.scale || next.quality !== this.opts.quality;
    this.opts = next;
    // New settings mean new frame bytes: the "unchanged" comparison resets,
    // and ffmpeg is restarted with the new argv (import just reads opts).
    if (changed) {
      this.lastSent = null;
      this.latest = null;
      if (this.source === "ffmpeg") this.launch();
    }
    return { ...this.opts, source: this.source, width: this.screen.width, height: this.screen.height };
  }

  stop() {
    if (!this.running) return false;
    this.running = false;
    this.halt();
    if (this.beat) this.clearRepeat(this.beat);
    this.beat = null;
    this.latest = null;
    this.inflight.clear();
    return true;
  }

  // Ends whichever capture is running. The generation bump makes any late
  // event from it a no-op.
  halt() {
    this.gen++;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    if (this.child) {
      try {
        this.child.kill("SIGTERM");
      } catch (_) {}
      this.child = null;
    }
  }

  launch() {
    this.halt();
    if (this.useFfmpeg) this.startFfmpeg();
    else this.startImport();
  }

  fallback(why) {
    this.useFfmpeg = false;
    this.fallbackReason = why;
    this.onFallback(why);
    if (this.running) this.launch();
  }

  startFfmpeg() {
    this.source = "ffmpeg";
    const gen = this.gen;
    const env = { ...process.env, DISPLAY: this.display, XAUTHORITY: XAUTHORITY() };
    for (const k of ["AGENT_MCP_TOKEN", "AGENT_ADMIN_EMAILS", "AGENT_PREVIEW_SECRET"]) delete env[k];
    let child;
    try {
      child = this.spawnFn(this.ffmpeg, ffmpegArgs(this.opts, { display: this.display, screen: this.screen }), { env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      if (e.code === "ENOENT") this.state.missingUntil = this.now() + 600_000;
      return this.fallback(`ffmpeg could not start (${e.message})`);
    }
    this.child = child;
    const splitter = new JpegSplitter();
    let frames = 0;
    let err = "";
    child.stdout.on("data", (d) => {
      if (gen !== this.gen) return;
      for (const f of splitter.push(d)) {
        frames++;
        this.offer(f, this.now());
      }
    });
    child.stderr?.on("data", (d) => (err = (err + d).slice(-600)));
    child.on("error", (e) => {
      if (gen !== this.gen) return;
      if (e.code === "ENOENT") {
        this.state.missingUntil = this.now() + 600_000;
        return this.fallback("ffmpeg is not installed");
      }
      this.died(`ffmpeg failed: ${e.message}`);
    });
    child.on("close", (code) => {
      if (gen !== this.gen || !this.running) return;
      this.died(`ffmpeg exited (${code}) after ${frames} frame(s)${err.trim() ? `: ${err.trim().slice(0, 200)}` : ""}`);
    });
  }

  // Three deaths inside 30 s and the stream moves to import for good.
  died(why) {
    this.child = null;
    const t = this.now();
    this.failures = this.failures.filter((x) => t - x < 30_000);
    this.failures.push(t);
    this.lastError = why;
    if (this.failures.length >= 3) return this.fallback(`${why}; it exited three times`);
    this.stats.restarts++;
    const gen = ++this.gen;
    this.timer = this.setTimer(() => {
      if (gen === this.gen && this.running) this.launch();
    }, 400 * this.failures.length);
  }

  startImport() {
    this.source = "import";
    const gen = this.gen;
    if (!this.capture) return;
    const loop = async () => {
      if (gen !== this.gen || !this.running) return;
      const started = this.now();
      let ok = true;
      try {
        const s = await this.capture({ scale: this.opts.scale, quality: this.opts.quality });
        if (gen === this.gen) this.offer(s.image, started);
      } catch (e) {
        ok = false;
        this.lastError = e.message;
      }
      if (gen !== this.gen || !this.running) return;
      const period = 1000 / this.opts.fps;
      this.timer = this.setTimer(loop, ok ? Math.max(0, period - (this.now() - started)) : Math.max(1000, period));
    };
    loop();
  }

  // After the owner acts: get the result on screen NOW, past the in-flight
  // cap once. ffmpeg at a useful rate is already capturing — the next frame
  // that differs goes straight out; on import, or at a slow rate, one extra
  // capture is taken after a short settle so the click is not waited on.
  kick() {
    if (!this.running) return false;
    this.urgentUntil = this.now() + 1500;
    if ((this.source === "import" || this.opts.fps < 4) && this.capture) {
      const gen = this.gen;
      const t = this.setTimer(async () => {
        if (gen !== this.gen || !this.running) return;
        const started = this.now();
        try {
          const s = await this.capture({ scale: this.opts.scale, quality: this.opts.quality });
          if (gen === this.gen) this.offer(s.image, started, { urgent: true });
        } catch (_) {}
      }, this.kickSettleMs);
      t?.unref?.();
    }
    return true;
  }

  // Acks are cumulative: a lost ack is forgiven by the next one.
  ack(seq) {
    const n = Number(seq);
    if (!Number.isInteger(n) || n < 0) return;
    for (const s of [...this.inflight.keys()]) if (s <= n) this.inflight.delete(s);
    if (this.latest) {
      const l = this.latest;
      this.latest = null;
      this.offer(l.image, l.takenAt, { retry: true });
    }
  }

  // A viewer that never acks (a decode that failed, a backgrounded tab) must
  // not stall the stream for ever.
  expireInflight(t) {
    for (const [s, at] of [...this.inflight]) if (t - at > STREAM.ackTimeoutMs) this.inflight.delete(s);
  }

  // A captured frame arrives. → "sent" | "unchanged" | "inflight" | "buffered" | "stopped"
  offer(image, takenAt, { urgent = false, retry = false } = {}) {
    if (!this.running || !Buffer.isBuffer(image) || !image.length) return "stopped";
    if (!this.isOpen()) {
      this.stop();
      return "stopped";
    }
    if (!retry) this.stats.captured++;
    const t = this.now();
    this.expireInflight(t);
    if (this.lastSent && image.equals(this.lastSent)) {
      this.stats.unchanged++;
      return "unchanged";
    }
    if (this.buffered() > STREAM.maxBuffered) {
      this.latest = { image, takenAt };
      this.stats.skippedBuffered++;
      this.held++;
      return "buffered";
    }
    const pass = urgent || this.urgentUntil > t;
    if (this.inflight.size >= STREAM.maxInFlight) {
      // An owner action earns ONE frame past the cap, never a queue.
      if (!pass || this.inflight.size > STREAM.maxInFlight) {
        this.latest = { image, takenAt };
        this.stats.skippedInFlight++;
        this.held++;
        return "inflight";
      }
      this.urgentUntil = 0;
    }
    const size = jpegSize(image) || { width: Math.round(this.screen.width * this.opts.scale), height: Math.round(this.screen.height * this.opts.scale) };
    const seq = ++this.seq;
    // skipped: frames flow control held back since the last one sent. The
    // viewer reads it as "the link is the bottleneck" and steps its quality
    // down — an idle screen sends nothing at all, which is NOT a slow link,
    // so the arrival rate alone cannot say it.
    this.sendRaw(packFrame({ seq, takenAt, imageWidth: size.width, imageHeight: size.height, width: this.screen.width, height: this.screen.height, skipped: this.held }, image));
    this.held = 0;
    this.inflight.set(seq, t);
    this.lastSent = image;
    this.lastSentAt = t;
    this.latest = null;
    this.stats.sent++;
    return "sent";
  }

  // Once a second: flush a held-back frame if the link now has room, and say
  // "still here" when nothing has gone out for keepaliveMs.
  tick() {
    if (!this.running) return;
    if (!this.isOpen()) return void this.stop();
    const t = this.now();
    this.expireInflight(t);
    if (this.latest && this.inflight.size < STREAM.maxInFlight) {
      const l = this.latest;
      this.latest = null;
      if (this.offer(l.image, l.takenAt, { retry: true }) === "sent") return;
    }
    if (t - this.lastSentAt >= STREAM.keepaliveMs && this.buffered() <= STREAM.maxBuffered) {
      this.sendRaw(packFrame({ seq: this.seq, takenAt: t, keepalive: true, imageWidth: 0, imageHeight: 0, width: this.screen.width, height: this.screen.height }));
      this.lastSentAt = t;
      this.stats.keepalives++;
    }
  }
}
