/* Verifies the Medium path.
 *
 *   npm run medium:check
 *
 * Medium stopped issuing API tokens on 1 Jan 2025, so there is nothing to
 * authenticate and nothing to publish with. What there IS: a public feed that
 * says what is already on Medium, and an importer that takes a URL. Both are
 * things that rot silently — a feed shape change, or a title that no longer
 * matches — so both are checked here.
 *
 * The pure half runs with no network at all.
 */
import {
  parseMediumFeed,
  normaliseTitle,
  mediumState,
  mediumImportUrl,
} from "../lib/server/medium.js";

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

console.log("the importer URL");
{
  const u = mediumImportUrl("https://ravikishan.me/blog/a-post");
  check(u.startsWith("https://medium.com/p/import?url="), "points at Medium's own importer", u);
  check(u.includes("https%3A%2F%2Fravikishan.me"), "with the source URL encoded, not raw", u);
  // A raw URL in the query string loses everything after the first &.
  const tricky = mediumImportUrl("https://ravikishan.me/blog/x?a=1&b=2");
  check(!/[?&]a=1/.test(tricky.replace(/^[^?]*\?url=/, "x=")), "and a query in the source cannot leak out", tricky);
}

console.log("\nparsing the feed");
{
  const xml = `<rss><channel>
    <title><![CDATA[Ravi Kishan]]></title>
    <item>
      <title><![CDATA[Building a Container Runtime]]></title>
      <link>https://medium.com/@me/building-a-container-runtime-abc123?source=rss-1</link>
      <pubDate>Thu, 05 Jun 2025 13:25:34 GMT</pubDate>
    </item>
    <item>
      <title><![CDATA[Introducing RelaxLang]]></title>
      <link>https://medium.com/@me/introducing-relaxlang-def456</link>
      <pubDate>Fri, 17 Jan 2025 19:30:05 GMT</pubDate>
    </item>
  </channel></rss>`;

  const posts = parseMediumFeed(xml);
  check(posts.length === 2, "every item is read, and the channel title is not one", String(posts.length));
  check(posts[0].title === "Building a Container Runtime", "CDATA is unwrapped", posts[0].title);
  check(!posts[0].url.includes("?source="), "the rss tracking query is stripped from the link", posts[0].url);
  check(posts[0].id === "building-a-container-runtime-abc123", "the medium id is the last path segment", posts[0].id);
  check(!!Date.parse(posts[0].publishedAt), "the date parses", posts[0].publishedAt);
  check(parseMediumFeed("").length === 0, "an empty feed yields nothing rather than throwing");
}

console.log("\nmatching a post to its Medium copy");
{
  const medium = [
    { title: "Building a Container Runtime from Scratch with Go (MyDocker)", url: "https://medium.com/@me/a", publishedAt: "Thu, 05 Jun 2025 13:25:34 GMT" },
    { title: "Introducing RelaxLang: A Beginner-Friendly Programming Language", url: "https://medium.com/@me/b", publishedAt: "Fri, 17 Jan 2025 19:30:05 GMT" },
  ];
  const site = [
    { slug: "container", title: "Building a Container Runtime from Scratch with Go (MyDocker)", publishedAt: "2025-06-05T13:25:34Z" },
    { slug: "relaxlang", title: "introducing relaxlang: a beginner-friendly programming language", publishedAt: "2025-01-17T19:30:05Z" },
    { slug: "fresh", title: "Something Written Last Week", publishedAt: "2026-10-01T00:00:00Z" },
    { slug: "ancient", title: "An Old Piece The Feed No Longer Carries", publishedAt: "2020-01-01T00:00:00Z" },
  ];

  const state = mediumState(site, medium);
  const by = Object.fromEntries(state.map((s) => [s.slug, s]));

  check(by.container.state === "on-medium", "an exact title match is found");
  check(by.container.mediumUrl === "https://medium.com/@me/a", "and carries the Medium URL");
  check(by.relaxlang.state === "on-medium", "matching ignores case and punctuation");
  check(by.fresh.state === "not-on-medium", "something newer than the feed is genuinely missing");

  // The feed only carries the last ~10 stories, so absence is not evidence for
  // anything older than that. Reporting "not on Medium" there invites a
  // duplicate import of an article that is already up.
  check(by.ancient.state === "unknown", "something older than the feed is unknown, not missing");

  check(normaliseTitle("A — B") === normaliseTitle("a - b"), "em dashes normalise to hyphens");
}

if (process.env.MEDIUM_LIVE) {
  console.log("\nlive feed");
  const { fetchMediumPosts } = await import("../lib/server/medium.js");
  try {
    const posts = await fetchMediumPosts();
    check(posts.length > 0, `the live feed returns stories (${posts.length})`);
    check(
      posts.every((p) => p.title && p.url.startsWith("https://")),
      "each has a title and an absolute URL"
    );
  } catch (e) {
    check(false, "live feed reachable", e.message);
  }
} else {
  console.log("\nlive feed: skipped (set MEDIUM_LIVE=1 to fetch medium.com)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
