// Design reference for the LinkedIn panel, rendered with the REAL styles.
//
// The live panel needs a connected LinkedIn account, which makes it impossible
// to look at — or assert on — without one. This renders the same markup and
// the same stylesheet against fixed data: no LinkedIn, no network.
//
// It shows the composer at three states (fine / close to the cap / over it),
// because the fill on the composer's left edge is the one piece of motion in
// the panel and a screenshot of the empty state proves nothing about it.
//
// 404s in production: it is a design tool, not a page.
import React, { useState } from "react";
import { LinkedInStyles } from "../components/admin/LinkedInPanel";
// Labels and the cap come from the real module, so this reference cannot
// drift from the panel it is a reference for. Only CAPS below is a fixture.
import { CAPABILITY_LABELS as LABELS, MAX_POST_CHARS as MAX } from "../lib/server/linkedinText";

const CAPS = {
  post: { available: true, how: "w_member_social, self-serve" },
  readBasicProfile: { available: true, how: "OIDC /v2/userinfo" },
  readFullProfile: {
    available: false,
    why: "r_fullprofile (headline, positions, skills) is partner-only.",
    instead: "The LinkedIn data export in linkedin/ carries all of it.",
  },
  updateProfile: {
    available: false,
    why: "LinkedIn has no profile write API at any tier.",
    instead: "Edit on linkedin.com. get_linkedin_drift shows exactly what to paste.",
  },
  searchJobs: {
    available: false,
    why: "Job search is Talent Solutions, partner-only, and new partnerships are closed.",
    instead: "linkedin_job_search_url builds the search; save what you find to the jobs tracker.",
  },
  applyToJobs: {
    available: false,
    why: "No application-submission API exists at any tier.",
    instead: "Apply on linkedin.com, then record it with create_job.",
  },
  listOwnPosts: {
    available: false,
    why: "r_member_social is restricted, so posts cannot be read back.",
    instead: "Every post made through here is recorded locally.",
  },
};



const POSTS = [
  {
    id: "1",
    text: "Spent the week writing a container runtime from scratch — namespaces, cgroups, an overlay filesystem and a tiny init. The part that surprised me was how little of it is kernel magic and how much is careful bookkeeping.",
    postedAt: "2026-10-02T09:14:00.000Z",
    visibility: "PUBLIC",
    url: "#",
  },
  {
    id: "2",
    text: "New piece on the deterministic UI runtime I have been building, and why reconciliation is the easy half.",
    postedAt: "2026-09-21T16:02:00.000Z",
    visibility: "PUBLIC",
    url: "#",
  },
  {
    id: "3",
    text: "A draft I pulled after ten minutes — leaving it here because the record should match what actually went out.",
    postedAt: "2026-09-04T11:40:00.000Z",
    visibility: "CONNECTIONS",
    url: "#",
    deletedAt: "2026-09-04T11:52:00.000Z",
  },
];

function Composer({ label, initial }) {
  const [text, setText] = useState(initial);
  const left = MAX - text.length;
  const used = Math.min(1, text.length / MAX);
  const tone = left < 0 ? "over" : left < 200 ? "close" : "fine";
  return (
    <section className="li-card">
      <h4>{label}</h4>
      <div className={`li-compose ${tone}`} style={{ "--fill": `${used * 100}%` }}>
        <textarea
          className="li-text"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={label}
        />
      </div>
      <div className="li-meter">
        <span className={`li-count ${tone}`}>{left >= 0 ? `${left} left` : `${-left} over`}</span>
        <span className="li-hair" aria-hidden="true" />
        <span className="li-dim">{MAX} maximum</span>
      </div>
    </section>
  );
}

export default function LinkedInPreview() {
  const filler = (n) => "Shipping a thing and writing about it. ".repeat(n);

  return (
    <main
      className="admin-main li-main"
      style={{ background: "#08090d", minHeight: "100vh", padding: "88px 24px 48px" }}
    >
      <div className="ops-head">
        <div>
          <h3>LinkedIn</h3>
          <p className="admin-sub li-sub">
            Write and publish posts, and keep the profile text in step with the site. LinkedIn
            allows less through its API than most of this admin does — what is and is not possible
            is listed at the bottom.
          </p>
        </div>
      </div>

      <section className="li-conn on">
        <div>
          <h4>Ravi Kishan</h4>
          <p>
            Connected as ravikishan63392@gmail.com. This token expires in 54 days — LinkedIn does
            not issue a refresh token to a self-serve app, so it has to be reconnected by hand.
          </p>
        </div>
      </section>

      {/* The edge fill is the one moving element, so show it at three states. */}
      <Composer label="Write a post" initial={filler(3)} />
      <Composer label="Close to the cap" initial={filler(72)} />
      <Composer label="Over the cap" initial={filler(82)} />

      <section className="li-card">
        <h4>Published from here</h4>
        <p className="li-dim li-note">
          Not a read of your feed. LinkedIn has no self-serve API to list your own posts, so this
          is what this app published — anything posted on linkedin.com is not here.
        </p>
        <ul className="li-posts">
          {POSTS.map((p) => (
            <li key={p.id} className={`li-post${p.deletedAt ? " is-gone" : ""}`}>
              <div className="li-post-body">
                <p className="li-post-text">{p.text}</p>
                <p className="li-post-meta">
                  <span>{p.postedAt.slice(0, 10)}</span>
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
                <a className="admin-ghost" href={p.url}>
                  Open
                </a>
                {p.deletedAt ? null : (
                  <button className="admin-ghost" type="button">
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="li-card">
        <h4>What LinkedIn allows</h4>
        <p className="li-dim li-note">
          Checked against LinkedIn&apos;s own documentation. The things marked no are not missing
          permissions — they are not offered at any tier, so the route that works is given instead.
        </p>
        <ul className="li-ledger">
          {Object.entries(CAPS).map(([key, v]) => (
            <li key={key} className={v.available ? "yes" : "no"}>
              <span className="li-led-label">{LABELS[key]}</span>
              <span className="li-led-verdict">{v.available ? "Yes" : "No"}</span>
              <span className="li-led-why">
                {v.available ? v.how : v.why}
                {v.instead ? <em> {v.instead}</em> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <LinkedInStyles />
      <style jsx global>{`
        .admin-input {
          width: 100%;
          background: var(--a-void, #0d0e13);
          border: 1px solid var(--a-line, #2b3040);
          border-radius: 9px;
          color: var(--a-text, #e7e8ee);
          padding: 10px 12px;
          font: inherit;
          font-size: 13px;
        }
        .admin-ghost {
          background: none;
          border: 1px solid var(--a-line, #2b3040);
          border-radius: 9px;
          color: var(--a-text, #e7e8ee);
          padding: 9px 14px;
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }
        .admin-sub {
          color: var(--a-dim, #8b90a0);
          font-size: 12.5px;
        }
        .ops-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .ops-head h3 {
          margin: 0;
          font-size: 15px;
          color: #e7e8ee;
          font-family: "Space Grotesk", sans-serif;
        }
        body {
          margin: 0;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        }
      `}</style>
    </main>
  );
}

// Dev-only: a design tool, not a page.
export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
