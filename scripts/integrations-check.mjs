// Connected accounts, checked without a network or a browser.
//
// Everything here is a thing that fails SILENTLY in production if it is wrong:
// a consent URL missing access_type=offline returns no refresh token and the
// connection quietly lasts an hour; a sealed blob that can be opened under the
// wrong purpose turns an OAuth state into a credential; a date converted
// without pinning the zone moves a task to the previous day for half the world.
//
//   node scripts/integrations-check.mjs
process.env.INTEGRATION_SECRET ||= "test-secret-for-the-suite";
process.env.GOOGLE_TASKS_CLIENT_ID ||= "test-google-client";
process.env.GOOGLE_TASKS_CLIENT_SECRET ||= "test-google-secret";

const {
  PROVIDERS,
  PINNED_EMAIL,
  providerIds,
  getProvider,
  providerConfig,
  seal,
  unseal,
  makeState,
  readState,
  authorizeUrl,
  redirectUriFor,
  docPathFor,
  connectionRecord,
} = await import("../lib/server/integrations.js");

const {
  toGraphDue,
  fromGraphDue,
  isStepId,
  makeStepId,
  readStepId,
} = await import("../lib/server/msTodo.js");

const { adapterFor, taskProviderIds, DEFAULT_PROVIDER } = await import("../lib/server/taskBoard.js");

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
    check(!re || re.test(e.message), name, re ? e.message : "");
  }
};

console.log("\nproviders");
// Assert the SET, not just the count: a provider silently renamed or dropped
// is the failure that matters, and a count passes right through it.
check(
  providerIds().join(",") === "google,microsoft,github,youtube,instagram,x,analytics,notion,linkedin,huggingface,kaggle",
  "all eleven providers are registered, in order",
  providerIds().join(", ")
);
// EVERY provider is multi-account. The four-and-five split was real while
// there was one Google account and one GitHub; the moment the point became
// holding several of each, a provider that is not multi is one whose second
// connection silently overwrites its first.
check(
  providerIds().every((id) => PROVIDERS[id].multi === true),
  "and every one of them allows several accounts",
  providerIds().filter((id) => PROVIDERS[id].multi).join(", ")
);
check(
  ["google", "microsoft", "github"].every((id) => providerIds().includes(id)),
  "google, microsoft and github",
  providerIds().join(", ")
);
console.log("\nAPI-key providers");
{
  const { providerConfig } = await import("../lib/server/integrations.js");
  for (const id of ["huggingface", "kaggle"]) {
    check(PROVIDERS[id].auth === "apiKey", `${id} connects by pasted token`);
    check(PROVIDERS[id].env === null, `${id} needs no client credentials`);
    const saved = process.env.INTEGRATION_SECRET;
    process.env.INTEGRATION_SECRET = "x".repeat(32);
    check(providerConfig(id).configured === true, `${id} is configured once sealing is`);
    delete process.env.INTEGRATION_SECRET;
    const off = providerConfig(id);
    check(!off.configured && off.missing.join() === "INTEGRATION_SECRET", `${id} names only INTEGRATION_SECRET as missing`, off.missing.join());
    if (saved) process.env.INTEGRATION_SECRET = saved;
  }
  check(
    providerIds().filter((id) => PROVIDERS[id].auth !== "apiKey").every((id) => PROVIDERS[id].env),
    "every OAuth provider still declares its client env"
  );
}
check(getProvider("GOOGLE").id === "google", "a provider id is case-insensitive");
throws(() => getProvider("dropbox"), "an unknown provider is refused by name", /Unknown provider/);
check(
  PINNED_EMAIL === "ravikishan63392@gmail.com",
  "the account is pinned to the admin address",
  PINNED_EMAIL
);

console.log("\nconfiguration reports what is missing, not just that it failed");
const g = providerConfig("google");
check(g.configured, "a fully configured provider is usable");
const m = providerConfig("microsoft");
check(!m.configured, "a provider with no client credentials is not usable");
check(
  m.missing.includes("MS_TASKS_CLIENT_ID") && m.missing.includes("MS_TASKS_CLIENT_SECRET"),
  "and it names both halves it is missing",
  m.missing.join(", ")
);

