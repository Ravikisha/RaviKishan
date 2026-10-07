// Design reference for the GitHub panel, rendered with the REAL components so
// it cannot drift from the live one.
//
// The panel needs a connected GitHub account, which makes it impossible to look
// at — or to assert on — without one. This renders the same ProfileCard,
// AuditLine and RepoRow against fixed data: no GitHub, no network.
//
// The seed is deliberately unflattering. A preview full of tidy repositories
// shows none of the states the panel exists for, so this one carries a repo
// with no description, one with no topics, a well-starred one with no homepage
// link, and an archived one that must NOT be nagged about.
//
// 404s in production: it is a design tool, not a page.
import React, { useMemo, useState } from "react";
import {
  ProfileCard,
  AuditLine,
  RepoRow,
  GithubStyles,
  HubStyles,
  Lane,
  Overview,
  Repositories,
} from "../components/admin/GithubPanel";
import { auditRepos } from "../lib/github";
import { shapeAnalytics } from "../lib/server/githubInsights";

// A year of contributions, deterministic so screenshots compare: a busy
// account with a quiet summer and a fresh streak, and a nearly dormant one.
// The lanes share ONE scale, so the second must visibly read as quiet.
function fakeViewer(login, intensity, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const today = new Date("2026-10-07T00:00:00Z");
  const start = new Date(today.getTime() - 364 * 86400000);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const weeks = [];
  for (let w = 0; w < 53; w++) {
    const contributionDays = [];
    for (let d = 0; d < 7; d++) {
      const t = new Date(start.getTime() + (w * 7 + d) * 86400000);
      if (t > today) break;
      const summer = w > 30 && w < 38 ? 0.15 : 1;
      const weekend = d === 0 || d === 6 ? 0.4 : 1;
      const n = rnd() < 0.62 * intensity * summer ? Math.round(rnd() * 9 * intensity * weekend) : 0;
      contributionDays.push({ date: t.toISOString().slice(0, 10), contributionCount: w > 50 ? n + 1 : n });
    }
    weeks.push({ contributionDays });
  }
  return shapeAnalytics(
    {
      login,
      followers: { totalCount: 48 },
      following: { totalCount: 31 },
      starredRepositories: { totalCount: 212 },
      gists: { totalCount: 6 },
      organizations: { nodes: [] },
      repositories: {
        totalCount: 61,
        nodes: [
          { name: "Pixa", isFork: false, languages: { edges: [{ size: 412000, node: { name: "Rust", color: "#dea584" } }, { size: 40000, node: { name: "TypeScript", color: "#3178c6" } }] } },
          { name: "kontainer", isFork: false, languages: { edges: [{ size: 220000, node: { name: "Go", color: "#00ADD8" } }] } },
          { name: "lispy", isFork: false, languages: { edges: [{ size: 98000, node: { name: "C", color: "#555555" } }] } },
          { name: "site", isFork: false, languages: { edges: [{ size: 160000, node: { name: "JavaScript", color: "#f1e05a" } }, { size: 30000, node: { name: "SCSS", color: "#c6538c" } }] } },
          { name: "agents", isFork: false, languages: { edges: [{ size: 120000, node: { name: "Python", color: "#3572A5" } }] } },
        ],
      },
      contributionsCollection: {
        totalCommitContributions: Math.round(900 * intensity),
        totalPullRequestContributions: Math.round(64 * intensity),
        totalPullRequestReviewContributions: Math.round(22 * intensity),
        totalIssueContributions: Math.round(18 * intensity),
        totalRepositoryContributions: Math.round(9 * intensity),
        restrictedContributionsCount: Math.round(140 * intensity),
        contributionCalendar: { weeks },
      },
    },
    "2026-10-07"
  );
}

const ACCOUNTS = [
  { accountId: "Ravikisha", label: "Ravikisha" },
  { accountId: "godasap7", label: "godasap7" },
  { accountId: "old-handle", label: "old-handle" },
];


