// The workbench's desktop, terminal, previews and review timeline, wired to
// the daemon in one place so server.js only routes to it.
//
//   socket   desktop.ticket · desktop.screenshot · desktop.status · desktop.action
//            · desktop.stream.start/update/stop/ack   (frames go out as BINARY messages)
//            · term.open/input/resize/close
//            · preview.open · preview.list · ops.list         (+ broadcast ops.event)
//   upgrade  /desktop?ticket=…   (noVNC, "binary")   ·   /preview/<port>/… (app WebSockets)
//   http     /preview/<port>/…   ·   POST /internal/desktop (loopback, per-run secret)
//   api      GET /desktop/screenshot · POST /desktop/action · GET /previews · GET /ops
import { WebSocketServer } from "ws";
import { opLog, approvalRecorder } from "./oplog.js";
import { Tickets, Desktop, DesktopGate, DesktopError, DesktopStream, pipeToVnc, handleProtocols, isDesktopUpgrade, desktopCaller, tokenMatches, assertAction, describeAction, READ_ACTIONS } from "./desktop.js";
import { Previews, PreviewError, isPreviewPath } from "./preview.js";
import { Terminals, TerminalError } from "./terminal.js";
import { AuthError, assertRecentSignIn } from "./auth.js";

export const WORKBENCH_ERRORS = [DesktopError, PreviewError, TerminalError];

const LOOPBACK = new Set(["127.0.0.1", "::ffff:127.0.0.1", "::1"]);
const actorFor = (id) => (/^j_/.test(String(id)) ? `job:${id}` : /^c_/.test(String(id)) ? `chat:${id}` : "unknown");

// The site's MCP calls /desktop/action as the owner's token, from a function
// that gives up after ~20s — so an action that must ask waits at most this
// long and is then refused (and its card withdrawn), never left to land
// later. AGENT_DESKTOP_API_POLICY=yolo lets the site's MCP act unasked.
export const API_WAIT_MS = () => Math.max(1000, Math.min(18_000, Number(process.env.AGENT_DESKTOP_API_WAIT_MS || 15_000)));
export const API_POLICY = () => process.env.AGENT_DESKTOP_API_POLICY || "allowlist";

async function readBody(req, limit = 64 * 1024) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new DesktopError("That request is too large.", 413);
  }
  return body;
}

