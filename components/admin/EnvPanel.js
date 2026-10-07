// Environment variables.
//
// DESIGN
//
// The honest shape of this screen is a CHECKLIST, not a form. The question
// anyone actually opens it with is "what is missing and what breaks because of
// it" — not "let me browse my credentials" — so the first thing on the page is
// the count of required variables that are not set, and the rows are grouped
// by what you can do about them rather than alphabetically.
//
// Three groups, because a variable's class decides what is even possible:
//
//   Live now        runtime settings, stored in Firestore, editable inline and
//                   effective immediately. The only ones where Save means the
//                   change has happened.
//   Next deployment platform variables. Editable when Vercel is configured,
//                   and every save says plainly that the running site keeps the
//                   old value until it is redeployed. Getting this wrong costs
//                   an afternoon of wondering why nothing changed.
//   Locked          the keys that decrypt everything else. Shown — because
//                   knowing they are set is the point of a checklist — with
//                   the reason they cannot be touched, and no input at all.
//
// No value is ever rendered. A masked hint distinguishes two entries; anything
// more is a credential on a screen that might be shared.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { auth } from "../../lib/firebase";

const GROUPS = [
  {
    cls: "runtime",
    title: "Live now",
    blurb:
      "Stored in the database and read on every request. Saving one takes effect immediately — no deployment.",
  },
  {
    cls: "deploy",
    title: "Next deployment",
    blurb:
      "Platform variables. Vercel bakes the environment at build time, so a change here takes effect when the project is next deployed, not now.",
  },
  {
    cls: "critical",
    title: "Locked",
    blurb:
      "These decrypt everything else, so they can never be read or written from inside the app. Set them in the Vercel dashboard or .env.local.",
  },
];

