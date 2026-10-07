// Environment variable management, checked with no network and no credentials.
//
// The assertions that matter are the REFUSALS. Every variable lives in the
// database now, so the interesting question is not "does a write work" but
// "which writes are impossible, and from where": ENV_KEY never; keyring keys
// never over MCP, and from the admin only after a recent sign-in.
//
//   node scripts/env-check.mjs
process.env.ENV_KEY = process.env.ENV_KEY || "test-env-key-for-env-check-0123456789";

const {
  CLASSES,
  EnvError,
  KEY_RE,
  REGISTRY,
  assertKey,
  assertManageable,
  auditEnv,
  classify,
  isBootstrap,
  isKeyring,
  isPublic,
  known,
  maskValue,
  statusOf,
} = await import("../lib/server/envRegistry.js");
const { assertRuntime, resolve } = await import("../lib/server/runtimeConfig.js");
const store = await import("../lib/server/envStore.js");

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
    check(!re || re.test(e.message), name, re ? e.message.slice(0, 120) : "");
  }
};

console.log("\nENV_KEY: the one variable that stays outside");
{
  check(isBootstrap("ENV_KEY"), "ENV_KEY is the bootstrap key");
  check(REGISTRY.filter((e) => e.cls === "bootstrap").length === 1, "and it is the only one");
  throws(() => assertManageable("ENV_KEY"), "it cannot be changed from the app", /cannot be/);
  throws(() => store.assertWritable("ENV_KEY"), "the store refuses to hold it, saying why", /opens the store/);
  let status = 0;
  try {
    assertManageable("ENV_KEY");
  } catch (e) {
    status = e.status;
  }
  check(status === 403, "with a 403: you may not, not you typed it wrong", String(status));
}

console.log("\nclassification");
{
  check(classify("GITHUB_CLIENT_SECRET") === "stored", "an OAuth secret is stored in the database");
  check(classify("SOME_NEW_THING") === "stored", "so is a key nobody catalogued: add anything");
  check(classify("NEXT_PUBLIC_SOMETHING") === "stored", "and a NEXT_PUBLIC_ key, served to the browser at run time");
  check(classify("IG_ACCESS_TOKEN") === "stored", "and the public gallery's token");
  check(classify("NEXT_PUBLIC_MEDIUM_USER") === "runtime", "a setting is runtime");
  check(CLASSES.join(",") === "bootstrap,stored,runtime", "there are three classes", CLASSES.join(","));
  check(
    REGISTRY.every((e) => CLASSES.includes(e.cls)),
    "every catalogued variable has a known class",
    String(REGISTRY.filter((e) => !CLASSES.includes(e.cls)).map((e) => e.key))
  );
  check(!REGISTRY.some((e) => e.key.startsWith("VERCEL_")), "nothing in the catalogue is about Vercel any more");
  const keys = REGISTRY.map((e) => e.key);
  check(new Set(keys).size === keys.length, "no key is catalogued twice");
}

