// Remote MCP server — Streamable HTTP transport (the 2025-03-26 replacement
// for HTTP+SSE): one endpoint, JSON-RPC 2.0 over POST.
//
// Connect from any MCP client that can send a bearer token, e.g.
//   claude mcp add --transport http rk https://www.ravikishan.me/api/mcp \
//     --header "Authorization: Bearer rkmcp_…"
//
// AUTH. Every request must carry `Authorization: Bearer <token>` where the
// token was minted in the admin (see /api/mcp/token). An unauthenticated
// request gets 401 with a WWW-Authenticate header pointing at the RFC 9728
// protected-resource metadata, which is what spec-compliant clients use to
// discover how to authenticate.
//
// The token decrypts to the admin's Firebase refresh token, so every Firestore
// operation runs under the real security rules rather than a service account.
import { verifyToken, hasScope, isMcpConfigured } from "../../../lib/server/mcpToken";
import { idTokenFor, isRevoked } from "../../../lib/server/firestoreRest";
import { toolByName, listToolsFor } from "../../../lib/server/mcpTools";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "ravikishan-identity", version: "1.0.0" };

// http on localhost, https everywhere else — behind Vercel the original
// scheme arrives in x-forwarded-proto.
const baseUrl = (req) => {
  const host = req.headers.host || "";
  const proto =
    req.headers["x-forwarded-proto"] ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
};

const rpcOk = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message, data) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, ...(data ? { data } : {}) },
});

// JSON-RPC reserved codes
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function unauthorized(req, res, message) {
  const base = baseUrl(req);
  res
    .status(401)
    .setHeader(
      "WWW-Authenticate",
      `Bearer realm="ravikishan-mcp", resource_metadata="${base}/.well-known/oauth-protected-resource"`
    );
  return res.json({ error: "unauthorized", message });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // A GET on the endpoint would be the SSE upgrade. This server never pushes
  // server-initiated messages, so it declines rather than holding a stream open.
  if (req.method === "GET") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ error: "This MCP endpoint is POST-only (no server-initiated stream)." });
  }
  // Session teardown — nothing is held server-side, so this always succeeds.
  if (req.method === "DELETE") return res.status(204).end();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!isMcpConfigured())
    return res.status(503).json({ error: "MCP is not configured on this deployment (MCP_TOKEN_SECRET)." });

  /* ---- authenticate ---- */
  const header = req.headers.authorization || "";
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw) return unauthorized(req, res, "Missing bearer token.");

  let claims;
  try {
    claims = verifyToken(raw);
  } catch (e) {
    return unauthorized(req, res, e.message);
  }
  if (await isRevoked(claims.jti))
    return unauthorized(req, res, "This token has been revoked.");

  let idToken;
  try {
    idToken = await idTokenFor(claims.rt);
  } catch (e) {
    return unauthorized(req, res, e.message);
  }

  /* ---- dispatch ---- */
  const body = req.body;
  const batch = Array.isArray(body) ? body : [body];
  const responses = [];

  for (const msg of batch) {
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      responses.push(rpcErr(msg?.id ?? null, INVALID_REQUEST, "Invalid JSON-RPC request."));
      continue;
    }
    const { id, method, params } = msg;
    // Notifications (no id) expect no response.
    const isNotification = id === undefined || id === null;

    try {
      if (method === "initialize") {
        responses.push(
          rpcOk(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions:
              "Ravi Kishan's personal identity control plane. Read and update the canonical profile, " +
              "résumé metadata, job applications, blog posts, short links, and private document " +
              "metadata. Prefer get_metrics over quoting follower or download numbers from memory. " +
              "Vault tools return metadata and short-lived links only, never file contents.",
          })
        );
      } else if (method === "notifications/initialized" || method?.startsWith("notifications/")) {
        // nothing to do; notifications get no reply
      } else if (method === "ping") {
        if (!isNotification) responses.push(rpcOk(id, {}));
      } else if (method === "tools/list") {
        responses.push(rpcOk(id, { tools: listToolsFor(claims.scopes || []) }));
      } else if (method === "tools/call") {
        const name = params?.name;
        const tool = toolByName(name);
        if (!tool) {
          responses.push(rpcErr(id, INVALID_PARAMS, `No such tool: ${name}`));
        } else if (!hasScope(claims, tool.scope)) {
          // A scope failure is a tool-level error, not a protocol error: the
          // model should see it and adapt rather than the connection breaking.
          responses.push(
            rpcOk(id, {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `This token does not carry the "${tool.scope}" scope required by ${name}. Mint a new token in the admin with that scope.`,
                },
              ],
            })
          );
        } else {
          try {
            const out = await tool.handler(params?.arguments || {}, { idToken, claims });
            responses.push(
              rpcOk(id, {
                content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
                structuredContent: out && typeof out === "object" && !Array.isArray(out) ? out : undefined,
              })
            );
          } catch (e) {
            responses.push(
              rpcOk(id, {
                isError: true,
                content: [{ type: "text", text: e?.message || "Tool failed." }],
              })
            );
          }
        }
      } else if (method === "resources/list") {
        responses.push(rpcOk(id, { resources: [] }));
      } else if (method === "prompts/list") {
        responses.push(rpcOk(id, { prompts: [] }));
      } else {
        if (!isNotification) responses.push(rpcErr(id, METHOD_NOT_FOUND, `Unknown method: ${method}`));
      }
    } catch (e) {
      if (!isNotification) responses.push(rpcErr(id, INTERNAL_ERROR, e?.message || "Internal error."));
    }
  }

  // A batch of nothing but notifications gets 202 with no body, per spec.
  if (!responses.length) return res.status(202).end();
  return res.status(200).json(Array.isArray(body) ? responses : responses[0]);
}

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };
