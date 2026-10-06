// Google Analytics, inside the existing Analytics tab.
//
// DESIGN
//
// This does NOT get its own tab. The tab already answers "how is the site
// doing" with first-party counters, and a second tab answering the same
// question with different numbers would make the first thing anyone does be
// deciding which one to believe. So the tab gains a source: the counters that
// are about THE WORK (did anyone open the résumé, take the PDF, follow a short
// link) stay above, and GA sits below answering the audience question they
// deliberately do not.
//
// The property picker is the point of the section — "analytics for any project
// I set up" means one account commonly owns several properties, so choosing one
// has to be the first thing available and has to persist while you read.
//
// Every number is shown against the SAME WINDOW IMMEDIATELY BEFORE IT. A bare
// count is unreadable: 412 visitors is good or bad only against what it was.
// A change measured from zero is shown as "new" rather than as a percentage,
// because a percentage of zero is infinity and reads as a bug.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { auth } from "../../lib/firebase";

const RANGES = [
  ["7d", "7 days"],
  ["28d", "28 days"],
  ["90d", "90 days"],
  ["365d", "A year"],
];

const METRIC_ORDER = [
  ["activeUsers", "Visitors"],
  ["newUsers", "New"],
  ["sessions", "Sessions"],
  ["screenPageViews", "Page views"],
  ["engagementRate", "Engaged"],
];

const fmt = (n, metric) => {
  if (n == null) return "—";
  if (metric === "engagementRate") return `${Math.round(n * 100)}%`;
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();
};

async function call(body) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const res = await fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// Remembered across visits: picking the property again every time you open the
// tab is the kind of friction that stops a dashboard being read.
const REMEMBER = "rk-ga-property";

