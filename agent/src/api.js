// The HTTP API the site's MCP tools call: list_agent_runs, get_agent_run,
// start_agent_run, stop_agent_run, answer_agent_approval, get_agent_status.
//
// Authenticated exactly like /whatsapp — a Firebase ID token on the bearer
// header, verified against Google's certificates and the e-mail allow-list.
// The MCP server already holds the admin's refresh token and mints one per
// call, so there is no new shared secret to store, rotate or leak.
//
// It is a second door onto the SAME operations the panel's socket uses (the
// `ops` object server.js passes in), never a parallel implementation, so a
// capability cannot exist in one and behave differently in the other.
//
// Routes are named "runs" rather than "jobs" on purpose: the site already has
// a job TRACKER (applications), and `*_job` tools would collide with it.

export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const JOB_ID = /^j_[a-z0-9]+_[0-9a-f]{6}$/;
const APPROVAL_ID = /^a_[a-z0-9]+_[0-9a-f]{6}$/;

export const assertJobId = (id) => {
  if (!JOB_ID.test(String(id || ""))) throw new ApiError(`"${String(id).slice(0, 40)}" is not a run id.`, 400);
  return id;
};
export const assertApprovalId = (id) => {
  if (!APPROVAL_ID.test(String(id || ""))) throw new ApiError(`"${String(id).slice(0, 40)}" is not an approval id.`, 400);
  return id;
};

// PURE. Which route a request is, or null. Kept apart from the handler so the
// table is testable without a socket.
export function matchRoute(method, rawUrl) {
  const url = new URL(rawUrl, "http://x");
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const q = Object.fromEntries(url.searchParams);
  let m;
  if (method === "GET" && p === "/status") return { name: "status", query: q };
  if (method === "GET" && p === "/runs") return { name: "list", query: q };
  if (method === "POST" && p === "/runs") return { name: "start", query: q };
  if (method === "GET" && (m = p.match(/^\/runs\/([^/]+)$/))) return { name: "get", id: m[1], query: q };
  if (method === "POST" && (m = p.match(/^\/runs\/([^/]+)\/stop$/))) return { name: "stop", id: m[1], query: q };
  if (method === "POST" && (m = p.match(/^\/approvals\/([^/]+)$/))) return { name: "answer", id: m[1], query: q };
  // --- chat ---
  if (method === "GET" && p === "/chats") return { name: "chatList", query: q };
  if (method === "GET" && p === "/chats/history") return { name: "chatHistory", query: q };
  if (method === "POST" && p === "/chats") return { name: "chatStart", query: q };
  if (method === "POST" && (m = p.match(/^\/chats\/([^/]+)\/messages$/))) return { name: "chatMessage", id: m[1], query: q };
  if (method === "POST" && (m = p.match(/^\/chats\/([^/]+)\/interrupt$/))) return { name: "chatInterrupt", id: m[1], query: q };
  if (method === "POST" && (m = p.match(/^\/chats\/([^/]+)\/close$/))) return { name: "chatClose", id: m[1], query: q };
  // --- /chat ---
  // --- desktop ---
  if (method === "GET" && p === "/desktop/screenshot") return { name: "desktopScreenshot", query: q };
  if (method === "POST" && p === "/desktop/action") return { name: "desktopAction", query: q };
  if (method === "GET" && p === "/previews") return { name: "previews", query: q };
  if (method === "GET" && p === "/ops") return { name: "opsList", query: q };
  // --- /desktop ---
  return null;
}

// True when the path belongs to this API, whatever the method — so a GET on
// a POST route answers 405 rather than falling through to 404.
// --- chat ---
const CHAT_PATH = /^\/chats(\/|$|\?)/;
// --- /chat ---
// --- desktop ---
// "/desktop" itself is the VNC WebSocket (workbench.js), so only its
// sub-paths are API.
const DESKTOP_PATH = /^\/(desktop\/|previews(\/|$)|ops(\/|$))/;
// --- /desktop ---
export const isApiPath = (rawUrl) => DESKTOP_PATH.test(new URL(rawUrl, "http://x").pathname) || CHAT_PATH.test(new URL(rawUrl, "http://x").pathname) || /^\/(status|runs|approvals)(\/|$|\?)/.test(new URL(rawUrl, "http://x").pathname);

async function readJson(req, { limit = 256 * 1024 } = {}) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new ApiError("That request is too large.", 413);
  }
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch (_) {
    throw new ApiError("Unreadable request.", 400);
  }
}

// `ops` is provided by server.js: { status, list, get, start, stop, answer }.
// `isUserError` says which thrown classes are refusals (400) rather than bugs.
// `workbench` (desktop, previews, ops log) is workbench.js's `api`.
export async function handleApi(req, res, { verifyToken, ops, isUserError = () => false, workbench = null }) {
  const json = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const route = matchRoute(req.method, req.url);
  if (!route) return json(405, { error: `${req.method} is not supported on ${new URL(req.url, "http://x").pathname}.` });

  try {
    await verifyToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  } catch (e) {
    return json(e.status || 401, { error: e.message });
  }

  try {
    switch (route.name) {
      case "status":
        return json(200, await ops.status());
      case "list":
        return json(200, { runs: ops.list({ live: route.query.live === "1" || route.query.live === "true", limit: Number(route.query.limit) || 50 }) });
      case "get":
        return json(200, ops.get(assertJobId(route.id), { tail: Math.min(500, Number(route.query.tail) || 100) }));
      case "start":
        return json(200, await ops.start(await readJson(req)));
      case "stop":
        return json(200, ops.stop(assertJobId(route.id)));
      case "answer": {
        const body = await readJson(req);
        return json(200, ops.answer(assertApprovalId(route.id), body));
      }
      // --- chat ---
      case "chatList":
        return json(200, ops.chatList());
      case "chatHistory":
        return json(200, ops.chatHistory(route.query));
      case "chatStart":
        return json(200, await ops.chatStart(await readJson(req)));
      case "chatMessage": {
        // A message can be long; the cap matches chat.js's MAX_MESSAGE plus JSON overhead.
        const body = await readJson(req, { limit: 512 * 1024 });
        return json(200, await ops.chatMessage(route.id, body));
      }
      case "chatInterrupt":
        return json(200, ops.chatInterrupt(route.id));
      case "chatClose":
        return json(200, ops.chatClose(route.id));
      // --- /chat ---
      // --- desktop ---
      case "desktopScreenshot": {
        if (!workbench) throw new ApiError("The desktop is not wired on this server.", 503);
        const shot = await workbench.screenshot();
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": shot.png.length, "Cache-Control": "no-store", "X-Desktop-Size": `${shot.width}x${shot.height}` });
        return res.end(shot.png);
      }
      case "desktopAction":
        if (!workbench) throw new ApiError("The desktop is not wired on this server.", 503);
        return json(200, await workbench.action(await readJson(req, { limit: 16 * 1024 })));
      case "previews":
        if (!workbench) throw new ApiError("Previews are not wired on this server.", 503);
        return json(200, await workbench.previews());
      case "opsList":
        if (!workbench) throw new ApiError("The ops log is not wired on this server.", 503);
        return json(200, workbench.ops({ since: route.query.since, actor: route.query.actor, kind: route.query.kind, limit: route.query.limit }));
      // --- /desktop ---
      default:
        return json(404, { error: "Not found." });
    }
  } catch (e) {
    // A thrown error with a status (ApiError, AuthError) or one of the
    // daemon's own refusal classes carries a sentence for a human; anything
    // else is a bug and says so rather than pretending to be advice.
    const status = e.status || (isUserError(e) ? 400 : 500);
    return json(status, { error: e.message });
  }
}
