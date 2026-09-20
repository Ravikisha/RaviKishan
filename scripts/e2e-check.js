/* End-to-end checks driven through your installed Chrome (puppeteer-core — no
 * bundled Chromium download).
 *
 *   node scripts/e2e-check.js copy     # fully automated, headless
 *   node scripts/e2e-check.js resume   # headful; needs a one-time admin sign-in
 *   node scripts/e2e-check.js all
 *
 * Env: BASE_URL (default http://localhost:3000), CHROME_PATH, HEADFUL=1
 *
 * The `copy` suite is the regression guard for the site-wide "can't copy
 * anything" bug: a global contextmenu handler used to preventDefault() on all
 * page text. It asserts, on every route and in BOTH site modes, that text is
 * selectable, that right-click is not swallowed, and that Ctrl+C really puts
 * the selection on the system clipboard. It also asserts the desktop's own
 * right-click menu still works on the empty backdrop in dev mode, so the fix
 * cannot regress by simply deleting the feature.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ||
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => fs.existsSync(p));

const ROUTES = ["/", "/about", "/projects", "/skills", "/resume", "/contact", "/blog"];
const MODES = ["recruiter", "dev"];

let pass = 0;
let fail = 0;
const failures = [];

const ok = (name) => {
  pass++;
  console.log(`  \u2713 ${name}`);
};
const bad = (name, detail) => {
  fail++;
  failures.push(`${name}${detail ? ` \u2014 ${detail}` : ""}`);
  console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
};
const check = (cond, name, detail) => (cond ? ok(name) : bad(name, detail));

async function launch({ headful = false, userDataDir } = {}) {
  if (!CHROME) throw new Error("Chrome not found. Set CHROME_PATH.");
  return puppeteer.launch({
    executablePath: CHROME,
    headless: headful ? false : "new",
    defaultViewport: { width: 1440, height: 900 },
    userDataDir,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
}

// Force the site mode before any script runs, so _app.js / RecruiterMode pick
// it up on first paint rather than after a flash.
async function withMode(page, mode) {
  await page.evaluateOnNewDocument((m) => {
    try {
      localStorage.setItem("mode", m);
    } catch (_) {}
  }, mode);
}

/* ---------------- copy / selection suite ---------------- */

// Runs inside the page: select a real paragraph, then probe every gate that
// could block a copy.
const probe = () => {
  const out = { route: location.pathname };
  const vis = (el) =>
    el.offsetParent !== null && el.getClientRects().length > 0;
  const cands = Array.from(
    document.querySelectorAll("p, h1, h2, h3, li, span, td, a")
  ).filter((el) => vis(el) && (el.innerText || "").trim().length > 25);

  if (!cands.length) {
    out.error = "no visible text block found";
    return out;
  }
  const el = cands[0];
  const cs = getComputedStyle(el);
  out.sample = (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 46);
  out.bodySelect = getComputedStyle(document.body).userSelect;
  out.elSelect = cs.userSelect;

  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  out.selectedChars = String(sel).trim().length;

  // right-click on the text must reach the browser (not be preventDefault()ed)
  const r = el.getBoundingClientRect();
  const ctx = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: Math.round(r.left + 4),
    clientY: Math.round(r.top + 4),
  });
  el.dispatchEvent(ctx);
  out.ctxPrevented = ctx.defaultPrevented;

  // and no copy/cut/selectstart trap anywhere up the tree
  const copyEv = new Event("copy", { bubbles: true, cancelable: true });
  el.dispatchEvent(copyEv);
  out.copyPrevented = copyEv.defaultPrevented;
  const selStart = new Event("selectstart", { bubbles: true, cancelable: true });
  el.dispatchEvent(selStart);
  out.selectStartPrevented = selStart.defaultPrevented;

  // custom desktop menu must not have opened over page text
  out.osMenuOpen = !!document.querySelector(".os-ctx");
  return out;
};

