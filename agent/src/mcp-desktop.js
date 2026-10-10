#!/usr/bin/env node
// The shared desktop, as an MCP server for a chat or a job.
//
// A minimal stdio MCP server like mcp-approve.js. It does NOT act itself: every
// call — the looks and the actions — goes to agentd over loopback
// (/internal/desktop), authenticated with the same per-run secret as the
// approval bridge. agentd validates, logs and gates it there (deny by
// default, deny on timeout) and only then runs xdotool. So a desktop click
// from an agent obeys the run's policy whatever this process is told.
import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";

const ENDPOINT = process.env.AGENTD_DESKTOP_URL;
const TOKEN = process.env.AGENTD_JOB_TOKEN;
const CALLER = process.env.AGENTD_JOB_ID;

const xy = { x: { type: "number", description: "Pixels from the left of the screenshot." }, y: { type: "number", description: "Pixels from the top of the screenshot." } };
const button = { button: { type: "string", enum: ["left", "right", "middle"], description: "Default left." } };

export const TOOLS = [
  { name: "screenshot", description: "A PNG of the shared desktop (1600x900). Take one before acting — coordinates are read off it — and after each action.", inputSchema: { type: "object", properties: {} } },
  { name: "list_windows", description: "The visible windows on the shared desktop, with their titles.", inputSchema: { type: "object", properties: {} } },
  { name: "click", description: "Click at (x, y). Asks the owner unless the run's policy says otherwise.", inputSchema: { type: "object", required: ["x", "y"], properties: { ...xy, ...button } } },
  { name: "double_click", description: "Double-click at (x, y).", inputSchema: { type: "object", required: ["x", "y"], properties: { ...xy, ...button } } },
  { name: "move", description: "Move the pointer to (x, y).", inputSchema: { type: "object", required: ["x", "y"], properties: xy } },
  { name: "type", description: "Type text into the focused window (no control characters; use key for Enter).", inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" } } } },
  { name: "key", description: "Press a key or combo: names joined by +, e.g. Return, Escape, ctrl+l, ctrl+shift+t.", inputSchema: { type: "object", required: ["combo"], properties: { combo: { type: "string" } } } },
  { name: "scroll", description: "Scroll up/down/left/right by 1–20 notches, optionally at (x, y).", inputSchema: { type: "object", properties: { direction: { type: "string", enum: ["up", "down", "left", "right"] }, amount: { type: "number" }, ...xy } } },
  { name: "open_url", description: "Open an http(s) address in a new tab of the desktop's browser.", inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" } } } },
  { name: "focus_window", description: "Bring a window to the front by part of its title.", inputSchema: { type: "object", required: ["window"], properties: { window: { type: "string" } } } },
];

const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

export async function callDesktop(name, args, { endpoint = ENDPOINT, token = TOKEN, caller = CALLER, fetchFn = (...a) => globalThis.fetch(...a) } = {}) {
  if (!TOOLS.some((t) => t.name === name)) return text(`Unknown desktop tool ${name}.`, true);
  if (!endpoint || !token || !caller) return text("This run is not wired to the desktop, so nothing was done.", true);
  let res;
  try {
    res = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ callerId: caller, action: { ...(args || {}), action: name } }),
    });
  } catch (e) {
    return text(`agentd could not be reached (${e.message}); nothing was done.`, true);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return text(json.error || `agentd answered ${res.status}; nothing was done.`, true);
  if (json.denied) return text(`Refused: ${json.reason || "denied"}. Nothing was done.`, true);
  if (name === "screenshot" && json.png) {
    return {
      content: [
        { type: "image", data: json.png, mimeType: "image/png" },
        { type: "text", text: `Desktop ${json.width}x${json.height}. Coordinates are pixels on this image from the top-left.` },
      ],
    };
  }
  if (name === "list_windows") return text(JSON.stringify(json.result?.windows || [], null, 2));
  return text(`Done: ${name}. Take a screenshot to see what it did.`);
}

// The server entries a chat or job puts in its MCP config. Exported so
// chat.js and runner.js build them the same way.
const here = path.dirname(fileURLToPath(import.meta.url));
export const mcpDesktopPath = () => path.join(here, "mcp-desktop.js");

export function mcpDesktopConfig({ desktopUrl = `http://127.0.0.1:${process.env.AGENT_PORT || 7777}/internal/desktop`, callerId, token }) {
  return {
    command: process.execPath,
    args: [mcpDesktopPath()],
    env: { AGENTD_DESKTOP_URL: desktopUrl, AGENTD_JOB_ID: String(callerId), AGENTD_JOB_TOKEN: String(token) },
  };
}

// Playwright's MCP attached to the desktop's OWN browser over CDP, so
// structured browsing happens where the owner can watch it. Its tools are MCP
// tools like any other and go through the permission prompt.
export function playwrightMcpConfig({ cdp = `http://127.0.0.1:${process.env.AGENT_CDP_PORT || 9222}`, pkg = process.env.AGENT_PLAYWRIGHT_MCP_PKG || "@playwright/mcp@latest" } = {}) {
  return { command: "npx", args: ["-y", pkg, "--cdp-endpoint", cdp], env: { DISPLAY: process.env.AGENT_DISPLAY || ":1", XAUTHORITY: process.env.AGENT_XAUTHORITY || process.env.XAUTHORITY || "/run/agentd-desktop/Xauthority" } };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (_) {
      return;
    }
    if (msg.method === "initialize") {
      return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "agentd-desktop", version: "1.0.0" } } });
    }
    if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
    if (msg.method === "tools/call") {
      const result = await callDesktop(msg.params?.name, msg.params?.arguments || {});
      return send({ jsonrpc: "2.0", id: msg.id, result });
    }
    if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
  });
}
