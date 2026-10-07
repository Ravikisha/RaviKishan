// PURE. What a GitHub account has been doing, computed from what GitHub
// returns — shared by the admin's GitHub page, the MCP tools and
// `npm run test:github`, so the number on screen and the number a tool
// reports cannot come from two implementations. (There were briefly two
// copies of auditRepos; they drifted inside an hour.)
//
// No I/O here. The browser and the server each fetch with their own token and
// hand the raw payloads to these functions. It lives in lib/server only
// because that folder is the one marked ESM, so plain node can import it.

/* ---------------- the profile ---------------- */

// The authenticated /user carries more than the public profile: private repo
// counts, disk usage, plan and 2FA are only visible to the account itself,
// which is exactly who is asking. One shape for the page and the tools.
export const shapeViewer = (u) => ({
  login: u.login,
  id: u.id,
  name: u.name || "",
  bio: u.bio || "",
  blog: u.blog || "",
  company: u.company || "",
  location: u.location || "",
  email: u.email || "",
  twitter: u.twitter_username || "",
  hireable: !!u.hireable,
  avatar: u.avatar_url,
  publicRepos: u.public_repos,
  privateRepos: u.owned_private_repos ?? u.total_private_repos ?? null,
  publicGists: u.public_gists,
  privateGists: u.private_gists ?? null,
  followers: u.followers,
  following: u.following,
  createdAt: u.created_at,
  diskUsageKb: u.disk_usage ?? null,
  plan: u.plan?.name || "",
  twoFactor: typeof u.two_factor_authentication === "boolean" ? u.two_factor_authentication : null,
  url: u.html_url,
});

/* ---------------- the one GraphQL query ---------------- */

// One request per account answers everything the overview shows that REST
// cannot in one go: the contribution calendar (there is no REST endpoint for
// it at all), the language mix across repositories, organisations, and the
// follower / star / gist totals. Exported so both callers send the SAME query.
//
// `contributionsCollection` refuses a range longer than a year, which is why
// the window is exactly 365 days and not "the last 12 months" by calendar.
export const ANALYTICS_QUERY = `query($from: DateTime!, $to: DateTime!) {
  viewer {
    login name avatarUrl url createdAt
    followers { totalCount }
    following { totalCount }
    starredRepositories { totalCount }
    gists { totalCount }
    organizations(first: 20) { nodes { login name avatarUrl url } }
    repositories(ownerAffiliations: OWNER, first: 100, orderBy: { field: PUSHED_AT, direction: DESC }) {
      totalCount
      nodes {
        name isFork isPrivate isArchived stargazerCount
        languages(first: 8, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalIssueContributions
      totalRepositoryContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount weekday } }
      }
    }
  }
}`;

export const analyticsVariables = (now = new Date()) => {
  const to = new Date(now);
  const from = new Date(now.getTime() - 364 * DAY);
  return { from: from.toISOString(), to: to.toISOString() };
};

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ---------------- the calendar ---------------- */

// Every number arrives with a direction, the rule the Google Analytics and
// social insights already follow: "212 contributions" says nothing until it
// is set against the 30 days before. A change against zero is null, rendered
// as "new", never as Infinity.
export function changeOf(now, before) {
  if (!before) return now ? null : 0;
  return Math.round(((now - before) / before) * 100);
}

// `today` is a YYYY-MM-DD string so a test can pin it. GitHub's calendar days
// are dates in the account's own timezone; comparing strings rather than Date
// objects keeps a day from slipping across midnight UTC.
export function summariseCalendar(weeks, today = new Date().toISOString().slice(0, 10)) {
  const days = (weeks || [])
    .flatMap((w) => w.contributionDays || [])
    .filter((d) => d.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const sum = (rows) => rows.reduce((n, d) => n + (d.contributionCount || 0), 0);
  const last30 = days.slice(-30);
  const prev30 = days.slice(-60, -30);

  // A streak still counts if today is blank so far — the day is not over, and
  // a streak that "breaks" every morning until the first commit is a streak
  // nobody believes.
  let current = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i].date === today && !days[i].contributionCount) i--;
  for (; i >= 0 && days[i].contributionCount > 0; i--) current++;

  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    if (run > longest) longest = run;
  }

  const byWeekday = Array(7).fill(0);
  for (const d of days) byWeekday[new Date(`${d.date}T00:00:00Z`).getUTCDay()] += d.contributionCount || 0;
  const peak = Math.max(...byWeekday);

  // Weekly totals for the lane strip: 52-ish bars, one per calendar week.
  const weekly = (weeks || []).map((w) =>
    (w.contributionDays || []).filter((d) => d.date <= today).reduce((n, d) => n + d.contributionCount, 0)
  );

  return {
    total: sum(days),
    activeDays: days.filter((d) => d.contributionCount > 0).length,
    last30: sum(last30),
    prev30: sum(prev30),
    change30: changeOf(sum(last30), sum(prev30)),
    streak: { current, longest },
    busiestWeekday: peak > 0 ? WEEKDAYS[byWeekday.indexOf(peak)] : "",
    byWeekday,
    weekly,
    days,
  };
}

