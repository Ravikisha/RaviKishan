// LinkedIn, in the admin.
//
// DESIGN
//
// The job here is writing a post, so the composer IS the panel: one large
// field, set at the size the text will actually be read at, and everything
// else arranged under it in the order it gets used.
//
// The one moving element is the composer's left edge, which FILLS as the post
// approaches LinkedIn's 3000-character cap and turns amber, then red, as it
// runs out. That is the same "left edge carries state" language as the content
// editor, the writing desk and the blog's contents rail — and it replaces a
// counter you have to go and read with a thing you see while typing.
//
// The harder design problem is the other half. Most of what people want from a
// LinkedIn integration does not exist as an API: no profile write at any tier,
// no job search, no job applications, no reading your own posts back. Those
// absences are presented as a LEDGER — a plain reference table of what is
// allowed and what to do instead — rather than as warnings or disabled
// buttons. A disabled button implies a missing permission you could go and
// fix. A ledger tells the truth: this was never on offer, and here is the
// route that works.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  MAX_POST_CHARS,
  charsLeft,
  getCapabilities,
  getProfile,
  jobSearchUrl,
  listPosts,
  markDeleted,
  publish,
  removePost,
} from "../../lib/linkedinClient";
import { logAdminAction } from "../../lib/auditLog";
import { CAPABILITY_LABELS as LABELS } from "../../lib/server/linkedinText";

const EXPERIENCE = [
  ["", "Any experience"],
  ["internship", "Internship"],
  ["entry", "Entry level"],
  ["associate", "Associate"],
  ["mid-senior", "Mid–Senior"],
  ["director", "Director"],
  ["executive", "Executive"],
];

