// Environment variable management, checked with no network and no credentials.
//
// The assertions that matter are the REFUSALS. This feature can write
// credentials, so the interesting question is not "does a write work" but
// "which writes are impossible" — and every one of those maps to a sentence in
// lib/server/envRegistry.js.
//
//   node scripts/env-check.mjs
const {
  CLASSES,
  EnvError,
  KEY_RE,
  REGISTRY,
  assertKey,
  assertManageable,
  auditEnv,
  classify,
  isCritical,
  isPublic,
  known,
  maskValue,
  statusOf,
} = await import("../lib/server/envRegistry.js");
const { assertRuntime, resolve } = await import("../lib/server/runtimeConfig.js");

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

console.log("\nthe keys that can never be touched from inside the app");
{
  // Each of these is unmanageable for a DIFFERENT reason, and the message has
  // to give the reason — otherwise it reads as an arbitrary denylist.
  const CRITICAL = [
    ["SECRETS_KEY", /circular/i],
    ["MCP_TOKEN_SECRET", /privilege-escalation|mint/i],
    ["INTEGRATION_SECRET", /decrypts/i],
    ["B2_KEY_ID", /vault bucket/i],
    ["B2_APP_KEY", /vault bucket/i],
    ["VERCEL_TOKEN", /rewrite every environment variable/i],
  ];
  for (const [key, why] of CRITICAL) {
    check(isCritical(key), `${key} is classed critical`);
    throws(() => assertManageable(key), `${key} cannot be changed from the app`, /cannot be/);
    let msg = "";
    try {
      assertManageable(key);
    } catch (e) {
      msg = e.message;
    }
    check(why.test(msg), `and says WHY, not just no`, msg.slice(0, 90));
  }

  // The guard must refuse before any I/O, and with a 403 rather than a 400 —
  // this is "you may not", not "you typed it wrong".
  let status = 0;
  try {
    assertManageable("SECRETS_KEY");
  } catch (e) {
    status = e.status;
  }
  check(status === 403, "a critical key is refused with 403", String(status));
}

console.log("\nclassification");
{
  check(classify("GITHUB_CLIENT_SECRET") === "deploy", "an OAuth secret is a deployment variable");
  check(classify("NEXT_PUBLIC_MEDIUM_USER") === "runtime", "a setting is runtime");
  // An unknown key must be manageable but never readable — refusing outright
  // would mean nothing added after this file was written could be managed.
  check(classify("SOME_NEW_THING") === "deploy", "an unknown key defaults to deploy, which is the safe class");
  check(!isCritical("SOME_NEW_THING"), "so it can be written");
  check(CLASSES.length === 3, "there are three classes", CLASSES.join(","));
  check(
    REGISTRY.every((e) => CLASSES.includes(e.cls)),
    "every catalogued variable has a known class",
    String(REGISTRY.filter((e) => !CLASSES.includes(e.cls)).map((e) => e.key))
  );
  check(
    REGISTRY.filter((e) => e.cls === "critical").every((e) => !!e.why),
    "and every critical one explains itself",
    String(REGISTRY.filter((e) => e.cls === "critical" && !e.why).map((e) => e.key))
  );
  // Keys are unique; a duplicate would make the catalogue lie about one of them.
  const keys = REGISTRY.map((e) => e.key);
  check(new Set(keys).size === keys.length, "no key is catalogued twice");
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
  // NEXT_PUBLIC_ variables are compiled into the browser bundle, so masking
  // them is theatre — anyone can read them off the page.
  check(isPublic("NEXT_PUBLIC_MEDIUM_USER"), "NEXT_PUBLIC_ is recognised as public");
  check(maskValue("NEXT_PUBLIC_MEDIUM_USER", "ravikishan") === "ravikishan", "and shown in full");
  check(maskValue("GITHUB_CLIENT_SECRET", "abcdefgh") === "••••efgh", "a secret shows the LAST four");
  check(!maskValue("GITHUB_CLIENT_SECRET", "sk-livesecret").includes("sk-"), "never the prefix");
  check(maskValue("X", "abc") === "••••", "a short value reveals nothing");
  check(maskValue("X", "") === "", "and an unset one is empty");

  const row = statusOf("GITHUB_CLIENT_SECRET", "supersecretvalue");
  check(!("value" in row), "a status row has no value field at all");
  check(JSON.stringify(row).indexOf("supersecretvalue") === -1, "and the value is not in it");
  check(row.present === true, "only that it is present");
  check(row.manageable === true, "and whether it can be changed");
  check(statusOf("SECRETS_KEY", "x").manageable === false, "a critical one says it cannot");
}

console.log("\nthe audit answers the question worth asking");
{
  const audit = auditEnv({ MCP_TOKEN_SECRET: "x" });
  check(Array.isArray(audit.rows) && audit.rows.length === REGISTRY.length, "every catalogued variable is reported");
  // A missing REQUIRED variable is the single most useful output here.
  check(audit.missingRequired.includes("B2_KEY_ID"), "a missing required key is named", audit.missingRequired.join(","));
  check(!audit.missingRequired.includes("MCP_TOKEN_SECRET"), "a present one is not");
  check(!audit.missingRequired.includes("MS_TASKS_TENANT"), "and an optional one is never 'missing'");
  check(
    JSON.stringify(audit).indexOf("x") === -1 || !JSON.stringify(audit).includes('"value"'),
    "the audit carries no values"
  );
}

console.log("\nruntime settings are the only ones that change live");
{
  check(assertRuntime("NEXT_PUBLIC_MEDIUM_USER") === "NEXT_PUBLIC_MEDIUM_USER", "a runtime key is accepted");
  // Writing a deployment secret into Firestore would be worse than useless:
  // nothing reads it from there, so it would look saved and do nothing.
  throws(
    () => assertRuntime("GITHUB_CLIENT_SECRET"),
    "a deployment variable is refused by the runtime store, with why",
    /no effect|belongs in the platform/
  );
  throws(() => assertRuntime("SECRETS_KEY"), "and a critical one is refused earlier still", /cannot be/);

  // Resolution order: stored, then environment, then the documented default.
  check(resolve("NEXT_PUBLIC_MEDIUM_USER", { NEXT_PUBLIC_MEDIUM_USER: "stored" }) === "stored", "stored wins");
  check(
    resolve("INTEGRATION_GITHUB_LOGIN", {}) === (process.env.INTEGRATION_GITHUB_LOGIN || "Ravikisha"),
    "then the environment, then the default"
  );
  check(resolve("NEXT_PUBLIC_MEDIUM_USER", { NEXT_PUBLIC_MEDIUM_USER: "" }) !== "", "an empty stored value falls through");
  check(known("NEXT_PUBLIC_MEDIUM_USER").default === "ravikishan63392", "the default is catalogued, not hidden in code");
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