export function createWorkbench({ approvals, broadcast = () => {}, callerFor = () => null, log = opLog(), desktop = new Desktop(), previews = new Previews(), terminals = new Terminals(), tickets = new Tickets(), streamDeps = {} } = {}) {
  const recordApproval = approvalRecorder(log);
  const gate = new DesktopGate({ desktop, approvals, log: (op) => log.record(op) });
  const vncWss = new WebSocketServer({ noServer: true, handleProtocols });
  const cards = new Map();
  // One push stream per socket, and only to that socket.
  const streams = new Map();
  const newStream = (ws) =>
    new DesktopStream({
      send: (buf) => ws.readyState === 1 && ws.send(buf, { binary: true }),
      buffered: () => Number(ws.bufferedAmount) || 0,
      isOpen: () => ws.readyState === 1,
      screenSize: async () => (typeof desktop.screenSize === "function" ? desktop.screenSize() : { width: 1600, height: 900 }),
      capture: (o) => desktop.screenshot({ scale: o.scale, quality: o.quality }),
      ...streamDeps,
    });
  const stopStream = (ws) => {
    const s = streams.get(ws);
    streams.delete(ws);
    return s ? s.stop() : false;
  };

  // Every timeline entry is announced to authenticated sockets (broadcast
  // already refuses anyone else).
  log.onEvent((entry) => broadcast({ type: "ops.event", entry }));

  // A run's caller: a job (server.js knows its secret and policy) or a chat
  // (registered through desktop.registerDesktopCaller).
  const caller = (id) => callerFor(id) || desktopCaller(id);

  const wb = {
    gate,
    tickets,
    terminals,
    previews,

    onApproval(e) {
      recordApproval(e);
      if (e?.type === "approval.asked" && e.card) {
        cards.set(e.card.id, e.card);
        if (cards.size > 500) cards.delete(cards.keys().next().value);
      } else if (e?.type === "approval.answered") {
        const card = cards.get(e.id);
        cards.delete(e.id);
        if (card && e.allow === true) gate.noteApproved(card.jobId, card.tool, card.input);
      }
    },

    // What a job's model asked to run or change, from its stream. The
    // decision (if it was gated) is the approval entry beside it.
    onJobEvent(id, e) {
      if (e?.type !== "tool") return;
      const input = e.input || {};
      if (e.tool === "Bash") log.record({ actor: actorFor(id), kind: "command", summary: `$ ${String(input.command || "").slice(0, 400)}`, detail: { tool: "Bash", description: input.description } });
      else if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(e.tool)) log.record({ actor: actorFor(id), kind: "file", summary: `${e.tool} ${input.file_path || input.notebook_path || ""}`.trim(), detail: { tool: e.tool, path: input.file_path || input.notebook_path } });
    },

    streams,

    claimsUpgrade: (url) => isDesktopUpgrade(url) || isPreviewPath(url),

    handleUpgrade(req, socket, head) {
      if (isPreviewPath(req.url)) return previews.handleUpgrade(req, socket, head);
      const ticket = new URL(req.url, "http://x").searchParams.get("ticket");
      const t = tickets.redeem(ticket);
      if (!t) {
        try {
          socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        } catch (_) {}
        return socket.destroy();
      }
      vncWss.handleUpgrade(req, socket, head, (ws) => {
        log.record({ actor: "owner", kind: "desktop", summary: t.viewOnly ? "Started watching the desktop" : "Took control of the desktop", detail: { email: t.email, viewOnly: t.viewOnly } });
        pipeToVnc(ws, {
          viewOnly: t.viewOnly,
          onEnd: ({ dropped }) => {
            if (!t.viewOnly) log.record({ actor: "owner", kind: "desktop", summary: "Released control of the desktop", detail: { email: t.email } });
            else if (dropped) log.record({ actor: "owner", kind: "desktop", summary: `Dropped ${dropped} input message(s) from a view-only viewer`, detail: { email: t.email } });
          },
        });
      });
    },

    // → true when it answered the request.
    async handleHttp(req, res) {
      const p = new URL(req.url, "http://x").pathname;
      if (isPreviewPath(req.url)) {
        previews.handleHttp(req, res);
        return true;
      }
      if (p === "/internal/desktop" && req.method === "POST") {
        const json = (code, body) => {
          res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify(body));
        };
        if (!LOOPBACK.has(req.socket.remoteAddress)) {
          json(403, { error: "The desktop bridge answers on the server only." });
          return true;
        }
        let payload;
        try {
          payload = JSON.parse((await readBody(req)) || "{}");
        } catch (e) {
          json(e.status || 400, { error: e.status ? e.message : "Unreadable request." });
          return true;
        }
        const id = String(payload.callerId || "");
        const c = caller(id);
        const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        if (!c || !tokenMatches(c.token, bearer)) {
          json(403, { error: "That run cannot use the desktop." });
          return true;
        }
        try {
          const out = await gate.run({ callerId: id, actor: actorFor(id), policy: c.policy || "allowlist", action: payload.action });
          if (!out.ok) json(200, { denied: true, reason: out.reason });
          else if (out.action === "screenshot") json(200, { png: out.result.png.toString("base64"), width: out.result.width, height: out.result.height });
          else json(200, { ok: true, action: out.action, decision: out.decision, result: out.result });
        } catch (e) {
          json(e.status && e.status < 600 ? e.status : 500, { error: e.message });
        }
        return true;
      }
      return false;
    },

    // → true when the message was one of the workbench's.
    async handleSocket(ws, msg, reply) {
      switch (msg.type) {
        case "desktop.ticket": {
          const viewOnly = msg.viewOnly !== false;
          // Watching needs the ordinary sign-in; driving needs a fresh one.
          if (!viewOnly) assertRecentSignIn(ws.authed, { what: "Taking control of the desktop" });
          reply({ type: "desktop.ticket", path: "/desktop", ...tickets.mint(ws.authed, { viewOnly }) });
          return true;
        }
        case "desktop.screenshot": {
          // No options: the full PNG it always was. {scale, quality}: a JPEG
          // fitted to the viewer's pane, for the stream that stands in for
          // VNC. width/height are always the SCREEN's, so a click on the
          // image maps back to real pixels.
          const opts = {};
          for (const k of ["scale", "quality", "format"]) if (msg[k] !== undefined) opts[k] = msg[k];
          const s = await desktop.screenshot(opts);
          const img = s.image || s.png;
          const data = Buffer.isBuffer(img) ? img.toString("base64") : "";
          const format = s.format || "png";
          reply({
            type: "desktop.screenshot",
            format,
            mime: s.mime || "image/png",
            data,
            ...(format === "png" ? { png: data } : {}),
            width: s.width,
            height: s.height,
            imageWidth: s.imageWidth || s.width,
            imageHeight: s.imageHeight || s.height,
            scale: s.scale || 1,
            takenAt: Date.now(),
          });
          return true;
        }
        case "desktop.stream.start": {
          // Watching needs the ordinary sign-in (the socket is authed); a
          // second start on one socket replaces the first.
          stopStream(ws);
          const s = newStream(ws);
          streams.set(ws, s);
          let started;
          try {
            started = await s.start(msg);
          } catch (e) {
            if (streams.get(ws) === s) stopStream(ws);
            throw e;
          }
          // The socket may have closed while the screen size was asked for.
          if (ws.readyState !== 1 || streams.get(ws) !== s) {
            s.stop();
            return true;
          }
          reply({ type: "desktop.stream.started", ...started, at: Date.now() });
          return true;
        }
        case "desktop.stream.update": {
          const s = streams.get(ws);
          if (!s) throw new DesktopError("No desktop stream is running on this connection. Send desktop.stream.start first.");
          reply({ type: "desktop.stream.updated", ...s.update(msg), at: Date.now() });
          return true;
        }
        case "desktop.stream.stop":
          reply({ type: "desktop.stream.stopped", stopped: stopStream(ws) });
          return true;
        case "desktop.stream.ack":
          streams.get(ws)?.ack(msg.seq);
          return true;
        case "desktop.status":
          reply({ type: "desktop.status", ...(await desktop.status()), at: Date.now() });
          return true;
        case "desktop.action": {
          // The OWNER driving, one discrete action at a time — the stream's
          // answer to "Take control" when there is no VNC. It drives the
          // machine, so it needs the same fresh sign-in an interactive VNC
          // ticket does, and it is validated by the same assertAction the
          // agents' bridge and the site's MCP use.
          assertRecentSignIn(ws.authed, { what: "Driving the desktop" });
          const { type: _type, ...body } = msg;
          const a = assertAction(body);
          if (READ_ACTIONS.has(a.action)) throw new DesktopError(`${a.action} only looks; use desktop.screenshot instead.`);
          const detail = { ...a, email: ws.authed?.email };
          let result;
          try {
            result = await desktop.act(a);
          } catch (e) {
            log.record({ actor: "owner", kind: "desktop", summary: `${describeAction(a)} (failed)`, detail: { ...detail, error: e.message } });
            throw e;
          }
          const at = Date.now();
          log.record({ actor: "owner", kind: "desktop", summary: describeAction(a), detail });
          // The result on screen now, not at the next tick — every viewer.
          for (const st of streams.values()) st.kick();
          reply({ type: "desktop.acted", action: a.action, at, ...(result && Object.keys(result).length ? { result } : {}) });
          return true;
        }
        case "term.open":
          reply({ type: "term.opened", ...(await terminals.open(ws, msg)) });
          return true;
        case "term.input":
          terminals.input(ws, msg.termId, msg.data);
          return true;
        case "term.resize":
          reply({ type: "term.resized", termId: msg.termId, ...terminals.resize(ws, msg.termId, msg.cols, msg.rows) });
          return true;
        case "term.close":
          terminals.close(ws, msg.termId);
          reply({ type: "term.closed", termId: msg.termId });
          return true;
        case "preview.open":
          reply({ type: "preview.opened", ...previews.open(msg.port, { actor: "owner" }) });
          return true;
        case "preview.list":
          reply({ type: "previews", previews: await previews.list() });
          return true;
        case "ops.list":
          reply({ type: "ops", ops: log.list({ since: msg.since, actor: msg.actor, kind: msg.kind, limit: msg.limit }) });
          return true;
        default:
          return false;
      }
    },

    onSocketClose(ws) {
      terminals.closeAll(ws);
      stopStream(ws);
    },

    // For agent/src/api.js — the site's MCP tools.
    api: {
      async screenshot() {
        return desktop.screenshot();
      },
      async action(body) {
        const out = await gate.run({ callerId: "mcp", actor: "mcp", policy: API_POLICY(), action: body, waitMs: API_WAIT_MS() });
        if (!out.ok) throw new DesktopError(`Refused: ${out.reason}`, 403);
        const result = out.action === "screenshot" ? { width: out.result.width, height: out.result.height, note: "Use get_desktop_screenshot for the image." } : out.result;
        return { ok: true, action: out.action, decision: out.decision, result };
      },
      async previews() {
        return { previews: await previews.list() };
      },
      ops(query = {}) {
        const ops = log.list(query);
        return { ops, count: ops.length };
      },
    },
  };
  return wb;
}

export const isWorkbenchError = (e) => e instanceof AuthError || WORKBENCH_ERRORS.some((C) => e instanceof C);
