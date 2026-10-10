// The public System Monitor's live feed: aggregate numbers from the agent
// server, re-shaped here through the SAME allow-list agentd uses
// (agent/src/statsShape.js) — whatever comes back over the wire is never passed
// through, so a compromised or buggy agent still cannot put a string in front
// of a visitor.
//
// The agent's address lives only in this server-side route (AGENT_URL); it is
// never in a response and never in a browser bundle. A failure answers
// `{online:false, reason}` with a reason from a fixed list — never an error
// message, which could carry the address.
import { withEnv } from "../../lib/server/envStore";
import { shapeStats } from "../../agent/src/statsShape.js";

const TIMEOUT_MS = 3000;
const FRESH_MS = 2000; // per-instance reuse: the agent rate-limits per address
const STALE_OK_MS = 30_000; // on a 429, a recent good answer beats "offline"

const agentBase = () => (process.env.AGENT_URL || "https://agent.ravikishan.me").replace(/\/+$/, "");

let last = { at: 0, body: null };

async function fetchStats() {
  let res;
  try {
    res = await fetch(`${agentBase()}/public/stats`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { error: e && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "unreachable" };
  }
  if (res.status === 429) return { error: "rate-limited" };
  if (!res.ok) return { error: "upstream-error" };
  let json;
  try {
    json = await res.json();
  } catch {
    return { error: "bad-response" };
  }
  if (!json || typeof json !== "object" || json.v !== 1) return { error: "bad-response" };
  return { body: { online: true, ...shapeStats(json) } };
}

async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.setHeader("Cache-Control", "no-store");
    return res.status(405).json({ online: false, reason: "method" });
  }
  const now = Date.now();
  if (last.body && now - last.at < FRESH_MS) {
    res.setHeader("Cache-Control", "public, s-maxage=2, stale-while-revalidate=30");
    return res.status(200).json(last.body);
  }
  const out = await fetchStats();
  if (out.body) {
    last = { at: Date.now(), body: out.body };
    res.setHeader("Cache-Control", "public, s-maxage=2, stale-while-revalidate=30");
    return res.status(200).json(out.body);
  }
  if (out.error === "rate-limited" && last.body && now - last.at < STALE_OK_MS) {
    res.setHeader("Cache-Control", "public, s-maxage=2, stale-while-revalidate=30");
    return res.status(200).json(last.body);
  }
  res.setHeader("Cache-Control", "public, s-maxage=10");
  return res.status(200).json({ online: false, reason: out.error });
}

export default withEnv(handler);
