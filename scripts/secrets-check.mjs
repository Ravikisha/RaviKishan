// The secret store, checked with no network and no credentials.
//
// This is the most security-sensitive file in the repo, so the assertions are
// about the properties the design CLAIMS rather than about whether the code
// runs. Each one maps to a sentence in the comment at the top of
// lib/server/secretStore.js, and if the sentence stops being true the test
// fails.
//
//   node scripts/secrets-check.mjs
process.env.SECRETS_KEY ||= "test-key-for-the-secrets-suite";

const {
  KINDS,
  SecretError,
  assertName,
  buildRecord,
  hintFor,
  matches,
  openValue,
  publicShape,
  readValue,
  redact,
  sealValue,
  slugify,
} = await import("../lib/server/secretStore.js");

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
    check(!re || re.test(e.message), name, re ? e.message.slice(0, 110) : "");
  }
};

const SECRET = "hunter2-correct-horse-battery-staple";

console.log("\nvalues are sealed, and the plaintext is nowhere in the blob");
{
  const blob = sealValue(SECRET);
  check(typeof blob === "string" && blob.length > 40, "a value seals to an opaque blob");
  check(!blob.includes(SECRET), "the plaintext is not in it");
  check(!blob.includes("hunter2"), "nor any recognisable part of it");
  check(openValue(blob) === SECRET, "it round-trips exactly");
  check(sealValue(SECRET) !== sealValue(SECRET), "the same value seals differently every time");

  // Tampering must fail closed, not return garbage that a caller might send
  // somewhere as if it were a password.
  const flipped = (() => {
    const b = Buffer.from(blob, "base64url");
    b[b.length - 1] ^= 1;
    return b.toString("base64url");
  })();
  throws(() => openValue(flipped), "one flipped byte is refused", /could not be opened/);
  throws(() => openValue("not-a-blob"), "so is something that is not a blob", /unreadable|could not be opened/);
  throws(() => openValue(""), "and nothing", /unreadable/);

  // A rotated key must make values unreadable rather than silently wrong, and
  // the message has to say what happened — otherwise it reads as data loss.
  const other = (() => {
    const was = process.env.SECRETS_KEY;
    process.env.SECRETS_KEY = "a-different-key";
    try {
      return sealValue("intruder");
    } finally {
      process.env.SECRETS_KEY = was;
    }
  })();
  throws(
    () => openValue(other),
    "a blob sealed under another key is refused, and says SECRETS_KEY rotation did it",
    /SECRETS_KEY was rotated/
  );

  throws(() => sealValue(""), "an empty value is refused", /needs a value/);
}

console.log("\nagent access is opt-in, per secret");
{
  // The claim: "saving a password does not expose it to anything".
  const { record } = buildRecord({ name: "AWS prod", value: SECRET });
  check(record.agentReadable === false, "a new secret is NOT agent-readable by default");

  const on = buildRecord({ name: "x", value: "v", agentReadable: true }).record;
  check(on.agentReadable === true, "and it can be turned on deliberately");
  // Truthiness is not enough here — a stray "false" string must not enable it.
  check(
    buildRecord({ name: "x", value: "v", agentReadable: "yes" }).record.agentReadable === false,
    "only a real boolean true enables it, not any truthy value"
  );

  throws(
    () => readValue({ value: sealValue("v"), agentReadable: false }, { forAgent: true, name: "aws" }),
    "an agent is refused a secret that is not marked readable",
    /not marked readable by an agent/
  );
  check(
    readValue({ value: sealValue("v"), agentReadable: false }, { forAgent: false, name: "aws" }) === "v",
    "while the owner in the admin can still read it"
  );
  check(
    readValue({ value: sealValue("v"), agentReadable: true }, { forAgent: true, name: "aws" }) === "v",
    "and an agent can read one that is marked"
  );
  throws(
    () => readValue(null, { forAgent: true, name: "ghost" }),
    "a missing secret is refused by name",
    /No secret named "ghost"/
  );
  throws(
    () => readValue({ agentReadable: true }, { forAgent: true, name: "empty" }),
    "and one with no value stored says so",
    /has no value stored/
  );
}

console.log("\na listing can never carry a value");
{
  // The claim: "listing returns names and metadata, never values".
  const row = publicShape("aws-prod", {
    name: "AWS prod",
    value: sealValue(SECRET),
    hint: hintFor(SECRET),
    agentReadable: true,
    username: "root",
    kind: "apiKey",
  });
  check(!("value" in row), "there is no value field on a listing row at all");
  check(JSON.stringify(row).indexOf(SECRET) === -1, "and the plaintext is not in it");
  check(!JSON.stringify(row).includes(sealValue(SECRET).slice(0, 20)), "nor the ciphertext");
  check(row.hasValue === true, "only whether a value exists");
  check(row.agentReadable === true, "and whether an agent may read it");

  // The hint exists so two keys can be told apart without revealing either.
  check(hintFor(SECRET).startsWith("••••"), "a hint is masked");
  check(hintFor("abcdefgh") === "••••efgh", "showing the LAST four", hintFor("abcdefgh"));
  // Never the first: the start of an API key is often a fixed, guessable
  // prefix (sk-, ghp_, AKIA) that gives away the service and nothing useful.
  check(!hintFor("sk-livesecret").includes("sk-"), "never the first, which is a guessable prefix");
  check(hintFor("abc") === "••••", "a short value reveals nothing at all");
  check(redact("sk-abcdef1234") === "••••1234", "redaction for logs matches");
}

console.log("\nnames are addressable and cannot collide or escape");
{
  check(slugify("AWS prod") === "aws-prod", "a name slugs predictably");
  check(slugify("AWS  //  prod!!") === "aws-prod", "punctuation collapses");
  // A slash would split the Firestore document path.
  check(!slugify("a/b/c").includes("/"), "a slash cannot survive into a document id", slugify("a/b/c"));
  check(assertName("Stripe Live Key") === "stripe-live-key", "assertName returns the id");
  throws(() => assertName("!!!"), "a name with nothing addressable is refused", /letters or digits/);
  throws(() => assertName(""), "and an empty one", /letters or digits/);
  check(slugify("x".repeat(200)).length <= 64, "a very long name is bounded");
  throws(() => buildRecord({ name: "x", value: "v", kind: "wat" }), "an unknown kind is refused", /Unknown kind/);
  check(KINDS.includes("password") && KINDS.includes("apiKey"), "the kinds cover what is stored");
}

console.log("\nsearch matches metadata, never the value");
{
  const row = publicShape("stripe", {
    name: "Stripe live",
    username: "acct_123",
    url: "https://dashboard.stripe.com",
    tags: ["billing"],
    kind: "apiKey",
    value: sealValue("sk-live-SECRETVALUE"),
  });
  check(matches(row, "stripe"), "matches a name");
  check(matches(row, "billing"), "matches a tag");
  check(matches(row, "acct_123"), "matches a username");
  check(matches(row, ""), "an empty query matches everything");
  // Searching the value would mean decrypting the whole store to answer a
  // query, and would let a query confirm a guess about a password.
  check(!matches(row, "SECRETVALUE"), "and NEVER matches the secret value itself");
}

console.log("\nerrors are typed and carry a status");
check(new SecretError("x") instanceof Error, "SecretError is an Error");
check(new SecretError("x", { status: 403 }).status === 403, "and carries the status");
check(new SecretError("x").status === 400, "defaulting to 400");

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
