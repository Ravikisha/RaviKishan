// First-party analytics.
//
// GA4 still handles audience analysis; this shows the handful of numbers that
// are actually about the work — did anyone open the résumé, did they take the
// PDF, which short link is pulling traffic — next to the content they measure.
//
// The counters are browser-written (see lib/analytics.js), so they are
// indicative rather than billing-grade. The panel says so rather than
// presenting them as exact.
import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { COUNTERS, dayId } from "../../lib/analytics";

const LABELS = {
  pageView: "Visits",
  resumeView: "Résumé opened",
  resumeDownload: "PDF downloaded",
  resumeCopyLink: "Link copied",
  projectsView: "Projects seen",
  blogView: "Blog seen",
  contactSubmit: "Contact sent",
};

const RANGES = [
  { id: 7, label: "7 days" },
  { id: 30, label: "30 days" },
  { id: 90, label: "90 days" },
];

const daysBack = (n) => {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    out.push(dayId(d));
  }
  return out;
};

// Inline sparkline — a chart library would be more code than the chart.
function Spark({ series, color = "#FFB020" }) {
  const max = Math.max(1, ...series);
  const w = 260;
  const h = 34;
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const pts = series.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`);
  return (
    <svg className="an-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.6" />
      <circle cx={pts.length ? pts[pts.length - 1].split(",")[0] : 0} cy={pts.length ? pts[pts.length - 1].split(",")[1] : 0} r="2.4" fill={color} />
    </svg>
  );
}

export default function AnalyticsPanel() {
  const [stats, setStats] = useState(null);
  const [links, setLinks] = useState(null);
  const [err, setErr] = useState("");
  const [range, setRange] = useState(30);

  useEffect(() => {
    const a = onSnapshot(
      collection(db, "stats"),
      (snap) => setStats(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))),
      (e) => setErr(e?.code || "read failed")
    );
    const b = onSnapshot(
      collection(db, "links"),
      (snap) => setLinks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {}
    );
    return () => {
      a();
      b();
    };
  }, []);

  const days = useMemo(() => daysBack(range), [range]);

  const series = useMemo(() => {
    const out = {};
    for (const c of COUNTERS) out[c] = days.map((d) => Number(stats?.[d]?.[c] || 0));
    return out;
  }, [stats, days]);

  const totals = useMemo(() => {
    const out = {};
    for (const c of COUNTERS) out[c] = series[c].reduce((a, b) => a + b, 0);
    return out;
  }, [series]);

  // Of the people who opened the résumé, how many actually took it? That ratio
  // is the only number here worth acting on.
  const conversion =
    totals.resumeView > 0
      ? Math.round(((totals.resumeDownload + totals.resumeCopyLink) / totals.resumeView) * 100)
      : null;

  const topLinks = (links || []).slice().sort((a, b) => (b.clicks || 0) - (a.clicks || 0)).slice(0, 8);
  const linkTotal = (links || []).reduce((n, l) => n + (l.clicks || 0), 0);
  const hasData = Object.values(totals).some((v) => v > 0);

  return (
    <main className="admin-main">
      <div className="vt-intro">
        <strong>First-party analytics.</strong> Counted in the browser without
        cookies and with nothing identifying stored — no IP, no user agent, one
        counter per day. Deduped per session, and the admin is excluded. Good
        enough to spot a trend; not exact.
      </div>

      <div className="an-range">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`admin-ghost sm${range === r.id ? " on" : ""}`}
            onClick={() => setRange(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {err && <div className="admin-err">Couldn&apos;t read stats ({err}). Publish firestore.rules.</div>}

      {stats == null ? (
        <p className="admin-sub" style={{ padding: "20px 2px" }}>Loading…</p>
      ) : !hasData ? (
        <div className="inbox-empty">
          <p>No data yet.</p>
          <span>Counters start filling as soon as the site gets traffic.</span>
        </div>
      ) : (
        <>
          <section className="an-grid">
            {COUNTERS.map((c) => (
              <div key={c} className="an-card">
                <span className="an-label">{LABELS[c] || c}</span>
                <span className="an-value">{totals[c].toLocaleString("en-US")}</span>
                <Spark series={series[c]} />
              </div>
            ))}
          </section>

          {conversion !== null && (
            <section className="ops-card">
              <h3>Résumé conversion</h3>
              <p className="admin-sub">
                <strong className="an-big">{conversion}%</strong> of résumé views ended in a
                download or a copied link ({totals.resumeDownload} downloads +{" "}
                {totals.resumeCopyLink} copies of {totals.resumeView} views).
              </p>
            </section>
          )}
        </>
      )}

      <section className="ops-card">
        <div className="ops-head">
          <h3>Short links</h3>
          <span className="admin-sub">{linkTotal} clicks all time</span>
        </div>
        {!links?.length ? (
          <p className="admin-sub">No short links yet.</p>
        ) : (
          <div className="ops-list">
            {topLinks.map((l) => (
              <div key={l.id} className="ops-row">
                <span className="rm-file">/l/{l.id}</span>
                <span className="lk-clicks">{l.clicks || 0} clicks</span>
                <span className="admin-sub lk-dest">{l.title || l.url}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <style jsx global>{`
        .an-range {
          display: flex;
          gap: 8px;
          margin-bottom: 14px;
        }
        .admin-ghost.sm.on {
          border-color: #ffb020;
          color: #ffb020;
        }
        .an-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
          gap: 10px;
          margin-bottom: 14px;
        }
        .an-card {
          border: 1px solid #262a35;
          border-radius: 10px;
          background: #0f1117;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .an-label {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #8b90a0;
        }
        .an-value {
          font-family: "Space Grotesk", sans-serif;
          font-size: 26px;
          font-weight: 700;
          color: #e7e8ee;
          line-height: 1.15;
        }
        .an-spark {
          width: 100%;
          height: 34px;
          margin-top: 4px;
        }
        .an-big {
          font-size: 20px;
          color: #ffb020;
        }
      `}</style>
    </main>
  );
}
