// Which repositories are letting the profile down.
//
// PURE — no imports, no network, no node APIs — because three places need it
// and a second copy would drift within a week. It already did: the panel's copy
// grew `byRepo` and `repos` while the server's did not, so the count on screen
// and the count a tool returned came from different code. Now the admin panel,
// the MCP `audit_github_repos` tool and `npm run test:github` all evaluate this
// one function.
//
// It lives under lib/server for the same reason lib/server/postText.js does:
// that is the one folder marked ESM, so plain node can import it without a
// module-type warning, which is what makes it testable without a bundler.
// lib/github.js re-exports it for the browser.
//
// Every rule is something GitHub search or a visitor actually reacts to, not a
// style preference:
//   - a repository with no description is invisible in GitHub search and shows
//     a blank line on the profile
//   - with no topics it cannot be found by subject, only by name
//   - a well-starred one with no homepage wastes the only traffic it gets
//   - a missing or stub README leaves the repository page empty below the files
//
// Archived repositories are skipped. They are finished work, and nagging about
// a finished thing is how you train yourself to ignore the whole list.
export function auditRepos(repos, { readmes = {} } = {}) {
  const findings = [];
  const add = (repo, issue, why) =>
    findings.push({ repo: repo.name, issue, why, url: repo.url || "" });

  for (const r of repos) {
    if (r.archived) continue;

    const description = String(r.description || "").trim();
    if (!description) {
      add(r, "no description", "GitHub search ranks on it, and the profile shows a blank line.");
    } else if (description.length > 350) {
      add(r, "description too long", `${description.length} characters; GitHub caps it at 350.`);
    }

    if (!(r.topics || []).length) {
      add(r, "no topics", "Topics are how a repository is found by subject rather than by name.");
    }

    if (r.stars >= 5 && !String(r.homepage || "").trim()) {
      add(r, "no homepage link", `${r.stars} stars and nothing pointing back at the site.`);
    }

    // `null` means the README was fetched and is not there. `undefined` means
    // it was never fetched, which must stay silent — otherwise simply opening
    // the panel reports every repository as missing one.
    const readme = readmes[r.name];
    if (readme === null) {
      add(r, "no README", "The repository page is empty below the file list.");
    } else if (typeof readme === "string" && readme.trim().length < 200) {
      add(r, "thin README", `${readme.trim().length} characters — too short to explain what this is.`);
    }
  }

  const byRepo = {};
  for (const f of findings) (byRepo[f.repo] ||= []).push(f);
  const byIssue = {};
  for (const f of findings) byIssue[f.issue] = (byIssue[f.issue] || 0) + 1;

  return {
    count: findings.length,
    // Repositories needing attention, which is what the panel counts — not the
    // number of findings, which is always larger and reads as worse than it is.
    repos: Object.keys(byRepo).length,
    byIssue,
    byRepo,
    findings,
  };
}
