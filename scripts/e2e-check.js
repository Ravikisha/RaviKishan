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

    // Every shape people actually write display maths in. The $$-on-its-own-
    // lines form is the common one and was silently left as literal text,
    // because an inline-level tokenizer never sees it.
    const forms = await page.evaluate(() => ({
      display: document.querySelectorAll(".pb-math.is-display").length,
      katexErrors: document.querySelectorAll(".katex-error").length,
      // A multi-line aligned block keeps its rows only if the \\ line breaks
      // survived markdown's escape handling.
      alignedRows: document.querySelectorAll(".pb-math .vlist-t .vlist > span").length,
      leftover: /\$\$|\\begin\{|\\\[|\\\(/.test(
        document.querySelector(".post-body")?.innerText || ""
      ),
    }));
    check(forms.display >= 4, "display maths in all its delimiter forms renders", String(forms.display));
    check(forms.katexErrors === 0, "and KaTeX reports no errors", String(forms.katexErrors));
    check(forms.alignedRows > 2, "a multi-line derivation keeps its rows", String(forms.alignedRows));
    check(!forms.leftover, "no raw delimiter survives into the reading text");

    // styles/_map.scss has a global, unscoped `.text` rule setting colour to
    // white. KaTeX marks every textual bit of an equation with that same class,
    // so \text{...} rendered white on white with nothing in the markup to say
    // why. This asserts the colour, not the absence of the rule.
    const textColour = await page.evaluate(() => {
      const t = document.querySelector(".post-body .katex .text");
      if (!t) return null;
      return {
        colour: getComputedStyle(t).color,
        page: getComputedStyle(document.querySelector(".post-body")).color,
        font: getComputedStyle(t).fontFamily.split(",")[0].replace(/"/g, ""),
      };
    });
    if (textColour) {
      check(
        textColour.colour === textColour.page,
        "words inside an equation are the same colour as the prose",
        JSON.stringify(textColour)
      );
      check(/KaTeX/i.test(textColour.font), "and keep KaTeX's own font", textColour.font);
    }
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
// Every connected-account endpoint, unauthenticated. No browser: what matters
// is what the routes do for someone who simply calls them.
//
// These hold a live OAuth credential path, so an open one is not a bug that
// degrades the feature — it is a way to attach, read or re-point the owner's
// task accounts from the internet.
async function integrationsAuthSuite() {
  console.log("\nconnected accounts are closed to everyone else");
  const routes = [
    "/api/integrations/status",
    "/api/integrations/google/start",
    "/api/integrations/google/token",
    "/api/integrations/google/claim",
    "/api/integrations/microsoft/token",
  ];

  for (const r of routes) {
    try {
      const res = await fetch(`${BASE}${r}`, { method: "POST" });
      check(res.status === 401, `${r} refuses an unauthenticated POST`, String(res.status));
    } catch (e) {
      bad(r, e.message);
    }
  }

  // A bearer token that is not a Firebase ID token must not be taken on trust.
  try {
    const res = await fetch(`${BASE}/api/integrations/status`, {
      method: "POST",
      headers: { Authorization: "Bearer not.a.real.token" },
    });
    check(res.status === 401, "a forged bearer token is refused", String(res.status));
  } catch (e) {
    bad("forged token", e.message);
  }

  // The callback is the one route that cannot carry an Authorization header,
  // because the provider navigates to it. Its gate is the sealed state.
  try {
    const res = await fetch(
      `${BASE}/api/integrations/google/callback?code=stolen&state=forged`,
      { redirect: "manual" }
    );
    const to = res.headers.get("location") || "";
    check(res.status === 302, "the callback always redirects rather than rendering", String(res.status));
    check(
      /connectError/.test(to) && !/connected=/.test(to),
      "and a forged state connects nothing",
      to.slice(0, 120)
    );
  } catch (e) {
    bad("callback state", e.message);
  }

  // The claim route hands back a sealed connection; a GET must not reach it.
  try {
    const res = await fetch(`${BASE}/api/integrations/google/claim`);
    check(res.status === 405, "claim refuses a GET outright", String(res.status));
  } catch (e) {
    bad("claim GET", e.message);
  }

  // The LinkedIn route is the one that can PUBLISH. It exists because
  // api.linkedin.com sends no CORS headers, which makes it the only
  // browser-reachable path to the owner's posting credential.
  for (const [body, name] of [
    [{ action: "capabilities" }, "capabilities"],
    [{ action: "publish", text: "hello" }, "publish"],
    [{ action: "delete", urn: "urn:li:share:1" }, "delete"],
    [{ action: "edit", urn: "urn:li:share:1", text: "changed" }, "edit"],
  ]) {
    try {
      const res = await fetch(`${BASE}/api/linkedin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      check(res.status === 401, `/api/linkedin ${name} refuses an anonymous caller`, String(res.status));
    } catch (e) {
      bad(`linkedin ${name}`, e.message);
    }
  }
  try {
    const res = await fetch(`${BASE}/api/linkedin`, { method: "GET" });
    check(res.status === 405, "/api/linkedin refuses a GET outright", String(res.status));
  } catch (e) {
    bad("linkedin GET", e.message);
  }

  // /api/social carries the posting credential for every connected YouTube,
  // Instagram and X account at once, so it is the single most valuable thing
  // here to leave open by accident.
  for (const [body, name] of [
    [{ action: "accounts" }, "accounts"],
    [{ action: "publish", provider: "x", text: "hello" }, "x publish"],
    [{ action: "publish", provider: "instagram", imageUrl: "https://x.test/a.jpg" }, "instagram publish"],
    [{ action: "updateVideo", provider: "youtube", videoId: "abc", title: "t" }, "youtube update"],
  ]) {
    try {
      const res = await fetch(`${BASE}/api/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      check(res.status === 401, `/api/social ${name} refuses an anonymous caller`, String(res.status));
    } catch (e) {
      bad(`social ${name}`, e.message);
    }
  }
  try {
    const res = await fetch(`${BASE}/api/social`, { method: "GET" });
    check(res.status === 405, "/api/social refuses a GET outright", String(res.status));
  } catch (e) {
    bad("social GET", e.message);
  }


  // The environment route can write deployment credentials.
  for (const [body, name] of [
    [{ action: "status" }, "status"],
    [{ action: "listVercel" }, "listVercel"],
    [{ action: "set", key: "GITHUB_CLIENT_SECRET", value: "x" }, "set"],
    [{ action: "delete", key: "GITHUB_CLIENT_SECRET" }, "delete"],
  ]) {
    try {
      const res = await fetch(`${BASE}/api/env`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      check(res.status === 401, `/api/env ${name} refuses an anonymous caller`, String(res.status));
    } catch (e) {
      bad(`env ${name}`, e.message);
    }
  }
  try {
    const res = await fetch(`${BASE}/api/env`, { method: "GET" });
    check(res.status === 405, "/api/env refuses a GET outright", String(res.status));
  } catch (e) {
    bad("env GET", e.message);
  }


  // The secret store. Every action, because this is the one route where a
  // single unauthenticated success is a full credential compromise.
  for (const [body, name] of [
    [{ action: "status" }, "status"],
    [{ action: "list" }, "list"],
    [{ action: "reveal", name: "aws" }, "reveal"],
    [{ action: "save", name: "aws", value: "x" }, "save"],
    [{ action: "delete", name: "aws" }, "delete"],
  ]) {
    try {
      const res = await fetch(`${BASE}/api/secrets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      check(res.status === 401, `/api/secrets ${name} refuses an anonymous caller`, String(res.status));
      // A refusal must not leak the shape of the store either.
      const text = await res.text();
      check(
        !/value|secret"\s*:/i.test(text) || /error/i.test(text),
        `and its ${name} refusal carries no secret material`,
        text.slice(0, 80)
      );
    } catch (e) {
      bad(`secrets ${name}`, e.message);
    }
  }
  try {
    const res = await fetch(`${BASE}/api/secrets`, { method: "GET" });
    check(res.status === 405, "/api/secrets refuses a GET outright", String(res.status));
  } catch (e) {
    bad("secrets GET", e.message);
  }


  // The account directory is the key ring for everything else: a single
  // unauthenticated success here would list every account the deployment can
  // act as, and `saveLogin` would write a password into the store.
  for (const [body, name] of [
    [{ action: "list" }, "list"],
    [{ action: "resolve", service: "photos" }, "resolve"],
    [{ action: "setDefault", service: "photos", key: "instagram__1" }, "setDefault"],
    [{ action: "assign", provider: "google", accountId: "1", identityId: "x" }, "assign"],
    [{ action: "forget", provider: "google", accountId: "1" }, "forget"],
    [{ action: "createIdentity", label: "intruder" }, "createIdentity"],
    [{ action: "saveLogin", provider: "google", accountId: "1", username: "a", password: "b" }, "saveLogin"],
    [{ action: "forgetLogin", provider: "google", accountId: "1" }, "forgetLogin"],
    [{ action: "connectKey", provider: "huggingface", key: "hf_x" }, "connectKey"],
    [{ action: "setAgentReadable", provider: "kaggle", accountId: "1", value: true }, "setAgentReadable"],
  ]) {
    try {
      const res = await fetch(`${BASE}/api/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      check(res.status === 401, `/api/accounts ${name} refuses an anonymous caller`, String(res.status));
      const text = await res.text();
      // A refusal must not name a single real account either: the list of who
      // this deployment can act as is itself worth protecting.
      check(
        !/gmail\.com|accountId"\s*:\s*"[^"]/i.test(text),
        `and its ${name} refusal names no account`,
        text.slice(0, 80)
      );
    } catch (e) {
      bad(`accounts ${name}`, e.message);
    }
  }
  try {
    const res = await fetch(`${BASE}/api/accounts`, { method: "GET" });
    check(res.status === 405, "/api/accounts refuses a GET outright", String(res.status));
  } catch (e) {
    bad("accounts GET", e.message);
  }
  // A forged bearer token must fail the same way as none at all.
  try {
    const res = await fetch(`${BASE}/api/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer not-a-real-token" },
      body: JSON.stringify({ action: "list" }),
    });
    check(res.status === 401, "/api/accounts refuses a forged bearer token", String(res.status));
  } catch (e) {
    bad("accounts forged token", e.message);
  }


  // Google Analytics reads traffic for every property the account can see.
  for (const [body, name] of [
    [{ action: "accounts" }, "accounts"],
    [{ action: "properties" }, "properties"],
    [{ action: "summary", propertyId: "123456" }, "summary"],
    [{ action: "report", propertyId: "123456", metrics: ["activeUsers"] }, "report"],
  ]) {
    try {
      const res = await fetch(`${BASE}/api/analytics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      check(res.status === 401, `/api/analytics ${name} refuses an anonymous caller`, String(res.status));
    } catch (e) {
      bad(`analytics ${name}`, e.message);
    }
  }
  try {
    const res = await fetch(`${BASE}/api/analytics`, { method: "GET" });
    check(res.status === 405, "/api/analytics refuses a GET outright", String(res.status));
  } catch (e) {
    bad("analytics GET", e.message);
  }

  // Both multi-account consent routes are gated the same way as the rest.
  for (const p of ["youtube", "instagram", "x", "analytics"]) {
    try {
      const res = await fetch(`${BASE}/api/integrations/${p}/start`, { method: "POST" });
      check(res.status === 401, `/api/integrations/${p}/start refuses an anonymous caller`, String(res.status));
    } catch (e) {
      bad(`${p} start`, e.message);
    }
  }
}

// The Notes panel, against the real components.
//
// What is worth asserting here is the thing the panel exists for: four
// services disagree about what a note is, and every disagreement is silent. A
// panel that renders the same controls for all of them teaches you to expect
// something that will be dropped. So these assertions are about what the panel
// REFUSES to offer, not about what it shows.
async function notesSuite(browser) {
  console.log("\nnotes: one desk, four places, no silent surprises");
  const page = await browser.newPage();
  await page.bringToFront();
  await withMode(page, "recruiter");
  try {
    await page.goto(`${BASE}/__notespreview?noload`, { waitUntil: "networkidle2", timeout: 45000 });
    await page.waitForSelector(".nt-tab", { timeout: 30000 });

    const strip = await page.evaluate(() => ({
      tabs: [...document.querySelectorAll(".nt-tab")].map((t) => t.textContent.trim()),
      unavailable: [...document.querySelectorAll(".nt-tab.off")].map((t) => t.textContent.trim()),
      caps: document.querySelector(".nt-caps")?.textContent?.trim() || "",
      rows: document.querySelectorAll(".nt-row").length,
      pinned: document.querySelectorAll(".nt-row.pinned").length,
      archived: document.querySelectorAll(".nt-row.archived").length,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));

    check(strip.tabs.length === 5, "every place a note could live is listed", String(strip.tabs.length));
    // Shown rather than omitted: a missing Keep reads as an oversight.
    check(
      strip.unavailable.length === 1 && /Keep/.test(strip.unavailable[0]),
      "Google Keep is shown, marked unavailable rather than hidden",
      JSON.stringify(strip.unavailable)
    );
    check(/tags/.test(strip.caps) && /pinning/.test(strip.caps), "the local source says what it can do", strip.caps);
    check(strip.rows === 3, "notes list", String(strip.rows));
    check(strip.pinned === 1 && strip.archived === 1, "pinned and archived notes are marked", `${strip.pinned}/${strip.archived}`);
    check(strip.scrollW === strip.clientW, "the panel does not overflow the page", `${strip.scrollW} vs ${strip.clientW}`);

    const localCtl = await page.evaluate(() => ({
      tagInput: !!document.querySelector(".nt-tag-input"),
      pin: !!document.querySelector(".nt-toggle"),
    }));
    check(localCtl.tagInput && localCtl.pin, "the built-in store offers tags and pinning");

    // --- Trello: labels are board objects, so tags must be read-only ---
    await page.evaluate(() => {
      [...document.querySelectorAll(".nt-tab")].find((t) => t.textContent.trim().startsWith("Trello")).click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const trello = await page.evaluate(() => ({
      caps: document.querySelector(".nt-caps")?.textContent?.trim() || "",
      tagsOff: !!document.querySelector(".nt-tags.off"),
      tagInput: !!document.querySelector(".nt-tag-input"),
      removeButtons: document.querySelectorAll(".nt-tag button").length,
      pin: !!document.querySelector(".nt-toggle"),
      reason: document.querySelector(".nt-field span em")?.textContent || "",
    }));
    check(/no tags/.test(trello.caps), "Trello says up front that it has no tags", trello.caps);
    check(trello.tagsOff && !trello.tagInput, "so the tag input is not offered");
    check(trello.removeButtons === 0, "and existing labels cannot be removed from here");
    check(/board-wide/i.test(trello.reason), "with the reason in the control's own place", trello.reason.slice(0, 70));
    check(!trello.pin, "Trello offers no pin, because its API has none");

    // --- Google Keep: declared unusable, with evidence ---
    await page.evaluate(() => {
      [...document.querySelectorAll(".nt-tab")].find((t) => t.textContent.trim().startsWith("Google Keep")).click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const keep = await page.evaluate(() => ({
      blocked: !!document.querySelector(".nt-blocked"),
      editor: !!document.querySelector(".nt-editor"),
      text: document.querySelector(".nt-blocked")?.innerText || "",
      caps: document.querySelector(".nt-caps")?.textContent?.trim() || "",
    }));
    check(keep.blocked && !keep.editor, "Google Keep offers no editor at all");
    check(/enterprise|Workspace/i.test(keep.text), "it states the reason, which is that the API is enterprise-only");
    check(/Obsidian|notes here/i.test(keep.text), "and points at what to use instead");
    // The reason is long; printing it in the strip AND the panel put the same
    // paragraph on screen twice.
    check(keep.caps.length < 80, "without repeating the whole paragraph in the strip", `${keep.caps.length} chars`);

    // --- Obsidian: connected is not the same as configured ---
    await page.evaluate(() => {
      [...document.querySelectorAll(".nt-tab")].find((t) => t.textContent.trim().startsWith("Obsidian")).click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const vault = await page.evaluate(() => ({
      blocked: !!document.querySelector(".nt-blocked"),
      text: document.querySelector(".nt-blocked")?.innerText || "",
    }));
    check(vault.blocked, "an unconfigured vault explains itself rather than showing an empty list");
    check(/no cloud API/i.test(vault.text), "saying Obsidian has no cloud API", vault.text.slice(0, 60));
    check(/GitHub/i.test(vault.text), "and that the vault is read as a GitHub repository");
  } catch (e) {
    bad("notes panel", e.message);
  } finally {
    await page.close();
  }
}

// Adding a contact in any form.
//
// The assertion that matters is that you can SEE what the parser understood
// before you commit to it. A parser you cannot see is one you stop trusting,
// and then you type every field by hand and the feature was pointless.
async function contactsSuite(browser) {
  console.log("\ncontacts: paste anything, see what it read");
  const page = await browser.newPage();
  await page.bringToFront();
  await withMode(page, "recruiter");
  try {
    await page.goto(`${BASE}/__contactspreview?noload`, { waitUntil: "networkidle2", timeout: 45000 });
    await page.waitForSelector(".ct-parsed .ct-ch", { timeout: 30000 });

    const read = await page.evaluate(() => ({
      name: document.querySelector(".ct-parsed-name")?.textContent?.trim() || "",
      chips: [...document.querySelectorAll(".ct-parsed .ct-ch")].map((c) => ({
        kind: c.querySelector("i")?.textContent || "",
        text: c.textContent || "",
      })),
      note: [...document.querySelectorAll(".ct-add .admin-sub")].map((p) => p.textContent).join(" "),
      dupe: document.querySelector(".ct-dupe")?.textContent || "",
      button: document.querySelector(".ct-add .admin-primary")?.textContent || "",
    }));

    check(read.name === "Asha Menon", "the name is read out of the signature", read.name);
    const kinds = read.chips.map((c) => c.kind);
    for (const k of ["email", "phone", "url", "handle"]) {
      check(kinds.includes(k), `the ${k} is found`, kinds.join(","));
    }
    // A plus-addressed e-mail is a real address and a common one.
    check(
      read.chips.some((c) => c.text.includes("asha.menon+work@northwind.co.in")),
      "including a plus-addressed e-mail"
    );
    // The line that is not a channel is usually the reason you saved them.
    check(/Rust meetup/.test(read.note), "and the prose survives as the note");

    // Finding the duplicate AFTER saving means two records to merge instead of
    // one decision to make.
    check(/already has one of those/.test(read.dupe), "a clash with an existing contact is shown before saving", read.dupe.slice(0, 60));
    check(/Save anyway/.test(read.button), "and the button says what it would do", read.button);

    // The chips must actually be styled. They are not, if the stylesheet only
    // mounts with the whole panel — the `.ops-card` trap.
    const styled = await page.evaluate(() => {
      const c = document.querySelector(".ct-parsed .ct-ch");
      const s = getComputedStyle(c);
      return { radius: s.borderRadius, border: parseFloat(s.borderTopWidth), kind: parseFloat(getComputedStyle(c.querySelector("i")).fontSize) };
    });
    check(styled.radius === "999px" && styled.border >= 1, "the channel chips are styled, not bare text", JSON.stringify(styled));
    check(styled.kind > 0 && styled.kind < 12, "with the kind label smaller than the value", String(styled.kind));

    const fits = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      textarea: document.querySelector(".ct-add textarea").clientHeight,
    }));
    check(!fits.overflow, "the panel does not overflow the page");
    // A five-line signature is the normal case; clipping it hides what was pasted.
    check(fits.textarea >= 120, "the paste box fits a signature without scrolling", String(fits.textarea));
  } catch (e) {
    bad("contacts panel", e.message);
  } finally {
    await page.close();
  }
}

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
      shelves: document.querySelectorAll(".tk-shelf").length,
      providers: Array.from(document.querySelectorAll(".tk-shelf")).map((s) => s.dataset.provider),
      accountNamed: Array.from(document.querySelectorAll(".tk-shelf")).every((s) =>
        /@/.test(s.querySelector(".tk-acct")?.textContent || "")
      ),
      columns: document.querySelectorAll(".tk-col").length,
      colProviders: Array.from(document.querySelectorAll(".tk-col")).map((c) => c.dataset.provider),
      rows: document.querySelectorAll(".tk-row").length,
      subtasks: document.querySelectorAll(".tk-row.is-child").length,
      overdue: document.querySelectorAll(".tk-due.overdue").length,
      today: document.querySelectorAll(".tk-due.today").length,
      addInputs: document.querySelectorAll(".tk-add-title").length,
      newList: document.querySelectorAll(".tk-shelf-actions").length,
      selects: document.querySelectorAll(".tk-rail select").length,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));

    // Every group visible at once was the point: the old panel showed one at a
    // time behind a <select>.
    check(shape.columns > 1, "every group is a column", String(shape.columns));
    check(shape.selects === 0, "and no group is hidden behind a dropdown");
    check(shape.addInputs === shape.columns, "each group can be added to directly", `${shape.addInputs}/${shape.columns}`);
    check(shape.subtasks > 0, "subtasks and steps render nested under their parent");
    check(shape.overdue > 0 && shape.today > 0, "due dates are graded, not just printed",
      `overdue ${shape.overdue}, today ${shape.today}`);
    check(shape.scrollW === shape.clientW, "the board does not overflow the page", `${shape.scrollW} vs ${shape.clientW}`);

    // --- two accounts, as shelves ---
    check(shape.shelves === 2, "both accounts are on the board", JSON.stringify(shape.providers));
    check(
      shape.providers.includes("google") && shape.providers.includes("microsoft"),
      "Google Tasks and Microsoft To Do each get their own shelf"
    );
    check(shape.accountNamed, "each shelf says which account it is");
    check(shape.newList === shape.shelves, "a list can be created in either account", String(shape.newList));
    // The provider is carried by WHERE a column sits, which is what makes a
    // cross-account drag detectable at all.
    check(
      new Set(shape.colProviders).size === 2,
      "every column knows which account it belongs to",
      JSON.stringify(shape.colProviders)
    );

    // --- drag a task into another group in the SAME account ---
    const before = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".tk-col")).map((c) => c.querySelectorAll(".tk-row").length)
    );
    const pts = await page.evaluate(() => {
      const row = document.querySelector(".tk-col .tk-row");
      const target = document.querySelectorAll(".tk-col")[2];
      const a = row.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      return {
        from: { x: a.left + 40, y: a.top + 14 },
        to: { x: t.left + t.width / 2, y: t.top + 60 },
      };
    });
    await page.mouse.move(pts.from.x, pts.from.y);
    await page.mouse.down();
    await page.mouse.move(pts.to.x, pts.to.y, { steps: 18 });
    await new Promise((r) => setTimeout(r, 400));
    const mid = await page.evaluate(() => ({
      lit: document.querySelectorAll(".tk-col.is-drop").length,
      same: document.querySelectorAll(".tk-col.is-drop-same").length,
      note: document.querySelector(".tk-drop-note")?.textContent || "",
    }));
    check(mid.lit === 1, "exactly one group lights up as the drop target", String(mid.lit));
    check(mid.same === 1, "a move inside one account is the plain amber target", mid.note);
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

    // --- drag ACROSS accounts: a different operation, and it must look like one ---
    const cross = await page.evaluate(() => {
      const cols = Array.from(document.querySelectorAll(".tk-col"));
      const src = cols.find((c) => c.dataset.provider === "google" && c.querySelector(".tk-row"));
      const dst = cols.find((c) => c.dataset.provider === "microsoft");
      const a = src.querySelector(".tk-row").getBoundingClientRect();
      const t = dst.getBoundingClientRect();
      return {
        from: { x: a.left + 40, y: a.top + 14 },
        to: { x: t.left + t.width / 2, y: t.top + 60 },
      };
    });
    await page.mouse.move(cross.from.x, cross.from.y);
    await page.mouse.down();
    await page.mouse.move(cross.to.x, cross.to.y, { steps: 18 });
    await new Promise((r) => setTimeout(r, 400));
    const crossState = await page.evaluate(() => ({
      cross: document.querySelectorAll(".tk-col.is-drop-cross").length,
      same: document.querySelectorAll(".tk-col.is-drop-same").length,
      note: document.querySelector(".tk-drop-note.cross")?.textContent || "",
    }));
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 600));

    // There is no move API across services: the task is recreated and the
    // original deleted, so the board must not dress it up as an ordinary move.
    check(crossState.cross === 1, "a drag to the other account is marked differently", String(crossState.cross));
    check(crossState.same === 0, "and never as a plain move");
    check(
      /recreated/i.test(crossState.note),
      "the board says the task will be recreated before you let go",
      crossState.note
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
      document.querySelectorAll(".tk-col")[1].querySelector(".admin-primary").click()
    );
    await new Promise((r) => setTimeout(r, 700));
    const added = await page.evaluate(() =>
      document.querySelectorAll(".tk-col")[1].innerText.includes("Written from the board")
    );
    check(added, "and the task appears in that group");

    // --- completing a task ---
    const title = await page.evaluate(() => {
      const row = document.querySelector(".tk-row:not(.is-done)");
      row.querySelector(".tk-tick").click();
      return row.querySelector(".tk-title").innerText;
    });
    await new Promise((r) => setTimeout(r, 500));
    const done = await page.evaluate(
      (t) =>
        Array.from(document.querySelectorAll(".tk-row.is-done")).some((r) =>
          r.innerText.includes(t)
        ),
      title
    );
    check(done, "ticking a task marks it complete", title.slice(0, 40));

    // --- Microsoft's built-in lists refuse a rename ---
    await page.evaluate(() => {
      Array.from(document.querySelectorAll(".tk-col"))
        .find((c) => c.dataset.provider === "microsoft")
        .querySelector(".tk-menu-btn")
        .click();
    });
    // The menu opens on React state, so it is not in the DOM in the same tick
    // as the click that asked for it.
    await page.waitForSelector(".tk-menu button", { timeout: 5000 });
    const builtIn = await page.evaluate(() => {
      const col = Array.from(document.querySelectorAll(".tk-col")).find(
        (c) => c.dataset.provider === "microsoft"
      );
      const items = Array.from(col.querySelectorAll(".tk-menu button"));
      return {
        rename: items.find((b) => /rename/i.test(b.textContent))?.disabled,
        del: items.find((b) => /delete/i.test(b.textContent))?.disabled,
      };
    });
    check(
      builtIn.rename === true && builtIn.del === true,
      "Microsoft's built-in list cannot be renamed or deleted",
      JSON.stringify(builtIn)
    );

    // --- space goes to work, not to containers ---
    //
    // The board used to lay its lists out in a horizontal strip. On a personal
    // account most lists are empty most of the time, so the first screen was
    // five cards each repeating "Nothing here. Add the first task below." under
    // a full-size field, a long amber scrollbar across the page, and the other
    // account's real tasks below the fold.
    const space = await page.evaluate(() => {
      const de = document.documentElement;
      const rail = document.querySelector(".tk-rail");
      const titles = [...document.querySelectorAll(".tk-col-head h4")].map((n) => n.textContent.trim());
      const chips = [...document.querySelectorAll(".tk-chip")].map((n) => n.textContent.trim());
      return {
        sideways: de.scrollWidth > de.clientWidth,
        railSideways: rail ? rail.scrollWidth > rail.clientWidth + 1 : false,
        titles,
        chips,
        zeroBadges: [...document.querySelectorAll(".tk-count")].filter((n) => n.textContent.trim() === "0").length,
        repeatedNothing: [...document.querySelectorAll(".tk-none, .tk-empty")].filter((n) =>
          /Nothing here/i.test(n.textContent)
        ).length,
      };
    });
    check(!space.sideways, "the board does not scroll the page sideways");
    // The rail is where the scrollbar used to be, and it is the thing that has
    // to wrap — a page that fits while its rail clips is the same bug.
    check(!space.railSideways, "and the lists wrap rather than scrolling sideways");
    check(space.chips.length > 0, "an empty list is a chip, not a column", JSON.stringify(space.chips));
    check(
      !space.chips.some((c) => space.titles.includes(c)),
      "and never both at once",
      JSON.stringify(space.chips.filter((c) => space.titles.includes(c)))
    );
    check(space.zeroBadges === 0, "a count of zero is not printed", String(space.zeroBadges));
    check(
      space.repeatedNothing === 0,
      "and the empty-list sentence is not repeated per list",
      String(space.repeatedNothing)
    );

    // Clicking a chip opens that list where it stands. Without this the chip
    // is a label for something unreachable.
    const chipName = space.chips[0];
    await page.click(".tk-chip");
    await new Promise((r) => setTimeout(r, 120));
    const afterOpen = await page.evaluate(() => ({
      titles: [...document.querySelectorAll(".tk-col-head h4")].map((n) => n.textContent.trim()),
      chips: [...document.querySelectorAll(".tk-chip")].map((n) => n.textContent.trim()),
    }));
    check(afterOpen.titles.includes(chipName), `opening "${chipName}" gives it a column`);
    check(!afterOpen.chips.includes(chipName), "and takes it out of the empty strip");

    // ---- the column cap. A real list holds sixty tasks; rendered whole
    // that is a scroll box inside a scroll box, eight times over.
    const capped = await page.evaluate(() => {
      const col = [...document.querySelectorAll(".tk-col")].find((c) => c.querySelector(".tk-more"));
      if (!col) return null;
      return {
        roots: col.querySelectorAll(".tk-row:not(.is-child)").length,
        label: col.querySelector(".tk-more").textContent.trim(),
        list: col.dataset.list,
      };
    });
    check(!!capped, "a long list is capped and says how many more");
    if (capped) {
      check(capped.roots === 8, "at eight tasks", String(capped.roots));
      check(/^Show \d+ more$/.test(capped.label), "with a count in the button", capped.label);
      await page.click(`.tk-col[data-list="${capped.list}"] .tk-more`);
      const expanded = await page.evaluate(
        (id) => document.querySelectorAll(`.tk-col[data-list="${id}"] .tk-row:not(.is-child)`).length,
        capped.list
      );
      const more = Number(capped.label.match(/\d+/)[0]);
      check(expanded === 8 + more, "and Show more reveals exactly that many", `${expanded} vs ${8 + more}`);
      await page.click(`.tk-col[data-list="${capped.list}"] .tk-more`);
    }

    // ---- the lens. Every count must equal what the board then shows.
    const lensCount = async (label) =>
      page.evaluate((l) => {
        const b = [...document.querySelectorAll(".tk-lens-item")].find((n) =>
          n.querySelector(".tk-lens-text").textContent.trim() === l
        );
        return Number(b.querySelector(".tk-lens-n").textContent);
      }, label);
    const pressLens = (label) =>
      page.evaluate((l) => {
        [...document.querySelectorAll(".tk-lens-item")]
          .find((n) => n.querySelector(".tk-lens-text").textContent.trim() === l)
          .click();
      }, label);
    const visibleOpen = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".tk-row:not(.is-done)")]
          .filter((r) => !r.classList.contains("is-child") || r.querySelector(".tk-due"))
          .map((r) => ({
            title: r.querySelector(".tk-title").textContent,
            due: r.querySelector(".tk-due")?.className || "",
          }))
      );

    const overdueN = await lensCount("Overdue");
    await pressLens("Overdue");
    await new Promise((r) => setTimeout(r, 150));
    const overdueRows = await visibleOpen();
    check(
      overdueRows.length === overdueN && overdueRows.every((r) => /overdue/.test(r.due)),
      "the Overdue lens shows exactly its count, all overdue",
      `${overdueRows.length} rows vs ${overdueN}`
    );
    const pressed = await page.evaluate(
      () => document.querySelector(".tk-lens-item.on .tk-lens-text").textContent
    );
    check(pressed === "Overdue", "and is the one marked as on");
    check(
      (await page.$$(".tk-chip")).length === 0,
      "a lens hides the empty-list strip — it is not what you asked to see"
    );

    await pressLens("Everything");
    await page.type(".tk-find", "study");
    await new Promise((r) => setTimeout(r, 150));
    const found = await page.evaluate(() =>
      [...document.querySelectorAll(".tk-row .tk-title")].map((n) => n.textContent)
    );
    check(
      found.length > 0 && found.every((t) => /study/i.test(t)),
      "search narrows every list to matching tasks",
      JSON.stringify(found)
    );
    check(
      !(await page.$(".tk-more")),
      "and lifts the column cap, since every row shown was asked for"
    );
    await page.type(".tk-find", " os");
    await new Promise((r) => setTimeout(r, 150));
    const narrowed = await page.evaluate(() =>
      [...document.querySelectorAll(".tk-row .tk-title")].map((n) => n.textContent)
    );
    check(
      narrowed.length > 0 && narrowed.length < found.length,
      "a second word narrows rather than widens",
      `${found.length} → ${narrowed.length}`
    );
    await page.focus(".tk-find");
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 150));
    check(
      (await page.$eval(".tk-find", (n) => n.value)) === "" && !!(await page.$(".tk-chip")),
      "Escape clears the search and the board comes back"
    );
  } catch (e) {
    bad("tasks board", e.message);
  } finally {
    await page.close();
  }
}

