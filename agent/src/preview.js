// Previews: a dev server an agent started on this box (next dev on :3000),
// opened in the admin without opening a port.
//
//   GET /preview/<port>/<path>   → http://127.0.0.1:<port>/<path>   (+ WebSocket upgrades)
//
// An iframe cannot send a bearer header, so access is a COOKIE: preview.open
// over the authenticated socket returns a URL carrying a 2-minute, single-use
// open token; the first request trades it for an HttpOnly cookie scoped to
// /preview/<port>/ and redirects to the clean URL. Both are HMAC-signed under
// a secret held only by this process (random per start unless
// AGENT_PREVIEW_SECRET is set), so a restart signs everyone out of previews.
//
// Ports: 1024–65535, never agentd's own, VNC's or the browser's CDP — the
// three things on loopback that would turn a preview into a back door.
//
// Known limit: an app that requests ABSOLUTE paths (/_next/…) escapes the
// /preview/<port>/ prefix and 404s here; run such apps with a base path
// (next dev with basePath "/preview/3000", vite --base /preview/5173/).
import http from "http";
import net from "net";
import crypto from "crypto";
import fs from "fs";
import { spawn } from "child_process";
import { record as recordOp } from "./oplog.js";

export class PreviewError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// The defaults are reserved whatever the environment says, as well as any
// port the environment moved them to.
export const reservedPorts = () =>
  new Set([7777, 5901, 9222, Number(process.env.AGENT_PORT || 7777), Number(process.env.AGENT_VNC_PORT || 5901), Number(process.env.AGENT_CDP_PORT || 9222)]);

export function assertPreviewPort(p, { reserved = reservedPorts() } = {}) {
  const s = String(p ?? "");
  const n = Number(s);
  if (!/^\d{1,5}$/.test(s) || !Number.isInteger(n) || n < 1024 || n > 65535) {
    throw new PreviewError(`"${s.slice(0, 10)}" is not a preview port. Use 1024–65535.`);
  }
  if (reserved.has(n)) throw new PreviewError(`Port ${n} belongs to agentd itself (the daemon, VNC or the browser's debugger) and is never previewed.`, 403);
  return n;
}

/* ---------------- tokens ---------------- */

export const OPEN_TTL_MS = 2 * 60_000;
export const SESSION_TTL_MS = 60 * 60_000;

export class PreviewSigner {
  constructor({ secret = process.env.AGENT_PREVIEW_SECRET || crypto.randomBytes(32).toString("hex"), now = () => Date.now() } = {}) {
    this.secret = String(secret);
    this.now = now;
    this.used = new Map(); // open-token nonces already spent → their expiry
  }

  mac(body) {
    return crypto.createHmac("sha256", this.secret).update(body).digest("base64url");
  }

  sign({ port, kind, ttlMs }) {
    const payload = { p: port, k: kind, e: this.now() + ttlMs, n: crypto.randomBytes(9).toString("base64url") };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return { token: `${body}.${this.mac(body)}`, expiresAt: payload.e };
  }

