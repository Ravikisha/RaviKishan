/* Refreshes the live numbers quoted across the site.
 *
 *   node scripts/sync-metrics.mjs [--check]
 *
 * Writes lib/metrics.json. lib/facts.js reads it, so GitHub stars, repo count,
 * followers and npm downloads stop being hand-edited constants that quietly go
 * stale. Everything else in facts.js still traces to the résumé and stays put.
 *
 * Runs in CI on a cron (.github/workflows/sync-metrics.yml) and commits the
 * file when it changes; Vercel redeploys on the push. Deliberately needs NO
 * stored secret: GitHub Actions injects GITHUB_TOKEN for the higher rate limit,
 * and the npm registry download API is public.
 *
 * --check exits non-zero if the file is out of date, without writing.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "lib", "metrics.json");
const USER = "Ravikisha";

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const ghHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "ravikishan-portfolio-metrics",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function github() {
  const profile = await getJson(`https://api.github.com/users/${USER}`, ghHeaders);

  // Own repos only — forks would inflate both the star total and the count.
  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await getJson(
      `https://api.github.com/users/${USER}/repos?per_page=100&type=owner&page=${page}`,
      ghHeaders
    );
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  const own = repos.filter((r) => !r.fork);

  return {
    stars: own.reduce((n, r) => n + (r.stargazers_count || 0), 0),
    repos: own.length,
    // Both are recorded so a public claim can say which one it means. `repos`
    // is originals only — the honest number for "repos I built".
    reposIncludingForks: repos.length,
    forks: repos.length - own.length,
    followers: profile.followers || 0,
    since: new Date(profile.created_at).getFullYear(),
    topLanguages: Object.entries(
      own.reduce((acc, r) => {
        if (r.language) acc[r.language] = (acc[r.language] || 0) + 1;
        return acc;
      }, {})
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([lang, count]) => ({ lang, count })),
  };
}

// The published package list is derived from the projects data rather than
// duplicated here, so adding a project with an npm link is enough.
function npmPackages() {
  const src = fs.readFileSync(path.join(root, "components", "data_projects.js"), "utf8");
  const names = new Set();
  for (const m of src.matchAll(/npmjs\.com\/package\/([a-z0-9@._-]+)/gi)) names.add(m[1]);
  return [...names].sort();
}

async function npm() {
  const packages = npmPackages();
  const perPackage = {};
  let total = 0;
  for (const name of packages) {
    try {
      // last-year is the most meaningful window for a portfolio claim
      const d = await getJson(
        `https://api.npmjs.org/downloads/point/last-year/${encodeURIComponent(name)}`
      );
      perPackage[name] = d.downloads || 0;
      total += d.downloads || 0;
    } catch (e) {
      perPackage[name] = null; // unpublished or renamed — recorded, not fatal
    }
  }
  return { packages: packages.length, total, perPackage };
}

// Round DOWN to a clean threshold so the public claim is never an overstatement.
export function floorClaim(n) {
  if (n >= 10000) return Math.floor(n / 5000) * 5000;
  if (n >= 1000) return Math.floor(n / 500) * 500;
  if (n >= 100) return Math.floor(n / 50) * 50;
  return Math.floor(n / 10) * 10;
}

const main = async () => {
  const [gh, np] = await Promise.all([github(), npm()]);
  const next = {
    // generatedAt is intentionally date-only: a timestamp would make the file
    // differ on every run and produce an empty commit every night.
    generatedAt: new Date().toISOString().slice(0, 10),
    github: gh,
    npm: { ...np, claim: floorClaim(np.total) },
  };

  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
  const same =
    prev &&
    JSON.stringify({ ...prev, generatedAt: null }) ===
      JSON.stringify({ ...next, generatedAt: null });

  if (process.argv.includes("--check")) {
    console.log(same ? "metrics.json is up to date" : "metrics.json is STALE");
    process.exit(same ? 0 : 1);
  }

  if (same) {
    console.log("No metric changes.");
    return;
  }

  fs.writeFileSync(OUT, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(
    `stars=${gh.stars} repos=${gh.repos} followers=${gh.followers} ` +
      `npm=${np.total} across ${np.packages} packages (claim ${next.npm.claim}+)`
  );
  if (prev) {
    console.log(
      `was  stars=${prev.github.stars} repos=${prev.github.repos} ` +
        `followers=${prev.github.followers} npm=${prev.npm.total}`
    );
  }
};

main().catch((e) => {
  console.error("metric sync failed:", e.message);
  process.exit(1);
});
