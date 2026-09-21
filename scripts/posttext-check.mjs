/* Unit tests for the pure post-text helpers.
 *
 *   npm run test:posttext
 *
 * These back the editing tools: edit_post_section addresses a section by its
 * heading, so if outlineOf() mis-reads a body the tool rewrites the wrong part
 * of a real article. No network, no credentials, no server.
 */
import {
  slugify,
  SLUG_RE,
  readingMinutes,
  excerptFrom,
  outlineOf,
  findSection,
  stripLeadingCover,
} from "../lib/server/postText.js";

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
const throws = (fn, name, re) => {
  let msg = "";
  try {
    fn();
  } catch (e) {
    msg = e?.message || "";
  }
  check(re.test(msg), name, msg || "did NOT throw");
};

console.log("slugify and the address rule");
{
  check(slugify("How RelaxCSS Works!") === "how-relaxcss-works", "punctuation becomes dashes", slugify("How RelaxCSS Works!"));
  check(slugify("  Trim  me  ") === "trim-me", "leading and trailing space is dropped");
  check(slugify("a".repeat(80)).length === 60, "capped at 60 characters");
  check(slugify("") === "", "empty in, empty out");
  check(SLUG_RE.test("go-1"), "a normal slug passes");
  check(!SLUG_RE.test(""), "empty is refused");
  check(!SLUG_RE.test("a"), "one character is refused");
  check(!SLUG_RE.test("-leading"), "a leading dash is refused");
  check(!SLUG_RE.test("Caps"), "uppercase is refused");
}

console.log("\nreading time");
{
  check(readingMinutes("") === 1, "an empty body still reads as 1 min");
  check(readingMinutes("word ".repeat(200)) === 1, "200 words is 1 min");
  check(readingMinutes("word ".repeat(2000)) === 10, "2000 words is 10 min");
}

console.log("\nexcerpts");
{
  // The bug this module exists to fix: the MCP copy stripped only #>*_`~-, so
  // a post opening with a code block published an excerpt of mangled code.
  const codeFirst = "```js\nconst x = {a:1};\n```\n\nThe real opening sentence.";
  check(
    !excerptFrom(codeFirst).includes("const x"),
    "a leading code fence is not the excerpt",
    excerptFrom(codeFirst)
  );
  check(
    excerptFrom(codeFirst).startsWith("The real opening sentence"),
    "the prose after the fence is",
    excerptFrom(codeFirst)
  );
  check(
    !excerptFrom("![a diagram](/api/media/x.png)\n\nProse here.").includes("api/media"),
    "an image is not the excerpt"
  );
  check(
    excerptFrom("See [the notes](https://example.com) now.") === "See the notes now.",
    "a link keeps its text and loses its URL",
    excerptFrom("See [the notes](https://example.com) now.")
  );
  const long = excerptFrom("word ".repeat(200));
  check(long.length <= 171 && long.endsWith("…"), "a long body is truncated with an ellipsis", String(long.length));
  check(excerptFrom(undefined) === "", "undefined is handled");
}

console.log("\noutline");
{
  const body = [
    "# Overview",
    "",
    "Intro prose.",
    "",
    "## Architecture",
    "",
    "Some words here.",
    "",
    "### Parser",
    "",
    "Nested detail.",
    "",
    "## Conclusion",
    "",
    "The end.",
  ].join("\n");

  const o = outlineOf(body);
  check(o.length === 4, "finds every heading", String(o.length));
  check(o.map((h) => h.heading).join("|") === "Overview|Architecture|Parser|Conclusion", "in document order");
  check(o[0].level === 1 && o[2].level === 3, "records the level");

  // A section owns everything until the next heading of the same or shallower
  // level — so "Architecture" must swallow its own "### Parser".
  check(o[1].text.includes("Nested detail"), "a section contains its subsections");
  check(!o[1].text.includes("The end"), "and stops at the next sibling heading");
  check(o[3].text.trim() === "The end.", "the last section runs to the end of the body");

  // "# not a heading" inside a fence is a shell comment, not a section.
  const fenced = "## Real\n\n```bash\n# apt install thing\n```\n\nAfter.";
  const of = outlineOf(fenced);
  check(of.length === 1 && of[0].heading === "Real", "a # inside a code fence is not a heading", String(of.map((h) => h.heading)));

  check(outlineOf("").length === 0, "a body with no headings has no outline");
  check(outlineOf("#NoSpace").length === 0, "a # with no space is not a heading");
}

console.log("\nfinding a section to edit");
{
  const body = "## JIT Compilation\n\nA.\n\n## Plugin System\n\nB.";
  check(findSection(body, "JIT Compilation").heading === "JIT Compilation", "exact match");
  check(findSection(body, "jit compilation").heading === "JIT Compilation", "case is ignored");
  check(findSection(body, "JIT, compilation!").heading === "JIT Compilation", "punctuation is ignored");

  // Refusing beats guessing: a wrong guess rewrites the wrong section of a
  // real article, and the tool cannot tell that it did.
  throws(() => findSection(body, "Nope"), "an unknown heading is refused", /No section headed/);
  throws(() => findSection(body, "Nope"), "and the refusal lists what IS there", /JIT Compilation/);
  throws(
    () => findSection("## Same\n\nA.\n\n## Same\n\nB.", "Same"),
    "a duplicated heading is refused as ambiguous",
    /appears 2 times/
  );
  throws(() => findSection(body, ""), "an empty heading is refused", /Give the heading/);
}

console.log("\nthe cover, duplicated into the body");
{
  const url = "https://ravikishan.me/api/media/blog/1-x.png";

  const r = stripLeadingCover(`![a diagram](${url})\n\nProse follows.`, url);
  check(r.removed, "a leading image matching the cover is removed");
  check(r.body === "Prose follows.", "and the prose survives intact", JSON.stringify(r.body));

  check(stripLeadingCover(`![](${url} "A title")\n\nProse.`, url).removed,
    "including the form carrying a title attribute");
  check(stripLeadingCover(`  \n![](${url})\n\nProse.`, url).removed,
    "leading whitespace does not hide it");

  check(!stripLeadingCover(`![](https://elsewhere/x.png)\n\nProse.`, url).removed,
    "a DIFFERENT leading image is left alone");
  // Reusing the cover further down is a choice, not a mistake.
  check(!stripLeadingCover(`Intro.\n\n![](${url})`, url).removed,
    "the same image further down is left alone");
  check(!stripLeadingCover(`![](${url})`, "").removed, "no cover set, nothing removed");
  check(!stripLeadingCover("", url).removed, "an empty body is handled");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
