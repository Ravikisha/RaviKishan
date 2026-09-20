/* Is the live site actually working?
 *
 *   node scripts/health-check.mjs
 *   BASE_URL=http://localhost:3000 node scripts/health-check.mjs
 *
 * Run on a cron by .github/workflows/health.yml — a failure fails the workflow,
 * which is what sends the notification. Checks only public surfaces, so it
 * needs no credentials.
 *
 * The point is not "did the server respond 200" — a broken deploy often does.
 * It checks that each page actually rendered its content, that the résumé link
 * resolves to a real PDF, and that nothing private became reachable.
 */
const BASE = process.env.BASE_URL || "https://www.ravikishan.me";

let pass = 0;
let fail = 0;
const problems = [];
const check = (cond, name, detail) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    problems.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const get = async (path, init) => {
  const started = Date.now();
  try {
    const res = await fetch(BASE + path, { redirect: "follow", ...init });
    return { res, ms: Date.now() - started, text: null };
  } catch (e) {
    return { error: e.message, ms: Date.now() - started };
  }
};

console.log(`base: ${BASE}\n`);
console.log("public pages render");

const PAGES = [
  { path: "/", must: "Ravi Kishan" },
  { path: "/about", must: "Ravi" },
  { path: "/projects", must: "" },
  { path: "/skills", must: "" },
  { path: "/resume", must: "Résumé" },
  { path: "/blog", must: "" },
  { path: "/contact", must: "" },
];

let slowest = { path: "", ms: 0 };
for (const p of PAGES) {
  const r = await get(p.path);
  if (r.error) {
    check(false, `${p.path} responds`, r.error);
    continue;
  }
  check(r.res.ok, `${p.path} responds 200`, `HTTP ${r.res.status} in ${r.ms}ms`);
  if (r.res.ok) {
    const html = await r.res.text();
    check(html.length > 2000, `${p.path} rendered real content`, `${html.length} bytes`);
    if (p.must) check(html.includes(p.must), `${p.path} contains ${JSON.stringify(p.must)}`);
    // A deploy that lost its chunks still serves HTML but is dead on arrival.
    check(/_next\/static/.test(html), `${p.path} references its build assets`);
  }
  if (r.ms > slowest.ms) slowest = { path: p.path, ms: r.ms };
}
console.log(`     slowest: ${slowest.path} at ${slowest.ms}ms`);

console.log("\nrésumé is downloadable");
{
  const r = await get("/Ravi_Kishan_Resume.pdf");
  check(!r.error && r.res.ok, "bundled résumé PDF resolves", r.error || `HTTP ${r.res?.status}`);
  if (!r.error && r.res.ok) {
    const buf = Buffer.from(await r.res.arrayBuffer());
    check(buf.subarray(0, 5).toString() === "%PDF-", "it is a real PDF", buf.subarray(0, 8).toString());
    check(buf.length > 20000, `PDF is ${Math.round(buf.length / 1024)}KB`);
  }
}

console.log("\nprivate surfaces stay private");
{
  const admin = await get("/admin");
  if (!admin.error) {
    const html = await admin.res.text();
    check(/noindex/.test(html), "/admin is noindex");
    // The signed-out admin must render the login, never the editor.
    check(!/Save & publish|Publish<\/button>/.test(html), "/admin does not render the editor to an anonymous visitor");
  }

  const mcp = await get("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check(!mcp.error && mcp.res.status === 401, "/api/mcp refuses unauthenticated calls", `HTTP ${mcp.res?.status}`);

  const vault = await get("/api/vault/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check(!vault.error && vault.res.status === 401, "/api/vault/sign refuses unauthenticated calls", `HTTP ${vault.res?.status}`);

  const backup = await get("/api/backup/run", { method: "POST" });
  check(!backup.error && backup.res.status === 401, "/api/backup/run refuses unauthenticated calls", `HTTP ${backup.res?.status}`);
}

console.log("\nsupporting files");
for (const [path, name] of [
  ["/robots.txt", "robots.txt"],
  ["/sitemap.xml", "sitemap"],
  ["/manifest.json", "site manifest"],
  ["/admin.webmanifest", "admin manifest"],
  ["/.well-known/oauth-protected-resource", "MCP discovery document"],
]) {
  const r = await get(path);
  check(!r.error && r.res.ok, `${name} is served`, r.error || `HTTP ${r.res?.status}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (problems.length) {
  console.log("\nproblems:");
  problems.forEach((p) => console.log(`  - ${p}`));
}
process.exit(fail ? 1 : 0);
