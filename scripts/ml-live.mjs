// Live smoke for the ML lab. Needs real tokens in the environment and costs
// nothing: a CPU-only private Kaggle script and reads on Hugging Face.
//
//   HF_TOKEN=hf_… KAGGLE_API_TOKEN=… node scripts/ml-live.mjs
//
// It proves the parts the no-network suite cannot: that the Hub answers the
// paths we call, and that Kaggle accepts the RPC field names taken from
// kagglesdk's request classes.
const hf = await import("../lib/server/huggingface.js");
const kg = await import("../lib/server/kaggle.js");
const { kernelRequest } = await import("../lib/server/kaggleShape.js");

const { HF_TOKEN, KAGGLE_API_TOKEN } = process.env;
if (!HF_TOKEN || !KAGGLE_API_TOKEN) {
  console.log("Set HF_TOKEN and KAGGLE_API_TOKEN.");
  process.exit(2);
}

const me = await hf.whoami(HF_TOKEN);
console.log("HF:", me.name, me.auth?.accessToken?.role);
console.log("HF search:", (await hf.search(HF_TOKEN, { search: "bert", limit: 3 })).map((r) => r.id).join(", "));
console.log("HF datasets:", (await hf.search(HF_TOKEN, { type: "dataset", search: "mnist", limit: 3 })).map((r) => r.id).join(", "));

const who = await kg.introspect(KAGGLE_API_TOKEN);
console.log("Kaggle:", who.username, JSON.stringify(await kg.quota(KAGGLE_API_TOKEN)));
const ds = await kg.searchDatasets(KAGGLE_API_TOKEN, { search: "titanic", pageSize: 3 });
console.log("Kaggle datasets:", JSON.stringify(ds).slice(0, 200));

const ref = `${who.username}/ml-lab-smoke`;
const pushed = await kg.pushKernel(
  KAGGLE_API_TOKEN,
  kernelRequest({
    ref,
    title: "ml lab smoke",
    kind: "script",
    source: 'import json\njson.dump({"ok": 1}, open("metrics.json", "w"))\nprint("hello")',
  })
);
console.log("pushed:", pushed.url || pushed.error);
for (let i = 0; i < 30; i++) {
  const s = await kg.kernelStatus(KAGGLE_API_TOKEN, { ref });
  console.log("status:", s.status, s.failureMessage || "");
  if (["complete", "error", "cancelled"].includes(s.status)) break;
  await new Promise((r) => setTimeout(r, 20000));
}
const out = await kg.kernelOutput(KAGGLE_API_TOKEN, { ref });
console.log("outputs:", out.files.map((f) => f.name).join(", "));
process.exit(out.files.some((f) => f.name === "metrics.json") ? 0 : 1);
