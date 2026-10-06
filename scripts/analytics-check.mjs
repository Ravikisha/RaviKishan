// Google Analytics — checked with no network and no credentials.
//
// The assertions that matter are about answers that would be WRONG rather than
// absent: a "previous period" that is not the same length as the period it is
// compared against, a percentage change against a zero baseline, a UA property
// id that returns an empty report instead of saying the data was deleted, and
// a thresholded report read as "no traffic".
//
//   node scripts/analytics-check.mjs
const {
  AnalyticsError,
  DIMENSIONS,
  METRICS,
  RANGES,
  UA_RE,
  previousRange,
  propertyPath,
  resolveRange,
  shapeReport,
} = await import("../lib/server/googleAnalytics.js");

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
const throws = (fn, name, re) => {
  try {
    fn();
    check(false, name, "it did not throw");
  } catch (e) {
    check(!re || re.test(e.message), name, re ? e.message.slice(0, 130) : "");
  }
};

console.log("\nproperty ids");
{
  check(propertyPath("123456") === "properties/123456", "a bare number becomes a resource path");
  check(propertyPath("properties/123456") === "properties/123456", "and an already-qualified one passes");
  check(propertyPath("  123  ") === "properties/123", "surrounding space is trimmed");

  // The one worth refusing by NAME. UA stopped collecting in July 2023 and the
  // data was deleted in July 2024 — an empty report would be a misleading
  // answer to a question that has a real one.
  check(UA_RE.test("UA-123456-1"), "a UA id is recognised");
  throws(
    () => propertyPath("UA-123456-1"),
    "and refused with what happened to it",
    /Universal Analytics|deleted/
  );
  throws(() => propertyPath("G-ABC123"), "a measurement id is not a property id", /not a GA4 property id/);
  throws(() => propertyPath(""), "and nothing is refused", /required/);
}

console.log("\ndate ranges");
{
  check(resolveRange("28d").startDate === "28daysAgo", "a named range resolves");
  check(resolveRange("28d").endDate === "yesterday", "ending yesterday, not today, so the last day is complete");
  check(Object.keys(RANGES).length >= 6, "there are several named ranges", Object.keys(RANGES).join(","));
  check(
    resolveRange(undefined, "2026-01-01", "2026-01-31").startDate === "2026-01-01",
    "explicit dates win over a named range"
  );
  throws(
    () => resolveRange(undefined, "2026-1-1", "2026-01-31"),
    "a malformed date is refused",
    /YYYY-MM-DD/
  );
  // Reversed dates return an empty report from GA4 rather than an error, which
  // reads as "no traffic in that window".
  throws(
    () => resolveRange(undefined, "2026-02-01", "2026-01-01"),
    "a reversed range is refused rather than reported as empty",
    /is after/
  );
  throws(() => resolveRange("last-tuesday"), "an unknown range names the valid ones", /Unknown range/);
}

console.log("\nthe previous period is the same length, immediately before");
{
  // The whole point of a comparison. A "previous period" of a different length
  // makes every percentage meaningless, and nothing in the response says so.
  const p = previousRange({ startDate: "2026-02-01", endDate: "2026-02-28" });
  check(p.days === 28, "a 28-day window compares against 28 days", String(p.days));
  check(p.endDate === "2026-01-31", "ending the day before it starts", p.endDate);
  check(p.startDate === "2026-01-04", "and starting 28 days before that", p.startDate);

  const one = previousRange({ startDate: "2026-02-10", endDate: "2026-02-10" });
  check(one.days === 1, "a single day compares against a single day", String(one.days));
  check(one.startDate === "2026-02-09" && one.endDate === "2026-02-09", "the day before", JSON.stringify(one));

  // Relative strings have to work too, since that is what the named ranges use.
  const rel = previousRange({ startDate: "7daysAgo", endDate: "yesterday" });
  check(rel.days === 7, "a relative range resolves to its real length", String(rel.days));
  check(
    /^\d{4}-\d{2}-\d{2}$/.test(rel.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(rel.endDate),
    "and comes back as real dates",
    JSON.stringify(rel)
  );
}

console.log("\nthe vocabulary is small, and unknown fields are refused by name");
{
  check(Object.keys(METRICS).length >= 8, "there are metrics", String(Object.keys(METRICS).length));
  check(Object.keys(DIMENSIONS).length >= 10, "and dimensions", String(Object.keys(DIMENSIONS).length));
  check(!!METRICS.activeUsers && !!METRICS.screenPageViews, "including the ones anyone asks for");
  check(!!DIMENSIONS.pagePath && !!DIMENSIONS.sessionDefaultChannelGroup, "and the ones that answer 'from where'");
  // GA4 names these oddly; a report asking for "pageviews" or "users" returns
  // a 400 that does not suggest the right name.
  check(!METRICS.pageviews && !METRICS.users, "the GA3 names are NOT accepted, since GA4 renamed them");
}

console.log("\nreport shaping");
{
  const raw = {
    rows: [
      { dimensionValues: [{ value: "/blog/x" }], metricValues: [{ value: "120" }, { value: "0.73" }] },
      { dimensionValues: [{ value: "/" }], metricValues: [{ value: "90" }, { value: "0.51" }] },
    ],
    totals: [{ metricValues: [{ value: "210" }, { value: "0.62" }] }],
    rowCount: 2,
  };
  const out = shapeReport(raw, { metrics: ["screenPageViews", "engagementRate"], dimensions: ["pagePath"] });
  check(out.rows.length === 2, "rows come back");
  check(out.rows[0].pagePath === "/blog/x", "dimensions are keyed by name");
  // GA4 returns every number as a STRING. A caller that sums them without
  // converting gets "12090" instead of 210.
  check(out.rows[0].screenPageViews === 120, "metrics are converted to numbers", typeof out.rows[0].screenPageViews);
  check(out.totals.screenPageViews === 210, "and so are the totals");
  check(out.rows[0].engagementRate === 0.73, "including fractional ones");

  const empty = shapeReport({}, { metrics: ["activeUsers"], dimensions: [] });
  check(empty.rows.length === 0 && empty.totals.activeUsers === 0, "an empty report is zero, not undefined");

  // GA4 withholds rows that could identify an individual. Without this flag a
  // thresholded report is indistinguishable from no traffic at all.
  const thresholded = shapeReport(
    {
      rows: [],
      metadata: { schemaRestrictionResponse: { activeMetricRestrictions: [{ metricName: "activeUsers" }] } },
    },
    { metrics: ["activeUsers"], dimensions: [] }
  );
  check(thresholded.thresholded === true, "a thresholded report says so rather than looking empty");
  check(shapeReport({ rows: [] }, { metrics: ["activeUsers"] }).thresholded === false, "and a genuinely empty one does not");
}

console.log("\nerrors are typed");
check(new AnalyticsError("x") instanceof Error, "AnalyticsError is an Error");
check(new AnalyticsError("x", { status: 403 }).status === 403, "and carries the status");

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
