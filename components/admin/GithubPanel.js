// GitHub, in the admin.
//
// DESIGN
//
// Several GitHub accounts can be connected, and the first question is not
// "what are my repositories" but "which account is doing what". So the page
// opens on LANES: one row per account carrying its year of contributions as
// fifty-two weekly bars, drawn on ONE shared scale. The busy account and the
// dormant one are told apart before a single word is read — that strip is the
// one bold element on the page, and amber stays what it is everywhere else in
// this console: the mark of the one you have selected.
//
// The selected account opens into three views, each answering one question:
//   Overview      who is this account, and what has it been doing
//   Repositories  which repositories matter, under a filter you choose —
//                 every row is a link straight to GitHub
//   Fix up        which repositories are letting the profile down, and the
//                 fields that fix them (the audit this panel used to be)
//
// Visual language is the console's, unchanged: state on the left edge,
// hairlines rather than middots, figures with a direction rather than bare
// counts, sentence-case labels, Space Grotesk for names and numbers.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getProfile,
  getAnalytics,
  getTraffic,
  updateProfile,
  listRepos,
  updateRepo,
  createRepo,
  getReadme,
  writeReadme,
  auditRepos,
  forgetToken,
  setAccount,
  rankRepos,
  repoTotals,
  levelsFor,
  ago,
  SORTS,
  WINDOWS,
} from "../../lib/github";
import { connectProvider, finishConnect, forgetAccount } from "../../lib/accountsClient";
import { logAdminAction } from "../../lib/auditLog";

const GITHUB = "github";
const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : "—");

/* ================= the panel ================= */

