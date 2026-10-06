// SERVER ONLY. Google Analytics 4 — the Admin API to find properties, the
// Data API to report on them.
//
// GA4 ONLY. Universal Analytics stopped collecting in July 2023 and its data
// was deleted in July 2024, so a `UA-` id has nothing behind it. Anything that
// looks like one is refused by name rather than returning an empty report,
// which is what the API itself would do.
//
// Held READ-ONLY on purpose. The scope requested is `analytics.readonly`, so
// nothing here — or in any tool built on it — can edit a property, change a
// data stream or delete an account. A reporting section does not need write
// access, and the cheapest way to guarantee it never does something it should
// not is to never hold the credential that could.
//
// The quota worth knowing: the Data API is bounded per property per day in
// "tokens", and a report costs more the more dimensions it asks for. Reports
// here are deliberately narrow — a handful of dimensions, a bounded row limit —
// rather than fetching everything and filtering in the browser.
const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";

export class AnalyticsError extends Error {
  constructor(message, { status, reason } = {}) {
    super(message);
    this.name = "AnalyticsError";
    this.status = status;
    this.reason = reason;
  }
}

async function call(token, url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    throw new AnalyticsError(
      "Google rejected the connection. Reconnect the account in the admin's Analytics tab.",
      { status: 401 }
    );
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let reason = "";
    try {
      const j = await res.json();
      msg = j?.error?.message || msg;
      reason = j?.error?.status || "";
    } catch (_) {}
    if (res.status === 403 && /Analytics Admin API|analyticsadmin|analyticsdata/i.test(msg)) {
      throw new AnalyticsError(
        `${msg} — enable the Google Analytics Admin API and the Google Analytics Data API for this Cloud project.`,
        { status: 403, reason }
      );
    }
    if (res.status === 429 || reason === "RESOURCE_EXHAUSTED") {
      throw new AnalyticsError(
        "Google Analytics quota is spent for this property. It is bounded per property per day and a wide report costs more than a narrow one.",
        { status: 429, reason }
      );
    }
    throw new AnalyticsError(`Google Analytics: ${msg}`, { status: res.status, reason });
  }
  return res.json();
}

/* ---------------- properties ---------------- */

export const UA_RE = /^UA-\d+-\d+$/i;

// Accepts "properties/123", "123" or a bare number, and refuses a Universal
// Analytics id by name — the API would answer with an unhelpful 400, and the
// real answer is that the data no longer exists anywhere.
export function propertyPath(id) {
  const raw = String(id || "").trim();
  if (!raw) throw new AnalyticsError("A property id is required.");
  if (UA_RE.test(raw)) {
    throw new AnalyticsError(
      `"${raw}" is a Universal Analytics id. UA stopped collecting in July 2023 and its data was deleted in July 2024 — there is nothing behind it. Use the GA4 property id, which is numeric.`
    );
  }
  const n = raw.startsWith("properties/") ? raw.slice("properties/".length) : raw;
  if (!/^\d+$/.test(n)) {
    throw new AnalyticsError(`"${raw}" is not a GA4 property id. They are numeric, like 123456789.`);
  }
  return `properties/${n}`;
}

// One call gives every account AND every property under it, which is exactly
// the "which projects do I have" question. properties.list would need an
// account filter and a call per account.
export async function listProperties(token) {
  const out = [];
  let pageToken = "";
  for (let i = 0; i < 10; i++) {
    const url = `${ADMIN}/accountSummaries?pageSize=200${
      pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""
    }`;
    const page = await call(token, url);
    for (const acc of page.accountSummaries || []) {
      for (const p of acc.propertySummaries || []) {
        out.push({
          // "properties/123" -> "123", which is what a report needs.
          id: String(p.property || "").replace("properties/", ""),
          name: p.displayName || "",
          account: acc.displayName || "",
          accountId: String(acc.account || "").replace("accounts/", ""),
          type: p.propertyType || "",
          canEdit: !!p.canEdit,
        });
      }
    }
    pageToken = page.nextPageToken || "";
    if (!pageToken) break;
  }
  return out.sort((a, b) => a.account.localeCompare(b.account) || a.name.localeCompare(b.name));
}

/* ---------------- date ranges ---------------- */

