// The launch pipeline, checked with no network and no credentials.
//
//   node scripts/launch-check.mjs
//   LAUNCH_LIVE=1 ... also hits the public npm registry (no token needed)
//
// What is worth asserting here is not "does it record a step". It is the two
// ways a re-run does damage that cannot be undone:
//
//   1. Publishing a version number twice. npm refuses to unpublish after 72
//      hours and refuses immediately once anything depends on the package, so
//      a repeated publish is permanent.
//   2. Posting to LinkedIn or dev.to twice, which cannot be unsent.
//
// Both are prevented by the same thing: `claimStep` refuses a step that is
// already settled. So most of this file is about the refusals, and about the
// ORDER - because a blog post published before the deploy it links to is a
// live 404, and a cross-post before the blog takes the canonical copy.
import {
  IRREVERSIBLE,
  STEPS,
  STEP_IDS,
  assertClaimable,
  assertSlug,
  assertStep,
  isDone,
  launchProgress,
  markStep,
  newLaunch,
  nextStep,
  stepById,
} from "../lib/server/launch.js";
import {
  SEMVER_RE,
  checkVersion,
  npmPackage,
  releaseWorkflow,
  vercelConfigured,
} from "../lib/server/release.js";
import { MAX_COMMIT_FILES, commitFiles } from "../lib/server/github.js";

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
const throws = async (fn, name, re) => {
  try {
    await fn();
    check(false, name, "it did not throw");
  } catch (e) {
    check(!re || re.test(e.message), name, re ? e.message.slice(0, 150) : "");
  }
};

/* ------------------------------------------------------------------ */

console.log("\nthe pipeline is an ordered sequence");
{
  check(STEP_IDS.length === 10, "ten steps", String(STEP_IDS.length));
  check(STEP_IDS[0] === "plan", "it starts by writing the plan down");
  check(
    STEP_IDS.indexOf("deploy") < STEP_IDS.indexOf("blog"),
    "deploy comes before the blog, or the post links at a 404"
  );
  check(
    STEP_IDS.indexOf("package") < STEP_IDS.indexOf("blog"),
    "the package is published before the post that shows its install line"
  );
  check(
    STEP_IDS.indexOf("blog") < STEP_IDS.indexOf("crosspost"),
    "the blog is written before it is cross-posted, so this site stays canonical"
  );
  check(
    STEP_IDS.indexOf("announce") > STEP_IDS.indexOf("deploy"),
    "and nothing is announced before it is live"
  );
  check(STEP_IDS[STEP_IDS.length - 1] === "profile", "the manual step is last");
  check(STEPS.every((s) => s.id && s.label), "every step has an id and a label");
}

console.log("\nthe steps that cannot be undone are marked as such");
{
  check(IRREVERSIBLE.includes("package"), "npm publish is irreversible");
  check(IRREVERSIBLE.includes("announce"), "so is the LinkedIn post");
  check(IRREVERSIBLE.includes("crosspost"), "and the dev.to cross-post");
  check(!IRREVERSIBLE.includes("repo"), "but creating a repo is not");
  check(!IRREVERSIBLE.includes("portfolio"), "nor is a portfolio entry");
  check(IRREVERSIBLE.length === 3, "exactly three, so the warning means something", String(IRREVERSIBLE.length));
}

console.log("\nthe slug is checked once, because it cannot change later");
{
  check(assertSlug("my-new-thing") === "my-new-thing", "a clean slug passes");
  for (const bad of ["My-Thing", "my thing", "-leading", "trailing-", "double--hyphen", "", "a/b"])
    throws(() => assertSlug(bad), `"${bad}" is refused`, /not a usable slug/);
  throws(() => assertStep("deploy-it"), "an unknown step names the real ones", /plan, repo, code/);
}

