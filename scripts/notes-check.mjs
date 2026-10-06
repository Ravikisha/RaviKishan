// Notes, checked without a network, a browser or a credential.
//
// What is worth pinning here is everything that is PURE: the shared note shape,
// the guards that refuse before any provider is reached, the search scorer, and
// the two format conversions that are the only places a note can silently lose
// text — Notion's blocks and Obsidian's front matter.
//
//   node scripts/notes-check.mjs
const shape = await import("../lib/server/noteShape.js");
const sources = await import("../lib/server/noteSources.js");
const notion = await import("../lib/server/notion.js");

const {
  shapeNote, cleanTags, toIso, validatePatch, excerptOf, titleFrom,
  searchNotes, sortNotes, parseFrontMatter, withFrontMatter, vaultPath,
  NoteError, MAX_TITLE,
} = shape;

let pass = 0;
const fails = [];
const check = (ok, name, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  OK  ${name}`);
  } else {
    fails.push(`${name}${detail ? ` - ${detail}` : ""}`);
    console.log(`  XX  ${name}${detail ? ` - ${detail}` : ""}`);
  }
};
const throws = (fn, name, re) => {
  try {
    fn();
    check(false, name, "it did not throw");
  } catch (e) {
    check(re.test(e.message), name, e.message.slice(0, 110));
  }
};

console.log("\nsources declare what they can do, and one declares that it cannot");
{
  check(sources.DEFAULT_SOURCE === "local", "local is the default source");
  check(sources.sourceIds().length === 5, "five sources are registered", sources.sourceIds().join(", "));
  check(
    !sources.usableSourceIds().includes("keep"),
    "Google Keep is not offered as usable",
    sources.usableSourceIds().join(", ")
  );
  // The whole point: it fails with the evidence, before any fetch.
  throws(
    () => sources.assertUsable("keep"),
    "and asking for it explains why, rather than 403ing later",
    /enterprise|Workspace/i
  );
  check(
    /developers\.google\.com\/workspace\/keep/.test(sources.NOTE_SOURCES.keep.reason),
    "citing the documentation it is actually from"
  );
  check(
    !!sources.NOTE_SOURCES.keep.alternative,
    "and offering the route that does work"
  );
  throws(() => sources.getSource("evernote"), "an unknown source is refused by name", /Unknown note source/);

  // Capability honesty, per the services' real constraints.
  check(sources.NOTE_SOURCES.trello.capabilities.tags === false, "Trello declares it has no free-text tags");
  check(sources.NOTE_SOURCES.notion.capabilities.pinned === false, "Notion declares it cannot pin");
  check(sources.NOTE_SOURCES.obsidian.capabilities.archive === false, "a vault declares it cannot archive");
  check(sources.NOTE_SOURCES.local.needsConnection === false, "the built-in store needs no connection");
}

console.log("\nguards refuse before any provider is reached");
{
  const caps = sources.NOTE_SOURCES.local.capabilities;
  throws(() => validatePatch({}, { capabilities: caps }), "an empty patch is refused", /Nothing to change/);
  throws(
    () => validatePatch({ title: "", body: "" }, { capabilities: caps, creating: true }),
    "a new note with no title and no body is refused",
    /needs a title or a body/
  );
  throws(
    () => validatePatch({ title: "x".repeat(MAX_TITLE + 1) }, { capabilities: caps }),
    "an over-long title is refused with its length",
    /capped at 300 characters; that one is 301/
  );
  throws(
    () => validatePatch({ body: "x".repeat(100_001) }, { capabilities: caps }),
    "an over-long body is refused",
    /capped at 100000/
  );
  // Each of these would otherwise be a provider error that names none of this.
  throws(
    () => validatePatch({ tags: ["a"] }, { capabilities: sources.NOTE_SOURCES.trello.capabilities }),
    "tagging a Trello card is refused, because labels are board objects",
    /no tags/
  );
  throws(
    () => validatePatch({ pinned: true }, { capabilities: sources.NOTE_SOURCES.notion.capabilities }),
    "pinning a Notion page is refused",
    /cannot pin/
  );
  throws(
    () => validatePatch({ archived: true }, { capabilities: sources.NOTE_SOURCES.obsidian.capabilities }),
    "archiving a vault file is refused",
    /cannot archive/
  );
  check(
    validatePatch({ title: "ok" }, { capabilities: caps }).join() === "title",
    "a valid patch reports which fields it will write"
  );
}

console.log("\nthe shared shape");
{
  const n = shapeNote({ id: 1, title: "T", tags: ["A", "a", " b "], updatedAt: "2026-01-02T03:04:05Z" });
  check(n.source === "local", "a note defaults to the local source");
  check(n.id === "1", "ids are strings, whatever the provider used");
  check(JSON.stringify(n.tags) === '["A","b"]', "tags de-duplicate case-insensitively, first spelling wins", JSON.stringify(n.tags));
  check(n.updatedAt === "2026-01-02T03:04:05.000Z", "dates normalise to ISO UTC", n.updatedAt);
  // Asserting a hand-computed epoch is asserting my own arithmetic; assert the
  // behaviour instead — seconds in, the same instant out.
  const epoch = 1767322245;
  check(
    toIso({ seconds: epoch }) === new Date(epoch * 1000).toISOString(),
    "including a Firestore seconds map",
    toIso({ seconds: epoch })
  );
  check(toIso({ timestampValue: "2026-01-02T03:04:05Z" }) !== "", "and a Firestore timestampValue");
  check(toIso("not a date") === "", "an unparseable date becomes empty, not Invalid Date");
  check(cleanTags("a, b , a").length === 2, "a comma string is accepted as tags");
  check(cleanTags(Array.from({ length: 40 }, (_, i) => `t${i}`)).length === 30, "tags cap at 30");
}

console.log("\nexcerpts and derived titles");
{
  // The bug create_post had: an excerpt that starts at character 0 shows the
  // syntax rather than the words.
  check(excerptOf("# Heading\n\nThe actual words.") === "Heading The actual words.", "a heading is not shown as ###", excerptOf("# Heading\n\nThe actual words."));
  check(!excerptOf("```\ncode here\n```\n\nReal text.").includes("code here"), "a fenced code block is skipped");
  check(excerptOf("---\ntags: [a]\n---\n\nBody text.") === "Body text.", "front matter is skipped", excerptOf("---\ntags: [a]\n---\n\nBody text."));
  check(excerptOf("[link](http://x) after") === "link after", "a link keeps its text, not its url");
  check(excerptOf("x".repeat(400)).endsWith("…"), "a long excerpt is elided");
  check(titleFrom("## Real title\n\nbody") === "Real title", "a title is taken from the first heading");
  check(titleFrom("", "Untitled") === "Untitled", "and falls back when there is nothing");
}

console.log("\nsearch scores rather than filters");
{
  const notes = [
    shapeNote({ id: "1", title: "Rust ownership", body: "borrow checker", updatedAt: "2026-01-01T00:00:00Z" }),
    shapeNote({ id: "2", title: "Weekly log", body: "read about rust today", updatedAt: "2026-02-01T00:00:00Z" }),
    shapeNote({ id: "3", title: "Reading list", tags: ["rust"], body: "", updatedAt: "2026-03-01T00:00:00Z" }),
  ];
  const hits = searchNotes(notes, "rust");
  check(hits.length === 3, "every note mentioning the term is found", String(hits.length));
  // The point of scoring: the note NAMED for the term wins, even though the
  // other two are newer. A substring filter sorted by date gets this backwards.
  check(hits[0].id === "1", "the note titled for it ranks first", hits.map((h) => h.id).join(","));
  check(hits[1].id === "3", "a tag match outranks a passing body mention", hits.map((h) => h.id).join(","));

  const both = searchNotes(notes, "rust ownership");
  check(both.length === 1 && both[0].id === "1", "two words narrow the result rather than widening it", String(both.length));
  throws(() => searchNotes(notes, "a"), "a one-character search is refused", /at least two characters/);
}

console.log("\nordering is the same for every source");
{
  const notes = [
    shapeNote({ id: "old", updatedAt: "2026-01-01T00:00:00Z" }),
    shapeNote({ id: "new", updatedAt: "2026-05-01T00:00:00Z" }),
    shapeNote({ id: "pin", pinned: true, updatedAt: "2020-01-01T00:00:00Z" }),
    shapeNote({ id: "arc", archived: true, updatedAt: "2030-01-01T00:00:00Z" }),
  ];
  const order = sortNotes(notes).map((n) => n.id).join(",");
  check(order === "pin,new,old,arc", "pinned first, newest next, archived last", order);
}

console.log("\nObsidian front matter round-trips");
{
  const text = "---\ntags: [rust, systems]\npinned: true\n---\n\n# Note\n\nBody.";
  const { meta, body } = parseFrontMatter(text);
  check(Array.isArray(meta.tags) && meta.tags.length === 2, "a tag list is parsed", JSON.stringify(meta.tags));
  check(meta.pinned === "true", "and a scalar");
  check(body.startsWith("# Note"), "the body excludes the front matter", JSON.stringify(body.slice(0, 10)));
  check(parseFrontMatter("No front matter here").body === "No front matter here", "a file without front matter is unchanged");

  const out = withFrontMatter({ tags: ["rust"], pinned: true }, "Body.");
  check(out.startsWith("---\n") && out.includes("tags: [rust]"), "writing produces front matter Obsidian reads", JSON.stringify(out.slice(0, 30)));
  check(withFrontMatter({}, "Body.") === "Body.", "and no front matter block when there is nothing to put in it");

  // A note title is arbitrary text; a path is not. Anything that could escape
  // the vault root has to be gone before it reaches the API.
  check(vaultPath("My Note") === "My Note.md", "a title becomes a filename");
  check(vaultPath("a/b:c?d") === "a b c d.md", "path and filesystem characters are stripped", vaultPath("a/b:c?d"));
  check(vaultPath("x", { folder: "../../etc" }) === "etc/x.md", "a traversal in the folder is removed", vaultPath("x", { folder: "../../etc" }));
  check(vaultPath("x", { folder: "notes/daily" }) === "notes/daily/x.md", "a real folder is kept");
  throws(() => vaultPath("///"), "a title with no usable characters is refused", /no usable characters/);
}

console.log("\nNotion blocks convert both ways");
{
  const md = [
    "# Title",
    "",
    "Some text.",
    "",
    "- one",
    "- two",
    "",
    "1. first",
    "2. second",
    "",
    "- [x] done",
    "- [ ] todo",
    "",
    "> quoted",
    "",
    "```js",
    "const x = 1;",
    "```",
  ].join("\n");

  const blocks = notion.markdownToBlocks(md);
  const types = blocks.map((b) => b.type);
  check(types[0] === "heading_1", "a heading becomes heading_1", types[0]);
  check(types.includes("bulleted_list_item"), "bullets convert");
  check(types.includes("numbered_list_item"), "numbered items convert");
  check(types.filter((t) => t === "to_do").length === 2, "checkboxes convert as to_do");
  check(blocks.find((b) => b.type === "to_do")?.to_do.checked === true, "and keep their checked state");
  check(types.includes("quote"), "quotes convert");
  const code = blocks.find((b) => b.type === "code");
  check(!!code, "a fenced block converts to code");
  check(code.code.language === "javascript", "with its language mapped to Notion's list", code.code.language);
  // Notion REJECTS an unknown language outright, so an unmapped one must become
  // plain text rather than failing the whole write.
  check(notion.notionLanguage("brainfuck") === "plain text", "an unknown language falls back to plain text");
  check(notion.notionLanguage("ts") === "typescript", "and an alias is mapped");
  // Code must not be parsed as markdown: a '# ' inside a fence is code.
  const fenced = notion.markdownToBlocks("```\n# not a heading\n```");
  check(fenced.length === 1 && fenced[0].type === "code", "a heading inside a fence stays code", JSON.stringify(fenced.map((b) => b.type)));

  const back = notion.blocksToMarkdown(blocks);
  check(back.markdown.startsWith("# Title"), "and converts back", back.markdown.slice(0, 20));
  check(back.markdown.includes("- [x] done"), "keeping checkbox state");
  check(back.markdown.includes("1. first") && back.markdown.includes("2. second"), "and renumbering ordered items", back.markdown.match(/\d\. \w+/g)?.join(" "));
  check(back.lossy === false, "a note made of note-shaped blocks is not lossy");

  // The guard that matters: a page with a block this converter cannot rebuild
  // must be refused for WRITING, because updating a body deletes children first.
  const exotic = notion.blocksToMarkdown([
    { type: "paragraph", paragraph: { rich_text: [{ plain_text: "hi" }] } },
    { type: "column_list", column_list: {} },
  ]);
  check(exotic.lossy === true, "a page with an unconvertible block is reported lossy");
  check(exotic.markdown.includes("hi"), "while still reading what text it has");
  throws(
    () => notion.assertWritable({ readOnly: true, warning: "would replace them" }),
    "and writing to it is refused",
    /would replace them/
  );

  // A single rich-text run over 2000 characters is rejected by Notion with an
  // error that does not say which block was at fault.
  const long = notion.markdownToBlocks("x".repeat(5000));
  const runs = long[0].paragraph.rich_text;
  check(runs.length > 1, "a long paragraph is split into several runs", String(runs.length));
  check(runs.every((r) => r.text.content.length <= 2000), "none over Notion's 2000-character limit");
  check(runs.map((r) => r.text.content).join("").length === 5000, "and nothing is lost in the split");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("FAILURES:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