// Five steps, for the calendar's shading. Quantiles of the NON-ZERO days
// rather than fixed thresholds: an account with a busy week of 40 and one
// with a busy week of 4 should both show a busy week.
export function levelsFor(days) {
  const vals = days.map((d) => d.contributionCount).filter((n) => n > 0).sort((a, b) => a - b);
  if (!vals.length) return () => 0;
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const max = vals[vals.length - 1];
  // The busiest day is always the darkest step — with few active days the
  // quantiles collapse onto it, and the peak would otherwise read as average.
  return (n) =>
    n <= 0 ? 0 : n >= max ? 4 : n <= cuts[0] ? 1 : n <= cuts[1] ? 2 : n <= cuts[2] ? 3 : 4;
}

/* ---------------- languages ---------------- */

// By BYTES across repositories, not by "primary language" counts. Counting
// primaries says a portfolio of thirty tiny JavaScript demos and one large
// Rust runtime is 97% JavaScript, which is exactly the wrong story.
// Forks are excluded — they are somebody else's code.
export function languageShare(repoNodes, { top = 6 } = {}) {
  const bytes = new Map();
  const colours = new Map();
  for (const r of repoNodes || []) {
    if (r.isFork) continue;
    for (const e of r.languages?.edges || []) {
      const name = e.node?.name;
      if (!name) continue;
      bytes.set(name, (bytes.get(name) || 0) + (e.size || 0));
      if (e.node.color) colours.set(name, e.node.color);
    }
  }
  const total = [...bytes.values()].reduce((a, b) => a + b, 0);
  if (!total) return { total: 0, languages: [] };
  const sorted = [...bytes.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, top).map(([name, size]) => ({
    name,
    bytes: size,
    share: size / total,
    color: colours.get(name) || "",
  }));
  const rest = sorted.slice(top).reduce((n, [, s]) => n + s, 0);
  if (rest) head.push({ name: "Other", bytes: rest, share: rest / total, color: "" });
  return { total, languages: head };
}

/* ---------------- one shape for the overview ---------------- */

export function shapeAnalytics(viewer, today) {
  const cc = viewer?.contributionsCollection || {};
  const cal = summariseCalendar(cc.contributionCalendar?.weeks || [], today);
  const nodes = viewer?.repositories?.nodes || [];
  return {
    login: viewer?.login || "",
    followers: viewer?.followers?.totalCount ?? 0,
    following: viewer?.following?.totalCount ?? 0,
    starred: viewer?.starredRepositories?.totalCount ?? 0,
    gists: viewer?.gists?.totalCount ?? 0,
    organizations: (viewer?.organizations?.nodes || []).map((o) => ({
      login: o.login,
      name: o.name || o.login,
      avatar: o.avatarUrl,
      url: o.url,
    })),
    repoCount: viewer?.repositories?.totalCount ?? 0,
    // The language mix reads the 100 most recently pushed repositories; past
    // that the query would need paging for a long tail that does not move it.
    languagesSampled: nodes.length,
    languages: languageShare(nodes).languages,
    contributions: {
      total: cc.contributionCalendar?.totalContributions ?? cal.total,
      commits: cc.totalCommitContributions || 0,
      pullRequests: cc.totalPullRequestContributions || 0,
      reviews: cc.totalPullRequestReviewContributions || 0,
      issues: cc.totalIssueContributions || 0,
      newRepositories: cc.totalRepositoryContributions || 0,
      // Contributions to private repositories the viewer cannot see in
      // detail. GitHub counts them in the total and names nothing else.
      private: cc.restrictedContributionsCount || 0,
    },
    calendar: cal,
  };
}