console.log("\nprogress is reported in order");
{
  let rec = newLaunch({ slug: "thing", title: "Thing" });
  check(nextStep(rec) === "plan", "a fresh launch starts at plan");
  check(launchProgress(rec).remaining.length === 10, "with everything remaining");
  check(launchProgress(rec).nextIsIrreversible === false, "and the first step is safe");

  rec = markStep(rec, "plan", { result: { noteId: "n1" } });
  check(nextStep(rec) === "repo", "finishing one advances to the next");
  check(isDone(rec, "plan"), "and the finished one is recorded");
  check(launchProgress(rec).results.plan.noteId === "n1", "with what it produced, for later steps to quote");

  // A skipped step must not come round again - "no npm package" is a normal
  // shape for a launch, not an error to be re-raised at every call.
  rec = markStep(rec, "repo", { result: {} });
  rec = markStep(rec, "code", { result: {} });
  rec = markStep(rec, "deploy", { result: {} });
  rec = markStep(rec, "package", { status: "skipped", note: "not a library" });
  check(nextStep(rec) === "blog", "a skipped step is settled, not pending", String(nextStep(rec)));
  check(launchProgress(rec).skipped.includes("package"), "and is reported as skipped rather than done");
  check(!launchProgress(rec).done.includes("package"), "so it is never counted as shipped");

  for (const id of ["blog", "crosspost", "portfolio", "announce", "profile"])
    rec = markStep(rec, id, { result: {} });
  check(nextStep(rec) === null, "a finished launch has no next step");
  check(rec.status === "complete", "and is marked complete", rec.status);
  check(launchProgress(rec).status === "complete", "which the progress agrees with");
}

console.log("\nthe guard refuses a repeat - this is the whole point");
{
  let rec = newLaunch({ slug: "thing", title: "Thing" });
  for (const id of ["plan", "repo", "code", "deploy"]) rec = markStep(rec, id, { result: {} });
  rec = markStep(rec, "package", { result: { version: "1.0.0" } });

  throws(
    () => assertClaimable(rec, "package"),
    "publishing the same version twice is refused",
    /already done/
  );
  throws(
    () => assertClaimable(rec, "package"),
    "and the refusal says what it produced, so the caller can use it instead",
    /1\.0\.0/
  );
  throws(
    () => assertClaimable(rec, "package"),
    "and names the consequence rather than just saying no",
    /cannot be undone/
  );
  check(
    assertClaimable(rec, "package", { force: true }) === true,
    "force is the deliberate override"
  );
  check(assertClaimable(rec, "blog") === true, "the next step in order is allowed");
}

console.log("\nand refuses to run ahead of the order");
{
  let rec = newLaunch({ slug: "thing", title: "Thing" });
  rec = markStep(rec, "plan", { result: {} });
  throws(
    () => assertClaimable(rec, "announce"),
    "announcing before anything is built is refused",
    /comes after/
  );
  throws(
    () => assertClaimable(rec, "announce"),
    "and the refusal lists exactly what is outstanding",
    /repo.*code.*deploy/
  );
  throws(
    () => assertClaimable(rec, "blog"),
    "so is blogging before the deploy it would link to",
    /404/
  );
  check(assertClaimable(rec, "repo") === true, "but the next step in order is fine");
  check(assertClaimable(rec, "announce", { force: true }) === true, "force overrides the order too");
  throws(() => assertClaimable(null, "plan"), "a launch that does not exist says so", /No such launch/);
}

console.log("\na skipped step is not silently re-run either");
{
  let rec = newLaunch({ slug: "thing", title: "Thing" });
  rec = markStep(rec, "plan", { status: "skipped" });
  throws(() => assertClaimable(rec, "plan"), "it is refused like a completed one", /was skipped/);
  check(assertClaimable(rec, "plan", { force: true }) === true, "and force does it after all");
}

/* ------------------------------------------------------------------ */

console.log("\nnpm: a version is permanent, so semver is checked first");
{
  check(SEMVER_RE.test("1.0.0"), "1.0.0 is semver");
  check(SEMVER_RE.test("2.13.4-beta.1"), "and so is a prerelease");
  for (const bad of ["1.0", "v1.0.0", "01.0.0", "1.0.0.0", "latest", ""])
    check(!SEMVER_RE.test(bad), `"${bad}" is not`);
  await throws(
    () => checkVersion("relaxicons", "1.0"),
    "a bad version is refused before any network call",
    /not a semver/
  );
}

