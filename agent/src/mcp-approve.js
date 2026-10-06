#!/usr/bin/env node
// The bridge that turns a permission prompt into a notification on your phone.
//
// Claude Code's `--permission-prompt-tool <name>` says: when you would prompt a
// human, call this MCP tool instead and do what it says. So this is a minimal
// stdio MCP server exposing exactly one tool, which forwards the question to
// agentd over loopback and blocks on the answer.
//
// It is a separate process on purpose. It runs inside the job's sandbox with
// the job's environment, and it holds ONE secret scoped to ONE job — so a
// compromised runner cannot answer approvals for anything else.
//
// The contract Claude Code expects from the tool's result is a JSON payload
// with `behavior: "allow" | "deny"`. Anything else is treated as a denial,
// which is the right default and is why every failure path below denies.
import readline from "readline";

const ENDPOINT = process.env.AGENTD_APPROVE_URL;
const TOKEN = process.env.AGENTD_JOB_TOKEN;
const JOB = process.env.AGENTD_JOB_ID;

const TOOL = {
  name: "approve",
  description:
    "Ask the operator whether a tool call may proceed. Called automatically by Claude Code's permission system; never call it directly.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string" },
      input: { type: "object" },
      tool_use_id: { type: "string" },
    },
    required: ["tool_name"],
  },
};

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

const reply = (id, result) => send({ jsonrpc: "2.0", id, result });

// Every refusal path produces the same shape, so a failure to reach agentd
// reads to Claude Code as a plain denial rather than a protocol error.
const deny = (reason) => ({
  content: [{ type: "text", text: JSON.stringify({ behavior: "deny", message: reason }) }],
});

const allow = (updatedInput) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({ behavior: "allow", updatedInput: updatedInput ?? undefined }),
    },
  ],
});

async function askOperator(args) {
  if (!ENDPOINT || !TOKEN || !JOB) {
    return deny("This runner is not wired to an approval endpoint, so nothing can be approved.");
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        jobId: JOB,
        tool: args.tool_name,
        input: args.input || {},
        toolUseId: args.tool_use_id || "",
        cwd: process.cwd(),
      }),
    });
    if (!res.ok) {
      return deny(`The approval service answered ${res.status}, so this was refused.`);
    }
    const json = await res.json();
    // Only an explicit true allows — same rule as the server, restated here so
    // a change on one side cannot quietly loosen the other.
    return json?.allow === true ? allow(json.updatedInput) : deny(json?.reason || "Denied.");
  } catch (e) {
    // A network failure must never read as approval.
    return deny(`The approval service could not be reached (${e.message}), so this was refused.`);
  }
}

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (_) {
    return;
  }

  if (msg.method === "initialize") {
    return reply(msg.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "agentd-approvals", version: "1.0.0" },
    });
  }
  if (msg.method === "tools/list") return reply(msg.id, { tools: [TOOL] });
  if (msg.method === "tools/call") {
    const result = await askOperator(msg.params?.arguments || {});
    return reply(msg.id, result);
  }
  // Notifications (no id) need no reply.
  if (msg.id !== undefined) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
  }
});
