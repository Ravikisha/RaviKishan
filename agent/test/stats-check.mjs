// The public server monitor (GET /public/stats), checked without a Linux box:
// /proc is a fixture tree, the clock is fake, and the HTTP handler runs on a
// real loopback socket.
//
//   node test/stats-check.mjs
import http from "http";
import {
  parseProcStat,
  cpuPct,
  parseMeminfo,
  memFrom,
  parseLoadavg,
  parseUptime,
  parseNetDev,
  primaryIface,
  rate,
  classifyProc,
  countProcs,
  diskFrom,
  createStats,
  createLimiter,
  createStatsHandler,
  clientKey,
  isStatsPath,
  STATS_PATH,
} from "../src/stats.js";
import { shapeStats, schemaViolations, STATS_SCHEMA, HISTORY } from "../src/statsShape.js";

let pass = 0;
const fails = [];
const check = (ok, name, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

/* ---------------- fixtures ---------------- */

const STAT_A = `cpu  1000 0 500 8000 500 0 0 0 0 0
cpu0 500 0 250 4000 250 0 0 0 0 0
cpu1 500 0 250 4000 250 0 0 0 0 0
intr 12345
ctxt 999
`;
// +300 busy/+1000 total overall; cpu0 fully busy, cpu1 idle
const STAT_B = `cpu  1200 0 600 8700 500 0 0 0 0 0
cpu0 650 0 300 4000 250 0 0 0 0 0
cpu1 550 0 300 4700 250 0 0 0 0 0
`;
const MEMINFO = `MemTotal:        8000000 kB
MemFree:          500000 kB
MemAvailable:    2000000 kB
Buffers:          100000 kB
Cached:          1000000 kB
SwapTotal:       2000000 kB
SwapFree:        1500000 kB
Hugepagesize:       2048 kB
`;
const NETDEV = (rx, tx) => `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 99999999  100    0    0    0     0          0         0 99999999  100    0    0    0     0       0          0
  ens3: ${rx}  200    0    0    0     0          0         0 ${tx}  150    0    0    0     0       0          0
docker0: 50  1    0    0    0     0          0         0 60  1    0    0    0     0       0          0
`;
const ROUTE = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
ens3\t00000000\t0100000A\t0003\t0\t0\t0\t00000000\t0\t0\t0
ens3\t0000000A\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0
`;

/* ---------------- parsing ---------------- */
console.log("\n/proc parsing");
{
  const a = parseProcStat(STAT_A);
  check(a.length === 3 && a[0].id === "cpu" && a[2].id === "cpu1", "/proc/stat yields the aggregate and each core, nothing else");
  check(a[0].total === 10000 && a[0].busy === 1500, "busy excludes idle AND iowait", JSON.stringify(a[0]));
  const b = parseProcStat(STAT_B);
  check(near(cpuPct(a[0], b[0]), 30), "total CPU % is the busy delta over the total delta", String(cpuPct(a[0], b[0])));
  check(near(cpuPct(a[1], b[1]), 100), "a core that only worked reads 100%");
  check(near(cpuPct(a[2], b[2]), 12.5), "a mostly idle core reads its share", String(cpuPct(a[2], b[2])));
  check(cpuPct(null, b[0]) === 0 && cpuPct(b[0], b[0]) === 0, "no previous sample, or no elapsed ticks, reads 0 rather than NaN");
  check(cpuPct(b[0], a[0]) === 0, "counters going backwards clamp to 0");

  const m = parseMeminfo(MEMINFO);
  check(m.MemTotal === 8000000 && m.MemAvailable === 2000000, "/proc/meminfo is read in kB by key");
  const { mem, swap } = memFrom(m);
  check(near(mem.usedPct, 75) && near(mem.totalGb, 7.63, 0.01), "used = MemTotal − MemAvailable", JSON.stringify(mem));
  check(near(swap.usedPct, 25), "swap used = SwapTotal − SwapFree");
  check(memFrom({}).mem.usedPct === 0, "an unreadable meminfo reads 0, not NaN");

  check(JSON.stringify(parseLoadavg("0.52 0.40 0.31 2/345 6789\n")) === "[0.52,0.4,0.31]", "loadavg: three averages, the pid/runnable fields dropped");
  check(parseUptime("12345.67 40000.12\n") === 12345.67, "uptime: the first field");

  const d = parseNetDev(NETDEV(1000, 2000));
  check(d.ens3.rx === 1000 && d.ens3.tx === 2000 && d.lo && d.docker0, "/proc/net/dev: rx bytes is field 0, tx bytes is field 8");
  check(primaryIface(d, ROUTE) === "ens3", "primary interface is the default route's");
  check(primaryIface(d, "") === "ens3", "with no route table, the busiest non-loopback interface");
  check(primaryIface({ lo: { rx: 1, tx: 1 } }, "") === null, "loopback alone is never chosen");

  check(rate(1000, 3000, 2000) === 1000, "net rate = delta bytes per second");
  check(rate(3000, 1000, 2000) === 0, "a counter reset reads 0, not negative");
  check(rate(null, 1000, 2000) === 0 && rate(1, 2, 0) === 0, "no previous reading or no elapsed time reads 0");

  check(classifyProc("claude\n") === "claude", "comm claude → claude");
  check(classifyProc("codex") === "codex", "comm codex → codex");
  check(classifyProc("chrome") === "chromium" && classifyProc("chromium-browse") === "chromium", "chrome/chromium → chromium");
  check(classifyProc("node", "node\0/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js\0") === "claude", "node running claude-code → claude");
  check(classifyProc("node", "node\0/usr/bin/codex\0exec\0") === "codex", "node running codex → codex");
  check(classifyProc("node", "node\0src/server.js\0") === "node", "plain node → node");
  check(classifyProc("sshd") === "other", "anything else → other");

  const st = { blocks: 1000, bsize: 4096, bfree: 400, bavail: 300 };
  const disk = diskFrom(st);
  check(near(disk.usedPct, (600 / 900) * 100), "disk used % uses df's arithmetic (used / used+avail)", String(disk.usedPct));
}

/* ---------------- a fake /proc tree ---------------- */
function fakeFs(files) {
  return {
    readFileSync(p) {
      if (!(p in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return typeof files[p] === "function" ? files[p]() : files[p];
    },
    readdirSync(dir) {
      const out = new Set();
      for (const k of Object.keys(files)) if (k.startsWith(dir + "/")) out.add(k.slice(dir.length + 1).split("/")[0]);
      return [...out];
    },
  };
}

console.log("\nsampler");
let statText = STAT_A;
let netText = NETDEV(1000, 2000);
const SECRET_HOST = "agent.ravikishan.me";
const files = {
  "/proc/stat": () => statText,
  "/proc/meminfo": MEMINFO,
  "/proc/loadavg": "0.52 0.40 0.31 2/345 6789\n",
  "/proc/uptime": "12345.67 40000.12\n",
  "/proc/net/dev": () => netText,
  "/proc/net/route": ROUTE,
  "/proc/101/comm": "claude\n",
  "/proc/101/cmdline": "claude\0--dangerously-secret-arg\0/home/ravi/work/job-abc\0",
  "/proc/102/comm": "node\n",
  "/proc/102/cmdline": "node\0/srv/agentd/src/server.js\0",
  "/proc/103/comm": "chrome\n",
  "/proc/104/comm": "sshd\n",
  "/proc/self/comm": "node\n", // not numeric — skipped
  "/proc/hostname": SECRET_HOST,
};
let clock = 1_700_000_000_000;
const stats = createStats({
  read: fakeFs(files),
  statfs: () => ({ blocks: 1000, bsize: 4096, bfree: 400, bavail: 300 }),
  now: () => clock,
  // agentState tries to leak: extra fields, strings, an object — none may survive.
  agentState: () => ({ running: 2, waiting: 1, queued: 0, chats: 3, jobs: [{ title: "secret repo", repo: "github.com/x/y" }], profile: "work" }),
  desktopProbe: async () => true,
});
const s1 = stats.sample();
check(s1.cpu.total === 0 && s1.net.rxBps === 0, "the first sample has no deltas yet and says 0");
clock += 2000;
statText = STAT_B;
netText = NETDEV(5000, 4000);
const s2 = stats.sample();
check(near(s2.cpu.total, 30) && s2.cpu.cores.length === 2 && near(s2.cpu.cores[0], 100), "the second sample has real CPU deltas", JSON.stringify(s2.cpu));
check(s2.net.rxBps === 2000 && s2.net.txBps === 1000, "net rates are per second over the sample interval", JSON.stringify(s2.net));
check(s2.procs.total === 4 && s2.procs.claude === 1 && s2.procs.node === 1 && s2.procs.chromium === 1 && s2.procs.other === 1, "process COUNTS by kind", JSON.stringify(s2.procs));
check(s2.agent.running === 2 && s2.agent.chats === 3 && s2.agent.waiting === 1, "agent activity is counts from in-process state");
await new Promise((r) => setTimeout(r, 10));
clock += 2000;
const s3 = stats.sample();
check(s3.agent.desktop === "up", "the desktop probe lands as up/down", s3.agent.desktop);
for (let i = 0; i < HISTORY + 20; i++) {
  clock += 2000;
  stats.sample();
}
check(stats.ringSize() === HISTORY && stats.snapshot().cpu.history.length === HISTORY, `the ring keeps exactly the last ${HISTORY} samples`);
check(stats.body() === JSON.stringify(stats.snapshot()), "the served body is precomputed from the snapshot");

/* ---------------- the response is ONLY the allow-list ---------------- */
console.log("\nallow-list");
{
  const snap = stats.snapshot();
  const v = schemaViolations(snap);
  check(v.length === 0, "a live snapshot carries only allow-listed keys (deep)", v.join("; "));
  check(!("jobs" in snap.agent) && !("profile" in snap.agent), "extra agentState fields never reach the response");

  const evil = shapeStats({
    hostname: SECRET_HOST,
    ip: "10.0.0.5",
    cpu: { total: 50, cores: [1, "x", 3], model: "AMD EPYC", history: [1, 2] },
    mem: { totalGb: 8, usedGb: "4", usedPct: 50, path: "/home/ravi" },
    net: { rxBps: 1, txBps: 2, iface: "ens3", rxHistory: [1], txHistory: [2] },
    procs: { total: 3, claude: 1, names: ["claude --token sk-123"] },
    agent: { running: 1, desktop: "up; rm -rf /", user: "ravi@example.com" },
    env: { SECRET: "x" },
    __proto__: { polluted: 1 },
  });
  const v2 = schemaViolations(evil);
  check(v2.length === 0, "shapeStats drops every key it does not know, at every depth", v2.join("; "));
  check(evil.agent.desktop === "unknown", "the one string field is an enum — anything else becomes 'unknown'");
  check(evil.cpu.cores[1] === 0 && evil.mem.usedGb === 4, "leaves are coerced to finite numbers");

  const strings = [];
  const walk = (o) => {
    if (typeof o === "string") strings.push(o);
    else if (o && typeof o === "object") for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(snap);
  walk(evil);
  const BAD = [/\//, /\\/, /\b\d{1,3}(\.\d{1,3}){3}\b/, /[a-z0-9-]+\.[a-z]{2,}/i, /@/, /:/];
  const leaky = strings.filter((x) => BAD.some((re) => re.test(x)));
  check(leaky.length === 0, "no string in the response looks like a path, IP, hostname or e-mail", leaky.join(","));
  check(strings.every((x) => ["up", "down", "unknown"].includes(x)), "the only strings are up/down/unknown", strings.join(","));
  const raw = stats.body();
  check(!raw.includes(SECRET_HOST) && !raw.includes("ravi") && !raw.includes("secret") && !raw.includes("ens3"), "the serialized body names no host, user, job or interface");
  check(Object.keys(STATS_SCHEMA).length === 12, "the schema itself has not grown silently", String(Object.keys(STATS_SCHEMA).length));
}

/* ---------------- rate limit + HTTP ---------------- */
console.log("\nhttp");
{
  let t = 0;
  const lim = createLimiter({ perMin: 30, now: () => t });
  let ok = 0;
  for (let i = 0; i < 40; i++) if (lim.take("a").ok) ok++;
  check(ok === 30, "a burst is capped at 30 per client", String(ok));
  check(lim.take("b").ok, "another client has its own bucket");
  t += 2000;
  check(lim.take("a").ok && !lim.take("a").ok, "one token refills every 2s at 30/min");
  const denied = lim.take("a");
  check(!denied.ok && denied.retryS >= 1, "a refusal says when to retry");
  const small = createLimiter({ perMin: 30, maxKeys: 5, now: () => t });
  for (let i = 0; i < 50; i++) small.take(`k${i}`);
  check(small.size() <= 5, "the bucket table is bounded", String(small.size()));

  check(clientKey({ socket: { remoteAddress: "127.0.0.1" }, headers: { "cf-connecting-ip": "1.2.3.4" } }) === "1.2.3.4", "behind the tunnel the visitor's address keys the bucket");
  check(clientKey({ socket: { remoteAddress: "5.6.7.8" }, headers: { "cf-connecting-ip": "1.2.3.4" } }) === "5.6.7.8", "a non-loopback caller cannot pick its own key with the header");
  check(isStatsPath("/public/stats") && isStatsPath("/public/stats?x=1&y=../../") && !isStatsPath("/public/stats/x") && !isStatsPath("/health"), "the route matches its path with any query string, nothing else");

  const handler = createStatsHandler({ stats, limiter: createLimiter({ perMin: 3, now: () => 0 }) });
  const server = http.createServer((req, res) => (isStatsPath(req.url) ? handler(req, res) : (res.writeHead(404), res.end())));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r1 = await fetch(`${base}${STATS_PATH}?anything=1`);
    const j = await r1.json();
    check(r1.status === 200 && schemaViolations(j).length === 0, "GET answers 200 with the allow-listed body, query ignored");
    check(r1.headers.get("cache-control") === "public, max-age=2", "Cache-Control: public, max-age=2", r1.headers.get("cache-control"));
    const p = await fetch(`${base}${STATS_PATH}`, { method: "POST", body: "{}" });
    check(p.status === 405 && p.headers.get("allow") === "GET", "POST is refused with 405 and Allow: GET");
    const h = await fetch(`${base}${STATS_PATH}`, { method: "HEAD" });
    check(h.status === 405, "HEAD is refused too (GET only)");
    await fetch(`${base}${STATS_PATH}`);
    await fetch(`${base}${STATS_PATH}`);
    const r4 = await fetch(`${base}${STATS_PATH}`);
    check(r4.status === 429 && r4.headers.get("retry-after"), "past the limit: 429 with Retry-After", String(r4.status));
    const hdrs = await fetch(`${base}${STATS_PATH}`, { headers: { Authorization: "Bearer junk" } });
    check(hdrs.status === 429, "an Authorization header changes nothing (no auth path)");
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

/* ---------------- wiring in server.js ---------------- */
console.log("\nwiring");
{
  const fs = await import("fs");
  const src = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const statsAt = src.indexOf("isStatsPath(req.url)");
  const authAt = Math.min(...["verifyToken(", "handleApi(", "workbench.handleHttp("].map((k) => src.indexOf(k, src.indexOf("http.createServer"))).filter((n) => n > 0));
  check(statsAt > 0 && statsAt < authAt, "server.js answers /public/stats before any auth or workbench path");
  const block = src.slice(src.indexOf("const stats = createStats("), src.indexOf("stats.start();"));
  check(/registry\.counts\(\)/.test(block) && !/\.\.\.|registry\.list|chats\.list/.test(block), "agentState hands over counts only — no spread, no job or chat objects");
  const stx = fs.readFileSync(new URL("../src/stats.js", import.meta.url), "utf8");
  check(!/child_process|spawn\(|execFile|execSync/.test(stx), "the sampler starts no child processes");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.map((f) => `  - ${f}`).join("\n"));
  process.exitCode = 1;
}
// exitCode rather than process.exit(): exiting with undici's sockets still
// closing trips a libuv assertion on Windows.
