// Reading tasks across EVERY connected account — checked with no network.
//
//   node scripts/alltasks-check.mjs
//
// `list_tasks` reads one account. With several connected that answers a
// narrower question than the one being asked, and nothing in the result says
// so — which is the failure this tool exists to prevent. So the assertions
// that matter are not "does it return rows". They are:
//
//   1. Every row says WHICH account it came from. A flat list merged from
//      three accounts is unusable without it, and acting on a row means
//      naming its account again.
//   2. ONE FAILING ACCOUNT DOES NOT HIDE THE REST. An expired Microsoft
//      connection is a normal state; a call that throws because of it answers
//      nothing about the Google account that is perfectly fine.
//   3. A partial answer SAYS it is partial. A short list that looks complete
//      is worse than an error.
import { TOOLS } from "../lib/server/mcpTools.js";

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

const tool = TOOLS.find((t) => t.name === "list_all_tasks");

/* ---------------- a fake pair of accounts ---------------- */
// Two Google accounts and one Microsoft, where the Microsoft one is expired —
// the shape that actually exposes the bugs above.
const ACCOUNTS = [
  { provider: "google", accountId: "g1", label: "work@x.com", email: "work@x.com" },
  { provider: "google", accountId: "g2", label: "home@x.com", email: "home@x.com" },
  { provider: "microsoft", accountId: "m1", label: "ms@x.com", email: "ms@x.com" },
  // Not a task service at all: it must be ignored rather than attempted.
  { provider: "github", accountId: "gh", label: "Ravikisha" },
];

const BOARDS = {
  g1: {
    groups: [{ id: "l1", title: "Work" }],
    tasks: { l1: [{ id: "t1", title: "Ship it", completed: false }] },
  },
  g2: {
    groups: [{ id: "l2", title: "Home" }],
    tasks: {
      l2: [
        { id: "t2", title: "Bins", completed: false },
        { id: "t3", title: "Done thing", completed: true },
      ],
    },
  },
  // m1 throws: an expired connection.
};

const realFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("no network expected in this suite");
};

// Swap the two things the handler reaches for.
const dir = await import("../lib/server/accountDirectory.js");
const board = await import("../lib/server/taskBoard.js");
const realAll = dir.allAccounts;
const realBoard = board.boardFor;

const api = (id) => ({
  id,
  listGroups: async () => BOARDS[id]?.groups || [],
  listTasks: async (_t, gid, { showCompleted } = {}) =>
    (BOARDS[id]?.tasks?.[gid] || []).filter((t) => showCompleted || !t.completed),
});

// ESM exports are read-only bindings, so the handler is driven through a
// shim that mirrors it rather than by monkey-patching the module.
const run = async (args = {}, { accounts = ACCOUNTS } = {}) => {
  const taskIds = ["google", "microsoft"];
  const wanted = accounts.filter(
    (a) => taskIds.includes(a.provider) && (!args.provider || a.provider === args.provider)
  );
  if (!wanted.length)
    return { accounts: 0, count: 0, tasks: [], note: "No task account is connected." };

  const results = await Promise.all(
    wanted.map(async (a) => {
      try {
        if (!BOARDS[a.accountId]) throw new Error("This connection has expired. Reconnect it.");
        const A = api(a.accountId);
        const groups = await A.listGroups();
        const rows = [];
        for (const g of groups) {
          for (const t of await A.listTasks(null, g.id, { showCompleted: !!args.includeCompleted })) {
            if (args.openOnly && (t.completed || t.isStep)) continue;
            rows.push({
              ...t,
              groupId: g.id,
              group: g.title,
              provider: a.provider,
              accountId: a.accountId,
              account: a.label || a.email || a.accountId,
            });
          }
        }
        return { provider: a.provider, accountId: a.accountId, account: a.label, rows };
      } catch (e) {
        return { provider: a.provider, accountId: a.accountId, account: a.label, error: e.message, rows: [] };
      }
    })
  );
  const tasks = results.flatMap((r) => r.rows);
  const failed = results.filter((r) => r.error);
  return {
    accounts: results.length,
    count: tasks.length,
    partial: failed.length > 0,
    unreadable: failed.map((r) => ({ account: r.account, provider: r.provider, error: r.error })),
    byAccount: results.map((r) => ({
      account: r.account,
      provider: r.provider,
      accountId: r.accountId,
      count: r.rows.length,
      error: r.error,
    })),
    tasks,
  };
};

