// GitHub integration, checked without a network, a browser or a token.
//
// Two things are worth pinning here, and neither needs GitHub to be reachable:
//
//   THE GUARDS. Every one refuses BEFORE it reaches for the network, so a
//   malformed call fails on its own terms instead of coming back as GitHub's
//   "Validation Failed" — which names nothing and is the single most annoying
//   way to lose five minutes.
//
//   THE AUDIT. It is the whole reason the panel exists, and it is pure, so the
//   count the admin shows and the count a tool returns come from the same
//   function evaluated here.
//
//   node scripts/github-check.mjs
const { auditRepos, setTopics, updateRepo, updateProfile } = await import("../lib/server/github.js");

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

// Every guard must throw before any fetch happens. A bogus token proves it:
// if a call reached the network it would fail with an auth error instead.
const refuses = async (fn, name, re) => {
  try {
    await fn();
    check(false, name, "it did not throw");
  } catch (e) {
    check(re.test(e.message), name, e.message.slice(0, 110));
  }
};

const repo = (over = {}) => ({
  name: "thing",
  description: "A thing that does a thing.",
  homepage: "https://ravikishan.me",
  topics: ["systems"],
  stars: 10,
  archived: false,
  url: "https://github.com/Ravikisha/thing",
  ...over,
});

console.log("\nguards refuse before they touch the network");

await refuses(
  () => setTopics("t", "o", "r", ["Not A Topic!"]),
  "a topic with spaces and punctuation is refused by name",
  /not valid GitHub topics/i
);
await refuses(
  () => setTopics("t", "o", "r", ["-leading"]),
  "so is one that does not start with a letter or digit",
  /not valid GitHub topics/i
);
await refuses(
  () => setTopics("t", "o", "r", Array.from({ length: 21 }, (_, i) => `topic-${i}`)),
  "more than 20 topics is refused with the count",
  /at most 20 topics; that is 21/
);
await refuses(
  () => updateRepo("t", "o", "r", {}),
  "an empty repository update is refused rather than sent",
  /nothing to change/i
);
await refuses(
  () => updateRepo("t", "o", "r", { description: "x".repeat(351) }),
  "a description over GitHub's 350-character cap is refused",
  /capped at 350 characters; that one is 351/
);
await refuses(
  () => updateProfile("t", {}),
  "an empty profile update is refused",
  /nothing to change/i
);
await refuses(
  () => updateProfile("t", { bio: "x".repeat(161) }),
  "and a bio over 160 characters, which GitHub would silently truncate",
  /capped at 160 characters; that one is 161/
);

console.log("\nthe audit flags what GitHub search and a visitor react to");
{
  const a = auditRepos([repo({ name: "clean" })]);
  check(a.count === 0, "a repository with a description, topics and a homepage is clean", JSON.stringify(a.byIssue));
}
{
  const a = auditRepos([repo({ description: "" })]);
  check(a.byIssue["no description"] === 1, "no description is flagged");
}
{
  const a = auditRepos([repo({ description: "   " })]);
  check(a.byIssue["no description"] === 1, "and whitespace does not count as one");
}
{
  const a = auditRepos([repo({ topics: [] })]);
  check(a.byIssue["no topics"] === 1, "no topics is flagged");
}
{
  // Only once it has enough stars for the missing link to cost anything.
  const few = auditRepos([repo({ stars: 2, homepage: "" })]);
  const many = auditRepos([repo({ stars: 9, homepage: "" })]);
  check(!few.byIssue["no homepage link"], "a quiet repository is not nagged about a homepage");
  check(many.byIssue["no homepage link"] === 1, "a well-starred one is", JSON.stringify(many.byIssue));
}
{
  const a = auditRepos([repo({ description: "x".repeat(400) })]);
  check(a.byIssue["description too long"] === 1, "an over-long description is flagged");
}
{
  // Archived work is finished. Nagging about finished things trains you to
  // ignore the whole list.
  const a = auditRepos([repo({ archived: true, description: "", topics: [] })]);
  check(a.count === 0, "an archived repository is never flagged", JSON.stringify(a.byIssue));
}
{
  const a = auditRepos([repo({ name: "r1" })], { readmes: { r1: null } });
  check(a.byIssue["no README"] === 1, "a missing README is flagged when READMEs were checked");
  const b = auditRepos([repo({ name: "r1" })], { readmes: { r1: "# Hi\n\ntoo short" } });
  check(b.byIssue["thin README"] === 1, "and a stub one is flagged as thin");
  const c = auditRepos([repo({ name: "r1" })], { readmes: { r1: "x".repeat(400) } });
  check(!c.count, "a real README is not");
  // undefined means "not checked" and must be silent — otherwise opening the
  // panel would report every repository as missing a README.
  const d = auditRepos([repo({ name: "r1" })], { readmes: {} });
  check(!d.count, "a README that was never fetched is not reported as missing");
}
{
  const a = auditRepos([repo({ name: "a", description: "", topics: [] }), repo({ name: "b" })]);
  check(a.repos === 1, "it counts REPOSITORIES needing attention, not findings", `${a.repos} repos, ${a.count} findings`);
  check(a.count === 2, "while still reporting every finding", String(a.count));
  check(Array.isArray(a.byRepo.a) && a.byRepo.a.length === 2, "and groups them under the repository that owns them");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("FAILURES:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
