// The activity log, checked with no network and no credentials.
//
//   node scripts/activity-check.mjs
//
// The assertion that matters most here is NOT "does it record things". It is
// "can a secret reach the log", because the log is admin-readable, unencrypted
// and append-only — three properties that together mean a password written
// into it cannot be taken back out. `create_secret` carries a password in its
// arguments and `set_env_var` carries a credential, so a logger that records
// arguments verbatim turns the audit trail into the worst secret store in the
// codebase.
//
// The second group is about the filter, because the default view hides reads.
// Entries written before this module existed have no `kind` field at all, and
// `undefined !== "write"`, so a naive filter would have silently hidden the
// entire history on the day it shipped.
import {
  LOG_READS,
  NEVER_LOGGED,
  byNewest,
  describeCall,
  matchesFilter,
  normaliseRow,
  redact,
  shapeEntry,
  summarise,
  targetOf,
} from "../lib/server/activityLog.js";

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

const json = (v) => JSON.stringify(v);

/* ------------------------------------------------------------------ */

console.log("\na secret cannot reach the log");
{
  const PW = "hunter2-correct-horse-battery";
  const cases = [
    ["create_secret", { name: "openai", value: PW }],
    ["set_env_var", { key: "X_CLIENT_SECRET", value: PW }],
    ["connect", { password: PW }],
    ["connect", { passphrase: PW }],
    ["refresh", { refresh_token: PW }],
    ["refresh", { refreshToken: PW }],
    ["call", { apiKey: PW }],
    ["call", { api_key: PW }],
    ["call", { client_secret: PW }],
    ["call", { clientSecret: PW }],
    ["call", { authorization: `Bearer ${PW}` }],
    ["call", { credentials: PW }],
    ["nested", { account: { token: PW } }],
    ["deep", { a: { b: { secret: PW } } }],
    ["list", { items: [{ password: PW }] }],
  ];
  for (const [name, args] of cases) {
    const out = json(redact(args));
    check(!out.includes(PW), `${name}: ${Object.keys(args)[0]} is redacted`, out.slice(0, 80));
  }
  // And the same through the whole entry, which is what is actually stored.
  const entry = shapeEntry({
    action: "mcp.create_secret",
    detail: describeCall("create_secret", redact({ name: "openai", value: PW })),
  });
  check(!json(entry).includes(PW), "and nowhere in the stored entry");
}

console.log("\nthe key decides, not the value");
{
  // A value-based heuristic fails both ways. These must survive, because a
  // log that elides ordinary fields tells you nothing.
  check(redact({ slug: "a-container-runtime" }).slug === "a-container-runtime", "a slug survives");
  check(redact({ title: "Secret Santa" }).title === "Secret Santa", "a title containing the word secret survives");
  check(redact({ name: "openai" }).name === "openai", "a secret's NAME survives, since that is what you search by");
  check(redact({ provider: "instagram" }).provider === "instagram", "a provider survives");
}

console.log("\nbulk payloads are described, not stored");
{
  const body = "x".repeat(5000);
  const r = redact({ body, contentBase64: "y".repeat(9000) });
  check(/^«5000 chars»$/.test(r.body), "a 5,000-character body becomes its own size", String(r.body));
  check(/chars»$/.test(r.contentBase64), "so does inline base64", String(r.contentBase64));
  check(json(r).length < 200, "and the whole entry stays small", `${json(r).length} chars`);

  const dataUri = redact({ cover: "data:image/png;base64," + "A".repeat(4000) });
  check(/data uri/.test(dataUri.cover), "a data: URI is caught even under an innocent key", String(dataUri.cover).slice(0, 40));

  check(/^«40 items»$/.test(redact({ tags: Array(40).fill("t") }).tags), "a long array becomes a count");
  const long = redact({ note: "n".repeat(500) }).note;
  check(long.length <= 161 && long.endsWith("…"), "an ordinary long string is cut, not dropped", String(long.length));
}

console.log("\nthe target is the thing you would search for");
{
  check(targetOf({ slug: "my-post", accountId: "UC1" }) === "my-post", "a slug beats an accountId");
  check(targetOf({ accountId: "UC1" }) === "UC1", "and an accountId is used when it is all there is");
  check(targetOf({}) === "", "nothing identifying gives an empty target");
  check(targetOf(null) === "", "and null does not throw");
  check(targetOf({ id: 42 }) === "42", "a numeric id is stringified");
}

console.log("\nan entry always has the same shape");
{
  const e = shapeEntry({ action: "mcp.x", actor: { jti: "abc", label: "Claude Code" } });
  for (const k of ["action", "kind", "source", "target", "detail", "ok", "error", "ms", "tokenId", "tokenLabel", "email", "at"])
    check(k in e, `it has ${k}`);
  check(e.kind === "write", "kind defaults to write");
  check(e.ok === true, "ok defaults to true");
  check(e.tokenId === "abc" && e.tokenLabel === "Claude Code", "it says WHICH token acted");
  // The token itself must never be in there — only its opaque id.
  check(!json(e).includes("mcp_"), "and never the token itself");
  check(shapeEntry({ action: "a", kind: "nonsense" }).kind === "write", "an unknown kind falls back to write");
  check(shapeEntry({ action: "a", ms: "slow" }).ms === null, "a non-numeric duration becomes null, not NaN");
}