console.log("\nthe release workflow says what it needs");
{
  const w = releaseWorkflow();
  check(/on:\s*\n\s*release:/.test(w), "it triggers on a release, never on a push");
  check(!/\bon:\s*\n\s*push:/.test(w), "so publishing is always deliberate");
  check(/NODE_AUTH_TOKEN/.test(w) && /secrets.NPM_TOKEN/.test(w), "it reads NPM_TOKEN from Actions secrets");
  check(/Automation/.test(w), "and says the token must be an Automation token, which is the 2FA trap");
  check(/id-token: write/.test(w), "provenance is asked for, which needs id-token: write");
  check(/--provenance/.test(w), "and actually passed");
  check(/npm test --if-present/.test(w), "tests run by default");
  check(!/npm test/.test(releaseWorkflow({ runTests: false })), "and can be turned off");
  check(/node-version: "22"/.test(releaseWorkflow({ nodeVersion: "22" })), "the node version is honoured");
}

console.log("\nvercel is optional and says so when it is missing");
{
  check(vercelConfigured({ VERCEL_TOKEN: "x" }) === true, "configured when the token is set");
  check(vercelConfigured({}) === false, "and not when it is not");
  const { linkVercelProject } = await import("../lib/server/release.js");
  await throws(
    () => linkVercelProject({ name: "a", repo: "o/r" }, {}),
    "linking without a token names the variable and where to put it",
    /VERCEL_TOKEN.*Environment tab/s
  );
  await throws(
    () => linkVercelProject({ name: "a", repo: "notaslug" }, { VERCEL_TOKEN: "x" }),
    "and a malformed repo is refused before the call",
    /owner\/name/
  );
}

console.log("\none commit, many files - the guards fire before any request");
{
  await throws(() => commitFiles("t", "o", "r", { files: [] }), "an empty commit is refused", /Nothing to commit/);
  await throws(
    () => commitFiles("t", "o", "r", { files: [{ path: "a.js" }] }),
    "a file with no content is refused",
    /needs content/
  );
  await throws(
    () => commitFiles("t", "o", "r", { files: [{ path: "/etc/passwd", content: "x" }] }),
    "an absolute path is refused",
    /repo-relative/
  );
  await throws(
    () => commitFiles("t", "o", "r", { files: [{ path: "../../x", content: "x" }] }),
    "and so is one that climbs out of the repo",
    /repo-relative/
  );
  await throws(
    () =>
      commitFiles("t", "o", "r", {
        files: Array.from({ length: MAX_COMMIT_FILES + 1 }, (_, i) => ({ path: `f${i}.txt`, content: "x" })),
      }),
    "too many paths is refused with the cap",
    /the cap is 100/
  );
  await throws(
    () => commitFiles("t", "o", "r", { files: [{ path: "big.bin", content: "x".repeat(7 * 1024 * 1024) }] }),
    "and an oversized commit says how big it was",
    /KB/
  );
}

/* ------------------------------------------------------------------ */

if (process.env.LAUNCH_LIVE) {
  console.log("\nagainst the real npm registry (public, no token)");
  const known = await npmPackage("relaxicons");
  check(known.exists, "a package that is published reads as published");
  check(known.versions.length > 0, "with its versions", String(known.versions.length));
  const taken = await checkVersion("relaxicons", known.latest);
  check(taken.taken === true, "its current latest reads as taken");
  check(/never be reused/.test(taken.verdict), "and the verdict says why that matters");
  const free = await checkVersion("relaxicons", "999.0.0");
  check(free.taken === false, "an unused version reads as free");
  const absent = await npmPackage("ravikishan-no-such-package-" + Date.now());
  check(absent.exists === false, "and a name nobody has taken reads as available");
} else {
  console.log("\nlive registry: skipped (set LAUNCH_LIVE=1 to run it)");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
