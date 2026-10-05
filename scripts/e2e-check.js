/* End-to-end checks driven through your installed Chrome (puppeteer-core — no
 * bundled Chromium download).
 *
 *   node scripts/e2e-check.js copy     # fully automated, headless
 *   node scripts/e2e-check.js blog     # blog surfaces link nowhere off-site
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
// Wait for the page to actually have readable text, rather than sleeping and
// hoping. Every route here paints its content from Firestore through
// useSiteContent, and non-blog routes run a Loader overlay first, so "how long
// until there is something to select" is not a constant. A fixed 900ms budget
// was measured being blown by 8.7x — 7877ms on one throttled run of /projects,
// while two sibling runs finished in 91ms and 166ms. That is the shape of a
// flake: the suite failed with "no visible text block found" on a page that
// was perfectly fine, just late.
//
// A page that genuinely never renders text still fails, because the wait has
// its own timeout and the caller reports it.
async function waitForText(page, minChars = 25, timeout = 20000) {
  try {
    await page.waitForFunction(
      (min) => {
        const vis = (el) => el.offsetParent !== null && el.getClientRects().length > 0;
        return Array.from(document.querySelectorAll("p,h1,h2,h3,li,span,td,a")).some(
          (el) => vis(el) && (el.innerText || "").trim().length > min
        );
      },
      { timeout, polling: 100 },
      minChars
    );
    // A short settle beat AFTER the condition, for reveal animations that are
    // mid-flight. This one is allowed to be arbitrary: nothing depends on it.
    await new Promise((r) => setTimeout(r, 250));
    return true;
  } catch (_) {
    return false;
  }
}

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
        const tag = `${mode}${route}`;
        if (!(await waitForText(page))) {
          bad(`${tag} probe`, "no visible text block appeared within 20s");
          continue; // the finally below still closes the page
        }
        const r = await page.evaluate(probe);

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
    if (!(await waitForText(page))) {
      bad("clipboard", "no visible text block appeared within 20s");
      return;
    }

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

/* ---------------- blog locality suite ---------------- */

// The writing on this site is the site's own copy and it opens here. dev.to
// and Medium were once read at request time and every card was a target=_blank
// link straight off the domain — a reader who clicked a piece of writing left.
// This suite is the guard: no blog surface may render an outbound link, and
// the RSS feed may only advertise URLs this site actually serves.
const OFFSITE = /dev\.to|medium\.com|hashnode|substack/i;