console.log("\nreading the log does not grow the log");
{
  check(NEVER_LOGGED.has("get_audit_log"), "get_audit_log is never recorded");
  check(NEVER_LOGGED.has("get_activity_summary"), "nor is the summary");
  check(typeof LOG_READS === "boolean", "and whether reads are recorded at all is one stated constant");
}

console.log("\nentries written before this existed are still visible");
{
  // The real historical shape: no kind, no source, no ok.
  const old = normaliseRow({ action: "content.save", target: "", detail: "", at: "2026-09-01T10:00:00Z" });
  check(old.kind === "write", "an entry with no kind reads as a change, not as nothing", old.kind);
  check(old.source === "admin", "and is attributed to the admin, which is where it came from");
  check(old.ok === true, "and is not reported as a failure");
  // This is the assertion that would have caught the bug: the DEFAULT view.
  check(matchesFilter(old, { kind: "write" }), "so the default view still shows it");
  const failed = normaliseRow({ action: "x", ok: false, at: "2026-01-01T00:00:00Z" });
  check(failed.ok === false, "an explicit false is preserved rather than defaulted to true");
}

console.log("\nthe filter narrows and never widens");
{
  const rows = [
    { action: "mcp.create_post", kind: "write", source: "mcp", target: "a-post", detail: "slug=a-post", ok: true, at: "2026-10-08T10:00:00Z", tokenLabel: "Claude Code" },
    { action: "mcp.get_post", kind: "read", source: "mcp", target: "a-post", detail: "", ok: true, at: "2026-10-08T11:00:00Z", tokenLabel: "Claude Code" },
    { action: "content.save", kind: "write", source: "admin", target: "", detail: "", ok: true, at: "2026-10-07T09:00:00Z", email: "me@example.com" },
    { action: "mcp.delete_task", kind: "write", source: "mcp", target: "t1", detail: "", ok: false, error: "needs confirm", at: "2026-10-08T12:00:00Z", tokenLabel: "Claude Code" },
  ];
  const f = (x) => rows.filter((r) => matchesFilter(r, x));

  check(f({ kind: "write" }).length === 3, "reads are excluded by kind", String(f({ kind: "write" }).length));
  check(f({ source: "admin" }).length === 1, "source narrows to one half of the log");
  check(f({ action: "post" }).length === 2, "action matches as a substring", String(f({ action: "post" }).length));
  check(f({ failedOnly: true }).length === 1, "failures can be isolated");
  check(f({ failedOnly: true })[0].error === "needs confirm", "and carry why");
  check(f({ since: "2026-10-08" }).length === 3, "since is inclusive of the day");
  check(f({ until: "2026-10-07T23:59:59Z" }).length === 1, "until bounds the other end");
  // Every word must appear — two words narrow.
  check(f({ q: "claude" }).length === 3, "a search matches the actor");
  check(f({ q: "claude post" }).length === 2, "two words narrow rather than widen", String(f({ q: "claude post" }).length));
  check(f({ q: "claude nonsense" }).length === 0, "and a word that matches nothing returns nothing");
  check(f({}).length === 4, "an empty filter excludes nothing");
}

console.log("\nnewest first");
{
  const r = [{ at: "2026-01-01" }, { at: "2026-10-08" }, { at: "2026-05-05" }].sort(byNewest);
  check(r[0].at === "2026-10-08" && r[2].at === "2026-01-01", "sorted newest first", r.map((x) => x.at).join(" "));
}

console.log("\nthe summary answers what actually happened");
{
  const rows = [
    { action: "mcp.create_post", kind: "write", ok: true, at: "2026-10-08T10:00:00Z", tokenLabel: "Claude Code" },
    { action: "mcp.create_post", kind: "write", ok: true, at: "2026-10-08T10:05:00Z", tokenLabel: "Claude Code" },
    { action: "mcp.delete_task", kind: "write", ok: false, error: "needs confirm", target: "t1", at: "2026-10-08T12:00:00Z", tokenLabel: "Claude Code" },
    { action: "mcp.get_post", kind: "read", ok: true, at: "2026-10-08T11:00:00Z", tokenLabel: "Other agent" },
  ];
  const s = summarise(rows);
  check(s.entries === 4, "it counts everything it was given");
  check(s.writes === 3 && s.reads === 1, "and splits changes from lookups", `${s.writes}/${s.reads}`);
  check(s.failed === 1, "failures are counted");
  check(s.failures[0].error === "needs confirm", "and listed with the reason");
  check(s.byAction[0].action === "mcp.create_post" && s.byAction[0].count === 2, "the commonest action leads");
  check(s.byActor[0].actor === "Claude Code" && s.byActor[0].count === 3, "and so does the busiest actor");
  check(s.from === "2026-10-08T10:00:00Z" && s.to === "2026-10-08T12:00:00Z", "the window is the real span of the rows");
  const empty = summarise([]);
  check(empty.entries === 0 && empty.byAction.length === 0 && empty.from === "", "an empty log summarises to nothing, not to NaN");
}