export default function GithubPanel({ user }) {
  const [status, setStatus] = useState(null);
  const [data, setData] = useState({});
  const [sel, setSel] = useState("");
  const [view, setView] = useState("overview");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const accounts = status?.accounts || [];

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/integrations/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: "{}",
    });
    const json = await res.json().catch(() => ({}));
    const gh = (json.providers || []).find((p) => p.provider === GITHUB) || {
      connected: false,
      accounts: [],
      detail: json.error || "GitHub is not set up on this deployment.",
    };
    setStatus(gh);
    return gh;
  }, [user]);

  // Each account is read on its own, in parallel, and fails on its own: one
  // revoked token must not blank the lane of an account that is fine.
  const loadAccount = useCallback(async (accountId) => {
    setData((d) => ({ ...d, [accountId]: { ...(d[accountId] || {}), loading: true, error: "" } }));
    try {
      const [profile, analytics, repos] = await Promise.all([
        getProfile(accountId),
        getAnalytics(accountId),
        listRepos({ includeForks: true, account: accountId }),
      ]);
      setData((d) => ({ ...d, [accountId]: { profile, analytics, repos, loading: false, error: "" } }));
    } catch (e) {
      setData((d) => ({
        ...d,
        [accountId]: { ...(d[accountId] || {}), loading: false, error: e.message || "GitHub could not be read." },
      }));
    }
  }, []);

  const loadAll = useCallback(
    async (gh) => {
      const list = gh?.accounts || [];
      if (!list.length) return;
      setSel((s) => (s && list.some((a) => a.accountId === s) ? s : list[0].accountId));
      await Promise.all(list.map((a) => loadAccount(a.accountId)));
    },
    [loadAccount]
  );

  useEffect(() => {
    (async () => {
      // The callback seals the credential into a five-minute httpOnly cookie
      // and the signed-in BROWSER writes it. Skipping the claim loses a consent
      // that already happened — the account simply never appears.
      try {
        const q = new URLSearchParams(window.location.search);
        const connected = q.get("connected");
        const failed = q.get("connectError");
        if (connected === GITHUB) {
          setBusy("Saving the GitHub connection…");
          try {
            await finishConnect(GITHUB);
            setMsg(`Connected ${q.get("account") || "GitHub"}.`);
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
      setBusy("");
      const gh = await loadStatus().catch((e) => {
        setErr(e.message);
        return null;
      });
      await loadAll(gh);
    })();
    // Page-load sequence, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The unqualified client calls (README, topics, profile edits in Fix up) act
  // as whichever account is selected.
  useEffect(() => setAccount(sel), [sel]);

  const connect = async () => {
    setBusy("Opening GitHub…");
    setErr("");
    try {
      // Back to this tab, through GitHub's account chooser.
      await connectProvider(GITHUB, "github");
    } catch (e) {
      setErr(e.message);
      setBusy("");
    }
  };

  const disconnect = async (accountId) => {
    setBusy("Disconnecting…");
    setErr("");
    try {
      await forgetAccount(GITHUB, accountId);
      forgetToken(accountId);
      setData(({ [accountId]: _gone, ...rest }) => rest);
      const gh = await loadStatus();
      setSel(gh.accounts?.[0]?.accountId || "");
      setMsg(
        `${accountId} disconnected. The app stays listed under that account's Settings → Applications until you revoke it there.`
      );
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  // One scale for every lane, so a quiet account LOOKS quiet next to a busy
  // one. Per-lane scaling would draw every account as equally busy.
  const laneMax = useMemo(
    () =>
      Math.max(
        1,
        ...Object.values(data).flatMap((d) => d.analytics?.calendar?.weekly || [0])
      ),
    [data]
  );

  /* ---------------- render ---------------- */

  if (status === null) {
    return (
      <div className="gx">
        <p className="gx-busy">{busy || "Checking the GitHub connection…"}</p>
        <HubStyles />
      </div>
    );
  }

  if (status.configured === false) {
    return (
      <div className="gx">
        <Setup missing={status.missing || []} />
        {err ? <p className="admin-err">{err}</p> : null}
        <HubStyles />
      </div>
    );
  }

  if (!accounts.length) {
    return (
      <div className="gx">
        <section className="gx-empty">
          <h3>Connect a GitHub account</h3>
          <p>
            Connect as many accounts as you hold. Each one gets its own lane here, its own
            analytics, and its own repositories — and every change is made as the account you
            picked, never a guess.
          </p>
          <button className="admin-primary" type="button" onClick={connect} disabled={!!busy}>
            Connect GitHub
          </button>
          {err ? <p className="admin-err">{err}</p> : null}
        </section>
        <HubStyles />
      </div>
    );
  }

  const cur = data[sel] || {};
  const curAccount = accounts.find((a) => a.accountId === sel);

  return (
    <div className="gx">
      {busy ? <p className="gx-busy">{busy}</p> : null}
      {err ? <p className="admin-err">{err}</p> : null}
      {msg ? <p className="gx-ok">{msg}</p> : null}

      <section className="gx-lanes" aria-label="GitHub accounts">
        {accounts.map((a) => (
          <Lane
            key={a.accountId}
            account={a}
            data={data[a.accountId] || {}}
            max={laneMax}
            selected={a.accountId === sel}
            onSelect={() => setSel(a.accountId)}
          />
        ))}
        <button className="gx-add" type="button" onClick={connect} disabled={!!busy}>
          <span aria-hidden="true">+</span>
          Connect another GitHub account
        </button>
      </section>

      {curAccount?.missingScopes?.length ? (
        <p className="gx-scope">
          This connection predates some permissions ({curAccount.missingScopes.join(", ")}).
          Private repositories, traffic or workflow files may be refused until you reconnect.
          <button className="admin-ghost" type="button" onClick={connect}>
            Reconnect
          </button>
        </p>
      ) : null}

      <nav className="gx-views" aria-label="Account views">
        {[
          ["overview", "Overview"],
          ["repos", "Repositories"],
          ["fixup", "Fix up"],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`gx-view${view === k ? " on" : ""}`}
            aria-pressed={view === k}
            onClick={() => setView(k)}
          >
            {label}
          </button>
        ))}
        <span className="gx-views-end">
          <button className="admin-ghost" type="button" onClick={() => loadAccount(sel)} disabled={cur.loading}>
            {cur.loading ? "Reading…" : "Refresh"}
          </button>
          <button className="admin-ghost" type="button" onClick={() => disconnect(sel)} disabled={!!busy}>
            Disconnect
          </button>
        </span>
      </nav>

      {cur.error ? <p className="admin-err">{cur.error}</p> : null}

      {view === "overview" ? (
        cur.profile && cur.analytics ? (
          <Overview key={sel} accountId={sel} profile={cur.profile} analytics={cur.analytics} repos={cur.repos || []} />
        ) : (
          <p className="gx-busy">{cur.loading ? "Reading this account…" : ""}</p>
        )
      ) : null}

      {view === "repos" ? <Repositories data={data} accounts={accounts} sel={sel} /> : null}

      {view === "fixup" ? (
        cur.profile ? (
          <FixUp
            key={sel}
            user={user}
            profile={cur.profile}
            repos={(cur.repos || []).filter((r) => !r.isFork)}
            onProfile={(p) => setData((d) => ({ ...d, [sel]: { ...d[sel], profile: { ...d[sel].profile, ...p } } }))}
            onReload={() => loadAccount(sel)}
          />
        ) : null
      ) : null}

      <HubStyles />
      <GithubStyles />
    </div>
  );
}

/* ================= not set up ================= */

function Setup({ missing }) {
  const origins = ["https://www.ravikishan.me", "https://ravikishan.me"];
  if (typeof window !== "undefined" && !origins.includes(window.location.origin)) {
    origins.push(window.location.origin);
  }
  const uris = origins.map((o) => `${o}/api/integrations/github/callback`);
  // Half set up is the commonest state — the client id is public and easy to
  // paste, the secret is shown once and easy to lose. Say exactly that rather
  // than restarting the whole recipe.
  if (missing.length === 1 && missing[0] === "GITHUB_CLIENT_SECRET") {
    return (
      <section className="gx-empty">
        <h3>One value left: the client secret</h3>
        <p>
          The OAuth app and its client id are in place. Open the app in{" "}
          <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer noopener">
            GitHub developer settings
          </a>
          , choose <b>Generate a new client secret</b> and copy it. GitHub shows it only once.
        </p>
        <p>
          Then set <code>GITHUB_CLIENT_SECRET</code> in the{" "}
          <a href="/admin?tab=env">Environment tab</a>. This page connects on the next load.
        </p>
      </section>
    );
  }
  return (
    <section className="gx-empty">
      <h3>Set up GitHub</h3>
      <ol className="gx-steps">
        <li>
          Create an OAuth app at{" "}
          <a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer noopener">
            github.com/settings/applications/new
          </a>
          . Leave “Expire user access tokens” off.
        </li>
        <li>
          Add every one of these as a redirect URI:
          <ul className="gx-uris">
            {uris.map((u) => (
              <li key={u}>
                <code>{u}</code>
                <button
                  className="admin-ghost"
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(u)}
                >
                  Copy
                </button>
              </li>
            ))}
          </ul>
        </li>
        <li>
          Generate a client secret, then add <code>{missing.join(" and ") || "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET"}</code>{" "}
          in the Environment tab. Values saved there are live on the next request.
        </li>
      </ol>
    </section>
  );
}

/* ================= one account's lane ================= */

export function Lane({ account, data, max, selected, onSelect }) {
  const p = data.profile;
  const cal = data.analytics?.calendar;
  const weekly = cal?.weekly || [];
  const W = 7;
  const GAP = 3;
  const H = 34;
  const width = Math.max(weekly.length, 1) * (W + GAP);
  return (
    <button
      type="button"
      className={`gx-lane${selected ? " on" : ""}${data.error ? " bad" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {p?.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="gx-lane-av" src={p.avatar} alt="" width={36} height={36} />
      ) : (
        <span className="gx-lane-av gx-lane-av-blank" aria-hidden="true" />
      )}
      <span className="gx-lane-who">
        <span className="gx-lane-name">{p?.name || account.label || account.accountId}</span>
        <span className="gx-lane-login">@{p?.login || account.accountId}</span>
      </span>
      <span className="gx-tide" aria-hidden="true">
        {weekly.length ? (
          <svg viewBox={`0 0 ${width} ${H}`} preserveAspectRatio="none">
            {weekly.map((n, i) => {
              const h = n ? Math.max(2, (n / max) * H) : 1;
              return (
                <rect
                  key={i}
                  x={i * (W + GAP)}
                  y={H - h}
                  width={W}
                  height={h}
                  rx={1}
                  className={n ? "on" : "off"}
                />
              );
            })}
          </svg>
        ) : (
          <span className="gx-tide-wait">{data.error ? "Unreadable" : data.loading ? "Reading the year…" : ""}</span>
        )}
      </span>
      <span className="gx-lane-fig">
        {cal ? (
          <>
            <strong>{fmt(data.analytics.contributions.total)}</strong>
            <span>contributions this year</span>
          </>
        ) : data.error ? (
          <span className="gx-lane-err">{data.error}</span>
        ) : null}
      </span>
    </button>
  );
}

/* ================= overview ================= */

function Figure({ value, label, change, against }) {
  return (
    <div className="gx-fig">
      <strong>{value}</strong>
      <span className="gx-fig-label">{label}</span>
      {change !== undefined ? (
        <span className={`gx-fig-delta${change > 0 ? " up" : change < 0 ? " down" : ""}`}>
          {change === null
            ? `new against ${against}`
            : change === 0
            ? `level with ${against}`
            : `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}% on ${against}`}
        </span>
      ) : null}
    </div>
  );
}

// `trafficRows` lets the design preview render traffic without a network; the
// live page leaves it out and reads GitHub.
export function Overview({ accountId, profile, analytics, repos, trafficRows }) {
  const totals = useMemo(() => repoTotals(repos), [repos]);
  const cal = analytics.calendar;
  const c = analytics.contributions;
  const [traffic, setTraffic] = useState(trafficRows || null);

  // Traffic for the six most recently changed originals. Two requests each,
  // so it is bounded; GitHub keeps fourteen days and that is all there is.
  const trafficFor = useMemo(
    () => rankRepos(repos, { sort: "pushed", includeArchived: false, limit: 6 }),
    [repos]
  );
  useEffect(() => {
    if (trafficRows) return undefined;
    let live = true;
    setTraffic(null);
    Promise.all(trafficFor.map((r) => getTraffic(r.owner || profile.login, r.name, accountId))).then(
      (rows) => live && setTraffic(rows)
    );
    return () => {
      live = false;
    };
  }, [trafficFor, accountId, profile.login, trafficRows]);

  const joined = profile.createdAt ? new Date(profile.createdAt) : null;
  const years = joined ? Math.floor((Date.now() - joined.getTime()) / (365.25 * 86400000)) : 0;

  const facts = [
    ["Joined", joined ? `${joined.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}${years ? ` (${years} year${years === 1 ? "" : "s"})` : ""}` : ""],
    ["Location", profile.location],
    ["Company", profile.company],
    ["Website", profile.blog ? <a href={/^https?:/.test(profile.blog) ? profile.blog : `https://${profile.blog}`} target="_blank" rel="noreferrer noopener">{profile.blog.replace(/^https?:\/\//, "")}</a> : ""],
    ["Email", profile.email],
    ["X", profile.twitter ? <a href={`https://x.com/${profile.twitter}`} target="_blank" rel="noreferrer noopener">@{profile.twitter}</a> : ""],
    ["Plan", profile.plan ? profile.plan[0].toUpperCase() + profile.plan.slice(1) : ""],
    [
      "Two-factor",
      profile.twoFactor === null ? "" : profile.twoFactor ? "On" : <span className="gx-warn">Off — turn it on in GitHub settings</span>,
    ],
    ["Gists", `${fmt(profile.publicGists)} public${profile.privateGists != null ? `, ${fmt(profile.privateGists)} secret` : ""}`],
    ["Storage", profile.diskUsageKb != null ? `${(profile.diskUsageKb / 1024).toFixed(1)} MB` : ""],
    ["Open to work", profile.hireable ? "Marked hireable" : "Not marked"],
  ].filter(([, v]) => v);

  return (
    <div className="gx-over">
      <aside className="gx-id">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="gx-id-av" src={profile.avatar} alt="" width={88} height={88} />
        <h3>{profile.name || profile.login}</h3>
        <a className="gx-id-login" href={profile.url} target="_blank" rel="noreferrer noopener">
          github.com/{profile.login}
        </a>
        {profile.bio ? <p className="gx-id-bio">{profile.bio}</p> : <p className="gx-id-bio gx-dim">No bio yet. Add one in Fix up.</p>}
        <dl className="gx-facts">
          {facts.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </React.Fragment>
          ))}
        </dl>
        {analytics.organizations.length ? (
          <div className="gx-orgs">
            <span className="gx-sub-h">Organisations</span>
            <div>
              {analytics.organizations.map((o) => (
                <a key={o.login} href={o.url} target="_blank" rel="noreferrer noopener" title={o.name}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={o.avatar} alt={o.name} width={28} height={28} />
                </a>
              ))}
            </div>
          </div>
        ) : null}
        <a className="admin-ghost gx-id-open" href={profile.url} target="_blank" rel="noreferrer noopener">
          Open profile on GitHub
        </a>
      </aside>

      <div className="gx-body">
        <div className="gx-figs">
          <Figure value={fmt(cal.last30)} label="Contributions, past 30 days" change={cal.change30} against="the 30 before" />
          <Figure
            value={`${cal.streak.current} day${cal.streak.current === 1 ? "" : "s"}`}
            label={`Current streak, longest ${cal.streak.longest}`}
          />
          <Figure value={fmt(totals.stars)} label={`Stars earned across ${totals.repos} repositories`} />
          <Figure value={fmt(profile.followers)} label={`Followers, following ${fmt(profile.following)}`} />
          <Figure
            value={fmt(totals.repos)}
            label={`Repositories: ${fmt(totals.publicRepos)} public, ${fmt(totals.privateRepos)} private${totals.forks ? `, plus ${totals.forks} fork${totals.forks === 1 ? "" : "s"}` : ""}`}
          />
        </div>

        <section className="gx-card">
          <header className="gx-card-h">
            <h4>{fmt(c.total)} contributions in the past year</h4>
            <span>
              Active on {cal.activeDays} days
              {cal.busiestWeekday ? <> <i className="gx-hair" aria-hidden="true" /> busiest on {cal.busiestWeekday}s</> : null}
              {c.private ? <> <i className="gx-hair" aria-hidden="true" /> {fmt(c.private)} in private repositories</> : null}
            </span>
          </header>
          <Calendar days={cal.days} />
        </section>

        <div className="gx-pair">
          <section className="gx-card">
            <header className="gx-card-h">
              <h4>What the year was made of</h4>
            </header>
            <Mix
              rows={[
                ["Commits", c.commits],
                ["Pull requests", c.pullRequests],
                ["Reviews", c.reviews],
                ["Issues", c.issues],
                ["New repositories", c.newRepositories],
              ]}
            />
            <Weekdays counts={cal.byWeekday} />
          </section>

          <section className="gx-card">
            <header className="gx-card-h">
              <h4>Languages</h4>
              <span>By bytes of code across {analytics.languagesSampled} repositories, forks excluded</span>
            </header>
            <Languages langs={analytics.languages} />
          </section>
        </div>

        <section className="gx-card">
          <header className="gx-card-h">
            <h4>Traffic, past 14 days</h4>
            <span>The six most recently changed repositories. GitHub keeps no longer history than this.</span>
          </header>
          <Traffic rows={traffic} repos={trafficFor} />
        </section>
      </div>
    </div>
  );
}

export function Calendar({ days }) {
  const level = useMemo(() => levelsFor(days || []), [days]);
  if (!days?.length) return <p className="gx-dim">No contributions recorded in the past year.</p>;
  // Columns are weeks starting Sunday, like GitHub's own, so a reader's eye
  // finds the same day in the same row.
  const first = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const CELL = 11;
  const GAP = 3;
  const TOP = 14;
  const cells = days.map((d, i) => {
    const idx = i + first;
    return { ...d, x: Math.floor(idx / 7), y: idx % 7 };
  });
  const cols = cells[cells.length - 1].x + 1;
  const months = [];
  let last = "";
  for (const c of cells) {
    const m = c.date.slice(0, 7);
    if (m !== last && c.y === 0) {
      months.push({ x: c.x, label: new Date(`${c.date}T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" }) });
      last = m;
    }
  }
  const w = cols * (CELL + GAP);
  return (
    <div className="gx-cal-wrap">
      <svg
        className="gx-cal"
        viewBox={`0 0 ${w} ${TOP + 7 * (CELL + GAP)}`}
        style={{ minWidth: w }}
        role="img"
        aria-label="Contribution calendar for the past year"
      >
        {months.map((m, i) =>
          // A label squeezed against its neighbour, or against the edge, is noise.
          (i > 0 && m.x - months[i - 1].x < 3) || cols - m.x < 3 ? null : (
            <text key={m.x} x={m.x * (CELL + GAP)} y={10} className="gx-cal-m">
              {m.label}
            </text>
          )
        )}
        {cells.map((c) => (
          <rect
            key={c.date}
            x={c.x * (CELL + GAP)}
            y={TOP + c.y * (CELL + GAP)}
            width={CELL}
            height={CELL}
            rx={2}
            className={`l${level(c.contributionCount)}`}
          >
            <title>
              {c.contributionCount || "No"} contribution{c.contributionCount === 1 ? "" : "s"} on{" "}
              {new Date(`${c.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
            </title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

function Mix({ rows }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <dl className="gx-mix">
      {rows.map(([k, n]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd>
            <span className="gx-bar" style={{ width: `${(n / max) * 100}%` }} />
            <b>{fmt(n)}</b>
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function Weekdays({ counts }) {
  const max = Math.max(1, ...counts);
  const names = ["S", "M", "T", "W", "T", "F", "S"];
  const full = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return (
    <div className="gx-week" aria-label="Contributions by weekday">
      {counts.map((n, i) => (
        <span key={i} title={`${fmt(n)} on ${full[i]}s`}>
          <i style={{ height: `${Math.max(2, (n / max) * 44)}px` }} className={n === max && n ? "peak" : ""} />
          <em>{names[i]}</em>
        </span>
      ))}
    </div>
  );
}

function Languages({ langs }) {
  if (!langs?.length) return <p className="gx-dim">No language data yet.</p>;
  return (
    <>
      <div className="gx-langbar" aria-hidden="true">
        {langs.map((l) => (
          <span key={l.name} style={{ width: `${l.share * 100}%`, background: l.color || "#5c6377" }} />
        ))}
      </div>
      <ul className="gx-langs">
        {langs.map((l) => (
          <li key={l.name}>
            <i style={{ background: l.color || "#5c6377" }} aria-hidden="true" />
            {l.name}
            <b>{(l.share * 100).toFixed(l.share < 0.1 ? 1 : 0)}%</b>
          </li>
        ))}
      </ul>
    </>
  );
}

function Spark({ daily }) {
  if (!daily?.length) return null;
  const max = Math.max(1, ...daily.map((d) => d.count));
  const W = 84;
  const H = 18;
  const step = daily.length > 1 ? W / (daily.length - 1) : W;
  const pts = daily.map((d, i) => `${(i * step).toFixed(1)},${(H - (d.count / max) * H).toFixed(1)}`).join(" ");
  return (
    <svg className="gx-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <polyline points={pts} />
    </svg>
  );
}

function Traffic({ rows, repos }) {
  if (!repos.length) return <p className="gx-dim">No repositories to read traffic for.</p>;
  if (!rows) return <p className="gx-busy">Reading traffic…</p>;
  return (
    <table className="gx-traffic">
      <thead>
        <tr>
          <th scope="col">Repository</th>
          <th scope="col">Views</th>
          <th scope="col">Visitors</th>
          <th scope="col">Clones</th>
          <th scope="col" className="gx-hide-sm">Daily views</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t, i) => (
          <tr key={t.repo}>
            <th scope="row">
              <a href={repos[i]?.url} target="_blank" rel="noreferrer noopener">
                {t.repo}
              </a>
            </th>
            {t.error ? (
              <td colSpan={4} className="gx-dim">
                Unreadable — {t.error}
              </td>
            ) : (
              <>
                <td>{fmt(t.views)}</td>
                <td>{fmt(t.uniques)}</td>
                <td>{fmt(t.clones)}</td>
                <td className="gx-hide-sm">
                  <Spark daily={t.daily} />
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ================= repositories ================= */

export function Repositories({ data, accounts, sel }) {
  const [sort, setSort] = useState("pushed");
  const [win, setWin] = useState("all");
  const [language, setLanguage] = useState("");
  const [scope, setScope] = useState("one");
  const [visibility, setVisibility] = useState("all");
  const [forks, setForks] = useState(false);
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(25);

  const pool = useMemo(() => {
    const ids = scope === "all" ? accounts.map((a) => a.accountId) : [sel];
    return ids.flatMap((id) => (data[id]?.repos || []).map((r) => ({ ...r, account: id })));
  }, [data, accounts, sel, scope]);

  const languages = useMemo(
    () => [...new Set(pool.map((r) => r.language).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [pool]
  );

  const ranked = useMemo(
    () =>
      rankRepos(pool, {
        sort,
        window: win,
        language,
        visibility,
        includeForks: forks,
        includeArchived: archived,
        q,
      }),
    [pool, sort, win, language, visibility, forks, archived, q]
  );
  const shown = ranked.slice(0, limit);
  const dateOf = (r) => (sort === "created" ? r.createdAt : r.pushedAt);

  return (
    <section className="gx-repos">
      <div className="gx-ctl">
        <Segmented label="Sort" value={sort} onChange={setSort} options={Object.entries(SORTS)} />
        <Segmented
          label="Changed"
          value={win}
          onChange={setWin}
          options={Object.entries(WINDOWS).map(([k, v]) => [k, v.label])}
        />
      </div>
      <div className="gx-ctl gx-ctl-2">
        <input
          className="admin-input gx-q"
          placeholder="Search names, descriptions and topics"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search repositories"
        />
        <select className="admin-input gx-sel" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
          <option value="">Every language</option>
          {languages.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select className="admin-input gx-sel" value={visibility} onChange={(e) => setVisibility(e.target.value)} aria-label="Visibility">
          <option value="all">Public and private</option>
          <option value="public">Public only</option>
          <option value="private">Private only</option>
        </select>
        {accounts.length > 1 ? (
          <select className="admin-input gx-sel" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Accounts">
            <option value="one">This account</option>
            <option value="all">All {accounts.length} accounts</option>
          </select>
        ) : null}
        <label className="gx-check">
          <input type="checkbox" checked={forks} onChange={(e) => setForks(e.target.checked)} /> Forks
        </label>
        <label className="gx-check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived
        </label>
      </div>

      <p className="gx-count" role="status">
        {ranked.length === 0
          ? "No repository matches. Widen the window or clear the search."
          : `${ranked.length} ${ranked.length === 1 ? "repository" : "repositories"}, ${SORTS[sort].toLowerCase()}${
              win !== "all" ? `, changed in the ${WINDOWS[win].label.toLowerCase()}` : ""
            }`}
      </p>

      {/* A ranking, so the position is information: it is numbered. */}
      <ol className="gx-rank">
        {shown.map((r, i) => (
          <li key={`${r.account}/${r.name}`}>
            <a className="gx-row" href={r.url} target="_blank" rel="noreferrer noopener">
              <span className="gx-pos">{i + 1}</span>
              <span className="gx-row-main">
                <span className="gx-row-name">
                  {scope === "all" ? <span className="gx-row-owner">{r.owner || r.account}/</span> : null}
                  {r.name}
                  {r.private ? <i className="gx-flag">private</i> : null}
                  {r.isFork ? <i className="gx-flag">fork</i> : null}
                  {r.archived ? <i className="gx-flag">archived</i> : null}
                </span>
                {r.description ? <span className="gx-row-desc">{r.description}</span> : null}
                <span className="gx-row-meta">
                  {r.language ? <span>{r.language}</span> : null}
                  <span>{fmt(r.stars)} star{r.stars === 1 ? "" : "s"}</span>
                  {r.forks ? <span>{fmt(r.forks)} fork{r.forks === 1 ? "" : "s"}</span> : null}
                  <span>
                    {sort === "created" ? "created" : "changed"} {ago(dateOf(r))}
                  </span>
                </span>
              </span>
              <span className="gx-row-go">Open on GitHub</span>
            </a>
          </li>
        ))}
      </ol>
      {ranked.length > shown.length ? (
        <button className="admin-ghost gx-more" type="button" onClick={() => setLimit((n) => n + 25)}>
          Show {Math.min(25, ranked.length - shown.length)} more
        </button>
      ) : null}
    </section>
  );
}

function Segmented({ label, value, onChange, options }) {
  return (
    <div className="gx-seg" role="radiogroup" aria-label={label}>
      <span className="gx-seg-l">{label}</span>
      {options.map(([k, l]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          className={value === k ? "on" : ""}
          onClick={() => onChange(k)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/* ================= fix up: the audit ================= */

function FixUp({ user, profile, repos: initial, onProfile, onReload }) {
  const [repos, setRepos] = useState(initial);
  const [readmes, setReadmes] = useState({});
  const [filter, setFilter] = useState("attention");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => setRepos(initial), [initial]);

  // READMEs are one request each, so they are fetched on demand rather than up
  // front: 59 extra calls to open a panel is a quarter of the hourly rate limit
  // spent before you have touched anything.
  const loadReadmes = async () => {
    setBusy("Checking every README…");
    try {
      const next = {};
      for (const r of repos) {
        const f = await getReadme(r.owner || profile.login, r.name);
        next[r.name] = f.missing ? null : f.content;
      }
      setReadmes(next);
      setMsg("READMEs checked.");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const audit = useMemo(() => auditRepos(repos, { readmes }), [repos, readmes]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = repos;
    if (filter === "attention") list = list.filter((r) => audit.byRepo[r.name]?.length);
    if (filter === "archived") list = list.filter((r) => r.archived);
    if (term) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          r.description.toLowerCase().includes(term) ||
          r.topics.some((t) => t.includes(term))
      );
    }
    // Most-starred first: if something has to be fixed by hand, fix the one
    // most people see.
    return [...list].sort((a, b) => b.stars - a.stars);
  }, [repos, filter, q, audit]);

  const run = async (label, fn) => {
    setBusy(label);
    setErr("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setErr(e.message || "That did not work.");
    } finally {
      setBusy("");
    }
  };

  const saveRepo = (repo, patch) =>
    run("Saving…", async () => {
      const owner = repo.owner || profile.login;
      await updateRepo(owner, repo.name, patch);
      // Re-read rather than patching state by hand: GitHub normalises topics
      // and trims descriptions, and a row that disagrees with the server is
      // how you end up "fixing" the same repo twice.
      setRepos(await listRepos());
      onReload();
      setMsg(`${repo.name} updated.`);
      logAdminAction({ action: "github.repo", target: `${owner}/${repo.name}`, detail: Object.keys(patch).join(", "), user });
    });

  const saveReadme = (repo, file, content, message) =>
    run("Committing…", async () => {
      const owner = repo.owner || profile.login;
      await writeReadme(owner, repo.name, { ...file, content, message });
      const fresh = await getReadme(owner, repo.name);
      setReadmes((m) => ({ ...m, [repo.name]: fresh.content }));
      setMsg(`README committed to ${repo.name}.`);
      logAdminAction({ action: "github.readme", target: `${owner}/${repo.name}`, detail: message || "Update README.md", user });
    });

  const saveProfile = (patch) =>
    run("Saving…", async () => {
      onProfile(await updateProfile(patch));
      setMsg("Profile updated.");
      logAdminAction({ action: "github.profile", target: profile.login, detail: Object.keys(patch).join(", "), user });
    });

  const makeRepo = () => {
    const name = window.prompt(`New repository under ${profile.login}:`);
    if (!name?.trim()) return;
    run("Creating…", async () => {
      const made = await createRepo({ name: name.trim() });
      setRepos(await listRepos());
      onReload();
      setMsg(`Created ${made.fullName}.`);
    });
  };

  return (
    <div className="gh-main">
      <div className="gx-fix-h">
        <p className="admin-sub gh-sub">
          Everything here saves straight to GitHub as <b>@{profile.login}</b>. A README change is a real commit.
        </p>
        <button className="admin-ghost" type="button" onClick={makeRepo} disabled={!!busy}>
          New repository
        </button>
      </div>

      {busy ? <p className="gh-busy">{busy}</p> : null}
      {err ? <p className="admin-err">{err}</p> : null}
      {msg ? <p className="gh-ok">{msg}</p> : null}

      <ProfileCard profile={profile} onSave={saveProfile} busy={!!busy} />

      <AuditLine audit={audit} repos={repos} hasReadmes={Object.keys(readmes).length > 0} onCheck={loadReadmes} busy={!!busy} />

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
        <input
          className="admin-input gh-search"
          placeholder="Search name, description or topic"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search repositories"
        />
      </div>

      <div className="gh-list">
        {rows.length === 0 ? (
          <p className="gh-none">
            {filter === "attention"
              ? "Nothing needs attention. Every repository has a description and topics."
              : "No repository matches that."}
          </p>
        ) : (
          rows.map((r) => (
            <RepoRow
              key={r.name}
              repo={r}
              findings={audit.byRepo[r.name] || []}
              expanded={open === r.name}
              busy={!!busy}
              owner={r.owner || profile.login}
              onToggle={() => setOpen(open === r.name ? null : r.name)}
              onSave={(patch) => saveRepo(r, patch)}
              onSaveReadme={(file, content, message) => saveReadme(r, file, content, message)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ================= hub styles ================= */

export function HubStyles() {
  return (
    <style jsx global>{`
      .gx {
        --gx-amber: var(--a-amber, #ffb020);
        --gx-line: var(--a-line, #23262f);
        --gx-raise: var(--a-raise, #15171d);
        --gx-void: var(--a-void, #0d0e13);
        --gx-text: var(--a-text, #e7e8ee);
        --gx-dim: var(--a-dim, #8b90a0);
        --gx-faint: #5c6377;
        --gx-bad: #d8757f;
        color: var(--gx-text);
        padding: 4px 20px 40px;
      }
      @media (max-width: 760px) {
        .gx {
          padding: 4px 12px 32px;
        }
      }
      .gx h3,
      .gx h4 {
        color: var(--gx-text);
      }
      .gx-busy,
      .gx-dim {
        font-size: 12.5px;
        color: var(--gx-dim);
        margin: 10px 0;
      }
      .gx-ok {
        font-size: 12.5px;
        color: var(--gx-amber);
        margin: 10px 0;
      }
      .gx-warn {
        color: var(--gx-bad);
      }
      .gx a {
        color: inherit;
      }
      .gx a:focus-visible,
      .gx button:focus-visible,
      .gx select:focus-visible,
      .gx input:focus-visible {
        outline: 2px solid var(--gx-amber);
        outline-offset: 2px;
      }

      /* ---- empty and setup ---- */
      .gx-empty {
        max-width: 62ch;
        margin: 24px 0;
        display: grid;
        gap: 12px;
        justify-items: start;
      }
      .gx-empty h3 {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 22px;
      }
      .gx-empty p,
      .gx-steps {
        margin: 0;
        font-size: 13.5px;
        line-height: 1.6;
        color: var(--gx-dim);
      }
      .gx-steps {
        padding-left: 18px;
        display: grid;
        gap: 10px;
      }
      .gx-steps a,
      .gx-empty p a {
        color: var(--gx-text);
      }
      .gx-uris {
        list-style: none;
        padding: 0;
        margin: 8px 0 0;
        display: grid;
        gap: 6px;
      }
      .gx-uris li {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .gx code {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12px;
        color: var(--gx-text);
        /* A variable name is one token: split mid-word it reads as two. */
        white-space: nowrap;
      }
      /* Only a long URL may break, and only at its slashes and dots. */
      .gx-uris code {
        white-space: normal;
        overflow-wrap: anywhere;
      }

      /* ---- lanes: the one bold element ---- */
      .gx-lanes {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--gx-line);
        border-radius: 12px;
        overflow: hidden;
        margin: 4px 0 14px;
        background: var(--gx-raise);
      }
      .gx-lane {
        display: grid;
        grid-template-columns: 36px minmax(140px, 220px) 1fr auto;
        align-items: center;
        gap: 14px;
        padding: 12px 16px 12px 13px;
        border: 0;
        border-left: 3px solid transparent;
        border-bottom: 1px solid var(--gx-line);
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .gx-lane:hover {
        background: rgba(255, 255, 255, 0.02);
      }
      .gx-lane.on {
        border-left-color: var(--gx-amber);
        background: rgba(255, 176, 32, 0.035);
      }
      .gx-lane.bad {
        border-left-color: #a33b45;
      }
      .gx-lane-av {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: block;
      }
      .gx-lane-av-blank {
        background: var(--gx-line);
      }
      .gx-lane-who {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .gx-lane-name {
        font-family: "Space Grotesk", sans-serif;
        font-weight: 600;
        font-size: 14.5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .gx-lane-login {
        font-size: 12px;
        color: var(--gx-dim);
      }
      .gx-tide {
        display: block;
        height: 34px;
        min-width: 0;
      }
      .gx-tide svg {
        width: 100%;
        height: 34px;
        display: block;
      }
      .gx-tide rect.on {
        fill: var(--gx-amber);
        opacity: 0.32;
        transform-origin: bottom;
      }
      .gx-tide rect.off {
        fill: var(--gx-line);
      }
      .gx-lane.on .gx-tide rect.on {
        opacity: 1;
      }
      /* The one orchestrated moment: the selected lane's year rises in. */
      @media (prefers-reduced-motion: no-preference) {
        .gx-lane.on .gx-tide rect.on {
          animation: gx-rise 520ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
          transform-box: fill-box;
        }
        @keyframes gx-rise {
          from {
            transform: scaleY(0.1);
          }
          to {
            transform: scaleY(1);
          }
        }
      }
      .gx-tide-wait {
        font-size: 12px;
        color: var(--gx-faint);
        line-height: 34px;
      }
      .gx-lane-fig {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        min-width: 120px;
      }
      .gx-lane-fig strong {
        font-family: "Space Grotesk", sans-serif;
        font-size: 18px;
        font-variant-numeric: tabular-nums;
      }
      .gx-lane-fig span {
        font-size: 11.5px;
        color: var(--gx-dim);
      }
      .gx-lane-err {
        color: var(--gx-bad) !important;
        max-width: 26ch;
        text-align: right;
      }
      .gx-add {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border: 0;
        background: none;
        color: var(--gx-dim);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
        text-align: left;
      }
      .gx-add span {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 1px dashed var(--gx-faint);
        display: grid;
        place-items: center;
        font-size: 18px;
      }
      .gx-add:hover {
        color: var(--gx-text);
      }
      .gx-scope {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
        font-size: 12.5px;
        color: var(--gx-dim);
        border-left: 3px solid var(--gx-amber);
        padding: 8px 12px;
        margin: 0 0 14px;
      }

      /* ---- views ---- */
      .gx-views {
        display: flex;
        align-items: center;
        gap: 4px;
        border-bottom: 1px solid var(--gx-line);
        margin-bottom: 18px;
        flex-wrap: wrap;
      }
      .gx-view {
        background: none;
        border: 0;
        border-bottom: 2px solid transparent;
        color: var(--gx-dim);
        font: inherit;
        font-size: 13.5px;
        padding: 10px 12px;
        margin-bottom: -1px;
        cursor: pointer;
      }
      .gx-view.on {
        color: var(--gx-text);
        border-bottom-color: var(--gx-amber);
      }
      .gx-views-end {
        margin-left: auto;
        display: flex;
        gap: 8px;
        padding: 6px 0;
      }

      /* ---- overview ---- */
      .gx-over {
        display: grid;
        grid-template-columns: 272px minmax(0, 1fr);
        gap: 22px;
        align-items: start;
      }
      .gx-id {
        /* Clears AdminShell's sticky title bar. */
        position: sticky;
        top: 92px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .gx-id-av {
        width: 88px;
        height: 88px;
        border-radius: 50%;
        border: 1px solid var(--gx-line);
      }
      .gx-id h3 {
        margin: 6px 0 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 22px;
        line-height: 1.15;
      }
      .gx-id-login {
        font-size: 13px;
        color: var(--gx-dim) !important;
        text-decoration: none;
      }
      .gx-id-login:hover {
        color: var(--gx-text) !important;
        text-decoration: underline;
      }
      .gx-id-bio {
        margin: 2px 0 4px;
        font-size: 13.5px;
        line-height: 1.55;
      }
      .gx-facts {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 6px 14px;
        margin: 4px 0;
        padding-top: 10px;
        border-top: 1px solid var(--gx-line);
        font-size: 12.5px;
      }
      .gx-facts dt {
        color: var(--gx-dim);
      }
      .gx-facts dd {
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .gx-sub-h {
        font-size: 12px;
        color: var(--gx-dim);
      }
      .gx-orgs > div {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 6px;
      }
      .gx-orgs img {
        border-radius: 6px;
        display: block;
      }
      .gx-id-open {
        align-self: start;
        margin-top: 6px;
        text-decoration: none;
      }
      .gx-body {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
      }
      .gx-figs {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        border: 1px solid var(--gx-line);
        border-radius: 12px;
        overflow: hidden;
      }
      .gx-fig {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 14px 16px;
        border-right: 1px solid var(--gx-line);
        margin-right: -1px;
      }
      .gx-fig strong {
        font-family: "Space Grotesk", sans-serif;
        font-size: 26px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        line-height: 1.1;
      }
      .gx-fig-label {
        font-size: 12px;
        color: var(--gx-dim);
        line-height: 1.4;
      }
      .gx-fig-delta {
        font-size: 11.5px;
        color: var(--gx-dim);
      }
      .gx-fig-delta.up {
        color: var(--gx-text);
      }
      .gx-fig-delta.down {
        color: var(--gx-bad);
      }
      .gx-card {
        border: 1px solid var(--gx-line);
        border-radius: 12px;
        background: var(--gx-raise);
        padding: 14px 16px 16px;
        min-width: 0;
      }
      .gx-card-h {
        display: flex;
        flex-direction: column;
        gap: 3px;
        margin-bottom: 12px;
      }
      .gx-card-h h4 {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 15px;
      }
      .gx-card-h span {
        font-size: 12px;
        color: var(--gx-dim);
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
      }
      .gx-hair {
        display: inline-block;
        width: 14px;
        height: 1px;
        background: var(--gx-faint);
      }
      .gx-pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      /* calendar */
      .gx-cal-wrap {
        overflow-x: auto;
        padding-bottom: 4px;
      }
      .gx-cal {
        display: block;
        width: 100%;
        height: auto;
      }
      .gx-cal-m {
        fill: var(--gx-dim);
        font-size: 9.5px;
        font-family: Inter, sans-serif;
      }
      .gx-cal rect.l0 {
        fill: #1c1f27;
      }
      .gx-cal rect.l1 {
        fill: var(--gx-amber);
        opacity: 0.22;
      }
      .gx-cal rect.l2 {
        fill: var(--gx-amber);
        opacity: 0.45;
      }
      .gx-cal rect.l3 {
        fill: var(--gx-amber);
        opacity: 0.72;
      }
      .gx-cal rect.l4 {
        fill: var(--gx-amber);
      }

      /* mix and weekdays */
      .gx-mix {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 8px 12px;
        margin: 0;
        font-size: 12.5px;
        align-items: center;
      }
      .gx-mix dt {
        color: var(--gx-dim);
      }
      .gx-mix dd {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .gx-bar {
        height: 6px;
        border-radius: 3px;
        background: var(--gx-text);
        opacity: 0.55;
        min-width: 2px;
      }
      .gx-mix b {
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }
      .gx-week {
        display: flex;
        gap: 10px;
        align-items: flex-end;
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px solid var(--gx-line);
      }
      .gx-week span {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        flex: 1;
      }
      .gx-week i {
        width: 100%;
        max-width: 22px;
        background: var(--gx-faint);
        border-radius: 3px 3px 0 0;
      }
      .gx-week i.peak {
        background: var(--gx-text);
      }
      .gx-week em {
        font-style: normal;
        font-size: 11px;
        color: var(--gx-dim);
      }

      /* languages */
      .gx-langbar {
        display: flex;
        height: 10px;
        border-radius: 5px;
        overflow: hidden;
        gap: 2px;
      }
      .gx-langs {
        list-style: none;
        padding: 0;
        margin: 12px 0 0;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 7px 14px;
        font-size: 12.5px;
      }
      .gx-langs li {
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .gx-langs i {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex: none;
      }
      .gx-langs b {
        margin-left: auto;
        font-weight: 500;
        color: var(--gx-dim);
        font-variant-numeric: tabular-nums;
      }

      /* traffic */
      .gx-traffic {
        width: 100%;
        border-collapse: collapse;
        font-size: 12.5px;
      }
      .gx-traffic th,
      .gx-traffic td {
        padding: 8px 6px;
        border-top: 1px solid var(--gx-line);
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .gx-traffic thead th {
        border-top: 0;
        color: var(--gx-dim);
        font-weight: 400;
        font-size: 11.5px;
      }
      .gx-traffic th:first-child {
        text-align: left;
        font-weight: 500;
      }
      .gx-traffic td.gx-dim {
        text-align: left;
      }
      .gx-spark {
        display: inline-block;
        vertical-align: middle;
      }
      .gx-spark polyline {
        fill: none;
        stroke: var(--gx-amber);
        stroke-width: 1.5;
      }

      /* ---- repositories ---- */
      .gx-ctl {
        display: flex;
        gap: 18px;
        flex-wrap: wrap;
        margin-bottom: 10px;
      }
      .gx-ctl-2 {
        gap: 8px;
        align-items: center;
      }
      .gx-seg {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        flex-wrap: wrap;
      }
      .gx-seg-l {
        font-size: 12px;
        color: var(--gx-dim);
        margin-right: 8px;
      }
      .gx-seg button {
        background: none;
        border: 1px solid transparent;
        color: var(--gx-dim);
        font: inherit;
        font-size: 12.5px;
        padding: 5px 10px;
        border-radius: 7px;
        cursor: pointer;
      }
      .gx-seg button:hover {
        color: var(--gx-text);
      }
      .gx-seg button.on {
        color: var(--gx-text);
        border-color: var(--gx-line);
        background: var(--gx-raise);
      }
      .gx-q {
        flex: 1;
        min-width: 220px;
      }
      .gx-sel {
        width: auto;
        min-width: 0;
      }
      .gx-check {
        font-size: 12.5px;
        color: var(--gx-dim);
        display: inline-flex;
        gap: 6px;
        align-items: center;
      }
      .gx-count {
        font-size: 12.5px;
        color: var(--gx-dim);
        margin: 14px 0 8px;
      }
      .gx-rank {
        list-style: none;
        margin: 0;
        padding: 0;
        border-top: 1px solid var(--gx-line);
      }
      .gx-row {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr) auto;
        gap: 12px;
        align-items: baseline;
        padding: 12px 6px 12px 0;
        border-bottom: 1px solid var(--gx-line);
        text-decoration: none;
        border-left: 3px solid transparent;
      }
      .gx-row:hover {
        background: rgba(255, 255, 255, 0.02);
      }
      .gx-row:hover .gx-row-go {
        color: var(--gx-text);
      }
      .gx-pos {
        text-align: right;
        font-family: "Space Grotesk", sans-serif;
        font-size: 13px;
        color: var(--gx-faint);
        font-variant-numeric: tabular-nums;
      }
      .gx-row-main {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .gx-row-name {
        font-family: "Space Grotesk", sans-serif;
        font-weight: 600;
        font-size: 14.5px;
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .gx-row-owner {
        color: var(--gx-dim);
        font-weight: 400;
      }
      .gx-flag {
        font-style: normal;
        font-family: Inter, sans-serif;
        font-weight: 400;
        font-size: 10.5px;
        color: var(--gx-dim);
        border: 1px solid var(--gx-line);
        border-radius: 4px;
        padding: 1px 5px;
      }
      .gx-row-desc {
        font-size: 13px;
        color: var(--gx-dim);
        line-height: 1.5;
        max-width: 80ch;
      }
      .gx-row-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0;
        font-size: 12px;
        color: var(--gx-dim);
      }
      /* Hairlines between the facts, not middots. */
      .gx-row-meta span + span::before {
        content: "";
        display: inline-block;
        width: 12px;
        height: 1px;
        background: var(--gx-faint);
        vertical-align: middle;
        margin: 0 8px;
      }
      .gx-row-go {
        font-size: 12px;
        color: var(--gx-faint);
        white-space: nowrap;
      }
      .gx-more {
        margin-top: 12px;
      }
      .gx-fix-h {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }

      @media (max-width: 1100px) {
        .gx-over {
          grid-template-columns: 1fr;
        }
        .gx-id {
          position: static;
        }
      }
      @media (max-width: 760px) {
        .gx-pair {
          grid-template-columns: 1fr;
        }
        .gx-lane {
          grid-template-columns: 36px 1fr auto;
        }
        .gx-tide {
          grid-column: 1 / -1;
          order: 3;
        }
        .gx-row-go,
        .gx-hide-sm {
          display: none;
        }
        .gx-row {
          grid-template-columns: 26px minmax(0, 1fr);
        }
        .gx-views-end {
          margin-left: 0;
          width: 100%;
        }
      }
    `}</style>
  );
}

/* ================= profile ================= */

export function ProfileCard({ profile, onSave, busy }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(profile);

  useEffect(() => setForm(profile), [profile]);

  const bioLeft = 160 - (form.bio || "").length;

  return (
    <section className={`gh-profile${editing ? " is-editing" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="gh-avatar" src={profile.avatar} alt="" width={52} height={52} />
      <div className="gh-who">
        <h4>
          {profile.name || profile.login}
          <span className="gh-handle">@{profile.login}</span>
        </h4>
        {editing ? (
          <div className="gh-fields">
            <label className="gh-field gh-wide">
              <span>
                Bio
                <i className={bioLeft < 0 ? "over" : ""}>{bioLeft} left</i>
              </span>
              <textarea
                className="admin-input gh-area"
                rows={2}
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
              />
            </label>
            {[
              ["name", "Name"],
              ["blog", "Website"],
              ["company", "Company"],
              ["location", "Location"],
            ].map(([k, label]) => (
              <label className="gh-field" key={k}>
                <span>{label}</span>
                <input
                  className="admin-input"
                  value={form[k] || ""}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </label>
            ))}
            <div className="gh-row-actions gh-wide">
              <button className="admin-ghost" type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                className="admin-primary"
                type="button"
                disabled={busy || bioLeft < 0}
                title={bioLeft < 0 ? "GitHub caps the bio at 160 characters" : undefined}
                onClick={() => {
                  onSave({
                    name: form.name,
                    bio: form.bio,
                    blog: form.blog,
                    company: form.company,
                    location: form.location,
                  });
                  setEditing(false);
                }}
              >
                Save profile
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="gh-bio">{profile.bio || "No bio. This is the most-read line on the account."}</p>
            <p className="gh-meta">
              <span>{profile.publicRepos} public repos</span>
              <span className="gh-hair" aria-hidden="true" />
              <span>{profile.followers} followers</span>
              {profile.blog ? (
                <>
                  <span className="gh-hair" aria-hidden="true" />
                  <a href={profile.blog} target="_blank" rel="noreferrer noopener">
                    {profile.blog.replace(/^https?:\/\//, "")}
                  </a>
                </>
              ) : null}
            </p>
          </>
        )}
      </div>
      {!editing ? (
        <button className="admin-ghost" type="button" onClick={() => setEditing(true)}>
          Edit profile
        </button>
      ) : null}
    </section>
  );
}

/* ================= the audit line ================= */

export function AuditLine({ audit, repos, hasReadmes, onCheck, busy }) {
  const tone = audit.count === 0 ? "clear" : audit.byIssue["no description"] ? "bad" : "warn";
  const parts = Object.entries(audit.byIssue).map(([k, n]) => `${n} ${k}`);
  return (
    <section className={`gh-audit ${tone}`} role="status">
      <div>
        <strong>
          {audit.count === 0
            ? "Nothing to fix"
            : `${audit.repos} of ${repos.length} repositories need attention`}
        </strong>
        <span>
          {parts.length ? parts.join(", ") : "Every repository has a description and topics."}
        </span>
      </div>
      {!hasReadmes ? (
        <button className="admin-ghost" type="button" onClick={onCheck} disabled={busy}>
          Check READMEs too
        </button>
      ) : null}
    </section>
  );
}

/* ================= one repository ================= */

export function RepoRow({ repo, findings, expanded, busy, owner, onToggle, onSave, onSaveReadme }) {
  const [form, setForm] = useState(null);
  const [topicDraft, setTopicDraft] = useState("");
  const [readme, setReadme] = useState(null);
  const [readmeBody, setReadmeBody] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [loadingReadme, setLoadingReadme] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    setForm({
      description: repo.description,
      homepage: repo.homepage,
      topics: [...repo.topics],
    });
    setReadme(null);
    setReadmeBody("");
  }, [expanded, repo]);

  const openReadme = async () => {
    setLoadingReadme(true);
    try {
      const f = await getReadme(owner, repo.name);
      setReadme(f);
      setReadmeBody(f.content);
    } finally {
      setLoadingReadme(false);
    }
  };

  const addTopic = (raw) => {
    const t = String(raw).trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
    if (!t || form.topics.includes(t)) return;
    setForm({ ...form, topics: [...form.topics, t] });
  };

  return (
    <article className={`gh-repo${expanded ? " is-open" : ""}${findings.length ? " has-findings" : ""}`} data-repo={repo.name}>
      <button className="gh-repo-head" type="button" onClick={onToggle} aria-expanded={expanded}>
        <span className="gh-name">
          {repo.name}
          {repo.archived ? <i className="gh-flag">archived</i> : null}
          {repo.private ? <i className="gh-flag">private</i> : null}
        </span>
        <span className="gh-desc">
          {repo.description || <em className="gh-missing">No description</em>}
        </span>
        <span className="gh-stars" title={`${repo.stars} stars`}>
          {repo.stars}★
        </span>
      </button>

      {findings.length && !expanded ? (
        <p className="gh-findings">
          {findings.map((f) => (
            <span className="gh-finding" key={f.issue}>
              {f.issue}
            </span>
          ))}
        </p>
      ) : null}

      {expanded && form ? (
        <div className="gh-edit">
          <label className="gh-field gh-wide">
            <span>Description</span>
            <textarea
              className="admin-input gh-area"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What this is, in one line. GitHub search ranks on it."
            />
          </label>

          <label className="gh-field gh-wide">
            <span>Homepage</span>
            <input
              className="admin-input"
              value={form.homepage}
              onChange={(e) => setForm({ ...form, homepage: e.target.value })}
              placeholder="https://ravikishan.me/…"
            />
          </label>

          <div className="gh-field gh-wide">
            <span>Topics</span>
            <div className="gh-topics">
              {form.topics.map((t) => (
                <span className="gh-topic" key={t}>
                  {t}
                  <button
                    type="button"
                    aria-label={`Remove ${t}`}
                    onClick={() => setForm({ ...form, topics: form.topics.filter((x) => x !== t) })}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                className="gh-topic-input"
                value={topicDraft}
                placeholder="Add a topic"
                onChange={(e) => setTopicDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTopic(topicDraft);
                    setTopicDraft("");
                  } else if (e.key === "Backspace" && !topicDraft && form.topics.length) {
                    setForm({ ...form, topics: form.topics.slice(0, -1) });
                  }
                }}
              />
            </div>
          </div>

          <div className="gh-row-actions gh-wide">
            <a className="gh-link" href={repo.url} target="_blank" rel="noreferrer noopener">
              Open on GitHub
            </a>
            <button
              className="admin-primary"
              type="button"
              disabled={busy}
              onClick={() =>
                onSave({
                  description: form.description,
                  homepage: form.homepage,
                  topics: form.topics,
                })
              }
            >
              Save changes
            </button>
          </div>

          <div className="gh-readme gh-wide">
            {readme === null ? (
              <button className="admin-ghost" type="button" onClick={openReadme} disabled={loadingReadme}>
                {loadingReadme ? "Opening README…" : "Edit README"}
              </button>
            ) : (
              <>
                <label className="gh-field">
                  <span>
                    {readme.missing ? "New README.md" : readme.path}
                    <i>committed to {repo.defaultBranch}</i>
                  </span>
                  <textarea
                    className="admin-input gh-readme-area"
                    rows={14}
                    value={readmeBody}
                    onChange={(e) => setReadmeBody(e.target.value)}
                  />
                </label>
                <div className="gh-row-actions">
                  <input
                    className="admin-input"
                    value={commitMsg}
                    placeholder={readme.missing ? "Add README.md" : "Update README.md"}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    aria-label="Commit message"
                  />
                  <button
                    className="admin-primary"
                    type="button"
                    disabled={busy || !readmeBody.trim()}
                    onClick={() => onSaveReadme(readme, readmeBody, commitMsg)}
                  >
                    Commit README
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

/* ================= styles ================= */

export function GithubStyles() {
  return (
    <style jsx global>{`
      .gh-main {
        max-width: none;
      }
      .gh-sub {
        margin: 6px 0 0;
        max-width: 64ch;
        line-height: 1.5;
      }
      .gh-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .gh-busy {
        margin: 10px 0;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
      }
      .gh-ok {
        margin: 10px 0;
        font-size: 12.5px;
        color: var(--a-amber, #ffb020);
      }
      .gh-connect {
        max-width: 56ch;
        margin: 32px 0;
        display: grid;
        gap: 12px;
        justify-items: start;
      }
      .gh-connect p {
        margin: 0;
        font-size: 13px;
        line-height: 1.55;
        color: var(--a-dim, #8b90a0);
      }

      /* ---- profile ---- */
      .gh-profile {
        display: flex;
        gap: 14px;
        align-items: flex-start;
        padding: 14px 16px;
        border: 1px solid var(--a-line, #23262f);
        border-radius: 12px;
        background: var(--a-raise, #15171d);
        margin: 18px 0;
      }
      .gh-profile.is-editing {
        border-left: 3px solid var(--a-amber, #ffb020);
      }
      .gh-avatar {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        flex: none;
      }
      .gh-who {
        flex: 1;
        min-width: 0;
      }
      .gh-who h4 {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 15.5px;
        color: var(--a-text, #e7e8ee);
        display: flex;
        gap: 8px;
        align-items: baseline;
        flex-wrap: wrap;
      }
      .gh-handle {
        font-family: Inter, sans-serif;
        font-size: 12px;
        font-weight: 400;
        color: var(--a-dim, #7d8496);
      }
      .gh-bio {
        margin: 5px 0 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--a-text, #e7e8ee);
        max-width: 72ch;
      }
      .gh-meta {
        margin: 7px 0 0;
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .gh-meta a {
        color: var(--a-dim, #7d8496);
      }
      /* Hairlines, not middots. */
      .gh-hair {
        width: 14px;
        height: 1px;
        background: var(--a-line, #2a2e38);
        flex: none;
      }

      /* ---- audit ---- */
      .gh-audit {
        display: flex;
        align-items: center;
        gap: 14px;
        justify-content: space-between;
        flex-wrap: wrap;
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid var(--a-line, #23262f);
        border-left-width: 3px;
        background: rgba(255, 255, 255, 0.015);
        margin: 0 0 16px;
      }
      .gh-audit > div {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .gh-audit strong {
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
      }
      .gh-audit span {
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      /* Graded like the rail badges in AdminShell. */
      .gh-audit.clear {
        border-left-color: var(--a-line, #23262f);
      }
      .gh-audit.warn {
        border-left-color: var(--a-amber, #ffb020);
      }
      .gh-audit.bad {
        border-left-color: #a33b45;
      }

      /* ---- filters ---- */
      .gh-filters {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .gh-chips {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .gh-chip {
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        color: var(--a-dim, #8b90a0);
        border-radius: 999px;
        padding: 6px 12px;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .gh-chip.on {
        border-color: var(--a-amber, #ffb020);
        color: var(--a-text, #e7e8ee);
      }
      .gh-search {
        flex: 1;
        min-width: 220px;
      }

      /* ---- the list ---- */
      .gh-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .gh-none {
        font-size: 13px;
        color: var(--a-dim, #8b90a0);
        padding: 18px 2px;
      }
      .gh-repo {
        border: 1px solid var(--a-line, #23262f);
        border-radius: 10px;
        background: var(--a-raise, #15171d);
        border-left: 3px solid transparent;
        overflow: hidden;
      }
      /* The one amber thing: the row you are editing — the same left-edge
         language as ContentEditor and the blog's contents rail. */
      .gh-repo.is-open {
        border-left-color: var(--a-amber, #ffb020);
      }
      .gh-repo.has-findings:not(.is-open) {
        border-left-color: #5a4a22;
      }
      .gh-repo-head {
        width: 100%;
        display: flex;
        align-items: baseline;
        gap: 12px;
        padding: 11px 14px;
        background: none;
        border: 0;
        text-align: left;
        font: inherit;
        color: inherit;
        cursor: pointer;
      }
      .gh-repo-head:hover {
        background: rgba(255, 255, 255, 0.025);
      }
      .gh-name {
        font-family: "Space Grotesk", sans-serif;
        font-weight: 600;
        font-size: 13.5px;
        color: var(--a-text, #e7e8ee);
        flex: none;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .gh-flag {
        font-style: normal;
        font-size: 10px;
        color: var(--a-dim, #7d8496);
        border: 1px solid var(--a-line, #2a2e38);
        border-radius: 4px;
        padding: 1px 5px;
      }
      .gh-desc {
        flex: 1;
        min-width: 0;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .gh-missing {
        color: #d8757f;
        font-style: normal;
      }
      .gh-stars {
        flex: none;
        font-size: 12px;
        color: var(--a-dim, #7d8496);
      }
      .gh-findings {
        margin: 0;
        padding: 0 14px 10px;
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .gh-finding {
        font-size: 10.5px;
        color: var(--a-amber, #ffb020);
        border: 1px solid rgba(255, 176, 32, 0.35);
        border-radius: 999px;
        padding: 2px 8px;
      }

      /* ---- the editor ---- */
      .gh-edit {
        padding: 4px 14px 16px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        border-top: 1px solid var(--a-line, #23262f);
      }
      .gh-wide {
        grid-column: 1 / -1;
      }
      .gh-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      .gh-field > span {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      .gh-field > span i {
        font-style: normal;
        color: #5c6377;
      }
      .gh-field > span i.over {
        color: #ff8a8a;
      }
      /* textarea.admin-input is monospace — right for a README, wrong for a
         one-line description. */
      .gh-area {
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        font-size: 13px;
      }
      .gh-readme-area {
        font-size: 12.5px;
        line-height: 1.5;
      }
      .gh-topics {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 9px;
        padding: 7px 8px;
        background: var(--a-void, #0d0e13);
      }
      .gh-topic {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11.5px;
        color: var(--a-text, #e7e8ee);
        background: rgba(255, 255, 255, 0.05);
        border-radius: 999px;
        padding: 3px 4px 3px 9px;
      }
      .gh-topic button {
        background: none;
        border: 0;
        color: var(--a-dim, #7d8496);
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
        padding: 0 4px;
      }
      .gh-topic button:hover {
        color: #ff8a8a;
      }
      .gh-topic-input {
        flex: 1;
        min-width: 120px;
        background: none;
        border: 0;
        outline: none;
        color: var(--a-text, #e7e8ee);
        font: inherit;
        font-size: 12.5px;
      }
      .gh-row-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
      }
      .gh-row-actions .admin-input {
        flex: 1;
        min-width: 180px;
      }
      .gh-link {
        margin-right: auto;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
      }
      .gh-readme {
        display: flex;
        flex-direction: column;
        gap: 10px;
        border-top: 1px solid var(--a-line, #23262f);
        padding-top: 12px;
      }

      @media (max-width: 820px) {
        .gh-edit {
          grid-template-columns: 1fr;
        }
        .gh-repo-head {
          flex-wrap: wrap;
        }
        .gh-desc {
          white-space: normal;
          flex-basis: 100%;
        }
      }
    `}</style>
  );
}
