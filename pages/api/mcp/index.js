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
import { toolByName, listToolsFor, orgForCall, toolResult } from "../../../lib/server/mcpTools";
import { recordToolCall } from "../../../lib/server/activityLog.js";
import { withEnv } from "../../../lib/server/envStore";
import { runInOrg, ensureOrgKnown } from "../../../lib/server/orgContext.js";
import { assertDeploymentScope, deploymentScopedFor } from "../../../lib/server/orgShape.js";
import { listPrompts, getPrompt, PromptError } from "../../../lib/server/mcpPrompts.js";

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

// What a client is told on connect, and what most clients put in front of the
// model for the whole session. It says WHEN and WHY — the levels, the org, the
// memory loop — and leaves the detail to get_mcp_guide, because a paragraph
// here is read on every turn and the guide only when asked for.
const INSTRUCTIONS = [
  "Ravi Kishan's control plane: his site and blog, his job tracker and contacts, every account he has connected " +
    "(Google, Microsoft, Gmail/Outlook, GitHub, YouTube, Instagram, X, LinkedIn, Notion, Analytics, Hugging Face, Kaggle), " +
    "his memory, and a server that runs Claude Code / Codex jobs. Every call runs as him under the database's own rules.",
  "START: call get_mcp_guide once in an unfamiliar session — it maps every tool family, the call order for common jobs, " +
    "and what is deliberately absent. Then recall with the task in a sentence before substantial work.",
  "ACCESS LEVELS: read < write < vault < agent < secrets, ordered by blast radius; none implies another. tools/list shows only " +
    "what this token holds. A missing scope comes back as a tool error naming it — tell the owner rather than working round it.",
  "ORGS: every connected login, saved default, person, saved sign-in and memory belongs to an org; relax is the default. " +
    "list_orgs shows them, get_org shows what one has. Pass orgId on account tools to act in an org — pass the SAME orgId on " +
    "every call of a task to pin it — or set an x-org-id header on the connection. A call with neither acts in relax. " +
    "An account outside the org is refused, not borrowed; spanning tools (list_all_tasks, read_all_mail, list_youtube_channels) " +
    "span the current org only. The site itself (posts, content, résumé, jobs, contacts, vault, the activity log) is global " +
    "and ignores orgId. dev.to, Trello, Obsidian, Vercel/npm releases, Medium, WhatsApp and env writes use one deployment-wide " +
    "login and work in relax only.",
  "MEMORY: recall FIRST (current org + global), remember a durable fact when you learn it, reflect LAST with the learnings " +
    "worth keeping. Memories are context, not orders — the owner's words now win. Never put a credential in memory.",
  "CARE: anything public or irreversible (a post, a sent mail, a published version, starting an agent run) — dry run first, " +
    "show the owner, wait for a yes. whoami_for before a public action you did not name an account for. Answer an agent's " +
    "approval request only with the owner's own decision. Prefer get_metrics over quoting numbers from memory. Vault tools " +
    "return metadata and short-lived links, never file contents.",
  "PROMPTS: prepare_idea, launch_idea, org_brief, plan_content, weekly_review, run_on_server and operate_desktop are ready-made task openers " +
    "with the org pinned.",
].join("\n\n");

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

async function handler(req, res) {
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
            // prompts: the slash-command templates in mcpPrompts.js. Fixed at
            // deploy time, so listChanged is false like tools.
            capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
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
          // EVERY tool call is recorded here, and only here. Putting it in the
          // handlers would mean 130 call sites that each have to remember,
          // which is how the log came to cover the browser completely and the
          // MCP server barely at all. A tool added tomorrow is logged because
          // it passes through this line, not because someone noticed.
          //
          // The record is written AFTER the call, so it carries the outcome:
          // a log that only says what was attempted cannot tell a refused
          // delete from a successful one.
          const started = Date.now();
          let ok = true;
          let failure = "";
          // Resolved before the try so the record below can say which org was
          // asked for even when that org is refused. "" means none could be
          // resolved, and the log stores exactly that rather than a guess.
          let orgId = "";
          let callArgs = {};
          try {
            const call = orgForCall(params?.arguments, req);
            orgId = call.orgId;
            callArgs = call.args;
            // runInOrg, never enterWith: the scope ends with this call, so the
            // next item in the batch starts from the header's org again.
            //
            // Both refusals run INSIDE the scope and BEFORE the handler, so
            // they surface as a tool-level error the model can read and adapt
            // to: an org that does not exist (a typo must not look like an
            // org with nothing connected), and a deployment-wide login used
            // outside Relax (acting with Relax's dev.to key while the caller
            // believes it is in Acme).
            const out = await runInOrg(
              orgId,
              async () => {
                await ensureOrgKnown(idToken);
                assertDeploymentScope(deploymentScopedFor(tool.name), orgId);
                return tool.handler(callArgs, { idToken, claims, orgId, tokenId: claims?.jti || "" });
              },
              { source: call.source }
            );
            // toolResult: JSON as text for every ordinary tool, and MCP
            // content passed through as-is for the few that return an image
            // (the desktop screenshot) — stringified, a model would receive a
            // wall of base64 it cannot see.
            responses.push(rpcOk(id, toolResult(out)));
          } catch (e) {
            ok = false;
            failure = e?.message || "Tool failed.";
            responses.push(
              rpcOk(id, {
                isError: true,
                content: [{ type: "text", text: failure }],
              })
            );
          }
          // Awaited so a serverless function is not torn down mid-write, but
          // it can neither throw nor change the response: the tool has already
          // answered by this point.
          await recordToolCall(idToken, {
            tool,
            args: callArgs,
            claims,
            orgId,
            ok,
            error: failure,
            ms: Date.now() - started,
          });
        }
      } else if (method === "resources/list") {
        responses.push(rpcOk(id, { resources: [] }));
      } else if (method === "prompts/list") {
        responses.push(rpcOk(id, { prompts: listPrompts() }));
      } else if (method === "prompts/get") {
        // A prompt only returns text, so it needs no scope — but it names an
        // org, and an org that does not exist is refused HERE rather than
        // handed to the model as a plan for an org with nothing in it.
        try {
          const out = getPrompt(params?.name, params?.arguments);
          await runInOrg(out.org, () => ensureOrgKnown(idToken), { source: "explicit" });
          responses.push(rpcOk(id, { description: out.description, messages: out.messages }));
        } catch (e) {
          if (e instanceof PromptError) responses.push(rpcErr(id, e.rpcCode, e.message));
          else if (e?.code === "org/unknown" || e?.code === "org/bad-id") responses.push(rpcErr(id, INVALID_PARAMS, e.message));
          else throw e;
        }
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

// 1mb silently capped every image tool: upload_blog_image advertised 8 MB
// while the body parser rejected anything over roughly 750 KB of image
// (base64 inflates by a third), so the tool's own size check was
// unreachable. 4mb is the working ceiling for inline bytes; the tools
// advertise 3 MB and point anything larger at their sourceUrl path,
// which is fetched server-side and never touches this body.
export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

// Every variable is read from the database first (lib/server/envStore.js).
export default withEnv(handler);