console.log("\nthe keyring: stored, but never changeable over MCP");
{
  const KEYRING = ["SECRETS_KEY", "MCP_TOKEN_SECRET", "INTEGRATION_SECRET", "B2_KEY_ID", "B2_APP_KEY", "B2_BUCKET", "B2_ENDPOINT", "B2_REGION", "B2_BUCKET_ID"];
  for (const k of KEYRING) check(isKeyring(k) && classify(k) === "stored", `${k} is a stored keyring key`);
  check(REGISTRY.filter((e) => e.keyring).every((e) => !!e.why), "every keyring key says what changing it breaks");
  for (const k of ["MCP_TOKEN_SECRET", "B2_ENDPOINT", "SECRETS_KEY"]) {
    throws(() => store.assertWritable(k, { via: "mcp" }), `MCP cannot change ${k}`, /admin's Environment tab/);
  }
  check(store.assertWritable("MCP_TOKEN_SECRET", { via: "admin" }) === "MCP_TOKEN_SECRET", "the admin can");
  check(store.assertWritable("LINKEDIN_CLIENT_SECRET", { via: "mcp" }) === "LINKEDIN_CLIENT_SECRET", "MCP can change an ordinary key");
  check(store.assertWritable("MY_NEW_API_KEY", { via: "mcp" }) === "MY_NEW_API_KEY", "and add a brand-new one");
}

console.log("\nkey names are a narrow alphabet");
{
  check(KEY_RE.test("GITHUB_CLIENT_ID"), "a normal name passes");
  check(assertKey("  X_CLIENT_ID  ") === "X_CLIENT_ID", "surrounding space is trimmed");
  throws(() => assertKey("github_client_id"), "lowercase is refused", /not a valid/);
  throws(() => assertKey("A B"), "a space is refused", /not a valid/);
  throws(() => assertKey("A;rm -rf /"), "and anything shell-shaped", /not a valid/);
  throws(() => assertKey("1ABC"), "a leading digit is refused", /not a valid/);
  throws(() => assertKey(""), "and nothing", /not a valid/);
}

console.log("\nvalues are masked, except the ones already public");
{
  check(isPublic("NEXT_PUBLIC_MEDIUM_USER"), "NEXT_PUBLIC_ is recognised as public");
  check(maskValue("NEXT_PUBLIC_MEDIUM_USER", "ravikishan") === "ravikishan", "and shown in full");
  check(maskValue("GITHUB_CLIENT_SECRET", "abcdefgh") === "••••efgh", "a secret shows the LAST four");
  check(!maskValue("GITHUB_CLIENT_SECRET", "sk-livesecret").includes("sk-"), "never the prefix");
  check(store.hintFor("LINKEDIN_CLIENT_SECRET", "WPL_AP1.secretvalue") === "••••alue", "the store's hint is last-four too");
  const row = statusOf("GITHUB_CLIENT_SECRET", "supersecretvalue");
  check(!("value" in row) && JSON.stringify(row).indexOf("supersecretvalue") === -1, "a status row carries no value");
  check(statusOf("ENV_KEY", "x").manageable === false, "ENV_KEY's row says it cannot be changed here");
  check(statusOf("MCP_TOKEN_SECRET", "x").keyring === true, "a keyring row says so");
}

console.log("\nthe audit");
{
  const audit = auditEnv({ MCP_TOKEN_SECRET: "x" });
  check(audit.rows.length === REGISTRY.length, "every catalogued variable is reported");
  check(audit.missingRequired.includes("B2_KEY_ID"), "a missing required key is named");
  check(!audit.missingRequired.includes("MCP_TOKEN_SECRET"), "a present one is not");
  check(!audit.missingRequired.includes("MS_TASKS_TENANT"), "an optional one is never 'missing'");
}

console.log("\nruntime settings");
{
  check(assertRuntime("NEXT_PUBLIC_MEDIUM_USER") === "NEXT_PUBLIC_MEDIUM_USER", "a runtime key is accepted");
  throws(() => assertRuntime("GITHUB_CLIENT_SECRET"), "a secret is refused by the plain settings store", /not a runtime setting|no effect/);
  check(resolve("NEXT_PUBLIC_MEDIUM_USER", { NEXT_PUBLIC_MEDIUM_USER: "stored" }) === "stored", "stored wins");
  check(resolve("NEXT_PUBLIC_MEDIUM_USER", { NEXT_PUBLIC_MEDIUM_USER: "" }) !== "", "an empty stored value falls through");
  check(known("NEXT_PUBLIC_MEDIUM_USER").default === "ravikishan63392", "the default is catalogued");
}

console.log("\nthe store is one sealed blob");
{
  const map = { LINKEDIN_CLIENT_SECRET: { v: "WPL_AP1.realsecret", hint: "••••cret" }, MY_KEY: { v: "k" } };
  const blob = store.seal(map);
  check(/^[A-Za-z0-9_-]+$/.test(blob), "it is base64url, nothing else");
  check(
    !["LINKEDIN", "CLIENT_SECRET", "WPL_AP1", "realsecret", "MY_KEY"].some((t) => blob.includes(t)),
    "neither the values nor even the key names are visible in it"
  );
  check(JSON.stringify(store.open(blob)) === JSON.stringify(map), "and it opens back to exactly what went in");
  check(store.seal(map) !== blob, "two seals of the same map differ (fresh IV each time)");

  const flipped = blob.slice(0, 40) + (blob[40] === "A" ? "B" : "A") + blob.slice(41);
  throws(() => store.open(flipped), "a single flipped character is refused", /could not be opened/);

  // A blob sealed under a DIFFERENT ENV_KEY, built the same way the store
  // builds one. The message must say why, because "the store is empty" after
  // a key change reads exactly like data loss.
  const crypto = await import("crypto");
  const otherKey = crypto.createHash("sha256").update("some-other-env-key").digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", otherKey, iv);
  c.setAAD(Buffer.from("env-store-v1"));
  const body = Buffer.concat([c.update(JSON.stringify(map), "utf8"), c.final()]);
  const foreign = Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
  throws(() => store.open(foreign), "a blob sealed under another ENV_KEY is refused", /ENV_KEY/);
  check(store.isConfigured(), "ENV_KEY present means the store is usable");
}

console.log("\nimporting a .env file");
{
  const { entries, skipped } = store.parseDotenv(
    [
      "# a comment",
      "",
      "LINKEDIN_CLIENT_ID=78ruvlse4ez8xv",
      'LINKEDIN_CLIENT_SECRET="WPL_AP1.abc=="',
      "export DEVTO_API_KEY='xyz'",
      "PLAIN=value # trailing comment",
      "lower_case=works",
      "this is not a line",
    ].join("\n")
  );
  const m = Object.fromEntries(entries);
  check(m.LINKEDIN_CLIENT_ID === "78ruvlse4ez8xv", "a plain line is read");
  check(m.LINKEDIN_CLIENT_SECRET === "WPL_AP1.abc==", "double quotes are stripped and = inside a value survives");
  check(m.DEVTO_API_KEY === "xyz", "export and single quotes are handled");
  check(m.PLAIN === "value", "a trailing comment is not part of the value");
  check(m.LOWER_CASE === "works", "a lowercase name is upper-cased rather than lost");
  check(skipped.length === 1 && skipped[0].startsWith("this is not"), "a line that is not KEY=value is reported, not guessed");
}

console.log("\nthe overlay");
{
  store._reset();
  process.env.LINKEDIN_CLIENT_ID = "from-deployment";
  delete process.env.MY_NEW_API_KEY;
  store.applyOverlay({ LINKEDIN_CLIENT_ID: "from-db", MY_NEW_API_KEY: "k1" });
  check(process.env.LINKEDIN_CLIENT_ID === "from-db", "a stored value wins over the deployment's");
  check(store.sourceOf("LINKEDIN_CLIENT_ID") === "database", "and says it came from the database");
  check(process.env.MY_NEW_API_KEY === "k1", "a custom key appears in process.env");
  store.applyOverlay({ MY_NEW_API_KEY: "k1" });
  check(process.env.LINKEDIN_CLIENT_ID === "from-deployment", "a key deleted from the store gets the deployment value back");
  check(store.sourceOf("LINKEDIN_CLIENT_ID") === "deployment", "and is reported as the deployment's again");
  store.applyOverlay({});
  check(process.env.MY_NEW_API_KEY === undefined, "a custom key gone from the store is unset, not left behind");
  const key = process.env.ENV_KEY;
  store.applyOverlay({ ENV_KEY: "swapped" });
  check(process.env.ENV_KEY === key, "a blob that somehow holds ENV_KEY cannot swap it out");
  store._reset();
  check(process.env.LINKEDIN_CLIENT_ID === "from-deployment", "reset restores every deployment value");
  check(typeof store.withEnv(async () => 1) === "function", "withEnv wraps a route handler");
  const pub = (() => {
    process.env.NEXT_PUBLIC_TEST_X = "shown";
    process.env.PRIVATE_TEST_Y = "hidden";
    const v = store.publicValues();
    delete process.env.NEXT_PUBLIC_TEST_X;
    delete process.env.PRIVATE_TEST_Y;
    return v;
  })();
  check(pub.NEXT_PUBLIC_TEST_X === "shown" && !("PRIVATE_TEST_Y" in pub), "the browser is given NEXT_PUBLIC_ keys and nothing else");
}

console.log("\nerrors are typed");
check(new EnvError("x") instanceof Error, "EnvError is an Error");
check(new EnvError("x", { status: 403 }).status === 403, "and carries the status");

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