async function copySuite(browser) {
  console.log(`\ncopy / selection \u2014 ${ROUTES.length} routes \u00d7 ${MODES.length} modes`);
  for (const mode of MODES) {
    console.log(`\n [mode: ${mode}]`);
    for (const route of ROUTES) {
      const page = await browser.newPage();
      await withMode(page, mode);
      try {
        await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 45000 });
        // give framer-motion / AOS reveals a beat so text is actually painted
        await new Promise((r) => setTimeout(r, 900));
        const r = await page.evaluate(probe);
        const tag = `${mode}${route}`;

        if (r.error) {
          bad(`${tag} probe`, r.error);
        } else {
          check(r.bodySelect !== "none", `${tag} body selectable`, `user-select: ${r.bodySelect}`);
          check(r.elSelect !== "none", `${tag} text selectable`, `user-select: ${r.elSelect}`);
          check(r.selectedChars > 0, `${tag} selection non-empty`, `${r.selectedChars} chars`);
          check(!r.ctxPrevented, `${tag} right-click reaches browser`, "contextmenu was preventDefault()ed");
          check(!r.copyPrevented, `${tag} copy event not trapped`);
          check(!r.selectStartPrevented, `${tag} selectstart not trapped`);
          check(!r.osMenuOpen, `${tag} no desktop menu over text`);
        }
      } catch (e) {
        bad(`${mode}${route} load`, e.message);
      } finally {
        await page.close();
      }
    }
  }
}

// The real thing: select text with the mouse, press Ctrl+C, read the OS
// clipboard back. Proves the whole chain, not just that no event was blocked.
async function clipboardSuite(browser) {
  console.log("\nreal clipboard (Ctrl+C \u2192 navigator.clipboard.readText)");
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(BASE, ["clipboard-read", "clipboard-write"]);
  const page = await browser.newPage();
  await withMode(page, "recruiter");
  try {
    await page.goto(BASE + "/resume", { waitUntil: "networkidle2", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 900));

    const expected = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("p, h1, h2, li")).find(
        (e) => e.offsetParent !== null && (e.innerText || "").trim().length > 25
      );
      if (!el) return null;
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return String(sel).trim();
    });

    if (!expected) {
      bad("clipboard", "no text to select");
      return;
    }
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyC");
    await page.keyboard.up("Control");
    await new Promise((r) => setTimeout(r, 300));

    const got = await page.evaluate(() => navigator.clipboard.readText());
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    check(
      norm(got).length > 0 && norm(got).startsWith(norm(expected).slice(0, 20)),
      "Ctrl+C copies the selection to the clipboard",
      `clipboard="${norm(got).slice(0, 40)}" expected~"${norm(expected).slice(0, 40)}"`
    );
  } catch (e) {
    bad("clipboard", e.message);
  } finally {
    await page.close();
  }
}

// The desktop right-click menu must still work where it belongs: on the empty
// backdrop, in dev mode, with nothing selected.
async function desktopMenuSuite(browser) {
  console.log("\ndesktop context menu still works on the backdrop (dev mode)");
  const page = await browser.newPage();
  await withMode(page, "dev");
  try {
    await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1200));
    const r = await page.evaluate(() => {
      window.getSelection().removeAllRanges();
      const ev = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 12,
        clientY: 400,
      });
      document.body.dispatchEvent(ev);
      return { prevented: ev.defaultPrevented };
    });
    await new Promise((r) => setTimeout(r, 250));
    const menu = await page.$(".os-ctx");
    check(r.prevented && !!menu, "backdrop right-click opens the desktop menu");
  } catch (e) {
    bad("desktop menu", e.message);
  } finally {
    await page.close();
  }
}

/* ---------------- metrics suite ---------------- */

