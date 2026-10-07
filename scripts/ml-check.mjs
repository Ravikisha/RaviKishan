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

console.log("\nHugging Face client (stubbed network)");
{
  const api = await import("../lib/server/huggingface.js");
  const seen = [];
  api.setFetch(async (url, init = {}) => {
    seen.push({ url: String(url), init });
    const u = String(url);
    const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b, text: async () => JSON.stringify(b), headers: new Map() });
    if (u.endsWith("/api/whoami-v2")) return json({ name: "ravi", auth: { accessToken: { role: "write" } } });
    if (u.includes("/api/models?")) return json([{ id: "a/b", downloads: 3 }]);
    if (u.includes("/preupload/")) return json({ files: [{ path: "README.md", uploadMode: "regular", shouldIgnore: false }] });
    if (u.includes("/commit/")) return json({ commitOid: "abc", commitUrl: "https://huggingface.co/a/b/commit/abc" });
    if (u.endsWith("/api/repos/create")) return json({ url: "https://huggingface.co/ravi/new" });
    if (u.includes("/api/jobs/ravi") && init.method === "POST") return json({ id: "job1", status: { stage: "RUNNING" } });
    return json({ error: "nope" }, 404);
  });
  const who = await api.whoami("hf_x");
  check(who.name === "ravi" && seen[0].init.headers.Authorization === "Bearer hf_x", "whoami sends the bearer token");
  const found = await api.search("hf_x", { type: "model", search: "bert" });
  check(found[0].id === "a/b" && found[0].url.endsWith("/a/b"), "search returns shaped repos");
  await api.createRepo("hf_x", { type: "model", name: "new" });
  const body = JSON.parse(seen.at(-1).init.body);
  check(body.private === true && body.name === "new", "a new repo is private unless asked otherwise");
  const out = await api.commitFiles("hf_x", { type: "model", id: "ravi/new", summary: "add", files: [{ path: "README.md", content: "# x" }] });
  check(out.commitOid === "abc", "commit returns the commit");
  check(seen.at(-1).init.headers["Content-Type"] === "application/x-ndjson", "commit is sent as NDJSON");
  const before = seen.length;
  let big;
  try {
    await api.commitFiles("hf_x", { type: "model", id: "ravi/new", summary: "x", files: [{ path: "a.txt", contentBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64") }] });
  } catch (e) {
    big = e;
  }
  check(/10 MB/.test(big?.message || "") && seen.length === before, "an oversized commit is refused before any request");
  const job = await api.runJob("hf_x", { namespace: "ravi", image: "python:3.12", command: ["python", "-c", "print(1)"], flavor: "cpu-basic", timeoutSeconds: 600 });
  const jb = JSON.parse(seen.at(-1).init.body);
  check(job.id === "job1" && jb.dockerImage === "python:3.12" && jb.timeoutSeconds === 600, "runJob posts the documented body");
  let err;
  try {
    await api.getRepo("hf_x", { type: "model", id: "no/such" });
  } catch (e) {
    err = e;
  }
  check(err?.status === 404, "a 404 surfaces as a translated error");
  api.setFetch(null);
}

const kg = await import("../lib/server/kaggleShape.js");

console.log("\nKaggle: refs, accelerators, kernels");
check(kg.splitRef("ravi/titanic-baseline").slug === "titanic-baseline", "owner/slug splits");
throws(() => kg.splitRef("titanic"), "a bare slug is refused", /owner\/slug/);
check(kg.machineShape("T4") === "NvidiaTeslaT4" && kg.machineShape("tpu") === "TpuV5E8", "aliases map to Kaggle's names");
check(kg.machineShape("p100") === "NvidiaTeslaT4", "P100 is retired, so the alias asks for the T4 it would run on anyway");
check(kg.machineShape(undefined) === null, "no accelerator is CPU");
throws(() => kg.machineShape("RTX9000"), "an unknown accelerator names the real ones", /T4/);
{
  const r = kg.kernelRequest({ ref: "ravi/exp-1", title: "Exp 1", source: "print(1)", kind: "script", accelerator: "T4", datasets: ["owner/ds"] });
  check(r.slug === "ravi/exp-1" && r.newTitle === "Exp 1" && r.text === "print(1)", "slug, title and text");
  check(r.kernelType === "script" && r.language === "python", "script in python by default");
  check(r.isPrivate === true && r.enableGpu === true && r.machineShape === "NvidiaTeslaT4", "private, GPU on, shape set");
  check(r.datasetDataSources.join() === "owner/ds", "dataset sources pass through");
  check(kg.kernelRequest({ ref: "ravi/x", title: "x", source: "1", kind: "script" }).enableGpu === false, "no accelerator, no GPU");
  throws(() => kg.kernelRequest({ ref: "ravi/x", title: "x", source: "1", kind: "script", isPrivate: false }), "making a kernel public is refused", /private/);
}
{
  const nb = JSON.parse(kg.notebookFromCells([{ type: "markdown", source: "# hi" }, { type: "code", source: "x = 1\nprint(x)" }]));
  check(nb.nbformat === 4 && nb.cells.length === 2 && nb.cells[1].cell_type === "code", "cells build a v4 notebook");
  check(nb.cells[1].source.join("") === "x = 1\nprint(x)", "source round-trips");
}

console.log("\nKaggle: status and quota");
check(kg.normalizeStatus("COMPLETE") === "complete" && kg.normalizeStatus("CANCEL_ACKNOWLEDGED") === "cancelled", "statuses normalise");
check(kg.normalizeStatus("kernelworkerstatus.running") === "running", "a prefixed enum still normalises");
check(kg.normalizeStatus("WAT") === "unknown", "an unknown status is unknown, not an error");
check(kg.seconds("3600s") === 3600 && kg.seconds(90) === 90 && kg.seconds({ seconds: 60, nanos: 5e8 }) === 60.5, "durations parse in every shape");
{
  const q = kg.shapeQuota({
    quotaRefreshTime: "2026-10-10T00:00:00Z",
    gpuQuota: { timeUsed: "36000s", totalTimeAllowed: "108000s" },
    tpuQuota: { timeUsed: 0, totalTimeAllowed: "72000s" },
  });
  check(q.gpu.usedHours === 10 && q.gpu.limitHours === 30 && q.gpu.leftHours === 20, "GPU hours used/limit/left");
  check(q.tpu.leftHours === 20 && q.refreshesAt === "2026-10-10T00:00:00Z", "TPU and refresh time");
}

console.log("\nKaggle: sorting, auth, errors");
check(kg.sortFor("datasets", "votes") === "DATASET_SORT_BY_VOTES", "dataset sort maps");
check(kg.sortFor("kernels", "votes") === "VOTE_COUNT", "kernel sort maps");
throws(() => kg.sortFor("datasets", "stars"), "an unknown sort names the real ones", /hottest/);
check(kg.authHeader("KGAT_abc") === "Bearer KGAT_abc", "a token is a bearer");
check(kg.authHeader("Basic cmF2aTprZXk=") === "Basic cmF2aTprZXk=", "a legacy key stays basic");
check(/paste/i.test(kg.kaggleError(401, {}).message), "401 says to paste a new token");

// (Task 6 appends here.)

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
