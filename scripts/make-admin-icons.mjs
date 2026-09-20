/* Renders the admin PWA icons.
 *
 *   node scripts/make-admin-icons.mjs
 *
 * The portfolio and the admin install as two separate apps, so they need two
 * visually distinct home-screen icons — otherwise you tap the wrong one. The
 * site icon is light; this one is the dark terminal square with the amber
 * caret, matching the admin's own chrome.
 *
 * Rasterised through the Chrome that puppeteer-core already drives, so there is
 * no image dependency to install.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "..", "public");

const CHROME =
  process.env.CHROME_PATH ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => fs.existsSync(p));

// `pad` is the maskable safe-zone inset: Android may crop an icon to a circle,
// so a maskable variant keeps its content inside the middle ~80%.
const svg = ({ size, pad = 0, radius }) => {
  const s = size;
  const inset = Math.round(s * pad);
  const box = s - inset * 2;
  const r = radius ?? Math.round(box * 0.22);
  const fontSize = Math.round(box * 0.34);
  const caret = Math.round(box * 0.3);
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" fill="${pad ? "#0d0e13" : "none"}"/>
  <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${r}" fill="#0d0e13"/>
  <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${r}"
        fill="none" stroke="#23262f" stroke-width="${Math.max(1, box * 0.012)}"/>
  <text x="${s / 2}" y="${s / 2 + fontSize * 0.36}"
        font-family="JetBrains Mono, ui-monospace, Menlo, monospace"
        font-size="${fontSize}" font-weight="700" fill="#eceef3"
        text-anchor="middle" letter-spacing="${box * 0.01}">RK</text>
  <rect x="${s / 2 - caret / 2}" y="${inset + box * 0.735}"
        width="${caret}" height="${Math.round(box * 0.055)}" rx="${Math.round(box * 0.027)}"
        fill="#FFB020"/>
</svg>`.trim();
};

const TARGETS = [
  { file: "admin-icon-192.png", size: 192, pad: 0 },
  { file: "admin-icon-512.png", size: 512, pad: 0 },
  { file: "admin-icon-maskable-512.png", size: 512, pad: 0.1, radius: 0 },
  { file: "admin-apple-touch.png", size: 180, pad: 0 },
];

if (!CHROME) {
  console.error("Chrome not found. Set CHROME_PATH.");
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
});

for (const t of TARGETS) {
  const page = await browser.newPage();
  await page.setViewport({ width: t.size, height: t.size, deviceScaleFactor: 1 });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg(t)}</body></html>`,
    { waitUntil: "load" }
  );
  const out = path.join(OUT, t.file);
  await page.screenshot({ path: out, omitBackground: !t.pad });
  const { size } = fs.statSync(out);
  console.log(`  ${t.file.padEnd(30)} ${t.size}x${t.size}  ${Math.round(size / 1024)} KB`);
  await page.close();
}

await browser.close();
console.log("\nadmin icons written to public/");