/* ---------------- which repositories to show ---------------- */

export const SORTS = {
  pushed: "Recently changed",
  stars: "Most starred",
  forks: "Most forked",
  created: "Newest",
};

export const WINDOWS = {
  all: { label: "Any time", days: 0 },
  "7d": { label: "Past week", days: 7 },
  "30d": { label: "Past month", days: 30 },
  "90d": { label: "Past 3 months", days: 90 },
  "365d": { label: "Past year", days: 365 },
};

// The window filters on when a repository last CHANGED (pushedAt), whatever
// the sort — "most starred, changed this month" is the question, and a window
// that silently switched meaning per sort would not be.
//
// Unknown sort or window names are refused with the list, the same rule as the
// analytics vocabularies: a typo should not quietly return everything.
export function rankRepos(
  repos,
  {
    sort = "pushed",
    window = "all",
    language = "",
    includeForks = false,
    includeArchived = false,
    visibility = "all",
    q = "",
    limit = 0,
    now = Date.now(),
  } = {}
) {
  if (!SORTS[sort]) throw new Error(`Unknown sort "${sort}". Use one of: ${Object.keys(SORTS).join(", ")}.`);
  if (!WINDOWS[window]) {
    throw new Error(`Unknown window "${window}". Use one of: ${Object.keys(WINDOWS).join(", ")}.`);
  }
  if (!["all", "public", "private"].includes(visibility)) {
    throw new Error(`Unknown visibility "${visibility}". Use all, public or private.`);
  }
  const since = WINDOWS[window].days ? now - WINDOWS[window].days * DAY : 0;
  const term = String(q || "").trim().toLowerCase();
  const lang = String(language || "").toLowerCase();

  const list = (repos || []).filter((r) => {
    if (!includeForks && r.isFork) return false;
    if (!includeArchived && r.archived) return false;
    if (visibility === "public" && r.private) return false;
    if (visibility === "private" && !r.private) return false;
    if (lang && String(r.language || "").toLowerCase() !== lang) return false;
    if (since && !(Date.parse(r.pushedAt) >= since)) return false;
    if (term) {
      const hay = `${r.name} ${r.description || ""} ${(r.topics || []).join(" ")}`.toLowerCase();
      if (!term.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });

  const time = (s) => Date.parse(s) || 0;
  const by = {
    pushed: (a, b) => time(b.pushedAt) - time(a.pushedAt),
    created: (a, b) => time(b.createdAt) - time(a.createdAt),
    // Ties broken by recency, so equal-starred repositories do not shuffle
    // between loads.
    stars: (a, b) => (b.stars || 0) - (a.stars || 0) || time(b.pushedAt) - time(a.pushedAt),
    forks: (a, b) => (b.forks || 0) - (a.forks || 0) || time(b.pushedAt) - time(a.pushedAt),
  }[sort];

  const sorted = list.sort(by);
  return limit > 0 ? sorted.slice(0, limit) : sorted;
}

// "3 days ago", for a row. Coarse on purpose — a repository list is read for
// "is this alive", not for the minute.
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!t) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 3600) {
    const m = Math.max(1, Math.round(s / 60));
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (s < 86400) {
    const h = Math.round(s / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.round(s / 86400);
  if (d < 31) return d === 1 ? "yesterday" : `${d} days ago`;
  const m = Math.round(d / 30.4);
  if (m < 12) return m === 1 ? "a month ago" : `${m} months ago`;
  const y = Math.round(d / 365);
  return y === 1 ? "a year ago" : `${y} years ago`;
}

export function repoTotals(repos) {
  const own = (repos || []).filter((r) => !r.isFork);
  return {
    repos: own.length,
    publicRepos: own.filter((r) => !r.private).length,
    privateRepos: own.filter((r) => r.private).length,
    forks: (repos || []).length - own.length,
    stars: own.reduce((n, r) => n + (r.stars || 0), 0),
    forksReceived: own.reduce((n, r) => n + (r.forks || 0), 0),
    languages: [...new Set(own.map((r) => r.language).filter(Boolean))].sort(),
  };
}