/* ---------------- LinkedIn panel ---------------- */

// /__linkedinpreview renders the panel's REAL exported parts at every state
// that has its own design — a fresh install can reach none of them, because
// they need a LinkedIn app, credentials and a connected account.
async function linkedinSuite(browser) {
  console.log("\nlinkedin panel");
  const page = await browser.newPage();
  await withMode(page, "recruiter");
  try {
    await page.goto(`${BASE}/__linkedinpreview?noload`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector(".li-steps", { timeout: 30000 });

    const setup = await page.evaluate(() => {
      const frame = document.querySelector('[data-state="setup"]');
      const steps = [...frame.querySelectorAll(".li-step")];
      return {
        steps: steps.length,
        done: steps.filter((s) => s.classList.contains("is-done")).length,
        uris: [...frame.querySelectorAll(".li-uris code")].map((c) => c.textContent),
        links: [...frame.querySelectorAll("a[href]")].map((a) => a.href),
        connectDisabled: frame.querySelector(".li-step:last-child .admin-primary").disabled,
      };
    });
    check(setup.steps === 5 && setup.done === 0, "not set up: five steps, none ticked", `${setup.steps}/${setup.done}`);
    check(
      setup.uris.includes("https://www.ravikishan.me/api/integrations/linkedin/callback"),
      "the www redirect URL is listed (the apex redirects there)"
    );
    check(
      setup.uris.some((u) => u.startsWith(new URL(BASE).origin)),
      "and the one this copy is running on"
    );
    check(
      setup.uris.includes("LINKEDIN_CLIENT_ID") && setup.uris.includes("LINKEDIN_CLIENT_SECRET"),
      "the two variables to set are named"
    );
    check(
      setup.links.some((h) => h.startsWith("https://www.linkedin.com/developers/apps")),
      "and the developer portal is one click away"
    );
    check(setup.connectDisabled, "Connect cannot be pressed before the credentials exist");

    const ready = await page.evaluate(() => {
      const frame = document.querySelector('[data-state="ready"]');
      const steps = [...frame.querySelectorAll(".li-step")];
      return {
        done: steps.filter((s) => s.classList.contains("is-done")).length,
        // A finished step folds to its title — its instructions are noise.
        doneBodies: steps
          .filter((s) => s.classList.contains("is-done"))
          .filter((s) => s.querySelector(".li-step-body p, .li-uris")).length,
        connectEnabled: !frame.querySelector(".li-step:last-child .admin-primary").disabled,
      };
    });
    check(ready.done === 4, "credentials in place: four steps tick themselves", String(ready.done));
    check(ready.doneBodies === 0, "and fold to their titles", String(ready.doneBodies));
    check(ready.connectEnabled, "leaving Connect as the one thing to press");

    // A copy button is only real if the clipboard receives the value.
    const ctx = browser.defaultBrowserContext();
    await ctx.overridePermissions(new URL(BASE).origin, ["clipboard-read", "clipboard-write"]);
    await page.click('[data-state="setup"] .li-uris .li-copy');
    await new Promise((r) => setTimeout(r, 200));
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
    check(clip === "https://www.ravikishan.me/api/integrations/linkedin/callback", "Copy puts the exact URL on the clipboard", clip);

    const life = await page.evaluate(() =>
      ["conn-fine", "conn-soon"].map((id) => {
        const f = document.querySelector(`[data-state="${id}"]`);
        const m = f.querySelector(".li-life");
        return {
          text: f.querySelector(".li-left").textContent,
          now: Number(m.getAttribute("aria-valuenow")),
          primary: !!f.querySelector(".li-conn .admin-primary"),
        };
      })
    );
    check(/41 days/.test(life[0].text) && life[0].now === 41, "a connection says how long it has left", life[0].text);
    check(!life[0].primary && life[1].primary, "and Reconnect turns primary in the last fortnight");

    const feed = await page.evaluate(() => {
      const f = document.querySelector('[data-state="compose-hook"]');
      return {
        shown: f.querySelector(".li-feed-text").textContent,
        more: !!f.querySelector(".li-feed-more"),
        full: f.querySelector(".li-text").value,
      };
    });
    check(feed.more, "a long opening shows where the feed folds it");
    check(feed.shown.length < feed.full.length, "and only the part above the fold");

    // The fold follows typing, not just the initial value.
    await page.click('[data-state="compose-hook"] .li-text', { clickCount: 3 });
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.type("A short post.");
    const short = await page.evaluate(() => {
      const f = document.querySelector('[data-state="compose-hook"]');
      return { more: !!f.querySelector(".li-feed-more"), text: f.querySelector(".li-feed-text").textContent };
    });
    check(!short.more && short.text === "A short post.", "and a short one shows whole as you type", short.text);

    const over = await page.evaluate(() => {
      const f = document.querySelector('[data-state="compose-over"]');
      return {
        tone: f.querySelector(".li-compose").className,
        disabled: f.querySelector(".li-send .admin-primary").disabled,
      };
    });
    check(/\bover\b/.test(over.tone) && over.disabled, "over the cap the edge is red and Publish refuses");

    const ledger = await page.evaluate(() => {
      const d = document.querySelector(".li-ledger-card");
      return { open: d.open, summary: d.querySelector("summary").textContent };
    });
    check(!ledger.open && /\d+ of \d+/.test(ledger.summary), "the ledger is folded with its score showing", ledger.summary);

    // Editing a published post happens in its row. A deleted post, or one
    // with no URN, has nothing to edit.
    const editable = await page.evaluate(() =>
      [...document.querySelectorAll(".li-post")].map((li) => ({
        gone: li.classList.contains("is-gone"),
        edit: [...li.querySelectorAll("button")].some((b) => b.textContent.trim() === "Edit"),
      }))
    );
    check(
      editable.filter((r) => !r.gone).every((r) => r.edit) && editable.filter((r) => r.gone).every((r) => !r.edit),
      "every live post offers Edit, a deleted one does not",
      JSON.stringify(editable)
    );
    await page.evaluate(() => {
      const b = [...document.querySelectorAll(".li-post button")].find((n) => n.textContent.trim() === "Edit");
      b.click();
    });
    const editState = await page.evaluate(() => {
      const row = document.querySelector(".li-post.is-editing");
      const save = row && [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save edit");
      return { open: !!row, prefilled: !!row?.querySelector("textarea")?.value, saveDisabled: save?.disabled };
    });
    check(editState.open && editState.prefilled, "Edit opens the post's own text in place");
    check(editState.saveDisabled === true, "and Save stays off until the text actually changes");

    // Headings on a dark surface: globals.scss pins h1–h4 to a light-theme
    // colour, and a heading that inherits it vanishes. Every one must be light.
    const dark = await page.evaluate(() =>
      [...document.querySelectorAll(".li-main h4, .li-main h5")]
        .map((h) => getComputedStyle(h).color)
        .filter((c) => {
          const [r, g, b] = c.match(/\d+/g).map(Number);
          return (r + g + b) / 3 < 110;
        }).length
    );
    check(dark === 0, "no heading is dark-on-dark", String(dark));

    for (const width of [1440, 420]) {
      await page.setViewport({ width, height: 900 });
      await new Promise((r) => setTimeout(r, 150));
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      check(!sideways, `nothing overflows sideways at ${width}px`);
    }
  } catch (e) {
    bad("linkedin panel", e.message);
  } finally {
    await page.close();
  }
}

/* ---------------- admin: the open section survives a refresh ---------------- */

// /__adminpreview runs the same useTabInUrl hook as /admin, which needs a
// signed-in session this suite does not have.
async function adminTabsSuite(browser) {
  console.log("\nadmin tabs");
  const page = await browser.newPage();
  // Desktop width: below 720px the rail is a sheet you open, not a list.
  await page.setViewport({ width: 1280, height: 900 });
  try {
    await page.goto(`${BASE}/__adminpreview`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector(".ad-list button, .ad-list a", { timeout: 30000 });
    const current = () =>
      page.evaluate(() => {
        const on = document.querySelector('.ad-list [aria-current="page"], .ad-list .on, .ad-list .is-on');
        return { tab: new URLSearchParams(location.search).get("tab"), label: on ? on.textContent.trim() : "" };
      });
    const click = (label) =>
      page.evaluate((l) => {
        const b = [...document.querySelectorAll(".ad-list button, .ad-list a")].find((n) =>
          n.textContent.trim().startsWith(l)
        );
        b.click();
      }, label);

    await click("Tasks");
    await new Promise((r) => setTimeout(r, 200));
    const a = await current();
    check(a.tab === "tasks", "switching section writes it into the URL", JSON.stringify(a));

    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForSelector(".ad-list button, .ad-list a", { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 300));
    const b = await current();
    check(b.tab === "tasks" && /^Tasks/.test(b.label), "a refresh opens the same section", JSON.stringify(b));

    await click("LinkedIn");
    await new Promise((r) => setTimeout(r, 200));
    await page.goBack({ waitUntil: "networkidle2" }).catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    const c = await current();
    check(c.tab === "tasks" && /^Tasks/.test(c.label), "Back returns to the previous section", JSON.stringify(c));

    await page.goto(`${BASE}/__adminpreview?tab=not-a-tab`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 300));
    const d = await current();
    check(d.tab === "not-a-tab" && !/^not/i.test(d.label), "an unknown ?tab= falls back instead of breaking", JSON.stringify(d));
  } catch (e) {
    bad("admin tabs", e.message);
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

    // p5 animates, so it also records — and a recording is the one artefact
    // here that can come back perfectly valid and completely empty.
    //
    // TWO separate causes, both silent, both now fixed:
    //   - an off-screen capture frame gets no requestAnimationFrame ticks, so
    //     the draw loop never advances (the frame is on-screen at 1.5% opacity)
    //   - `video/webm;codecs=vp9` WITH a videoBitsPerSecond encodes a 110-byte
    //     header and no frames at all, while isTypeSupported says yes and
    //     onstop fires normally (see scripts/probe-recorder.mjs)
    //
    // So the floor is measured, not nominal: a real 5s capture of this sketch
    // lands at 9-17 KB, and the empty one was 110 bytes. 6 KB sits well clear
    // of anything that is not a genuine recording, where the old 2 KB bar was
    // the same number the renderer itself refuses below — it could only ever
    // confirm the guard had run.
    const p5row = rows.find((x) => x.kind === "p5");
    check(p5row && p5row.video > 6000, "the p5 sketch also records a real video", `${p5row?.video} bytes`);

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

/* ---------------- Jarvis (owner-only desktop app) suite ---------------- */

// The desktop's Jarvis app drives the agent server, so it must not exist for
// a visitor: no launcher entry, no window on request, no chunk fetched and no
// agent address anywhere in what the page loaded. For the owner it is driven
// through /__jarvispreview, which mounts the REAL DesktopOS with the gate
// forced open (ignored in production; the page 404s there) and a fake socket.
async function jarvisSuite(browser) {
  console.log("\njarvis: owner-only agent desktop in the OS");
  const OWNER_CODE = /jarvis|workbench|AgentPanel|agentClient/i;

  /* ---- anonymous visitor ---- */
  {
    const page = await browser.newPage();
    await page.bringToFront();
    await withMode(page, "dev");
    const urls = [];
    page.on("request", (r) => urls.push(r.url()));
    try {
      await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 3500));
      await page.evaluate(() => document.querySelector('[aria-label*="All apps"]')?.click());
      await new Promise((r) => setTimeout(r, 800));
      const apps = await page.evaluate(() => Array.from(document.querySelectorAll(".os-lp-app")).map((a) => a.textContent.trim()));
      check(apps.length > 5, "the launcher lists the public apps", String(apps.length));
      check(!apps.some((a) => /jarvis/i.test(a)), "a visitor's launcher has no Jarvis");
      await page.type(".os-lp-search input", "jarvis");
      await new Promise((r) => setTimeout(r, 300));
      const hits = await page.evaluate(() => Array.from(document.querySelectorAll(".os-sp-row")).map((r) => r.textContent));
      check(!hits.some((h) => /jarvis/i.test(h)), "and Spotlight finds no Jarvis", JSON.stringify(hits).slice(0, 80));
      await page.keyboard.press("Escape");

      // Asking the shell for it directly must do nothing at all.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("os:open", { detail: "jarvis" })));
      await new Promise((r) => setTimeout(r, 1500));
      const after = await page.evaluate(() => ({
        win: !!document.querySelector('.os-win[aria-label^="Jarvis"]'),
        jv: !!document.querySelector(".jv-root"),
        html: document.documentElement.outerHTML,
      }));
      check(!after.win && !after.jv, "an os:open for jarvis opens no window");
      check(!/jarvis/i.test(after.html), "the visitor's DOM never names Jarvis");
      check(!/agent\.ravikishan\.me|wss:\/\//i.test(after.html), "and carries no agent address");

      const owned = urls.filter((u) => OWNER_CODE.test(u));
      check(owned.length === 0, "no Jarvis or workbench chunk is requested", owned.slice(0, 3).join(" "));

      // The scripts the visitor DID load must not carry the agent's address.
      const scripts = [...new Set(urls.filter((u) => u.startsWith(BASE) && /\.js(\?|$)/.test(u)))];
      let leaked = "";
      for (const u of scripts) {
        const body = await fetch(u).then((r) => r.text()).catch(() => "");
        if (/agent\.ravikishan\.me/.test(body)) {
          leaked = u;
          break;
        }
      }
      check(scripts.length > 0 && !leaked, "no loaded script contains the agent server's address", leaked || `${scripts.length} scripts`);
    } catch (e) {
      bad("jarvis anonymous", e.message);
    } finally {
      await page.close();
    }
  }

  /* ---- the owner, through the preview ---- */
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const at = `@${width}`;
    const page = await browser.newPage();
    await page.bringToFront();
    await page.setViewport({ width, height });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !/favicon|Failed to load resource/i.test(m.text())) errors.push(m.text());
    });
    try {
      await page.goto(`${BASE}/__jarvispreview`, { waitUntil: "networkidle2", timeout: 90000 });
      await page.waitForSelector('.os-win[aria-label^="Jarvis"] .jv-root', { timeout: 30000 });
      await page.waitForSelector(".jv-root .wb-shot", { timeout: 20000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 600));

      const s = await page.evaluate(() => {
        const win = document.querySelector('.os-win[aria-label^="Jarvis"]');
        const r = win.getBoundingClientRect();
        const root = win.querySelector(".jv-root");
        const body = win.querySelector(".jv-body");
        const shot = win.querySelector(".wb-shot");
        const sel = win.querySelector('.jv-tab[aria-selected="true"]');
        const take = win.querySelector(".wb-take");
        const bar = win.querySelector(".jv-bar").getBoundingClientRect();
        return {
          vw: innerWidth,
          vh: innerHeight,
          r: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height },
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          inner: root.scrollWidth - root.clientWidth,
          body: body.scrollWidth - body.clientWidth,
          barFits: bar.right <= r.right + 1,
          tab: sel && sel.dataset.tab,
          tabs: Array.from(win.querySelectorAll(".jv-tab")).map((t) => t.dataset.tab),
          shot: !!shot && /^data:image\//.test(shot.getAttribute("src") || ""),
          shotW: shot ? shot.getBoundingClientRect().width : 0,
          shotFits: !!shot && shot.getBoundingClientRect().right <= r.right + 1,
          take: take ? take.textContent.trim() : "",
          pressed: take ? take.getAttribute("aria-pressed") : "",
          watching: ((win.querySelector(".wb-drive") || {}).textContent || "").trim(),
          badge: ((win.querySelector('.jv-tab[data-tab="runs"] em') || {}).textContent || ""),
        };
      });
      check(s.r.left >= 0 && s.r.right <= s.vw + 1, `${at} the window sits inside the viewport`, JSON.stringify(s.r));
      check(s.r.w >= s.vw * 0.88 && s.r.h >= s.vh * 0.6, `${at} it opens large: most of the viewport`, `${Math.round(s.r.w)}x${Math.round(s.r.h)} of ${s.vw}x${s.vh}`);
      check(s.overflow <= 0, `${at} nothing overflows the page sideways`, `${s.overflow}px`);
      check(s.inner <= 1 && s.body <= 1, `${at} nothing overflows inside the window`, `${s.inner}/${s.body}px`);
      check(s.barFits, `${at} the tab bar fits the window`);
      check(JSON.stringify(s.tabs) === JSON.stringify(["desktop", "chat", "terminal", "runs"]), `${at} tabs: Desktop, Chat, Terminal, Runs`, s.tabs.join(","));
      check(s.tab === "desktop", `${at} Desktop is the default tab`, s.tab);
      check(s.shot && s.shotW > 200 && s.shotFits, `${at} the screenshot stream shows the seeded frame, inside the window`, `${Math.round(s.shotW)}px`);
      check(s.take === "Take control" && s.pressed === "false", `${at} it opens view-only`, `${s.take} ${s.pressed}`);
      check(/watching/i.test(s.watching), `${at} and says it is only watching`, s.watching);
      check(s.badge === "1", `${at} Runs carries the waiting approval as a badge`, s.badge);

      // View-only means a click on the picture reaches nothing.
      await page.click(".jv-root .wb-shot");
      await new Promise((r) => setTimeout(r, 500));
      const quiet = await page.evaluate(() => (window.__jvActions || []).length);
      check(quiet === 0, `${at} a click while watching sends nothing`, String(quiet));

      // Taking control: a click on the picture maps to screen pixels.
      await page.click(".jv-root .wb-take");
      await page.click(".jv-root .wb-shot");
      await new Promise((r) => setTimeout(r, 700));
      const acted = await page.evaluate(() => ({
        actions: window.__jvActions || [],
        driving: !!document.querySelector(".jv-root .wb-screen.driving"),
      }));
      const a = acted.actions[0] || {};
      check(acted.driving, `${at} Take control puts the amber driving edge on the frame`);
      check(a.action === "click" && a.x >= 0 && a.x < 1600 && a.y >= 0 && a.y < 900, `${at} and a click there becomes a click on the box`, JSON.stringify(a));

      // Runs: only what is live, the waiting one first, its approval above.
      await page.click('.jv-tab[data-tab="runs"]');
      await page.waitForSelector(".jv-run", { timeout: 5000 });
      const runs = await page.evaluate(() => ({
        rows: Array.from(document.querySelectorAll(".jv-run")).map((r) => r.dataset.state),
        card: !!document.querySelector(".jv-asks .ag-card"),
        shotGone: !document.querySelector(".wb-shot"),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      check(JSON.stringify(runs.rows) === JSON.stringify(["waiting", "stalled", "running"]), `${at} Runs lists only live runs, waiting first`, runs.rows.join(","));
      check(runs.card, `${at} the waiting run's approval card is on Runs`);
      check(runs.shotGone, `${at} leaving Desktop unmounts the stream`);
      check(runs.overflow <= 0, `${at} Runs does not overflow`, `${runs.overflow}px`);
      const shotsA = await page.evaluate(() => window.__jvShots || 0);
      await new Promise((r) => setTimeout(r, 2200));
      const shotsB = await page.evaluate(() => window.__jvShots || 0);
      check(shotsB === shotsA, `${at} and stops polling for frames`, `${shotsA} -> ${shotsB}`);

      await page.click('.jv-tab[data-tab="chat"]');
      await page.waitForSelector(".jv-root .wb-chat", { timeout: 5000 });
      const chat = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        inner: (() => { const b = document.querySelector(".jv-body"); return b.scrollWidth - b.clientWidth; })(),
      }));
      check(chat.overflow <= 0 && chat.inner <= 1, `${at} Chat renders inside the window without overflow`, `${chat.overflow}/${chat.inner}px`);

      await page.click('.jv-tab[data-tab="terminal"]');
      await new Promise((r) => setTimeout(r, 600));
      const term = await page.evaluate(() => ({
        tab: (document.querySelector('.jv-tab[aria-selected="true"]') || {}).dataset?.tab,
        text: (document.querySelector(".jv-body") || {}).innerText || "",
      }));
      check(term.tab === "terminal" && term.text.trim().length > 10, `${at} Terminal renders`, term.text.slice(0, 60));

      // Closing the window closes the socket. Counted from here: React's
      // StrictMode mounts, unmounts and remounts in development, which is
      // itself one close of a socket that never got to open.
      const before = await page.evaluate(() => window.__jvClosed || 0);
      await page.click('.os-win[aria-label^="Jarvis"] .os-l.red');
      await new Promise((r) => setTimeout(r, 700));
      const closed = await page.evaluate(() => ({
        win: !!document.querySelector('.os-win[aria-label^="Jarvis"]'),
        closed: window.__jvClosed || 0,
      }));
      check(!closed.win && closed.closed === before + 1, `${at} closing the window disconnects the socket`, JSON.stringify({ ...closed, before }));
      check(errors.length === 0, `${at} no errors in the console`, errors.slice(0, 2).join(" | "));
    } catch (e) {
      bad(`jarvis ${at}`, e.message);
    } finally {
      await page.close();
    }
  }

  /* ---- a socket that cannot connect says why, in the window ---- */
  {
    const page = await browser.newPage();
    await page.bringToFront();
    await page.setViewport({ width: 390, height: 844 });
    try {
      await page.goto(`${BASE}/__jarvispreview?fail=1`, { waitUntil: "networkidle2", timeout: 90000 });
      await page.waitForSelector(".jv-root .jv-down", { timeout: 30000 });
      const d = await page.evaluate(() => ({
        text: (document.querySelector(".jv-down") || {}).innerText || "",
        inWin: !!document.querySelector('.os-win[aria-label^="Jarvis"] .jv-down'),
        shot: !!document.querySelector(".wb-shot"),
        retry: !!Array.from(document.querySelectorAll(".jv-down button")).find((b) => /try now/i.test(b.textContent)),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      check(d.inWin && /can.t reach/i.test(d.text), "an unreachable server is said inside the window");
      check(/not allowed/i.test(d.text), "with the reason the server gave", d.text.slice(0, 90));
      check(d.retry && !d.shot, "offering Try now instead of an empty frame");
      check(d.overflow <= 0, "and fits a phone", `${d.overflow}px`);
    } catch (e) {
      bad("jarvis unreachable", e.message);
    } finally {
      await page.close();
    }
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

async function agentSuite(browser) {
  console.log("\nagent: the approval card is the product");
  const page = await browser.newPage();
  await page.bringToFront();
  await withMode(page, "recruiter");
  try {
    await page.goto(`${BASE}/__agentpreview?noload`, { waitUntil: "networkidle2", timeout: 45000 });
    await page.waitForSelector(".ag-card", { timeout: 30000 });

    const card = await page.evaluate(() => {
      const deny = document.querySelector(".ag-deny");
      const allow = document.querySelector(".ag-allow");
      const d = deny.getBoundingClientRect();
      const a = allow.getBoundingClientRect();
      return {
        cmd: document.querySelector(".ag-card-cmd")?.textContent || "",
        note: document.querySelector(".ag-card-note")?.textContent || "",
        clock: document.querySelector(".ag-card-clock")?.textContent || "",
        denyArea: d.width * d.height,
        allowArea: a.width * a.height,
        denyFirst: d.top < a.top || (Math.abs(d.top - a.top) < 2 && d.left < a.left),
      };
    });

    // The exact command, not a summary of it. "Run a git command" is not
    // something anyone can meaningfully approve.
    check(/git push -u origin/.test(card.cmd), "the card shows the literal command", card.cmd);
    // A mistaken deny costs a tap; a mistaken allow costs a repository.
    check(card.denyArea > card.allowArea * 2, "Deny is a much larger target than Allow", `${Math.round(card.denyArea)} vs ${Math.round(card.allowArea)}`);
    check(card.denyFirst, "and comes first");
    check(/No answer means no/i.test(card.note), "the card states that silence is a refusal", card.note);
    check(/left$/.test(card.clock.trim()), "and shows how long is left", card.clock);

    // Hydration: the mic button and the countdown both differ between server
    // and client, so both must be decided after mount. A mismatch here used to
    // blank the whole panel behind an error overlay.
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForSelector(".ag-card", { timeout: 20000 });
    check(
      !errors.some((e) => /hydrat/i.test(e)),
      "the panel hydrates without a mismatch",
      errors.find((e) => /hydrat/i.test(e)) || ""
    );

    const body = await page.evaluate(() => document.body.innerText);
    // The transcript is redacted on the SERVER; this asserts the panel is not
    // quietly undoing that.
    check(/•{4,}/.test(body), "a secret in the transcript renders masked");
    check(!/ghp_[A-Za-z0-9]/.test(body), "and no raw token reaches the page");

    // `.text` is a global unscoped rule in _map.scss. A transcript line using
    // it renders as a white Poppins heading, which is how it first shipped.
    const lines = await page.evaluate(() =>
      [...document.querySelectorAll(".ag-line")].map((x) => ({
        cls: x.className,
        size: parseFloat(getComputedStyle(x).fontSize),
        family: getComputedStyle(x).fontFamily,
      }))
    );
    check(lines.length > 0, "the transcript renders lines", String(lines.length));
    check(
      lines.every((l) => l.size < 14),
      "no line inherits the global .text rule and renders heading-sized",
      JSON.stringify(lines.find((l) => l.size >= 14) || {})
    );
    check(
      lines.every((l) => /Mono/.test(l.family)),
      "and every line keeps the monospace face",
      JSON.stringify(lines.find((l) => !/Mono/.test(l.family)) || {})
    );

    // The run board answers "is it stuck" — grouped by that answer, and the
    // answer is said in words on the row, not left to a colour.
    for (const width of [390, 768, 1440]) {
      await page.setViewport({ width, height: 900 });
      await page.goto(`${BASE}/__agentpreview?noload`, { waitUntil: "networkidle2", timeout: 45000 });
      await page.waitForSelector(".ag-run", { timeout: 30000 });
      await page.waitForFunction(() => /left/.test(document.querySelector(".ag-card-clock")?.textContent || ""), { timeout: 10000 }).catch(() => {});
      const at = `@${width}`;
      const b = await page.evaluate(() => {
        const row = (id) => document.querySelector(`.ag-run[data-job="${id}"]`);
        const verdictOf = (id) => row(id)?.querySelector(".ag-verdict")?.textContent || "";
        const logins = [...document.querySelectorAll(".ag-login")].map((l) => l.textContent);
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          rows: document.querySelectorAll(".ag-run").length,
          groups: [...document.querySelectorAll(".ag-group")].map((g) => [...g.classList].find((c) => c !== "ag-group")),
          stuck: row("j_stuck")?.className || "",
          stuckVerdict: verdictOf("j_stuck"),
          stuckMeter: !!row("j_stuck")?.querySelector(".ag-quiet.stuck"),
          waitVerdict: verdictOf("j_wait"),
          waitMeter: !!row("j_wait")?.querySelector(".ag-quiet"),
          failed: row("j_fail")?.className || "",
          done: row("j_done")?.className || "",
          stopButtons: document.querySelectorAll(".ag-run .ag-stop").length,
          tabs: document.querySelectorAll(".ag-tab").length,
          devcode: document.querySelector(".ag-devcode")?.textContent || "",
          logins,
          orgSelect: [...document.querySelectorAll(".ag-new select")].map((s) => s.value),
          startLabel: document.querySelector(".ag-start")?.textContent || "",
          body: document.body.innerText,
        };
      });
      check(b.overflow <= 0, `the agent panel does not overflow sideways ${at}`, `${b.overflow}px`);
      check(b.rows === 5, `every run is on the board ${at}`, String(b.rows));
      check(b.groups.join(",") === "ask,stuck,run,end", `grouped waiting / stuck / running / finished, in that order ${at}`, b.groups.join(","));
      check(/\bstuck\b/.test(b.stuck) && b.stuckMeter, `a stalled run carries the stuck edge and a full meter ${at}`, b.stuck);
      check(/No output for 7m/.test(b.stuckVerdict) && /41m/.test(b.stuckVerdict), `and says how long it has been silent ${at}`, b.stuckVerdict);
      // A job waiting on a person is blocked, not drifting towards stuck.
      check(/Waiting on you/.test(b.waitVerdict) && !b.waitMeter, `a waiting run is not counted towards stuck ${at}`, b.waitVerdict);
      check(/\bbad\b/.test(b.failed) && /\bok\b/.test(b.done) && !/\bok\b/.test(b.failed), `a failed run does not look like a finished one ${at}`, `${b.failed} | ${b.done}`);
      check(b.stopButtons === 3, `only live runs offer Stop ${at}`, String(b.stopButtons));
      check(b.tabs === 4, `the four tabs are present ${at}`, String(b.tabs));
      check(b.devcode === "KQ7M-W2PD", `a relayed Codex sign-in shows its device code ${at}`, b.devcode);
      check(b.logins.some((t) => /pasted token, ending x9Qa/.test(t)), `a signed-in profile shows only the last four ${at}`);
      check(b.orgSelect.includes("relax") && /Relax/.test(b.startLabel), `a new run starts in the current org ${at}`, `${b.orgSelect} / ${b.startLabel}`);
      check(!/sk-ant-|ghp_[A-Za-z0-9]/.test(b.body), `no raw credential reaches the page ${at}`);
    }

    // The paste field is a password input, and it is empty after sending.
    await page.setViewport({ width: 1440, height: 900 });
    const pasteBtn = await page.evaluateHandle(() =>
      [...document.querySelectorAll('.ag-login[data-tool="codex"] .ag-ghost')].find((x) => /Paste|Replace/.test(x.textContent)) || null
    );
    if (pasteBtn.asElement()) {
      await pasteBtn.asElement().click();
      await page.waitForSelector('.ag-paste input[type="password"]', { timeout: 5000 });
      const kind = await page.$eval(".ag-paste input", (i) => i.type);
      check(kind === "password", "the credential field is a password input", kind);
      await page.type(".ag-paste input", "sk-proj-previewOnly0000WXYZ");
      await page.click('.ag-paste button[type="submit"]');
      await new Promise((r) => setTimeout(r, 300));
      const after = await page.evaluate(() => ({
        field: !!document.querySelector(".ag-paste input"),
        body: document.body.innerText,
      }));
      check(!after.field, "the field is gone once the credential is sent");
      check(!/previewOnly/.test(after.body), "and the credential is not echoed back", "");
    } else {
      bad("a profile offers to paste a credential", "no button");
    }
  } catch (e) {
    bad("agent panel", e.message);
  } finally {
    await page.close();
  }
}

async function workbenchSuite(browser) {
  console.log("\nworkbench: chat, desktop, terminal, previews and review");
  const page = await browser.newPage();
  await page.bringToFront();
  await withMode(page, "recruiter");
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource/i.test(m.text())) errors.push(m.text());
  });
  const go = async () => {
    await page.goto(`${BASE}/__workbenchpreview`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector(".wb-switch .wb-sw", { timeout: 30000 });
    await page.waitForSelector(".wb-transcript", { timeout: 20000 });
  };
  const view = async (k) => {
    await page.evaluate((k) => document.querySelector(`.wb-sw[data-view="${k}"]`)?.click(), k);
    await page.waitForSelector(`[data-section="${k}"]`, { timeout: 10000 });
  };
  try {
    for (const width of [390, 768, 1440]) {
      const at = `@${width}`;
      await page.setViewport({ width, height: 900 });
      await go();

      /* ---- chat ---- */
      const c = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const tools = [...document.querySelectorAll(".wb-tool")].map((t) => ({ state: t.dataset.toolState, open: t.open, text: t.textContent }));
        const inline = q(".wb-transcript .wb-tool-wrap .ag-card");
        const deny = inline?.querySelector(".ag-deny")?.getBoundingClientRect();
        const allow = inline?.querySelector(".ag-allow")?.getBoundingClientRect();
        const code = q(".wb-code pre");
        const transcript = q(".wb-transcript");
        const switcher = q(".wb-switch");
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          tools,
          inline: !!inline,
          inlineAfterPush: !!inline && /git push/.test(inline.closest(".wb-tool-wrap")?.querySelector(".wb-tool")?.textContent || ""),
          denyFirst: !!deny && !!allow && (deny.top < allow.top - 1 || (Math.abs(deny.top - allow.top) < 2 && deny.left < allow.left)),
          denyBigger: !!deny && !!allow && deny.width * deny.height > allow.width * allow.height,
          status: q(".wb-status")?.textContent || "",
          statusLive: q(".wb-status")?.getAttribute("aria-live") || "",
          caret: !!q(".wb-say.is-streaming .wb-caret"),
          codeScrolls: !!code && code.scrollWidth > code.clientWidth,
          codeFits: !!code && !!transcript && code.getBoundingClientRect().right <= transcript.getBoundingClientRect().right + 1,
          chips: document.querySelectorAll(".wb-chip").length,
          fixedChips: document.querySelectorAll(".wb-chip.fixed").length,
          interrupt: !!q(".wb-interrupt"),
          send: !!q(".wb-send"),
          listShown: getComputedStyle(q(".wb-chat-list")).display !== "none",
          switchPos: getComputedStyle(switcher).position,
          tabsShown: [...document.querySelectorAll(".wb-sw")].filter((b) => getComputedStyle(b).display !== "none").map((b) => b.dataset.view || "more"),
          proseMono: [...document.querySelectorAll(".wb-prose")].some((p) => /Mono/.test(getComputedStyle(p).fontFamily)),
          proseSize: Math.max(...[...document.querySelectorAll(".wb-prose")].map((p) => parseFloat(getComputedStyle(p).fontSize))),
          headingColor: getComputedStyle(q(".wb-chat-title h4")).color,
          body: document.body.innerText,
        };
      });
      check(c.overflow <= 0, `the workbench does not overflow sideways ${at}`, `${c.overflow}px`);
      const failed = c.tools.find((t) => /npm run test:notes/.test(t.text));
      check(failed?.state === "bad" && failed.open && /failed/.test(failed.text), `a failed tool call is red, open and says failed ${at}`, JSON.stringify(failed || {}).slice(0, 120));
      check(c.tools.filter((t) => t.state === "ok").length === 2, `finished tool calls read as done ${at}`, String(c.tools.filter((t) => t.state === "ok").length));
      check(c.inline && c.inlineAfterPush, `the approval sits inline, under the call it is about ${at}`);
      check(c.denyFirst && c.denyBigger, `and Deny is the first, larger target ${at}`);
      check(/waiting for your answer/i.test(c.status) && c.statusLive === "polite", `the chat says it is waiting on you, in a live region ${at}`, c.status);
      check(c.caret, `streamed text shows it is still arriving ${at}`);
      check(c.codeScrolls && c.codeFits, `a long code block scrolls inside itself ${at}`);
      check(c.chips === 6 && c.fixedChips === 6, `a running chat shows its six settings as fixed labels ${at}`, `${c.chips}/${c.fixedChips}`);
      check(c.interrupt && !c.send, `while it works the send button is Interrupt ${at}`);
      check(!c.proseMono && c.proseSize < 16, `prose is not monospace and does not inherit a heading size ${at}`);
      check(c.headingColor !== "rgb(0, 0, 0)" && !/rgb\(1[0-9], /.test(c.headingColor), `the conversation title is not pinned to the light-theme ink ${at}`, c.headingColor);
      check(!/never-shown|ghp_[A-Za-z0-9]|sk-ant-/.test(c.body), `no raw credential reaches the page ${at}`);

      if (width < 1000) {
        check(c.switchPos === "fixed", `on a phone the switcher is a bar at the bottom ${at}`, c.switchPos);
        check(c.tabsShown.join(",") === "chat,desktop,terminal,previews,review,more", `with the five views and More ${at}`, c.tabsShown.join(","));
        check(!c.listShown, `one pane at a time: the conversation, not the list ${at}`);
        await page.click(".wb-to-list");
        const listed = await page.evaluate(() => ({
          list: getComputedStyle(document.querySelector(".wb-chat-list")).display !== "none",
          main: getComputedStyle(document.querySelector(".wb-chat-main")).display !== "none",
        }));
        check(listed.list && !listed.main, `Conversations opens the list in its place ${at}`);
        await page.click(".wb-sw-more");
        const sheet = await page.$$eval(".wb-more-sheet button", (b) => b.map((x) => x.textContent.trim()));
        check(sheet.length === 4 && /Runs/.test(sheet[0]), `More holds Runs, Accounts, Features and WhatsApp ${at}`, sheet.join("|"));
        await page.keyboard.press("Escape");
      } else {
        check(c.switchPos !== "fixed", `on a desk the switcher sits at the top ${at}`, c.switchPos);
        check(c.tabsShown.length === 9 && !c.tabsShown.includes("more"), `every view is a tab, no More ${at}`, c.tabsShown.join(","));
        check(c.listShown, `conversations and the open one sit side by side ${at}`);
      }

      // History is searched, not looked at.
      if (width >= 1000) {
        const rows0 = await page.$$eval(".wb-srow[data-session]", (r) => r.length);
        check(rows0 === 20, `history shows 20 of 30 until asked for more ${at}`, String(rows0));
        await page.type(".wb-search", "cgroup port");
        const rows = await page.$$eval(".wb-srow[data-session]", (r) => r.map((x) => x.textContent));
        check(rows.length === 3 && rows.every((t) => /cgroup/i.test(t)), `search narrows by every word ${at}`, String(rows.length));
        await page.click(".wb-srow[data-session]");
        const resume = await page.evaluate(() => ({
          btn: [...document.querySelectorAll(".wb-resume button")].map((b) => b.textContent),
          composer: !!document.querySelector(".wb-composer"),
        }));
        check(/Resume/.test(resume.btn[0] || "") && !resume.composer, `a past conversation opens read-only, with Resume ${at}`);
      }

      /* ---- desktop ---- */
      // The box has no VNC (x11vnc cannot run under SELinux enforcing), so the
      // default is the screenshot stream; the preview feeds it a static frame.
      await go();
      await view("desktop");
      await page.evaluate(() => (window.__wbDesktopActions = []));
      await page.waitForSelector('[data-section="desktop"] .wb-shot', { timeout: 10000 });
      const ds = await page.evaluate(() => {
        const sec = document.querySelector('[data-section="desktop"]');
        const img = sec.querySelector(".wb-shot");
        const r = img.getBoundingClientRect();
        const scr = sec.querySelector(".wb-screen").getBoundingClientRect();
        return {
          status: sec.querySelector(".wb-drive")?.textContent || "",
          statusLive: sec.querySelector(".wb-drive")?.getAttribute("aria-live") || "",
          how: sec.querySelector(".wb-desk-how")?.textContent || "",
          age: sec.querySelector(".wb-age")?.textContent || "",
          ageLive: sec.querySelector(".wb-age")?.getAttribute("aria-live") || "",
          take: sec.querySelector(".wb-take")?.disabled,
          driving: !!sec.querySelector(".wb-screen.driving"),
          deck: !!sec.querySelector(".wb-deck"),
          alt: img.alt,
          fits: r.width > 0 && r.right <= scr.right + 1 && Math.abs(r.width / r.height - 16 / 9) < 0.02,
          log: sec.querySelectorAll(".wb-dlog-list li").length,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      check(/Watching\. Nothing you do here reaches the box/.test(ds.status) && ds.statusLive === "polite", `the stream opens watching, said in a live region ${at}`, ds.status);
      check(/Screenshot stream/.test(ds.how) && /VNC off/.test(ds.how), `it says it is the screenshot stream because VNC is off ${at}`, ds.how);
      check(/updated just now|a few seconds/.test(ds.age) && ds.ageLive === "polite", `the frame's age is shown, in a live region ${at}`, ds.age);
      check(ds.take === false && !ds.driving && !ds.deck, `Take control is offered, nothing is driving yet ${at}`);
      check(ds.fits, `the frame keeps the screen's shape and fits the pane ${at}`);
      check(/desktop, 1600 by 900/.test(ds.alt), `the picture says what it is ${at}`, ds.alt);
      check(ds.log === 4, `the side log lists desktop and browser actions only ${at}`, String(ds.log));
      check(ds.overflow <= 0, `the stream does not overflow ${at}`, `${ds.overflow}px`);

      // A click while only watching sends nothing.
      await page.click('[data-section="desktop"] .wb-shot');
      await new Promise((r) => setTimeout(r, 400));
      check((await page.evaluate(() => window.__wbDesktopActions.length)) === 0, `a click while watching reaches nothing ${at}`);

      await page.click('[data-section="desktop"] .wb-take');
      await page.waitForSelector('[data-section="desktop"] .wb-deck', { timeout: 5000 });
      const dv = await page.evaluate(() => {
        const sec = document.querySelector('[data-section="desktop"]');
        const scr = sec.querySelector(".wb-screen.driving");
        return {
          driving: !!scr,
          edge: scr ? getComputedStyle(scr).borderTopColor : "",
          status: sec.querySelector(".wb-drive")?.textContent || "",
          keys: [...sec.querySelectorAll(".wb-key[data-combo]")].map((b) => b.dataset.combo).join(","),
          scrolls: [...sec.querySelectorAll(".wb-key")].filter((b) => /Scroll/.test(b.textContent)).length,
          type: !!sec.querySelector('input[aria-label="Text to type on the desktop"]'),
          url: !!sec.querySelector('input[aria-label="Address to open on the desktop"]'),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      check(dv.driving && dv.edge === "rgb(255, 176, 32)", `Take control puts the amber edge on the frame ${at}`, dv.edge);
      check(/You are driving/.test(dv.status), `and says you are driving ${at}`, dv.status);
      check(dv.keys === "Return,Escape,Tab,BackSpace,ctrl+l,ctrl+t,ctrl+w,ctrl+r,alt+Tab" && dv.scrolls === 2, `the key row and scroll buttons are there ${at}`, dv.keys);
      check(dv.type && dv.url, `with a text field and an Open URL field ${at}`);
      check(dv.overflow <= 0, `driving does not overflow ${at}`, `${dv.overflow}px`);

      // Clicks at known spots on the picture map to screen pixels.
      // Measured before every click: anything that reflows above the frame
      // between two clicks would otherwise move the target.
      const clickAt = async (fx, fy, opts = {}) => {
        await page.$eval('[data-section="desktop"] .wb-shot', (img) => img.scrollIntoView({ block: "center" }));
        const b = await page.$eval('[data-section="desktop"] .wb-shot', (img) => {
          const r = img.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        });
        await page.mouse.click(b.x + b.w * fx, b.y + b.h * fy, opts);
      };
      await clickAt(0.25, 0.5);
      await page.waitForFunction(() => window.__wbDesktopActions.length >= 1, { timeout: 3000 });
      await clickAt(0.75, 0.25, { button: "right" });
      await clickAt(0.5, 0.5, { count: 2 });
      await new Promise((r) => setTimeout(r, 500));
      await page.click('[data-section="desktop"] .wb-key[data-combo="ctrl+l"]');
      await page.type('[data-section="desktop"] input[aria-label="Text to type on the desktop"]', "hello box");
      await page.keyboard.press("Enter");
      await page.type('[data-section="desktop"] input[aria-label="Address to open on the desktop"]', "ravikishan.me/blog");
      await page.keyboard.press("Enter");
      await new Promise((r) => setTimeout(r, 300));
      const acts = await page.evaluate(() => window.__wbDesktopActions);
      // One CSS pixel of a 350px-wide phone frame is ~4.6 screen pixels, so the
      // tolerance is a CSS pixel's worth, not a fixed 3.
      const tol = Math.ceil(1600 / (await page.$eval('[data-section="desktop"] .wb-shot', (i) => i.getBoundingClientRect().width))) + 1;
      const click = acts[0] || {};
      check(click.action === "click" && click.button === "left" && Math.abs(click.x - 400) <= tol && Math.abs(click.y - 450) <= tol, `a click on the picture lands on screen pixels ${at}`, JSON.stringify(click));
      const right = acts.find((a) => a.button === "right") || {};
      check(right.action === "click" && Math.abs(right.x - 1200) <= tol && Math.abs(right.y - 225) <= tol, `a right-click is a right-click there ${at}`, JSON.stringify(right));
      const dbl = acts.filter((a) => a.action === "double_click");
      const middleClicks = acts.filter((a) => a.action === "click" && a.button === "left" && Math.abs(a.x - 800) <= tol);
      check(dbl.length === 1 && middleClicks.length === 0, `a double-click is ONE double_click, not two clicks and one ${at}`, JSON.stringify(acts.map((a) => a.action)));
      check(acts.some((a) => a.action === "key" && a.combo === "ctrl+l"), `a key button sends its combo ${at}`);
      check(acts.some((a) => a.action === "type" && a.text === "hello box"), `typed text is sent as type ${at}`);
      check(acts.some((a) => a.action === "open_url" && a.url === "https://ravikishan.me/blog"), `Open URL adds https:// to a bare address ${at}`);
      const said = await page.$eval('[data-section="desktop"] .wb-deck .wb-note', (n) => ({ text: n.textContent, live: n.getAttribute("aria-live") }));
      check(/Sent: opened https:\/\/ravikishan\.me\/blog/.test(said.text) && said.live === "polite", `what was sent is said back ${at}`, said.text);

      await page.click('[data-section="desktop"] .wb-take');
      check(!(await page.$('[data-section="desktop"] .wb-screen.driving')) && !(await page.$('[data-section="desktop"] .wb-deck')), `Hand back drops the amber edge and the controls ${at}`);

      // A key button shows a focus ring when reached from the keyboard.
      await page.focus('[data-section="desktop-stale"] input[aria-label="Text to type on the desktop"]');
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      const ring = await page.evaluate(() => {
        const a = document.activeElement;
        const cs = getComputedStyle(a);
        return a?.classList.contains("wb-key") ? `${cs.outlineStyle} ${cs.outlineWidth}` : `not a key: ${a?.className}`;
      });
      check(/solid|auto/.test(ring) && !/ 0px$/.test(ring), `a key button shows a focus ring from the keyboard ${at}`, ring);

      // A sign-in too old to drive: the refusal offers the sign-in in place.
      await page.click('[data-section="desktop-stale"] .wb-key[data-combo="Return"]');
      await page.waitForSelector('[data-section="desktop-stale"] .wb-stepup', { timeout: 3000 });
      const su = await page.evaluate(() => {
        const sec = document.querySelector('[data-section="desktop-stale"]');
        return {
          text: sec.querySelector(".wb-stepup")?.textContent || "",
          role: sec.querySelector(".wb-stepup")?.getAttribute("role") || "",
          btn: [...sec.querySelectorAll(".wb-stepup button")].map((b) => b.textContent).join("|"),
          err: sec.querySelector(".wb-deck .admin-err")?.textContent || "",
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      check(/sign-in from the last 30 minutes/.test(su.text) && su.role === "alert" && /Sign in again/.test(su.btn), `a stale sign-in is offered a step-up, not an error ${at}`, su.text.slice(0, 80));
      check(!su.err, `and no red error is shown for it ${at}`, su.err);
      check(su.overflow <= 0, `the step-up does not overflow ${at}`, `${su.overflow}px`);

      /* ---- desktop, disconnected ---- */
      const d = await page.evaluate(() => {
        const sec = document.querySelector('[data-section="desktop-off"]');
        return {
          empty: sec.querySelector(".wb-screen-empty")?.textContent || "",
          take: sec.querySelector(".wb-take")?.disabled,
          driving: !!sec.querySelector(".wb-screen.driving"),
          shot: !!sec.querySelector(".wb-shot"),
        };
      });
      check(/once the agent server is connected/.test(d.empty), `a disconnected desktop says so ${at}`, d.empty);
      check(d.take === true && !d.driving && !d.shot, `and cannot be taken control of ${at}`);

      /* ---- terminal ---- */
      await view("terminal");
      const t = await page.evaluate(() => ({
        open: [...document.querySelectorAll(".wb-term button")].find((b) => /Open a shell/.test(b.textContent))?.disabled,
        empty: document.querySelector(".wb-term .wb-screen-empty")?.textContent || "",
      }));
      check(t.open === true && /once the agent server is connected/.test(t.empty), `a disconnected terminal offers nothing to press ${at}`);

      /* ---- previews ---- */
      await view("previews");
      const p = await page.evaluate(() => ({
        ports: [...document.querySelectorAll(".wb-port")].map((x) => x.dataset.port),
        sandbox: document.querySelector(".wb-pframe iframe")?.getAttribute("sandbox") || "",
        expiry: document.querySelector(".wb-pexp")?.textContent || "",
      }));
      check(p.ports.join(",") === "3000,5173,8787", `every listening port is listed ${at}`, p.ports.join(","));
      check(/allow-scripts/.test(p.sandbox) && !/allow-top-navigation/.test(p.sandbox), `an opened preview is sandboxed and cannot navigate the admin ${at}`, p.sandbox);
      check(/more min/.test(p.expiry), `and says how long its access lasts ${at}`, p.expiry);

      /* ---- review ---- */
      await view("review");
      const r = await page.evaluate(() => ({
        rows: document.querySelectorAll(".wb-op").length,
        kinds: [...new Set([...document.querySelectorAll(".wb-op")].map((x) => x.dataset.kind))].sort().join(","),
        pinned: document.querySelectorAll(".wb-pinned .ag-card").length,
        pinnedFirst: (() => {
          const pin = document.querySelector(".wb-pinned");
          const ops = document.querySelector(".wb-ops");
          return !!pin && !!ops && pin.getBoundingClientRect().top < ops.getBoundingClientRect().top;
        })(),
        denied: !!document.querySelector(".wb-op.d-denied"),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
      check(r.rows === 12, `the timeline holds every entry ${at}`, String(r.rows));
      check(r.kinds === "approval,browser,command,desktop,file,preview,terminal", `with every kind the server records ${at}`, r.kinds);
      check(r.pinned === 2 && r.pinnedFirst, `approvals still waiting are pinned above it ${at}`, String(r.pinned));
      check(r.denied, `a denied action carries the red edge ${at}`);
      check(r.overflow <= 0, `the review view does not overflow ${at}`, `${r.overflow}px`);

      const pick = async (group, label) =>
        page.evaluate(
          (group, label) => [...document.querySelectorAll(`.wb-seg[aria-label="${group}"] button`)].find((b) => b.textContent.startsWith(label))?.click(),
          group,
          label
        );
      await pick("Who did it", "You");
      const you = await page.$$eval(".wb-op", (x) => x.map((o) => o.dataset.actor));
      check(you.length === 3 && you.every((a) => a === "owner"), `"You" shows only what you did ${at}`, you.join(","));
      await pick("Who did it", "Everyone");
      await pick("What kind", "Approvals");
      const ap = await page.$$eval(".wb-op", (x) => x.map((o) => o.dataset.kind));
      check(ap.length === 3 && ap.every((k) => k === "approval"), `the kind filter narrows to approvals ${at}`, ap.join(","));
      const counted = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.wb-seg[aria-label="What kind"] button')].find((x) => x.textContent.startsWith("Approvals"));
        return b?.querySelector("em")?.textContent || "";
      });
      check(counted === "3", `and its count promised exactly that ${at}`, counted);
    }

    check(!errors.length, "no page errors or console errors", errors.slice(0, 3).join(" | "));
    check(!errors.some((e) => /hydrat/i.test(e)), "the workbench hydrates without a mismatch");
  } catch (e) {
    bad("workbench", e.message);
  } finally {
    await page.close();
  }
}

async function whatsappSuite(browser) {
  console.log("\nwhatsapp: the warning stays, and it sends one at a time");
  const page = await browser.newPage();
  await page.bringToFront();
  await withMode(page, "recruiter");
  try {
    const states = ["warn", "connect", "qr", "live"];
    for (const st of states) {
      await page.goto(`${BASE}/__whatsapppreview?noload&state=${st}`, { waitUntil: "networkidle2", timeout: 45000 });
      await page.waitForSelector(".wa-warn", { timeout: 20000 });
      const seen = await page.evaluate(() => {
        const w = document.querySelector(".wa-warn");
        return { visible: !!w?.offsetHeight, text: w?.textContent || "" };
      });
      check(seen.visible, `the risk warning is visible in the "${st}" state`);
      if (st === "live") {
        // The one that matters: still there after connecting, because the risk
        // is still there after connecting.
        check(/banned/i.test(seen.text), "and still says accounts get banned once connected");
        check(/no bulk send/i.test(seen.text), "and that there is no bulk send");
      }
    }

    // --- the connected state ---
    const live = await page.evaluate(() => ({
      chats: document.querySelectorAll(".wa-chat").length,
      msgs: document.querySelectorAll(".wa-msg").length,
      mine: document.querySelectorAll(".wa-msg.mine").length,
      unread: document.querySelectorAll(".wa-unread").length,
      group: !!document.querySelector(".wa-chat-name i"),
      compose: document.querySelectorAll(".wa-compose textarea").length,
      sendButtons: document.querySelectorAll(".wa-compose button").length,
      logout: !!document.querySelector(".wa-logout"),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    check(live.chats === 3, "chats are listed", String(live.chats));
    check(live.msgs === 4 && live.mine === 1, "a thread renders, with my own messages distinguished", `${live.msgs}/${live.mine}`);
    check(live.unread === 1, "an unread count shows");
    check(live.group, "a group is marked as one");

    // ONE compose box, ONE send button, no recipient picker. A panel that can
    // address several chats at once is a bulk sender with extra steps.
    check(live.compose === 1 && live.sendButtons === 1, "there is exactly one compose box and one send button", `${live.compose}/${live.sendButtons}`);
    const pickers = await page.evaluate(
      () => document.querySelectorAll('.wa-compose select, .wa-compose input[type=checkbox], .wa select[multiple]').length
    );
    check(pickers === 0, "and no way to pick multiple recipients", String(pickers));
    check(live.logout, "logging out is offered, not just disconnecting");
    check(!live.overflow, "the panel does not overflow the page");

    // --- hydration ---
    // A locale-formatted timestamp is a different string on the server, and
    // the mismatch used to bury the panel under an error overlay.
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForSelector(".wa-msg", { timeout: 20000 });
    check(
      !errors.some((e) => /hydrat|does not match/i.test(e)),
      "the panel hydrates without a mismatch",
      errors.find((e) => /hydrat|does not match/i.test(e)) || ""
    );

    // --- the QR is drawn locally ---
    await page.goto(`${BASE}/__whatsapppreview?noload&state=qr`, { waitUntil: "networkidle2", timeout: 45000 });
    await page.waitForSelector(".wa-qr svg, .wa-qr-fallback", { timeout: 20000 });
    const qr = await page.evaluate(() => ({
      svg: !!document.querySelector(".wa-qr svg"),
      remote: [...document.querySelectorAll(".wa img, .wa svg image")].map((n) => n.getAttribute("src") || n.getAttribute("href") || "").filter(Boolean),
    }));
    check(qr.svg, "the pairing code renders as an inline svg");
    // A pairing code is a live credential while it is on screen. Handing it to
    // an image service to draw would be handing out the session.
    check(qr.remote.length === 0, "and is not fetched from an image service", JSON.stringify(qr.remote));
  } catch (e) {
    bad("whatsapp panel", e.message);
  } finally {
    await page.close();
  }
}

// /__memorypreview renders the REAL Memory panel parts inside the real
// AdminShell against a seed chosen for the states that matter: a guess beside
// a certainty (the edge weight IS the confidence), a memory nobody recalled in
// half a year, a superseded decision, a recall already run. The assertions are
// the ones a screenshot cannot make — that a pasted credential is refused
// BEFORE it is sent, and that archived memory stays out of view until asked.
async function memorySuite(browser) {
  console.log("\nmemory panel");
  const page = await browser.newPage();
  await page.bringToFront();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    for (const width of [390, 768, 1440]) {
      await page.setViewport({ width, height: 900 });
      await page.goto(`${BASE}/__memorypreview?noload`, { waitUntil: "networkidle2", timeout: 60000 });
      await page.waitForSelector(".mm-row", { timeout: 30000 });
      const at = `@${width}`;

      const seen = await page.evaluate(() => {
        const rows = [...document.querySelectorAll(".mm-list .mm-row")];
        const edgeOf = (r) => parseFloat(getComputedStyle(r).getPropertyValue("--mm-edge")) || 0;
        const byText = (re) => rows.find((r) => re.test(r.querySelector(".mm-text")?.textContent || ""));
        const sure = byText(/Amber #FFB020/);
        const guess = byText(/Probably prefers LinkedIn/);
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          state: document.querySelector(".mm-state")?.textContent || "",
          rows: rows.length,
          gone: rows.filter((r) => r.classList.contains("gone")).length,
          sureEdge: sure ? edgeOf(sure) : 0,
          guessEdge: guess ? edgeOf(guess) : 0,
          stale: document.querySelectorAll(".mm-list .mm-stale").length,
          open: document.querySelectorAll(".mm-row.open .mm-edit").length,
          recalled: document.querySelectorAll(".mm-recalled li").length,
          layers: [...document.querySelectorAll('.mm-chips[aria-label="Layer"] .mm-chip')].map((b) => b.textContent),
          search: !!document.querySelector(".mm-search"),
          remember: !!document.querySelector(".mm-new .mm-go"),
          scope: [...document.querySelectorAll('.mm-new [role="radio"]')].map((b) => b.getAttribute("aria-checked")),
        };
      });

      check(seen.overflow <= 0, `the memory panel does not overflow sideways ${at}`, `${seen.overflow}px`);
      check(/reach agents working in/.test(seen.state) && /relax/.test(seen.state), `the headline says who the memory reaches ${at}`, seen.state.slice(0, 90));
      check(/guess/.test(seen.state), `and counts the guesses ${at}`);
      check(seen.rows === 6 && seen.gone === 0, `archived memory is out of view until asked for ${at}`, `${seen.rows} rows, ${seen.gone} archived`);
      check(seen.sureEdge > seen.guessEdge && seen.guessEdge >= 1, `a certainty carries a heavier edge than a guess ${at}`, `${seen.sureEdge} vs ${seen.guessEdge}`);
      check(seen.stale >= 1, `a memory nobody recalls is marked stale ${at}`, String(seen.stale));
      check(seen.open === 1, `the opened row edits in place ${at}`, String(seen.open));
      check(seen.recalled > 0, `the recall probe lists what an agent would be handed ${at}`, String(seen.recalled));
      check(seen.layers.length === 3 && seen.search && seen.remember, `filters, search and Remember are present ${at}`, seen.layers.join("|"));
      check(seen.scope.filter((x) => x === "true").length === 1, `exactly one layer is chosen for a new memory ${at}`, seen.scope.join(","));
    }

    // Archived too: the replaced decision appears, with the dashed edge.
    await page.setViewport({ width: 1440, height: 900 });
    await page.click(".mm-arch input");
    await page.waitForSelector(".mm-row.gone", { timeout: 5000 }).catch(() => {});
    const arch = await page.evaluate(() => {
      const g = document.querySelector(".mm-row.gone");
      return { n: document.querySelectorAll(".mm-row.gone").length, meta: g?.querySelector(".mm-meta")?.textContent || "" };
    });
    check(arch.n === 1 && /replaced/.test(arch.meta), "Archived too shows the superseded decision as replaced", JSON.stringify(arch));

    // A pasted credential is refused as it is typed, and Remember cannot fire.
    // Assembled at run time so this file never holds a key-shaped literal.
    const fake = ["sk", "ant", "api03", "Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp"].join("-");
    await page.type("#mm-new-text", `the deploy key is ${fake}`);
    const sec = await page.evaluate(() => ({
      refuse: document.querySelector(".mm-new .mm-refuse")?.getAttribute("role") || "",
      text: document.querySelector(".mm-new .mm-refuse")?.textContent || "",
      disabled: document.querySelector(".mm-new .mm-go")?.disabled,
    }));
    check(sec.refuse === "alert", "a credential typed into Remember is refused in place");
    check(/Secrets/.test(sec.text), "and the refusal points at the secret store", sec.text.slice(0, 90));
    check(!sec.text.includes(fake), "and does not repeat the value");
    check(sec.disabled === true, "and Remember cannot be pressed");

    // An ordinary sentence goes through and lands at the top.
    await page.$eval("#mm-new-text", (t) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(t, "");
      t.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.type("#mm-new-text", "Kontainer integration tests need a cgroup v2 host.");
    await page.click(".mm-new .mm-go");
    await page.waitForFunction(() => /Remembered/.test(document.querySelector(".mm-new .mm-ok")?.textContent || ""), { timeout: 5000 }).catch(() => {});
    const added = await page.evaluate(() => ({
      ok: document.querySelector(".mm-new .mm-ok")?.textContent || "",
      first: document.querySelector(".mm-list .mm-row .mm-text")?.textContent || "",
      cleared: document.querySelector("#mm-new-text").value === "",
    }));
    check(/Remembered/.test(added.ok) && /cgroup v2/.test(added.first), "a plain sentence is remembered and listed first", added.first.slice(0, 60));
    check(added.cleared, "and the field clears");

    check(
      !errors.some((e) => /hydrat|does not match/i.test(e)),
      "the memory preview renders without a page error",
      errors.join(" | ").slice(0, 200)
    );
  } catch (e) {
    bad("memory panel", e.message);
  } finally {
    await page.close();
  }

  // /api/memory reads what every agent is handed, and can rewrite or delete
  // it. It must refuse anyone who is not the signed-in admin, on EVERY action
  // — an unknown one included — and the refusal must carry no memory.
  console.log("\n/api/memory refuses anonymous callers");
  const actions = [
    [{ action: "kinds" }, "kinds"],
    [{ action: "list" }, "list"],
    [{ action: "search", query: "deploy" }, "search"],
    [{ action: "recall", task: "write a LinkedIn post" }, "recall"],
    [{ action: "get", id: "m_pref_amber" }, "get"],
    [{ action: "remember", text: "Always deploy on Fridays.", kind: "preference", scope: "global" }, "remember"],
    [{ action: "update", id: "m_pref_amber", text: "Purple is fine." }, "update"],
    [{ action: "forget", id: "m_pref_amber", confirm: true }, "forget"],
    [{ action: "nonsense" }, "an unknown action"],
  ];
  for (const [body, name] of actions) {
    try {
      const res = await fetch(`${BASE}/api/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-org-id": "relax" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      check(res.status === 401, `/api/memory ${name} refuses an anonymous caller`, String(res.status));
      check(!/"memories"|"memory"|confidence|lastUsedAt/.test(text), `and the ${name} refusal carries no memory`, text.slice(0, 120));
    } catch (e) {
      bad(`memory ${name}`, e.message);
    }
  }
  try {
    const res = await fetch(`${BASE}/api/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer forged.not.ajwt" },
      body: JSON.stringify({ action: "list" }),
    });
    check(res.status === 401, "/api/memory refuses a forged bearer token", String(res.status));
  } catch (e) {
    bad("memory forged", e.message);
  }
  try {
    const res = await fetch(`${BASE}/api/memory`, { method: "GET" });
    check(res.status === 405, "/api/memory refuses a GET outright", String(res.status));
  } catch (e) {
    bad("memory GET", e.message);
  }
}

// /__orgspreview renders the REAL AdminShell (with its org switcher) and the
// Orgs panel's exported parts against a fixed seed: a login shared by two
// orgs, a login whose ONLY org is Relax, a legacy row, an org name long enough
// to wrap. The assertions are the ones a screenshot cannot make — that the one
// refusal that protects a credential (a login left in no org) happens in
// place, and that "which org am I acting in" is answered at every width.
async function orgsSuite(browser) {
  console.log("\norgs panel");
  const page = await browser.newPage();
  await page.bringToFront();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    for (const width of [390, 768, 1440]) {
      await page.setViewport({ width, height: 900 });
      await page.goto(`${BASE}/__orgspreview?noload`, { waitUntil: "networkidle2", timeout: 60000 });
      await page.waitForSelector(".og-login", { timeout: 30000 });
      const at = `@${width}`;

      const seen = await page.evaluate(() => {
        const rowFor = (label) =>
          [...document.querySelectorAll(".og-login")].find(
            (li) => (li.querySelector(".og-login-who")?.firstChild?.textContent || "").trim() === label
          );
        const chipsOf = (li) =>
          li
            ? [...li.querySelectorAll(".og-chip")].map((b) => ({
                name: b.textContent.trim(),
                on: b.classList.contains("on"),
                pressed: b.getAttribute("aria-pressed"),
                disabled: b.disabled,
              }))
            : null;
        const current = [...document.querySelectorAll(".og-org.on")];
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          current: current.length,
          currentName: current[0]?.querySelector(".og-org-name")?.textContent || "",
          actingPills: document.querySelectorAll(".og-acting").length,
          shared: chipsOf(rowFor("Ravi Kishan")),
          soleRelax: chipsOf(rowFor("Ravikisha")),
          legacy: chipsOf(rowFor("ravi@outlook.example")),
        };
      });

      check(seen.overflow <= 0, `nothing overflows sideways ${at}`, `${seen.overflow}px`);
      check(seen.current === 1 && seen.actingPills === 1, `exactly one org is marked as the one acted in ${at}`, `${seen.current}/${seen.actingPills}`);
      check(/Relax/.test(seen.currentName) && /Acting in/.test(seen.currentName), `and it is Relax, saying "Acting in" ${at}`, seen.currentName);

      const sharedOn = (seen.shared || []).filter((c) => c.on).map((c) => c.name);
      check(
        sharedOn.length === 2 && sharedOn.includes("Relax") && sharedOn.includes("Acme Labs"),
        `the shared channel shows both orgs filled ${at}`,
        JSON.stringify(sharedOn)
      );
      check((seen.shared || []).every((c) => c.pressed === String(c.on)), `a chip's aria-pressed matches what it shows ${at}`);
      check((seen.legacy || []).length > 0 && seen.legacy.every((c) => c.disabled), `a legacy row's chips cannot be pressed ${at}`);

      // The refusal that protects a credential: Relax is the ONLY org using
      // this login, so un-filing it would leave it in no org at all.
      const relaxChip = await page.evaluateHandle(() => {
        const li = [...document.querySelectorAll(".og-login")].find(
          (x) => (x.querySelector(".og-login-who")?.firstChild?.textContent || "").trim() === "Ravikisha"
        );
        return [...(li?.querySelectorAll(".og-chip.on") || [])].find((b) => /Relax/.test(b.textContent)) || null;
      });
      if (relaxChip.asElement()) {
        await relaxChip.asElement().click();
        await page.waitForSelector(".og-refuse", { timeout: 5000 }).catch(() => {});
        const after = await page.evaluate(() => {
          const li = [...document.querySelectorAll(".og-login")].find(
            (x) => (x.querySelector(".og-login-who")?.firstChild?.textContent || "").trim() === "Ravikisha"
          );
          const refuse = li?.querySelector(".og-refuse");
          return {
            refused: !!refuse && refuse.getAttribute("role") === "alert",
            text: refuse?.textContent || "",
            stillOn: [...(li?.querySelectorAll(".og-chip.on") || [])].some((b) => /Relax/.test(b.textContent)),
            elsewhere: document.querySelectorAll(".og-refuse").length,
          };
        });
        check(after.refused, `removing a login's last org is refused in place ${at}`);
        check(/at least one org/.test(after.text), `and says why ${at}`, after.text.slice(0, 80));
        check(after.stillOn, `and the chip stays filled ${at}`);
        check(after.elsewhere === 1, `the refusal sits on that row only ${at}`, String(after.elsewhere));
      } else {
        bad(`the relax-only login has a filled Relax chip ${at}`, "not found");
      }

      // The switcher: on a phone it lives in the sheet the footer bar opens.
      const mobile = await page.evaluate(() => {
        const bar = document.querySelector(".ad-mobile-bar");
        // offsetParent is null for a position:fixed element, so measure instead.
        return !!bar && getComputedStyle(bar).display !== "none" && bar.getBoundingClientRect().height > 0;
      });
      if (mobile) {
        const hint = await page.$eval(".ad-mobile-bar", (b) => b.textContent);
        check(/Relax/.test(hint), `the phone's footer bar names the org ${at}`, hint);
        await page.click(".ad-mobile-bar");
        await page.waitForSelector(".ad-sheet .ad-org-btn", { timeout: 5000 });
      }
      const btnSel = mobile ? ".ad-sheet .ad-org-btn" : ".ad-rail .ad-org-btn, .ad-org-btn";
      const btn = await page.evaluate((sel) => {
        const b = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length > 0);
        return b ? { text: b.textContent, popup: b.getAttribute("aria-haspopup") } : null;
      }, btnSel);
      check(!!btn && /Relax/.test(btn.text) && btn.popup === "menu", `the org switcher is present and names Relax ${at}`, JSON.stringify(btn));
      if (btn) {
        await page.evaluate((sel) => {
          [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length > 0).click();
        }, btnSel);
        await page.waitForSelector(".ad-org-menu", { timeout: 5000 }).catch(() => {});
        const menu = await page.evaluate(() => {
          const m = [...document.querySelectorAll(".ad-org-menu")].find((x) => x.getClientRects().length > 0);
          if (!m) return null;
          const items = [...m.querySelectorAll('[role="menuitemradio"]')];
          const r = m.getBoundingClientRect();
          return {
            items: items.length,
            checked: items.filter((i) => i.getAttribute("aria-checked") === "true").map((i) => i.textContent),
            manage: !!m.querySelector(".ad-org-manage"),
            inside: r.left >= -1 && r.right <= window.innerWidth + 1,
          };
        });
        check(menu && menu.items === 3, `the menu lists every org ${at}`, JSON.stringify(menu));
        check(menu && menu.checked.length === 1 && /Relax/.test(menu.checked[0]), `with Relax checked as current ${at}`);
        check(menu && menu.inside, `and stays on screen ${at}`);
        await page.keyboard.press("Escape");
        await new Promise((r) => setTimeout(r, 150));
        const closed = await page.evaluate(
          () => ![...document.querySelectorAll(".ad-org-menu")].some((x) => x.getClientRects().length > 0)
        );
        check(closed, `Escape closes it ${at}`);
      }
    }
    check(
      !errors.some((e) => /hydrat|does not match/i.test(e)),
      "the preview renders without a page error",
      errors.join(" | ").slice(0, 200)
    );
  } catch (e) {
    bad("orgs panel", e.message);
  } finally {
    await page.close();
  }

  // /api/orgs edits who may act as which account, and can delete an org. It
  // must refuse anyone who is not the signed-in admin, on EVERY action, and
  // the refusal must not depend on the action being a known one.
  console.log("\n/api/orgs refuses anonymous callers");
  const actions = [
    [{ action: "list" }, "list"],
    [{ action: "get", orgId: "relax" }, "get"],
    [{ action: "overview", orgId: "relax" }, "overview"],
    [{ action: "create", name: "Evil Corp" }, "create"],
    [{ action: "update", orgId: "relax", name: "Pwned" }, "update"],
    [{ action: "delete", orgId: "acme", confirm: true }, "delete"],
    [{ action: "assign", provider: "youtube", accountId: "UC1", orgIds: ["evil"] }, "assign"],
    [{ action: "migrate", dryRun: false }, "migrate"],
  ];
  for (const [body, name] of actions) {
    try {
      const res = await fetch(`${BASE}/api/orgs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-org-id": "relax" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      check(res.status === 401, `/api/orgs ${name} refuses an anonymous caller`, String(res.status));
      check(!/relax__|connectedAccounts|orgIds/.test(text), `and the ${name} refusal names nothing`, text.slice(0, 120));
    } catch (e) {
      bad(`orgs ${name}`, e.message);
    }
  }
  try {
    const res = await fetch(`${BASE}/api/orgs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer forged.not.ajwt" },
      body: JSON.stringify({ action: "list" }),
    });
    check(res.status === 401, "/api/orgs refuses a forged bearer token", String(res.status));
  } catch (e) {
    bad("orgs forged", e.message);
  }
  try {
    const res = await fetch(`${BASE}/api/orgs`, { method: "GET" });
    check(res.status === 405, "/api/orgs refuses a GET outright", String(res.status));
  } catch (e) {
    bad("orgs GET", e.message);
  }
}

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
      await linkedinSuite(browser);
      await adminTabsSuite(browser);
      await notesSuite(browser);
      await contactsSuite(browser);
      await agentSuite(browser);
      await workbenchSuite(browser);
      await jarvisSuite(browser);
      await whatsappSuite(browser);
      await orgsSuite(browser);
      await memorySuite(browser);
      await integrationsAuthSuite();
      await seoSuite();
    } finally {
      await browser.close();
    }
  }
  if (which === "seo") {
    await seoSuite();
  }

  if (which === "linkedin") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await linkedinSuite(browser);
      await adminTabsSuite(browser);
    } finally {
      await browser.close();
    }
  }
  if (which === "contacts") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await contactsSuite(browser);

    } finally {
      await browser.close();
    }
  }
  if (which === "agent") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await agentSuite(browser);
    } finally {
      await browser.close();
    }
  }
  if (which === "jarvis") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await jarvisSuite(browser);
    } finally {
      await browser.close();
    }
  }
  if (which === "workbench") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await workbenchSuite(browser);
    } finally {
      await browser.close();
    }
  }
  if (which === "orgs") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await orgsSuite(browser);
    } finally {
      await browser.close();
    }
  }
  if (which === "memory") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await memorySuite(browser);
    } finally {
      await browser.close();
    }
  }
  if (which === "whatsapp") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await whatsappSuite(browser);
    } finally {
      await browser.close();
    }
  }
  if (which === "notes") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await notesSuite(browser);
    } finally {
      await browser.close();
    }
  }
  if (which === "tasks") {
    await integrationsAuthSuite();
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await tasksSuite(browser);
    } finally {
      await browser.close();
    }
  }
  // The export suite is the slowest and the only one that can fail for a reason
  // outside the code — a p5 recording needs real animation frames, so a machine
  // busy with something else starves it. Being able to re-run it alone is the
  // difference between confirming a flake and re-running the whole blog suite.
  if (which === "export") {
    const browser = await launch({ headful: !!process.env.HEADFUL });
    try {
      await exportSuite(browser);
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
