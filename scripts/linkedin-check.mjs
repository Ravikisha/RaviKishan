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
  canonicalHeadline,
  headlineDrift,
  MAX_HEADLINE_CHARS,
  RETIRED_PHRASES,
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

/* ---- the composer's feed fold and the setup panel's redirect URLs ---- */
{
  const { feedOpening, FEED_FOLD, linkedinRedirectUris, LINKEDIN_CALLBACK_PATH } = await import(
    "../lib/server/linkedinText.js"
  );
  console.log("\nfeed fold");
  check(feedOpening("").shown === "" && !feedOpening("").cut, "an empty post shows nothing and is not cut");
  check(!feedOpening("A short post.").cut, "a short post shows whole");
  const long = "word ".repeat(100);
  const o = feedOpening(long);
  check(o.cut && o.shown.length <= FEED_FOLD, "a long post is cut at the fold", String(o.shown.length));
  check(!/\bwor$/.test(o.shown) && o.shown.endsWith("word"), "on a word boundary, never mid-word", o.shown.slice(-8));
  // A blank line costs a line: three short lines fold long before 210 chars.
  const lines = feedOpening("Hook.\n\nSecond paragraph.\n\nThird.");
  check(lines.cut && lines.shown === "Hook.\n\nSecond paragraph.", "the fold also counts lines, blank ones included", JSON.stringify(lines.shown));
  check(!feedOpening("one\ntwo\nthree").cut, "exactly three lines is not cut");

  console.log("\nredirect URLs");
  const prod = linkedinRedirectUris("");
  // The apex 308s to www, so the URL the app actually sends on production is
  // the www one. Listing only the apex is how the first click fails.
  check(prod.includes(`https://www.ravikishan.me${LINKEDIN_CALLBACK_PATH}`), "the www production URL is listed");
  check(prod.includes(`https://ravikishan.me${LINKEDIN_CALLBACK_PATH}`), "and the apex");
  check(prod.includes(`http://localhost:3000${LINKEDIN_CALLBACK_PATH}`), "and local dev");
  const local = linkedinRedirectUris("http://localhost:3001");
  check(local.includes(`http://localhost:3001${LINKEDIN_CALLBACK_PATH}`), "the origin it is running on is added");
  check(
    linkedinRedirectUris("https://www.ravikishan.me").length === prod.length,
    "but never twice"
  );
  check(
    linkedinRedirectUris("javascript:alert(1)").length === prod.length,
    "and an origin that is not http(s) is ignored"
  );
}

/* ---- edit, comment, react ---- */
{
  const T = await import("../lib/server/linkedinText.js");
  console.log("\nlittle escaping");
  check(T.escapeLittle("(see below)") === "\\(see below\\)", "parentheses are escaped", T.escapeLittle("(see below)"));
  check(
    T.escapeLittle("a|b{c}@d[e]<f>\\g*h_i~j") === "a\\|b\\{c\\}\\@d\\[e\\]\\<f\\>\\\\g\\*h\\_i\\~j",
    "every reserved character is escaped, the backslash included",
    T.escapeLittle("a|b{c}@d[e]<f>\\g*h_i~j")
  );
  check(T.escapeLittle("#rust and #Go") === "#rust and #Go", "a #word stays a hashtag");
  check(T.escapeLittle("C# and # alone") === "C\\# and \\# alone", "a # that starts no word is escaped");
  check(T.escapeLittle("plain words, 100%!") === "plain words, 100%!", "ordinary text is untouched");
  check(T.buildPostEdit("Hi (there)").patch.$set.commentary === "Hi \\(there\\)", "an edit sends escaped commentary");
  await throws(() => T.buildPostEdit("x".repeat(3001)), "an edit over the post cap is refused", /3000/);

  console.log("\nURNs");
  check(T.assertPostUrn("urn:li:share:123") === "urn:li:share:123", "a share URN is a post");
  check(T.assertPostUrn("urn:li:ugcPost:9") === "urn:li:ugcPost:9", "so is a ugcPost");
  await throws(() => T.assertPostUrn("urn:li:person:abc"), "a person URN is not a post", /not a LinkedIn post URN/);
  check(
    T.postUrnFrom("https://www.linkedin.com/feed/update/urn:li:activity:7381234567890/") === "urn:li:activity:7381234567890",
    "a pasted feed link yields its URN"
  );
  check(
    T.postUrnFrom("https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A55/") === "urn:li:share:55",
    "even percent-encoded"
  );
  const c = T.parseCommentUrn("urn:li:comment:(urn:li:activity:111,222)");
  check(c.thread === "urn:li:activity:111" && c.id === "222", "a comment URN splits into thread and id");
  await throws(() => T.parseCommentUrn("urn:li:share:1"), "a post URN is not a comment", /not a LinkedIn comment URN/);

  console.log("\ncomments and reactions");
  const body = T.buildComment({ actorUrn: "urn:li:person:me", postUrn: "urn:li:share:1", text: " Nice " });
  check(body.object === "urn:li:share:1" && body.message.text === "Nice" && !body.parentComment, "a comment names its post and trims");
  const reply = T.buildComment({
    actorUrn: "urn:li:person:me",
    postUrn: "urn:li:share:1",
    text: "Agreed",
    parentCommentUrn: "urn:li:comment:(urn:li:activity:111,222)",
  });
  check(reply.parentComment === "urn:li:comment:(urn:li:activity:111,222)", "a reply carries its parent");
  await throws(() => T.assertCommentText("x".repeat(T.MAX_COMMENT_CHARS + 1)), "a comment over the cap is refused", /1250/);
  await throws(() => T.assertCommentText("   "), "an empty comment is refused", /needs some text/);
  check(T.reactionType("celebrate") === "PRAISE" && T.reactionType("love") === "EMPATHY", "friendly reaction names map to LinkedIn's enum");
  await throws(() => T.reactionType("curious"), "the deprecated Curious is refused", /Unknown reaction/);
  check(/^\d{6}$/.test(T.LINKEDIN_API_VERSION) && T.LINKEDIN_API_VERSION >= "202510", "the API version is a live YYYYMM", T.LINKEDIN_API_VERSION);
  check(
    ["editPost", "comment", "react"].every((k) => T.CAPABILITIES[k]?.available) && !T.CAPABILITIES.readComments.available,
    "capabilities: edit, comment and react are on; reading comments is not"
  );
  check(
    Object.keys(T.CAPABILITIES).every((k) => T.CAPABILITY_LABELS[k]),
    "every capability has a label"
  );
}


