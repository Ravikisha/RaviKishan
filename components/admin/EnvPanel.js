// Environment variables.
//
// DESIGN
//
// Every variable lives in the database now; the deployment keeps ENV_KEY and
// nothing else. So the question this screen answers changed from "what is
// missing" to "what is missing, and what is still being read from the
// deployment" — the second list is what moving fully into the database is
// waiting on, and it gets a one-click answer (paste the .env, import it).
//
// Groups follow what you may do with a variable:
//
//   In the database      Save is live on the next request. New keys land here.
//   Keys that protect    SECRETS_KEY, MCP_TOKEN_SECRET, INTEGRATION_SECRET and
//   other data           the vault's B2 keys. Editable HERE only — never over
//                        MCP — after a sign-in from the last 30 minutes, with
//                        what changing each one breaks stated on the row.
//   Settings             non-secret runtime settings.
//   In the deployment    ENV_KEY alone, with why it cannot move.
//
// The add form says where a key will go before it is saved, from the same
// registry the server routes by. No value is ever rendered: a masked hint
// distinguishes two entries, and anything more is a credential on a screen
// that might be shared.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { auth } from "../../lib/firebase";
import { withFreshAuth } from "../../lib/reauth";
import { KEY_RE, classify, known, isKeyring } from "../../lib/server/envRegistry";

const GROUPS = [
  {
    id: "stored",
    title: "In the database",
    blurb: "Sealed and read on every request. Saving one is live on the next request. New keys you add land here.",
    match: (r) => r.cls === "stored" && !r.keyring,
  },
  {
    id: "keyring",
    title: "Keys that protect other data",
    blurb:
      "These seal your passwords, MCP tokens and connected accounts, or decide where the vault's files go. Changed here only, never over MCP, and only after a recent sign-in. Read what each one breaks before changing it.",
    match: (r) => r.keyring,
  },
  {
    id: "runtime",
    title: "Settings",
    blurb: "Non-secret settings, live on the next request.",
    match: (r) => r.cls === "runtime",
  },
  {
    id: "bootstrap",
    title: "In the deployment",
    blurb: "The one variable that cannot live in the database, because it is the key that opens it.",
    match: (r) => r.cls === "bootstrap",
  },
];

// Where a key will go, in words, before anything is saved.
export function destinationOf(key) {
  const k = String(key || "").trim();
  if (!k) return null;
  if (!KEY_RE.test(k)) return { tone: "bad", text: "Capitals, digits and underscores, starting with a letter." };
  const cls = classify(k);
  if (cls === "bootstrap") return { tone: "bad", text: known(k)?.why || "This one stays in the deployment." };
  if (cls === "runtime") return { tone: "ok", text: "A setting. Live on the next request." };
  if (isKeyring(k)) return { tone: "warn", text: `Protects other data. ${known(k)?.why || ""} Needs a recent sign-in.` };
  return { tone: "ok", text: `${known(k) ? "" : "New key. "}Sealed into the database. Live on the next request.` };
}

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

// Keyring keys need a sign-in from the last 30 minutes; the browser asks for
// one first instead of letting the server refuse.
const guarded = (key, action) =>
  isKeyring(key) ? withFreshAuth(`change ${key}`, action) : action();

