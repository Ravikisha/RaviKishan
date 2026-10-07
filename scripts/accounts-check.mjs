// The authentication centre — checked with no network and no credentials.
//
// The assertion that matters here is not "does it find an account". It is
// "does it ever act as the WRONG one", because that is the failure with a
// consequence: a post published by the wrong handle cannot be quietly undone,
// and nothing downstream can tell it was a mistake.
//
// So most of this file is about the refusals. Guessing between two accounts is
// the bug; refusing and saying which two is the feature.
//
//   node scripts/accounts-check.mjs

// Sealing needs a key and this suite needs no real one: the assertion is that
// the plaintext does not survive into the record, which any key proves.
process.env.SECRETS_KEY ||= "test-key-for-the-accounts-suite";

const {
  SERVICES,
  accountShape,
  chooseAccount,
  missingScopes,
  poolFor,
  servicesFor,
  shortScope,
} = await import("../lib/server/accountDirectory.js");
const { PROVIDERS } = await import("../lib/server/integrations.js");
const { loginSecretName, buildRecord, publicShape } = await import("../lib/server/secretStore.js");

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
    check(!re || re.test(e.message), name, re ? e.message.slice(0, 140) : "");
  }
};

const acct = (provider, accountId, extra = {}) =>
  accountShape({ provider, accountId, label: accountId, ...extra });

/* ------------------------------------------------------------------ */

console.log("\nthe catalogue");
check(Object.keys(SERVICES).length >= 8, "every job is listed", String(Object.keys(SERVICES).length));
for (const [id, s] of Object.entries(SERVICES)) {
  check(s.id === id, `${id} is keyed by its own id`);
  check(
    s.providers.length > 0 && s.providers.every((p) => PROVIDERS[p]),
    `${id} names only real providers`,
    s.providers.join(", ")
  );
}
// Every provider must be reachable through at least one job, or it is an
// account you can connect and then never use.
for (const id of Object.keys(PROVIDERS)) {
  check(servicesFor(id).length > 0, `${id} is wired to a job`);
}

console.log("\nan unknown job is refused by name, with the list");
throws(() => poolFor({ service: "tweeting" }), "an unknown service throws", /Unknown service/);
throws(() => poolFor({ service: "tweeting" }), "and names the real ones", /tasks/);

/* ------------------------------------------------------------------ */

console.log("\nchoosing: explicit beats default beats the only one");
{
  const two = [acct("instagram", "111", { label: "@studio" }), acct("instagram", "222", { label: "@personal" })];

  const explicit = chooseAccount(two, { service: "photos", accountId: "222" });
  check(explicit.accountId === "222" && explicit.chosenBy === "explicit", "naming one wins");

  const byDefault = chooseAccount(two, {
    service: "photos",
    defaults: { photos: "instagram__111" },
  });
  check(byDefault.accountId === "111" && byDefault.chosenBy === "default", "a default decides");

  // Explicit must beat the default, or naming an account would be advisory.
  const both = chooseAccount(two, {
    service: "photos",
    accountId: "222",
    defaults: { photos: "instagram__111" },
  });
  check(both.accountId === "222", "and an explicit account overrides the default");

  const sole = chooseAccount([two[0]], { service: "photos" });
  check(sole.chosenBy === "only", "one connected account needs no default");
}

console.log("\nand refuses rather than guessing");
{
  const two = [acct("instagram", "111"), acct("instagram", "222")];
  throws(
    () => chooseAccount(two, { service: "photos" }),
    "two accounts and no default is refused",
    /name one/
  );
  throws(
    () => chooseAccount(two, { service: "photos" }),
    "and the refusal lists both so it can be acted on",
    /111[\s\S]*222/
  );
  throws(
    () => chooseAccount([], { service: "photos" }),
    "nothing connected says so",
    /No account is connected/
  );
  throws(
    () => chooseAccount(two, { service: "photos", accountId: "333" }),
    "an account that is not connected is named",
    /No connected account "333"/
  );
  // The dangerous one: a default left pointing at a disconnected account must
  // NOT fall through to "the only one there is", because that acts as somebody
  // the setting never named.
  throws(
    () => chooseAccount([acct("instagram", "999")], {
      service: "photos",
      defaults: { photos: "instagram__111" },
    }),
    "a stale default is reported, never silently replaced",
    /not connected any more/
  );
}

console.log("\nthe pool is the job's providers, not everything connected");
{
  const mixed = [acct("instagram", "111"), acct("x", "222"), acct("youtube", "333")];
  check(chooseAccount(mixed, { service: "photos" }).provider === "instagram", "photos picks Instagram");
  check(chooseAccount(mixed, { service: "posts" }).provider === "x", "posts picks X");
  check(chooseAccount(mixed, { service: "video" }).provider === "youtube", "video picks YouTube");
  // Tasks accepts two providers, so two accounts across them are still
  // ambiguous — the ambiguity is about the JOB, not about one provider.
  const tasks = [acct("google", "a@x.com"), acct("microsoft", "b@x.com")];
  throws(
    () => chooseAccount(tasks, { service: "tasks" }),
    "a job served by two providers is ambiguous across them",
    /name one/
  );
}

