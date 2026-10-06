// LinkedIn, checked with no network and no credentials.
//
// The interesting assertions here are the REFUSALS. Most of what a LinkedIn
// integration is asked for does not exist as an API, and the failure mode to
// guard against is a tool that quietly does something else instead — posts
// truncated at 3000 characters by LinkedIn rather than refused here, a post
// carrying both a link and an image where only one renders, a drift report
// that calls an unreadable field "changed".
//
//   node scripts/linkedin-check.mjs
const {
  CAPABILITIES,
  MAX_POST_CHARS,
  assertPostable,
  buildPostBody,
  postUrl,
  jobSearchUrl,
  profileDrift,
  draftFromPost,
  deletePost,
  LinkedInError,
} = await import("../lib/server/linkedin.js");

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
    check(!re || re.test(e.message), name, re ? e.message.slice(0, 110) : "");
  }
};

const AUTHOR = "urn:li:person:abc123";

console.log("\nwhat LinkedIn allows is recorded as data, not as a comment");
{
  // The panel, the MCP tools and this suite all read the same object, so a
  // capability cannot be described one way in the UI and another in a tool.
  const must = [
    ["post", true],
    ["readBasicProfile", true],
    ["readFullProfile", false],
    ["updateProfile", false],
    ["searchJobs", false],
    ["applyToJobs", false],
    ["listOwnPosts", false],
  ];
  for (const [key, available] of must) {
    check(
      CAPABILITIES[key] && CAPABILITIES[key].available === available,
      `${key} is recorded as ${available ? "available" : "unavailable"}`,
      JSON.stringify(CAPABILITIES[key])
    );
  }
  // An unavailable capability without a route that works is just a complaint.
  const unavailable = Object.entries(CAPABILITIES).filter(([, v]) => !v.available);
  check(
    unavailable.every(([, v]) => v.why && v.instead),
    "every unavailable capability says WHY and what to do instead",
    String(unavailable.filter(([k, v]) => !(v.why && v.instead)).map(([k]) => k))
  );
}

console.log("\nthe 3000-character cap is enforced here, not by LinkedIn");
{
  check(MAX_POST_CHARS === 3000, "the cap is 3000", String(MAX_POST_CHARS));
  check(assertPostable("  hello  ") === "hello", "text is trimmed");
  await throws(() => assertPostable("   "), "an empty post is refused", /needs some text/i);
  await throws(
    () => assertPostable("x".repeat(3001)),
    "one character over is refused, with both numbers",
    /3000.*3001|3001/
  );
  check(assertPostable("x".repeat(3000)).length === 3000, "exactly at the cap is allowed");
  // LinkedIn silently truncates past the cap, so refusing is the only way the
  // author ever learns the end of their post was cut off.
  check(
    /Shorten it rather than letting LinkedIn cut it/.test(
      (() => {
        try {
          assertPostable("x".repeat(3100));
        } catch (e) {
          return e.message;
        }
      })()
    ),
    "and the refusal says why it is not just truncated"
  );
}

console.log("\nthe post body matches LinkedIn's UGC shape");
{
  const plain = buildPostBody({ authorUrn: AUTHOR, text: "hello" });
  const c = plain.specificContent["com.linkedin.ugc.ShareContent"];
  check(plain.author === AUTHOR, "the author is the person URN");
  check(plain.lifecycleState === "PUBLISHED", "it publishes rather than drafting");
  check(c.shareMediaCategory === "NONE", "a text post carries no media");
  check(
    plain.visibility["com.linkedin.ugc.MemberNetworkVisibility"] === "PUBLIC",
    "and defaults to public"
  );

  const linked = buildPostBody({
    authorUrn: AUTHOR,
    text: "read this",
    link: { url: "https://ravikishan.me/blog/x", title: "X", description: "Y" },
  });
  const lc = linked.specificContent["com.linkedin.ugc.ShareContent"];
  check(lc.shareMediaCategory === "ARTICLE", "a link post is an ARTICLE");
  check(lc.media[0].originalUrl === "https://ravikishan.me/blog/x", "with the URL attached");
  check(lc.media[0].status === "READY", "and media marked READY");

  const img = buildPostBody({
    authorUrn: AUTHOR,
    text: "look",
    image: { asset: "urn:li:digitalmediaAsset:1" },
  });
  check(
    img.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory === "IMAGE",
    "an image post is an IMAGE"
  );

  const conn = buildPostBody({ authorUrn: AUTHOR, text: "hi", visibility: "CONNECTIONS" });
  check(
    conn.visibility["com.linkedin.ugc.MemberNetworkVisibility"] === "CONNECTIONS",
    "connections-only is honoured"
  );
  await throws(
    () => buildPostBody({ authorUrn: AUTHOR, text: "hi", visibility: "FRIENDS" }),
    "an unknown visibility is refused rather than defaulted",
    /PUBLIC.*CONNECTIONS/
  );
  // LinkedIn renders one or the other, so sending both loses one silently.
  await throws(
    () =>
      buildPostBody({
        authorUrn: AUTHOR,
        text: "hi",
        link: { url: "https://x.test" },
        image: { asset: "urn:li:digitalmediaAsset:1" },
      }),
    "a link AND an image together is refused",
    /either a link preview or an image/
  );
}