export default function EnvPanel() {
  const [state, setState] = useState(null);
  const [editing, setEditing] = useState(null); // key
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [dotenv, setDotenv] = useState("");
  const [importing, setImporting] = useState(false);

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

  const run = async (label, fn) => {
    setErr("");
    setMsg("");
    setBusy(label);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const save = (key, value, after) =>
    run("Saving…", async () => {
      const out = await guarded(key, () => call({ action: "set", key, value }));
      setMsg(`${out.key} ${out.created === false ? "updated" : "saved"}. Live on the next request.`);
      after?.();
    });

  const remove = (row) => {
    if (
      !window.confirm(
        row.cls === "runtime"
          ? `Clear ${row.key}? It falls back to its default.`
          : `Delete ${row.key}? Anything using it stops seeing it on the next request.${
              row.keyring ? `\n\n${row.why}` : ""
            }`
      )
    )
      return;
    run("Deleting…", async () => {
      await guarded(row.key, () => call({ action: "delete", key: row.key }));
      setMsg(`${row.key} removed.`);
    });
  };

  const doImport = () =>
    run("Importing…", async () => {
      const keys = dotenv
        .split(/\r?\n/)
        .map((l) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l)?.[1]?.toUpperCase())
        .filter(Boolean);
      const action = () => call({ action: "import", text: dotenv });
      const out = keys.some(isKeyring)
        ? await withFreshAuth("import keys that protect other data", action)
        : await action();
      setMsg(
        `Imported ${out.imported}: ${out.created.length} new, ${out.updated.length} updated` +
          (out.settings.length ? `, ${out.settings.length} settings` : "") +
          (out.refused.length ? `. Skipped ${out.refused.map((r) => r.key).join(", ")}.` : ".") +
          " Live on the next request."
      );
      setDotenv("");
      setImporting(false);
    });

  const grouped = useMemo(
    () => (state ? GROUPS.map((g) => ({ ...g, rows: state.rows.filter(g.match) })) : []),
    [state]
  );
  const missing = state?.missingRequired || [];
  const notMoved = state?.notMoved || [];
  const dest = destinationOf(newKey);

  return (
    <main className="admin-main ev-main">
      <div className="ops-head">
        <div>
          <h3>Environment</h3>
          <p className="admin-sub ev-sub">
            Every variable this site uses, kept in the database. Add, change or delete any of them
            here or over MCP, and the change is live on the next request. Values are never shown.
          </p>
        </div>
        <span>
          <button className="admin-ghost" type="button" onClick={load} disabled={!!busy}>
            Refresh
          </button>
        </span>
      </div>

      {state ? (
        <div className={`ev-status ${missing.length || !state.store.configured || state.store.error ? "bad" : "ok"}`}>
          <strong>
            {!state.store.configured
              ? "ENV_KEY is not set on this deployment"
              : missing.length
              ? `${missing.length} required variable${missing.length === 1 ? "" : "s"} not set`
              : "Everything required is set"}
          </strong>
          <span>{missing.length ? missing.join(", ") : state.store.note}</span>
        </div>
      ) : null}

      {/* What moving fully into the database is still waiting on. */}
      {notMoved.length ? (
        <div className="ev-moving">
          <p>
            <strong>
              {notMoved.length} still read from the deployment, not the database:
            </strong>{" "}
            {notMoved.join(", ")}. Paste your .env below to move them in one go, then remove them
            from Vercel.
          </p>
          <button className="admin-ghost ev-sm" type="button" onClick={() => setImporting(true)}>
            Import a .env
          </button>
        </div>
      ) : null}

      {busy ? <p className="ev-busy">{busy}</p> : null}
      {err ? <p className="admin-err">{err}</p> : null}
      {msg ? <p className="ev-ok">{msg}</p> : null}

      <form
        className="ev-add"
        onSubmit={(e) => {
          e.preventDefault();
          save(newKey.trim(), newValue, () => {
            setNewKey("");
            setNewValue("");
          });
        }}
        aria-labelledby="ev-add-h"
      >
        <div className="ev-add-head">
          <h4 id="ev-add-h">Add a variable</h4>
          <button className="ev-link" type="button" onClick={() => setImporting((v) => !v)}>
            {importing ? "Add one instead" : "Import a .env file"}
          </button>
        </div>

        {importing ? (
          <>
            <textarea
              className="admin-input ev-dotenv"
              rows={8}
              value={dotenv}
              onChange={(e) => setDotenv(e.target.value)}
              placeholder={"# Paste a .env file\nLINKEDIN_CLIENT_ID=...\nLINKEDIN_CLIENT_SECRET=..."}
              spellCheck={false}
              aria-label=".env file contents"
            />
            <div className="ev-add-row">
              <p className="ev-dest">
                Every line is checked before anything is saved. ENV_KEY is skipped; existing keys are
                replaced.
              </p>
              <button className="admin-primary ev-sm" type="button" disabled={!!busy || !dotenv.trim()} onClick={doImport}>
                Import
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="ev-add-row">
              <input
                className="admin-input ev-add-key"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
                placeholder="KEY_NAME"
                aria-label="Variable name"
                spellCheck={false}
                autoComplete="off"
              />
              <input
                className="admin-input ev-add-value"
                type="password"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="Value, never shown again"
                aria-label="Value"
                autoComplete="new-password"
              />
              <button
                className="admin-primary ev-sm"
                type="submit"
                disabled={!!busy || !newKey.trim() || !newValue.trim() || dest?.tone === "bad"}
              >
                Save
              </button>
            </div>
            <p className={`ev-dest ${dest?.tone || ""}`}>
              {dest ? dest.text : "Typing an existing name replaces its value."}
            </p>
          </>
        )}
      </form>

      {grouped.map((g) =>
        g.rows.length ? (
          <section className="ev-group" key={g.id} data-group={g.id}>
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
                    <p className="ev-what">{r.what || "Added by you."}</p>
                    {(r.keyring || r.cls === "bootstrap") && r.why ? <p className="ev-why">{r.why}</p> : null}
                  </div>

                  <div className="ev-state">
                    {r.present ? (
                      <span className="ev-hint" title={r.public ? "" : "Masked: values are never shown"}>
                        {r.hint || "set"}
                      </span>
                    ) : (
                      <span className="ev-no">not set</span>
                    )}
                    {r.present && r.source && r.source !== "unset" && r.cls !== "bootstrap" ? (
                      <span className={`ev-src ${r.source}`} title="Where the value is coming from right now">
                        {r.source}
                      </span>
                    ) : null}
                  </div>

                  <div className="ev-actions">
                    {!r.manageable ? (
                      <span className="ev-locked">deployment only</span>
                    ) : editing === r.key ? null : (
                      <>
                        <button
                          className="admin-ghost ev-sm"
                          type="button"
                          disabled={!state.store.configured}
                          onClick={() => {
                            setEditing(r.key);
                            setDraft("");
                          }}
                        >
                          {r.present ? "Change" : "Set"}
                        </button>
                        {r.source === "database" ? (
                          <button className="admin-ghost ev-sm" type="button" onClick={() => remove(r)}>
                            {r.cls === "runtime" ? "Clear" : "Delete"}
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
                        save(r.key, draft, () => {
                          setEditing(null);
                          setDraft("");
                        });
                      }}
                    >
                      <input
                        className="admin-input"
                        type={r.public ? "text" : "password"}
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={r.public ? "Value" : "New value, never shown again"}
                        autoComplete="new-password"
                      />
                      <button className="admin-primary ev-sm" type="submit" disabled={!draft || !!busy}>
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
                      <span className={r.keyring ? "ev-warn" : "ev-live"}>
                        {r.keyring ? "Needs a recent sign-in. Live on the next request." : "Live on the next request."}
                      </span>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null
      )}

      <p className="ev-foot">
        Everything here is stored as one blob sealed with ENV_KEY. Even the names are inside it, and
        nothing is ever sent back to this page. A value stored here wins over the same key in the
        deployment; deleting it lets the deployment&apos;s value apply again.
      </p>
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
      .ev-group[data-group="runtime"] header {
        border-left-color: var(--a-amber, #ffb020);
      }
      .ev-group[data-group="bootstrap"] header {
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
      .ev-live {
        font-size: 11px;
        color: var(--a-amber, #ffb020);
      }

      /* Insert or update. The destination line under the key is the point:
         it says where the value will live before anything is saved. */
      .ev-add {
        margin: 18px 0 4px;
        padding: 14px 16px;
        border: 1px solid var(--a-line, #23262f);
        border-left: 3px solid var(--a-amber, #ffb020);
        border-radius: 11px;
        background: var(--a-raise, #15171d);
      }
      /* Keyring: the left edge says "careful" before the words do. */
      .ev-group[data-group="keyring"] header {
        border-left-color: #c9822c;
      }
      .ev-add-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }
      .ev-link {
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
        border-bottom: 1px dashed var(--a-line, #3a3f4d);
        cursor: pointer;
      }
      .ev-link:hover,
      .ev-link:focus-visible {
        color: var(--a-text, #e7e8ee);
        border-bottom-color: var(--a-amber, #ffb020);
      }
      .ev-dotenv {
        width: 100%;
        margin-bottom: 8px;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12.5px;
        line-height: 1.55;
        resize: vertical;
      }
      .ev-add-row .ev-dest {
        flex: 1;
        margin: 0;
      }
      /* What moving fully into the database is still waiting on. */
      .ev-moving {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin: 10px 0 0;
        padding: 10px 14px;
        border: 1px dashed rgba(255, 176, 32, 0.45);
        border-radius: 11px;
      }
      .ev-moving p {
        margin: 0;
        flex: 1 1 320px;
        font-size: 12px;
        line-height: 1.55;
        color: var(--a-dim, #8b90a0);
      }
      .ev-moving strong {
        color: var(--a-text, #e7e8ee);
        font-weight: 600;
      }
      .ev-add h4 {
        margin: 0 0 10px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 14px;
        color: var(--a-text, #e7e8ee);
      }
      .ev-add-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }
      .ev-add-key {
        flex: 0 1 280px;
        min-width: 200px;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12.5px;
      }
      .ev-add-value {
        flex: 1 1 260px;
        min-width: 200px;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12.5px;
      }
      .ev-dest {
        margin: 8px 0 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--a-dim, #8b90a0);
      }
      .ev-dest.ok {
        color: var(--a-amber, #ffb020);
      }
      .ev-dest.warn {
        color: #ffd27a;
      }
      .ev-dest.bad {
        color: #ff9a9a;
      }
      .ev-src.database {
        color: var(--a-amber, #ffb020);
        border-color: rgba(255, 176, 32, 0.45);
      }
      .ev-group[data-group="stored"] header {
        border-left-color: var(--a-amber, #ffb020);
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