async function call(body) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const res = await fetch("/api/env", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export default function EnvPanel() {
  const [state, setState] = useState(null);
  const [editing, setEditing] = useState(null); // key
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setBusy("Reading…");
    try {
      setState(await call({ action: "status" }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (row) => {
    setErr("");
    setMsg("");
    setBusy("Saving…");
    try {
      const out = await call({ action: "set", key: row.key, value: draft });
      setMsg(
        out.effectiveOn === "immediately"
          ? `${row.key} saved — live now.`
          : `${row.key} saved on Vercel. The running site keeps the old value until it is redeployed.`
      );
      setEditing(null);
      setDraft("");
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const clear = async (row) => {
    if (
      !window.confirm(
        row.cls === "runtime"
          ? `Clear ${row.key}? It will fall back to its default.`
          : `Delete ${row.key} from Vercel? The next build will not have it.`
      )
    )
      return;
    setErr("");
    try {
      await call({ action: "delete", key: row.key, confirm: true });
      setMsg(`${row.key} removed.`);
      await load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const grouped = useMemo(() => {
    if (!state) return [];
    return GROUPS.map((g) => ({ ...g, rows: state.rows.filter((r) => r.cls === g.cls) }));
  }, [state]);

  const missing = state?.missingRequired || [];

  return (
    <main className="admin-main ev-main">
      <div className="ops-head">
        <div>
          <h3>Environment</h3>
          <p className="admin-sub ev-sub">
            Every variable this deployment knows about, what it is for, and whether it is set.
            Values are never shown — only whether something is there.
          </p>
        </div>
        <span>
          <button className="admin-ghost" type="button" onClick={load} disabled={!!busy}>
            Refresh
          </button>
        </span>
      </div>

      {/* The question anyone opens this screen with. */}
      {state ? (
        <div className={`ev-status ${missing.length ? "bad" : "ok"}`}>
          <strong>
            {missing.length
              ? `${missing.length} required variable${missing.length === 1 ? "" : "s"} not set`
              : "Everything required is set"}
          </strong>
          <span>
            {missing.length
              ? missing.join(", ")
              : state.vercel.configured
              ? "Deployment variables can be changed from here."
              : "Set VERCEL_TOKEN and VERCEL_PROJECT_ID to manage deployment variables from here."}
          </span>
        </div>
      ) : null}

      {busy ? <p className="ev-busy">{busy}</p> : null}
      {err ? <p className="admin-err">{err}</p> : null}
      {msg ? <p className="ev-ok">{msg}</p> : null}

      {grouped.map((g) => (
        <section className="ev-group" key={g.cls} data-cls={g.cls}>
          <header>
            <h4>{g.title}</h4>
            <p>{g.blurb}</p>
          </header>

          <ul className="ev-list">
            {g.rows.map((r) => (
              <li key={r.key} className={`ev-row ${r.present ? "set" : "unset"}${r.missing ? " missing" : ""}`}>
                <div className="ev-id">
                  <p className="ev-key">
                    {r.key}
                    {r.required ? <em title="Required">required</em> : null}
                  </p>
                  <p className="ev-what">{r.what || "Not in the catalogue."}</p>
                  {r.cls === "critical" && r.why ? <p className="ev-why">{r.why}</p> : null}
                </div>

                <div className="ev-state">
                  {r.present ? (
                    <span className="ev-hint" title={r.public ? "" : "Masked — values are never shown"}>
                      {r.hint || "set"}
                    </span>
                  ) : (
                    <span className="ev-no">not set</span>
                  )}
                  {r.cls === "runtime" && r.source ? <span className="ev-src">{r.source}</span> : null}
                </div>

                <div className="ev-actions">
                  {!r.manageable ? (
                    <span className="ev-locked">locked</span>
                  ) : editing === r.key ? null : (
                    <>
                      <button
                        className="admin-ghost ev-sm"
                        type="button"
                        disabled={r.cls === "deploy" && !state.vercel.configured}
                        title={
                          r.cls === "deploy" && !state.vercel.configured
                            ? "Needs VERCEL_TOKEN and VERCEL_PROJECT_ID"
                            : undefined
                        }
                        onClick={() => {
                          setEditing(r.key);
                          setDraft("");
                        }}
                      >
                        {r.present ? "Replace" : "Set"}
                      </button>
                      {r.present && r.cls === "runtime" ? (
                        <button className="admin-ghost ev-sm" type="button" onClick={() => clear(r)}>
                          Clear
                        </button>
                      ) : null}
                    </>
                  )}
                </div>

                {editing === r.key ? (
                  <form
                    className="ev-edit"
                    onSubmit={(e) => {
                      e.preventDefault();
                      save(r);
                    }}
                  >
                    <input
                      className="admin-input"
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={r.public ? "Value" : "New value — it will not be shown again"}
                    />
                    <button className="admin-primary ev-sm" type="submit" disabled={!draft}>
                      Save
                    </button>
                    <button
                      className="admin-ghost ev-sm"
                      type="button"
                      onClick={() => {
                        setEditing(null);
                        setDraft("");
                      }}
                    >
                      Cancel
                    </button>
                    {r.cls === "deploy" ? (
                      <span className="ev-warn">Takes effect on the next deployment.</span>
                    ) : null}
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {state?.redeployNote ? <p className="ev-foot">{state.redeployNote}</p> : null}
      <EnvStyles />
    </main>
  );
}

export function EnvStyles() {
  return (
    <style jsx global>{`
      .ev-main {
        max-width: 1000px;
      }
      .ev-sub {
        max-width: 74ch;
        line-height: 1.55;
        margin: 6px 0 0;
      }
      .ev-busy,
      .ev-ok {
        font-size: 12.5px;
        margin: 10px 0;
      }
      .ev-busy {
        color: var(--a-dim, #8b90a0);
      }
      .ev-ok {
        color: var(--a-amber, #ffb020);
        max-width: 74ch;
        line-height: 1.5;
      }

      /* The one thing worth seeing before anything else. */
      .ev-status {
        margin: 16px 0 6px;
        padding: 12px 14px;
        border-radius: 11px;
        border: 1px solid var(--a-line, #23262f);
        border-left-width: 3px;
        background: var(--a-raise, #15171d);
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .ev-status.bad {
        border-left-color: #a33b45;
      }
      .ev-status.ok {
        border-left-color: var(--a-amber, #ffb020);
      }
      .ev-status strong {
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
      }
      .ev-status span {
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
        line-height: 1.5;
      }

      .ev-group {
        margin-top: 22px;
      }
      .ev-group header {
        padding-left: 11px;
        border-left: 3px solid var(--a-line, #23262f);
        margin-bottom: 10px;
      }
      .ev-group[data-cls="runtime"] header {
        border-left-color: var(--a-amber, #ffb020);
      }
      .ev-group[data-cls="critical"] header {
        border-left-color: #4a5060;
      }
      .ev-group h4 {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 14px;
        color: var(--a-text, #e7e8ee);
      }
      .ev-group header p {
        margin: 4px 0 0;
        font-size: 11.5px;
        line-height: 1.55;
        color: var(--a-dim, #8b90a0);
        max-width: 76ch;
      }

      .ev-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .ev-row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        flex-wrap: wrap;
        padding: 10px 10px 10px 12px;
        border-radius: 9px;
        border-left: 2px solid transparent;
      }
      .ev-row:hover {
        background: rgba(255, 255, 255, 0.025);
      }
      .ev-row.missing {
        border-left-color: #a33b45;
      }
      .ev-id {
        flex: 1;
        min-width: 240px;
      }
      .ev-key {
        margin: 0;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12.5px;
        color: var(--a-text, #e7e8ee);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .ev-key em {
        font-style: normal;
        font-family: Inter, sans-serif;
        font-size: 10px;
        color: #ff9a9a;
        border: 1px solid rgba(163, 59, 69, 0.6);
        border-radius: 999px;
        padding: 1px 7px;
      }
      .ev-what {
        margin: 3px 0 0;
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
        line-height: 1.5;
      }
      .ev-why {
        margin: 3px 0 0;
        font-size: 11px;
        color: #6b7285;
        line-height: 1.5;
        max-width: 74ch;
      }
      .ev-state {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 150px;
      }
      .ev-hint {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11.5px;
        color: var(--a-text, #e7e8ee);
        overflow-wrap: anywhere;
      }
      .ev-no {
        font-size: 11.5px;
        color: #6b7285;
      }
      .ev-src {
        font-size: 10px;
        color: var(--a-dim, #7d8496);
        border: 1px solid var(--a-line, #2a2e38);
        border-radius: 999px;
        padding: 1px 7px;
      }
      .ev-actions {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .ev-sm {
        padding: 5px 10px;
        font-size: 12px;
      }
      .ev-locked {
        font-size: 11px;
        color: #5c6377;
      }
      .ev-edit {
        width: 100%;
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
        margin-top: 8px;
      }
      .ev-edit .admin-input {
        flex: 1;
        min-width: 220px;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12.5px;
      }
      .ev-warn {
        font-size: 11px;
        color: #ffd27a;
      }
      .ev-foot {
        margin-top: 22px;
        font-size: 11.5px;
        color: #5c6377;
        max-width: 74ch;
        line-height: 1.55;
      }

      @media (max-width: 720px) {
        .ev-id {
          min-width: 100%;
        }
      }
    `}</style>
  );
}