// The headline is the one field LinkedIn will not let software write, and the
// one most people read. So the only thing that can go wrong here is the
// detector itself being wrong -- saying a headline agrees when it does not,
// or crying drift on a headline nobody can read.
console.log("\nthe headline comparison");
{
  const canonical = canonicalHeadline({
    role: "Software Engineer",
    focus: ["Distributed Systems", "Systems Programming", "Applied AI"],
    now: "Agentic AI Engineer @ Zimyo",
  });
  check(canonical.startsWith("Software Engineer |"), "the canonical headline leads with the role", canonical);
  check(
    canonicalHeadline({ role: "Software Engineer" }) === "Software Engineer",
    "and omits the parts that are not set"
  );

  // The real one, as it stands on the account.
  const live =
    "AI Engineer @ Zimyo | Full Stack Developer | Cloud-Native & Scalable Systems Architect | Multi-Paradigm Programming Expert | Freelancer | VIT'26 MCA";
  const d = headlineDrift(live, canonical);
  check(d.state === "drift", "a headline carrying a retired title is drift", d.state);
  check(
    d.retired.map((r) => r.says).join(",") === "Full Stack Developer,Freelancer",
    "and both retired phrases are named",
    d.retired.map((r) => r.says).join(", ")
  );
  check(d.retired.every((r) => r.why && r.why.length > 20), "each one says WHY it was retired");
  check(d.leadsRight === false, "and it does not lead with the canonical role");

  // The quiet case.
  const ok = headlineDrift(canonical, canonical);
  check(ok.state === "match", "an identical headline matches", ok.state);
  // Extra clauses after the role are fine -- what matters is what it opens with.
  const extra = headlineDrift(canonical + " | VIT'26 MCA", canonical);
  check(extra.state === "match", "extra clauses after the role still match", extra.state);

  // THE one that must not lie: an unread headline is unknown, never a match.
  // Reporting "agrees" about something nobody fetched is how a drift detector
  // becomes a thing you stop believing.
  for (const empty of ["", null, undefined, "   "]) {
    const u = headlineDrift(empty, canonical);
    check(u.state === "unknown", `an unreadable headline is unknown, not a match (${JSON.stringify(empty)})`, u.state);
  }
  check(/linkedin:snapshot/.test(headlineDrift("", canonical).note), "and it says how to make it readable");

  // Case and spacing must not change the verdict.
  check(headlineDrift("FULL-STACK DEVELOPER", canonical).retired.length === 1, "the match is case- and hyphen-insensitive");
  check(headlineDrift("I am a fullstack developer", canonical).retired.length === 1, "and catches the unspaced spelling");
  // A word that merely CONTAINS a retired phrase as a substring of something
  // else must not trip it -- "freelancers" is fine, "Freelancer" is not.
  check(headlineDrift("Built for freelancersonline", canonical).retired.length === 0, "but does not fire on a longer word");

  check(MAX_HEADLINE_CHARS === 220, "the cap is LinkedIn's", String(MAX_HEADLINE_CHARS));
  const long = headlineDrift("x".repeat(260), canonical);
  check(long.overLength === true, "an over-long headline is flagged rather than truncated silently");
  check(RETIRED_PHRASES.every((r) => r.match instanceof RegExp && r.says && r.why), "every retired phrase carries its reason");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
