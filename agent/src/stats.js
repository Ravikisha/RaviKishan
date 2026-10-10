// The public server monitor: what the box is doing, as aggregate numbers only.
//
//   GET /public/stats   — UNAUTHENTICATED by design (the portfolio's System
//                         Monitor shows it to every visitor in dev mode)
//
// Because it is public, three rules hold and are tested in test/stats-check.mjs:
//   1. The response is built by shapeStats() (statsShape.js) field by field —
//      numbers, plus one fixed word. No hostname, address, user, path, port,
//      process argument, job title, repo, profile or org can ride out in it.
//   2. Sampling reads /proc and statfs only — no child processes — on a 2s
//      timer, and the request path serves the precomputed JSON from memory.
//      A visitor cannot make the box do work.
//   3. GET only, query string ignored, a per-IP token bucket (429), and it is
//      answered BEFORE the Firebase auth path, which it never touches.
import fs from "fs";
import { shapeStats, HISTORY } from "./statsShape.js";

export const STATS_PATH = "/public/stats";
export const INTERVAL_MS = 2000;

/* ---------------- /proc parsing (pure, fixture-tested) ---------------- */

// /proc/stat → [{ id: "cpu" | "cpu0"…, busy, total }]
export function parseProcStat(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const m = /^(cpu\d*)\s+(.*)$/.exec(line.trim());
    if (!m) continue;
    const f = m[2].split(/\s+/).map(Number);
    // user nice system idle iowait irq softirq steal (guest is already in user)
    const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = f;
    const total = user + nice + system + idle + iowait + irq + softirq + steal;
    out.push({ id: m[1], busy: total - idle - iowait, total });
  }
  return out;
}

// Percent busy between two snapshots of one CPU line.
export function cpuPct(prev, cur) {
  if (!prev || !cur) return 0;
  const dt = cur.total - prev.total;
  const db = cur.busy - prev.busy;
  if (!(dt > 0)) return 0;
  return Math.min(100, Math.max(0, (db / dt) * 100));
}

// /proc/meminfo → { key: kB }
export function parseMeminfo(text) {
  const out = {};
  for (const line of String(text).split("\n")) {
    const m = /^(\w+(?:\(\w+\))?):\s+(\d+)/.exec(line);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

const KB_GB = 1024 * 1024;
export function memFrom(info) {
  const total = info.MemTotal || 0;
  const avail = info.MemAvailable ?? (info.MemFree || 0) + (info.Buffers || 0) + (info.Cached || 0);
  const used = Math.max(0, total - avail);
  const sTotal = info.SwapTotal || 0;
  const sUsed = Math.max(0, sTotal - (info.SwapFree || 0));
  return {
    mem: { totalGb: total / KB_GB, usedGb: used / KB_GB, usedPct: total ? (used / total) * 100 : 0 },
    swap: { totalGb: sTotal / KB_GB, usedGb: sUsed / KB_GB, usedPct: sTotal ? (sUsed / sTotal) * 100 : 0 },
  };
}

export const parseLoadavg = (text) => String(text).trim().split(/\s+/).slice(0, 3).map(Number);
export const parseUptime = (text) => Number(String(text).trim().split(/\s+/)[0]) || 0;

// /proc/net/dev → { iface: { rx, tx } } (bytes)
export function parseNetDev(text) {
  const out = {};
  for (const line of String(text).split("\n")) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    if (f.length < 9) continue;
    out[m[1]] = { rx: f[0], tx: f[8] };
  }
  return out;
}

// The interface carrying the default route (/proc/net/route, destination 0),
// else the busiest non-loopback one. The NAME never leaves this module.
export function primaryIface(devs, routeText = "") {
  for (const line of String(routeText).split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length > 2 && f[1] === "00000000" && devs[f[0]]) return f[0];
  }
  let best = null;
  for (const [name, d] of Object.entries(devs)) {
    if (name === "lo") continue;
    if (!best || d.rx + d.tx > devs[best].rx + devs[best].tx) best = name;
  }
  return best;
}

// Bytes per second between two counter readings; a counter that went
// backwards (interface reset) reads as 0, not a negative rate.
export function rate(prev, cur, dtMs) {
  if (prev == null || cur == null || !(dtMs > 0)) return 0;
  const d = cur - prev;
  return d > 0 ? (d / dtMs) * 1000 : 0;
}

