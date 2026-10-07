// The authentication centre.
//
// DESIGN
//
// The obvious shape for this is a grid of provider cards, each with a Connect
// button. It is also the wrong shape, because it organises by SERVICE when the
// question anyone arrives with is about PEOPLE: "I have two addresses — which
// of my accounts is which, and which one is about to post?"
//
// So the panel is a ROSTER. Each person is a band, their accounts are rows
// under it, and anything not yet claimed sits in a last band that reads as an
// invitation rather than an error.
//
// THE ONE BOLD THING is the amber chip. A row that is the default for a
// service wears that service's name in solid amber on its right. Everything
// else on the roster is grey hairlines, so you can scan fourteen rows and see
// at a glance which accounts actually do work — and, just as useful, which
// ones were connected once and have done nothing since. The chip is the only
// saturated thing on the page and the only thing that moves: setting a default
// scales it in from the left, the same highlighter gesture as the blog's
// contents rail.
//
// The left edge carries connection state, as everywhere else in this console:
// solid for a live connection, dashed for one that still lives in the old
// single-account store and needs reconnecting, red when a token has run out.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assignIdentity,
  connectProvider,
  createIdentity,
  deleteIdentity,
  finishConnect,
  forgetAccount,
  forgetLogin,
  loadDirectory,
  saveLogin,
  setDefaultAccount,
  connectKey,
  setAgentReadable,
} from "../../lib/accountsClient";

const UNSORTED = "__unsorted";

const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(+d)
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

