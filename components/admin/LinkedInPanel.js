// LinkedIn, in the admin.
//
// DESIGN
//
// The panel has two lives, and the old one only designed the second.
//
// Before a connection exists — which is every install until someone has spent
// ten minutes in LinkedIn's developer portal — the panel IS the way in: five
// steps, in order, each saying how you know it is done. The two the server can
// observe (credentials present, account connected) tick themselves. What stood
// here before was a Connect button that could not work until four things had
// been done on a site you had never visited.
//
// Once connected, the job is writing a post, so the composer is the panel. Its
// left edge FILLS as the post approaches LinkedIn's 3000-character cap and
// turns amber, then red — the same "left edge carries state" language as the
// content editor, the writing desk and the blog's contents rail. Beside it sits
// the post as the feed will show it: the first three lines and "…see more",
// because most readers decide from that alone and the hook should be written
// where it is judged.
//
// The connection itself runs out after 60 days and cannot renew — LinkedIn
// gives refresh tokens only to approved partners — so the time left is a line
// that shortens, with Reconnect turning primary in the last fortnight.
//
// What LinkedIn does not allow is a LEDGER, folded shut with its score in the
// summary. A disabled button implies a missing permission you could go and fix;
// a ledger says this was never on offer, and here is the route that works.
//
// Every part is exported and rendered by /__linkedinpreview, so the design
// reference is the real markup rather than a copy that drifts.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_POST_CHARS,
  charsLeft,
  editPostText,
  getCapabilities,
  finishConnect,
  getProfile,
  jobSearchUrl,
  getExportProfile,
  getReach,
  listLinkedInAccounts,
  listPosts,
  markDeleted,
  markEdited,
  publish,
  recordPost,
  removePost,
} from "../../lib/linkedinClient";
import { logAdminAction } from "../../lib/auditLog";
import {
  MAX_HEADLINE_CHARS,
  canonicalHeadline,
  headlineDrift,
} from "../../lib/server/linkedinText";
import { identity } from "../../lib/facts";
import {
  CAPABILITY_LABELS as LABELS,
  feedOpening,
  linkedinRedirectUris,
} from "../../lib/server/linkedinText";

const EXPERIENCE = [
  ["", "Any experience"],
  ["internship", "Internship"],
  ["entry", "Entry level"],
  ["associate", "Associate"],
  ["mid-senior", "Mid–Senior"],
  ["director", "Director"],
  ["executive", "Executive"],
];

// A self-serve LinkedIn token lasts 60 days and cannot be refreshed.
const TOKEN_DAYS = 60;
const RENEW_WITHIN = 14;

/* ================= the three things LinkedIn will not tell you ================= *
 *
 * Every other panel in this console answers "what is happening" from the
 * service it manages. LinkedIn cannot: its self-serve API is write-mostly --
 * no post analytics, no headline, no positions, no follower count, at any
 * tier. So this page assembles the answer from elsewhere and says where each
 * piece came from:
 *
 *   the headline  -> the data export, snapshotted into lib/linkedinProfile.json
 *   the reach     -> the Google Analytics account already connected here
 *   the history   -> what this app itself published
 *
 * The hero is the headline, because a LinkedIn headline is the single
 * most-read string this person owns and the one field software is forbidden
 * to write. Noticing that it disagrees with the site, and handing over the
 * replacement text, is the entire extent of what is possible -- so that is
 * what the page opens with.
 */