// lib/metrics.json is refreshed by a nightly cron. These assertions are what
// stops a number being hardcoded somewhere and quietly drifting away from it
// again — which is exactly how "167 stars / 1,000+ downloads" got stale while
// the real figures were 191 and 3,671.
async function metricsSuite(browser) {
  console.log("\nlive metrics are actually rendered (no hardcoded copies)");
  const metrics = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "lib", "metrics.json"), "utf8")
  );
  const stars = String(metrics.github.stars);
  const repos = String(metrics.github.repos);
  const claim = metrics.npm.claim.toLocaleString("en-US");

  // Anything that was a stale literal before. If one of these reappears in the
  // rendered HTML, someone has hardcoded a number again.
  const STALE = ["1,000+ npm", "across 69 repos", "167 GitHub", "167★"];

  for (const route of ["/", "/about"]) {
    const page = await browser.newPage();
    await withMode(page, "recruiter");
    try {
      await page.goto(BASE + route, { waitUntil: "networkidle2", timeout: 45000 });
      await new Promise((r) => setTimeout(r, 900));
      const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

      for (const s of STALE)
        check(!text.includes(s), `${route} has no stale literal ${JSON.stringify(s)}`);

      if (route === "/") {
        check(text.includes(`across ${repos} repos`), `/ shows live repo count (${repos})`);
        check(text.includes(stars), `/ shows live star count (${stars})`);
      }
      check(
        text.includes(`${claim}+ npm downloads`),
        `${route} shows live npm claim (${claim}+)`,
        text.match(/[\d,]+\+ npm downloads/)?.[0] || "not found"
      );
    } catch (e) {
      bad(`${route} metrics`, e.message);
    } finally {
      await page.close();
    }
  }
}

/* ---------------- short links suite ---------------- */

async function linksSuite(browser) {
  console.log("\nshort links");
  const page = await browser.newPage();
  await withMode(page, "recruiter");
  try {
    await page.goto(`${BASE}/l/__definitely-not-a-slug__`, {
      waitUntil: "networkidle2",
      timeout: 45000,
    });
    await new Promise((r) => setTimeout(r, 1500));
    const text = await page.evaluate(() => document.body.innerText);
    check(/Link not found/i.test(text), "unknown slug shows a not-found page");
    check(
      page.url().includes("/l/__definitely-not-a-slug__"),
      "unknown slug does not redirect anywhere",
      page.url()
    );
    const robots = await page.evaluate(
      () => document.querySelector('meta[name="robots"]')?.content || ""
    );
    check(/noindex/.test(robots), "short-link page is noindex", robots);
  } catch (e) {
    bad("short links", e.message);
  } finally {
    await page.close();
  }
}

/* ---------------- resume variants suite ---------------- */

// /resume?v=<id> serves a different cut of the CV. An unknown variant must
// fall back to the default rather than breaking the page or the download.
async function variantSuite(browser) {
  console.log("\nresume variants");
  for (const [q, label] of [["", "no variant"], ["?v=ai", "?v=ai"], ["?v=__nope__", "unknown variant"]]) {
    const page = await browser.newPage();
    await withMode(page, "recruiter");
    try {
      await page.goto(`${BASE}/resume${q}`, { waitUntil: "networkidle2", timeout: 45000 });
      await new Promise((r) => setTimeout(r, 900));
      const info = await page.evaluate(() => {
        const a = document.querySelector("a[download]");
        return {
          href: a ? a.getAttribute("href") : null,
          download: a ? a.getAttribute("download") : null,
          text: document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
        };
      });
      check(!!info.href, `${label}: download link renders`, JSON.stringify(info.href));
      check(!!info.download, `${label}: download attribute present`);
      check(
        !/edition\./.test(info.text) || q === "?v=ai",
        `${label}: no bogus variant label`,
        info.text.slice(0, 80)
      );
    } catch (e) {
      bad(`resume ${label}`, e.message);
    } finally {
      await page.close();
    }
  }
}

/* ---------------- vault auth suite ---------------- */

