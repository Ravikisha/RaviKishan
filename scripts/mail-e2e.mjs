// The Mail desk, checked in a real browser at three widths.
//
//   npm run e2e:mail          (needs `npm run dev` already running)
//   BASE_URL=… CHROME_PATH=… HEADFUL=1 to override
//
// It drives /__mailpreview, which renders the REAL Headline, Row, Reader,
// Composer, Outbound, Unreadable and NotConnected against a deliberately
// unflattering seed: a mailbox that could not be read beside two that could,
// a message with no subject, a sender with no display name, and an address
// long enough to break a row.
//
// What is asserted is what would actually go wrong, and most of it already
// did once:
//
//  - NOTHING OVERFLOWS SIDEWAYS at 390px. The admin installs as a PWA on a
//    phone, and the longest string in this panel is an e-mail address, which
//    has no spaces to wrap at.
//  - A ROW'S ADDRESS AND SUBJECT ARE ON SEPARATE LINES. They are spans inside
//    a block button, so they are inline until told otherwise — measured, the
//    address ran straight into the subject on one line.
//  - THE SEND BUTTON DOES NOT EXIST UNTIL THE MESSAGE HAS BEEN REVIEWED, and
//    when it does exist it NAMES THE ADDRESS. This is the whole design: the
//    unrecoverable mistake with three mailboxes is the account, and a button
//    reading "Send" cannot warn about it.
//  - THE ADDRESS SHRINKS ON A PHONE. The Social desk shipped the opposite bug
//    for a while, because a two-class rule beat a one-class media query.
//  - AMBER APPEARS ONLY ON UNREAD ROWS. If a read row carries the accent the
//    panel is shouting about a quiet morning.
//  - A SERVICE WITH NO CLIENT IS NOT A BUTTON. A disabled button implies a
//    permission you could go and fix; there is nothing there to press.
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
    console.log(`\n${name} — ${width}x${height}`);
    const page = await browser.newPage();
    await page.setViewport({ width, height });

    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e.message)));

    await page.goto(`${BASE}/__mailpreview`, {
      // Not networkidle0: the dev server holds an HMR socket open forever.
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".mbx-row", { timeout: 30000 });

    /* --- it renders at all, and quietly --- */
    check(consoleErrors.length === 0, "nothing throws while rendering", consoleErrors[0] || "");

    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    check(over <= 0, "nothing overflows sideways", `${over}px past the viewport`);

    /* --- the row --- */
    const row = await page.evaluate(() => {
      const r = document.querySelector(".mbx-row");
      const box = r.querySelector(".mbx-box");
      const subj = r.querySelector(".mbx-subj");
      const b = box.getBoundingClientRect();
      const s = subj.getBoundingClientRect();
      return {
        boxBottom: b.bottom,
        subjTop: s.top,
        boxFont: getComputedStyle(box).fontFamily,
        rowRight: r.getBoundingClientRect().right,
        boxRight: b.right,
      };
    });
    // The bug this replaces: both are spans inside a block <button>, so they
    // sat on one line and the address ran into the subject.
    check(row.subjTop >= row.boxBottom - 1, "the mailbox address is on its own line above the subject");
    check(/mono/i.test(row.boxFont), "and is set in mono, this admin's mark for an identifier", row.boxFont);
    check(row.boxRight <= row.rowRight + 1, "a long address clips rather than widening the row");

    /* --- amber means unread, and only that --- */
    const edges = await page.evaluate(() =>
      [...document.querySelectorAll(".mbx-row")].map((r) => ({
        unread: r.classList.contains("unread"),
        edge: getComputedStyle(r).borderLeftColor,
      }))
    );
    const amber = (c) => /rgba?\(255,\s*176,\s*32/.test(c);
    check(
      edges.filter((e) => e.unread).every((e) => amber(e.edge)),
      "every unread row carries the amber edge"
    );
    check(
      edges.filter((e) => !e.unread).every((e) => !amber(e.edge)),
      "and no read row does, so the panel is only as loud as the inbox"
    );
    check(edges.some((e) => e.unread) && edges.some((e) => !e.unread), "the seed shows both states");

    /* --- the send control, which is the whole design --- */
    const outs = await page.evaluate(() => {
      return [...document.querySelectorAll(".mbx-outbound")].map((o) => ({
        hasReview: !!o.querySelector(".mbx-review"),
        buttons: [...o.querySelectorAll("button")].map((b) => b.textContent.trim()),
        asText: o.querySelector(".mbx-as")?.textContent || "",
        asSize: parseFloat(getComputedStyle(o.querySelector(".mbx-as")).fontSize),
        asFont: getComputedStyle(o.querySelector(".mbx-as")).fontFamily,
      }));
    });
    const draft = outs.find((o) => !o.hasReview);
    const reviewed = outs.find((o) => o.hasReview);
    check(!!draft && !!reviewed, "the preview shows the composer before and after review");
    check(
      draft.buttons.some((b) => /Review what goes out/.test(b)),
      "before review the only control is Review what goes out",
      draft.buttons.join(" | ")
    );
    // THE assertion. A send button that exists before anything has been seen,
    // or one that says "Send" instead of the address, is the bug this panel
    // was shaped to prevent.
    check(
      !draft.buttons.some((b) => /^(Send|Reply) as /.test(b)),
      "and there is NO send button at all until the message has been reviewed",
      draft.buttons.join(" | ")
    );
    check(
      reviewed.buttons.some((b) => /^(Send|Reply) as \S+@\S+/.test(b)),
      "after review the button names the address it goes out as",
      reviewed.buttons.join(" | ")
    );
    check(
      reviewed.buttons.some((b) => /Keep editing/.test(b)),
      "with a way back to the draft"
    );
    check(/@/.test(draft.asText), "the sending address is stated above the control", draft.asText);
    check(/mono/i.test(draft.asFont), "in mono, because it is an identifier", draft.asFont);

    // It must be the largest thing on the composer — that is what makes it the
    // one bold element. Measured against every other piece of text in the same
    // form rather than against a ratio, because the thing that beat it was the
    // Subject input: below 720px every .admin-input is 16px so iOS does not
    // zoom the page, and a 15px address lost to it on a phone.
    const biggest = await page.evaluate(() => {
      const form = document.querySelector(".mbx-form");
      const rivals = [...form.querySelectorAll("input, select, textarea, label, button, p, span")]
        .filter((el) => !el.classList.contains("mbx-as"))
        .map((el) => ({ what: el.className || el.tagName, size: parseFloat(getComputedStyle(el).fontSize) }))
        .sort((a, b) => b.size - a.size);
      return rivals[0];
    });
    check(
      draft.asSize > biggest.size,
      "and is the largest thing on the composer, beating every field on it",
      `address ${draft.asSize}px vs ${biggest.what} ${biggest.size}px`
    );

    /* --- the review block says what it is --- */
    const review = await page.evaluate(() => {
      const r = document.querySelector(".mbx-review");
      return { text: r.textContent, dashed: getComputedStyle(r).borderLeftStyle };
    });
    check(/cannot be unsent/i.test(review.text), "the review says the send cannot be undone");
    check(review.dashed === "dashed", "and is dashed, not a solid panel pretending to be sent mail");

    /* --- a mailbox that did not answer --- */
    const note = await page.evaluate(() => {
      const n = document.querySelector(".mbx-note");
      return { text: n.textContent, edge: getComputedStyle(n).borderLeftColor };
    });
    check(/could not be read/.test(note.text), "an unreadable mailbox is named");
    check(/Everything below is from the mailboxes that answered/.test(note.text), "and the rest is still shown");
    check(/rgb\(255,\s*107,\s*107\)/.test(note.edge), "marked by a red edge, not amber", note.edge);

    /* --- nothing connected --- */
    const unset = await page.evaluate(() => {
      const u = document.querySelector(".mbx-unset");
      return { tag: u.tagName, text: u.textContent, inButton: !!u.closest("button") };
    });
    check(unset.tag !== "BUTTON" && !unset.inButton, "a service with no client is not a button", unset.tag);
    check(/MS_TASKS_CLIENT_ID/.test(unset.text), "it names the variables it wants instead");

    /* --- the quality floor --- */
    const focus = await page.evaluate(() => {
      const r = document.querySelector(".mbx-row");
      r.focus();
      const s = getComputedStyle(r, ":focus-visible");
      return { tag: r.tagName, outline: s.outlineWidth };
    });
    check(focus.tag === "BUTTON", "a stream row is a real button, so it is reachable by keyboard", focus.tag);

    await page.close();
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
