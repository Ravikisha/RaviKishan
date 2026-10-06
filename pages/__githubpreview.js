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
} from "../components/admin/GithubPanel";
import { auditRepos } from "../lib/github";

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

  return (
    <main
      className="admin-main gh-main"
      style={{ background: "#08090d", minHeight: "100vh", padding: "88px 24px 24px" }}
    >
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
