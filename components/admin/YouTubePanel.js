// The YouTube creator desk.
//
// DESIGN
//
// The Social tab already lists channels and lets you edit a video. That answers
// "what have I got". This page answers the question a creator actually arrives
// with, which is **"is it growing, and because of what"** — and those are two
// different pages, which is why this is not another shelf on Social.
//
// The organising idea: YouTube Studio buries the only number that matters
// under four tabs. Here the shape of the last 28 days IS the page. One row of
// figures, each against the same window immediately before it, then the bars
// that produced them, then the videos ranked by what they did in THAT window
// rather than by lifetime views — because lifetime views are a fact about the
// past and tell a creator nothing about what to make next.
//
// The one bold element is the daily bar strip. It is the only saturated thing,
// it is the only thing that moves (the bars scale up once, on load), and it is
// drawn from one row per day rather than interpolated between two endpoints,
// so a spike is a real day you can point at.
//
// Channel configuration sits last and folded: it is edited about once a year,
// and `channels.update` REPLACES the part it is given, so the save is
// read-modify-write and says so.
//
// SEVERAL CHANNELS. Every call names the channel it is about (`accountId`), so
// two connected Google accounts never resolve to "whichever the server picks"
// — with two connected and no default, the server refuses rather than guesses.
// The switcher above the figures is the place you choose; the selected chip
// wears the console's one amber edge, as everywhere else.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { auth } from "../../lib/firebase";
import { connectProvider, finishConnect } from "../../lib/accountsClient";

const RANGES = [
  ["7d", "7 days"],
  ["28d", "28 days"],
  ["90d", "90 days"],
  ["365d", "A year"],
];

// What a growth page is actually asking. Watch time before views on purpose:
// views are the vanity number and watch time is the one YouTube ranks on.
const FIGURES = [
  ["views", "Views"],
  ["estimatedMinutesWatched", "Minutes watched"],
  ["subscribersGained", "Subscribers gained"],
  ["averageViewDuration", "Average view", "s"],
];