export default function AccountsPanel() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("Reading your accounts…");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState("");
  const [adding, setAdding] = useState(false);
  const [newIdentity, setNewIdentity] = useState({ label: "", email: "", note: "" });
  const [justSet, setJustSet] = useState("");
  const claimed = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setData(await loadDirectory());
      setErr("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }, []);

  // The callback seals the credential into a five-minute cookie and THIS
  // browser writes it. Claiming before the first read means a connection that
  // just succeeded is already in the list rather than appearing one refresh
  // later.
  useEffect(() => {
    (async () => {
      if (claimed.current) return;
      claimed.current = true;
      try {
        const q = new URLSearchParams(window.location.search);
        const connected = q.get("connected");
        const failed = q.get("connectError");
        if (connected) {
          setBusy("Saving the connection…");
          try {
            const rec = await finishConnect(connected);
            setMsg(`Connected${rec?.label ? ` as ${rec.label}` : ""}.`);
          } catch (e) {
            setErr(e.message);
          }
        } else if (failed) {
          setErr(failed);
        }
        if (connected || failed) {
          q.delete("connected");
          q.delete("connectError");
          q.delete("account");
          const rest = q.toString();
          window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
        }
      } catch (_) {}
      await refresh();
    })();
  }, [refresh]);

  // Memoised because each of these feeds a hook below, and a fresh [] every
  // render would re-run the groupings on every keystroke in the forms.
  const accounts = useMemo(() => data?.accounts || [], [data]);
  const identities = useMemo(() => data?.identities || [], [data]);
  const services = useMemo(() => data?.services || [], [data]);
  const providers = useMemo(() => data?.providers || [], [data]);
  const defaults = useMemo(() => data?.defaults || {}, [data]);

  const providerLabel = useCallback(
    (id) => providers.find((p) => p.id === id)?.label || id,
    [providers]
  );

  // Which services each account is the default for. One pass, so a row never
  // has to search the defaults map itself.
  const chipsByKey = useMemo(() => {
    const out = {};
    for (const s of services) {
      const key = defaults[s.id];
      if (!key) continue;
      (out[key] ||= []).push(s);
    }
    return out;
  }, [services, defaults]);

  const bands = useMemo(() => {
    const byId = new Map(identities.map((i) => [i.id, { ...i, rows: [] }]));
    const loose = [];
    for (const a of accounts) {
      const band = a.identityId && byId.get(a.identityId);
      if (band) band.rows.push(a);
      else loose.push(a);
    }
    const out = [...byId.values()].filter((b) => b.rows.length || identities.length);
    if (loose.length) {
      out.push({ id: UNSORTED, label: "Not sorted yet", email: "", rows: loose });
    }
    return out;
  }, [accounts, identities]);

  // The status line. Says what needs doing, in the same voice and the same
  // graded colours as the rail in AdminShell.
  const health = useMemo(() => {
    const expiring = accounts.filter(
      (a) => a.expiresInDays !== null && a.expiresInDays <= 14
    );
    const expired = expiring.filter((a) => a.expiresInDays <= 0);
    const legacy = accounts.filter((a) => a.legacy);
    const gaps = accounts.filter((a) => (a.missingScopes || []).length);
    const parts = [];
    if (expired.length) parts.push(`${expired.length} expired`);
    if (expiring.length - expired.length > 0)
      parts.push(`${expiring.length - expired.length} expiring soon`);
    if (legacy.length) parts.push(`${legacy.length} to reconnect`);
    if (gaps.length) parts.push(`${gaps.length} missing permissions`);
    return {
      parts,
      tone: expired.length ? "late" : expiring.length || legacy.length || gaps.length ? "soon" : "ok",
      people: identities.length,
    };
  }, [accounts, identities]);

  const act = async (label, fn) => {
    setBusy(label);
    setErr("");
    setMsg("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const chooseDefault = (service, key) =>
    act("Saving…", async () => {
      await setDefaultAccount(service, key);
      setJustSet(`${service}:${key}`);
      setTimeout(() => setJustSet((c) => (c === `${service}:${key}` ? "" : c)), 600);
    });

  if (!data && busy) {
    return (
      <main className="admin-main">
        <p className="ac-wait">{busy}</p>
        <Styles />
      </main>
    );
  }

  return (
    <main className="admin-main">
      {/* No heading here: AdminShell already prints the section name, and two
          "Accounts" stacked on top of each other is the kind of thing a
          screenshot catches and a component in isolation never does. The
          status line IS the header. */}
      <header className="ac-top">
        <div>
          <p className={`ac-state ac-${health.tone}`}>
            {accounts.length === 0
              ? "Nothing connected yet. Connect an account below and it stays connected — agents and the admin both use it."
              : health.parts.length
              ? `${accounts.length} accounts, ${health.people || "no"} ${
                  health.people === 1 ? "person" : "people"
                } — ${health.parts.join(", ")}.`
              : `${accounts.length} accounts across ${health.people || "no"} ${
                  health.people === 1 ? "person" : "people"
                }. All current.`}
          </p>
        </div>
      </header>

      {err ? <p className="admin-err">{err}</p> : null}
      {msg ? <p className="ac-ok">{msg}</p> : null}

      {/* ---- the roster ---- */}
      {bands.map((band) => (
        <section className="ac-band" key={band.id}>
          <div className="ac-band-head">
            <h3>{band.label}</h3>
            {band.email ? <span className="ac-band-mail">{band.email}</span> : null}
            {band.id !== UNSORTED ? (
              <button
                type="button"
                className="ac-quiet"
                onClick={() =>
                  act("Removing…", () => deleteIdentity(band.id))
                }
              >
                Remove person
              </button>
            ) : null}
          </div>

          {band.rows.length === 0 ? (
            <p className="ac-empty">No accounts under this person yet.</p>
          ) : (
            <ul className="ac-rows">
              {band.rows.map((a) => (
                <Row
                  key={a.key}
                  account={a}
                  chips={chipsByKey[a.key] || []}
                  identities={identities}
                  providerLabel={providerLabel}
                  justSet={justSet}
                  open={open === a.key}
                  onOpen={() => setOpen(open === a.key ? "" : a.key)}
                  onAssign={(identityId) =>
                    act("Moving…", () => assignIdentity(a.provider, a.accountId, identityId))
                  }
                  onForget={() =>
                    act("Disconnecting…", () => forgetAccount(a.provider, a.accountId))
                  }
                  apiKey={providers.some((p) => p.id === a.provider && p.auth === "apiKey")}
                  onAgentReadable={(value) =>
                    act("Saving…", () => setAgentReadable(a.provider, a.accountId, value))
                  }
                  onReconnect={() => connectProvider(a.provider, "accounts")}
                  onSaveLogin={(login) =>
                    act("Saving the sign-in…", () =>
                      saveLogin({ provider: a.provider, accountId: a.accountId, ...login })
                    )
                  }
                  onForgetLogin={() =>
                    act("Removing the sign-in…", () => forgetLogin(a.provider, a.accountId))
                  }
                  secretsConfigured={data.secretsConfigured}
                />
              ))}
            </ul>
          )}
        </section>
      ))}

      {/* ---- adding a person ---- */}
      <section className="ac-band ac-add">
        {adding ? (
          <form
            className="ac-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newIdentity.label.trim()) return;
              act("Adding…", async () => {
                await createIdentity(newIdentity);
                setNewIdentity({ label: "", email: "", note: "" });
                setAdding(false);
              });
            }}
          >
            <input
              className="admin-input"
              autoFocus
              placeholder="Name, e.g. Me, personal"
              value={newIdentity.label}
              onChange={(e) => setNewIdentity({ ...newIdentity, label: e.target.value })}
            />
            <input
              className="admin-input"
              placeholder="Main address"
              value={newIdentity.email}
              onChange={(e) => setNewIdentity({ ...newIdentity, email: e.target.value })}
            />
            <button className="admin-primary" type="submit">
              Add person
            </button>
            <button type="button" className="ac-quiet" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="ac-ghost" onClick={() => setAdding(true)}>
            Add a person
          </button>
        )}
      </section>

      {/* ---- who does what ---- */}
      <section className="ac-band">
        <div className="ac-band-head">
          <h3>Who does what</h3>
        </div>
        <p className="ac-note">
          The account each job uses when nothing names one. A job with no choice here still works
          while exactly one account could do it; past that it asks rather than guesses.
        </p>
        <ul className="ac-jobs">
          {services.map((s) => {
            const able = accounts.filter((a) => s.providers.includes(a.provider));
            const value = defaults[s.id] || "";
            return (
              <li className="ac-job" key={s.id}>
                <span className="ac-job-name">{s.label}</span>
                {able.length === 0 ? (
                  <span className="ac-job-none">
                    Connect {s.providers.map(providerLabel).join(" or ")} first
                  </span>
                ) : (
                  <select
                    className="admin-input ac-pick"
                    value={value}
                    onChange={(e) => chooseDefault(s.id, e.target.value)}
                  >
                    <option value="">
                      {able.length === 1 ? `${able[0].label} (the only one)` : "Ask me each time"}
                    </option>
                    {able.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label} — {providerLabel(a.provider)}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---- connect something new ---- */}
      <section className="ac-band">
        <div className="ac-band-head">
          <h3>Connect an account</h3>
        </div>
        <p className="ac-note">
          Each of these can be connected more than once. Sign in as whoever you want this one to be
          — the consent screen offers the account chooser every time.
        </p>
        <ul className="ac-providers">
          {providers.map((p) => {
            const held = accounts.filter((a) => a.provider === p.id).length;
            if (p.auth === "apiKey") return <KeyConnect key={p.id} p={p} held={held} onDone={refresh} />;
            return (
              <li key={p.id} className={`ac-prov${p.configured ? "" : " off"}`}>
                <button
                  type="button"
                  disabled={!p.configured}
                  onClick={() => connectProvider(p.id, "accounts")}
                >
                  <span className="ac-prov-name">{p.label}</span>
                  <span className="ac-prov-held">
                    {p.configured
                      ? held
                        ? `${held} connected`
                        : "Connect"
                      : `Needs ${p.missing.join(", ")}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {busy ? <p className="ac-busy">{busy}</p> : null}
      <Styles />
    </main>
  );
}

/* ------------------------------------------------------------------ */

// A pasted-token provider has no consent screen to send you to, so its row is
// the form itself. The key leaves state the moment it is sent, and the server
// checks it with the provider before anything is stored.
function KeyConnect({ p, held, onDone }) {
  const [key, setKey] = useState("");
  const [state, setState] = useState({ busy: false, err: "", note: "" });
  const submit = async (e) => {
    e.preventDefault();
    const sent = key;
    setKey("");
    setState({ busy: true, err: "", note: "" });
    try {
      const out = await connectKey(p.id, sent);
      setState({
        busy: false,
        err: "",
        note: `${out.connected.label} connected.${out.warning ? ` ${out.warning}` : ""}`,
      });
      onDone();
    } catch (er) {
      setState({ busy: false, err: er.message, note: "" });
    }
  };
  return (
    <li className={`ac-prov ac-key${p.configured ? "" : " off"}`}>
      <form onSubmit={submit}>
        <span className="ac-prov-name">{p.label}</span>
        <span className="ac-prov-held">
          {held ? `${held} connected` : p.configured ? "Paste a token" : `Needs ${p.missing.join(", ")}`}
        </span>
        <input
          className="admin-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={p.keyHint}
          value={key}
          disabled={!p.configured || state.busy}
          onChange={(e) => setKey(e.target.value)}
          aria-label={`${p.label} token`}
        />
        <button type="submit" disabled={!p.configured || !key.trim() || state.busy}>
          {state.busy ? "Checking…" : "Connect"}
        </button>
        {p.tokenPage ? (
          <a href={p.tokenPage} target="_blank" rel="noreferrer" className="ac-key-link">
            Get a token
          </a>
        ) : null}
        {state.err ? <p className="ac-key-err">{state.err}</p> : null}
        {state.note ? <p className="ac-key-note">{state.note}</p> : null}
      </form>
    </li>
  );
}

function Row({
  account,
  chips,
  identities,
  providerLabel,
  justSet,
  open,
  onOpen,
  onAssign,
  onForget,
  onReconnect,
  apiKey,
  onAgentReadable,
  onSaveLogin,
  onForgetLogin,
  secretsConfigured,
}) {
  const [login, setLogin] = useState({ username: account.email || "", password: "", agentReadable: false });
  const expired = account.expiresInDays !== null && account.expiresInDays <= 0;
  const soon = account.expiresInDays !== null && account.expiresInDays > 0 && account.expiresInDays <= 14;
  const gaps = account.missingScopes || [];

  const edge = expired ? "bad" : account.legacy ? "old" : "live";

  return (
    <li className={`ac-row ac-${edge}${open ? " on" : ""}`}>
      <button type="button" className="ac-row-main" onClick={onOpen} aria-expanded={open}>
        <span className="ac-prov-of">{providerLabel(account.provider)}</span>
        <span className="ac-who">{account.label}</span>
        <span className="ac-chips">
          {chips.map((c) => (
            <span
              key={c.id}
              className={`ac-chip${justSet === `${c.id}:${account.key}` ? " in" : ""}`}
            >
              {c.label}
            </span>
          ))}
          {expired ? <span className="ac-warn bad">Expired</span> : null}
          {soon ? <span className="ac-warn soon">{account.expiresInDays}d left</span> : null}
          {account.legacy ? <span className="ac-warn old">Reconnect to name it</span> : null}
          {gaps.length ? <span className="ac-warn soon">Missing {gaps.length}</span> : null}
        </span>
      </button>

      {open ? (
        <div className="ac-detail">
          <dl className="ac-facts">
            <div>
              <dt>Account id</dt>
              <dd className="mono">{account.accountId}</dd>
            </div>
            {account.email ? (
              <div>
                <dt>Address</dt>
                <dd className="mono">{account.email}</dd>
              </div>
            ) : null}
            <div>
              <dt>Credential</dt>
              <dd>
                {account.kind === "refresh"
                  ? "Refreshes itself"
                  : account.expiresAt
                  ? `Runs out ${fmtDate(account.expiresAt)}`
                  : "Does not expire"}
              </dd>
            </div>
            {account.connectedAt ? (
              <div>
                <dt>Connected</dt>
                <dd>{fmtDate(account.connectedAt)}</dd>
              </div>
            ) : null}
          </dl>

          {gaps.length ? (
            <p className="ac-gap">
              This connection predates {gaps.length === 1 ? "a permission" : "some permissions"} it
              now needs: <span className="mono">{gaps.join(", ")}</span>. Everything else keeps
              working. Reconnect to add {gaps.length === 1 ? "it" : "them"}.
            </p>
          ) : null}

          <div className="ac-ctl">
            <label className="ac-assign">
              <span>Belongs to</span>
              <select
                className="admin-input"
                value={account.identityId || ""}
                disabled={account.legacy}
                onChange={(e) => onAssign(e.target.value)}
              >
                <option value="">Nobody yet</option>
                {identities.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
            </label>
            {apiKey ? (
              <label className="ac-agent">
                <input
                  type="checkbox"
                  checked={account.agentReadable === true}
                  onChange={(e) => onAgentReadable(e.target.checked)}
                />
                Agent may read this token
              </label>
            ) : (
              <button type="button" className="ac-ghost" onClick={onReconnect}>
                Reconnect
              </button>
            )}
            <button type="button" className="ac-danger" onClick={onForget} disabled={account.legacy}>
              Disconnect
            </button>
          </div>

          <details className="ac-login">
            <summary>Saved sign-in</summary>
            {!secretsConfigured ? (
              <p className="ac-note">
                Sign-ins cannot be saved until <span className="mono">SECRETS_KEY</span> is set on
                this deployment.
              </p>
            ) : (
              <>
                <p className="ac-note">
                  Kept sealed for when a provider asks you for it by hand. Nothing here signs in
                  with it, and no agent can read it unless you say so below.
                </p>
                <form
                  className="ac-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onSaveLogin(login);
                    setLogin({ ...login, password: "" });
                  }}
                >
                  <input
                    className="admin-input"
                    placeholder="Username or address"
                    value={login.username}
                    onChange={(e) => setLogin({ ...login, username: e.target.value })}
                  />
                  <input
                    className="admin-input"
                    type="password"
                    placeholder="Password"
                    autoComplete="new-password"
                    value={login.password}
                    onChange={(e) => setLogin({ ...login, password: e.target.value })}
                  />
                  <label className="ac-flag">
                    <input
                      type="checkbox"
                      checked={login.agentReadable}
                      onChange={(e) => setLogin({ ...login, agentReadable: e.target.checked })}
                    />
                    <span>An agent may read this</span>
                  </label>
                  <button className="admin-primary" type="submit">
                    Save sign-in
                  </button>
                  <button type="button" className="ac-quiet" onClick={onForgetLogin}>
                    Remove
                  </button>
                </form>
              </>
            )}
          </details>
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */

function Styles() {
  return (
    <style jsx global>{`
      .ac-wait,
      .ac-busy {
        color: var(--a-dim, #8b90a0);
        font-size: 12.5px;
        padding: 10px 2px;
      }
      .ac-top {
        padding: 2px 0 14px;
      }
      .ac-h {
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: 22px;
        letter-spacing: -0.015em;
        margin: 0;
        color: var(--a-text, #e7e8ee);
      }
      .ac-state {
        margin: 6px 0 0;
        font-size: 12.5px;
        line-height: 1.55;
        max-width: 72ch;
        padding-left: 10px;
        border-left: 2px solid var(--a-line, #2b3040);
        color: var(--a-dim, #8b90a0);
      }
      .ac-state.ac-soon {
        border-left-color: #ffb020;
      }
      .ac-state.ac-late {
        border-left-color: #e0564a;
      }
      .ac-ok {
        color: #ffb020;
        font-size: 12.5px;
        margin: 0 0 10px;
      }

      .ac-band {
        margin: 0 0 22px;
      }
      .ac-band-head {
        display: flex;
        align-items: baseline;
        gap: 12px;
        padding: 0 0 8px;
        border-bottom: 1px solid var(--a-line, #2b3040);
      }
      .ac-band-head h3 {
        font-family: "Space Grotesk", system-ui, sans-serif;
        font-size: 15.5px;
        font-weight: 600;
        margin: 0;
        color: var(--a-text, #e7e8ee);
      }
      .ac-band-mail {
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
      }
      .ac-band-head .ac-quiet {
        margin-left: auto;
      }
      .ac-empty,
      .ac-note {
        font-size: 12px;
        line-height: 1.6;
        color: var(--a-dim, #8b90a0);
        margin: 10px 0 0;
        max-width: 74ch;
      }

      .ac-rows {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .ac-row {
        border-bottom: 1px solid var(--a-line, #2b3040);
        border-left: 2px solid transparent;
        transition: border-color 0.12s ease, background 0.12s ease;
      }
      .ac-row.ac-live {
        border-left-color: #3a4154;
      }
      /* Dashed: still in the old single-account store, so it cannot be named,
         assigned or disconnected from here until it is reconnected. */
      .ac-row.ac-old {
        border-left-style: dashed;
        border-left-color: #5c5330;
      }
      .ac-row.ac-bad {
        border-left-color: #e0564a;
      }
      .ac-row.on {
        border-left-color: #ffb020;
        background: rgba(255, 176, 32, 0.03);
      }
      .ac-row-main {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 11px 12px;
        background: none;
        border: 0;
        text-align: left;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .ac-row-main:focus-visible {
        outline: 2px solid #ffb020;
        outline-offset: -2px;
      }
      .ac-prov-of {
        flex: none;
        width: 128px;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
      }
      .ac-who {
        font-size: 13.5px;
        color: var(--a-text, #e7e8ee);
        overflow-wrap: anywhere;
      }
      .ac-chips {
        margin-left: auto;
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 6px;
      }
      /* THE one saturated element on the roster: this account does this job. */
      .ac-chip {
        background: #ffb020;
        color: #11131a;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 999px;
        white-space: nowrap;
        transform-origin: left center;
      }
      .ac-chip.in {
        animation: ac-chip-in 0.24s cubic-bezier(0.2, 0.9, 0.3, 1);
      }
      @keyframes ac-chip-in {
        from {
          transform: scaleX(0.2);
          opacity: 0;
        }
      }
      .ac-warn {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid currentColor;
        white-space: nowrap;
      }
      .ac-warn.bad {
        color: #e0564a;
      }
      .ac-warn.soon {
        color: #ffb020;
      }
      .ac-warn.old {
        color: #8b90a0;
        border-style: dashed;
      }

      .ac-detail {
        padding: 2px 12px 16px 12px;
      }
      .ac-facts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 10px 22px;
        margin: 4px 0 0;
      }
      .ac-facts dt {
        font-size: 11px;
        color: var(--a-dim, #8b90a0);
      }
      .ac-facts dd {
        margin: 2px 0 0;
        font-size: 12.5px;
        color: var(--a-text, #e7e8ee);
        overflow-wrap: anywhere;
      }
      .mono {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11.5px;
      }
      .ac-gap {
        margin: 12px 0 0;
        font-size: 12px;
        line-height: 1.6;
        color: var(--a-dim, #8b90a0);
        border-left: 2px solid #ffb020;
        padding-left: 10px;
        max-width: 74ch;
      }

      .ac-ctl {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 10px;
        margin-top: 14px;
      }
      .ac-assign {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 11px;
        color: var(--a-dim, #8b90a0);
      }
      .ac-assign select {
        min-width: 180px;
      }

      .ac-ghost,
      .ac-quiet,
      .ac-danger {
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 8px;
        color: var(--a-dim, #8b90a0);
        font: inherit;
        font-size: 12px;
        padding: 7px 13px;
        cursor: pointer;
      }
      .ac-quiet {
        border-color: transparent;
        padding: 4px 6px;
      }
      .ac-ghost:hover,
      .ac-quiet:hover {
        color: var(--a-text, #e7e8ee);
        border-color: #ffb020;
      }
      .ac-danger:hover:not(:disabled) {
        color: #e0564a;
        border-color: #e0564a;
      }
      .ac-ghost:disabled,
      .ac-danger:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .ac-form {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        margin-top: 12px;
      }
      .ac-form .admin-input {
        min-width: 190px;
        flex: 1 1 190px;
        max-width: 320px;
      }
      .ac-flag {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
      }

      .ac-jobs {
        list-style: none;
        margin: 10px 0 0;
        padding: 0;
      }
      .ac-job {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 9px 0;
        border-bottom: 1px solid var(--a-line, #2b3040);
      }
      .ac-job-name {
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
        min-width: 150px;
      }
      .ac-job-none {
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
      }
      .ac-pick {
        margin-left: auto;
        min-width: 240px;
        max-width: 100%;
      }

      .ac-providers {
        list-style: none;
        margin: 12px 0 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: 8px;
      }
      .ac-prov button {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 3px;
        text-align: left;
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 10px;
        padding: 11px 13px;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .ac-prov button:hover:not(:disabled) {
        border-color: #ffb020;
      }
      /* A pasted-token provider: the row is the form. Same hairline box as
         the OAuth buttons beside it, so the grid still reads as one list. */
      .ac-key form {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 6px 10px;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 10px;
        padding: 11px 13px;
      }
      .ac-key .admin-input {
        grid-column: 1 / -1;
        font-family: "JetBrains Mono", monospace;
      }
      .ac-key button {
        width: auto;
        display: inline-block;
        grid-column: 1;
        justify-self: start;
        padding: 6px 14px;
      }
      .ac-key-link {
        grid-column: 2;
        align-self: center;
        font-size: 13px;
        color: var(--a-dim, #8b90a0);
      }
      .ac-key-err {
        grid-column: 1 / -1;
        margin: 0;
        font-size: 13px;
        color: #ff6b6b;
      }
      .ac-key-note {
        grid-column: 1 / -1;
        margin: 0;
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
      }
      .ac-agent {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
      }
      .ac-prov button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .ac-prov-name {
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
      }
      .ac-prov-held {
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }

      .ac-login {
        margin-top: 16px;
        border-top: 1px solid var(--a-line, #2b3040);
        padding-top: 10px;
      }
      .ac-login summary {
        cursor: pointer;
        font-size: 12.5px;
        color: var(--a-text, #e7e8ee);
      }

      @media (max-width: 720px) {
        .ac-row-main {
          flex-wrap: wrap;
          gap: 6px;
        }
        .ac-prov-of {
          width: auto;
        }
        .ac-chips {
          width: 100%;
          justify-content: flex-start;
          margin-left: 0;
        }
        .ac-job {
          flex-wrap: wrap;
        }
        .ac-pick {
          margin-left: 0;
          width: 100%;
        }
        .admin-input {
          font-size: 16px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .ac-chip.in {
          animation: none;
        }
      }
    `}</style>
  );
}
