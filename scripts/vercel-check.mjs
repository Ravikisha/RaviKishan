// Does the stored VERCEL_TOKEN actually work?
//
//   npm run vercel:check
//
// `firebase deploy` reports success when a rules file compiles; storing a
// credential reports success when the write lands. Neither tells you the thing
// you actually wanted to know. This asks Vercel.
//
// It never prints the token, and it never creates, changes or deletes a
// project — the only calls are a whoami and a project listing.
import fs from "fs";
import path from "path";

// Load .env.local the way Next does, so this runs the same way the dev server
// does rather than needing the variable exported by hand.
for (const f of [".env.local", ".env"]) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { hydrateEnv } = await import("../lib/server/envStore.js");
const { vercelConfigured } = await import("../lib/server/release.js");

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

console.log("\nthe stored variable");
// hydrateEnv is what withEnv() calls on every request, so this reads the
// variable exactly the way a route would.
await hydrateEnv({ force: true }).catch((e) => {
  console.log(`  ✗ could not read the env store — ${e.message}`);
  process.exit(1);
});
const stored = process.env;
const token = stored.VERCEL_TOKEN;
check(!!token, "VERCEL_TOKEN is in the sealed store");
check(vercelConfigured({ VERCEL_TOKEN: token }), "and reads as configured");
if (!token) process.exit(1);
check(/^vcp_/.test(token), "it looks like a Vercel token", token.slice(0, 4));

const team = stored.VERCEL_TEAM_ID;
console.log(
  team ? "  · scoped to a team" : "  · personal account (no VERCEL_TEAM_ID, which is correct for Hobby)"
);

const call = async (p) => {
  const q = team ? `${p.includes("?") ? "&" : "?"}teamId=${team}` : "";
  const res = await fetch(`https://api.vercel.com${p}${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

console.log("\nwhat Vercel says about it");
const me = await call("/v2/user");
check(me.status === 200, "Vercel accepts the token", `HTTP ${me.status} ${me.json?.error?.message || ""}`);
if (me.status === 200) check(!!me.json.user?.username, "and names the account", me.json.user?.username);

const projects = await call("/v9/projects?limit=20");
check(projects.status === 200, "it can list projects", `HTTP ${projects.status} ${projects.json?.error?.message || ""}`);
if (projects.status === 200) {
  const names = (projects.json.projects || []).map((p) => p.name);
  check(names.length > 0, "and sees at least one", names.join(", "));
  // The portfolio is the one that must be there: if the token is scoped to a
  // different account, this is where it shows.
  check(
    names.some((n) => /portifilio|portfolio/i.test(n)),
    "including the portfolio, so the token is on the right account",
    names.join(", ")
  );
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