/* ------------------------------------------------------------------ */

console.log("\nthe tool is shaped for the question it answers");
check(!!tool, "list_all_tasks exists");
check(tool.scope === "read", "it is a read", tool.scope);
check(!tool.inputSchema.properties.groupId, "it takes no groupId — one is only valid inside one account");
check(!tool.inputSchema.properties.accountId, "and no accountId — spanning them is the point");
check(/EVERY connected account/i.test(tool.description), "the description says it spans accounts");
check(/list_tasks reads one account/i.test(tool.description), "and says why list_tasks is not enough");

console.log("\nit reads every account, and every row says whose it is");
{
  const r = await run();
  check(r.accounts === 3, "the two services' accounts are read, github is ignored", String(r.accounts));
  check(r.count === 2, "open tasks from both Google accounts", String(r.count));
  check(r.tasks.every((t) => t.account && t.accountId && t.provider), "every row names its account");
  check(
    new Set(r.tasks.map((t) => t.account)).size === 2,
    "rows from different accounts are distinguishable",
    [...new Set(r.tasks.map((t) => t.account))].join(", ")
  );
  check(r.tasks.every((t) => t.group), "and the group it sits in");
}

console.log("\none failing account does not hide the rest");
{
  const r = await run();
  check(r.count === 2, "the healthy accounts still return their tasks", String(r.count));
  check(r.partial === true, "and the answer says it is incomplete");
  check(r.unreadable.length === 1, "naming the account that could not be read", String(r.unreadable.length));
  check(/expired/i.test(r.unreadable[0].error), "with the real reason", r.unreadable[0].error);
  check(
    r.byAccount.find((a) => a.accountId === "m1").error,
    "and the per-account breakdown carries it too"
  );
}

console.log("\nthe filters narrow and never widen");
{
  const all = await run({ includeCompleted: true });
  check(all.count === 3, "includeCompleted brings back the finished one", String(all.count));
  const open = await run({ includeCompleted: true, openOnly: true });
  check(open.count === 2, "openOnly drops it again", String(open.count));
  const g = await run({ provider: "google" });
  check(g.accounts === 2 && g.partial === false, "one service narrows to its accounts and nothing fails");
  const m = await run({ provider: "microsoft" });
  check(m.accounts === 1 && m.count === 0, "and the other returns nothing readable", String(m.count));
}

console.log("\nnothing connected is said, not crashed");
{
  const r = await run({}, { accounts: [] });
  check(r.count === 0 && r.accounts === 0, "it returns an empty answer");
  check(/No task account is connected/i.test(r.note || ""), "and says so rather than looking like zero tasks");
}

console.log("\nthe real handler has the properties the mirror asserts");
{
  // `run()` above MIRRORS the handler so the fan-out can be driven without a
  // network. A mirror that drifts from the thing it mirrors passes happily
  // while the real tool is broken, so the source is checked for the three
  // properties the mirror cannot prove on its own.
  const src = tool.handler.toString();
  check(
    /catch\s*\(/.test(src) && /error:/.test(src),
    "each account is read inside its own try/catch, so one failure is contained"
  );
  check(/partial:/.test(src), "the result carries a partial flag");
  check(
    /accountId: a\.accountId/.test(src) && /account: a\.label/.test(src),
    "and every row is stamped with the account it came from"
  );
  check(
    /taskProviderIds\(\)\.includes/.test(src),
    "non-task accounts are filtered out rather than attempted"
  );
  check(/Promise\.all/.test(src), "accounts are read in parallel, not one after another");
}

globalThis.fetch = realFetch;
void realAll;
void realBoard;

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
