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

console.log("\nInsights — the overview and the top-repositories filter (pure)");
{
  const gi = await import("../lib/server/githubInsights.js");

  // A calendar built by hand: 70 days ending 2026-10-07, with a known shape.
  const end = Date.parse("2026-10-07T00:00:00Z");
  const day = (i) => new Date(end - i * 86400000).toISOString().slice(0, 10);
  const counts = {};
  for (let i = 0; i < 70; i++) counts[day(i)] = 0;
  for (let i = 1; i <= 4; i++) counts[day(i)] = 2; // streak of 4 ending yesterday; today blank
  for (let i = 40; i <= 49; i++) counts[day(i)] = 1; // longest run, 10 days, inside the prior 30
  const dates = Object.keys(counts).sort();
  const weeks = [];
  for (let i = 0; i < dates.length; i += 7) {
    weeks.push({ contributionDays: dates.slice(i, i + 7).map((d) => ({ date: d, contributionCount: counts[d] })) });
  }
  const cal = gi.summariseCalendar(weeks, "2026-10-07");
  check(cal.total === 18, "the calendar totals every day", String(cal.total));
  check(cal.last30 === 8 && cal.prev30 === 10, "last 30 days against the 30 before", `${cal.last30} vs ${cal.prev30}`);
  check(cal.change30 === -20, "with a direction, as a percentage", String(cal.change30));
  check(cal.streak.current === 4, "a blank TODAY does not break the streak — the day is not over", String(cal.streak.current));
  check(cal.streak.longest === 10, "and the longest run is found anywhere in the year", String(cal.streak.longest));
  const later = gi.summariseCalendar(weeks, "2026-10-06");
  check(later.days.every((d) => d.date <= "2026-10-06"), "days after 'today' are ignored, so a test can pin the date");

  check(gi.changeOf(5, 0) === null, "a change against zero is null (rendered 'new'), never Infinity");
  check(gi.changeOf(0, 0) === 0, "and nothing against nothing is no change");

  const lv = gi.levelsFor([{ contributionCount: 0 }, { contributionCount: 1 }, { contributionCount: 40 }]);
  check(lv(0) === 0 && lv(40) === 4 && lv(1) >= 1, "shading steps come from the account's own spread");

  const share = gi.languageShare([
    { isFork: false, languages: { edges: [{ size: 900, node: { name: "Rust", color: "#dea584" } }] } },
    { isFork: false, languages: { edges: [{ size: 100, node: { name: "JavaScript" } }] } },
    { isFork: true, languages: { edges: [{ size: 100000, node: { name: "C" } }] } },
  ]);
  check(share.languages[0].name === "Rust" && Math.abs(share.languages[0].share - 0.9) < 1e-9,
    "the language mix is by BYTES, not by counting primary languages");
  check(!share.languages.some((l) => l.name === "C"), "and a fork's code is somebody else's, so it is excluded");

  const now = Date.parse("2026-10-07T12:00:00Z");
  const r = (name, o) => ({ name, description: "", topics: [], stars: 0, forks: 0, isFork: false, archived: false, private: false, language: "JavaScript", ...o });
  const repos = [
    r("old-star", { stars: 90, pushedAt: "2025-01-01T00:00:00Z", createdAt: "2020-01-01T00:00:00Z" }),
    r("fresh", { stars: 3, pushedAt: "2026-10-06T00:00:00Z", createdAt: "2026-09-01T00:00:00Z", language: "Rust" }),
    r("month", { stars: 10, forks: 7, pushedAt: "2026-09-20T00:00:00Z", createdAt: "2024-01-01T00:00:00Z" }),
    r("forked", { stars: 500, isFork: true, pushedAt: "2026-10-07T00:00:00Z" }),
    r("shelved", { stars: 200, archived: true, pushedAt: "2026-10-01T00:00:00Z" }),
    r("secret", { private: true, pushedAt: "2026-10-05T00:00:00Z", description: "cgroups runtime" }),
  ];
  const names = (o) => gi.rankRepos(repos, { now, ...o }).map((x) => x.name).join(",");
  check(names({}) === "fresh,secret,month,old-star", "default: recently changed first, forks and archived left out", names({}));
  check(names({ sort: "stars" }) === "old-star,month,fresh,secret", "most starred", names({ sort: "stars" }));
  check(names({ sort: "stars", window: "30d" }) === "month,fresh,secret",
    "the window filters on LAST CHANGE whatever the sort", names({ sort: "stars", window: "30d" }));
  check(names({ window: "7d" }) === "fresh,secret", "past week", names({ window: "7d" }));
  check(names({ sort: "forks", limit: 1 }) === "month", "most forked, with a limit");
  check(names({ sort: "created" }).startsWith("fresh"), "newest first");
  check(names({ language: "rust" }) === "fresh", "language, case-insensitive");
  check(names({ visibility: "private" }) === "secret", "private only");
  check(names({ includeForks: true, includeArchived: true }).split(",").length === 6, "forks and archived when asked");
  check(names({ q: "cgroups" }) === "secret", "search reads the description too");
  await refuses(async () => gi.rankRepos(repos, { sort: "hot" }), "an unknown sort is refused with the list", /pushed, stars/);
  await refuses(async () => gi.rankRepos(repos, { window: "2w" }), "an unknown window is refused with the list", /7d/);

  const t = gi.repoTotals(repos);
  check(t.stars === 303 && t.forks === 1, "totals count ORIGINALS' stars only (a fork's stars are not yours)", JSON.stringify(t));
  check(gi.ago("2026-10-06T12:00:00Z", now) === "yesterday", "relative time reads like a person", gi.ago("2026-10-06T12:00:00Z", now));

  const shaped = gi.shapeAnalytics({ login: "x", followers: { totalCount: 3 }, contributionsCollection: {} }, "2026-10-07");
  check(shaped.followers === 3 && shaped.calendar.total === 0, "an empty account shapes without throwing");
  check(/contributionCalendar/.test(gi.ANALYTICS_QUERY) && /ownerAffiliations: OWNER/.test(gi.ANALYTICS_QUERY),
    "the query reads the calendar and only OWNED repositories");
  const v = gi.analyticsVariables(new Date("2026-10-07T00:00:00Z"));
  check((Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 365, "the window stays inside GitHub's one-year limit");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("FAILURES:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