console.log("\nkeys round-trip");
{
  const a = acct("github", "Ravikisha");
  check(a.key === "github__Ravikisha", "a key is provider__accountId", a.key);
  check(
    chooseAccount([a], { service: "code", defaults: { code: a.key } }).chosenBy === "default",
    "and a default matches on it"
  );
  // An id with the separator inside it must still resolve to itself rather
  // than to a prefix of another account.
  const odd = acct("notion", "ws__42");
  check(
    chooseAccount([odd], { provider: "notion", accountId: "ws__42" }).accountId === "ws__42",
    "an account id containing __ still resolves"
  );
}

console.log("\nexpiry is computed, not stored");
{
  const soon = acct("linkedin", "sub1", {
    kind: "access",
    expiresAt: new Date(Date.now() + 6 * 86400000).toISOString(),
  });
  check(soon.expiresInDays === 5 || soon.expiresInDays === 6, "an access token counts down", String(soon.expiresInDays));
  const refresh = acct("google", "sub2", { kind: "refresh" });
  check(refresh.expiresInDays === null, "a refresh token has no countdown");
  const dead = acct("linkedin", "sub3", {
    kind: "access",
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
  });
  check(dead.expiresInDays < 0, "and an expired one is negative, not zero", String(dead.expiresInDays));
}

console.log("\nmissing permissions are reported, not discovered at 403");
{
  const yt = PROVIDERS.youtube.scopes.filter((s) => s !== "openid" && s !== "email");
  const full = acct("youtube", "UC1", { scope: PROVIDERS.youtube.scopes.join(" ") });
  check(missingScopes(full).length === 0, "a current connection is missing nothing");

  // The real case: a channel connected before yt-analytics.readonly existed.
  const old = acct("youtube", "UC2", {
    scope: "https://www.googleapis.com/auth/youtube.force-ssl openid email",
  });
  const gone = missingScopes(old);
  check(gone.length === yt.length - 1, "an older connection names what it lacks", gone.join(", "));
  check(
    gone.map(shortScope).includes("yt-analytics.readonly"),
    "including the analytics permission, in a form a person can read",
    gone.map(shortScope).join(", ")
  );

  // A connection that recorded no scope at all must stay SILENT rather than
  // claim everything is missing — that would flag every older account.
  check(missingScopes(acct("youtube", "UC3")).length === 0, "and an unrecorded scope says nothing");
}

/* ------------------------------------------------------------------ */

console.log("\na saved sign-in belongs to exactly one account");
{
  const n = loginSecretName("instagram", "17841400000000000");
  check(n === "login-instagram-17841400000000000", "the name is derived from the pair", n);
  check(
    loginSecretName("google", "a@b.com") !== loginSecretName("google", "c@d.com"),
    "two accounts of one provider cannot collide"
  );
  const { record } = buildRecord({
    name: n,
    value: "hunter2",
    username: "studio@example.com",
    kind: "password",
    provider: "instagram",
    accountId: "17841400000000000",
  });
  check(record.provider === "instagram" && record.accountId === "17841400000000000", "the record carries the pair");
  check(record.agentReadable === false, "and is unreadable by an agent until that is turned on");
  check(!JSON.stringify(record).includes("hunter2"), "the password is nowhere in the stored record");
  const row = publicShape(n, record);
  check(!("value" in row), "and a listing row has no value field at all");
  check(row.provider === "instagram", "but does say which account it is for");
}

console.log("\nthe ML lab is a job");
check(SERVICES.ml?.providers.join() === "huggingface,kaggle", "ml is done by Hugging Face and Kaggle");
check(servicesFor("huggingface").some((s) => s.id === "ml"), "huggingface is wired to ml");
{
  const two = [acct("huggingface", "alice"), acct("huggingface", "bob")];
  throws(() => chooseAccount(two, { service: "ml", provider: "huggingface" }), "two HF accounts and no default refuses", /alice|bob/);
  const one = chooseAccount([acct("kaggle", "ravi")], { service: "ml", provider: "kaggle" });
  check(one.accountId === "ravi" && one.chosenBy === "only", "the only Kaggle account is chosen, and says why");
}

console.log("\nan exportable token says so, and only a real true does");
check(accountShape({ provider: "kaggle", accountId: "r", agentReadable: true }).agentReadable === true, "agentReadable:true survives into the row");
check(accountShape({ provider: "kaggle", accountId: "r", agentReadable: "true" }).agentReadable === false, "a truthy string is not true");
check(accountShape({ provider: "kaggle", accountId: "r" }).agentReadable === false, "absent reads false");

console.log("\nthe legacy token path returns the token, not undefined");
{
  const src = (await import("node:fs")).readFileSync(new URL("../lib/server/accountDirectory.js", import.meta.url), "utf8");
  check(!/const \{ token \} = await accessTokenFor/.test(src), "tokenFor does not destructure the string accessTokenFor returns");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