// A process's coarse kind, from its comm and (for node only) argv. The name
// and argv are read, classified and dropped here — only the count leaves.
export function classifyProc(comm, cmdline = "") {
  const c = String(comm).trim().toLowerCase();
  if (c === "claude") return "claude";
  if (c === "codex") return "codex";
  if (/^(chrome|chromium|chromium-browse|headless_shell)/.test(c)) return "chromium";
  if (c === "node" || c === "nodejs" || c === "mainthread") {
    const a = String(cmdline).toLowerCase();
    if (/claude-code|[/\\]claude(\s|\0|$)|@anthropic-ai/.test(a)) return "claude";
    if (/[/\\]codex(\s|\0|$)|@openai[/\\]codex/.test(a)) return "codex";
    return "node";
  }
  return "other";
}

export function countProcs(procDir = "/proc", read = fs) {
  const out = { total: 0, claude: 0, codex: 0, chromium: 0, node: 0, other: 0 };
  let ents = [];
  try {
    ents = read.readdirSync(procDir);
  } catch {
    return out;
  }
  for (const e of ents) {
    if (!/^\d+$/.test(e)) continue;
    let comm;
    try {
      comm = read.readFileSync(`${procDir}/${e}/comm`, "utf8");
    } catch {
      continue; // exited between readdir and read
    }
    let cmd = "";
    if (/^(node|nodejs|mainthread)$/i.test(comm.trim())) {
      try {
        cmd = read.readFileSync(`${procDir}/${e}/cmdline`, "utf8");
      } catch {}
    }
    out.total++;
    out[classifyProc(comm, cmd)]++;
  }
  return out;
}

export function diskFrom(st) {
  if (!st) return { totalGb: 0, usedGb: 0, usedPct: 0 };
  const total = st.blocks * st.bsize;
  const used = (st.blocks - st.bfree) * st.bsize;
  const avail = st.bavail * st.bsize;
  const GB = 1024 ** 3;
  // df's arithmetic: used / (used + available to unprivileged users).
  return { totalGb: total / GB, usedGb: used / GB, usedPct: used + avail ? (used / (used + avail)) * 100 : 0 };
}

// Is the shared desktop up? The DISPLAY, not VNC: VNC is deliberately off on
// the box (SELinux), so probing 5901 reported a running desktop as "down".
// Xvfb listens on an abstract unix socket, which /proc/net/unix lists — read
// in-process, no child, and it works from inside agentd's PrivateTmp, where
// the /tmp/.X11-unix path itself is invisible.
export const probeDisplay = async ({ read = fs, procRoot = "/proc", display = process.env.AGENT_DISPLAY || ":1" } = {}) => {
  const n = String(display).replace(/^.*:/, "").split(".")[0];
  const text = read.readFileSync(`${procRoot}/net/unix`, "utf8");
  return text.includes(`@/tmp/.X11-unix/X${n}`) || text.includes(`/tmp/.X11-unix/X${n}`);
};

/* ---------------- the sampler ---------------- */

