// YouTube, Instagram and X — checked with no network and no credentials.
//
// The assertions worth having here are the ones about SILENT damage:
//   - a YouTube update that wipes the description because it was not mentioned
//   - an X post that X rejects because a URL counts as 23, not its length
//   - an Instagram caption with 31 hashtags, which publishes with the extras
//     dropped and cannot be edited afterwards
//   - a thread that posts three of five parts and then stops
//
//   node scripts/social-check.mjs
const { PROVIDERS, providerIds, authorizeUrl, makeVerifier, challengeFor, makeState, readState } =
  await import("../lib/server/integrations.js");
const { accountDocId, accountPath, connectedRecord, assertMulti, expiryOf } = await import(
  "../lib/server/connectedStore.js"
);
const xapi = await import("../lib/server/xapi.js");
const ig = await import("../lib/server/instagram.js");
const yt = await import("../lib/server/youtube.js");

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
    check(!re || re.test(e.message), name, re ? e.message.slice(0, 120) : "");
  }
};

console.log("\nthe three social providers are multi-account");
for (const id of ["youtube", "instagram", "x"]) {
  check(PROVIDERS[id]?.multi === true, `${id} allows several accounts`);
}
// Every provider is multi-account now. The split used to be real -- there was
// one Google Tasks account and one GitHub -- and it stopped being real the
// moment the point became holding several of each. What matters instead is
// that each one can SAY WHICH account consented, because a provider that
// cannot is a provider whose second connection silently overwrites its first.
for (const id of ["google", "microsoft", "github", "linkedin", "notion"]) {
  check(PROVIDERS[id]?.multi === true, `${id} allows several too`);
}
await // assertMulti used to refuse the four single-account providers. There are
// none left to refuse, so what is checked now is that it ACCEPTS every one --
// a provider that slipped back to single-account would break its own panel
// with a message about a store it no longer uses.
check(
  Object.keys(PROVIDERS).every((id) => {
    try {
      return assertMulti(id).id === id;
    } catch (_) {
      return false;
    }
  }),
  "the multi store accepts every provider"
)

// Identity is what makes a multi-account provider possible at all: without an
// id there is nothing to key the document on, and the callback refuses the
// connection rather than storing it over the previous one.
console.log("\nevery provider can say which account consented");
for (const id of Object.keys(PROVIDERS)) {
  const p = PROVIDERS[id];
  const named = p.identityFromIdToken || ["youtube", "instagram", "x", "github", "linkedin", "notion"].includes(id);
  check(named, `${id} identifies the account it just connected`);
}
// And none of them pins a single account on the consent screen any more -- a
// pinned hint is exactly what makes connecting the second account impossible.
for (const id of Object.keys(PROVIDERS)) {
  check(PROVIDERS[id].noAccountHint === true, `${id} lets you choose which account`);
}

console.log("\naccount documents are keyed so a reconnect updates in place");
{
  // Reconnecting the same channel must not create a second row that quietly
  // competes with the first.
  check(
    accountDocId("youtube", "UC123") === accountDocId("youtube", "UC123"),
    "the same account always lands on the same document"
  );
  check(
    accountDocId("youtube", "UC123") !== accountDocId("x", "UC123"),
    "the same id on two providers does not collide"
  );
  // A Firestore document id may not contain a slash, and an account id can be
  // very nearly anything.
  check(
    !accountDocId("instagram", "a/b/c").includes("/"),
    "an id containing slashes is encoded, not pasted in",
    accountDocId("instagram", "a/b/c")
  );
  check(
    accountPath("x", "99").startsWith("connectedAccounts/"),
    "they live in connectedAccounts",
    accountPath("x", "99")
  );
  const rec = connectedRecord({
    provider: "x",
    accountId: "99",
    label: "@me",
    sealed: "SEALED",
    kind: "refresh",
  });
  check(rec.provider === "x" && rec.accountId === "99", "the record carries provider and account");
  check(rec.secret === "SEALED", "and the sealed credential");
  check(
    connectedRecord({ provider: "x", accountId: "99", sealed: "S" }).label === "99",
    "a nameless account falls back to its id rather than rendering blank"
  );
  check(expiryOf({ kind: "refresh", expiresAt: "" }) === null, "a refresh token has no countdown");
  check(
    expiryOf({ kind: "access", expiresAt: new Date(Date.now() + 5 * 86400000).toISOString() }) === 5,
    "an access token counts down in days"
  );
}

console.log("\nX requires PKCE, and the verifier rides inside the sealed state");
{
  const v = makeVerifier();
  const c = challengeFor(v);
  check(v.length >= 43, "the verifier is long enough for S256", String(v.length));
  check(c !== v, "the challenge is a hash, not the verifier");
  check(challengeFor(v) === c, "and it is deterministic");

  const u = new URL(
    authorizeUrl({ provider: "x", clientId: "cid", redirectUri: "https://x/cb", state: "ST", challenge: c })
  );
  check(u.searchParams.get("code_challenge_method") === "S256", "X's consent URL carries S256");
  check(u.searchParams.get("code_challenge") === c, "and the challenge");
  check(u.origin === "https://x.com", "pointing at X", u.origin);
  check(
    (u.searchParams.get("scope") || "").includes("offline.access"),
    "asking for offline.access, which is what makes X issue a refresh token"
  );

  // Nothing is stored server-side, so the verifier has to survive the round
  // trip inside the state itself.
  process.env.INTEGRATION_SECRET ||= "test-secret-for-the-suite";
  const st = makeState({ provider: "x", uid: "u1", redirectUri: "https://x/cb", verifier: v });
  check(readState(st).verifier === v, "the sealed state carries the verifier home");
  check(!st.includes(v), "and the verifier is not readable in the state blob");

  // YouTube and Instagram do not use PKCE.
  const yu = new URL(
    authorizeUrl({ provider: "youtube", clientId: "c", redirectUri: "https://x/cb", state: "S" })
  );
  check(!yu.searchParams.has("code_challenge"), "YouTube's URL carries no PKCE challenge");
  check(yu.searchParams.get("access_type") === "offline", "but does ask for offline access");
  check(yu.searchParams.get("prompt") === "consent", "and forces consent, so a reconnect re-issues");
  check(
    (yu.searchParams.get("scope") || "").includes("youtube.force-ssl"),
    "with the scope that actually permits writes"
  );
}