// GA4 accepts NdaysAgo / yesterday / today as well as YYYY-MM-DD. Named ranges
// are resolved here so the caller gets one vocabulary and a report cannot be
// asked for a window that means something different to each side.
export const RANGES = {
  today: { startDate: "today", endDate: "today" },
  yesterday: { startDate: "yesterday", endDate: "yesterday" },
  "7d": { startDate: "7daysAgo", endDate: "yesterday" },
  "28d": { startDate: "28daysAgo", endDate: "yesterday" },
  "90d": { startDate: "90daysAgo", endDate: "yesterday" },
  "365d": { startDate: "365daysAgo", endDate: "yesterday" },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function resolveRange(range, startDate, endDate) {
  if (startDate || endDate) {
    if (!DATE_RE.test(String(startDate)) || !DATE_RE.test(String(endDate))) {
      throw new AnalyticsError("startDate and endDate must both be YYYY-MM-DD.");
    }
    if (startDate > endDate) {
      throw new AnalyticsError(`startDate ${startDate} is after endDate ${endDate}.`);
    }
    return { startDate, endDate };
  }
  const r = RANGES[String(range || "28d")];
  if (!r) {
    throw new AnalyticsError(
      `Unknown range "${range}". Use one of ${Object.keys(RANGES).join(", ")}, or give startDate and endDate.`
    );
  }
  return r;
}

// The window immediately before the one given, of the same length — which is
// what "compared with the previous period" has to mean for a comparison to be
// honest. GA4's own relative strings cannot express it, so it is computed.
export function previousRange({ startDate, endDate }) {
  const toDate = (s) =>
    s === "today"
      ? new Date()
      : s === "yesterday"
      ? new Date(Date.now() - 86400000)
      : /^(\d+)daysAgo$/.test(s)
      ? new Date(Date.now() - Number(s.match(/^(\d+)daysAgo$/)[1]) * 86400000)
      : new Date(`${s}T00:00:00Z`);

  const start = toDate(startDate);
  const end = toDate(endDate);
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { startDate: iso(prevStart), endDate: iso(prevEnd), days };
}

/* ---------------- reporting ---------------- */

// A deliberately small vocabulary. GA4 exposes hundreds of metrics and
// dimensions; offering all of them to a model invites a report that costs
// quota and answers nothing. These are the ones that answer questions anyone
// actually asks of a portfolio site.
export const METRICS = {
  activeUsers: "Active users",
  newUsers: "New users",
  sessions: "Sessions",
  screenPageViews: "Page views",
  averageSessionDuration: "Avg. session (s)",
  bounceRate: "Bounce rate",
  engagementRate: "Engagement rate",
  eventCount: "Events",
  userEngagementDuration: "Engaged time (s)",
};

export const DIMENSIONS = {
  date: "Date",
  pagePath: "Page",
  pageTitle: "Page title",
  country: "Country",
  city: "City",
  deviceCategory: "Device",
  sessionSource: "Source",
  sessionMedium: "Medium",
  sessionDefaultChannelGroup: "Channel",
  browser: "Browser",
  eventName: "Event",
  landingPage: "Landing page",
};

function assertFields(metrics, dimensions) {
  const badM = (metrics || []).filter((m) => !METRICS[m]);
  if (badM.length) {
    throw new AnalyticsError(
      `Unknown metric(s): ${badM.join(", ")}. Available: ${Object.keys(METRICS).join(", ")}.`
    );
  }
  const badD = (dimensions || []).filter((d) => !DIMENSIONS[d]);
  if (badD.length) {
    throw new AnalyticsError(
      `Unknown dimension(s): ${badD.join(", ")}. Available: ${Object.keys(DIMENSIONS).join(", ")}.`
    );
  }
  if (!metrics?.length) throw new AnalyticsError("A report needs at least one metric.");
  // GA4's own ceilings. Exceeding them is a 400 that does not name the limit.
  if (metrics.length > 10) throw new AnalyticsError(`At most 10 metrics; that is ${metrics.length}.`);
  if ((dimensions || []).length > 9) {
    throw new AnalyticsError(`At most 9 dimensions; that is ${dimensions.length}.`);
  }
}

// GA4 returns everything as strings. A caller that wants to compare or sum has
// to convert, and doing it here means one place gets it right.
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function shapeReport(res, { metrics, dimensions }) {
  const rows = (res.rows || []).map((r) => {
    const row = {};
    (dimensions || []).forEach((d, i) => {
      row[d] = r.dimensionValues?.[i]?.value ?? "";
    });
    (metrics || []).forEach((m, i) => {
      row[m] = num(r.metricValues?.[i]?.value);
    });
    return row;
  });

  const totals = {};
  const t = res.totals?.[0];
  (metrics || []).forEach((m, i) => {
    totals[m] = num(t?.metricValues?.[i]?.value);
  });

  return {
    rows,
    totals,
    rowCount: res.rowCount ?? rows.length,
    // GA4 withholds rows when a report could identify an individual. A caller
    // that does not know this reads a thresholded report as "no traffic".
    sampled: !!res.metadata?.dataLossFromOtherRow,
    thresholded: (res.metadata?.schemaRestrictionResponse?.activeMetricRestrictions || []).length > 0,
  };
}

export async function runReport(
  token,
  propertyId,
  { metrics, dimensions = [], range, startDate, endDate, limit = 25, orderByMetric } = {}
) {
  assertFields(metrics, dimensions);
  const property = propertyPath(propertyId);
  const dateRange = resolveRange(range, startDate, endDate);

  const body = {
    dateRanges: [dateRange],
    metrics: metrics.map((name) => ({ name })),
    dimensions: dimensions.map((name) => ({ name })),
    limit: Math.min(1000, Math.max(1, limit)),
  };
  if (orderByMetric) {
    if (!METRICS[orderByMetric]) {
      throw new AnalyticsError(`Cannot order by unknown metric "${orderByMetric}".`);
    }
    body.orderBys = [{ metric: { metricName: orderByMetric }, desc: true }];
  }

  const res = await call(token, `${DATA}/${property}:runReport`, { method: "POST", body });
  return { property, dateRange, ...shapeReport(res, { metrics, dimensions }) };
}

// The headline numbers plus the same window immediately before it, so every
// figure arrives with a direction rather than sitting there alone.
export async function summary(token, propertyId, { range = "28d", startDate, endDate } = {}) {
  const metrics = ["activeUsers", "newUsers", "sessions", "screenPageViews", "engagementRate"];
  const now = resolveRange(range, startDate, endDate);
  const prev = previousRange(now);

  const [a, b] = await Promise.all([
    runReport(token, propertyId, { metrics, range: undefined, ...now, limit: 1 }),
    runReport(token, propertyId, { metrics, startDate: prev.startDate, endDate: prev.endDate, limit: 1 }),
  ]);

  const change = {};
  for (const m of metrics) {
    const was = b.totals[m] || 0;
    const is = a.totals[m] || 0;
    change[m] = {
      now: is,
      before: was,
      // A percentage against zero is infinity, which reads as a bug. Report it
      // as new rather than as a number nobody can act on.
      delta: was === 0 ? null : Math.round(((is - was) / was) * 1000) / 10,
    };
  }
  return { dateRange: now, previous: { startDate: prev.startDate, endDate: prev.endDate }, change };
}

// Who is on the site right now. A separate endpoint with its own, much smaller
// vocabulary — most dimensions are not valid in realtime.
export async function realtime(token, propertyId, { dimensions = ["country"], limit = 10 } = {}) {
  const allowed = ["country", "city", "deviceCategory", "unifiedScreenName", "eventName"];
  const bad = dimensions.filter((d) => !allowed.includes(d));
  if (bad.length) {
    throw new AnalyticsError(
      `Realtime supports a smaller set of dimensions than a normal report. Unsupported: ${bad.join(
        ", "
      )}. Available: ${allowed.join(", ")}.`
    );
  }
  const property = propertyPath(propertyId);
  const res = await call(token, `${DATA}/${property}:runRealtimeReport`, {
    method: "POST",
    body: {
      metrics: [{ name: "activeUsers" }],
      dimensions: dimensions.map((name) => ({ name })),
      limit: Math.min(100, Math.max(1, limit)),
    },
  });
  const rows = (res.rows || []).map((r) => {
    const row = { activeUsers: num(r.metricValues?.[0]?.value) };
    dimensions.forEach((d, i) => {
      row[d] = r.dimensionValues?.[i]?.value ?? "";
    });
    return row;
  });
  return {
    property,
    activeUsers: rows.reduce((n, r) => n + r.activeUsers, 0),
    rows,
  };
}