// `agentState()` is supplied by server.js from in-process state and must
// return counts only. Everything here is injectable so tests run on fixtures.
export function createStats({
  agentState = () => ({}),
  read = fs,
  procRoot = "/proc",
  statfs = () => fs.statfsSync("/"),
  now = () => Date.now(),
  intervalMs = INTERVAL_MS,
  desktopProbe = () => probeDisplay({ read, procRoot }),
  desktopEveryMs = 10_000,
} = {}) {
  const ring = []; // last HISTORY samples
  let prevCpu = null;
  let prevNet = null;
  let snapshot = shapeStats({ at: now(), intervalMs });
  let body = JSON.stringify(snapshot);
  let desktop = "unknown";
  let desktopAt = 0;
  let timer = null;

  const readText = (p) => {
    try {
      return read.readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };

  async function refreshDesktop() {
    if (now() - desktopAt < desktopEveryMs) return;
    desktopAt = now();
    try {
      desktop = (await desktopProbe()) ? "up" : "down";
    } catch {
      desktop = "unknown";
    }
  }

  function sample() {
    const t = now();
    const cpus = parseProcStat(readText(`${procRoot}/stat`));
    const byId = Object.fromEntries(cpus.map((c) => [c.id, c]));
    const prevById = prevCpu ? Object.fromEntries(prevCpu.map((c) => [c.id, c])) : {};
    const total = cpuPct(prevById.cpu, byId.cpu);
    const cores = cpus.filter((c) => c.id !== "cpu").map((c) => cpuPct(prevById[c.id], c));
    prevCpu = cpus;

    const { mem, swap } = memFrom(parseMeminfo(readText(`${procRoot}/meminfo`)));
    const devs = parseNetDev(readText(`${procRoot}/net/dev`));
    const iface = primaryIface(devs, readText(`${procRoot}/net/route`));
    const cur = iface ? devs[iface] : null;
    const dt = prevNet ? t - prevNet.at : 0;
    const same = prevNet && prevNet.iface === iface;
    const rxBps = same ? rate(prevNet.rx, cur?.rx, dt) : 0;
    const txBps = same ? rate(prevNet.tx, cur?.tx, dt) : 0;
    prevNet = cur ? { iface, rx: cur.rx, tx: cur.tx, at: t } : null;

    let disk;
    try {
      disk = diskFrom(statfs());
    } catch {
      disk = diskFrom(null);
    }

    let a = {};
    try {
      a = agentState() || {};
    } catch {}

    ring.push({ cpu: total, mem: mem.usedPct, rx: rxBps, tx: txBps });
    while (ring.length > HISTORY) ring.shift();

    snapshot = shapeStats({
      at: t,
      intervalMs,
      uptimeS: parseUptime(readText(`${procRoot}/uptime`)),
      load: parseLoadavg(readText(`${procRoot}/loadavg`)),
      cpu: { total, cores, history: ring.map((s) => s.cpu) },
      mem: { ...mem, history: ring.map((s) => s.mem) },
      swap,
      disk,
      net: { rxBps, txBps, rxHistory: ring.map((s) => s.rx), txHistory: ring.map((s) => s.tx) },
      procs: countProcs(procRoot, read),
      agent: { running: a.running, waiting: a.waiting, queued: a.queued, chats: a.chats, desktop },
    });
    body = JSON.stringify(snapshot);
    refreshDesktop(); // async; lands in the next sample
    return snapshot;
  }

  return {
    sample,
    snapshot: () => snapshot,
    body: () => body,
    ringSize: () => ring.length,
    start() {
      if (timer) return;
      sample();
      timer = setInterval(sample, intervalMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

/* ---------------- rate limit ---------------- */

// A token bucket per client address. Behind the Cloudflare tunnel every
// request arrives from loopback, so the tunnel's CF-Connecting-IP is trusted
// ONLY when the socket itself is loopback (nothing else can reach a
// loopback-bound agentd); otherwise the socket address is the key.
export function createLimiter({ perMin = Number(process.env.AGENT_STATS_PER_MIN || 30), burst, now = () => Date.now(), maxKeys = 10_000 } = {}) {
  const cap = burst || perMin;
  const refillPerMs = perMin / 60_000;
  const buckets = new Map();
  return {
    take(key) {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= maxKeys) {
          // Drop full buckets first; if none, the oldest. Bounded memory.
          for (const [k, v] of buckets) if (v.tokens + (t - v.at) * refillPerMs >= cap) buckets.delete(k);
          if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
        }
        b = { tokens: cap, at: t };
        buckets.set(key, b);
      }
      b.tokens = Math.min(cap, b.tokens + (t - b.at) * refillPerMs);
      b.at = t;
      if (b.tokens < 1) return { ok: false, retryS: Math.ceil((1 - b.tokens) / refillPerMs / 1000) };
      b.tokens -= 1;
      return { ok: true };
    },
    size: () => buckets.size,
  };
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
export function clientKey(req) {
  const sock = req.socket?.remoteAddress || "";
  if (LOOPBACK.test(sock)) {
    const cf = String(req.headers?.["cf-connecting-ip"] || "").trim();
    if (cf && cf.length < 64) return cf;
  }
  return sock || "unknown";
}

export const isStatsPath = (url) => String(url || "").split("?")[0] === STATS_PATH;

// The HTTP handler. Serves the precomputed body; never awaits anything.
export function createStatsHandler({ stats, limiter = createLimiter() } = {}) {
  return function handleStats(req, res) {
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET", "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end('{"error":"Use GET."}');
    }
    const lim = limiter.take(clientKey(req));
    if (!lim.ok) {
      res.writeHead(429, { "Retry-After": String(lim.retryS), "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end('{"error":"Too many requests."}');
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=2",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(stats.body());
  };
}