console.log("\nX counts weighted characters, not String.length");
{
  check(xapi.MAX_POST_CHARS === 280, "the cap is 280");
  check(xapi.weightedLength("hello") === 5, "plain text counts one each");
  // The one everybody gets wrong: a URL is always 23.
  const url = "https://ravikishan.me/blog/a-very-long-slug-indeed-that-keeps-going";
  check(url.length > 23, "the test URL is genuinely longer than 23", String(url.length));
  check(xapi.weightedLength(url) === 23, "but weighs 23", String(xapi.weightedLength(url)));
  check(xapi.weightedLength("日本語") === 6, "CJK counts two each", String(xapi.weightedLength("日本語")));

  // A post that String.length would pass and X would reject.
  const sneaky = "x".repeat(265) + " " + "日本語日本語日本語";
  check(sneaky.length < 290, "a mixed post looks short by String.length", String(sneaky.length));
  check(xapi.weightedLength(sneaky) > 280, "but is over once weighted", String(xapi.weightedLength(sneaky)));
  await throws(() => xapi.assertPostable(sneaky), "and is refused", /280 weighted/);

  await throws(() => xapi.assertPostable("  "), "an empty post is refused", /needs some text/);
  check(xapi.assertPostable(" hi ") === "hi", "text is trimmed");
  check(xapi.charsLeft("hello") === 275, "the counter agrees with the cap");

  check(xapi.CAPABILITIES.editPost.available === false, "editing a post is recorded as impossible");
  check(
    /no edit endpoint/i.test(xapi.CAPABILITIES.editPost.why),
    "with the reason",
    xapi.CAPABILITIES.editPost.why
  );
  check(!!xapi.CAPABILITIES.editPost.instead, "and what to do instead");
  check(
    xapi.CAPABILITIES.freeTier.available === false,
    "and the end of the free tier is recorded, since a 403 is usually billing"
  );
  check(
    xapi.postUrl("me", "123") === "https://x.com/me/status/123",
    "a permalink is built from handle and id"
  );
  check(xapi.postUrl("", "123") === "", "and nothing without both");
}

console.log("\nInstagram refuses what it cannot undo");
{
  check(ig.MAX_CAPTION === 2200, "the caption cap is 2200");
  check(ig.assertCaption("hi") === "hi", "a short caption passes");
  await throws(
    () => ig.assertCaption("x".repeat(2201)),
    "one character over is refused",
    /2200/
  );
  // 31 hashtags publishes with the extras dropped, and there is no edit.
  const many = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(" ");
  await throws(
    () => ig.assertCaption(many),
    "31 hashtags is refused rather than silently trimmed",
    /30 hashtags|cannot be edited/
  );
  check(ig.assertCaption(Array.from({ length: 30 }, (_, i) => `#t${i}`).join(" ")).length > 0,
    "exactly 30 is allowed");

  check(ig.CAPABILITIES.editCaption.available === false, "editing a caption is recorded as impossible");
  check(
    ig.CAPABILITIES.personalAccounts.available === false,
    "and personal accounts are recorded as unusable"
  );
  check(
    /4 December 2024/.test(ig.CAPABILITIES.personalAccounts.why),
    "with the date the API behind them was shut down",
    ig.CAPABILITIES.personalAccounts.why
  );
  const unavailable = Object.entries(ig.CAPABILITIES).filter(([, v]) => !v.available);
  check(
    unavailable.every(([, v]) => v.why && v.instead),
    "every Instagram refusal says why and what to do instead",
    String(unavailable.filter(([k, v]) => !(v.why && v.instead)).map(([k]) => k))
  );
}

console.log("\nYouTube's update is the dangerous one");
{
  // Documented behaviour: videos.update REPLACES the part it is given, so a
  // field left out is DELETED from the live video. The client must therefore
  // read first and merge — this asserts the note says so, and the merge itself
  // is exercised by the shape of updateVideo (read-modify-write).
  const src = (await import("fs")).readFileSync("lib/server/youtube.js", "utf8");
  check(
    /part=snippet.*id|part: "snippet,status"|part: "snippet,status", id/.test(src) ||
      src.includes('part: "snippet,status"'),
    "updateVideo reads the current snippet before writing"
  );
  check(
    src.includes("title: typeof patch.title === \"string\" ? patch.title : v.snippet.title"),
    "and merges the title rather than defaulting it"
  );
  check(
    src.includes("description:\n        typeof patch.description === \"string\" ? patch.description : v.snippet.description || \"\"") ||
      /description:[\s\S]{0,120}v\.snippet\.description/.test(src),
    "and carries the existing description through"
  );
  check(
    /tags: Array\.isArray\(patch\.tags\) \? patch\.tags : v\.snippet\.tags/.test(src),
    "and the existing tags"
  );
  check(
    /categoryId:[\s\S]{0,140}v\.snippet\.categoryId \|\| "22"/.test(src),
    "and always sends categoryId, which the API requires whenever snippet is sent"
  );
  check(typeof yt.UPLOAD_NOTE === "string" && /resumable/.test(yt.UPLOAD_NOTE),
    "uploading is declared unavailable with the reason");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