  // → payload or null. A token is only valid for the port it names (the
  // scope) and for its own kind: a cookie is not an open token.
  verify(token, { port, kind }) {
    const [body, sig, extra] = String(token || "").split(".");
    if (!body || !sig || extra !== undefined) return null;
    const want = this.mac(body);
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    let p;
    try {
      p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch (_) {
      return null;
    }
    if (!p || p.p !== port || p.k !== kind || !(p.e > this.now())) return null;
    return p;
  }

  // Open tokens are single-use: the URL lands in browser history.
  spend(payload) {
    const t = this.now();
    for (const [n, e] of this.used) if (e <= t) this.used.delete(n);
    if (this.used.has(payload.n)) return false;
    this.used.set(payload.n, payload.e);
    return true;
  }
}

/* ---------------- pure helpers ---------------- */

export const OPEN_PARAM = "agentd_preview";
export const cookieName = (port) => `agentd_pv_${port}`;

// PURE. "/preview/3000/a/b?x=1" → { port: "3000", rest: "/a/b?x=1" }.
// "/preview/3000" → { port: "3000", rest: "", bare: true } (redirected to the
// slash form so relative links resolve under the prefix).
export function parsePreviewPath(rawUrl) {
  const m = /^\/preview\/([^/?#]+)(\/[^#]*|\?[^#]*)?$/.exec(String(rawUrl || ""));
  if (!m) return null;
  const tail = m[2] || "";
  if (!tail || tail.startsWith("?")) return { port: m[1], rest: tail, bare: true };
  return { port: m[1], rest: tail };
}

export const isPreviewPath = (rawUrl) => /^\/preview(\/|$|\?)/.test(String(rawUrl || ""));

export function setCookieHeader(port, value, maxAgeSec) {
  return `${cookieName(port)}=${value}; Path=/preview/${port}/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=None`;
}

export function readCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

// PURE. The Cookie header the app sees: every agentd preview cookie removed,
// so an app cannot read (and log, and leak) the credential that admitted it.
export function stripPreviewCookies(header) {
  const kept = String(header || "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !/^agentd_pv_\d+=/.test(s));
  return kept.join("; ");
}

export const HOP_BY_HOP = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "trailers", "transfer-encoding", "upgrade", "proxy-connection"];

// PURE. Request headers for the upstream. Hop-by-hop headers — the fixed list
// AND anything the Connection header names — are removed (except for a
// WebSocket upgrade, which needs Upgrade/Connection to be one).
export function forwardRequestHeaders(headers = {}, { port, upgrade = false } = {}) {
  const named = String(headers.connection || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.includes(key) || named.includes(key)) continue;
    if (key === "cookie" || key === "authorization") continue;
    out[key] = v;
  }
  const cookie = stripPreviewCookies(headers.cookie);
  if (cookie) out.cookie = cookie;
  out.host = `127.0.0.1:${port}`;
  out["x-forwarded-prefix"] = `/preview/${port}`;
  out["x-forwarded-proto"] = "https";
  if (upgrade) {
    out.connection = "Upgrade";
    out.upgrade = headers.upgrade || "websocket";
  }
  return out;
}

// PURE. A redirect from the app stays inside the preview.
export function rewriteLocation(loc, port) {
  const s = String(loc || "");
  const m = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):(\d+)(\/.*)?$/i.exec(s);
  if (m) return m[2] === String(port) ? `/preview/${port}${m[3] || "/"}` : s;
  if (s.startsWith("/") && !s.startsWith("//") && !s.startsWith(`/preview/${port}/`)) return `/preview/${port}${s}`;
  return s;
}

// PURE. Response headers back to the browser: hop-by-hop dropped, Location
// kept inside the prefix, and an app's cookie scoped to its own preview path
// rather than to the whole agentd origin.
export function forwardResponseHeaders(headers = {}, { port } = {}) {
  const named = String(headers.connection || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.includes(key) || named.includes(key)) continue;
    if (key === "location") out[key] = rewriteLocation(v, port);
    else if (key === "set-cookie") {
      out[key] = (Array.isArray(v) ? v : [v])
        .filter((c) => !/^\s*agentd_pv_/.test(c))
        .map((c) => (/;\s*path=/i.test(c) ? c.replace(/(;\s*path=)\/?([^;]*)/i, (_m, p, rest) => `${p}/preview/${port}/${rest.replace(/^\/+/, "")}`) : `${c}; Path=/preview/${port}/`));
    } else out[key] = v;
  }
  return out;
}

