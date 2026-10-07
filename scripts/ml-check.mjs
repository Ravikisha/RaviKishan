// ML lab — Hugging Face and Kaggle shaping, checked with no network.
//
//   node scripts/ml-check.mjs
let pass = 0;
const fails = [];
const check = (ok, name, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const throws = (fn, name, re) => {
  try {
    fn();
    check(false, name, "it did not throw");
  } catch (e) {
    check(!re || re.test(e.message), name, e.message.slice(0, 160));
  }
};

const hf = await import("../lib/server/hfShape.js");

console.log("\nHugging Face: repo ids and types");
check(hf.assertRepoId("ravi/tiny-bert") === "ravi/tiny-bert", "owner/name passes");
throws(() => hf.assertRepoId("tiny-bert"), "a bare name is refused", /owner\/name/);
throws(() => hf.assertRepoId("a/b/c"), "three segments are refused", /owner\/name/);
throws(() => hf.assertRepoId("ravi/../etc"), "traversal is refused", /owner\/name/);
check(hf.assertRepoType() === "model", "type defaults to model");
throws(() => hf.assertRepoType("notebook"), "an unknown type names the real ones", /model, dataset, space/);
check(
  hf.apiBase("dataset") === "datasets" && hf.resolvePrefix("space") === "spaces/" && hf.resolvePrefix("model") === "",
  "paths per type"
);

console.log("\nHugging Face: search");
{
  const q = hf.searchQuery({ search: "whisper", author: "openai", sort: "downloads", limit: 500 });
  check(q.get("search") === "whisper" && q.get("author") === "openai", "search and author pass through");
  check(q.get("limit") === "100", "limit is capped at 100", q.get("limit"));
  check(q.get("direction") === "-1", "sort is descending");
  throws(() => hf.searchQuery({ sort: "stars" }), "an unknown sort names the real ones", /downloads/);
  const f = hf.searchQuery({ filter: ["text-classification", "pytorch"] });
  check(f.getAll("filter").join() === "text-classification,pytorch", "filters repeat");
}
{
  const r = hf.shapeRepo(
    { id: "openai/whisper-tiny", author: "openai", downloads: 5, likes: 2, tags: ["audio"], pipeline_tag: "asr", lastModified: "2026-01-01", private: false, gated: false },
    "model"
  );
  check(r.url === "https://huggingface.co/openai/whisper-tiny" && r.pipeline === "asr", "a model shapes with its url");
  check(hf.shapeRepo({ id: "x/y" }, "dataset").url === "https://huggingface.co/datasets/x/y", "a dataset url carries its prefix");
  check(hf.shapeRepo({ id: "x/y" }, "model").downloads === 0, "missing counters read 0, not undefined");
}

console.log("\nHugging Face: jobs flavors");
check(hf.assertFlavor("t4-small") === "t4-small", "a real flavor passes");
throws(() => hf.assertFlavor("rtx-4090"), "an unknown flavor names the real ones", /cpu-basic/);

console.log("\nHugging Face: commits");
{
  const enc = new TextEncoder();
  const files = [
    { path: "README.md", bytes: enc.encode("# hi") },
    { path: "metrics.json", bytes: enc.encode("{}") },
  ];
  const ok = hf.planCommit(files, {
    files: [
      { path: "README.md", uploadMode: "regular", shouldIgnore: false },
      { path: "metrics.json", uploadMode: "regular", shouldIgnore: false },
    ],
  });
  check(ok.ok && ok.totalBytes === 6, "regular files are accepted");
  throws(
    () => hf.planCommit([{ path: "model.bin", bytes: new Uint8Array(10) }], { files: [{ path: "model.bin", uploadMode: "lfs", shouldIgnore: false }] }),
    "an LFS file is refused by name",
    /model\.bin.*LFS/
  );
  throws(() => hf.planCommit([{ path: "big.txt", bytes: new Uint8Array(10 * 1024 * 1024 + 1) }], { files: [] }), "over 10 MB is refused before asking", /10 MB/);
  throws(() => hf.planCommit([{ path: "../x", bytes: enc.encode("a") }], { files: [] }), "a traversal path is refused", /path/);
  const nd = hf
    .commitNdjson({ summary: "add", files: [{ path: "a.txt", bytes: enc.encode("hi") }], deletes: ["old.txt"] })
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  check(nd[0].key === "header" && nd[0].value.summary === "add", "the header line comes first");
  check(nd[1].key === "file" && nd[1].value.encoding === "base64" && nd[1].value.content === "aGk=", "file content is base64");
  check(nd[2].key === "deletedFile" && nd[2].value.path === "old.txt", "a delete is its own line");
}

console.log("\nHugging Face: errors");
check(/read token/i.test(hf.hfError(403, {}, "read").message), "403 on a read token says so");
check(hf.hfError(401, {}, "").status === 401 && /revoked|reconnect/i.test(hf.hfError(401, {}, "").message), "401 says to repaste");
check(/not found/i.test(hf.hfError(404, { error: "Repository not found" }, "").message), "404 keeps HF's reason");

// (Tasks 5 and 6 append here.)

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