const PROFILE = {
  login: "Ravikisha",
  name: "Ravi Kishan",
  bio: "Software Engineer — distributed systems, systems programming & applied AI.",
  blog: "https://ravikishan.me",
  company: "",
  location: "Bihar, India",
  twitter: "",
  avatar:
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><rect width="52" height="52" rx="26" fill="#23262f"/><text x="26" y="33" font-family="Inter,sans-serif" font-size="18" fill="#8b90a0" text-anchor="middle">RK</text></svg>`
    ),
  publicRepos: 59,
  followers: 48,
  url: "https://github.com/Ravikisha",
};

const REPOS = [
  {
    name: "Pixa",
    description: "A deterministic UI runtime built from first principles.",
    homepage: "https://ravikishan.me/projects",
    topics: ["ui-runtime", "rust", "systems"],
    stars: 62,
    forks: 7,
    language: "Rust",
    archived: false,
    private: false,
    isFork: false,
    defaultBranch: "main",
    owner: "Ravikisha",
    url: "https://github.com/Ravikisha/Pixa",
  },
  {
    name: "kontainer",
    // No description: the finding the panel exists for.
    description: "",
    homepage: "",
    topics: ["containers", "linux"],
    stars: 34,
    forks: 3,
    language: "Go",
    archived: false,
    private: false,
    isFork: false,
    defaultBranch: "main",
    owner: "Ravikisha",
    url: "https://github.com/Ravikisha/kontainer",
  },
  {
    name: "lispy",
    description: "A small Lisp interpreter written to understand evaluation.",
    homepage: "",
    // No topics, and enough stars that the missing homepage matters too.
    topics: [],
    stars: 21,
    forks: 2,
    language: "C",
    archived: false,
    private: false,
    isFork: false,
    defaultBranch: "main",
    owner: "Ravikisha",
    url: "https://github.com/Ravikisha/lispy",
  },
  {
    name: "old-experiment",
    description: "An early experiment, kept for the history.",
    homepage: "",
    topics: [],
    stars: 1,
    forks: 0,
    language: "JavaScript",
    // Archived: finished work. It must not appear in the audit.
    archived: true,
    private: false,
    isFork: false,
    defaultBranch: "master",
    owner: "Ravikisha",
    url: "https://github.com/Ravikisha/old-experiment",
  },
];

const PROFILE_FULL = {
  ...PROFILE,
  email: "ravikishan63392@gmail.com",
  company: "Zimyo",
  following: 31,
  privateRepos: 12,
  publicGists: 6,
  privateGists: 2,
  createdAt: "2019-03-14T00:00:00Z",
  plan: "free",
  twoFactor: true,
  diskUsageKb: 512000,
  hireable: true,
};

const day = (n) => new Date(Date.parse("2026-10-07T00:00:00Z") - n * 86400000).toISOString();
const HUB_REPOS = [
  ...REPOS.map((r, i) => ({ ...r, pushedAt: day([2, 40, 120, 700][i]), createdAt: day([400, 900, 1200, 1500][i]) })),
  { ...REPOS[0], name: "agents", description: "Production agentic-AI tooling.", language: "Python", stars: 9, forks: 1, private: true, pushedAt: day(0.2), createdAt: day(20), url: "https://github.com/Ravikisha/agents" },
  { ...REPOS[0], name: "react", description: "Fork kept for a patch.", language: "JavaScript", stars: 0, forks: 0, isFork: true, pushedAt: day(5), createdAt: day(300), url: "https://github.com/Ravikisha/react" },
];

const TRAFFIC = [
  { repo: "agents", views: 0, uniques: 0, clones: 4, cloners: 2, daily: [] },
  { repo: "Pixa", views: 412, uniques: 96, clones: 31, cloners: 12, daily: [12, 30, 22, 41, 18, 60, 33, 25, 19, 44, 52, 28, 16, 12].map((count, i) => ({ date: String(i), count })) },
  { repo: "kontainer", views: 88, uniques: 30, clones: 6, cloners: 4, daily: [2, 4, 9, 3, 8, 6, 12, 5, 7, 4, 6, 9, 8, 5].map((count, i) => ({ date: String(i), count })) },
  { repo: "lispy", error: "GitHub refused that." },
];

export default function GithubPreview() {
  const [repos, setRepos] = useState(REPOS);
  const [open, setOpen] = useState("kontainer");
  const [profile, setProfile] = useState(PROFILE);
  const [filter, setFilter] = useState("attention");

  const audit = useMemo(() => auditRepos(repos, { readmes: {} }), [repos]);

  // The same rule the panel applies, so the chip count and the rows below it
  // cannot disagree — which they did on the first pass.
  const shown = useMemo(() => {
    const list =
      filter === "attention"
        ? repos.filter((r) => audit.byRepo[r.name]?.length)
        : filter === "archived"
        ? repos.filter((r) => r.archived)
        : repos;
    return [...list].sort((a, b) => b.stars - a.stars);
  }, [repos, filter, audit]);

  const [sel, setSel] = useState("Ravikisha");
  const [view, setView] = useState("overview");
  const hub = useMemo(() => {
    const full = PROFILE_FULL;
    const repoList = HUB_REPOS;
    return {
      Ravikisha: { profile: full, analytics: fakeViewer("Ravikisha", 1, 7), repos: repoList },
      godasap7: {
        profile: { ...full, login: "godasap7", name: "", bio: "", twoFactor: false, url: "https://github.com/godasap7" },
        analytics: fakeViewer("godasap7", 0.18, 3),
        repos: repoList.slice(0, 2).map((r) => ({ ...r, owner: "godasap7", stars: 0, url: `https://github.com/godasap7/${r.name}` })),
      },
      // A revoked token: its lane must say so without blanking the others.
      "old-handle": { error: "GitHub refused the connection. Reconnect this account." },
    };
  }, []);
  const laneMax = Math.max(1, ...Object.values(hub).flatMap((d) => d.analytics?.calendar?.weekly || [0]));
  const cur = hub[sel];

  return (
    <main
      className="admin-main gh-main"
      style={{ background: "#08090d", minHeight: "100vh", padding: "88px 24px 24px" }}
    >
      <div className="gx" data-preview="hub">
        <section className="gx-lanes" aria-label="GitHub accounts">
          {ACCOUNTS.map((a) => (
            <Lane
              key={a.accountId}
              account={a}
              data={hub[a.accountId]}
              max={laneMax}
              selected={sel === a.accountId}
              onSelect={() => setSel(a.accountId)}
            />
          ))}
          <button className="gx-add" type="button">
            <span aria-hidden="true">+</span>
            Connect another GitHub account
          </button>
        </section>
        <nav className="gx-views" aria-label="Account views">
          {[
            ["overview", "Overview"],
            ["repos", "Repositories"],
          ].map(([k, l]) => (
            <button key={k} type="button" className={`gx-view${view === k ? " on" : ""}`} onClick={() => setView(k)}>
              {l}
            </button>
          ))}
        </nav>
        {cur?.error ? <p className="admin-err">{cur.error}</p> : null}
        {view === "overview" && cur?.profile ? (
          <Overview
            key={sel}
            accountId={sel}
            profile={cur.profile}
            analytics={cur.analytics}
            repos={cur.repos}
            trafficRows={TRAFFIC}
          />
        ) : null}
        {view === "repos" ? <Repositories data={hub} accounts={ACCOUNTS.slice(0, 2)} sel={sel === "old-handle" ? "Ravikisha" : sel} /> : null}
        <HubStyles />
      </div>

      <h2 style={{ color: "#8b90a0", font: "500 13px Inter", margin: "48px 0 16px" }}>Fix up</h2>
      <div className="ops-head gh-head">
        <div>
          <h3>GitHub</h3>
          <p className="admin-sub gh-sub">
            Everything here saves straight to GitHub. A README change is a real commit.
          </p>
        </div>
        <span className="gh-actions">
          <button className="admin-ghost" type="button">
            New repository
          </button>
          <button className="admin-ghost" type="button">
            Refresh
          </button>
        </span>
      </div>

      <ProfileCard profile={profile} busy={false} onSave={(patch) => setProfile({ ...profile, ...patch })} />

      <AuditLine audit={audit} repos={repos} hasReadmes={false} onCheck={() => {}} busy={false} />

      <div className="gh-filters">
        <div className="gh-chips" role="group" aria-label="Which repositories to show">
          {[
            ["attention", `Needs attention (${audit.repos})`],
            ["all", `All (${repos.length})`],
            ["archived", `Archived (${repos.filter((r) => r.archived).length})`],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`gh-chip${filter === k ? " on" : ""}`}
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <input className="admin-input gh-search" placeholder="Search name, description or topic" readOnly />
      </div>

      <div className="gh-list">
        {shown.length === 0 ? (
          <p className="gh-none">
            Nothing needs attention. Every repository has a description and topics.
          </p>
        ) : null}
        {shown.map((r) => (
          <RepoRow
            key={r.name}
            repo={r}
            findings={audit.byRepo[r.name] || []}
            expanded={open === r.name}
            busy={false}
            owner={r.owner}
            onToggle={() => setOpen(open === r.name ? null : r.name)}
            onSave={(patch) =>
              setRepos((rs) => rs.map((x) => (x.name === r.name ? { ...x, ...patch } : x)))
            }
            onSaveReadme={() => {}}
          />
        ))}
      </div>

      <GithubStyles />
      {/* The panel borrows the admin's shared controls. */}
      <style jsx global>{`
        .admin-input {
          width: 100%;
          background: var(--a-void, #0d0e13);
          border: 1px solid var(--a-line, #2b3040);
          border-radius: 9px;
          color: var(--a-text, #e7e8ee);
          padding: 10px 12px;
          font: inherit;
          font-size: 13px;
        }
        .admin-input:focus {
          outline: none;
          border-color: var(--a-amber, #ffb020);
        }
        .admin-primary {
          background: var(--a-amber, #ffb020);
          color: #1a1300;
          border: none;
          border-radius: 9px;
          padding: 9px 14px;
          font: inherit;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        }
        .admin-ghost {
          background: none;
          border: 1px solid var(--a-line, #2b3040);
          border-radius: 9px;
          color: var(--a-text, #e7e8ee);
          padding: 9px 14px;
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }
        .admin-sub {
          color: var(--a-dim, #8b90a0);
          font-size: 12.5px;
          font-weight: 400;
        }
        .ops-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .ops-head h3 {
          margin: 0;
          font-size: 15px;
          color: #e7e8ee;
          font-family: "Space Grotesk", sans-serif;
        }
        body {
          margin: 0;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        }
      `}</style>
    </main>
  );
}

// Dev-only: a design tool, not a page.
export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
