// Design reference for the Social panel, rendered with the REAL styles.
//
// The live panel needs connected YouTube, Instagram and X accounts, so without
// this the board could not be looked at or asserted on at all.
//
// It shows the thing that matters most and is hardest to catch otherwise: TWO
// accounts on a shelf with one selected, so the amber left edge that answers
// "which account am I about to post as" is actually visible, plus the X
// composer at three weighted-count states.
//
// 404s in production: it is a design tool, not a page.
import React, { useState } from "react";
import { SocialStyles } from "../components/admin/SocialPanel";
import { weightedLength, X_MAX } from "../lib/socialClient";

const SHELVES = [
  {
    id: "youtube",
    label: "YouTube",
    noun: "channel",
    accounts: [
      { accountId: "UC1", label: "Ravi Kishan" },
      { accountId: "UC2", label: "pch builds", expiresInDays: 4, warning: true },
    ],
  },
  {
    id: "instagram",
    label: "Instagram",
    noun: "account",
    accounts: [
      { accountId: "171", label: "@ravikishan" },
      { accountId: "172", label: "@pch.dev", needsReconnect: true },
    ],
  },
  { id: "x", label: "X", noun: "handle", accounts: [{ accountId: "99", label: "@ravikisha" }] },
];

function Composer({ label, initial }) {
  const [text, setText] = useState(initial);
  const left = X_MAX - weightedLength(text);
  const tone = left < 0 ? "over" : left < 30 ? "close" : "fine";
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="so-compose-head">
        <h5>{label}</h5>
      </div>
      <div className={`so-compose ${tone}`}>
        <textarea
          className="so-text"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={label}
        />
      </div>
      <div className="so-meter">
        <span className={`so-count ${tone}`}>{left >= 0 ? `${left} left` : `${-left} over`}</span>
        <span className="so-hair" aria-hidden="true" />
        <span className="so-dim">{X_MAX} weighted — a URL counts as 23, CJK as 2</span>
      </div>
    </div>
  );
}

export default function SocialPreview() {
  const [selected, setSelected] = useState({ youtube: "UC1", instagram: "171", x: "99" });

  return (
    <main
      className="admin-main so-main"
      style={{ background: "#08090d", minHeight: "100vh", padding: "88px 24px 48px" }}
    >
      <div className="ops-head">
        <div>
          <h3>Social</h3>
          <p className="admin-sub so-sub">
            YouTube, Instagram and X — several accounts of each. Everything here goes to the account
            you have selected on that shelf, and the same connections serve the MCP tools.
          </p>
        </div>
      </div>

      {SHELVES.map((s) => (
        <section className="so-shelf" key={s.id} data-provider={s.id}>
          <header className="so-shelf-head">
            <div>
              <h4>{s.label}</h4>
              <p>
                {s.accounts.length} {s.noun}
                {s.accounts.length === 1 ? "" : "s"} connected.
              </p>
            </div>
            <button className="admin-ghost" type="button">
              Add another {s.noun}
            </button>
          </header>

          <div className="so-accounts" role="tablist">
            {s.accounts.map((a) => (
              <button
                key={a.accountId}
                type="button"
                role="tab"
                aria-selected={selected[s.id] === a.accountId}
                className={`so-chip${selected[s.id] === a.accountId ? " on" : ""}${
                  a.needsReconnect ? " stale" : ""
                }`}
                onClick={() => setSelected((x) => ({ ...x, [s.id]: a.accountId }))}
              >
                <span className="so-chip-label">{a.label}</span>
                {a.needsReconnect ? <em>expired</em> : a.warning ? <em>{a.expiresInDays}d left</em> : null}
              </button>
            ))}
          </div>

          <div className="so-work">
            <div className="so-pane">
              {s.id === "x" ? (
                <>
                  <Composer label="Post" initial="Shipping a container runtime write-up today." />
                  <Composer
                    label="Close to the cap"
                    initial={"Shipping notes. ".repeat(16) + "https://ravikishan.me/blog/x"}
                  />
                  <Composer label="Over the cap" initial={"Shipping notes and more. ".repeat(13)} />
                  <p className="so-cant">
                    <strong>No editing.</strong> X has no edit endpoint at any tier. Editing is an
                    in-app feature for paid accounts; the API only reads edit history. Delete and
                    repost.
                  </p>
                </>
              ) : s.id === "instagram" ? (
                <>
                  <p className="so-stats">
                    <span>2,140 followers</span>
                    <span className="so-hair" aria-hidden="true" />
                    <span>86 posts</span>
                    <span className="so-hair" aria-hidden="true" />
                    <span>BUSINESS</span>
                    <span className="so-hair" aria-hidden="true" />
                    <span>97 of 100 posts left today</span>
                  </p>
                  <h5>Publish</h5>
                  <p className="so-dim so-note">
                    Instagram fetches the file from a public URL rather than accepting an upload, so
                    paste a reachable image URL. A caption cannot be changed once published.
                  </p>
                  <label className="so-field">
                    <span>Image URL</span>
                    <input className="admin-input" defaultValue="" placeholder="https://…" />
                  </label>
                  <p className="so-cant">
                    <strong>No caption editing.</strong> Instagram has no endpoint to change a
                    published media object. Delete and repost in the app, or get the caption right
                    before publishing.
                  </p>
                </>
              ) : (
                <>
                  <p className="so-stats">
                    <span>1,284 subscribers</span>
                    <span className="so-hair" aria-hidden="true" />
                    <span>37 videos</span>
                    <span className="so-hair" aria-hidden="true" />
                    <span>92,410 views</span>
                  </p>
                  <p className="so-dim so-note">
                    Editing here is safe: YouTube&apos;s update replaces the whole record and
                    deletes anything left out, so every save reads the video first and merges.
                  </p>
                  <ul className="so-list">
                    {[
                      ["Writing a container runtime from scratch", "public", "12,430"],
                      ["A deterministic UI runtime, part 2", "unlisted", "804"],
                    ].map(([t, p, v]) => (
                      <li key={t} className="so-item so-video">
                        <span className="so-thumb" style={{ background: "#1b1e26" }} />
                        <div className="so-video-body">
                          <p className="so-item-text">{t}</p>
                          <p className="so-item-meta">
                            <span>2026-09-14</span>
                            <span className="so-hair" aria-hidden="true" />
                            <span>{p}</span>
                            <span className="so-hair" aria-hidden="true" />
                            <span>{v} views</span>
                          </p>
                        </div>
                        <button className="admin-ghost so-sm" type="button">
                          Edit
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="so-foot">
                <button className="admin-ghost so-unlink" type="button">
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        </section>
      ))}

      <SocialStyles />
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
        .admin-primary {
          background: var(--a-amber, #ffb020);
          color: #1a1300;
          border: none;
          border-radius: 9px;
          padding: 9px 14px;
          font: inherit;
          font-weight: 600;
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