console.log("\ndeleting refuses anything that is not a post URN");
await throws(
  () => deletePost("token", "12345"),
  "a bare id is not a URN",
  /not a LinkedIn post URN/
);
await throws(
  () => deletePost("token", ""),
  "and neither is nothing",
  /not a LinkedIn post URN/
);

console.log("\npermalinks");
{
  const u = postUrl("urn:li:share:7123");
  check(u.startsWith("https://www.linkedin.com/feed/update/"), "a URN becomes a feed URL", u);
  check(u.includes(encodeURIComponent("urn:li:share:7123")), "with the URN encoded");
  check(postUrl("") === "", "and nothing becomes nothing");
}

console.log("\njob search is a URL, because there is no API");
{
  const u = new URL(
    jobSearchUrl({ keywords: "distributed systems", location: "India", remote: true, postedWithinDays: 7, experience: "mid-senior" })
  );
  check(u.host === "www.linkedin.com", "it points at LinkedIn", u.host);
  check(u.searchParams.get("keywords") === "distributed systems", "keywords travel");
  check(u.searchParams.get("location") === "India", "location travels");
  // LinkedIn's own filter ids; getting these wrong silently returns the
  // unfiltered search, which looks like it worked.
  check(u.searchParams.get("f_WT") === "2", "remote is f_WT=2");
  check(u.searchParams.get("f_TPR") === "r604800", "a week is r604800 seconds");
  check(u.searchParams.get("f_E") === "4", "mid-senior is f_E=4");
  const bare = new URL(jobSearchUrl({}));
  check([...bare.searchParams.keys()].length === 0, "an empty search adds no filters");
  check(
    !CAPABILITIES.searchJobs.available && !CAPABILITIES.applyToJobs.available,
    "and neither searching nor applying claims to be an API"
  );
}

console.log("\ndrift is three-valued, because most of the profile is unreadable");
{
  const d = profileDrift({
    site: {
      headline: "Software Engineer — distributed systems",
      about: "Builds infrastructure from first principles.",
      location: "Bihar, India",
      website: "https://ravikishan.me",
    },
    linkedin: { headline: "Full Stack Developer", website: "https://ravikishan.me" },
  });
  const by = Object.fromEntries(d.rows.map((r) => [r.field, r.state]));
  check(by.headline === "drift", "a known, different value is drift", by.headline);
  check(by.website === "match", "a known, equal value is a match", by.website);
  // The trap the Medium integration already taught: reporting "not there"
  // when you simply could not look is how you act on a false difference.
  check(by.about === "unknown", "an unreadable field is unknown, NOT drift", by.about);
  check(by.location === "unknown", "same for location", by.location);
  check(d.drifting === 1, "one row is drifting", String(d.drifting));
  check(d.unknown === 2, "two are unknown", String(d.unknown));

  const unset = profileDrift({ site: {}, linkedin: {} });
  check(
    unset.rows.every((r) => r.state === "unset"),
    "nothing canonical to compare reads as unset, not as a match"
  );

  const long = profileDrift({
    site: { headline: "x".repeat(230) },
    linkedin: { headline: "y" },
  });
  check(
    /caps Headline at 220/.test(long.rows.find((r) => r.field === "headline").warning || ""),
    "a headline past LinkedIn's own cap is flagged"
  );
}

console.log("\na blog post becomes a draft, not a published post");
{
  const d = draftFromPost({
    title: "Writing a container runtime",
    excerpt: "Namespaces, cgroups and a very small init.",
    url: "https://ravikishan.me/blog/container-runtime",
    tags: ["linux", "systems programming", "go"],
  });
  check(d.text.startsWith("Writing a container runtime"), "the title leads");
  check(d.text.includes("https://ravikishan.me/blog/container-runtime"), "the URL is in the body");
  check(d.link.url.endsWith("/container-runtime"), "and attached as the link preview");
  // A hashtag with a space in it is not a hashtag.
  check(d.text.includes("#systemsprogramming"), "tags become hashtags with spaces removed", d.text);
  check(!d.overLimit, "a normal post is within the cap");

  const big = draftFromPost({
    title: "T",
    excerpt: "x".repeat(4000),
    url: "https://ravikishan.me/blog/x",
  });
  check(big.overLimit === true, "an oversized draft says so");
  check(big.text.length <= MAX_POST_CHARS, "and is clipped rather than handed over too long");

  await throws(
    () => draftFromPost({ excerpt: "no title" }),
    "a draft with no title or URL is refused",
    /title and a URL/
  );
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