// PURE. `ss -tlnpH` lines → listening ports this user owns. Without root, ss
// prints users:(("name",pid=…)) only for this user's own sockets — that is
// the first filter; `procUid` (pid → uid) is the second, checked when given.
const LOOPBACK_OR_ANY = /^(\*|0\.0\.0\.0|127\.\d+\.\d+\.\d+|\[::\]|::|\[::1\]|\[::ffff:127\.0\.0\.1\])(%\w+)?$/;
export function parseSs(text, { reserved = reservedPorts(), uid = null, procUid = null } = {}) {
  const byPort = new Map();
  for (const line of String(text || "").split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0] !== "LISTEN") continue;
    const local = cols[3];
    const i = local.lastIndexOf(":");
    if (i < 0) continue;
    const address = local.slice(0, i);
    const port = Number(local.slice(i + 1));
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || reserved.has(port)) continue;
    if (!LOOPBACK_OR_ANY.test(address)) continue;
    const users = /users:\(\("([^"]{0,64})",pid=(\d+)/.exec(line);
    if (!users) continue;
    const pid = Number(users[2]);
    if (uid != null && procUid && procUid(pid) !== uid) continue;
    if (!byPort.has(port)) byPort.set(port, { port, address, process: users[1], pid });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

// PURE. Which run started it, read off the process's working directory.
export function startedByFromCwd(cwd) {
  const s = String(cwd || "");
  let m;
  if ((m = /\/work\/chats\/([A-Za-z0-9_-]{1,80})(\/|$)/.exec(s))) return `chat:${m[1]}`;
  if ((m = /\/work\/(j_[a-z0-9]+_[0-9a-f]{6})(\/|$)/.exec(s))) return `job:${m[1]}`;
  return null;
}

/* ---------------- loopback connection ---------------- */

// 127.0.0.1 first, then ::1 — Vite and friends bind "localhost", which is
// ::1 on some boxes. Loopback either way.
export function connectLoopback(port, cb, { connect = net.connect } = {}) {
  let done = false;
  const attempt = (host, next) => {
    const s = connect({ host, port });
    const onErr = (e) => {
      s.removeListener("connect", onOk);
      if (next && (e.code === "ECONNREFUSED" || e.code === "EADDRNOTAVAIL")) return attempt(next, null);
      if (!done) {
        done = true;
        cb(e);
      }
    };
    const onOk = () => {
      s.removeListener("error", onErr);
      if (!done) {
        done = true;
        cb(null, s);
      }
    };
    s.once("error", onErr);
    s.once("connect", onOk);
  };
  attempt("127.0.0.1", "::1");
}

/* ---------------- the proxy ---------------- */

