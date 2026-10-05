/* What the Markdown renderer turns rich blocks into.
 *
 *   npm run test:markdown
 *
 * The renderer never executes anything — it only MARKS the places that
 * lib/postEnhance.js upgrades in the browser. These assertions pin that
 * contract, because the enhancer reads what this file writes: change a class
 * name here and diagrams stop rendering with no error anywhere.
 *
 * No network, no browser.
 */
import { renderMarkdown } from "../lib/markdown.js";
import {
  listPortableBlocks,
  toPortableMarkdown,
  blockId,
} from "../lib/server/portableMarkdown.js";

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

console.log("maths");
{
  const inline = renderMarkdown("Energy is $E = mc^2$ exactly.");
  check(/<span class="pb-math" data-display="0">/.test(inline), "inline maths is marked, not rendered");
  check(inline.includes("E = mc^2"), "and keeps its source verbatim");

  const display = renderMarkdown("$$\\int_0^1 x^2\\,dx$$");
  check(/data-display="1"/.test(display), "display maths is marked as display");
  check(display.includes("\\int_0^1"), "TeX backslashes survive the renderer", display.slice(0, 80));

  // A lone dollar in prose is money far more often than it is maths.
  const money = renderMarkdown("It cost $5 and then $10 more.");
  check(!money.includes("pb-math"), "money is not typeset", money.trim());
  check(money.includes("$5") && money.includes("$10"), "and is left exactly as written");

  const code = renderMarkdown("Use `$5` and `$HOME` here.");
  check(!code.includes("pb-math"), "dollars inside inline code are left alone");

  // Maths must not be mistaken for emphasis: $a_i$ and $b_i$ contain
  // underscores that markdown would otherwise pair up into <em>.
  const subs = renderMarkdown("Compare $a_i$ with $b_i$ directly.");
  check(!subs.includes("<em>"), "underscores in maths do not become emphasis", subs.trim());
  check((subs.match(/pb-math/g) || []).length === 2, "both expressions are marked");
}

console.log("\nrunnable and drawable blocks");
{
  const mmd = renderMarkdown("```mermaid\ngraph TD; A-->B;\n```");
  check(/<div class="pb-mermaid" data-kind="mermaid">/.test(mmd), "a mermaid fence becomes a diagram slot");
  check(/<pre class="pb-src">/.test(mmd), "with its source in the markup");
  check(mmd.includes("A--&gt;B"), "and the source is HTML-escaped", mmd.slice(0, 120));
  check(!/<script/i.test(mmd), "and nothing executable is emitted");

  for (const kind of ["p5", "d3"]) {
    const out = renderMarkdown("```" + kind + "\nconst x = 1;\n```");
    check(
      new RegExp(`<div class="pb-sketch" data-kind="${kind}">`).test(out),
      `a ${kind} fence becomes a sketch slot`
    );
  }

  const sized = renderMarkdown("```p5 height=260\nlet t = 0;\n```");
  check(/data-height="260"/.test(sized), "the fence can size its frame");
  const unsized = renderMarkdown("```p5\nlet t = 0;\n```");
  check(!/data-height/.test(unsized), "and omits the attribute when unspecified");

  // A sketch that tries to close its own tag must not escape the <pre>.
  const nasty = renderMarkdown("```d3\nconst s = \"</pre><script>alert(1)</script>\";\n```");
  check(!/<script>alert/.test(nasty), "a closing tag in the source cannot break out", nasty.slice(0, 160));
}

console.log("\nordinary code is untouched");
{
  const js = renderMarkdown("```js\nconst x = 1;\n```");
  check(js.includes('class="language-javascript"'), "a js fence still highlights");
  check(!js.includes("pb-sketch") && !js.includes("pb-mermaid"), "and is not mistaken for a sketch");

  const plain = renderMarkdown("Just a paragraph.");
  check(!/pb-(math|mermaid|sketch)/.test(plain), "prose needs no enhancement at all");
}

console.log("\ncrossposting: what travels and what cannot");
{
  const body = [
    "Energy is $E = mc^2$ and it cost $5 anyway.",
    "",
    "$$\\int_0^1 x^2 dx$$",
    "",
    "```mermaid",
    "graph TD; A-->B;",
    "```",
    "",
    "```js",
    "const price = \"$5\";",
    "```",
    "",
    "```p5 height=260",
    "function setup(){}",
    "```",
  ].join("\n");

  const blocks = listPortableBlocks(body);
  check(blocks.length === 2, "only the blocks that cannot travel are listed", String(blocks.length));
  check(blocks.map((b) => b.kind).join(",") === "mermaid,p5", "in document order", blocks.map((b) => b.kind).join(","));
  check(blocks[1].height === 260, "a sketch keeps the height it was given");

  // The id has to be stable across machines and reloads, or every cross-post
  // uploads another copy of the same picture.
  check(blockId("mermaid", "graph TD; A-->B;") === blockId("mermaid", "graph TD; A-->B;\n"), "ids ignore trailing whitespace");
  check(blockId("mermaid", "a") !== blockId("p5", "a"), "ids separate the kinds");

  const CANON = "https://ravikishan.me/blog/x";

  // dev.to has a native KaTeX tag, so maths travels losslessly and costs nothing.
  const withAssets = toPortableMarkdown(body, {
    canonicalUrl: CANON,
    assets: { [blocks[0].id]: "https://ravikishan.me/api/media/devto/a.webp" },
  });
  check(withAssets.markdown.includes("{% katex inline %}E = mc^2{% endkatex %}"), "inline maths becomes a katex tag");
  check(withAssets.markdown.includes("{% katex %}\\int_0^1 x^2 dx{% endkatex %}"), "display maths becomes a block katex tag");
  check(withAssets.markdown.includes("$5 anyway"), "money is still money");
  check(withAssets.markdown.includes('const price = "$5"'), "and a dollar inside a code fence is untouched");

  check(withAssets.markdown.includes("![mermaid diagram](https://ravikishan.me/api/media/devto/a.webp)"), "a rendered diagram travels as an image");
  check(withAssets.markdown.includes(CANON), "with a line back to the original");
  check(!withAssets.markdown.includes("```mermaid"), "and the fence itself is gone");
  check(withAssets.markdown.includes("```js"), "while ordinary code fences survive intact");

  check(withAssets.missing.length === 1 && withAssets.missing[0].kind === "p5", "a block with no asset is reported, not dropped silently");
  check(withAssets.used.length === 1, "and the ones that travelled are reported too");

  // Without any assets nothing breaks — every block degrades to one sentence.
  const bare = toPortableMarkdown(body, { canonicalUrl: CANON });
  check(bare.missing.length === 2, "with no assets at all, both blocks are reported");
  check(!bare.markdown.includes("```mermaid") && !bare.markdown.includes("```p5"), "and neither fence is shipped as dead code");
  check((bare.markdown.match(/does not render here/g) || []).length === 2, "each becomes an honest line instead");
  check(bare.markdown.includes("{% katex"), "maths still converts without any files");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
