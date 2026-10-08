// The Social desk, checked in a real browser at three widths.
//
//   npm run e2e:social        (needs `npm run dev` already running)
//   BASE_URL=… CHROME_PATH=… HEADFUL=1 to override
//
// It drives /__socialpreview, which renders the REAL Roster, Identity, Meter
// and Refusal against a deliberately unflattering seed — an expired account, a
// channel with a name rather than a handle, a caption over its cap, and a
// service that is not set up at all. A preview full of healthy rows shows none
// of the states those components exist for, and a suite run against it proves
// nothing.
//
// What is asserted is what was actually wrong, measured rather than reasoned:
//
//  - NOTHING OVERFLOWS SIDEWAYS at 390px. This is the whole reason the suite
//    is a browser and not a unit test; the admin installs as a PWA on a phone.
//  - The handle's FACE follows what the label is. A leading @ means an address
//    and is set in mono; "pch builds" is a name and is not. Getting this wrong
//    makes a channel name read as a terminal string.
//  - The handle SHRINKS on a phone. It did not, for a while: `.so-handle.so-addr`
//    sets a size and beat the media query's `.so-handle`, so an address stayed
//    at its desktop size on a 390px screen while a plain name shrank.
//  - All three meter tones render. A meter that cannot go red is decoration.
//  - A service that is not set up states what it needs INSTEAD of offering a
//    button, and is not a <button> at all — there is nothing there to press.
//  - The selected account carries the amber edge and nothing else does, which
//    is the only answer to "which account am I about to act as".
import fs from "fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ||
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => fs.existsSync(p));

let pass = 0;
const fails = [];
const check = (cond, name, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}`);
  } else {
    fails.push(`${name}${detail ? ` \u2014 ${detail}` : ""}`);
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
};

const WIDTHS = [
  ["phone", 390, 844],
  ["tablet", 768, 1024],
  ["desktop", 1440, 900],
];

if (!CHROME) {
  console.error("Chrome not found. Set CHROME_PATH.");
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.HEADFUL ? false : "new",
  args: ["--no-first-run", "--no-default-browser-check"],
});

try {
  for (const [name, width, height] of WIDTHS) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.goto(`${BASE}/__socialpreview`, {
      // Not networkidle0: the dev server holds an HMR socket open forever.
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".so-handle", { timeout: 20000 });

    const r = await page.evaluate(() => {
      const d = document.documentElement;
      const face = (el) => (el ? getComputedStyle(el).fontFamily.split(",")[0].replace(/"/g, "") : null);
      const size = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
      const handles = [...document.querySelectorAll(".so-handle")];
      return {
        scrollWidth: d.scrollWidth,
        clientWidth: d.clientWidth,
        // An element wider than its own box is the thing that produces a
        // sideways scrollbar, and it names itself here rather than needing a
        // human to spot it in a screenshot.
        overflowing: [...document.querySelectorAll("body *")]
          .filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
          .map((e) => `${e.className || e.tagName} ${e.clientWidth}<${e.scrollWidth}`)
          .slice(0, 6),
        addrFace: face(handles.find((h) => h.textContent.trim().startsWith("@"))),
        nameFace: face(handles.find((h) => !h.textContent.trim().startsWith("@"))),
        addrSize: size(handles.find((h) => h.textContent.trim().startsWith("@"))),
        nameSize: size(handles.find((h) => !h.textContent.trim().startsWith("@"))),
        selected: [...document.querySelectorAll(".so-who.on .so-who-name")].map((e) => e.textContent),
        expiredChips: document.querySelectorAll(".so-who.stale").length,
        offIsButton: document.querySelector(".so-who.so-off")?.tagName === "BUTTON",
        offSays: document.querySelector(".so-who.so-off .so-who-kind")?.textContent || "",
        tones: [...document.querySelectorAll(".so-meter")].map((m) =>
          /\b(fine|close|over)\b/.exec(m.className)?.[1]
        ),
        // The empty part of the track is what makes a meter legible as one.
        trackWidth: document.querySelector(".so-track")?.getBoundingClientRect().width || 0,
        namesAccount: [...document.querySelectorAll(".admin-primary")].some((b) =>
          /Publish as @/.test(b.textContent)
        ),
        refusalIsNotAButton: !document.querySelector(".so-cant button"),
      };
    });
    await page.close();

    console.log(`\n${name} — ${width}px`);
    check(r.scrollWidth <= r.clientWidth, "the page does not scroll sideways", `${r.scrollWidth} > ${r.clientWidth}`);
    check(r.overflowing.length === 0, "and nothing inside it overflows its own box", r.overflowing.join(" | "));
    check(/Mono/i.test(r.addrFace || ""), "an @handle is set in mono, because it is an address", r.addrFace);
    check(!/Mono/i.test(r.nameFace || ""), "a channel NAME is not, because it is not one", r.nameFace);
    check(r.selected.length === 1, "exactly one account wears the amber edge", r.selected.join(", "));
    check(r.expiredChips === 1, "an expired account is marked in the roster", String(r.expiredChips));
    check(r.offIsButton === false, "a service that is not set up offers no button to press");
    check(/X_CLIENT_ID/.test(r.offSays), "and names what it needs instead", r.offSays);
    check(r.tones.includes("fine") && r.tones.includes("close") && r.tones.includes("over"),
      "the meter reaches all three states", r.tones.join(", "));
    check(r.trackWidth > 20, "the meter has a visible empty track, not just a fill", `${r.trackWidth}px`);
    check(r.namesAccount, "the publish button names the account it would post as");
    check(r.refusalIsNotAButton, "a refusal is stated, never offered as a disabled control");

    if (name === "phone") {
      // Both faces must shrink. `.so-addr` sets its own size, so a media query
      // written against `.so-handle` alone silently loses to it.
      check(r.addrSize <= 24, "the handle shrinks on a phone", `${r.addrSize}px`);
      check(r.nameSize <= 24, "and so does a channel name", `${r.nameSize}px`);
    } else {
      check(r.addrSize >= 25, "and is set at display size above it", `${r.addrSize}px`);
    }
  }
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
