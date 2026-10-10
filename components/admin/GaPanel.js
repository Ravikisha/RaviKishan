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
import { adminJson } from "../../lib/adminFetch";
import { orgKey } from "../../lib/orgState";
import { beginConnect, finishConnect } from "../../lib/socialClient";

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

// Through adminFetch: the org header decides which Analytics accounts — and so
// which properties — this page can see.
const call = (body) => adminJson("/api/analytics", body);

// Remembered across visits: picking the property again every time you open the
// tab is the kind of friction that stops a dashboard being read.
//
// Kept PER ORG: a property chosen in Relax belongs to Relax's Google account,
// and preselecting it inside another org would ask for a report that org
// cannot read. LinkedInPanel reads the same key for its reach figures.
const REMEMBER = () => orgKey("rk-ga-property");

// Google matches a redirect URI EXACTLY — scheme, host, port and path — and
// ravikishan.me answers on www (the apex 308s there). Registering only one of
// them is the classic way to meet redirect_uri_mismatch on the first click,
// which is what happened here: the Google client already carried the tasks
// callback, so everything LOOKED configured right up to the consent screen.
const CALLBACK_PATH = "/api/integrations/analytics/callback";
const PROD_ORIGINS = ["https://www.ravikishan.me", "https://ravikishan.me"];

export function callbacksFor(currentOrigin = "") {
  const origins = [...PROD_ORIGINS, "http://localhost:3000"];
  const here = String(currentOrigin || "").replace(/\/+$/, "");
  if (/^https?:\/\/[^/]+$/.test(here) && !origins.includes(here)) origins.push(here);
  return origins.map((o) => o + CALLBACK_PATH);
}

export default function GaPanel() {
  // Shown so the redirect URI can be copied for whichever host this is served
  // from — Google compares it character for character.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const [status, setStatus] = useState(null);
  const [properties, setProperties] = useState([]);
  const [property, setProperty] = useState("");
  const [range, setRange] = useState("28d");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");

  const copy = (text) => {
    const done = () => {
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? "" : c)), 1400);
    };
    try {
      navigator.clipboard.writeText(text).then(done, () => {});
    } catch (_) {}
  };

  useEffect(() => {
    (async () => {
      // The server holds nothing: the callback seals the credential into a
      // short-lived httpOnly cookie and the signed-in browser writes it under
      // the admin-only rules. So the claim is OURS to make, and skipping it
      // loses a consent that has already happened.
      try {
        const q = new URLSearchParams(window.location.search);
        const connected = q.get("connected");
        const failed = q.get("connectError");
        if (connected === "analytics") {
          setBusy("Saving the Google Analytics connection…");
          try {
            await finishConnect("analytics");
          } catch (e) {
            setErr(e.message || "The connection could not be saved.");
          }
        } else if (failed) {
          setErr(failed);
        }
        if (connected || failed) {
          q.delete("connected");
          q.delete("connectError");
          q.delete("account");
          const rest = q.toString();
          window.history.replaceState(
            {},
            "",
            window.location.pathname + (rest ? `?${rest}` : "")
          );
        }
      } catch (_) {}

      setBusy("Checking Google Analytics…");
      try {
        const st = await call({ action: "accounts" });
        setStatus(st);
        if (st.count > 0) {
          const { properties: list } = await call({ action: "properties" });
          setProperties(list);
          let want = "";
          try {
            want = localStorage.getItem(REMEMBER()) || "";
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
        localStorage.setItem(REMEMBER(), property);
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
      await beginConnect("analytics");
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
        <details className="ga-setup" open>
          <summary>
            Before Connect will work{status.borrowed ? ` — using ${status.borrowed}` : ""}
          </summary>
          <p>
            {status.borrowed
              ? "One Google OAuth client can serve several Google APIs, so there is no second client to create. That client does need three things it has no reason to have yet:"
              : "The Google OAuth client needs three things before Google will show a consent screen:"}
          </p>
          <ol className="ga-steps">
            <li>
              Enable the <strong>Google Analytics Data API</strong> and the{" "}
              <strong>Google Analytics Admin API</strong>. The first reads reports, the second lists
              which properties the account can see.
            </li>
            <li>
              Add the scope <code>analytics.readonly</code> to the consent screen. Read-only is the
              whole grant — nothing here can change a property or a data stream.
            </li>
            <li>
              Add every one of these to <strong>Authorised redirect URIs</strong>. Google compares
              them character for character, so the one the app is running on is not optional:
            </li>
          </ol>
          <ul className="ga-uris">
            {callbacksFor(origin).map((u) => (
              <li key={u}>
                <code>{u}</code>
                <button type="button" className="ga-copy" onClick={() => copy(u)}>
                  {copied === u ? "Copied" : "Copy"}
                </button>
              </li>
            ))}
          </ul>
        </details>
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
      .ga-setup {
        margin: 12px 0 16px;
        max-width: 78ch;
        padding: 12px 14px 14px;
        border: 1px dashed var(--a-line, #2b3040);
        border-radius: 10px;
        font-size: 12px;
        line-height: 1.65;
        color: var(--a-dim, #8b90a0);
      }
      .ga-setup summary {
        cursor: pointer;
        color: var(--a-text, #e7e8ee);
        font-size: 12.5px;
      }
      .ga-setup p {
        margin: 10px 0 0;
      }
      .ga-steps {
        /* The markers are information: this is a sequence, and a global
           list-style reset elsewhere in the admin would otherwise hide it. */
        list-style: decimal;
        margin: 8px 0 0;
        padding-left: 20px;
      }
      .ga-steps li {
        margin-top: 6px;
      }
      .ga-setup code {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11px;
        color: var(--a-text, #e7e8ee);
      }
      .ga-uris {
        list-style: none;
        margin: 10px 0 0;
        padding: 0;
      }
      .ga-uris li {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 5px 0;
        border-top: 1px solid var(--a-line, #2b3040);
        overflow-wrap: anywhere;
      }
      .ga-copy {
        margin-left: auto;
        flex: none;
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 6px;
        color: var(--a-dim, #8b90a0);
        font: inherit;
        font-size: 11px;
        padding: 2px 9px;
        cursor: pointer;
      }
      .ga-copy:hover {
        color: var(--a-text, #e7e8ee);
        border-color: var(--a-accent, #ffb020);
      }
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