async function blogSuite(browser) {
  console.log("\nblog stays on the site");
  const page = await browser.newPage();
  await withMode(page, "recruiter");
  try {
    await page.goto(`${BASE}/blog`, { waitUntil: "networkidle2", timeout: 45000 });
    // the library is read client-side from Firestore
    await new Promise((r) => setTimeout(r, 2500));

    const index = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("main a, article a"));
      // Only the writing list itself. The footer's GitHub and LinkedIn links
      // are supposed to leave — an article is not.
      const entries = links.filter((a) => a.matches(".wr-lead, .wr-row"));
      return {
        hrefs: links.map((a) => a.getAttribute("href") || ""),
        entries: entries.length,
        blank: entries.filter((a) => a.target === "_blank").map((a) => a.href),
        external: entries
          .map((a) => a.href)
          .filter((h) => h && new URL(h).origin !== location.origin),
        posts: links
          .map((a) => a.getAttribute("href") || "")
          .filter((h) => /^\/blog\/[^/]+$/.test(h)),
        text: document.body.innerText.replace(/\s+/g, " "),
      };
    });

    const offsite = index.hrefs.filter((h) => OFFSITE.test(h));
    check(offsite.length === 0, "/blog renders no dev.to or Medium link", offsite.join(", "));
    check(
      index.blank.length === 0,
      "no writing entry opens in a new tab",
      index.blank.join(", ")
    );
    check(
      index.external.length === 0,
      "every writing entry is same-origin",
      index.external.join(", ")
    );
    check(
      index.posts.length > 0 || /Nothing published yet/i.test(index.text),
      "/blog lists local posts, or says plainly that there are none",
      index.text.slice(0, 120)
    );

    // Follow the first piece and make sure reading it keeps you here.
    if (index.posts.length) {
      const slug = index.posts[0];
      await page.goto(`${BASE}${slug}`, { waitUntil: "networkidle2", timeout: 45000 });
      await new Promise((r) => setTimeout(r, 1800));
      const post = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("main a, header a"));
        return {
          url: location.pathname,
          h1: document.querySelector("h1")?.innerText || "",
          offsite: links
            .map((a) => a.getAttribute("href") || "")
            .filter((h) => /dev\.to|medium\.com/i.test(h)),
          canonical:
            document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "",
        };
      });
      check(post.url === slug, `${slug} does not redirect`, post.url);
      check(!!post.h1, `${slug} renders its title`);
      check(
        post.offsite.length === 0,
        `${slug} has no outbound dev.to link in the chrome`,
        post.offsite.join(", ")
      );
      // The canonical tag MAY point at dev.to for an imported article — that
      // is metadata telling a crawler who published first, not navigation.
      check(
        post.canonical === "" || /^https?:/.test(post.canonical),
        "canonical, if set, is an absolute URL",
        post.canonical
      );
    }

    // The feed is the one blog surface a reader never sees, which is exactly
    // why a dead link in it goes unnoticed.
    const feed = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/feed.xml`);
      return { status: r.status, xml: await r.text() };
    }, BASE);
    check(feed.status === 200, "/feed.xml responds", String(feed.status));
    const feedLinks = Array.from(feed.xml.matchAll(/<link>([^<]+)<\/link>/g)).map((m) => m[1]);
    check(
      feedLinks.every((u) => !OFFSITE.test(u)),
      "/feed.xml advertises no off-site article",
      feedLinks.filter((u) => OFFSITE.test(u)).join(", ")
    );
    check(
      feedLinks.every((u) => /\/blog(\/|$)/.test(u)),
      "every feed link is a /blog URL on this site",
      feedLinks.filter((u) => !/\/blog(\/|$)/.test(u)).join(", ")
    );
  } catch (e) {
    bad("blog locality", e.message);
  } finally {
    await page.close();
  }
}

/* ---------------- blog deep links and scroll ---------------- */

// Two things a reader notices immediately and neither of which anything
// asserted before:
//
//   1. Opening a shared /blog/<slug> link while the desktop is on used to show
//      a bare desktop with ZERO windows, the article rendered invisibly
//      underneath. The link looked broken.
//   2. Clicking "Previous" at the foot of a long article landed 3,199px into
//      the next one, because the page height changes twice after the route
//      does and the browser restores the old scroll.
async function blogNavigationSuite(browser) {
  console.log("\nblog links land where they should");

  // --- a post URL in desktop mode opens the app, on that post ---
  {
    const page = await browser.newPage();
    await withMode(page, "dev");
    try {
      const feed = await fetch(`${BASE}/feed.xml`).then((r) => r.text());
      const link = (/<item>[\s\S]*?<link>([^<]+)<\/link>/.exec(feed) || [])[1] || "";
      const slug = link.split("/blog/")[1];
      check(!!slug, "found a published post to open", slug);

      await page.goto(`${BASE}/blog/${slug}`, { waitUntil: "networkidle2", timeout: 45000 });
      let opened = true;
      try {
        await page.waitForFunction(
          () => document.querySelectorAll(".os-win .blga").length > 0,
          { timeout: 30000, polling: 200 }
        );
      } catch (_) {
        opened = false;
      }
      check(opened, "a post link opens the Blog app in a window");

      const state = await page.evaluate(() => ({
        windows: document.querySelectorAll(".os-win").length,
        reader: !!document.querySelector(".os-win .blga-reader"),
        title: document.querySelector(".os-win .blga-reader h1")?.innerText || "",
        path: location.pathname,
      }));
      check(state.reader, "and lands on the article, not the library");
      check(!!state.title, "with the post's title", state.title.slice(0, 50));
      // The URL still works for everyone without the desktop, and for crawlers.
      check(state.path === `/blog/${slug}`, "while the URL stays shareable", state.path);

      // The Blog window is a singleton, so a second link must re-point it
      // rather than pile up windows.
      const other = (feed.match(/<link>[^<]*\/blog\/([^<]+)<\/link>/g) || [])
        .map((m) => m.replace(/.*\/blog\//, "").replace("</link>", ""))
        .find((x) => x !== slug);
      if (other) {
        await page.goto(`${BASE}/blog/${other}`, { waitUntil: "networkidle2", timeout: 45000 });
        await new Promise((r) => setTimeout(r, 3500));
        const after = await page.evaluate(() => ({
          windows: document.querySelectorAll(".os-win").length,
          title: document.querySelector(".os-win .blga-reader h1")?.innerText || "",
        }));
        check(after.windows === 1, "a second post link reuses the one window", String(after.windows));
        check(!!after.title, "and shows the second post", after.title.slice(0, 50));
      }

      // /blog itself opens the library rather than a reader.
      await page.goto(`${BASE}/blog`, { waitUntil: "networkidle2", timeout: 45000 });
      await new Promise((r) => setTimeout(r, 3500));
      const lib = await page.evaluate(() => ({
        app: !!document.querySelector(".os-win .blga"),
        cards: document.querySelectorAll(".os-win .blga-card").length,
      }));
      check(lib.app, "/blog in desktop mode opens the Blog app");
      check(lib.cards > 0, "showing the library", String(lib.cards));
    } catch (e) {
      bad("desktop blog deep link", e.message);
    } finally {
      await page.close();
    }
  }

  // --- post to post, on the routed site, starts at the top ---
  {
    const page = await browser.newPage();
    await withMode(page, "recruiter");
    try {
      const feed = await fetch(`${BASE}/feed.xml`).then((r) => r.text());
      const slug = ((/<item>[\s\S]*?<link>([^<]+)<\/link>/.exec(feed) || [])[1] || "").split("/blog/")[1];
      await page.goto(`${BASE}/blog/${slug}`, { waitUntil: "networkidle2", timeout: 45000 });
      await page.waitForSelector(".post-nav-link", { timeout: 30000 });
      await new Promise((r) => setTimeout(r, 2500));

      await page.evaluate(() => window.scrollTo(0, 12000));
      await new Promise((r) => setTimeout(r, 900));
      const from = await page.evaluate(() => window.scrollY);
      check(from > 2000, "the reader is deep into the article", String(from));

      const href = await page.evaluate(() => {
        const a = document.querySelector(".post-nav-link");
        const h = a.getAttribute("href");
        a.click();
        return h;
      });
      let moved = true;
      try {
        await page.waitForFunction((w) => location.pathname === w, { timeout: 25000, polling: 100 }, href);
      } catch (_) {
        moved = false;
      }
      check(moved, "the next article opens", href);
      if (moved) {
        // The regression is the page SETTLING back, so give it time to.
        await new Promise((r) => setTimeout(r, 4000));
        const landed = await page.evaluate(() => window.scrollY);
        check(landed < 80, "and starts at the top of it", `scrollY ${landed}, came from ${from}`);
      }
    } catch (e) {
      bad("post to post scroll", e.message);
    } finally {
      await page.close();
    }
  }
}

/* ---------------- rich article content suite ---------------- */

// Maths, diagrams and sketches, rendered through the real PostView on
// /__blogpreview. These fail silently by nature — a diagram that does not draw
// leaves a quiet block of source, and nothing reaches the console — so they
// need asserting rather than eyeballing.
async function richContentSuite(browser) {
  console.log("\nmaths, diagrams and sketches");
  const page = await browser.newPage();
  // Rendering measurements need the foreground.
  await page.bringToFront();
  await withMode(page, "recruiter");
  try {
    await page.goto(`${BASE}/__blogpreview`, { waitUntil: "networkidle2", timeout: 60000 });
    // mermaid and KaTeX arrive by dynamic import, so wait for the result
    // rather than for a fixed number of seconds.
    let ready = true;
    try {
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".pb-math.is-rendered").length > 0 &&
          document.querySelectorAll(".pb-mermaid svg").length > 0 &&
          document.querySelectorAll("iframe.pb-frame").length > 0,
        { timeout: 30000, polling: 200 }
      );
    } catch (_) {
      ready = false;
    }
    check(ready, "maths, a diagram and the sketch frames all appear within 30s");

    const r = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll("iframe.pb-frame"));
      return {
        math: document.querySelectorAll(".pb-math").length,
        mathRendered: document.querySelectorAll(".pb-math.is-rendered").length,
        katex: document.querySelectorAll(".katex").length,
        mathml: document.querySelectorAll(".katex-mathml").length,
        mermaidSvg: document.querySelectorAll(".pb-mermaid svg").length,
        mermaidError: document.querySelectorAll(".pb-mermaid.is-error").length,
        frames: frames.length,
        sandboxes: frames.map((f) => f.getAttribute("sandbox")),
        sources: document.querySelectorAll(".pb-src-toggle").length,
        leftoverSrc: document.querySelectorAll(".pb-mermaid .pb-src").length,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      };
    });

    check(r.mathRendered === r.math && r.math > 0, "every expression is typeset", `${r.mathRendered}/${r.math}`);
    // KaTeX renders a visual copy AND a MathML copy; the MathML is what a
    // screen reader actually reads, and forcing output:"html" removes it.
    check(r.mathml > 0, "maths keeps its MathML layer for screen readers", String(r.mathml));
    check(r.mermaidSvg > 0, "the mermaid diagram draws an SVG", String(r.mermaidSvg));
    check(r.mermaidError === 0, "and reports no parse error", String(r.mermaidError));
    check(r.leftoverSrc === 0, "the diagram's source is replaced, not left beside it");

    check(r.frames === 2, "both sketches get a frame", String(r.frames));
    // No allow-same-origin: the frame must not be able to reach this page's
    // DOM, cookies or Firebase session.
    check(
      r.sandboxes.every((v) => v === "allow-scripts"),
      "every sketch frame is sandboxed without same-origin access",
      JSON.stringify(r.sandboxes)
    );
    check(r.sources === 2, "and each keeps its source available to read");
    check(r.scrollW === r.clientW, "nothing overflows the page sideways", `${r.scrollW} vs ${r.clientW}`);

    // The sketches must actually RUN, not merely be framed.
    const drawn = [];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        drawn.push(
          await frame.evaluate(() => ({
            canvas: document.querySelectorAll("canvas").length,
            svg: document.querySelectorAll("svg").length,
            err: document.querySelector(".pb-frame-err")?.textContent || null,
          }))
        );
      } catch (_) {
        /* a frame that refuses evaluation is reported by the counts below */
      }
    }
    check(
      drawn.some((d) => d.canvas > 0),
      "the p5 sketch draws a canvas",
      JSON.stringify(drawn)
    );
    check(
      drawn.some((d) => d.svg > 0),
      "the d3 sketch draws an svg",
      JSON.stringify(drawn)
    );
    check(
      drawn.every((d) => !d.err),
      "and neither frame reports an error",
      JSON.stringify(drawn.map((d) => d.err).filter(Boolean))
    );

    // mermaid writes its colours into the SVG, so a theme change after render
    // would otherwise leave an unreadable diagram.
    const before = await page.evaluate(
      () => getComputedStyle(document.querySelector(".pb-mermaid svg rect")).fill
    );
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    let redrew = true;
    try {
      await page.waitForFunction(
        (was) => {
          const n = document.querySelector(".pb-mermaid svg rect");
          return n && getComputedStyle(n).fill !== was;
        },
        { timeout: 15000, polling: 200 },
        before
      );
    } catch (_) {
      redrew = false;
    }
    check(redrew, "the diagram redraws when the theme changes", `was ${before}`);
  } catch (e) {
    bad("rich content", e.message);
  } finally {
    await page.close();
  }
}

/* ---------------- tasks board suite ---------------- */

// The real panel needs a Google Tasks session, so the board could never be
// looked at — or asserted on — without signing in. /__taskspreview renders the
// SAME GroupColumn components against fixed data, which is what makes drag and
// drop testable at all.
async function tasksSuite(browser) {
  console.log("\ntasks board");
  const page = await browser.newPage();
  // Dragging needs real input and real layout, so it needs the foreground.
  await page.bringToFront();
  await withMode(page, "recruiter");
  try {
    // ?noload skips the word-cloud loader, which otherwise covers the page.
    await page.goto(`${BASE}/__taskspreview?noload`, { waitUntil: "networkidle2", timeout: 45000 });
    await page.waitForSelector(".tk-col", { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1200));

    const shape = await page.evaluate(() => ({
      columns: document.querySelectorAll(".tk-col").length,
      rows: document.querySelectorAll(".tk-row").length,
      subtasks: document.querySelectorAll(".tk-row.child").length,
      overdue: document.querySelectorAll(".tk-due.overdue").length,
      today: document.querySelectorAll(".tk-due.today").length,
      addInputs: document.querySelectorAll(".tk-add-title").length,
      newGroup: !!document.querySelector(".tk-newgroup"),
      selects: document.querySelectorAll(".tk-board select").length,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));

    // Every group visible at once was the point: the old panel showed one at a
    // time behind a <select>.
    check(shape.columns > 1, "every group is a column", String(shape.columns));
    check(shape.selects === 0, "and no group is hidden behind a dropdown");
    check(shape.addInputs === shape.columns, "each group can be added to directly", `${shape.addInputs}/${shape.columns}`);
    check(shape.newGroup, "a group can be created from the board");
    check(shape.subtasks > 0, "subtasks render nested under their parent");
    check(shape.overdue > 0 && shape.today > 0, "due dates are graded, not just printed",
      `overdue ${shape.overdue}, today ${shape.today}`);
    check(shape.scrollW === shape.clientW, "the board does not overflow the page", `${shape.scrollW} vs ${shape.clientW}`);

    // --- drag a task into another group ---
    const before = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".tk-col")).map((c) => c.querySelectorAll(".tk-row").length)
    );
    const pts = await page.evaluate(() => {
      const row = document.querySelector(".tk-col .tk-row");
      const target = document.querySelectorAll(".tk-col")[2] || document.querySelectorAll(".tk-col")[1];
      const a = row.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      return {
        from: { x: a.left + 40, y: a.top + 14 },
        to: { x: t.left + t.width / 2, y: t.top + 120 },
      };
    });
    await page.mouse.move(pts.from.x, pts.from.y);
    await page.mouse.down();
    await page.mouse.move(pts.to.x, pts.to.y, { steps: 18 });
    await new Promise((r) => setTimeout(r, 400));
    const lit = await page.evaluate(() => document.querySelectorAll(".tk-col.drop").length);
    check(lit === 1, "exactly one group lights up as the drop target", String(lit));
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 900));

    const after = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".tk-col")).map((c) => c.querySelectorAll(".tk-row").length)
    );
    check(after[0] === before[0] - 1, "the task leaves the group it was dragged from", `${before[0]} → ${after[0]}`);
    check(
      after.reduce((n, x) => n + x, 0) === before.reduce((n, x) => n + x, 0),
      "and nothing is lost on the way",
      `${JSON.stringify(before)} → ${JSON.stringify(after)}`
    );
    check(
      after.some((n, i) => i !== 0 && n > before[i]),
      "it arrives in the group it was dropped on",
      JSON.stringify(after)
    );

    // --- add a task without leaving the board ---
    await page.evaluate(() => {
      document.querySelectorAll(".tk-col")[1].querySelector(".tk-add-title").focus();
    });
    await page.keyboard.type("Written from the board");
    await new Promise((r) => setTimeout(r, 250));
    const expanded = await page.evaluate(
      () => !!document.querySelectorAll(".tk-col")[1].querySelector(".tk-add-notes")
    );
    check(expanded, "the add form opens its details field on focus");
    await page.evaluate(() =>
      document.querySelectorAll(".tk-col")[1].querySelector(".admin-primary.sm").click()
    );
    await new Promise((r) => setTimeout(r, 700));
    const added = await page.evaluate(() =>
      document.querySelectorAll(".tk-col")[1].innerText.includes("Written from the board")
    );
    check(added, "and the task appears in that group");

    // --- completing a task ---
    const check0 = await page.evaluate(() => {
      const row = document.querySelector(".tk-row:not(.done)");
      row.querySelector(".tk-check").click();
      return row.querySelector(".tk-title").innerText;
    });
    await new Promise((r) => setTimeout(r, 500));
    const done = await page.evaluate(
      (t) =>
        Array.from(document.querySelectorAll(".tk-row.done")).some((r) =>
          r.innerText.includes(t)
        ),
      check0
    );
    check(done, "ticking a task marks it complete", check0.slice(0, 40));
  } catch (e) {
    bad("tasks board", e.message);
  } finally {
    await page.close();
  }
}

/* ---------------- SEO suite ---------------- */

// Deliberately NO browser. Googlebot renders JavaScript eventually; LinkedIn,
// Slack, WhatsApp and X never do. What matters is the HTML that comes off the
// wire, so this suite reads it with plain fetch and asserts on the bytes.
//
// It exists because all of this failed silently: every post URL used to serve
// the HOMEPAGE's title, description and og:url, the sitemap listed eight
// static routes and not one of 29 posts, and /feed.xml had been emitting an
// empty channel because its Firestore query needed an index it never had.
async function seoSuite() {
  console.log("\nwhat a crawler and an unfurler actually receive");

  const get = async (path) => {
    const r = await fetch(BASE + path);
    return { status: r.status, html: await r.text() };
  };
  const meta = (html, prop) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)="${prop}"[^>]*content="([^"]*)"`,
      "i"
    );
    const alt = new RegExp(
      `<meta[^>]+content="([^"]*)"[^>]*(?:property|name)="${prop}"`,
      "i"
    );
    return (re.exec(html) || alt.exec(html) || [])[1] || "";
  };

  try {
    // Pick a real published post from the feed rather than hardcoding a slug.
    const feed = await get("/feed.xml");
    check(feed.status === 200, "/feed.xml responds", String(feed.status));
    const items = (feed.html.match(/<item>/g) || []).length;
    check(items > 0, "the feed is not empty", `${items} items`);

    const firstLink = (/<item>[\s\S]*?<link>([^<]+)<\/link>/.exec(feed.html) || [])[1] || "";
    const slug = firstLink.split("/blog/")[1];
    check(!!slug, "the feed links to a post", firstLink);
    if (!slug) return;

    const post = await get(`/blog/${slug}`);
    check(post.status === 200, "the post responds", String(post.status));

    const title = (/<title>([^<]*)<\/title>/.exec(post.html) || [])[1] || "";
    const ogTitle = meta(post.html, "og:title");
    const ogUrl = meta(post.html, "og:url");
    const ogType = meta(post.html, "og:type");
    const desc = meta(post.html, "description");

    // The symptom that started this: the homepage's metadata on every article.
    check(
      !/^Ravi Kishan — Software Engineer/.test(title),
      "the post does not serve the homepage title",
      title.slice(0, 70)
    );
    check(title.length > 20, "it has a title of its own", title.slice(0, 70));
    check(ogUrl.includes(`/blog/${slug}`), "og:url points at the post, not the homepage", ogUrl);
    check(ogType === "article", "og:type is article", ogType);
    check(ogTitle.length > 20 && !/^Ravi Kishan — Software/.test(ogTitle), "og:title is the post's", ogTitle.slice(0, 60));
    check(desc.length > 40, "it carries a real description", `${desc.length} chars`);

    // Article text in the HTML, not just in a JavaScript bundle.
    const textish = post.html.replace(/<script[\s\S]*?<\/script>/g, "");
    check(textish.length > 8000, "the article body is in the served HTML", `${textish.length} chars`);

    check(/"@type":"Article"/.test(post.html), "Article structured data is present");
    check(/"@type":"BreadcrumbList"/.test(post.html), "with breadcrumbs");
    check(/article:published_time/.test(post.html), "and a published time");

    const canonical = (/<link rel="canonical" href="([^"]*)"/.exec(post.html) || [])[1] || "";
    check(!!canonical, "a canonical is declared", canonical.slice(0, 70));

    // The archive must be crawlable as links, not as an empty shell.
    const index = await get("/blog");
    const links = new Set((index.html.match(/href="\/blog\/[a-z0-9-]+"/g) || []));
    check(links.size > 1, "the archive lists posts as real links in the HTML", `${links.size} links`);

    // A sitemap is an invitation to crawl; the admin must not be in it.
    const sm = await get("/sitemap-0.xml");
    if (sm.status === 200) {
      const posts = (sm.html.match(/<loc>[^<]*\/blog\/[^<]*<\/loc>/g) || []).length;
      check(posts > 1, "the sitemap lists the posts", `${posts} post URLs`);
      check(
        !/<loc>[^<]*\/(admin|oauth)/.test(sm.html),
        "and does not advertise the admin or the OAuth consent page"
      );
    } else {
      console.log("  · sitemap not generated in this environment, skipped");
    }

    const robots = await get("/robots.txt");
    if (robots.status === 200) {
      check(/Disallow: \/admin/.test(robots.html), "robots.txt keeps crawlers out of the admin");
      check(/Sitemap:/.test(robots.html), "and points at the sitemap");
    }
  } catch (e) {
    bad("seo", e.message);
  }
}

