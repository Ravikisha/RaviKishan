// SERVER ONLY. "How did it do" for the accounts that can answer it.
//
// Google Analytics already has its own module because it is a whole product
// with its own vocabulary. This one holds the other two that report —
// YouTube and Instagram — because they are small, and because the thing they
// share is more interesting than the thing they differ on: both answer a
// window of days with a handful of numbers, and both are useless without the
// same window immediately before it to compare against.
//
// So the same three rules as lib/server/googleAnalytics.js apply, for the same
// reasons, and they are the reason this is a module rather than two inline
// fetches:
//
//   1. Every number comes back with a DIRECTION. A bare 412 is good or bad
//      only against what it was.
//   2. The date window is pinned to explicit YYYY-MM-DD at the edge. Relative
//      strings are resolved by the provider in a timezone this code does not
//      know, and a comparison computed in UTC against one of those is quietly
//      a day out.
//   3. The vocabulary is SMALL and an unknown field is refused WITH THE LIST.
//      Both APIs expose dozens of metrics; offering all of them to a model
//      invites a report that spends quota and answers nothing.
import { concreteRange, previousRange, resolveRange } from "./googleAnalytics.js";

export class InsightsError extends Error {
  constructor(message, { status = 400, code = "" } = {}) {
    super(message);
    this.name = "InsightsError";
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ *
 * YouTube                                                             *
 * ------------------------------------------------------------------ */

const YT_API = "https://youtubeanalytics.googleapis.com/v2/reports";

// Channel-level metrics that answer a question anyone actually asks. The ones
// left out are not missing by accident: card and annotation metrics describe
// features YouTube has retired, and the revenue family needs a monetised
// channel and its own scope.
export const YT_METRICS = {
  views: "Views",
  estimatedMinutesWatched: "Minutes watched",
  averageViewDuration: "Average view length (seconds)",
  averageViewPercentage: "Average percent watched",
  subscribersGained: "Subscribers gained",
  subscribersLost: "Subscribers lost",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
};

export const YT_DIMENSIONS = {
  day: "By day",
  video: "By video",
  country: "By country",
  insightTrafficSourceType: "How they found it",
  deviceType: "Device",
};

const YT_DEFAULT = ["views", "estimatedMinutesWatched", "averageViewDuration", "subscribersGained"];

function assertYouTubeFields(metrics, dimensions) {
  const badM = metrics.filter((m) => !YT_METRICS[m]);
  if (badM.length) {
    throw new InsightsError(
      `Unknown YouTube metric${badM.length > 1 ? "s" : ""}: ${badM.join(", ")}. Available: ${Object.keys(
        YT_METRICS
      ).join(", ")}.`
    );
  }
  const badD = (dimensions || []).filter((d) => !YT_DIMENSIONS[d]);
  if (badD.length) {
    throw new InsightsError(
      `Unknown YouTube dimension${badD.length > 1 ? "s" : ""}: ${badD.join(", ")}. Available: ${Object.keys(
        YT_DIMENSIONS
      ).join(", ")}.`
    );
  }
}

async function ytCall(token, params) {
  const res = await fetch(`${YT_API}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json?.error?.message || `HTTP ${res.status}`;
    // The commonest failure by far, and the least self-explanatory: a channel
    // connected before yt-analytics.readonly was requested holds a token that
    // works for everything else and 403s only here.
    if (res.status === 403 && /insufficient|scope|permission/i.test(reason)) {
      throw new InsightsError(
        `This YouTube connection does not carry the analytics permission (yt-analytics.readonly). Reconnect the channel in Accounts to add it — everything else keeps working meanwhile. YouTube said: ${reason}`,
        { status: 403, code: "insights/missing-scope" }
      );
    }
    throw new InsightsError(`YouTube Analytics refused that: ${reason}`, { status: res.status });
  }
  return json;
}

// YouTube Analytics returns column headers and raw rows, with every value
// already a number — unlike GA4, which returns strings. Shaping it here means
// no caller has to know which of the two it is talking to.
function shapeYt(res, { metrics, dimensions }) {
  const headers = (res.columnHeaders || []).map((h) => h.name);
  const rows = (res.rows || []).map((r) => {
    const row = {};
    headers.forEach((name, i) => {
      row[name] = r[i];
    });
    return row;
  });
  const totals = {};
  for (const m of metrics) {
    // With no dimension YouTube returns exactly one row, and that row IS the
    // total. With a dimension there is no totals row at all, so the rows are
    // summed — correct for a count, and deliberately not offered for an
    // average, which cannot be summed.
    if (!dimensions?.length) totals[m] = rows[0]?.[m] ?? 0;
    else if (/^average/.test(m)) totals[m] = null;
    else totals[m] = rows.reduce((n, r) => n + (Number(r[m]) || 0), 0);
  }
  return { rows, totals, rowCount: rows.length };
}

export async function youtubeReport(
  token,
  { range = "28d", startDate, endDate, metrics = YT_DEFAULT, dimensions = [], limit = 10 } = {}
) {
  assertYouTubeFields(metrics, dimensions);
  const window = concreteRange(resolveRange(range, startDate, endDate));
  const params = {
    ids: "channel==MINE",
    startDate: window.startDate,
    endDate: window.endDate,
    metrics: metrics.join(","),
  };
  if (dimensions.length) {
    params.dimensions = dimensions.join(",");
    params.sort = `-${metrics[0]}`;
    params.maxResults = String(Math.min(200, Math.max(1, limit)));
  }
  const res = await ytCall(token, params);
  return { dateRange: window, ...shapeYt(res, { metrics, dimensions }) };
}

export async function youtubeSummary(token, { range = "28d", startDate, endDate } = {}) {
  const now = concreteRange(resolveRange(range, startDate, endDate));
  const prev = previousRange(now);
  const [a, b] = await Promise.all([
    youtubeReport(token, { ...now, metrics: YT_DEFAULT }),
    youtubeReport(token, { startDate: prev.startDate, endDate: prev.endDate, metrics: YT_DEFAULT }),
  ]);
  return {
    dateRange: now,
    previous: { startDate: prev.startDate, endDate: prev.endDate },
    change: compare(YT_DEFAULT, a.totals, b.totals),
  };
}

/* ------------------------------------------------------------------ *
 * Instagram                                                           *
 * ------------------------------------------------------------------ */

const IG_API = "https://graph.instagram.com/v21.0";

// Instagram splits its metrics into two shapes and refuses a request that
// mixes them, which is the single most confusing thing about this API: a
// time-series metric takes `period`, and a total-value metric takes
// `metric_type=total_value` and no period. Asking for both together returns a
// validation error that names neither.
export const IG_METRICS = {
  reach: { label: "Reach", shape: "total" },
  accounts_engaged: { label: "Accounts engaged", shape: "total" },
  total_interactions: { label: "Interactions", shape: "total" },
  likes: { label: "Likes", shape: "total" },
  comments: { label: "Comments", shape: "total" },
  saves: { label: "Saves", shape: "total" },
  shares: { label: "Shares", shape: "total" },
  profile_views: { label: "Profile views", shape: "total" },
  views: { label: "Views", shape: "total" },
};

const IG_DEFAULT = ["reach", "accounts_engaged", "total_interactions", "profile_views"];

async function igCall(token, path, params) {
  const url = `${IG_API}/${path}?${new URLSearchParams({ ...params, access_token: token })}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json?.error?.message || `HTTP ${res.status}`;
    if (/permission|scope|insights/i.test(reason) && res.status === 403) {
      throw new InsightsError(
        `This Instagram connection does not carry the insights permission (instagram_business_manage_insights). Reconnect the account in Accounts to add it. Instagram said: ${reason}`,
        { status: 403, code: "insights/missing-scope" }
      );
    }
    throw new InsightsError(`Instagram refused that: ${reason}`, { status: res.status });
  }
  return json;
}

// Instagram's insights window is bounded: it refuses a range longer than 30
// days outright, and holds nothing older than about two years. Saying so up
// front beats an error that names neither limit.
const IG_MAX_DAYS = 30;

export async function instagramSummary(
  token,
  igUserId,
  { range = "28d", startDate, endDate, metrics = IG_DEFAULT } = {}
) {
  const bad = metrics.filter((m) => !IG_METRICS[m]);
  if (bad.length) {
    throw new InsightsError(
      `Unknown Instagram metric${bad.length > 1 ? "s" : ""}: ${bad.join(", ")}. Available: ${Object.keys(
        IG_METRICS
      ).join(", ")}.`
    );
  }
  const now = concreteRange(resolveRange(range, startDate, endDate));
  const days = Math.round((Date.parse(now.endDate) - Date.parse(now.startDate)) / 86400000) + 1;
  if (days > IG_MAX_DAYS) {
    throw new InsightsError(
      `Instagram answers at most ${IG_MAX_DAYS} days at a time, and this asks for ${days}. Use a shorter window.`,
      { code: "insights/window-too-long" }
    );
  }
  const prev = previousRange(now);

  const read = async (w) => {
    const json = await igCall(token, `${igUserId}/insights`, {
      metric: metrics.join(","),
      metric_type: "total_value",
      since: String(Math.floor(Date.parse(`${w.startDate}T00:00:00Z`) / 1000)),
      until: String(Math.floor(Date.parse(`${w.endDate}T23:59:59Z`) / 1000)),
    });
    const out = {};
    for (const row of json.data || []) {
      out[row.name] = Number(row.total_value?.value ?? 0);
    }
    // A metric the account is not eligible for simply does not come back.
    // Reporting it as 0 would read as "nobody did this".
    for (const m of metrics) if (!(m in out)) out[m] = null;
    return out;
  };

  const [a, b] = await Promise.all([read(now), read(prev)]);
  return {
    dateRange: now,
    previous: { startDate: prev.startDate, endDate: prev.endDate },
    change: compare(metrics, a, b),
    unavailable: metrics.filter((m) => a[m] === null),
  };
}

// Per-post numbers. The account summary says how the week went; this says
// which post caused it, which is the question that follows every time.
export async function instagramTopMedia(token, { max = 10 } = {}) {
  const list = await igCall(token, "me/media", {
    fields: "id,caption,media_type,permalink,timestamp",
    limit: String(Math.min(50, Math.max(1, max))),
  });
  const items = list.data || [];
  const out = [];
  for (const item of items) {
    let insights = {};
    try {
      const got = await igCall(token, `${item.id}/insights`, {
        metric: "reach,likes,comments,saved,shares",
      });
      for (const row of got.data || []) {
        insights[row.name] = Number(row.values?.[0]?.value ?? row.total_value?.value ?? 0);
      }
    } catch (_) {
      // A story older than 24 hours, or a media type with no insights, is not
      // a failure of the report — it is one row with no numbers.
      insights = {};
    }
    out.push({
      id: item.id,
      caption: (item.caption || "").slice(0, 120),
      type: item.media_type,
      url: item.permalink,
      postedAt: item.timestamp,
      ...insights,
    });
  }
  return { count: out.length, media: out.sort((x, y) => (y.reach || 0) - (x.reach || 0)) };
}

/* ------------------------------------------------------------------ *
 * GitHub                                                              *
 * ------------------------------------------------------------------ */

// GitHub keeps traffic for FOURTEEN DAYS and no longer. There is no range
// parameter and no history endpoint, so a comparison window is only possible
// inside that fortnight: the last seven days against the seven before them.
// Anything else would be invented.
export async function githubTraffic(token, owner, repo) {
  const get = async (what) => {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/traffic/${what}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Traffic needs push access to the repository. A token with public_repo
      // on somebody else's repo gets a 403 that says "Resource not accessible",
      // which sounds like the repo is missing.
      if (res.status === 403) {
        throw new InsightsError(
          `GitHub traffic is only readable by someone with push access to ${owner}/${repo}. GitHub said: ${
            json?.message || "forbidden"
          }`,
          { status: 403, code: "insights/not-owner" }
        );
      }
      throw new InsightsError(`GitHub refused that: ${json?.message || `HTTP ${res.status}`}`, {
        status: res.status,
      });
    }
    return json;
  };

  const [views, clones] = await Promise.all([get("views"), get("clones")]);
  const half = (days) => {
    const sorted = [...(days || [])].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const recent = sorted.slice(-7);
    const older = sorted.slice(-14, -7);
    const sum = (rows, k) => rows.reduce((n, r) => n + (r[k] || 0), 0);
    return {
      now: { count: sum(recent, "count"), uniques: sum(recent, "uniques") },
      before: { count: sum(older, "count"), uniques: sum(older, "uniques") },
    };
  };

  const v = half(views.views);
  const c = half(clones.clones);
  return {
    repo: `${owner}/${repo}`,
    window: "the last 7 days against the 7 before",
    note: "GitHub keeps only 14 days of traffic, so this is the whole history there is.",
    change: compare(["views", "uniqueVisitors", "clones", "uniqueCloners"], {
      views: v.now.count,
      uniqueVisitors: v.now.uniques,
      clones: c.now.count,
      uniqueCloners: c.now.uniques,
    }, {
      views: v.before.count,
      uniqueVisitors: v.before.uniques,
      clones: c.before.count,
      uniqueCloners: c.before.uniques,
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Shared                                                              *
 * ------------------------------------------------------------------ */

// Every number against the same number in the window before it. A change from
// a zero baseline is null, not infinity — the panel renders that as "new",
// which is what it means; a percentage there reads as a bug.
export function compare(metrics, now, before) {
  const out = {};
  for (const m of metrics) {
    const is = now?.[m] ?? null;
    const was = before?.[m] ?? null;
    out[m] = {
      now: is,
      before: was,
      delta:
        is === null || was === null || was === 0
          ? null
          : Math.round(((is - was) / was) * 1000) / 10,
    };
  }
  return out;
}

// What each service can report, as DATA, so the panel and the MCP tools cannot
// describe the same limitation two different ways.
export const INSIGHTS = {
  siteAnalytics: {
    service: "siteAnalytics",
    label: "Site analytics",
    available: true,
    note: "Google Analytics 4. Visitors, pages and sources, with a comparison window.",
  },
  video: {
    service: "video",
    label: "YouTube",
    available: true,
    note: "Channel reporting: views, watch time, subscribers, and the same by video.",
    needsScope: "yt-analytics.readonly",
  },
  photos: {
    service: "photos",
    label: "Instagram",
    available: true,
    note: "Reach, engagement and profile views, plus per-post numbers. Professional accounts only, and at most 30 days at a time.",
    needsScope: "instagram_business_manage_insights",
  },
  posts: {
    service: "posts",
    label: "X",
    available: false,
    why: "X closed its free API tier on 6 February 2026, and post metrics sit behind a paid plan.",
    instead: "Read them in the X app, or add a paid plan and connect it here.",
  },
  professional: {
    service: "professional",
    label: "LinkedIn",
    available: false,
    why: "Reading a member's own post analytics needs r_member_social, which is partner-only.",
    instead: "LinkedIn shows them on the post itself.",
  },
  code: {
    service: "code",
    label: "GitHub",
    available: true,
    note: "Repository traffic: views and clones for the last 14 days, which is all GitHub keeps.",
  },
};