console.log("\nthe detail line is readable and bounded");
{
  const d = describeCall("create_post", redact({ slug: "a", title: "B", body: "x".repeat(900) }));
  check(d.includes("slug=a"), "it names the arguments");
  check(!d.includes("xxxxxxxxxx"), "without the payload", d.slice(0, 60));
  check(d.length <= 301, "and is capped", String(d.length));
  const many = describeCall("t", Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])));
  check(many.split(" ").length <= 6, "a call with 30 arguments does not print 30", String(many.split(" ").length));
}

/* ------------------------------------------------------------------ *
 * The whole chain, with the network stubbed at `fetch`.
 *
 * Everything above tests the pure functions. This drives the REAL
 * recordToolCall and the REAL get_audit_log / get_activity_summary handlers,
 * so the Firestore value encoding, the round trip through toFields/fromFields
 * and the tool wiring are all exercised - the only thing replaced is the
 * socket. A suite that stops at the pure layer cannot catch a tool that
 * records perfectly and then reads the wrong collection.
 * ------------------------------------------------------------------ */

console.log("\nend to end, with the network stubbed");
{
  const { recordToolCall } = await import("../lib/server/activityLog.js");
  const { TOOLS } = await import("../lib/server/mcpTools.js");
  const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

  const stored = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (init.method === "POST" && /\/auditLog/.test(u)) {
      stored.push(JSON.parse(init.body).fields);
      return { ok: true, status: 200, json: async () => ({ name: "x/" + stored.length, fields: {} }) };
    }
    if (/\/auditLog/.test(u)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ documents: stored.map((f, i) => ({ name: "x/" + i, fields: f })) }),
      };
    }
    throw new Error("unexpected fetch in test: " + u);
  };

  try {
    const PW = "hunter2-correct-horse-battery";
    const claims = { jti: "tok-1", label: "Claude Code", scopes: ["read", "write", "secrets"] };

    await recordToolCall("id", {
      tool: byName.create_short_link,
      args: { slug: "x-launch", url: "https://ravikishan.me/blog/x" },
      claims, ok: true, ms: 42,
    });
    await recordToolCall("id", {
      tool: byName.delete_short_link, args: { slug: "old-link" },
      claims, ok: false, error: "needs confirm", ms: 7,
    });
    await recordToolCall("id", {
      tool: byName.get_post, args: { slug: "x-launch" }, claims, ok: true, ms: 11,
    });
    await recordToolCall("id", {
      tool: byName.create_secret, args: { name: "openai", value: PW }, claims, ok: true, ms: 9,
    });
    // Reading the log must not add to it.
    await recordToolCall("id", { tool: byName.get_audit_log, args: {}, claims, ok: true, ms: 3 });

    check(stored.length === 4, "four calls recorded, and the log read was not", String(stored.length));
    const raw = JSON.stringify(stored);
    check(!raw.includes(PW), "the password is nowhere in what was actually sent to Firestore");
    check(raw.includes("openai"), "but the secret's NAME is, since that is what you search by");

    const log = await byName.get_audit_log.handler({}, { idToken: "id" });
    check(log.entries.length === 3, "the default view shows the three changes", String(log.entries.length));
    check(!log.entries.some((e) => e.kind === "read"), "and hides the lookup");
    check(log.readsHidden === true, "and says so, rather than letting you assume there were none");

    const all = await byName.get_audit_log.handler({ includeReads: true }, { idToken: "id" });
    check(all.entries.length === 4, "includeReads brings the lookup back", String(all.entries.length));

    const failed = await byName.get_audit_log.handler({ failedOnly: true }, { idToken: "id" });
    check(
      failed.entries.length === 1 && failed.entries[0].error === "needs confirm",
      "a failed call is findable with its reason",
      JSON.stringify(failed.entries[0] || {})
    );

    const found = await byName.get_audit_log.handler({ q: "x-launch" }, { idToken: "id" });
    check(found.entries.length === 1, "search finds a call by its target", String(found.entries.length));
    check(found.entries[0].by === "Claude Code", "and says which token did it", String(found.entries[0].by));
    check(found.entries[0].ms === 42, "and how long it took");

    const sum = await byName.get_activity_summary.handler(
      { since: "2000-01-01T00:00:00Z" },
      { idToken: "id" }
    );
    check(sum.writes === 3 && sum.reads === 0, "the summary counts the changes", sum.writes + "/" + sum.reads);
    check(sum.failed === 1, "and the failure");
    check(sum.byActor[0].actor === "Claude Code", "attributed to the token that acted");
    check(sum.byAction.some((a) => a.action === "mcp.create_short_link"), "with the real tool names");
  } finally {
    globalThis.fetch = real;
  }
}


console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