async function call(body) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const res = await fetch("/api/social", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify({ provider: "youtube", ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

const fmt = (n) =>
  n === null || n === undefined ? "—" : n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString();

const delta = (c) => {
  if (!c) return "";
  if (c.delta === null || c.delta === undefined) return c.now ? "new" : "";
  return `${c.delta > 0 ? "+" : ""}${c.delta}%`;
};

export default function YouTubePanel() {
  const [range, setRange] = useState("28d");
  const [status, setStatus] = useState(null);
  const [sel, setSel] = useState("");
  const [channel, setChannel] = useState(null);
  const [growth, setGrowth] = useState(null);
  const [daily, setDaily] = useState(null);
  const [videos, setVideos] = useState(null);
  const [titles, setTitles] = useState({});
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState("Reading your channels…");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const accounts = status?.accounts || [];
  // Every call is about the selected channel, by name.
  const ask = useCallback((body) => call({ ...body, accountId: sel }), [sel]);

  const loadAccounts = useCallback(async () => {
    const { providers = [] } = await call({ action: "accounts" });
    const yt = providers.find((p) => p.provider === "youtube") || { configured: false, accounts: [] };
    setStatus(yt);
    setSel((s) => (s && yt.accounts.some((a) => a.accountId === s) ? s : yt.accounts[0]?.accountId || ""));
    return yt;
  }, []);

  useEffect(() => {
    (async () => {
      // The callback seals the credential into a short-lived cookie and the
      // signed-in browser writes it; skip the claim and a consent that already
      // happened simply never appears.
      try {
        const q = new URLSearchParams(window.location.search);
        const connected = q.get("connected");
        const failed = q.get("connectError");
        if (connected === "youtube") {
          setBusy("Saving the channel connection…");
          try {
            await finishConnect("youtube");
            setMsg(`Connected ${q.get("account") || "the channel"}.`);
          } catch (e) {
            setErr(e.message || "The connection could not be saved.");
          }
        } else if (failed) {
          setErr(failed);
        }
        if (connected || failed) {
          ["connected", "connectError", "account"].forEach((k) => q.delete(k));
          const rest = q.toString();
          window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
        }
      } catch (_) {}
      const yt = await loadAccounts().catch((e) => {
        setErr(e.message);
        return null;
      });
      if (!yt?.accounts?.length) setBusy("");
    })();
  }, [loadAccounts]);

  const connect = async () => {
    setErr("");
    setBusy("Opening Google…");
    try {
      // Back to this tab, through Google's account chooser — no account is
      // pinned, which is what lets a second channel be connected at all.
      await connectProvider("youtube", "youtube");
    } catch (e) {
      setErr(e.message);
      setBusy("");
    }
  };

  const load = useCallback(async () => {
    if (!sel) return;
    setErr("");
    setChannel(null);
    setConfig(null);
    setTitles({});
    try {
      const ch = await ask({ action: "channel" });
      setChannel(ch);
      // Titles come from the Data API; the analytics report returns video IDs
      // only. One call, then a lookup — the alternative is one call per row.
      const list = await ask({ action: "videos", max: 50 }).catch(() => ({ videos: [] }));
      const map = {};
      for (const v of list.videos || []) map[v.id] = v;
      setTitles(map);
      setConfig(await ask({ action: "channelConfig" }).catch(() => null));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }, [sel, ask]);

  useEffect(() => {
    load();
  }, [load]);

  // The three analytics calls move together with the range and the channel,
  // and are kept apart from the channel read.
  useEffect(() => {
    if (!sel) return undefined;
    let alive = true;
    (async () => {
      setBusy("Reading YouTube Analytics…");
      const [g, d, v] = await Promise.all([
        ask({ action: "growth", range }).catch((e) => ({ available: false, why: e.message })),
        ask({ action: "dailyGrowth", range }).catch((e) => ({ available: false, why: e.message })),
        ask({ action: "videoGrowth", range, limit: 10 }).catch((e) => ({ available: false, why: e.message })),
      ]);
      if (!alive) return;
      setGrowth(g);
      setDaily(d);
      setVideos(v);
      setBusy("");
    })();
    return () => {
      alive = false;
    };
  }, [range, sel, ask]);

  const bars = useMemo(() => {
    const rows = daily?.rows || [];
    const peak = Math.max(1, ...rows.map((r) => r.views || 0));
    return rows.map((r) => ({
      day: r.day,
      views: r.views || 0,
      subs: r.subscribersGained || 0,
      h: Math.round(((r.views || 0) / peak) * 100),
    }));
  }, [daily]);

  const unavailable = growth && growth.available === false ? growth.why : "";

  if (status && (!status.configured || !accounts.length)) {
    return (
      <main className="admin-main">
        <section className="yt-empty">
          <h2 className="yt-name">{status.configured ? "Connect a YouTube channel" : "YouTube is not set up"}</h2>
          <p className="yt-note">
            {status.configured
              ? "Connect as many channels as you run. Google's account chooser decides which one; each channel gets its own figures here and every tool can name it."
              : `Missing on this deployment: ${(status.missing || []).join(", ") || "the Google OAuth client"}.`}
          </p>
          {status.configured ? (
            <button className="admin-primary" type="button" onClick={connect} disabled={busy === "Opening Google…"}>
              Connect YouTube
            </button>
          ) : null}
          {err ? <p className="admin-err">{err}</p> : null}
        </section>
        <YouTubeStyles />
      </main>
    );
  }

  return (
    <main className="admin-main">
      <nav className="yt-chans" aria-label="YouTube channels">
        {accounts.map((a) => (
          <button
            key={a.accountId}
            type="button"
            className={`yt-chan${a.accountId === sel ? " on" : ""}${a.needsReconnect ? " bad" : ""}`}
            aria-pressed={a.accountId === sel}
            onClick={() => {
              setGrowth(null);
              setDaily(null);
              setVideos(null);
              setMsg("");
              setSel(a.accountId);
            }}
            title={`Channel ${a.accountId}`}
          >
            <span className="yt-chan-name">{a.label || a.accountId}</span>
            {/* The second line must tell two channels apart: the Google
                address when it was recorded, otherwise the channel id —
                never the title again. */}
            <span className="yt-chan-mail">
              {/@/.test(a.email || "") ? a.email : a.accountId}
            </span>
          </button>
        ))}
        <button type="button" className="yt-chan yt-chan-add" onClick={connect} disabled={busy === "Opening Google…"}>
          <span className="yt-chan-name">Connect another channel</span>
          <span className="yt-chan-mail">Google&apos;s account chooser opens</span>
        </button>
      </nav>

      <header className="yt-top">
        <div className="yt-who">
          {channel?.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="yt-face" src={channel.thumbnail} alt="" />
          ) : null}
          <div>
            <h2 className="yt-name">{channel?.title || "YouTube"}</h2>
            <p className="yt-sum">
              {channel
                ? `${channel.subscribers.toLocaleString()} subscriber${
                    channel.subscribers === 1 ? "" : "s"
                  }, ${channel.videos} public video${
                    channel.videos === 1 ? "" : "s"
                  }, ${channel.views.toLocaleString()} views all time`
                : "Reading the channel…"}
            </p>
          </div>
        </div>
        <div className="yt-ranges">
          {RANGES.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`yt-range${range === k ? " on" : ""}`}
              onClick={() => setRange(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {err ? <p className="admin-err">{err}</p> : null}
      {msg ? <p className="yt-ok">{msg}</p> : null}

      {unavailable ? (
        <p className="yt-note yt-warn">{unavailable}</p>
      ) : (
        <>
          <ul className="yt-figs">
            {FIGURES.map(([key, label, suffix]) => {
              const c = growth?.change?.[key];
              return (
                <li className="yt-fig" key={key}>
                  <span className="yt-fig-n">
                    {fmt(c?.now)}
                    {suffix && c?.now ? <i>{suffix}</i> : null}
                  </span>
                  <span className="yt-fig-l">{label}</span>
                  <span
                    className={`yt-fig-d${
                      c?.delta > 0 ? " up" : c?.delta < 0 ? " down" : ""
                    }`}
                  >
                    {delta(c)}
                  </span>
                </li>
              );
            })}
          </ul>
          {growth?.previous ? (
            <p className="yt-against">
              against {growth.previous.startDate} to {growth.previous.endDate}, the same length
              immediately before
            </p>
          ) : null}

          {/* THE one loud element: a real day per bar. */}
          {bars.length ? (
            <section className="yt-strip" aria-label="Views per day">
              <div className="yt-bars">
                {bars.map((b) => (
                  <div
                    key={b.day}
                    className={`yt-bar${b.subs ? " gained" : ""}`}
                    style={{ "--h": `${b.h}%` }}
                    title={`${b.day}: ${b.views} views${b.subs ? `, +${b.subs} subscribers` : ""}`}
                  />
                ))}
              </div>
              <p className="yt-strip-foot">
                <span>{bars[0]?.day}</span>
                <span>
                  a bar is a day that had views; amber means you gained a subscriber
                </span>
                <span>{bars[bars.length - 1]?.day}</span>
              </p>
            </section>
          ) : daily?.available === false ? null : (
            <p className="yt-note">No days with any views in this window.</p>
          )}
        </>
      )}

      {/* ---- what did the work ---- */}
      <section className="yt-block">
        <h3 className="yt-h">What did the work</h3>
        <p className="yt-note">
          Ranked by what each video did in this window, not by lifetime views — a video that did
          well two years ago tells you nothing about what to make next.
        </p>
        {videos?.available === false ? (
          <p className="yt-note yt-warn">{videos.why}</p>
        ) : videos?.rows?.length ? (
          <ul className="yt-vids">
            {videos.rows.map((r) => {
              const v = titles[r.video];
              return (
                <li key={r.video}>
                  {v?.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="yt-thumb" src={v.thumbnail} alt="" />
                  ) : (
                    <span className="yt-thumb yt-thumb-blank" />
                  )}
                  <span className="yt-vid-t">
                    <a href={`https://www.youtube.com/watch?v=${r.video}`} target="_blank" rel="noreferrer noopener">
                      {v?.title || r.video}
                    </a>
                    {v?.privacy && v.privacy !== "public" ? (
                      <em className="yt-priv">{v.privacy}</em>
                    ) : null}
                  </span>
                  <span className="yt-vid-n">{fmt(r.views)} views</span>
                  <span className="yt-vid-n dim">{fmt(r.estimatedMinutesWatched)} min</span>
                  <span className="yt-vid-n dim">{fmt(r.averageViewDuration)}s avg</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="yt-note">Nothing was watched in this window.</p>
        )}
      </section>

      {/* ---- channel configuration ---- */}
      <ChannelConfig
        config={config}
        onSave={async (patch) => {
          setBusy("Saving the channel…");
          setErr("");
          setMsg("");
          try {
            const out = await ask({ action: "updateChannel", ...patch });
            setChannel((c) => ({ ...c, title: out.title, description: out.description }));
            setConfig(await ask({ action: "channelConfig" }));
            setMsg("Channel saved. YouTube can take a few minutes to show it.");
          } catch (e) {
            setErr(e.message);
          } finally {
            setBusy("");
          }
        }}
        busy={!!busy}
      />

      {busy ? <p className="yt-note">{busy}</p> : null}
      <YouTubeStyles />
    </main>
  );
}

/* ------------------------------------------------------------------ */

export function ChannelConfig({ config, onSave, busy }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!config) return;
    setTitle(config.title || "");
    setDescription(config.description || "");
    setKeywords((config.keywords || []).join(", "));
  }, [config]);

  if (!config) return null;

  return (
    <details className="yt-block yt-config" open={open} onToggle={(e) => setOpen(e.target.open)}>
      <summary>
        <span className="yt-h">How the channel describes itself</span>
        <span className="yt-from">edited about once a year</span>
      </summary>

      <p className="yt-note">
        YouTube&apos;s channel update <strong>replaces</strong> the whole record, so this reads the
        current values first and sends back everything it did not mean to change — editing the
        title cannot wipe the description or the keywords.
      </p>

      <label className="yt-field">
        <span>Name</span>
        <input
          className="admin-input"
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
        />
        <em>{100 - title.length} left</em>
      </label>

      <label className="yt-field">
        <span>Description</span>
        <textarea
          className="admin-input yt-area"
          rows={5}
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <em>{1000 - description.length} left</em>
      </label>

      <label className="yt-field">
        <span>Keywords</span>
        <input
          className="admin-input"
          value={keywords}
          placeholder="distributed systems, rust, container runtime"
          onChange={(e) => setKeywords(e.target.value)}
        />
        <em>commas between them; a keyword with a space is quoted for you</em>
      </label>

      <button
        type="button"
        className="admin-primary"
        disabled={busy}
        onClick={() => onSave({ title, description, keywords })}
      >
        Save channel
      </button>
    </details>
  );
}

/* ------------------------------------------------------------------ */

export function YouTubeStyles() {
  return (
    <style jsx global>{`
      /* ---- the channel switcher ---- */
      .yt-chans {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin: 0 0 18px;
      }
      .yt-chan {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        min-width: 180px;
        max-width: 280px;
        padding: 9px 14px 9px 11px;
        border: 1px solid var(--a-line, #2b3040);
        border-left: 3px solid transparent;
        border-radius: 10px;
        background: var(--a-raise, #15171d);
        color: var(--a-text, #e7e8ee);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .yt-chan.on {
        border-left-color: var(--a-amber, #ffb020);
      }
      .yt-chan.bad {
        border-left-color: #a33b45;
      }
      .yt-chan:focus-visible {
        outline: 2px solid var(--a-amber, #ffb020);
        outline-offset: 2px;
      }
      .yt-chan-name {
        font-family: "Space Grotesk", sans-serif;
        font-weight: 600;
        font-size: 13.5px;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .yt-chan-mail {
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .yt-chan-add {
        background: none;
        border-style: dashed;
        border-left: 1px dashed var(--a-line, #2b3040);
        color: var(--a-dim, #8b90a0);
      }
      .yt-chan-add .yt-chan-name {
        color: var(--a-dim, #8b90a0);
      }
      .yt-empty {
        max-width: 60ch;
        display: grid;
        gap: 12px;
        justify-items: start;
        padding: 12px 0;
      }
      .yt-top {
        display: flex;
        align-items: flex-start;
        gap: 16px;
        flex-wrap: wrap;
        padding-bottom: 14px;
        border-bottom: 1px solid var(--a-line, #2b3040);
      }
      .yt-who {
        display: flex;
        gap: 13px;
        align-items: center;
      }
      .yt-face {
        width: 44px;
        height: 44px;
        border-radius: 50%;
      }
      .yt-name {
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: 19px;
        margin: 0;
        color: var(--a-text, #e7e8ee);
      }
      .yt-sum {
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
      }
      .yt-ranges {
        margin-left: auto;
        display: flex;
        gap: 6px;
      }
      .yt-range {
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 7px;
        color: var(--a-dim, #8b90a0);
        font: inherit;
        font-size: 11.5px;
        padding: 5px 11px;
        cursor: pointer;
      }
      .yt-range.on {
        color: #ffb020;
        border-color: #ffb020;
      }
      .yt-range:focus-visible {
        outline: 2px solid #ffb020;
        outline-offset: 2px;
      }

      .yt-figs {
        list-style: none;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 1px;
        margin: 18px 0 0;
        padding: 0;
        background: var(--a-line, #2b3040);
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 10px;
        overflow: hidden;
      }
      .yt-fig {
        background: var(--a-panel, #151823);
        padding: 14px 15px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .yt-fig-n {
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: 26px;
        line-height: 1.1;
        color: var(--a-text, #e7e8ee);
      }
      .yt-fig-n i {
        font-size: 14px;
        font-style: normal;
        color: var(--a-dim, #8b90a0);
      }
      .yt-fig-l {
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      .yt-fig-d {
        font-size: 11px;
        color: var(--a-dim, #8b90a0);
      }
      .yt-fig-d.up {
        color: #5fb87a;
      }
      .yt-fig-d.down {
        color: #e0564a;
      }
      .yt-against {
        margin: 8px 0 0;
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }

      /* The one loud element. */
      .yt-strip {
        margin-top: 20px;
      }
      .yt-bars {
        display: flex;
        align-items: flex-end;
        justify-content: flex-start;
        gap: 2px;
        height: 110px;
        padding: 0 1px;
        border-bottom: 1px solid var(--a-line, #2b3040);
      }
      .yt-bar {
        flex: 1 1 0;
        min-width: 2px;
        /* Capped, or a window with two days of data draws two slabs half the
           width of the page. A bar has to stay recognisably a bar whether
           there are three of them or three hundred. */
        max-width: 12px;
        height: var(--h);
        min-height: 1px;
        background: #3a4154;
        border-radius: 2px 2px 0 0;
        transform-origin: bottom;
        animation: yt-rise 0.5s cubic-bezier(0.2, 0.9, 0.3, 1) both;
      }
      .yt-bar.gained {
        background: #ffb020;
      }
      @keyframes yt-rise {
        from {
          transform: scaleY(0);
        }
      }
      .yt-strip-foot {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin: 7px 0 0;
        font-size: 11px;
        color: var(--a-dim, #8b90a0);
      }
      .yt-strip-foot span:nth-child(2) {
        text-align: center;
      }

      .yt-block {
        margin-top: 26px;
        padding-top: 18px;
        border-top: 1px solid var(--a-line, #2b3040);
      }
      .yt-h {
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: 14.5px;
        font-weight: 600;
        margin: 0;
        color: var(--a-text, #e7e8ee);
      }
      .yt-from {
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      .yt-note {
        font-size: 12px;
        line-height: 1.65;
        color: var(--a-dim, #8b90a0);
        margin: 9px 0 0;
        max-width: 74ch;
      }
      .yt-warn {
        border-left: 2px solid #ffb020;
        padding-left: 11px;
      }
      .yt-ok {
        color: #ffb020;
        font-size: 12.5px;
        margin: 10px 0 0;
      }

      .yt-vids {
        list-style: none;
        margin: 14px 0 0;
        padding: 0;
      }
      .yt-vids li {
        display: flex;
        align-items: center;
        gap: 13px;
        padding: 9px 0;
        border-top: 1px solid var(--a-line, #2b3040);
      }
      .yt-thumb {
        width: 72px;
        height: 41px;
        object-fit: cover;
        border-radius: 5px;
        flex: none;
      }
      .yt-thumb-blank {
        background: var(--a-line, #2b3040);
      }
      .yt-vid-t {
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
        min-width: 0;
        flex: 1 1 auto;
      }
      .yt-vid-t a {
        color: inherit;
        text-decoration: none;
      }
      .yt-vid-t a:hover {
        color: #ffb020;
      }
      .yt-priv {
        margin-left: 8px;
        font-style: normal;
        font-size: 10.5px;
        color: var(--a-dim, #8b90a0);
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 999px;
        padding: 1px 7px;
      }
      .yt-vid-n {
        flex: none;
        font-size: 12px;
        color: var(--a-text, #e7e8ee);
        font-family: "JetBrains Mono", ui-monospace, monospace;
      }
      .yt-vid-n.dim {
        color: var(--a-dim, #8b90a0);
      }

      .yt-config summary {
        cursor: pointer;
        display: flex;
        align-items: baseline;
        gap: 12px;
        flex-wrap: wrap;
      }
      .yt-field {
        display: block;
        margin-top: 14px;
      }
      .yt-field > span {
        display: block;
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
        margin-bottom: 4px;
      }
      .yt-field > em {
        display: block;
        margin-top: 4px;
        font-style: normal;
        font-size: 11px;
        color: var(--a-dim, #8b90a0);
      }
      .yt-field .admin-input {
        width: 100%;
        max-width: 620px;
      }
      .yt-area {
        font-family: inherit;
        line-height: 1.6;
      }
      .yt-config .admin-primary {
        margin-top: 16px;
      }

      @media (max-width: 720px) {
        .yt-ranges {
          margin-left: 0;
          width: 100%;
        }
        .yt-vids li {
          flex-wrap: wrap;
        }
        .yt-vid-t {
          flex: 1 1 100%;
          order: -1;
        }
        .admin-input {
          font-size: 16px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .yt-bar {
          animation: none;
        }
      }
    `}</style>
  );
}
