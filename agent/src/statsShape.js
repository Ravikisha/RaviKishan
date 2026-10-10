// The ONE allow-list for the public server monitor, shared by agentd (which
// serves it) and the site's /api/server-stats (which re-shapes whatever it
// receives through the same function before a browser ever sees it).
//
// PURE — no node imports — so Next's webpack and plain node load the same file.
//
// The response is built field by field from known keys. Nothing is ever spread
// from an internal object, and every leaf is a finite number except
// `agent.desktop`, which is one of three fixed words. That is the property the
// tests pin: there is no field a hostname, path, address, user name, job title
// or process argument could ride out in, because there is no free-text field.

export const STATS_VERSION = 1;
export const HISTORY = 90; // samples kept and served (90 × 2s = 3 minutes)
export const MAX_CORES = 128;
export const PROC_KINDS = ["claude", "codex", "chromium", "node", "other"];
export const DESKTOP_STATES = ["up", "down", "unknown"];

const num = (v, { min = 0, max = Number.MAX_SAFE_INTEGER, dp = 1 } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dp;
  return Math.round(Math.min(max, Math.max(min, n)) * f) / f;
};
const pct = (v) => num(v, { max: 100, dp: 1 });
const int = (v, max) => num(v, { max, dp: 0 });
const series = (a, fn) => (Array.isArray(a) ? a.slice(-HISTORY).map(fn) : []);

// Every key the public response may carry, as a nested shape. The tests walk a
// shaped response against this and fail on anything extra.
export const STATS_SCHEMA = {
  v: "n",
  at: "n",
  intervalMs: "n",
  uptimeS: "n",
  load: ["n"],
  cpu: { total: "n", cores: ["n"], history: ["n"] },
  mem: { totalGb: "n", usedGb: "n", usedPct: "n", history: ["n"] },
  swap: { totalGb: "n", usedGb: "n", usedPct: "n" },
  disk: { totalGb: "n", usedGb: "n", usedPct: "n" },
  net: { rxBps: "n", txBps: "n", rxHistory: ["n"], txHistory: ["n"] },
  procs: { total: "n", claude: "n", codex: "n", chromium: "n", node: "n", other: "n" },
  agent: { running: "n", waiting: "n", queued: "n", chats: "n", desktop: "s" },
};

export function shapeStats(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const cpu = r.cpu || {};
  const mem = r.mem || {};
  const swap = r.swap || {};
  const disk = r.disk || {};
  const net = r.net || {};
  const procs = r.procs || {};
  const agent = r.agent || {};
  const gb = (v) => num(v, { max: 1e6, dp: 2 });
  const bps = (v) => num(v, { max: 1e12, dp: 0 });
  const load = Array.isArray(r.load) ? r.load.slice(0, 3).map((v) => num(v, { max: 1e4, dp: 2 })) : [];
  return {
    v: STATS_VERSION,
    at: int(r.at, 8.64e15),
    intervalMs: int(r.intervalMs, 3600_000),
    uptimeS: int(r.uptimeS, 1e10),
    load,
    cpu: {
      total: pct(cpu.total),
      cores: Array.isArray(cpu.cores) ? cpu.cores.slice(0, MAX_CORES).map(pct) : [],
      history: series(cpu.history, pct),
    },
    mem: { totalGb: gb(mem.totalGb), usedGb: gb(mem.usedGb), usedPct: pct(mem.usedPct), history: series(mem.history, pct) },
    swap: { totalGb: gb(swap.totalGb), usedGb: gb(swap.usedGb), usedPct: pct(swap.usedPct) },
    disk: { totalGb: gb(disk.totalGb), usedGb: gb(disk.usedGb), usedPct: pct(disk.usedPct) },
    net: {
      rxBps: bps(net.rxBps),
      txBps: bps(net.txBps),
      rxHistory: series(net.rxHistory, bps),
      txHistory: series(net.txHistory, bps),
    },
    procs: {
      total: int(procs.total, 1e7),
      claude: int(procs.claude, 1e7),
      codex: int(procs.codex, 1e7),
      chromium: int(procs.chromium, 1e7),
      node: int(procs.node, 1e7),
      other: int(procs.other, 1e7),
    },
    agent: {
      running: int(agent.running, 1e6),
      waiting: int(agent.waiting, 1e6),
      queued: int(agent.queued, 1e6),
      chats: int(agent.chats, 1e6),
      desktop: DESKTOP_STATES.includes(agent.desktop) ? agent.desktop : "unknown",
    },
  };
}

// Deep check: does `obj` carry ONLY keys in STATS_SCHEMA, with the right leaf
// types? Returns the list of offending paths (empty = clean).
export function schemaViolations(obj, schema = STATS_SCHEMA, at = "") {
  const out = [];
  if (Array.isArray(schema)) {
    if (!Array.isArray(obj)) return [`${at || "."}: not an array`];
    obj.forEach((v, i) => out.push(...schemaViolations(v, schema[0], `${at}[${i}]`)));
    return out;
  }
  if (schema === "n") return typeof obj === "number" && Number.isFinite(obj) ? [] : [`${at}: not a finite number`];
  if (schema === "s") return typeof obj === "string" && DESKTOP_STATES.includes(obj) ? [] : [`${at}: not an allowed word`];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [`${at || "."}: not an object`];
  for (const k of Object.keys(obj)) {
    if (!(k in schema)) out.push(`${at}.${k}: not allow-listed`);
    else out.push(...schemaViolations(obj[k], schema[k], `${at}.${k}`));
  }
  for (const k of Object.keys(schema)) if (!(k in obj)) out.push(`${at}.${k}: missing`);
  return out;
}
