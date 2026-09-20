/* Checks the admin PWA is actually installable and actually safe.
 *
 *   node scripts/pwa-check.mjs            # against a production build
 *   BASE_URL=https://www.ravikishan.me node scripts/pwa-check.mjs
 *
 * Two things are being verified, and the second matters more than the first:
 *   1. installability — manifest reachable, correctly typed, icons real PNGs of
 *      the size they claim, scope/start_url consistent
 *   2. the service worker never caches anything carrying a credential. The
 *      vault signing route returns presigned Backblaze URLs; a cached copy is a
 *      replayable credential.
 *
 * Run against `next build && next start` — next-pwa is disabled in dev, so the
 * service worker does not exist there.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const BASE = process.env.BASE_URL || "http://localhost:3000";

let pass = 0;
let fail = 0;
const check = (cond, name, detail) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

// PNG header: width/height live at bytes 16..24 of the IHDR chunk.
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

console.log(`base: ${BASE}\n`);
console.log("manifest");

const res = await fetch(`${BASE}/admin.webmanifest`);
check(res.ok, "admin.webmanifest is served", `HTTP ${res.status}`);
const ctype = res.headers.get("content-type") || "";
check(
  /application\/manifest\+json|application\/json/.test(ctype),
  "served as a manifest content-type",
  ctype
);

let m = null;
try {
  m = await res.json();
} catch (e) {
  check(false, "manifest is valid JSON", e.message);
}

if (m) {
  check(m.name && m.short_name, "has name and short_name", `${m.name} / ${m.short_name}`);
  check(m.display === "standalone", "display is standalone", m.display);
  check(m.scope === "/admin", "scope is /admin", m.scope);
  check(
    typeof m.start_url === "string" && m.start_url.startsWith("/admin"),
    "start_url is inside the scope",
    m.start_url
  );
  check(!!m.background_color && !!m.theme_color, "has theme + background colour");

  const any = (m.icons || []).filter((i) => (i.purpose || "any").includes("any"));
  const maskable = (m.icons || []).filter((i) => (i.purpose || "").includes("maskable"));
  check(any.length >= 2, `has ${any.length} standard icons`);
  check(maskable.length >= 1, "has a maskable icon (Android crops to a circle otherwise)");
  check(
    any.some((i) => i.sizes === "512x512"),
    "has a 512px icon (Chrome requires >=144 to offer install)"
  );

  console.log("\nicons");
  for (const icon of m.icons || []) {
    const r = await fetch(BASE + icon.src);
    if (!r.ok) {
      check(false, `${icon.src} resolves`, `HTTP ${r.status}`);
      continue;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const size = pngSize(buf);
    check(!!size, `${icon.src} is a real PNG`);
    if (size) {
      const [w, h] = icon.sizes.split("x").map(Number);
      check(
        size.w === w && size.h === h,
        `${icon.src} is genuinely ${icon.sizes}`,
        `actually ${size.w}x${size.h}`
      );
    }
  }

  console.log("\nshortcuts");
  for (const s of m.shortcuts || []) {
    check(
      s.url.startsWith("/admin"),
      `shortcut "${s.name}" stays inside the scope`,
      s.url
    );
  }
}

console.log("\nscope isolation");
{
  const adminHtml = await (await fetch(`${BASE}/admin`)).text();
  const siteHtml = await (await fetch(`${BASE}/`)).text();
  check(
    adminHtml.includes("/admin.webmanifest"),
    "/admin links the admin manifest"
  );
  check(
    !adminHtml.includes('href="/manifest.json"'),
    "/admin does NOT also link the site manifest (two would be ambiguous)"
  );
  check(siteHtml.includes("/manifest.json"), "/ still links the site manifest");
  check(
    !siteHtml.includes("/admin.webmanifest"),
    "/ does NOT link the admin manifest"
  );
  check(
    adminHtml.includes("apple-mobile-web-app-capable"),
    "/admin sets the iOS standalone meta (iOS ignores the manifest)"
  );
  check(
    /<meta name="robots" content="noindex/.test(adminHtml),
    "/admin is still noindex"
  );
}

console.log("\nservice worker never caches credentials");
{
  const swPath = path.join(root, "public", "sw.js");
  if (!fs.existsSync(swPath)) {
    check(false, "public/sw.js exists", "run `next build` first — next-pwa is disabled in dev");
  } else {
    const sw = fs.readFileSync(swPath, "utf8");
    check(/NetworkOnly/.test(sw), "a NetworkOnly strategy is registered");
    check(
      /\\\/api\\\//.test(sw) || /\/api\\\//.test(sw) || sw.includes("/api/"),
      "the /api/ never-cache rule made it into the worker"
    );
    // The hostnames live inside a minified RegExp literal, so the dots are
    // backslash-escaped in the emitted source — match that, not the plain form.
    check(
      /backblazeb2\\?\.com/.test(sw) && /googleapis\\?\.com/.test(sw),
      "the storage/Firebase never-cache rule made it into the worker"
    );

    // Precaching the admin's JS chunk and icons is fine — that is public code.
    // What must never be precached is an API response or the admin DOCUMENT,
    // which would let the worker serve a stale shell from a signed-out state.
    const precached = [...sw.matchAll(/url\s*:\s*"([^"]+)"/g)].map((x) => x[1]);
    const leaked = precached.filter(
      (u) => /^\/api\//.test(u) || /^\/admin(\?|$)/.test(u) || /vault|\.env/i.test(u)
    );
    check(
      leaked.length === 0,
      "no API response, admin document or vault URL is precached",
      leaked.slice(0, 4).join(", ")
    );
    console.log(`     (${precached.length} precached entries, all public assets)`);
  }
}

// Chrome's own manifest parser is the final word on installability — it reports
// the errors the install prompt actually gates on, which no amount of
// hand-checking the JSON can tell you.
console.log("\nChrome manifest parser (CDP)");
try {
  const puppeteer = (await import("puppeteer-core")).default;
  const CHROME =
    process.env.CHROME_PATH ||
    [
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      "/usr/bin/google-chrome",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ].find((p) => fs.existsSync(p));

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
  const page = await browser.newPage();
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
  const cdp = await page.target().createCDPSession();
  const parsed = await cdp.send("Page.getAppManifest");

  const errors = (parsed.errors || []).filter((e) => e.critical);
  const warnings = (parsed.errors || []).filter((e) => !e.critical);
  check(!!parsed.url, "Chrome found a manifest for /admin", parsed.url);
  check(
    errors.length === 0,
    "no critical manifest errors",
    errors.map((e) => e.message).join("; ")
  );
  if (warnings.length)
    console.log(`     warnings: ${warnings.map((w) => w.message).join("; ")}`);

  const swOk = await page.evaluate(() => "serviceWorker" in navigator);
  check(swOk, "service worker API available on this origin");

  await browser.close();
} catch (e) {
  check(false, "Chrome manifest parse", e.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