const page = (res, code, title, text) => {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  res.end(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:15px system-ui;padding:2rem;background:#0f1117;color:#e6e6e6"><h1 style="font-size:18px;color:#FFB020">${esc(title)}</h1><p>${esc(text)}</p>`);
};

export class Previews {
  constructor({ signer = new PreviewSigner(), publicBase = process.env.AGENT_PUBLIC_URL || "https://agent.ravikishan.me", log = recordOp, run = null, uid = typeof process.getuid === "function" ? process.getuid() : null } = {}) {
    this.signer = signer;
    this.publicBase = publicBase.replace(/\/+$/, "");
    this.log = log;
    this.run = run || ((cmd, args) => runText(cmd, args));
    this.uid = uid;
  }

  // preview.open {port} → { port, url, path, expiresAt }
  open(port, { actor = "owner" } = {}) {
    const p = assertPreviewPort(port);
    const { token } = this.signer.sign({ port: p, kind: "open", ttlMs: OPEN_TTL_MS });
    const path = `/preview/${p}/?${OPEN_PARAM}=${token}`;
    this.log({ actor, kind: "preview", summary: `Opened the preview of port ${p}`, detail: { port: p } });
    return { port: p, path, url: `${this.publicBase}${path}`, expiresAt: this.signer.now() + SESSION_TTL_MS };
  }

  async list() {
    let text = "";
    try {
      text = await this.run("ss", ["-tlnpH"]);
    } catch (e) {
      throw new PreviewError(`Could not list listening ports (${e.message}).`, 503);
    }
    const procUid = (pid) => {
      try {
        return fs.statSync(`/proc/${pid}`).uid;
      } catch (_) {
        return -1;
      }
    };
    const rows = parseSs(text, { uid: this.uid, procUid: this.uid == null ? null : procUid });
    return rows.map((r) => {
      let cwd = "";
      try {
        cwd = fs.readlinkSync(`/proc/${r.pid}/cwd`);
      } catch (_) {}
      return { ...r, startedBy: startedByFromCwd(cwd), path: `/preview/${r.port}/`, how: "Open it from the admin's Workbench → Previews (preview.open mints the cookie)." };
    });
  }

  // Authenticates a /preview request. → { port, rest } or a handled response.
  admit(req, res) {
    const parsed = parsePreviewPath(req.url);
    if (!parsed) {
      page(res, 404, "Not a preview", "Previews live at /preview/<port>/.");
      return null;
    }
    let port;
    try {
      port = assertPreviewPort(parsed.port);
    } catch (e) {
      page(res, e.status || 400, "Not a preview port", e.message);
      return null;
    }
    const u = new URL(parsed.rest || "/", "http://x");
    const openToken = u.searchParams.get(OPEN_PARAM);
    if (openToken) {
      const p = this.signer.verify(openToken, { port, kind: "open" });
      if (!p || !this.signer.spend(p)) {
        page(res, 401, "This preview link has expired", "Open the preview again from the admin — each link works once, for two minutes.");
        return null;
      }
      const { token, expiresAt } = this.signer.sign({ port, kind: "session", ttlMs: SESSION_TTL_MS });
      u.searchParams.delete(OPEN_PARAM);
      const clean = `/preview/${port}${u.pathname}${u.search}`;
      res.writeHead(302, { Location: clean, "Set-Cookie": setCookieHeader(port, token, Math.floor((expiresAt - this.signer.now()) / 1000)), "Cache-Control": "no-store" });
      res.end();
      return null;
    }
    if (!this.signer.verify(readCookie(req.headers.cookie, cookieName(port)), { port, kind: "session" })) {
      page(res, 401, "Open this preview from the admin", "Previews on the agent server need a short-lived pass that the admin's Workbench hands out. This one is missing or has expired.");
      return null;
    }
    if (parsed.bare) {
      res.writeHead(301, { Location: `/preview/${port}/${parsed.rest}` });
      res.end();
      return null;
    }
    return { port, rest: parsed.rest };
  }

  handleHttp(req, res) {
    const ok = this.admit(req, res);
    if (!ok) return;
    const { port, rest } = ok;
    const upstream = http.request(
      {
        method: req.method,
        path: rest,
        headers: forwardRequestHeaders(req.headers, { port }),
        createConnection: (_opts, cb) => {
          connectLoopback(port, cb);
        },
      },
      (up) => {
        res.writeHead(up.statusCode || 502, forwardResponseHeaders(up.headers, { port }));
        up.pipe(res);
      }
    );
    upstream.on("error", (e) => {
      if (res.headersSent) return res.destroy();
      page(res, 502, `Nothing is answering on port ${port}`, `The app may have stopped (${e.code || e.message}). Start it again and reload.`);
    });
    req.pipe(upstream);
  }

  // A WebSocket upgrade under /preview/<port>/ (hot reload). Raw tunnel once
  // the cookie checks out.
  handleUpgrade(req, socket, head) {
    const parsed = parsePreviewPath(req.url);
    const deny = (code, text) => {
      try {
        socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      } catch (_) {}
      socket.destroy();
    };
    if (!parsed || parsed.bare) return deny(404, "Not Found");
    let port;
    try {
      port = assertPreviewPort(parsed.port);
    } catch (_) {
      return deny(403, "Forbidden");
    }
    if (!this.signer.verify(readCookie(req.headers.cookie, cookieName(port)), { port, kind: "session" })) return deny(401, "Unauthorized");
    connectLoopback(port, (err, up) => {
      if (err) return deny(502, "Bad Gateway");
      const headers = forwardRequestHeaders(req.headers, { port, upgrade: true });
      const lines = [`${req.method} ${parsed.rest} HTTP/1.1`, ...Object.entries(headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)];
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket).pipe(up);
      const kill = () => {
        up.destroy();
        socket.destroy();
      };
      up.on("error", kill);
      socket.on("error", kill);
      up.on("close", () => socket.destroy());
      socket.on("close", () => up.destroy());
    });
  }
}

function runText(cmd, args, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(t);
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}`));
    });
  });
}
