// Design reference for the Social desk, rendered with the REAL components.
//
// The live panel needs connected YouTube, Instagram and X accounts, so without
// this the desk could not be looked at or asserted on at all.
//
// It renders `Roster`, `Identity`, `Meter` and `Refusal` themselves rather
// than a hand-copied imitation of their markup. The previous version WAS such
// an imitation and it went stale the first time the panel changed — which is
// how a design reference quietly stops referencing anything.
//
// The seed is deliberately unflattering: an expired account, a channel with a
// name rather than a handle, a caption over its cap, and a service that is not
// set up at all. A preview full of healthy rows shows none of the states these
// components exist for.
//
// 404s in production: it is a design tool, not a page.
import React, { useState } from "react";
import {
  Identity,
  Meter,
  Refusal,
  Roster,
  SocialStyles,
} from "../components/admin/SocialPanel";
import { IG_MAX, X_MAX, weightedLength } from "../lib/socialClient";

const PROVIDERS = [
  {
    provider: "instagram",
    configured: true,
    accounts: [
      { accountId: "171", label: "@ravikishan.404" },
      { accountId: "172", label: "@pch.dev", needsReconnect: true },
    ],
  },
  {
    provider: "youtube",
    configured: true,
    accounts: [
      { accountId: "UC1", label: "Ravi Kishan" },
      { accountId: "UC2", label: "pch builds", expiresInDays: 4, warning: true },
    ],
  },
  { provider: "x", configured: false, missing: ["X_CLIENT_ID", "X_CLIENT_SECRET"], accounts: [] },
];

const NO_EDIT = {
  available: false,
  why: "Instagram has no endpoint to change a published media object.",
  instead: "Delete and repost in the app, or get the caption right before publishing.",
};

function XMeter({ initial, label }) {
  const [text, setText] = useState(initial);
  const left = X_MAX - weightedLength(text);
  return (
    <div style={{ marginBottom: 20 }}>
      <label className="so-field so-field-big">
        <span>{label}</span>
        <textarea
          className={`so-text${left < 0 ? " over" : ""}`}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <Meter used={X_MAX - Math.max(left, 0)} max={X_MAX} over={left < 0}>
        <span className="so-count">{left >= 0 ? `${left} left` : `${-left} over`}</span>
        <span className="so-hair" aria-hidden="true" />
        <span className="so-dim">a link counts as 23, CJK as 2</span>
      </Meter>
    </div>
  );
}

export default function SocialPreview() {
  const [who, setWho] = useState({ provider: "instagram", accountId: "171" });

  return (
    <main
      className="admin-main so-main"
      style={{ background: "#08090d", minHeight: "100vh", padding: "48px 24px" }}
    >
      <p className="admin-sub so-sub">
        Everything here acts as the account you pick, and the MCP tools share the same connections.
        Nothing published from this desk can be edited afterwards.
      </p>

      <Roster providers={PROVIDERS} who={who} onPick={setWho} onConnect={() => {}} busy="" />

      {/* A handle is set in mono; a channel NAME is not, because it is not an
          address. Both at the size that makes the account unmissable. */}
      <section className="so-desk">
        <div className="so-pane">
          <Identity
            account={{ accountId: "171", label: "@ravikishan.404" }}
            kind="Creator account"
            url="https://www.instagram.com/ravikishan.404/"
            stats={["300 followers", "19 posts", "100 of 100 publishes left today"]}
          />
          <div className="so-work">
            <label className="so-field">
              <span>Image URL</span>
              <input className="admin-input" defaultValue="" placeholder="https://ravikishan.me/api/media/…" />
              <small>
                Instagram fetches the file rather than accepting an upload, so this has to be
                reachable without signing in. A signed or expiring URL fails.
              </small>
            </label>
            <Meter used={IG_MAX - 140} max={IG_MAX} over={false}>
              <span className="so-count">140 left</span>
              <span className="so-hair" aria-hidden="true" />
              <span className="so-dim">6 of 30 hashtags</span>
            </Meter>
            <Meter used={IG_MAX} max={IG_MAX} over>
              <span className="so-count">31 over</span>
              <span className="so-hair" aria-hidden="true" />
              <span className="so-count over">34 of 30 hashtags — the extras are dropped</span>
            </Meter>
            <div className="so-row-end">
              <label className="so-check">
                <input type="checkbox" readOnly /> Publish as a Reel
              </label>
              <span className="so-spacer" />
              <button className="admin-primary" type="button">
                Publish as @ravikishan.404
              </button>
            </div>
            <Refusal cap={NO_EDIT} title="Fixed once published." />
          </div>
        </div>
      </section>

      <section className="so-desk">
        <div className="so-pane">
          <Identity
            account={{ accountId: "UC2", label: "pch builds", expiresInDays: 4, warning: true }}
            kind="YouTube channel"
            url="https://www.youtube.com/@pchbuilds"
            stats={["1,284 subscribers", "37 public videos", "92,410 views"]}
          />
          <div className="so-work">
            <XMeter label="Post" initial="Shipping a container runtime write-up today." />
            <XMeter
              label="Close to the cap"
              initial={"Shipping notes. ".repeat(16) + "https://ravikishan.me/blog/x"}
            />
            <XMeter label="Over the cap" initial={"Shipping notes and more. ".repeat(13)} />
          </div>
        </div>
      </section>

      <section className="so-desk">
        <div className="so-pane">
          <Identity
            account={{ accountId: "172", label: "@pch.dev", needsReconnect: true }}
            kind="Instagram"
            stats={null}
          />
        </div>
      </section>

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
        .admin-primary {
          background: var(--a-amber, #ffb020);
          color: #1a1300;
          border: none;
          border-radius: 10px;
          padding: 10px 18px;
          font: inherit;
          font-weight: 600;
          font-size: 13.5px;
          cursor: pointer;
        }
        .admin-sub {
          color: var(--a-dim, #8b90a0);
          font-size: 12.5px;
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
