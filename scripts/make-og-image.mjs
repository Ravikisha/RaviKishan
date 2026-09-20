/* Regenerates the social preview image from the live homepage.
 *
 *   node scripts/make-og-image.mjs            # needs `next dev` running
 *   BASE_URL=https://www.ravikishan.me node scripts/make-og-image.mjs
 *
 * public/pagepreview.png is what LinkedIn, X, Slack and iMessage show when the
 * site is shared. It had drifted two redesigns behind and still read "Full
 * Stack Developer" — the positioning the whole site was rewritten away from.
 * A stale OG image is the single most-seen thing on a portfolio, because most
 * people meet the link before the page.
 *
 * So this is a script rather than a screenshot: run it whenever the homepage
 * changes and the preview cannot drift again.
 *
 * Output is 1200x630 — the ratio every platform crops to — rendered at 1.5x so
 * it stays sharp on retina without crossing the size where scrapers bail.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "public", "pagepreview.png");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const DARK = process.env.OG_THEME === "dark";

const CHROME =
  process.env.CHROME_PATH ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => fs.existsSync(p));

if (!CHROME) {
  console.error("Chrome not found. Set CHROME_PATH.");
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  // 1.5x keeps the type crisp on retina while staying well under the ~1 MB
  // mark where some link scrapers give up on an image.
  defaultViewport: { width: 1200, height: 630, deviceScaleFactor: 1.5 },
});
const page = await browser.newPage();

// Recruiter mode is the clean, distraction-free view — the desktop-OS chrome
// has no business in a link preview.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem("mode", "recruiter");
  } catch (_) {}
});

// `noload` skips the word-cloud loader, which otherwise covers the page.
await page.goto(`${BASE}/?noload`, { waitUntil: "networkidle2", timeout: 60000 });
if (DARK) await page.evaluate(() => document.documentElement.classList.add("dark"));

// Let fonts settle and the hero's entrance finish.
await page.evaluate(() => document.fonts?.ready);
await new Promise((r) => setTimeout(r, 2500));

// Hide the interactive chrome that means nothing in a static image.
const hidden = await page.evaluate(() => {
  const sels = [".rm-chip", ".os-wall", ".os-dock", ".os-menubar", "#nprogress", ".egg-toast"];
  let n = 0;
  for (const s of sels)
    document.querySelectorAll(s).forEach((el) => {
      el.style.display = "none";
      n++;
    });
  window.scrollTo(0, 0);
  return n;
});

await page.screenshot({ path: OUT, type: "png" });
await browser.close();

const { size } = fs.statSync(OUT);
console.log(
  `wrote public/pagepreview.png\n` +
    `  1200x630 @1.5x · ${Math.round(size / 1024)} KB · ${DARK ? "dark" : "light"} · ` +
    `${hidden} chrome element(s) hidden\n` +
    `  source: ${BASE}/`
);
if (size > 1024 * 1024)
  console.log("  note: over 1 MB — some scrapers skip large images. Consider re-encoding.");