export default function GaPanel() {
  const [status, setStatus] = useState(null);
  const [properties, setProperties] = useState([]);
  const [property, setProperty] = useState("");
  const [range, setRange] = useState("28d");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      setBusy("Checking Google Analytics…");
      try {
        const st = await call({ action: "accounts" });
        setStatus(st);
        if (st.count > 0) {
          const { properties: list } = await call({ action: "properties" });
          setProperties(list);
          let want = "";
          try {
            want = localStorage.getItem(REMEMBER) || "";
          } catch (_) {}
          setProperty(list.some((p) => p.id === want) ? want : list[0]?.id || "");
        }
      } catch (e) {
        setErr(e.message);
      } finally {
        setBusy("");
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!property) return;
    setBusy("Reading Google Analytics…");
    setErr("");
    try {
      try {
        localStorage.setItem(REMEMBER, property);
      } catch (_) {}
      const [summary, pages, sources, realtime] = await Promise.all([
        call({ action: "summary", propertyId: property, range }),
        call({ action: "topPages", propertyId: property, range }),
        call({ action: "sources", propertyId: property, range }),
        call({ action: "realtime", propertyId: property }).catch(() => null),
      ]);
      setData({ summary, pages, sources, realtime });
    } catch (e) {
      setErr(e.message);
      setData(null);
    } finally {
      setBusy("");
    }
  }, [property, range]);

  useEffect(() => {
    load();
  }, [load]);

  const connect = async () => {
    setErr("");
    try {
      const user = auth.currentUser;
      const res = await fetch("/api/integrations/analytics/start", {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not start the connection.");
      window.location.assign(j.url);
    } catch (e) {
      setErr(e.message);
    }
  };

  const chosen = useMemo(() => properties.find((p) => p.id === property), [properties, property]);

  if (status && !status.configured) {
    return (
      <section className="ga-wrap">
        <h3 className="ga-h">Google Analytics</h3>
        <p className="ga-off">
          Not set up on this deployment
          {status.missing?.length ? ` — missing ${status.missing.join(", ")}` : ""}. The counters
          above keep working regardless.
        </p>
        <GaStyles />
      </section>
    );
  }

  if (status && status.count === 0) {
    return (
      <section className="ga-wrap">
        <h3 className="ga-h">Google Analytics</h3>
        <p className="ga-off">
          Connect a Google account to report on any GA4 property it can see. Read-only — this can
          never change a property or a data stream.
        </p>
        <button className="admin-primary" type="button" onClick={connect}>
          Connect Google Analytics
        </button>
        {err ? <p className="admin-err">{err}</p> : null}
        <GaStyles />
      </section>
    );
  }

  return (
    <section className="ga-wrap">
      <div className="ga-head">
        <h3 className="ga-h">Google Analytics</h3>
        <div className="ga-controls">
          {properties.length ? (
            <label className="ga-pick">
              <span>Property</span>
              <select
                className="admin-input"
                value={property}
                onChange={(e) => setProperty(e.target.value)}
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.account}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="ga-ranges" role="group" aria-label="Date range">
            {RANGES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`ga-range${range === id ? " on" : ""}`}
                onClick={() => setRange(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {chosen ? (
        <p className="ga-meta">
          <span>{chosen.name}</span>
          <span className="ga-hair" aria-hidden="true" />
          <span>property {chosen.id}</span>
          {data?.realtime ? (
            <>
              <span className="ga-hair" aria-hidden="true" />
              <span className="ga-live">{data.realtime.activeUsers} on the site now</span>
            </>
          ) : null}
        </p>
      ) : null}

      {busy ? <p className="ga-busy">{busy}</p> : null}
      {err ? <p className="admin-err">{err}</p> : null}

      {data ? (
        <>
          <div className="ga-stats">
            {METRIC_ORDER.map(([key, label]) => {
              const c = data.summary.change?.[key];
              const dir = c?.delta == null ? "new" : c.delta > 0 ? "up" : c.delta < 0 ? "down" : "flat";
              return (
                <div className="ga-stat" key={key}>
                  <span className="ga-stat-n">{fmt(c?.now, key)}</span>
                  <span className="ga-stat-l">{label}</span>
                  <span className={`ga-delta ${dir}`}>
                    {c?.delta == null
                      ? c?.now
                        ? "new"
                        : "—"
                      : `${c.delta > 0 ? "+" : ""}${c.delta}%`}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="ga-vs">
            against {data.summary.previous.startDate} to {data.summary.previous.endDate}, the same
            length immediately before
          </p>

          <div className="ga-cols">
            <div className="ga-col">
              <h4>Top pages</h4>
              {data.pages.rows.length === 0 ? (
                <p className="ga-none">
                  {data.pages.thresholded
                    ? "Google withheld these rows — too few visitors to report without identifying someone."
                    : "No page views in this window."}
                </p>
              ) : (
                <ul className="ga-list">
                  {data.pages.rows.map((r) => (
                    <li key={r.pagePath}>
                      <span className="ga-path" title={r.pagePath}>
                        {r.pagePath}
                      </span>
                      <span className="ga-n">{r.screenPageViews.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="ga-col">
              <h4>Where they came from</h4>
              {data.sources.rows.length === 0 ? (
                <p className="ga-none">No sessions in this window.</p>
              ) : (
                <ul className="ga-list">
                  {data.sources.rows.map((r, i) => (
                    <li key={`${r.sessionDefaultChannelGroup}-${r.sessionSource}-${i}`}>
                      <span className="ga-path">
                        {r.sessionDefaultChannelGroup}
                        <em>{r.sessionSource}</em>
                      </span>
                      <span className="ga-n">{r.sessions.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : null}

      <GaStyles />
    </section>
  );
}

export function GaStyles() {
  return (
    <style jsx global>{`
      .ga-wrap {
        margin-top: 28px;
        padding-top: 20px;
        border-top: 1px solid var(--a-line, #23262f);
      }
      .ga-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
      }
      .ga-h {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 15px;
        color: var(--a-text, #e7e8ee);
      }
      .ga-controls {
        display: flex;
        align-items: flex-end;
        gap: 10px;
        flex-wrap: wrap;
      }
      .ga-pick {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .ga-pick > span {
        font-size: 11px;
        color: var(--a-dim, #7d8496);
      }
      .ga-pick .admin-input {
        min-width: 230px;
      }
      .ga-ranges {
        display: flex;
        gap: 4px;
      }
      .ga-range {
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        color: var(--a-dim, #8b90a0);
        border-radius: 8px;
        padding: 8px 11px;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .ga-range.on {
        border-color: var(--a-amber, #ffb020);
        color: var(--a-text, #e7e8ee);
      }
      .ga-meta {
        margin: 10px 0 0;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      /* Hairlines, never middots. */
      .ga-hair {
        width: 14px;
        height: 1px;
        background: var(--a-line, #2a2e38);
        flex: none;
      }
      .ga-live {
        color: var(--a-amber, #ffb020);
      }
      .ga-busy,
      .ga-off {
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
        margin: 10px 0;
        max-width: 72ch;
        line-height: 1.55;
      }

      .ga-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
        gap: 10px;
        margin: 16px 0 6px;
      }
      .ga-stat {
        border: 1px solid var(--a-line, #23262f);
        border-radius: 10px;
        padding: 12px 13px;
        background: var(--a-raise, #15171d);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .ga-stat-n {
        font-family: "Space Grotesk", sans-serif;
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: var(--a-text, #e7e8ee);
        line-height: 1.1;
      }
      .ga-stat-l {
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      /* A number alone is unreadable; the direction is the information. */
      .ga-delta {
        font-size: 11px;
        margin-top: 3px;
      }
      .ga-delta.up {
        color: #6ee7a8;
      }
      .ga-delta.down {
        color: #ff8a8a;
      }
      .ga-delta.flat,
      .ga-delta.new {
        color: var(--a-dim, #7d8496);
      }
      .ga-vs {
        margin: 0 0 16px;
        font-size: 11px;
        color: #5c6377;
      }

      .ga-cols {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
        gap: 14px;
      }
      .ga-col h4 {
        margin: 0 0 8px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 12.5px;
        color: var(--a-text, #e7e8ee);
      }
      .ga-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .ga-list li {
        display: flex;
        align-items: baseline;
        gap: 10px;
        padding: 6px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        font-size: 12.5px;
      }
      .ga-list li:first-child {
        border-top: 0;
      }
      .ga-path {
        flex: 1;
        min-width: 0;
        color: var(--a-text, #e7e8ee);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ga-path em {
        font-style: normal;
        color: var(--a-dim, #7d8496);
        margin-left: 7px;
      }
      .ga-n {
        color: var(--a-dim, #8b90a0);
        font-variant-numeric: tabular-nums;
      }
      .ga-none {
        margin: 0;
        font-size: 12px;
        color: #5c6377;
        line-height: 1.5;
        max-width: 54ch;
      }

      @media (max-width: 720px) {
        .ga-pick .admin-input {
          min-width: 0;
          width: 100%;
        }
        .ga-controls {
          width: 100%;
        }
      }
    `}</style>
  );
}