// Google issues ONE OAuth client that can serve several of its APIs, so a
// provider backed by Google reuses the client already configured here rather
// than demanding a second one that would be a copy of the first. The fallback
// is reported as `borrowed`, because a variable that works without being set
// is otherwise indistinguishable from a bug.
console.log("\na Google-backed provider borrows the Google client");
{
  const ID = "ANALYTICS_CLIENT_ID";
  const SECRET = "ANALYTICS_CLIENT_SECRET";
  const keep = [process.env[ID], process.env[SECRET]];
  delete process.env[ID];
  delete process.env[SECRET];
  try {
    const a = providerConfig("analytics");
    check(a.configured, "analytics is usable with no analytics client of its own");
    check(
      a.borrowed === "GOOGLE_TASKS_CLIENT_ID",
      "and says which client it borrowed",
      a.borrowed || "(none)"
    );
    check(a.clientId === providerConfig("google").clientId, "which really is the Google one");
    check(providerConfig("youtube").borrowed === "GOOGLE_TASKS_CLIENT_ID", "youtube borrows it too");

    // Its own credentials still win, or setting them would do nothing.
    process.env[ID] = "own-id";
    process.env[SECRET] = "own-secret";
    const own = providerConfig("analytics");
    check(own.clientId === "own-id", "its own client id takes precedence");
    check(own.borrowed === "", "and nothing is reported as borrowed then");

    // Half a pair is not a configuration. Borrowing fills the gap rather than
    // leaving a provider with an id and no secret, which fails at the token
    // exchange - long after the consent screen said it worked.
    delete process.env[SECRET];
    const half = providerConfig("analytics");
    check(half.configured, "an id with no secret still borrows the missing half");
    check(half.clientSecret === providerConfig("google").clientSecret, "from Google");
  } finally {
    for (const [k, v] of [[ID, keep[0]], [SECRET, keep[1]]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// A provider that borrows nothing must still report honestly.
check(providerConfig("x").borrowed === "", "a provider that borrows nothing reports no borrow");

console.log("\nsealing");
const sealed = seal({ refreshToken: "1//abc.refresh" }, "refresh");
check(typeof sealed === "string" && sealed.length > 40, "a refresh token seals to an opaque blob");
check(!sealed.includes("refresh"), "and the plaintext is nowhere in it");
check(unseal(sealed, "refresh").refreshToken === "1//abc.refresh", "it round-trips");
check(seal({ a: 1 }, "refresh") !== seal({ a: 1 }, "refresh"), "the same value seals differently each time");

// The purpose is bound as additional authenticated data, so the two kinds of
// blob this file makes can never be swapped for one another.
throws(
  () => unseal(sealed, "state"),
  "a sealed refresh token cannot be opened as an OAuth state",
  /could not be opened/
);

const flipped = (() => {
  const b = Buffer.from(sealed, "base64url");
  b[b.length - 1] ^= 1;
  return b.toString("base64url");
})();
throws(() => unseal(flipped, "refresh"), "one flipped byte is refused", /could not be opened/);
throws(() => unseal("not-a-blob", "refresh"), "so is a blob that is not one", /unreadable|could not be opened/);

const otherKey = (() => {
  const was = process.env.INTEGRATION_SECRET;
  process.env.INTEGRATION_SECRET = "a-different-secret";
  try {
    return seal({ refreshToken: "intruder" }, "refresh");
  } finally {
    process.env.INTEGRATION_SECRET = was;
  }
})();
throws(
  () => unseal(otherKey, "refresh"),
  "a blob sealed under another key is refused",
  /could not be opened/
);

console.log("\nthe consent round trip");
const state = makeState({ provider: "google", uid: "u1", redirectUri: "https://x/cb" });
check(readState(state).uid === "u1", "a state round-trips the admin uid");
throws(() => readState(sealed), "a refresh blob is not a usable state", /could not be opened/);

const expired = (() => {
  // Reach past makeState to build one that is already stale.
  return seal({ provider: "google", uid: "u1", exp: Date.now() - 1000 }, "state");
})();
throws(() => readState(expired), "an expired state is refused", /expired/);

const url = new URL(
  authorizeUrl({
    provider: "google",
    clientId: "cid",
    redirectUri: "https://ravikishan.me/api/integrations/google/callback",
    state: "ST",
  })
);
check(url.origin === "https://accounts.google.com", "the consent URL points at Google", url.origin);
// No login_hint any more, and that is the change: a pinned address is what
// made a second Google account impossible to connect. The chooser is the
// feature; the account is confirmed afterwards from the id token instead.
check(!url.searchParams.get("login_hint"), "it lets you choose which Google account");
// Without these two Google returns an access token and no refresh token, and
// the connection silently becomes an hour long.
check(url.searchParams.get("access_type") === "offline", "it asks for offline access");
check(url.searchParams.get("prompt") === "consent", "and forces consent, so a reconnect re-issues the refresh token");
check(
  url.searchParams.get("scope").includes("auth/tasks"),
  "it asks for the Tasks scope",
  url.searchParams.get("scope")
);
check(url.searchParams.get("state") === "ST", "it carries the sealed state");

const msUrl = new URL(
  authorizeUrl({ provider: "microsoft", clientId: "cid", redirectUri: "https://x/cb", state: "ST" })
);
check(msUrl.origin === "https://login.microsoftonline.com", "Microsoft gets its own endpoint");
check(
  msUrl.searchParams.get("scope").includes("offline_access"),
  "and offline_access, which is Microsoft's name for a refresh token",
  msUrl.searchParams.get("scope")
);
check(
  msUrl.searchParams.get("scope").includes("Tasks.ReadWrite"),
  "plus the To Do scope"
);

console.log("\nredirect URIs are derived, not guessed");
const local = redirectUriFor({ headers: { host: "localhost:3000" } }, "google");
check(local === "http://localhost:3000/api/integrations/google/callback", "localhost stays http", local);
const prod = redirectUriFor({ headers: { host: "ravikishan.me" } }, "google");
check(prod.startsWith("https://"), "anything else is forced to https", prod);

// Instagram is the ONE provider that will not register an http:// redirect at
// all, not even for localhost, so connecting it from a laptop needs the local
// HTTPS proxy (`npm run dev:https`). The proxy terminates TLS and forwards to
// the dev server, so the socket this code reads is plain http — the forwarded
// headers are the only evidence that the browser spoke https. Ignore them and
// the consent is served over TLS while the callback is built as http://, which
// comes back from Meta as "Invalid redirect_uri" and reads like their fault.
const proxied = redirectUriFor(
  { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "localhost:3443", host: "localhost:3000" }, socket: {} },
  "instagram"
);
check(
  proxied === "https://localhost:3443/api/integrations/instagram/callback",
  "a TLS-terminating proxy in front of dev yields an https localhost callback",
  proxied
);
// A proxy chain sends a list; the first entry is what the client spoke.
const chained = redirectUriFor(
  { headers: { "x-forwarded-proto": "https, http", host: "localhost:3443" }, socket: {} },
  "instagram"
);
check(chained.startsWith("https://"), "and a comma-separated chain reads the first hop", chained);
// Without the header nothing changes: plain `next dev` must stay http, or
// every other provider's registered localhost URI would stop matching.
check(
  redirectUriFor({ headers: { host: "localhost:3000" }, socket: {} }, "instagram") ===
    "http://localhost:3000/api/integrations/instagram/callback",
  "while plain dev is untouched"
);

console.log("\nwhere a connection is stored");
check(docPathFor("google") === "integrations/googleTasks", "google has its own document", docPathFor("google"));
check(
  docPathFor("microsoft") === "integrations/microsoftTasks",
  "so does microsoft",
  docPathFor("microsoft")
);
const rec = connectionRecord({ provider: "google", sealed, email: "a@b.c", scope: "s" });
check(rec.secret === sealed && rec.email === "a@b.c", "the stored record carries the sealed secret");
check(!JSON.stringify(rec).includes("1//abc.refresh"), "and never the token itself");

console.log("\nMicrosoft's shapes");
check(
  toGraphDue("2026-10-09").dateTime.startsWith("2026-10-09T00:00:00"),
  "a due date becomes a Graph date-time"
);
// Pinned to UTC: without a zone Graph interprets it locally and a task due the
// 9th shows up on the 8th for anyone east of London.
check(toGraphDue("2026-10-09").timeZone === "UTC", "pinned to UTC so it cannot shift a day");
check(toGraphDue("") === null, "and an empty due date clears it");
check(fromGraphDue({ dateTime: "2026-10-09T00:00:00.0000000" }) === "2026-10-09", "and reads back");
check(fromGraphDue(null) === "", "a task with no due date reads as empty");

const sid = makeStepId("task-1", "item-2");
check(isStepId(sid), "a step gets its own id space");
check(!isStepId("task-1"), "a plain task does not");
check(
  readStepId(sid).taskId === "task-1" && readStepId(sid).itemId === "item-2",
  "and the pair round-trips"
);
// Graph ids contain colons, so splitting on the LAST one would lose part of it.
const weird = makeStepId("AAA:BBB=", "CCC:DDD=");
check(
  readStepId(weird).taskId === "AAA:BBB=" && readStepId(weird).itemId === "CCC:DDD=",
  "even when the ids themselves contain colons"
);

console.log("\nwhat each service can actually do");
check(DEFAULT_PROVIDER === "google", "google is the default provider");
check(adapterFor("google").can.nestedTasks === true, "Google has real nested subtasks");
check(adapterFor("microsoft").can.nestedTasks === false, "Microsoft has steps, not nested tasks");
check(adapterFor("google").can.moveKeepsId === true, "a Google move keeps the task id");
check(
  adapterFor("microsoft").can.moveKeepsId === false,
  "a Microsoft move cannot — Graph has no move endpoint"
);
check(adapterFor().id === "google", "no provider means google");

// list_task_providers iterated every connected account and crashed on
// `undefined.can` the moment GitHub joined the provider table.
check(
  taskProviderIds().join(",") === "google,microsoft",
  "task providers are exactly google and microsoft",
  taskProviderIds().join(",")
);
check(
  providerIds().filter((id) => !taskProviderIds().includes(id)).length > 0,
  "and the connected-account table holds more than them"
);
check(
  (() => { try { adapterFor("github"); return false; } catch (e) { return /not a task service/.test(e.message); } })(),
  "adapterFor refuses a non-task account by name instead of returning undefined"
);

console.log("\nGitHub is a different shape of grant, and the registry says so");
{
  const gh = getProvider("github");
  // A classic GitHub OAuth app issues a token that never expires and NO
  // refresh token. Demanding one would reject GitHub outright, so the provider
  // declares which kind of credential it hands back and connectedAccount.js
  // skips the refresh exchange entirely.
  check(gh.longLived === true, "github is marked long-lived");
  check(
    getProvider("google").longLived !== true && getProvider("microsoft").longLived !== true,
    "the task providers are not"
  );
  // GitHub's token endpoint answers form-encoded unless asked otherwise, and a
  // form-encoded body parsed as JSON yields no access token at all.
  check(gh.tokenHeaders?.Accept === "application/json", "and asks its token endpoint for JSON");

  const u = new URL(
    authorizeUrl({ provider: "github", clientId: "cid", redirectUri: "https://x/cb", state: "ST" })
  );
  check(u.origin === "https://github.com", "the consent URL points at GitHub", u.origin);
  // GitHub pins with `login` and a handle rather than login_hint — and the pin
  // is OFF, like every other provider's, because a consent screen that always
  // offers one handle cannot connect the second.
  check(
    !u.searchParams.get("login"),
    "it lets you choose which GitHub account",
    String(u.searchParams.get("login"))
  );
  check(!u.searchParams.has("login_hint"), "and not login_hint, which GitHub ignores");
  const ghScopes = u.searchParams.get("scope").split(" ");
  check(
    ghScopes.includes("repo"),
    "it asks for repo, which reaches private repositories and their traffic",
    u.searchParams.get("scope")
  );
  check(ghScopes.includes("workflow"), "and workflow, without which a write under .github/workflows is refused");
  check(
    u.searchParams.get("prompt") === "select_account",
    "and shows GitHub's account chooser, so a second account can be connected",
    String(u.searchParams.get("prompt"))
  );
  check(
    !ghScopes.includes("admin:org"),
    "and never admin:org",
    u.searchParams.get("scope")
  );
  check(
    u.searchParams.get("scope").includes("user"),
    "and user, which is what allows the profile bio to be edited"
  );
  // Deleting a repository needs delete_repo. It is never requested, so no tool
  // could delete one even if somebody wrote it.
  check(
    !u.searchParams.get("scope").includes("delete_repo"),
    "and never delete_repo, so a repository cannot be deleted from here at all",
    u.searchParams.get("scope")
  );

  check(
    docPathFor("github") === "integrations/github",
    "it stores under its own document",
    docPathFor("github")
  );
  const rec = connectionRecord({ provider: "github", sealed: "SEALED", email: "Ravikisha", scope: "x" });
  check(rec.kind === "access", "and records that the sealed value is an access token", rec.kind);
  check(
    connectionRecord({ provider: "google", sealed: "S", email: "a@b.c", scope: "" }).kind === "refresh",
    "where google records a refresh token"
  );
}

console.log("\nLinkedIn is the awkward grant: refresh token for partners only");
{
  const u = new URL(
    authorizeUrl({ provider: "linkedin", clientId: "cid", redirectUri: "https://x/cb", state: "ST" })
  );
  check(u.origin === "https://www.linkedin.com", "the consent URL points at LinkedIn", u.origin);
  const scope = u.searchParams.get("scope") || "";
  // The two self-serve products. w_member_social is the one that lets anything
  // be published at all.
  check(scope.includes("w_member_social"), "it asks to post", scope);
  check(scope.includes("openid") && scope.includes("profile"), "and for the OIDC profile read");
  // Asking for a scope LinkedIn will not grant a self-serve app fails the WHOLE
  // consent screen, so these must stay out.
  check(!scope.includes("r_fullprofile"), "it does NOT ask for r_fullprofile, which is partner-only");
  check(!/r_member_social/.test(scope), "nor r_member_social, which is restricted");
  // LinkedIn's authorization endpoint has no login_hint equivalent.
  check(!u.searchParams.has("login_hint"), "and sends no account hint, which LinkedIn ignores");
  check(u.searchParams.get("state") === "ST", "the sealed state travels");

  check(
    docPathFor("linkedin") === "integrations/linkedin",
    "it stores under its own document",
    docPathFor("linkedin")
  );

  // The reason connectionRecord takes `kind` explicitly: LinkedIn is BOTH. An
  // approved Marketing Developer Platform partner gets a refresh token; a
  // self-serve app gets a 60-day access token. Inferring it from the provider
  // table would be wrong half the time.
  const asAccess = connectionRecord({
    provider: "linkedin",
    sealed: "S",
    kind: "access",
    expiresAt: "2026-12-01T00:00:00.000Z",
  });
  check(asAccess.kind === "access", "a self-serve connection records an access token");
  check(asAccess.expiresAt === "2026-12-01T00:00:00.000Z", "and keeps its expiry, which is real");
  const asRefresh = connectionRecord({ provider: "linkedin", sealed: "S", kind: "refresh" });
  check(asRefresh.kind === "refresh", "a partner connection records a refresh token");
  check(asRefresh.expiresAt === "", "and has no expiry worth showing");
}


// A token endpoint's refusal has to say WHICH refusal it was.
//
// Google answers a dead refresh token with
//   {"error":"invalid_grant","error_description":"Bad Request"}
// and the old code preferred error_description, so the panel reported
// "Google Tasks refused the stored connection (Bad Request)" — a sentence that
// sends you auditing the request instead of re-granting the permission. Both
// halves travel now, and the machine-readable one is kept on the error so a
// caller can tell a withdrawn permission from a broken deployment.
{
  console.log("\na refused token names the refusal, not the status line");

  const { accessTokenFromRefresh } = await import("../lib/server/integrations.js");
  const realFetch = globalThis.fetch;
  const answer = (status, body) => {
    globalThis.fetch = async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
  };
  const refuse = async () => {
    try {
      await accessTokenFromRefresh({ provider: "google", refreshToken: "r" });
      return null;
    } catch (e) {
      return e;
    }
  };

  try {
    answer(400, { error: "invalid_grant", error_description: "Bad Request" });
    let e = await refuse();
    check(/invalid_grant/.test(e.message), "the real reason survives", e.message);
    check(/Bad Request/.test(e.message), "and so does the provider's own wording", e.message);
    check(e.oauthError === "invalid_grant", "the code is kept machine-readable", e.oauthError);

    // Microsoft is the mirror image: generic error, the detail in the
    // description. Neither field may be the one that is dropped.
    answer(400, {
      error: "invalid_grant",
      error_description: "AADSTS70000: The provided grant has expired.",
    });
    e = await refuse();
    check(/AADSTS70000/.test(e.message), "an AADSTS code is not swallowed either", e.message);

    // No duplication when a provider repeats itself.
    answer(400, { error: "invalid_client", error_description: "invalid_client" });
    e = await refuse();
    check(e.message === "invalid_client", "an echoed description is not printed twice", e.message);

    // Nothing parseable at all still has to produce something actionable.
    answer(500, {});
    e = await refuse();
    check(e.message === "HTTP 500", "and a bodyless failure falls back to the status", e.message);
    check(e.oauthError === "", "with no code invented for it", JSON.stringify(e.oauthError));
  } finally {
    globalThis.fetch = realFetch;
  }

  // The translation the panel and the MCP tools both read.
  const { ConnectionError } = await import("../lib/server/connectedAccount.js");
  const ce = new ConnectionError("x", {
    provider: "google",
    code: "integration/rejected",
    oauthError: "invalid_grant",
  });
  check(ce.oauthError === "invalid_grant", "ConnectionError carries it through");
  check(
    new ConnectionError("x", { provider: "google" }).oauthError === "",
    "and defaults to empty rather than undefined"
  );
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("FAILURES:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