export default function LinkedInPanel({ user }) {
  const [status, setStatus] = useState(null);
  // Several LinkedIn accounts can be connected. The selected one is a SHELF
  // you are inside rather than a badge on every control — same language as the
  // Social board, for the same reason: "which account am I about to post as"
  // must be answerable without reading a label twice.
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState("");
  const [exportProfile, setExportProfile] = useState(null);
  const [reach, setReach] = useState(null);
  const [reachRange, setReachRange] = useState("28d");
  const [profile, setProfile] = useState(null);
  const [caps, setCaps] = useState(null);
  const [posts, setPosts] = useState([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const selectedRef = useRef("");
  useEffect(() => {
    selectedRef.current = selected;
    if (!selected) return;
    try {
      localStorage.setItem("rk-linkedin-account", selected);
    } catch (_) {}
  }, [selected]);

  const load = useCallback(async () => {
    setBusy("Checking the connection…");
    try {
      const all = await fetch("/api/integrations/status", {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      })
        .then((r) => r.json())
        .catch(() => ({ providers: [] }));
      const li = (all.providers || []).find((p) => p.provider === "linkedin") || {
        connected: false,
        detail: "",
      };
      setStatus(li);

      // The roster, and which of them this page is currently about. A
      // remembered choice survives a reload; an account that has since been
      // disconnected falls back rather than leaving the page pointed at
      // nothing.
      const list = await listLinkedInAccounts().catch(() => []);
      setAccounts(list);
      setSelected((cur) => {
        if (cur && list.some((a) => a.accountId === cur)) return cur;
        let want = "";
        try {
          want = localStorage.getItem("rk-linkedin-account") || "";
        } catch (_) {}
        if (want && list.some((a) => a.accountId === want)) return want;
        return list[0]?.accountId || "";
      });

      // Capabilities answer with no credential, so they render even when
      // nothing is connected — which is when they matter most.
      setCaps((await getCapabilities().catch(() => null))?.capabilities || null);

      // The export snapshot is read whether or not anything is connected: the
      // headline comparison is the most useful thing on this page and it does
      // not depend on a credential.
      setExportProfile((await getExportProfile().catch(() => null))?.profile || null);

      if (li.connected) {
        const who = (() => {
          if (selectedRef.current) return selectedRef.current;
          try {
            return localStorage.getItem("rk-linkedin-account") || "";
          } catch (_) {
            return "";
          }
        })();
        setProfile(await getProfile(who).catch(() => null));
        setPosts(await listPosts(50, who).catch(() => []));
      }
    } catch (e) {
      setErr(e.message || "Could not read the LinkedIn connection.");
    } finally {
      setBusy("");
    }
  }, [user]);

  // Reach is fetched separately and never blocks the page: it crosses to the
  // Analytics API, it is the slowest thing here, and an Analytics account that
  // is not connected is an ordinary state rather than a failure.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const want = (() => {
          try {
            return localStorage.getItem("rk-ga-property") || "";
          } catch (_) {
            return "";
          }
        })();
        const r = await getReach(reachRange, want);
        if (alive) setReach(r);
      } catch (e) {
        if (alive) setReach({ available: false, why: e.message });
      }
    })();
    return () => {
      alive = false;
    };
  }, [reachRange]);

  useEffect(() => {
    (async () => {
      const p = new URLSearchParams(window.location.search);
      const failed = p.get("connectError");
      if (failed) setErr(failed);

      // Claim the connection the consent redirect just left behind. This has
      // to happen BEFORE load(), or the status read races the write and the
      // panel paints "not connected" over a connection that just succeeded.
      //
      // It used to only set a success message, so the sealed cookie was never
      // claimed, nothing was ever stored, and the cookie expired five minutes
      // later — the panel said "LinkedIn connected." and nothing was.
      if (p.get("connected") === "linkedin") {
        setBusy("Saving the LinkedIn connection…");
        try {
          const rec = await finishConnect();
          setMsg(`LinkedIn connected${rec?.email ? ` as ${rec.email}` : ""}.`);
          logAdminAction({
            action: "integration.connect",
            target: "linkedin",
            detail: rec?.email || "",
            user,
          });
        } catch (e) {
          setErr(
            `${e.message} The consent succeeded, but the connection could not be saved — press Connect to try again.`
          );
        } finally {
          setBusy("");
        }
      }

      // Drop the query so a refresh cannot try to claim a spent cookie.
      if (p.get("connected") || failed) {
        const url = new URL(window.location.href);
        ["connected", "connectError", "account"].forEach((k) => url.searchParams.delete(k));
        window.history.replaceState({}, "", url.toString());
      }

      await load();
    })();
    // Page-load sequence, deliberately once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching accounts re-reads only what is per-account: the profile and the
  // history. The capability ledger and the export snapshot do not change, and
  // re-fetching them would make the switch feel slower than it is.
  useEffect(() => {
    if (!selected || !status?.connected) return;
    let alive = true;
    (async () => {
      setBusy("Reading that account…");
      const [pr, ps] = await Promise.all([
        getProfile(selected).catch(() => null),
        listPosts(50, selected).catch(() => []),
      ]);
      if (!alive) return;
      setProfile(pr);
      setPosts(ps);
      setBusy("");
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const current = useMemo(
    () => accounts.find((a) => a.accountId === selected) || null,
    [accounts, selected]
  );

  // The export snapshot is ONE person's LinkedIn download. Showing it under a
  // second account would attribute someone else's headline to them, which is
  // the one mistake this page exists to prevent — so it is matched on the
  // address and withheld otherwise.
  const exportIsThisAccount = useMemo(() => {
    if (!exportProfile?.name) return false;
    if (accounts.length < 2) return true;
    const mine = (profile?.email || current?.email || "").toLowerCase();
    const snap = (exportProfile.email || "").toLowerCase();
    // The export carries no address of its own in every version, so the name
    // is the fallback comparison rather than assuming a match.
    return snap ? snap === mine : (profile?.name || "") === exportProfile.name;
  }, [exportProfile, accounts, profile, current]);

  const connect = async () => {
    setErr("");
    setBusy("Opening LinkedIn…");
    try {
      const res = await fetch("/api/integrations/linkedin/start", {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not start the connection.");
      window.location.assign(j.url);
    } catch (e) {
      setBusy("");
      setErr(e.message);
    }
  };

  // Resolves true when the post went out, so the composer knows to clear.
  const send = async (draft) => {
    setErr("");
    setMsg("");
    if (!window.confirm("Publish this to LinkedIn now? It goes out immediately.")) return false;
    setBusy("Publishing…");
    try {
      const out = await publish({ ...draft, accountId: selected });
      setMsg(`Published. ${out.url}`);
      // Recorded here, as the MCP tool records its own: LinkedIn cannot be
      // asked for the post back, so this row is the only history there is.
      await recordPost({
        ...out,
        ...draft,
        accountId: selected,
        accountLabel: profile?.name || current?.label || "",
      }).catch(() =>
        setErr("The post went out but could not be recorded in the history.")
      );
      logAdminAction({
        action: "linkedin.post",
        target: out.urn || "",
        detail: draft.text.slice(0, 80),
        user,
      });
      setPosts(await listPosts(50, selected).catch(() => []));
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setBusy("");
    }
  };

  // Only the text of a published post can change; LinkedIn fixes the rest.
  const edit = async (p, text) => {
    setErr("");
    setMsg("");
    setBusy("Saving the edit…");
    try {
      await editPostText(p.urn, text, selected);
      await markEdited(p.id, text.trim());
      logAdminAction({ action: "linkedin.edit", target: p.urn, detail: text.slice(0, 80), user });
      setPosts(await listPosts(50, selected).catch(() => []));
      setMsg("Edited on LinkedIn.");
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setBusy("");
    }
  };

  const unpublish = async (p) => {
    if (!window.confirm("Delete this post from LinkedIn? There is no undo.")) return;
    setBusy("Deleting…");
    try {
      await removePost(p.urn, selected);
      await markDeleted(p.id);
      logAdminAction({ action: "linkedin.delete", target: p.urn, user });
      setPosts(await listPosts(50, selected).catch(() => []));
      setMsg("Deleted from LinkedIn.");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const openJobs = async (filters) => {
    const { url } = await jobSearchUrl(filters);
    window.open(url, "_blank", "noopener");
  };

  return (
    <div className="li-main">
      <div className="ops-head">
        <p className="admin-sub li-sub">
          Publish posts as yourself. LinkedIn&apos;s API stops there — profile edits and job
          applications still happen on linkedin.com.
        </p>
        <span className="li-actions">
          <button className="admin-ghost" type="button" onClick={load} disabled={!!busy}>
            Refresh
          </button>
        </span>
      </div>

      {busy ? <p className="li-busy">{busy}</p> : null}
      {err ? <p className="admin-err">{err}</p> : null}
      {msg ? <p className="li-ok">{msg}</p> : null}

      {accounts.length > 1 ? (
        <AccountShelf
          accounts={accounts}
          selected={selected}
          onSelect={setSelected}
          onAdd={connect}
          busy={!!busy}
        />
      ) : null}

      {status === null ? null : status.connected ? (
        <>
          <Connection
            status={status}
            profile={profile}
            name={profile?.name}
            onReconnect={connect}
            busy={!!busy}
          />
          {exportIsThisAccount ? <Headline profile={exportProfile} /> : null}
          <Reach
            reach={reach}
            range={reachRange}
            onRange={setReachRange}
            postCount={posts.length}
          />
          <Composer busy={!!busy} onPublish={send} />
          <PostHistory posts={posts} onDelete={unpublish} onEdit={edit} busy={!!busy} />
          {exportIsThisAccount ? (
            <ExportProfile profile={exportProfile} />
          ) : exportProfile?.name ? (
            <p className="li-note">
              The data export on file is {exportProfile.name}&apos;s. Download this account&apos;s
              own export and run <code>npm run linkedin:snapshot</code> to see its headline,
              positions and skills here.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <SetupSteps status={status} onConnect={connect} busy={!!busy} />
          <Headline profile={exportProfile} />
        </>
      )}

      <JobSearch onSearch={openJobs} />
      <Ledger caps={caps} />

      <LinkedInStyles />
    </div>
  );
}

/* ================= the headline: the hero ================= */

// A LinkedIn headline sits under this person's name in every search result,
// every connection request and every comment. 1,148 people read it. LinkedIn
// offers no way to write it from software -- no scope, no endpoint, at any
// tier -- so the only honest interaction is: show it, show what the site
// leads with instead, and hand over the text to paste.
//
// It is set at display size in the face the site itself uses, because the
// string IS the content. Everything around it stays hairlines and grey.
export function Headline({ profile, canonical }) {
  const [copied, setCopied] = useState(false);
  const want =
    canonical ||
    canonicalHeadline({
      role: identity.role,
      focus: identity.focus,
      now: identity.now,
    });
  const drift = useMemo(() => headlineDrift(profile?.headline, want), [profile, want]);

  const copy = () => {
    try {
      navigator.clipboard.writeText(want).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        },
        () => {}
      );
    } catch (_) {}
  };

  if (drift.state === "unknown") {
    return (
      <section className="li-card li-head-card">
        <h3 className="li-h">Your headline</h3>
        <p className="li-note">{drift.note}</p>
      </section>
    );
  }

  return (
    <section className={`li-card li-head-card li-${drift.state}`}>
      <div className="li-head-top">
        <h3 className="li-h">What {profile?.connections ? profile.connections.toLocaleString() : "your connections"} read</h3>
        <span className="li-from">
          from your export of {profile?.exportedAt || "an unknown date"}
        </span>
      </div>

      <p className="li-live">{drift.live}</p>

      <div className="li-want">
        <p className="li-want-label">ravikishan.me leads with</p>
        <p className="li-want-text">{want}</p>
        <div className="li-want-row">
          <button type="button" className="admin-primary" onClick={copy}>
            {copied ? "Copied — paste it on LinkedIn" : "Copy this headline"}
          </button>
          <a
            className="li-ghost"
            href="https://www.linkedin.com/in/ravikisha/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Open your profile
          </a>
        </div>
      </div>

      {drift.retired.length ? (
        <ul className="li-retired">
          {drift.retired.map((r) => (
            <li key={r.says}>
              <strong>{r.says}</strong> {r.why}
            </li>
          ))}
        </ul>
      ) : null}
      {drift.overLength ? (
        <p className="li-note">
          {drift.length} characters. LinkedIn truncates past {MAX_HEADLINE_CHARS}, silently.
        </p>
      ) : null}
    </section>
  );
}

/* ================= reach: measured on our side ================= */

// A null delta means the baseline was zero, which is "new" only when there is
// something to be new ABOUT. Nothing against nothing is not a 100% rise and it
// is not new either — it is a quiet week, and the figure should say nothing.
const pct = (now, d) => {
  if (d === null || d === undefined) return now ? "new" : "";
  return `${d > 0 ? "+" : ""}${d}%`;
};

// LinkedIn will not report a member's own post performance without a
// partnership. The traffic it SENDS, though, lands in the site's own Analytics
// property -- a different question with a real answer, labelled as such so
// nobody reads it as impressions.
export function Reach({ reach, range, onRange, postCount = 0 }) {
  const RANGES = [
    ["7d", "7 days"],
    ["28d", "28 days"],
    ["90d", "90 days"],
  ];

  return (
    <section className="li-card">
      <div className="li-head-top">
        <h3 className="li-h">What it sent here</h3>
        <div className="li-ranges">
          {RANGES.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`li-range${range === k ? " on" : ""}`}
              onClick={() => onRange(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!reach ? (
        <p className="li-note">Reading your site analytics…</p>
      ) : !reach.available ? (
        <p className="li-note">{reach.why}</p>
      ) : (
        <>
          <div className="li-figs">
            {[
              ["sessions", "Visits from LinkedIn"],
              ["activeUsers", "People"],
              ["screenPageViews", "Pages they read"],
            ].map(([k, label]) => {
              const c = reach.change?.[k] || {};
              return (
                <div className="li-fig" key={k}>
                  <span className="li-fig-n">{(c.now ?? 0).toLocaleString()}</span>
                  <span className="li-fig-l">{label}</span>
                  <span className={`li-fig-d${c.delta > 0 ? " up" : c.delta < 0 ? " down" : ""}`}>
                    {pct(c.now, c.delta)}
                  </span>
                </div>
              );
            })}
            <div className="li-fig">
              <span className="li-fig-n">{postCount}</span>
              <span className="li-fig-l">Posts published here</span>
              <span className="li-fig-d">all time</span>
            </div>
          </div>

          <p className="li-against">
            against {reach.previous?.startDate} to {reach.previous?.endDate}, the same length
            immediately before
          </p>

          {reach.landed?.length ? (
            <ul className="li-landed">
              {reach.landed.map((row) => (
                <li key={row.landingPage}>
                  <span className="li-landed-p">{row.landingPage || "/"}</span>
                  <span className="li-landed-n">{row.screenPageViews}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="li-note">
              Nobody arrived from LinkedIn in this window. A post here with a link to the site is
              what makes this number move.
            </p>
          )}
          {reach.thresholded ? (
            <p className="li-note">
              Google withheld some rows: at this volume it hides anything that could identify an
              individual visitor.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/* ================= the profile the API refuses to return ================= */

export function ExportProfile({ profile }) {
  if (!profile?.name) return null;
  const skills = profile.skills || {};
  return (
    <details className="li-card li-export">
      <summary>
        <span className="li-h">Everything else LinkedIn knows</span>
        <span className="li-from">readable only from your export</span>
      </summary>

      <p className="li-note">
        LinkedIn&apos;s API returns a name, an address and a photo. Positions, skills,
        certifications and the number of connections are partner-only, so these come from the data
        export you downloaded on {profile.exportedAt}. Run{" "}
        <code>npm run linkedin:snapshot</code> after downloading a newer one.
      </p>

      <div className="li-counts">
        {[
          [profile.connections, "connections"],
          [skills.count, "skills"],
          [profile.certifications, "certificates"],
          [profile.patents?.length, "patent"],
          [profile.projects, "projects"],
          [profile.companiesFollowed, "companies followed"],
        ]
          .filter(([n]) => n)
          .map(([n, label]) => (
            <span className="li-count" key={label}>
              <b>{Number(n).toLocaleString()}</b> {label}
            </span>
          ))}
      </div>

      {profile.positions?.length ? (
        <ol className="li-roles">
          {profile.positions.map((r) => (
            <li key={`${r.company}-${r.from}`}>
              <span className="li-role-t">{r.title}</span>
              <span className="li-role-c">{r.company}</span>
              <span className="li-role-d">
                {r.from}
                {r.to ? ` to ${r.to}` : " — now"}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {profile.about ? (
        <div className="li-about">
          <p className="li-want-label">Your About, as it stands</p>
          <p>{profile.about}</p>
        </div>
      ) : null}

      {skills.sample?.length ? (
        <p className="li-skills">
          {skills.sample.join(" · ").replace(/ · /g, "  ")}
          {skills.count > skills.sample.length ? `  and ${skills.count - skills.sample.length} more` : ""}
        </p>
      ) : null}
    </details>
  );
}

/* ================= the shelf ================= */

// Several LinkedIn accounts, and the selected one is a PLACE YOU ARE INSIDE
// rather than a badge repeated on every control below. Position carries it —
// the cheapest, strongest signal — which is why the whole page re-reads when
// this changes instead of each section growing its own account picker.
//
// Same vocabulary as the Tasks board and the Social shelves: the selected chip
// wears the amber left edge used everywhere in this admin for "this is the
// one", and an expired account is red and says so rather than failing later.
export function AccountShelf({ accounts, selected, onSelect, onAdd, busy }) {
  return (
    <div className="li-shelf">
      <div className="li-chips" role="tablist" aria-label="LinkedIn accounts">
        {accounts.map((a) => {
          const dead = a.expiresInDays !== null && a.expiresInDays <= 0;
          const soon = a.expiresInDays !== null && a.expiresInDays > 0 && a.expiresInDays <= 14;
          return (
            <button
              key={a.accountId}
              type="button"
              role="tab"
              aria-selected={a.accountId === selected}
              className={`li-chip${a.accountId === selected ? " on" : ""}${dead ? " dead" : ""}`}
              onClick={() => onSelect(a.accountId)}
            >
              <span className="li-chip-n">{a.label || a.email || a.accountId}</span>
              <span className="li-chip-d">
                {dead
                  ? "expired — reconnect"
                  : soon
                  ? `${a.expiresInDays} days left`
                  : a.expiresInDays !== null
                  ? `${a.expiresInDays} days left`
                  : "connected"}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" className="li-ghost" onClick={onAdd} disabled={busy}>
        Add another account
      </button>
    </div>
  );
}

/* ================= not connected: the way in ================= */

export function SetupSteps({ status, onConnect, busy, origin }) {
  // The URL this copy of the site is running on is only known in the browser.
  const [here, setHere] = useState(origin || "");
  useEffect(() => {
    if (!origin) setHere(window.location.origin);
  }, [origin]);
  const uris = linkedinRedirectUris(here);
  const configured = status?.configured !== false;
  const missing = status?.missing?.length
    ? status.missing
    : ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"];
  const expired = configured && /expired/i.test(status?.detail || "");

  return (
    <section className="li-card li-setup" aria-labelledby="li-setup-h">
      <h4 id="li-setup-h">{expired ? "Reconnect LinkedIn" : "Connect LinkedIn"}</h4>
      <p className="li-dim li-note">
        {expired
          ? status.detail
          : configured
          ? "The app credentials are in place. One consent screen is left."
          : "Five steps, about ten minutes, once. LinkedIn needs a developer app of yours before it will let this site post for you."}
      </p>

      <ol className="li-steps">
        <Step done={configured} n={1} title="Create a LinkedIn app">
          <p>
            Open the{" "}
            <a href="https://www.linkedin.com/developers/apps/new" target="_blank" rel="noreferrer">
              developer portal
            </a>{" "}
            and create an app. LinkedIn insists it belongs to a company Page, even for personal
            use — if you have none,{" "}
            <a href="https://www.linkedin.com/company/setup/new/" target="_blank" rel="noreferrer">
              create a Page
            </a>{" "}
            first. Then verify the app from its Settings tab.
          </p>
        </Step>
        <Step done={configured} n={2} title="Add two products">
          <p>On the app&apos;s Products tab, request both. Each is self-serve and usually instant:</p>
          <ul className="li-plain">
            <li>Sign In with LinkedIn using OpenID Connect</li>
            <li>Share on LinkedIn</li>
          </ul>
        </Step>
        <Step done={configured} n={3} title="Allow the redirect URLs">
          <p>
            Auth tab, Authorized redirect URLs. LinkedIn compares them character for character,
            so add each one exactly:
          </p>
          <ul className="li-uris">
            {uris.map((u) => (
              <li key={u}>
                <code>{u}</code>
                <CopyButton value={u} />
              </li>
            ))}
          </ul>
        </Step>
        <Step done={configured} n={4} title="Give this site the key">
          <p>
            Copy the Client ID and Primary Client Secret from the Auth tab into the Environment
            tab (or <code>.env.local</code> when running locally), then redeploy:
          </p>
          <ul className="li-uris">
            {missing.map((k) => (
              <li key={k}>
                <code>{k}</code>
                <CopyButton value={k} />
              </li>
            ))}
          </ul>
        </Step>
        <Step done={!!status?.connected} n={5} title="Connect">
          <p>Sign in as the account to post from and approve. Access lasts 60 days.</p>
          <button
            className="admin-primary"
            type="button"
            onClick={onConnect}
            disabled={busy || !configured}
            title={configured ? undefined : "Finish step 4 first"}
          >
            Connect LinkedIn
          </button>
        </Step>
      </ol>
    </section>
  );
}

function Step({ n, title, done, children }) {
  return (
    <li className={`li-step${done ? " is-done" : ""}`}>
      <span className="li-step-n" aria-hidden="true">
        {done ? "✓" : n}
      </span>
      <div className="li-step-body">
        <h5>
          {title}
          {done ? <span className="li-sr"> (done)</span> : null}
        </h5>
        {/* A finished step folds to its title: once the credentials exist,
            the instructions for getting them are noise above the one step
            still left. */}
        {done ? null : children}
      </div>
    </li>
  );
}

function CopyButton({ value }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="li-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // Blocked clipboard (an insecure origin, a denied permission).
          const t = document.createElement("textarea");
          t.value = value;
          document.body.appendChild(t);
          t.select();
          document.execCommand("copy");
          t.remove();
        }
        setOk(true);
        setTimeout(() => setOk(false), 1400);
      }}
    >
      {ok ? "Copied" : "Copy"}
    </button>
  );
}

/* ================= connected ================= */

// The connected state used to say "Connected" and count down. That answers
// how long, never WHO — and "is my account actually on the other end of this"
// is the question anyone opens this panel with.
//
// So it is a receipt, read in the order the question is actually asked:
// as whom, until when, to do what. The person URN is shown because it is the
// real proof: every post is authored by it, so it is the value you would
// compare against a published post to be certain. It is monospace because it
// is an identifier read character by character, and copyable for the same
// reason. The avatar is the only photograph in this entire admin, which is
// what lets the card be verified at a glance without spending any colour.
export function Connection({ status, profile, name, onReconnect, busy }) {
  const who = profile?.name || name || status?.email || "Connected";
  const mail = profile?.email || status?.email || "";
  const urn = profile?.authorUrn || "";
  const [copied, setCopied] = useState(false);

  const copyUrn = async () => {
    try {
      await navigator.clipboard.writeText(urn);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (_) {
      /* a blocked clipboard is not worth an error here */
    }
  };

  const days = status?.expiresInDays;
  const known = typeof days === "number";
  const left = known ? Math.max(0, Math.min(1, days / TOKEN_DAYS)) : 1;
  const tone = !known ? "fine" : days <= 7 ? "late" : days <= RENEW_WITHIN ? "soon" : "fine";
  const ends = status?.expiresAt
    ? new Date(status.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : "";
  const urgent = known && days <= RENEW_WITHIN;

  return (
    <section className={`li-conn ${tone}`}>
      {profile?.picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="li-face" src={profile.picture} alt="" />
      ) : (
        <span className="li-face li-face-none" aria-hidden="true">
          {who.trim().charAt(0).toUpperCase()}
        </span>
      )}

      <div className="li-conn-who">
        <h4>{who}</h4>
        {mail ? <p className="li-mail">{mail}</p> : null}

        {urn ? (
          <p className="li-urn">
            <code title="Every post you publish is authored by this id">{urn}</code>
            <button type="button" onClick={copyUrn} aria-label="Copy the person id">
              {copied ? "copied" : "copy"}
            </button>
          </p>
        ) : null}

        <p className="li-when">
          {known ? (
            <span className={`li-left ${tone}`}>
              Access ends in {days} day{days === 1 ? "" : "s"}
              {ends ? `, on ${ends}` : ""}
            </span>
          ) : (
            <span className="li-left">Connected</span>
          )}
        </p>
        {known ? (
          <div
            className="li-life"
            role="meter"
            aria-label="Connection time left"
            aria-valuemin={0}
            aria-valuemax={TOKEN_DAYS}
            aria-valuenow={days}
            style={{ "--left": `${left * 100}%` }}
          />
        ) : null}

        {/* What this connection can and cannot do, in the ledger voice used
            everywhere else here — because "connected" on its own invites the
            assumption that it can read the feed, which it never can. */}
        <p className="li-can">
          Can publish, comment and react as this account
          <span className="li-hair" aria-hidden="true" />
          cannot read your feed or edit your profile
        </p>
      </div>

      <button
        className={urgent ? "admin-primary" : "admin-ghost"}
        type="button"
        onClick={onReconnect}
        disabled={busy}
      >
        {urgent ? "Reconnect now" : "Reconnect"}
      </button>
    </section>
  );
}

/* ================= the composer ================= */

export function Composer({ busy, onPublish, initial = "", label = "Write a post" }) {
  const [text, setText] = useState(initial);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [visibility, setVisibility] = useState("PUBLIC");
  const [err, setErr] = useState("");

  const left = charsLeft(text);
  const used = Math.min(1, String(text).length / MAX_POST_CHARS);
  const tone = left < 0 ? "over" : left < 200 ? "close" : "fine";
  const opening = feedOpening(text);

  const submit = async () => {
    setErr("");
    if (!text.trim()) return setErr("A post needs some text.");
    if (left < 0) return setErr(`That is ${-left} characters over LinkedIn's limit.`);
    const ok = await onPublish({
      text,
      linkUrl: linkUrl || undefined,
      linkTitle: linkTitle || undefined,
      visibility,
    });
    if (ok) {
      setText("");
      setLinkUrl("");
      setLinkTitle("");
    }
  };

  return (
    <section className="li-card li-write">
      <h4>{label}</h4>
      <div className="li-desk">
        <div className="li-desk-main">
          <div className={`li-compose ${tone}`} style={{ "--fill": `${used * 100}%` }}>
            <textarea
              className="li-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What are you building?"
              rows={9}
              aria-label="Post text"
            />
          </div>
          <div className="li-meter">
            <span className={`li-count ${tone}`}>
              {left >= 0 ? `${left} left` : `${-left} over`}
            </span>
            <span className="li-hair" aria-hidden="true" />
            <span className="li-dim">{MAX_POST_CHARS} maximum</span>
          </div>
        </div>

        <aside className="li-feed" aria-label="How the post opens in the feed">
          <p className="li-feed-label">In the feed</p>
          {opening.shown ? (
            <p className="li-feed-text">
              {opening.shown}
              {opening.cut ? <span className="li-feed-more">…see more</span> : null}
            </p>
          ) : (
            <p className="li-feed-text li-feed-empty">Your opening lines show here.</p>
          )}
          <p className="li-feed-note">
            {!opening.shown
              ? "The feed shows about three lines before folding the rest."
              : opening.cut
              ? "Everything past the fold is read only by people who click."
              : "Short enough to show whole."}
          </p>
        </aside>
      </div>

      <div className="admin-row li-row">
        <label className="li-field">
          <span>Link (optional)</span>
          <input
            className="admin-input"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://ravikishan.me/blog/…"
          />
        </label>
        <label className="li-field">
          <span>Link title</span>
          <input
            className="admin-input"
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            disabled={!linkUrl}
          />
        </label>
      </div>

      {err ? <p className="admin-err">{err}</p> : null}

      <div className="li-send">
        <label className="li-field li-vis">
          <span>Who sees it</span>
          <select
            className="admin-input"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="PUBLIC">Anyone on LinkedIn</option>
            <option value="CONNECTIONS">Connections only</option>
          </select>
        </label>
        <button
          className="admin-primary"
          type="button"
          onClick={submit}
          disabled={busy || !text.trim() || left < 0}
        >
          Publish to LinkedIn
        </button>
      </div>
    </section>
  );
}

/* ================= what went out ================= */

export function PostHistory({ posts, onDelete, onEdit, busy }) {
  const [editing, setEditing] = useState(null); // post id
  const [draft, setDraft] = useState("");
  return (
    <section className="li-card">
      <h4>Published from here</h4>
      <p className="li-dim li-note">
        Only what this admin published. LinkedIn offers no way to read your own posts back, so
        anything posted on linkedin.com is not listed.
      </p>
      {posts.length === 0 ? (
        <p className="li-empty">Nothing yet. A post you publish above is recorded here.</p>
      ) : (
        <ul className="li-posts">
          {posts.map((p) => (
            <li
              key={p.id}
              className={`li-post${p.deletedAt ? " is-gone" : ""}${editing === p.id ? " is-editing" : ""}`}
            >
              <div className="li-post-body">
                {editing === p.id ? (
                  <div className="li-post-edit">
                    <textarea
                      className="admin-input li-edit-text"
                      rows={5}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      aria-label="Edit the post text"
                    />
                    <p className="li-dim li-edit-note">
                      Only the text changes. Who sees it and any link stay as published.
                      <span className={charsLeft(draft) < 0 ? " li-gone" : ""}>
                        {" "}
                        {charsLeft(draft) >= 0 ? `${charsLeft(draft)} left` : `${-charsLeft(draft)} over`}
                      </span>
                    </p>
                    <div className="li-edit-actions">
                      <button className="admin-ghost" type="button" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                      <button
                        className="admin-primary"
                        type="button"
                        disabled={busy || !draft.trim() || charsLeft(draft) < 0 || draft.trim() === p.text}
                        onClick={async () => {
                          if (await onEdit(p, draft)) setEditing(null);
                        }}
                      >
                        Save edit
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="li-post-text">{p.text}</p>
                )}
                <p className="li-post-meta">
                  <span>{(p.postedAt || "").slice(0, 10)}</span>
                  <span className="li-hair" aria-hidden="true" />
                  <span>{p.visibility === "CONNECTIONS" ? "Connections" : "Public"}</span>
                  {p.editedAt && !p.deletedAt ? (
                    <>
                      <span className="li-hair" aria-hidden="true" />
                      <span>edited</span>
                    </>
                  ) : null}
                  {p.deletedAt ? (
                    <>
                      <span className="li-hair" aria-hidden="true" />
                      <span className="li-gone">deleted</span>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="li-post-actions">
                {p.url ? (
                  <a className="admin-ghost" href={p.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                ) : null}
                {p.deletedAt || !p.urn || !onEdit || editing === p.id ? null : (
                  <button
                    className="admin-ghost"
                    type="button"
                    onClick={() => {
                      setEditing(p.id);
                      setDraft(p.text || "");
                    }}
                  >
                    Edit
                  </button>
                )}
                {p.deletedAt || editing === p.id ? null : (
                  <button className="admin-ghost" type="button" onClick={() => onDelete(p)}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ================= jobs ================= */

export function JobSearch({ onSearch }) {
  const [jobs, setJobs] = useState({
    keywords: "",
    location: "",
    remote: false,
    postedWithinDays: 7,
    experience: "",
  });
  return (
    <section className="li-card">
      <h4>Find jobs</h4>
      <p className="li-dim li-note">
        Builds the LinkedIn search and opens it. Log what you apply to in the Jobs tab.
      </p>
      <div className="admin-row li-row">
        <label className="li-field">
          <span>Keywords</span>
          <input
            className="admin-input"
            value={jobs.keywords}
            onChange={(e) => setJobs({ ...jobs, keywords: e.target.value })}
            placeholder="distributed systems"
          />
        </label>
        <label className="li-field">
          <span>Location</span>
          <input
            className="admin-input"
            value={jobs.location}
            onChange={(e) => setJobs({ ...jobs, location: e.target.value })}
            placeholder="India"
          />
        </label>
      </div>
      <div className="admin-row li-row">
        <label className="li-field">
          <span>Experience</span>
          <select
            className="admin-input"
            value={jobs.experience}
            onChange={(e) => setJobs({ ...jobs, experience: e.target.value })}
          >
            {EXPERIENCE.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="li-field">
          <span>Posted within</span>
          <select
            className="admin-input"
            value={jobs.postedWithinDays}
            onChange={(e) => setJobs({ ...jobs, postedWithinDays: Number(e.target.value) })}
          >
            <option value={1}>24 hours</option>
            <option value={7}>A week</option>
            <option value={30}>A month</option>
            <option value={0}>Any time</option>
          </select>
        </label>
      </div>
      <div className="li-send">
        <label className="li-check">
          <input
            type="checkbox"
            checked={jobs.remote}
            onChange={(e) => setJobs({ ...jobs, remote: e.target.checked })}
          />
          Remote only
        </label>
        <button className="admin-primary" type="button" onClick={() => onSearch(jobs)}>
          Search on LinkedIn
        </button>
      </div>
    </section>
  );
}

/* ================= the ledger ================= */

export function Ledger({ caps }) {
  const rows = useMemo(
    () =>
      caps
        ? Object.entries(caps).map(([key, v]) => ({ key, label: LABELS[key] || key, ...v }))
        : [],
    [caps]
  );
  if (!rows.length) return null;
  const yes = rows.filter((r) => r.available).length;
  return (
    <details className="li-card li-ledger-card">
      <summary>
        <span className="li-ledger-title">What LinkedIn&apos;s API allows</span>
        <span className="li-dim">
          {yes} of {rows.length}
        </span>
      </summary>
      <p className="li-dim li-note">
        Checked against LinkedIn&apos;s own documentation. A no here is not a missing permission —
        it is not offered at any tier, so the route that works is given instead.
      </p>
      <ul className="li-ledger">
        {rows.map((row) => (
          <li key={row.key} className={row.available ? "yes" : "no"}>
            <span className="li-led-label">{row.label}</span>
            <span className="li-led-verdict">{row.available ? "Yes" : "No"}</span>
            <span className="li-led-why">
              {row.available ? row.how : row.why}
              {row.instead ? <em> {row.instead}</em> : null}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/* ================= styles ================= */

export function LinkedInStyles() {
  return (
    <style jsx global>{`
      .li-main {
        max-width: 1040px;
      }
      .li-main .ops-head {
        align-items: flex-start;
      }
      .li-sub {
        max-width: 64ch;
        line-height: 1.55;
        margin: 0;
      }
      .li-actions {
        display: flex;
        gap: 8px;
      }
      .li-busy,
      .li-ok {
        font-size: 12.5px;
        margin: 10px 0;
      }
      .li-busy {
        color: var(--a-dim, #8b90a0);
      }
      .li-ok {
        color: var(--a-amber, #ffb020);
        overflow-wrap: anywhere;
      }
      .li-dim {
        color: var(--a-dim, #8b90a0);
      }
      .li-note {
        font-size: 12.5px;
        line-height: 1.55;
        max-width: 70ch;
        margin: 0 0 14px;
      }
      .li-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .li-main a {
        color: var(--a-text, #e7e8ee);
        text-decoration-color: rgba(255, 176, 32, 0.6);
        text-underline-offset: 3px;
      }
      .li-main a:hover {
        text-decoration-color: var(--a-amber, #ffb020);
      }
      .li-main a.admin-ghost {
        text-decoration: none;
      }
      .li-main code {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12px;
        color: var(--a-text, #e7e8ee);
        overflow-wrap: anywhere;
      }

      .li-card {
        border: 1px solid var(--a-line, #23262f);
        border-radius: 12px;
        background: var(--a-raise, #15171d);
        padding: 18px;
        margin: 16px 0;
      }
      /* globals.scss pins h1-h4 to a light-theme colour, so every heading on
         a dark surface sets its own. */
      .li-card h4,
      .li-conn h4 {
        margin: 0 0 8px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--a-text, #e7e8ee);
      }

      /* ---- the way in ---- */
      .li-steps {
        list-style: none;
        margin: 4px 0 0;
        padding: 0;
        counter-reset: none;
      }
      /* A real sequence, so it is numbered — and the numbers sit on a spine,
         the left-edge language again: the line runs from step to step and a
         finished step fills its stretch amber. */
      .li-step {
        position: relative;
        display: grid;
        grid-template-columns: 28px 1fr;
        gap: 14px;
        padding: 0 0 22px;
      }
      .li-step:last-child {
        padding-bottom: 0;
      }
      .li-step::before {
        content: "";
        position: absolute;
        left: 13px;
        top: 28px;
        bottom: 0;
        width: 2px;
        background: var(--a-line, #2a2e38);
      }
      .li-step:last-child::before {
        display: none;
      }
      .li-step.is-done::before {
        background: var(--a-amber, #ffb020);
        opacity: 0.55;
      }
      .li-step-n {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-family: "Space Grotesk", sans-serif;
        font-size: 13px;
        font-weight: 600;
        color: var(--a-text, #e7e8ee);
        border: 1.5px solid var(--a-line, #3a3f4d);
        background: var(--a-raise, #15171d);
        position: relative;
        z-index: 1;
      }
      .li-step.is-done .li-step-n {
        background: var(--a-amber, #ffb020);
        border-color: var(--a-amber, #ffb020);
        color: #1a1300;
      }
      .li-step-body {
        min-width: 0;
        padding-top: 3px;
      }
      .li-step-body h5 {
        margin: 0 0 6px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: var(--a-text, #e7e8ee);
      }
      .li-step.is-done .li-step-body h5 {
        color: var(--a-dim, #8b90a0);
      }
      .li-step-body p {
        margin: 0 0 10px;
        font-size: 13px;
        line-height: 1.6;
        color: #b7bccb;
        max-width: 66ch;
      }
      .li-plain {
        margin: 0 0 4px;
        padding-left: 18px;
        font-size: 13px;
        line-height: 1.7;
        color: var(--a-text, #e7e8ee);
      }
      .li-uris {
        list-style: none;
        margin: 0 0 4px;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .li-uris li {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 8px 7px 12px;
        border-radius: 8px;
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #23262f);
      }
      .li-uris code {
        flex: 1;
        min-width: 0;
      }
      .li-copy {
        flex: none;
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 6px;
        color: var(--a-dim, #8b90a0);
        font: inherit;
        font-size: 11.5px;
        padding: 4px 9px;
        cursor: pointer;
      }
      .li-copy:hover,
      .li-copy:focus-visible {
        color: var(--a-text, #e7e8ee);
        border-color: var(--a-amber, #ffb020);
      }

      /* ---- connected: who, and how long for ---- */
      /* The avatar is the only photograph in this admin, so it is what makes
         the card recognisable before a single word is read. */
      .li-face {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        object-fit: cover;
        flex: none;
        border: 1px solid var(--a-line, #23262f);
        align-self: flex-start;
      }
      .li-face-none {
        display: grid;
        place-items: center;
        background: var(--a-void, #0d0e13);
        color: var(--a-dim, #8b90a0);
        font-family: "Space Grotesk", sans-serif;
        font-size: 17px;
        font-weight: 700;
      }
      .li-mail {
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
      }
      /* Monospace earns its place: this is an identifier compared character
         by character, and it is copyable because comparing it against a
         published post is exactly how you prove the connection is yours. */
      .li-urn {
        margin: 6px 0 0;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .li-urn code {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11px;
        color: var(--a-text, #e7e8ee);
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #23262f);
        border-radius: 6px;
        padding: 3px 7px;
        overflow-wrap: anywhere;
      }
      .li-urn button {
        background: none;
        border: 0;
        color: var(--a-dim, #7d8496);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 5px;
      }
      .li-urn button:hover {
        color: var(--a-amber, #ffb020);
      }
      .li-when {
        margin: 8px 0 0;
      }
      .li-can {
        margin: 8px 0 0;
        display: flex;
        align-items: center;
        gap: 9px;
        flex-wrap: wrap;
        font-size: 11px;
        color: #6b7285;
      }

      .li-conn {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        padding: 14px 16px;
        margin: 16px 0;
        border: 1px solid var(--a-line, #23262f);
        border-left: 3px solid var(--a-amber, #ffb020);
        border-radius: 12px;
        background: var(--a-raise, #15171d);
      }
      .li-conn.soon {
        border-left-color: #ffd27a;
      }
      .li-conn.late {
        border-left-color: #dc4c46;
      }
      .li-conn-who {
        flex: 1;
        min-width: 0;
      }
      .li-conn-who h4 {
        margin: 0;
      }
      .li-conn-who p {
        margin: 4px 0 0;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
      }
      .li-left.soon {
        color: #ffd27a;
      }
      .li-left.late {
        color: #ff8a8a;
      }
      /* Time left as a line that shortens. The track is what makes it read
         as a gauge rather than a stray stroke. */
      .li-life {
        position: relative;
        margin-top: 10px;
        height: 2px;
        max-width: 320px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 2px;
      }
      .li-life::before {
        content: "";
        position: absolute;
        inset: 0 auto 0 0;
        width: var(--left, 100%);
        background: var(--a-amber, #ffb020);
        border-radius: 2px;
      }
      .li-conn.soon .li-life::before {
        background: #ffd27a;
      }
      .li-conn.late .li-life::before {
        background: #ff6b6b;
      }

      /* ---- the composer ---- */
      .li-desk {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 280px;
        gap: 16px;
        align-items: start;
      }
      .li-compose {
        position: relative;
        border-radius: 10px;
        overflow: hidden;
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #2b3040);
      }
      /* The track. Without it a short post renders a 6px amber tick in the
         corner, which reads as a rendering artefact rather than a gauge. */
      .li-compose::after {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: rgba(255, 255, 255, 0.07);
      }
      .li-compose::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        z-index: 1;
        width: 3px;
        height: var(--fill, 0%);
        background: var(--a-amber, #ffb020);
        transition: height 0.14s linear;
      }
      .li-compose.close::before {
        background: #ffd27a;
      }
      .li-compose.over::before {
        background: #ff6b6b;
        height: 100%;
      }
      .li-text {
        display: block;
        width: 100%;
        background: none;
        border: 0;
        resize: vertical;
        color: var(--a-text, #e7e8ee);
        font: inherit;
        /* The size it will actually be read at. */
        font-size: 15px;
        line-height: 1.6;
        padding: 14px 14px 14px 18px;
      }
      .li-text:focus {
        outline: none;
      }
      .li-compose:focus-within {
        border-color: var(--a-amber, #ffb020);
      }
      .li-meter {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 8px 2px 14px;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
        font-variant-numeric: tabular-nums;
      }
      .li-count.close {
        color: #ffd27a;
      }
      .li-count.over {
        color: #ff8a8a;
      }
      /* Hairlines, never middots. */
      .li-hair {
        width: 14px;
        height: 1px;
        background: var(--a-line, #2a2e38);
        flex: none;
      }

      /* The opening, as the feed shows it: light text on the post's own
         surface, cut where the feed cuts. */
      .li-feed {
        border-left: 1px solid var(--a-line, #2a2e38);
        padding: 2px 0 2px 16px;
      }
      .li-feed-label {
        margin: 0 0 8px;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
      }
      .li-feed-text {
        margin: 0;
        font-size: 13.5px;
        line-height: 1.55;
        color: var(--a-text, #e7e8ee);
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
      .li-feed-empty {
        color: #5c6377;
      }
      .li-feed-more {
        color: var(--a-dim, #8b90a0);
        margin-left: 2px;
        white-space: nowrap;
      }
      .li-feed-note {
        margin: 10px 0 0;
        font-size: 11.5px;
        line-height: 1.5;
        color: #6b7285;
      }

      .li-row {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 10px;
      }
      .li-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1;
        min-width: 220px;
      }
      .li-field > span {
        font-size: 12px;
        color: var(--a-dim, #7d8496);
      }
      .li-send {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 6px;
      }
      .li-vis {
        max-width: 240px;
      }
      .li-check {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--a-dim, #8b90a0);
      }

      /* ---- history ---- */
      .li-empty {
        font-size: 13px;
        color: #6b7285;
        margin: 0;
      }
      .li-posts {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .li-post {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 10px 10px 10px 12px;
        border-radius: 8px;
        border-left: 2px solid var(--a-amber, #ffb020);
      }
      .li-post:hover {
        background: rgba(255, 255, 255, 0.03);
      }
      .li-post.is-gone {
        border-left-style: dashed;
        border-left-color: #4a5060;
        opacity: 0.6;
      }
      .li-post-body {
        flex: 1;
        min-width: 0;
      }
      .li-post-text {
        margin: 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--a-text, #e7e8ee);
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .li-post-meta {
        margin: 5px 0 0;
        display: flex;
        align-items: center;
        gap: 9px;
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
      }
      .li-gone {
        color: #ff8a8a;
      }
      /* The row being edited takes the amber edge at full height, the same
         "this is the one" mark the content editor uses. */
      .li-post.is-editing {
        border-left-width: 3px;
        background: rgba(255, 176, 32, 0.04);
      }
      .li-post-edit {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .li-edit-text {
        font-family: inherit;
        font-size: 13.5px;
        line-height: 1.55;
      }
      .li-edit-note {
        margin: 0;
        font-size: 12px;
      }
      .li-edit-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .li-post-actions {
        display: flex;
        gap: 6px;
        flex: none;
      }
      .li-post-actions .admin-ghost {
        padding: 5px 10px;
        font-size: 12px;
      }

      /* ---- the ledger: reference, folded shut ---- */
      .li-ledger-card summary {
        display: flex;
        align-items: baseline;
        gap: 12px;
        cursor: pointer;
        list-style: none;
      }
      .li-ledger-card summary::-webkit-details-marker {
        display: none;
      }
      .li-ledger-card summary::before {
        content: "";
        width: 7px;
        height: 7px;
        border-right: 1.5px solid var(--a-dim, #8b90a0);
        border-bottom: 1.5px solid var(--a-dim, #8b90a0);
        transform: translateY(-2px) rotate(-45deg);
        transition: transform 0.15s ease;
        flex: none;
      }
      .li-ledger-card[open] summary::before {
        transform: translateY(-4px) rotate(45deg);
      }
      .li-ledger-card summary:focus-visible {
        outline: 2px solid var(--a-amber, #ffb020);
        outline-offset: 4px;
        border-radius: 4px;
      }
      .li-ledger-title {
        font-family: "Space Grotesk", sans-serif;
        font-size: 15px;
        font-weight: 600;
        color: var(--a-text, #e7e8ee);
      }
      .li-ledger-card[open] summary {
        margin-bottom: 10px;
      }
      .li-ledger-card summary .li-dim {
        font-size: 12.5px;
      }
      .li-ledger {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .li-ledger li {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 2px 12px;
        padding: 10px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
      }
      .li-ledger li:first-child {
        border-top: 0;
      }
      .li-led-label {
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
      }
      .li-led-verdict {
        font-size: 12px;
        align-self: start;
        color: var(--a-dim, #7d8496);
      }
      .li-ledger li.yes .li-led-verdict {
        color: var(--a-amber, #ffb020);
      }
      .li-led-why {
        grid-column: 1 / -1;
        font-size: 12px;
        line-height: 1.55;
        color: var(--a-dim, #7d8496);
        max-width: 78ch;
      }
      .li-led-why em {
        font-style: normal;
        color: #9aa1b4;
      }

      @media (max-width: 860px) {
        .li-desk {
          grid-template-columns: 1fr;
        }
        .li-feed {
          border-left: 0;
          border-top: 1px solid var(--a-line, #2a2e38);
          padding: 12px 0 0;
        }
      }
      @media (max-width: 720px) {
        .li-field {
          min-width: 100%;
        }
        .li-send {
          align-items: stretch;
        }
        .li-card {
          padding: 14px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .li-compose::before,
        .li-ledger-card summary::before {
          transition: none;
        }
      }
    
      /* ---------- the sections added for reach, headline and export ---------- */

      .li-card {
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 12px;
        padding: 16px 18px;
        margin: 0 0 16px;
      }
      .li-h {
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: 14.5px;
        font-weight: 600;
        margin: 0;
        color: var(--a-text, #e7e8ee);
      }
      .li-head-top {
        display: flex;
        align-items: baseline;
        gap: 12px;
        flex-wrap: wrap;
      }
      .li-from {
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      .li-note {
        font-size: 12px;
        line-height: 1.65;
        color: var(--a-dim, #8b90a0);
        margin: 10px 0 0;
        max-width: 72ch;
      }
      .li-note code {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11px;
        color: var(--a-text, #e7e8ee);
      }

      /* THE hero. The headline is the content, so it is set as type rather
         than parked in a field. Everything else on the page stays quiet. */
      .li-head-card.li-drift {
        border-left: 2px solid #ffb020;
      }
      .li-head-card.li-match {
        border-left: 2px solid #3a4154;
      }
      .li-live {
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: clamp(19px, 2.6vw, 27px);
        line-height: 1.3;
        letter-spacing: -0.015em;
        color: var(--a-text, #e7e8ee);
        margin: 14px 0 0;
        max-width: 26ch;
        text-wrap: balance;
      }
      .li-want {
        margin-top: 20px;
        padding-left: 12px;
        border-left: 2px solid #ffb020;
      }
      .li-want-label {
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
        margin: 0;
      }
      .li-want-text {
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: 15.5px;
        line-height: 1.45;
        color: var(--a-text, #e7e8ee);
        margin: 4px 0 0;
        max-width: 50ch;
      }
      .li-want-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        margin-top: 12px;
      }
      .li-ghost {
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 8px;
        padding: 8px 13px;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
        text-decoration: none;
      }
      .li-ghost:hover {
        color: var(--a-text, #e7e8ee);
        border-color: #ffb020;
      }
      .li-retired {
        list-style: none;
        margin: 16px 0 0;
        padding: 0;
      }
      .li-retired li {
        font-size: 12px;
        line-height: 1.6;
        color: var(--a-dim, #8b90a0);
        padding: 7px 0;
        border-top: 1px solid var(--a-line, #2b3040);
        max-width: 74ch;
      }
      .li-retired strong {
        color: #ffb020;
        font-weight: 600;
      }

      /* ---------- reach ---------- */
      .li-ranges {
        margin-left: auto;
        display: flex;
        gap: 6px;
      }
      .li-range {
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 7px;
        color: var(--a-dim, #8b90a0);
        font: inherit;
        font-size: 11.5px;
        padding: 4px 10px;
        cursor: pointer;
      }
      .li-range.on {
        color: #ffb020;
        border-color: #ffb020;
      }
      .li-figs {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: 1px;
        margin-top: 16px;
        background: var(--a-line, #2b3040);
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 10px;
        overflow: hidden;
      }
      .li-fig {
        background: var(--a-panel, #151823);
        padding: 13px 14px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .li-fig-n {
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: 24px;
        line-height: 1.1;
        color: var(--a-text, #e7e8ee);
      }
      .li-fig-l {
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      .li-fig-d {
        font-size: 11px;
        color: var(--a-dim, #8b90a0);
      }
      .li-fig-d.up {
        color: #5fb87a;
      }
      .li-fig-d.down {
        color: #e0564a;
      }
      .li-against {
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
        margin: 8px 0 0;
      }
      .li-landed {
        list-style: none;
        margin: 14px 0 0;
        padding: 0;
      }
      .li-landed li {
        display: flex;
        gap: 12px;
        align-items: baseline;
        padding: 6px 0;
        border-top: 1px solid var(--a-line, #2b3040);
        font-size: 12.5px;
      }
      .li-landed-p {
        color: var(--a-text, #e7e8ee);
        overflow-wrap: anywhere;
      }
      .li-landed-n {
        margin-left: auto;
        color: var(--a-dim, #8b90a0);
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11.5px;
      }

      /* ---------- the export ---------- */
      .li-export summary {
        cursor: pointer;
        display: flex;
        align-items: baseline;
        gap: 12px;
        flex-wrap: wrap;
      }
      .li-counts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 18px;
        margin-top: 14px;
      }
      .li-count {
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
      }
      .li-count b {
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: 15px;
        font-weight: 600;
        color: var(--a-text, #e7e8ee);
      }
      .li-roles {
        list-style: none;
        margin: 16px 0 0;
        padding: 0;
      }
      .li-roles li {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 10px;
        padding: 8px 0;
        border-top: 1px solid var(--a-line, #2b3040);
      }
      .li-role-t {
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
      }
      .li-role-c {
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
      }
      .li-role-d {
        margin-left: auto;
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      .li-about {
        margin-top: 18px;
        padding-left: 12px;
        border-left: 1px solid var(--a-line, #2b3040);
      }
      .li-about p:last-child {
        font-size: 12.5px;
        line-height: 1.7;
        color: var(--a-dim, #8b90a0);
        max-width: 70ch;
        margin: 6px 0 0;
      }
      .li-skills {
        margin: 16px 0 0;
        font-size: 11.5px;
        line-height: 1.9;
        color: var(--a-dim, #8b90a0);
        max-width: 72ch;
      }

      @media (max-width: 720px) {
        .li-ranges {
          margin-left: 0;
          width: 100%;
        }
        .li-role-d,
        .li-landed-n {
          margin-left: 0;
        }
      }

      /* ---------- the account shelf ---------- */
      .li-shelf {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin: 0 0 16px;
        padding-bottom: 14px;
        border-bottom: 1px solid var(--a-line, #2b3040);
      }
      .li-chips {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .li-chip {
        display: flex;
        flex-direction: column;
        gap: 2px;
        text-align: left;
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        border-left: 2px solid transparent;
        border-radius: 9px;
        padding: 8px 13px;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .li-chip:hover {
        border-color: #3a4154;
      }
      /* The selected account wears the amber left edge used everywhere in this
         admin for "this is the one". */
      .li-chip.on {
        border-left-color: #ffb020;
        background: rgba(255, 176, 32, 0.04);
      }
      .li-chip.dead {
        border-left-color: #e0564a;
      }
      .li-chip:focus-visible {
        outline: 2px solid #ffb020;
        outline-offset: 2px;
      }
      .li-chip-n {
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
      }
      .li-chip-d {
        font-size: 11px;
        color: var(--a-dim, #8b90a0);
      }
      .li-chip.dead .li-chip-d {
        color: #e0564a;
      }
      .li-shelf .li-ghost {
        margin-left: auto;
        background: none;
        cursor: pointer;
      }

      @media (max-width: 720px) {
        .li-shelf .li-ghost {
          margin-left: 0;
        }
        .li-chips {
          width: 100%;
        }
      }
`}</style>
  );
}
