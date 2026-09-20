// Cross-platform drift detector.
//
// One canonical identity lives in `content.identity`. Every other surface — the
// GitHub bio, the dev.to profile, the LinkedIn headline — is a copy, and copies
// rot. This fetches the ones that have a public, CORS-friendly API and diffs
// them against the canonical values, so drift is something you SEE rather than
// something a recruiter finds.
//
// LinkedIn has no such API. Rather than pretend, it is listed as a manual check
// with the canonical text ready to copy.
import React, { useEffect, useState } from "react";
import { identity as factsIdentity } from "../../lib/facts";

const GH_USER = "Ravikisha";
const DEVTO_USER = "ravikishan";

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

async function safeJson(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { data: await r.json() };
  } catch (e) {
    return { error: e?.message || "fetch failed" };
  }
}

function Row({ label, canonical, remote, note, error }) {
  const unknown = remote == null || error;
  const match = !unknown && same(canonical, remote);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(canonical || "");
    } catch (_) {}
  };
  return (
    <div className={`df-row ${unknown ? "unknown" : match ? "match" : "drift"}`}>
      <span className="df-label">{label}</span>
      <span className="df-vals">
        <span className="df-can" title="Canonical (this site)">{canonical || <i>not set</i>}</span>
        <span className="df-rem" title="Live on the platform">
          {error ? <i>couldn&apos;t read ({error})</i> : unknown ? <i>manual check</i> : remote || <i>empty</i>}
        </span>
      </span>
      <span className="df-state">
        {unknown ? "?" : match ? "match" : "drift"}
        <button className="admin-ghost sm" type="button" onClick={copy} title="Copy the canonical value">
          Copy
        </button>
      </span>
      {note && <span className="df-note admin-sub">{note}</span>}
    </div>
  );
}

export default function DriftPanel({ content }) {
  const [gh, setGh] = useState(null);
  const [devto, setDevto] = useState(null);
  const [loading, setLoading] = useState(true);

  // Prefer the published identity; fall back to the file defaults.
  const id = content?.identity || factsIdentity;

  const load = async () => {
    setLoading(true);
    const [g, d] = await Promise.all([
      safeJson(`https://api.github.com/users/${GH_USER}`),
      safeJson(`https://dev.to/api/users/by_username?url=${DEVTO_USER}`),
    ]);
    setGh(g);
    setDevto(d);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const g = gh?.data;
  const d = devto?.data;
  const canonicalRole = `${id.role} — ${(id.focus || []).join(", ")}`;

  return (
    <main className="admin-main">
      <section className="ops-card">
        <div className="ops-head">
          <h3>Identity drift</h3>
          <button className="admin-ghost" type="button" onClick={load} disabled={loading}>
            {loading ? "Checking…" : "Re-check"}
          </button>
        </div>
        <p className="admin-sub">
          Canonical value on the left, what the platform is actually serving on
          the right. Copy pastes the canonical text so you can fix the platform.
        </p>
      </section>

      <section className="ops-card">
        <h3>GitHub — github.com/{GH_USER}</h3>
        <div className="df-list">
          <Row label="Name" canonical={id.name} remote={g?.name} error={gh?.error} />
          <Row
            label="Bio"
            canonical={id.tagline}
            remote={g?.bio}
            error={gh?.error}
            note="The GitHub bio is the single most-read line of your profile."
          />
          <Row label="Location" canonical={id.location} remote={g?.location} error={gh?.error} />
          <Row
            label="Website"
            canonical="https://ravikishan.me"
            remote={g?.blog}
            error={gh?.error}
          />
          <Row
            label="Twitter"
            canonical={(id.twitter || "").split("/").pop()}
            remote={g?.twitter_username}
            error={gh?.error}
          />
          <Row
            label="Company"
            canonical={id.now}
            remote={g?.company}
            error={gh?.error}
            note="GitHub renders a leading @ as an org link — plain text is usually better here."
          />
        </div>
      </section>

      <section className="ops-card">
        <h3>dev.to — dev.to/{DEVTO_USER}</h3>
        <div className="df-list">
          <Row label="Name" canonical={id.name} remote={d?.name} error={devto?.error} />
          <Row label="Summary" canonical={id.tagline} remote={d?.summary} error={devto?.error} />
          <Row
            label="Website"
            canonical="https://ravikishan.me"
            remote={d?.website_url}
            error={devto?.error}
          />
          <Row label="Location" canonical={id.location} remote={d?.location} error={devto?.error} />
        </div>
      </section>

      <section className="ops-card">
        <h3>LinkedIn — manual</h3>
        <p className="admin-sub">
          LinkedIn has no public profile API, so these can&apos;t be read
          automatically. Copy each canonical value and compare it against your
          profile by eye.
        </p>
        <div className="df-list">
          <Row label="Headline" canonical={canonicalRole} remote={null} />
          <Row label="About (opening line)" canonical={id.intro} remote={null} />
          <Row label="Location" canonical={id.location} remote={null} />
          <Row label="Website" canonical="https://ravikishan.me" remote={null} />
        </div>
      </section>

      <style jsx global>{`
        .df-list {
          margin-top: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .df-row {
          display: grid;
          grid-template-columns: 140px 1fr 120px;
          gap: 10px;
          align-items: start;
          padding: 9px 11px;
          border-radius: 8px;
          background: #101219;
          border-left: 3px solid #2b3040;
          font-size: 12.5px;
        }
        .df-row.match {
          border-left-color: #0f9e8e;
        }
        .df-row.drift {
          border-left-color: #ffb020;
          background: #17140c;
        }
        .df-row.unknown {
          border-left-color: #3a3f4d;
        }
        @media (max-width: 820px) {
          .df-row {
            grid-template-columns: 1fr;
          }
        }
        .df-label {
          color: #8b90a0;
          text-transform: uppercase;
          font-size: 10.5px;
          letter-spacing: 0.08em;
          padding-top: 2px;
        }
        .df-vals {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .df-can {
          color: #e7e8ee;
          word-break: break-word;
        }
        .df-rem {
          color: #8b90a0;
          word-break: break-word;
        }
        .df-row.drift .df-rem {
          color: #ffcd7a;
        }
        .df-state {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: #8b90a0;
        }
        .df-row.drift .df-state {
          color: #ffb020;
        }
        .df-row.match .df-state {
          color: #4ed0c0;
        }
        .df-note {
          grid-column: 1 / -1;
          font-size: 11px;
        }
      `}</style>
    </main>
  );
}