export default function LinkedInPanel({ user }) {
  const [status, setStatus] = useState(null);
  const [profile, setProfile] = useState(null);
  const [caps, setCaps] = useState(null);
  const [posts, setPosts] = useState([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // composer
  const [text, setText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [visibility, setVisibility] = useState("PUBLIC");

  // jobs
  const [jobs, setJobs] = useState({
    keywords: "",
    location: "",
    remote: false,
    postedWithinDays: 7,
    experience: "",
  });

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

      // Capabilities answer with no credential, so they render even when
      // nothing is connected — which is when they matter most.
      setCaps((await getCapabilities().catch(() => null))?.capabilities || null);

      if (li.connected) {
        setProfile(await getProfile().catch(() => null));
        setPosts(await listPosts().catch(() => []));
      }
    } catch (e) {
      setErr(e.message || "Could not read the LinkedIn connection.");
    } finally {
      setBusy("");
    }
  }, [user]);

  useEffect(() => {
    load();
    // Claim a connection the consent redirect just left behind.
    const p = new URLSearchParams(window.location.search);
    if (p.get("connected") === "linkedin") setMsg("LinkedIn connected.");
  }, [load]);

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

  const left = charsLeft(text);
  const used = Math.min(1, String(text).length / MAX_POST_CHARS);
  const tone = left < 0 ? "over" : left < 200 ? "close" : "fine";

  const send = async () => {
    setErr("");
    setMsg("");
    if (!text.trim()) return setErr("A post needs some text.");
    if (left < 0) return setErr(`That is ${-left} characters over LinkedIn's limit.`);
    if (!window.confirm("Publish this to LinkedIn now? It goes out immediately.")) return;

    setBusy("Publishing…");
    try {
      const out = await publish({
        text,
        linkUrl: linkUrl || undefined,
        linkTitle: linkTitle || undefined,
        visibility,
      });
      setMsg(`Published. ${out.url}`);
      setText("");
      setLinkUrl("");
      setLinkTitle("");
      logAdminAction({ action: "linkedin.post", target: out.urn || "", detail: text.slice(0, 80), user });
      setPosts(await listPosts().catch(() => []));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const unpublish = async (p) => {
    if (!window.confirm("Delete this post from LinkedIn? There is no undo.")) return;
    setBusy("Deleting…");
    try {
      await removePost(p.urn);
      await markDeleted(p.id);
      logAdminAction({ action: "linkedin.delete", target: p.urn, user });
      setPosts(await listPosts().catch(() => []));
      setMsg("Deleted from LinkedIn.");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const openJobs = async () => {
    const { url } = await jobSearchUrl(jobs);
    window.open(url, "_blank", "noopener");
  };

  const ledger = useMemo(
    () =>
      caps
        ? Object.entries(caps).map(([key, v]) => ({
            key,
            label: LABELS[key] || key,
            ...v,
          }))
        : [],
    [caps]
  );

  return (
    <div className="li-main">
      <div className="ops-head">
        <div>
          <h3>LinkedIn</h3>
          <p className="admin-sub li-sub">
            Write and publish posts, and keep the profile text in step with the site. LinkedIn
            allows less through its API than most of this admin does — what is and is not possible
            is listed at the bottom.
          </p>
        </div>
        <span className="li-actions">
          <button className="admin-ghost" type="button" onClick={load} disabled={!!busy}>
            Refresh
          </button>
        </span>
      </div>

      {busy ? <p className="li-busy">{busy}</p> : null}
      {err ? <p className="admin-err">{err}</p> : null}
      {msg ? <p className="li-ok">{msg}</p> : null}

      {/* ---- connection ---- */}
      <section className={`li-conn ${status?.connected ? "on" : "off"}`}>
        <div>
          <h4>{status?.connected ? profile?.name || "Connected" : "Not connected"}</h4>
          <p>{status?.detail || "Connect to publish from here."}</p>
        </div>
        {status?.connected ? null : (
          <button className="admin-primary" type="button" onClick={connect} disabled={!!busy}>
            Connect LinkedIn
          </button>
        )}
      </section>

      {status?.connected ? (
        <>
          {/* ---- the composer ---- */}
          <section className="li-card">
            <h4>Write a post</h4>
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
                onClick={send}
                disabled={!!busy || !text.trim() || left < 0}
              >
                Publish to LinkedIn
              </button>
            </div>
          </section>

          {/* ---- what we published ---- */}
          <section className="li-card">
            <h4>Published from here</h4>
            <p className="li-dim li-note">
              Not a read of your feed. LinkedIn has no self-serve API to list your own posts, so
              this is what this app published — anything posted on linkedin.com is not here.
            </p>
            {posts.length === 0 ? (
              <p className="li-empty">Nothing published from here yet.</p>
            ) : (
              <ul className="li-posts">
                {posts.map((p) => (
                  <li key={p.id} className={`li-post${p.deletedAt ? " is-gone" : ""}`}>
                    <div className="li-post-body">
                      <p className="li-post-text">{p.text}</p>
                      <p className="li-post-meta">
                        <span>{(p.postedAt || "").slice(0, 10)}</span>
                        <span className="li-hair" aria-hidden="true" />
                        <span>{p.visibility === "CONNECTIONS" ? "Connections" : "Public"}</span>
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
                      {p.deletedAt ? null : (
                        <button className="admin-ghost" type="button" onClick={() => unpublish(p)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {/* ---- jobs ---- */}
      <section className="li-card">
        <h4>Find jobs</h4>
        <p className="li-dim li-note">
          LinkedIn has no job search API outside its closed partner programme, and no API at all
          for submitting an application. This builds the search and opens it — record what you
          apply to in the Jobs tab so the tracker stays true.
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
          <button className="admin-primary" type="button" onClick={openJobs}>
            Search on LinkedIn
          </button>
        </div>
      </section>

      {/* ---- the ledger ---- */}
      {ledger.length ? (
        <section className="li-card">
          <h4>What LinkedIn allows</h4>
          <p className="li-dim li-note">
            Checked against LinkedIn&apos;s own documentation. The things marked no are not missing
            permissions — they are not offered at any tier, so the route that works is given
            instead.
          </p>
          <ul className="li-ledger">
            {ledger.map((row) => (
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
        </section>
      ) : null}

      <LinkedInStyles />
    </div>
  );
}


export function LinkedInStyles() {
  return (
    <style jsx global>{`
      .li-main {
        max-width: 980px;
      }
      .li-sub {
        max-width: 68ch;
        line-height: 1.55;
        margin: 6px 0 0;
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
        font-size: 12px;
        line-height: 1.55;
        max-width: 72ch;
        margin: 0 0 14px;
      }

      .li-conn {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        padding: 14px 16px;
        margin: 16px 0;
        border: 1px solid var(--a-line, #23262f);
        border-left-width: 3px;
        border-radius: 12px;
        background: var(--a-raise, #15171d);
      }
      .li-conn.on {
        border-left-color: var(--a-amber, #ffb020);
      }
      .li-conn.off {
        border-left-color: #4a5060;
      }
      .li-conn h4 {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 15px;
        color: var(--a-text, #e7e8ee);
      }
      .li-conn p {
        margin: 4px 0 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--a-dim, #8b90a0);
        max-width: 70ch;
      }

      .li-card {
        border: 1px solid var(--a-line, #23262f);
        border-radius: 12px;
        background: var(--a-raise, #15171d);
        padding: 16px;
        margin: 16px 0;
      }
      .li-card h4 {
        margin: 0 0 10px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 14px;
        color: var(--a-text, #e7e8ee);
      }

      /* The one moving element: the edge fills as the post is used up. */
      .li-compose {
        position: relative;
        border-radius: 10px;
        overflow: hidden;
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #2b3040);
      }
      /* The track. Without it a short post renders a 6px amber tick in the
         corner, which reads as a rendering artefact rather than a gauge —
         the empty part of a meter is what tells you it is one. */
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
      @media (prefers-reduced-motion: reduce) {
        .li-compose::before {
          transition: none;
        }
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
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
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
        font-size: 11.5px;
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
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
      }

      .li-empty {
        font-size: 12.5px;
        color: #5c6377;
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
        font-size: 11px;
        color: var(--a-dim, #7d8496);
      }
      .li-gone {
        color: #ff8a8a;
      }
      .li-post-actions {
        display: flex;
        gap: 6px;
        flex: none;
      }
      .li-post-actions .admin-ghost {
        padding: 5px 10px;
        font-size: 12px;
        text-decoration: none;
      }

      /* A reference table, not a list of warnings. */
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
        font-size: 11.5px;
        align-self: start;
        color: var(--a-dim, #7d8496);
      }
      .li-ledger li.yes .li-led-verdict {
        color: var(--a-amber, #ffb020);
      }
      .li-led-why {
        grid-column: 1 / -1;
        font-size: 11.5px;
        line-height: 1.55;
        color: var(--a-dim, #7d8496);
        max-width: 78ch;
      }
      .li-led-why em {
        font-style: normal;
        color: #9aa1b4;
      }

      @media (max-width: 720px) {
        .li-field {
          min-width: 100%;
        }
        .li-send {
          align-items: stretch;
        }
      }
    `}</style>
  );
}