/* ---------------- cross-post export suite ---------------- */

// dev.to renders none of this site's diagrams or sketches, so each one is
// rendered to a file at cross-post time. Every failure mode here is silent:
// a tainted canvas throws where nobody is looking, an off-screen frame records
// a 0-byte video, and a canvas captured too early encodes a perfectly valid
// image of nothing at all. /__exportcheck renders without uploading or
// publishing, and reports the weight and the ink of what it produced.
async function exportSuite(browser) {
  console.log("\nrendering blocks for cross-posting");
  const page = await browser.newPage();
  // Recording a canvas needs real animation frames, which a background tab
  // does not get: this recorded 110 bytes of video until the page was
  // brought forward.
  await page.bringToFront();
  await withMode(page, "recruiter");
  try {
    await page.goto(`${BASE}/__exportcheck`, { waitUntil: "networkidle2", timeout: 60000 });

    let finished = true;
    try {
      await page.waitForFunction(
        () => document.querySelector("#export-done")?.dataset.done === "1",
        { timeout: 120000, polling: 400 }
      );
    } catch (_) {
      finished = false;
    }
    check(finished, "every block finishes rendering");

    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#export-rows li")).map((li) => ({
        kind: li.dataset.kind,
        ok: li.dataset.ok === "1",
        bytes: Number(li.dataset.bytes),
        ink: Number(li.dataset.ink),
        video: Number(li.dataset.videoBytes),
      }))
    );
    check(rows.length === 3, "all three kinds are attempted", String(rows.length));

    for (const kind of ["mermaid", "d3", "p5"]) {
      const r = rows.find((x) => x.kind === kind);
      if (!r) {
        bad(`${kind} export`, "no row");
        continue;
      }
      check(r.bytes > 500, `${kind} produces a real file`, `${r.bytes} bytes`);
      // The one that catches a blank canvas: a valid WebP of nothing.
      check(r.ink > 0.002, `${kind} actually drew something`, `${(r.ink * 100).toFixed(2)}% ink`);
    }

    // p5 animates, so it also records. An off-screen frame gets no
    // requestAnimationFrame ticks and silently records nothing.
    const p5row = rows.find((x) => x.kind === "p5");
    check(p5row && p5row.video > 2000, "the p5 sketch also records a video", `${p5row?.video} bytes`);

    const md = await page.evaluate(
      () => document.querySelector("#export-markdown")?.textContent || ""
    );
    check(md.includes("{% katex inline %}"), "maths travels as dev.to's own katex tag");
    check(md.includes("{% katex %}"), "including display maths");
    check(!/```(mermaid|p5|d3)/.test(md), "no un-renderable fence is shipped to dev.to");
    check((md.match(/!\[/g) || []).length === 3, "each block travels as an image", String((md.match(/!\[/g) || []).length));
    check(!/\]\([^)]*\.webm\)/.test(md.replace(/\[watch it run\]\([^)]*\)/g, "")), "a video is never embedded as an image");
    check(md.includes("[watch it run]"), "the recording is offered as a link beside the still");
    check(!/localhost|127\.0\.0\.1/.test(md), "and every URL is the canonical host, not localhost");
  } catch (e) {
    bad("cross-post export", e.message);
  } finally {
    await page.close();
  }
}

/* ---------------- archive search suite ---------------- */

// Full-text search over every published post. The point of the index is that
// it reaches words that appear ONLY in a body — a title-and-excerpt filter
// would return nothing for these.
async function searchSuite(browser) {
  console.log("\nsearching the archive");
  const page = await browser.newPage();
  await withMode(page, "recruiter");
  try {
    await page.goto(`${BASE}/blog`, { waitUntil: "networkidle2", timeout: 45000 });
    await page.waitForFunction(() => document.querySelectorAll(".wr-row, .wr-lead").length > 0, {
      timeout: 30000,
      polling: 200,
    });
    const all = await page.evaluate(() => document.querySelectorAll(".wr-row, .wr-lead").length);
    check(all > 0, "the archive lists posts", String(all));

    const search = async (q) => {
      await page.evaluate(() => {
        const i = document.querySelector(".wr-search input");
        i.value = "";
        i.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.type(".wr-search input", q, { delay: 5 });
      await page.waitForFunction(
        (term) => {
          const el = document.querySelector(".wr-count");
          return el && el.textContent.includes(term) && !el.textContent.includes("Searching");
        },
        { timeout: 20000, polling: 150 },
        q
      );
      return page.evaluate(() => ({
        rows: document.querySelectorAll(".wr-row, .wr-lead").length,
        count: document.querySelector(".wr-count")?.textContent || "",
      }));
    };

    // "cgroups" lives in a post body, not in any title, excerpt or tag.
    const body = await search("cgroups");
    check(body.rows > 0, "a word that appears only in a body is found", JSON.stringify(body));
    check(body.rows < all, "and the archive is actually narrowed", `${body.rows} of ${all}`);

    const none = await search("zzzznothinghere");
    check(none.rows === 0, "a term in nothing matches nothing", JSON.stringify(none));
    const empty = await page.evaluate(
      () => document.querySelector(".wr-empty")?.textContent || ""
    );
    check(/Nothing in the archive mentions/.test(empty), "and says so in the archive's own words", empty.slice(0, 60));
  } catch (e) {
    bad("archive search", e.message);
  } finally {
    await page.close();
  }
}

/* ---------------- desktop Blog app suite ---------------- */

// DesktopOS is rendered from _app.js on EVERY route, so in dev mode it is a
// full-screen overlay that survives a client-side navigation. A routed <Link>
// inside a desktop window therefore "works" — the URL changes and the article
// renders — while the reader sees nothing happen, because the desktop is still
// painted on top of it. Every other desktop app keeps its detail view inside
// its own window; the Blog app must too.
async function desktopBlogSuite(browser) {
  console.log("\ndesktop Blog app opens a post in its window");
  const page = await browser.newPage();
  // A puppeteer page is a BACKGROUND tab unless brought forward, and a
  // background tab gets throttled rAF and deprioritised rendering — which is
  // why this reported an empty library alongside the other suites but passed
  // alone.
  await page.bringToFront();
  await withMode(page, "dev");
  try {
    await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 3500));

    const launched = await page.evaluate(() => {
      document.querySelector('[aria-label*="All apps"]')?.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 1000));
    const opened = await page.evaluate(() => {
      const app = Array.from(document.querySelectorAll(".os-lp-app")).find((a) =>
        /blog/i.test(a.textContent)
      );
      if (app) app.click();
      return !!app;
    });
    check(launched && opened, "the Blog app launches from the launchpad");
    // The library is fetched from Firestore, so wait for the result rather
    // than for a fixed four seconds — under load that sleep expired first and
    // reported an empty library on a window that was simply still loading.
    try {
      await page.waitForFunction(
        () => document.querySelectorAll(".os-win .blga-card").length > 0,
        { timeout: 30000, polling: 200 }
      );
    } catch (_) {
      /* reported by the assertions below */
    }

    const list = await page.evaluate(() => ({
      windows: document.querySelectorAll(".os-win").length,
      cards: document.querySelectorAll(".blga-card").length,
      apps: Array.from(document.querySelectorAll(".os-win")).map((w) =>
        (w.getAttribute("aria-label") || "").slice(0, 30)
      ),
      text: (document.querySelector(".os-win")?.innerText || "").replace(/\s+/g, " ").slice(0, 120),
      reader: !!document.querySelector(".blga-reader"),
    }));
    check(list.windows === 1, "a window opens", JSON.stringify(list.apps));
    check(list.cards > 0, "the library renders in it", JSON.stringify(list));

    if (!list.cards) return;

    // A card must not be a routed link out of the desktop.
    const card = await page.evaluate(() => {
      const el = document.querySelector(".blga-card");
      return { tag: el.tagName, href: el.getAttribute("href") };
    });
    check(!card.href, "a card is not an <a href> that navigates away", String(card.href));

    await page.evaluate(() => document.querySelector(".blga-card").click());
    await new Promise((r) => setTimeout(r, 2500));

    const after = await page.evaluate(() => ({
      path: location.pathname,
      reader: !!document.querySelector(".blga-reader"),
      readerTitle: document.querySelector(".blga-reader h1")?.innerText || "",
      renderedBody: (document.querySelector(".blga-reader .post-body")?.innerText || "").length,
      stillInWindow: !!document.querySelector(".os-win .blga-reader"),
    }));
    check(after.path === "/", "the desktop is not navigated away from", after.path);
    check(after.reader, "the post opens in a reader view");
    check(after.stillInWindow, "and that reader is inside the Blog window");
    check(!!after.readerTitle, "the reader shows the post title", after.readerTitle.slice(0, 50));
    check(after.renderedBody > 400, "and the rendered body", `${after.renderedBody} chars`);

    // Back must return to the library, not to the browser's previous page.
    await page.evaluate(() => document.querySelector(".blga-back")?.click());
    await new Promise((r) => setTimeout(r, 1200));
    const back = await page.evaluate(() => ({
      path: location.pathname,
      cards: document.querySelectorAll(".blga-card").length,
      reader: !!document.querySelector(".blga-reader"),
    }));
    check(back.cards > 0 && !back.reader, "back returns to the library", JSON.stringify(back));
    check(back.path === "/", "and still has not left the desktop", back.path);
  } catch (e) {
    bad("desktop Blog app", e.message);
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
      await blogSuite(browser);
      await desktopBlogSuite(browser);
      await blogNavigationSuite(browser);
      await richContentSuite(browser);
      await searchSuite(browser);
      await exportSuite(browser);
      await tasksSuite(browser);
      await seoSuite();
    } finally {
      await browser.close();
    }
  }
  if (which === "seo") {
    await seoSuite();
  }
  if (which === "tasks") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await tasksSuite(browser);
    } finally {
      await browser.close();
    }
  }
  if (which === "blog") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await blogSuite(browser);
      await desktopBlogSuite(browser);
      await blogNavigationSuite(browser);
      await richContentSuite(browser);
      await searchSuite(browser);
      await exportSuite(browser);
      await seoSuite();
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