// /api/vault/sign hands out credentials to a private bucket, so every way of
// reaching it WITHOUT a genuine Firebase token must fail. No browser needed.
async function vaultAuthSuite() {
  console.log("\nvault signing endpoint rejects everything unauthorized");
  const url = `${BASE}/api/vault/sign`;
  const post = async (headers, body) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  const payload = { op: "put", key: "vault/other/x.pdf" };

  try {
    const wrongMethod = await fetch(url).then((r) => r.status);
    check(wrongMethod === 405, "GET is rejected", `HTTP ${wrongMethod}`);

    const none = await post({}, payload);
    check(none.status === 401, "no token → 401", `HTTP ${none.status}`);

    const junk = await post({ Authorization: "Bearer not.a.jwt" }, payload);
    check(junk.status === 401, "malformed token → 401", `HTTP ${junk.status}`);

    // A structurally perfect, correctly-claimed token signed with an attacker's
    // own key. This is the test that matters: it only fails if the signature is
    // actually verified against Google's published certificates.
    const jwt = require("jsonwebtoken");
    const { generateKeyPairSync } = require("crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const forged = jwt.sign(
      {
        email: "ravikishan63392@gmail.com",
        email_verified: true,
        sub: "forged",
      },
      privateKey,
      {
        algorithm: "RS256",
        keyid: "whatever",
        audience: "myportifilio-3ab5f",
        issuer: "https://securetoken.google.com/myportifilio-3ab5f",
        expiresIn: "1h",
      }
    );
    const f = await post({ Authorization: `Bearer ${forged}` }, payload);
    check(
      f.status === 401,
      "self-signed token with correct claims → 401",
      `HTTP ${f.status} ${JSON.stringify(f.json)}`
    );

    // alg:none downgrade
    const noneAlg =
      Buffer.from(JSON.stringify({ alg: "none", typ: "JWT", kid: "x" })).toString("base64url") +
      "." +
      Buffer.from(
        JSON.stringify({
          email: "ravikishan63392@gmail.com",
          email_verified: true,
          aud: "myportifilio-3ab5f",
          iss: "https://securetoken.google.com/myportifilio-3ab5f",
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString("base64url") +
      ".";
    const n = await post({ Authorization: `Bearer ${noneAlg}` }, payload);
    check(n.status === 401, "alg:none token → 401", `HTTP ${n.status}`);
  } catch (e) {
    bad("vault auth", e.message);
  }
}

/* ---------------- resume suite ---------------- */

async function resumeSuite() {
  const pdf =
    process.env.RESUME_PDF ||
    path.resolve(__dirname, "..", "..", "resume", "Resume 11 June.pdf");
  if (!fs.existsSync(pdf)) {
    bad("resume", `PDF not found at ${pdf}`);
    return;
  }

  const profile = path.resolve(__dirname, "..", ".e2e-chrome-profile");
  const browser = await launch({ headful: true, userDataDir: profile });
  const page = await browser.newPage();
  try {
    console.log("\nresume upload \u2192 storage \u2192 live site");
    await page.goto(BASE + "/admin", { waitUntil: "networkidle2", timeout: 45000 });

    const dropSel = ".rm-drop input[type=file]";
    if (!(await page.$(dropSel))) {
      console.log(
        "\n  \u26a0  Not signed in. Sign in as the admin in the Chrome window that just\n" +
          "     opened (this profile is remembered, so it is a one-time step).\n" +
          "     Waiting up to 5 minutes\u2026\n"
      );
      await page.waitForSelector(dropSel, { timeout: 300000 });
    }
    ok("admin reachable and Résumé panel rendered");

    const before = await page.$eval(".rm-live .rm-url", (e) => e.textContent.trim());
    console.log(`     live url before: ${before}`);

    const input = await page.$(dropSel);
    await input.uploadFile(pdf);

    // either the success line or the error box will appear
    await page.waitForFunction(
      () => document.querySelector(".rm-ok") || document.querySelector(".admin-err"),
      { timeout: 120000 }
    );
    const err = await page.$(".admin-err");
    if (err) {
      const text = await page.evaluate((e) => e.textContent.trim(), err);
      bad("upload", text);
      return;
    }
    const okMsg = await page.$eval(".rm-ok", (e) => e.textContent.trim());
    ok(`upload succeeded \u2014 ${okMsg}`);

    const after = await page.$eval(".rm-live .rm-url", (e) => e.textContent.trim());
    console.log(`     live url after:  ${after}`);
    check(after !== before, "live résumé url changed");
    check(!!(await page.$(".rm-versions .rm-v")), "version history lists the upload");

    // Two legal backends: a Cloud Storage object, or a Firestore document
    // holding the PDF as base64. Assert whichever one actually got used.
    const firestoreBacked = after.startsWith("firestore:");
    if (firestoreBacked) {
      ok("stored as a Firestore document (no Cloud Storage on this plan)");
      check(
        /^firestore: resumeFiles\/.+\.pdf$/.test(after),
        "points at a resumeFiles document",
        after
      );
    } else {
      check(
        /firebasestorage\.googleapis\.com|storage\.googleapis\.com/.test(after),
        "live url points at Cloud Storage",
        after
      );
      const head = await page.evaluate(async (u) => {
        const r = await fetch(u);
        return { status: r.status, type: r.headers.get("content-type") };
      }, after);
      check(head.status === 200, "uploaded PDF is publicly readable", `HTTP ${head.status}`);
      check(/pdf/i.test(head.type || ""), "served as application/pdf", head.type);
    }

    // and the public page now serves it \u2014 fresh tab, no admin state.
    // Firestore-backed r\u00e9sum\u00e9s resolve to a blob: URL built in the browser;
    // Storage-backed ones keep the download URL verbatim.
    const pub = await browser.newPage();
    await withMode(pub, "recruiter");
    await pub.goto(BASE + "/resume", { waitUntil: "networkidle2", timeout: 45000 });
    try {
      await pub.waitForFunction(
        (u, isBlob) => {
          const a = document.querySelector('a[download]');
          if (!a) return false;
          return isBlob ? a.href.startsWith("blob:") : a.getAttribute("href") === u;
        },
        { timeout: 20000 },
        after,
        firestoreBacked
      );
      ok(
        firestoreBacked
          ? "/resume resolves the PDF to a same-origin blob: URL (download works)"
          : "/resume links to the newly uploaded PDF"
      );

      // the bytes really survived the base64 round-trip
      if (firestoreBacked) {
        const info = await pub.evaluate(async () => {
          const a = document.querySelector("a[download]");
          const r = await fetch(a.href);
          const b = await r.blob();
          const head = new Uint8Array(await b.slice(0, 5).arrayBuffer());
          return { size: b.size, magic: String.fromCharCode(...head) };
        });
        check(info.magic === "%PDF-", "blob is a real PDF", `magic=${info.magic}`);
        check(
          info.size === fs.statSync(pdf).size,
          "blob byte length matches the source file",
          `${info.size} vs ${fs.statSync(pdf).size}`
        );
      }
    } catch (e) {
      bad("/resume serves the new PDF", e.message);
    }
    await pub.close();
  } catch (e) {
    bad("resume suite", e.message);
  } finally {
    await browser.close();
  }
}

/* ---------------- runner ---------------- */

(async () => {
  const which = process.argv[2] || "all";
  console.log(`base: ${BASE}\nchrome: ${CHROME}`);

  if (which === "vault" || which === "all") {
    await vaultAuthSuite();
  }
  if (which === "metrics" || which === "all") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await metricsSuite(browser);
      await linksSuite(browser);
      await variantSuite(browser);
    } finally {
      await browser.close();
    }
  }
  if (which === "copy" || which === "all") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await copySuite(browser);
      await clipboardSuite(browser);
      await desktopMenuSuite(browser);
    } finally {
      await browser.close();
    }
  }
  if (which === "resume" || which === "all") {
    await resumeSuite();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log("\nfailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  process.exit(fail ? 1 : 0);
})();
