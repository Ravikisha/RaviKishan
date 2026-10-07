// Passwords and API keys.
//
// DESIGN
//
// The job of a password list is NOT to show you passwords. It is to let you
// find the right entry and then get its value somewhere else — a login form, a
// config file, a terminal. So the list shows everything except the value, and
// the one loud control on each row is Copy, not Reveal: copying is what you
// actually came to do, and it puts the secret on the clipboard instead of on
// the screen where a screen-share or a shoulder would catch it.
//
// Revealing is available, one at a time, and it costs a recent sign-in. That
// is deliberate friction on the only action that puts a credential in pixels.
//
// The second thing the list has to answer is which secrets an AI can read.
// That is a per-secret flag, off by default, and it is the one piece of state
// worth seeing at a glance — so it reads as a word on the row ("agents" in
// amber) rather than a toggle you have to open each entry to check. Everything
// else about an entry is behind the row.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { auth } from "../../lib/firebase";
import { reauthenticate } from "../../lib/reauth";

const KINDS = [
  ["password", "Password"],
  ["apiKey", "API key"],
  ["token", "Token"],
  ["sshKey", "SSH key"],
  ["note", "Secure note"],
  ["other", "Other"],
];

const BLANK = {
  name: "",
  value: "",
  kind: "password",
  username: "",
  url: "",
  notes: "",
  tags: "",
  agentReadable: false,
};

async function call(body) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const res = await fetch("/api/secrets", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error || `HTTP ${res.status}`);
    e.code = json.code || "";
    throw e;
  }
  return json;
}

export default function SecretsPanel({ user }) {
  const [configured, setConfigured] = useState(null);
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [shown, setShown] = useState({}); // id -> plaintext, this page only
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setBusy("Reading…");
    try {
      const st = await call({ action: "status" });
      setConfigured(st.configured);
      if (st.configured) setRows((await call({ action: "list" })).secrets);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.username, r.url, r.notes, (r.tags || []).join(" "), r.kind]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rows, query]);

  // Reveal and copy share the same fetch; only what happens next differs.
  const fetchValue = async (row) => {
    try {
      return (await call({ action: "reveal", name: row.name })).value;
    } catch (e) {
      if (e.code === "secrets/stale-auth") {
        // Step up rather than refuse: the person is here, they just signed in
        // longer ago than this action allows.
        await reauthenticate();
        return (await call({ action: "reveal", name: row.name })).value;
      }
      throw e;
    }
  };

  const copy = async (row) => {
    setErr("");
    try {
      const value = await fetchValue(row);
      await navigator.clipboard.writeText(value);
      setMsg(`${row.name} copied. It is on the clipboard, not on the screen.`);
      // Not held in state at all on this path — copying should leave nothing
      // behind for a later render to put on screen.
      setTimeout(() => setMsg(""), 4000);
    } catch (e) {
      setErr(e.message);
    }
  };

  const reveal = async (row) => {
    setErr("");
    try {
      if (shown[row.id]) {
        setShown((s) => {
          const n = { ...s };
          delete n[row.id];
          return n;
        });
        return;
      }
      const value = await fetchValue(row);
      setShown((s) => ({ ...s, [row.id]: value }));
    } catch (e) {
      setErr(e.message);
    }
  };

  const save = async (form) => {
    setErr("");
    setBusy("Saving…");
    try {
      await call({
        action: "save",
        ...form,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setMsg(`${form.name} saved.`);
      setEditing(null);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const remove = async (row) => {
    if (
      !window.confirm(
        `Delete "${row.name}"? A secret is not versioned — there is no snapshot to restore from.`
      )
    )
      return;
    try {
      await call({ action: "delete", name: row.name });
      setMsg(`${row.name} deleted.`);
      await load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const toggleAgent = async (row) => {
    const next = !row.agentReadable;
    if (
      next &&
      !window.confirm(
        `Let AI agents read "${row.name}"?\n\nAny MCP token with the "secrets" scope will be able to read this value, and every read is recorded in the audit log. Off is the safe default.`
      )
    )
      return;
    try {
      await call({ action: "save", name: row.name, agentReadable: next });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  };

  if (configured === false) {
    return (
      <main className="admin-main se-main">
        <div className="ops-head">
          <h3>Secrets</h3>
        </div>
        <p className="se-off">
          Not configured on this deployment. Set <code>SECRETS_KEY</code> to a 32-byte value and
          restart — it is what every stored value is sealed with, and it lives only in the
          environment, never in the database.
        </p>
        <pre className="se-pre">
          node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64url&apos;))&quot;
        </pre>
        <SecretsStyles />
      </main>
    );
  }

  return (
    <main className="admin-main se-main">
      <div className="ops-head">
        <div>
          <h3>Secrets</h3>
          <p className="admin-sub se-sub">
            Passwords and API keys, sealed with a key that lives only in the deployment. Copy puts a
            value on the clipboard; revealing it on screen needs a sign-in from the last 30 minutes.
            Agents can read only what you mark.
          </p>
        </div>
        <span className="se-actions">
          <button className="admin-primary" type="button" onClick={() => setEditing({ ...BLANK })}>
            New secret
          </button>
        </span>
      </div>

      {busy ? <p className="se-busy">{busy}</p> : null}
      {err ? <p className="admin-err">{err}</p> : null}
      {msg ? <p className="se-ok">{msg}</p> : null}

      <input
        className="admin-input se-search"
        placeholder="Search names, usernames, URLs, tags"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {filtered.length === 0 ? (
        <p className="se-empty">
          {rows.length === 0 ? "Nothing stored yet." : "Nothing matches that."}
        </p>
      ) : (
        <ul className="se-list">
          {filtered.map((r) => (
            <li key={r.id} className={`se-row${r.agentReadable ? " agent" : ""}`}>
              <div className="se-id">
                <p className="se-name">
                  {r.name}
                  {r.agentReadable ? <em title="Readable by AI agents">agents</em> : null}
                </p>
                <p className="se-meta">
                  <span>{KINDS.find(([k]) => k === r.kind)?.[1] || r.kind}</span>
                  {r.username ? (
                    <>
                      <span className="se-hair" aria-hidden="true" />
                      <span>{r.username}</span>
                    </>
                  ) : null}
                  <span className="se-hair" aria-hidden="true" />
                  <span className="se-hint">{shown[r.id] || r.hint || "••••"}</span>
                  {r.lastReadAt ? (
                    <>
                      <span className="se-hair" aria-hidden="true" />
                      <span title={`by ${r.lastReadBy}`}>read {r.lastReadAt.slice(0, 10)}</span>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="se-row-actions">
                <button className="admin-primary se-sm" type="button" onClick={() => copy(r)}>
                  Copy
                </button>
                <button className="admin-ghost se-sm" type="button" onClick={() => reveal(r)}>
                  {shown[r.id] ? "Hide" : "Reveal"}
                </button>
                <button
                  className={`admin-ghost se-sm${r.agentReadable ? " on" : ""}`}
                  type="button"
                  title="Whether an MCP token with the secrets scope may read this"
                  onClick={() => toggleAgent(r)}
                >
                  {r.agentReadable ? "Agents: on" : "Agents: off"}
                </button>
                <button
                  className="admin-ghost se-sm"
                  type="button"
                  onClick={() =>
                    setEditing({
                      ...BLANK,
                      ...r,
                      value: "",
                      tags: (r.tags || []).join(", "),
                    })
                  }
                >
                  Edit
                </button>
                <button className="admin-ghost se-sm se-del" type="button" onClick={() => remove(r)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <SecretEditor
          initial={editing}
          existing={rows.some((r) => r.name === editing.name)}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      ) : null}

      <SecretsStyles />
    </main>
  );
}

function SecretEditor({ initial, existing, onCancel, onSave }) {
  const [form, setForm] = useState(initial);
  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="se-scrim" onClick={onCancel}>
      <div
        className="se-modal"
        role="dialog"
        aria-modal="true"
        aria-label={existing ? "Edit secret" : "New secret"}
        onClick={(e) => e.stopPropagation()}
      >
        <h4>{existing ? `Edit ${initial.name}` : "New secret"}</h4>

        <label className="se-field">
          <span>Name</span>
          <input
            className="admin-input"
            value={form.name}
            onChange={set("name")}
            disabled={existing}
            placeholder="AWS production"
          />
        </label>

        <label className="se-field">
          <span>
            {existing ? "New value — leave empty to keep the current one" : "Value"}
          </span>
          <textarea
            className="admin-input se-area"
            rows={3}
            value={form.value}
            onChange={set("value")}
            // A password field would be hidden from the person typing it while
            // still sitting in the DOM; this is the one place the value is
            // meant to be visible, because they are entering it.
            placeholder={existing ? "Unchanged" : "Paste the password or key"}
          />
        </label>

        <div className="se-two">
          <label className="se-field">
            <span>Kind</span>
            <select className="admin-input" value={form.kind} onChange={set("kind")}>
              {KINDS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="se-field">
            <span>Username</span>
            <input className="admin-input" value={form.username} onChange={set("username")} />
          </label>
        </div>

        <div className="se-two">
          <label className="se-field">
            <span>URL</span>
            <input className="admin-input" value={form.url} onChange={set("url")} />
          </label>
          <label className="se-field">
            <span>Tags, comma separated</span>
            <input className="admin-input" value={form.tags} onChange={set("tags")} />
          </label>
        </div>

        <label className="se-field">
          <span>Notes</span>
          <textarea className="admin-input se-area" rows={2} value={form.notes} onChange={set("notes")} />
        </label>

        <label className="se-agent">
          <input type="checkbox" checked={!!form.agentReadable} onChange={set("agentReadable")} />
          <span>
            <strong>Readable by AI agents</strong>
            Off by default. With this on, any MCP token holding the <code>secrets</code> scope can
            read this value, and every read is written to the audit log.
          </span>
        </label>

        <div className="se-modal-actions">
          <button className="admin-ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="admin-primary"
            type="button"
            disabled={!form.name.trim() || (!existing && !form.value)}
            onClick={() => onSave(form)}
          >
            {existing ? "Save changes" : "Store secret"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SecretsStyles() {
  return (
    <style jsx global>{`
      .se-main {
        max-width: 1000px;
      }
      .se-sub {
        max-width: 74ch;
        line-height: 1.55;
        margin: 6px 0 0;
      }
      .se-actions {
        display: flex;
        gap: 8px;
      }
      .se-busy,
      .se-ok,
      .se-off {
        font-size: 12.5px;
        margin: 10px 0;
        line-height: 1.55;
      }
      .se-busy,
      .se-off {
        color: var(--a-dim, #8b90a0);
        max-width: 74ch;
      }
      .se-ok {
        color: var(--a-amber, #ffb020);
      }
      .se-pre {
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #23262f);
        border-radius: 9px;
        padding: 11px 13px;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
        overflow-x: auto;
      }
      .se-search {
        margin: 14px 0 12px;
        max-width: 420px;
      }
      .se-empty {
        font-size: 12.5px;
        color: #5c6377;
      }

      .se-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .se-row {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        padding: 10px 10px 10px 12px;
        border-radius: 9px;
        /* The left edge carries state, as everywhere else in this admin.
           Amber means an agent can read it — the one fact worth seeing
           without opening the row. */
        border-left: 2px solid var(--a-line, #2a2e38);
      }
      .se-row.agent {
        border-left-color: var(--a-amber, #ffb020);
      }
      .se-row:hover {
        background: rgba(255, 255, 255, 0.03);
      }
      .se-id {
        flex: 1;
        min-width: 200px;
      }
      .se-name {
        margin: 0;
        font-size: 13.5px;
        color: var(--a-text, #e7e8ee);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .se-name em {
        font-style: normal;
        font-size: 10px;
        color: var(--a-amber, #ffb020);
        border: 1px solid rgba(255, 176, 32, 0.4);
        border-radius: 999px;
        padding: 1px 7px;
      }
      .se-meta {
        margin: 4px 0 0;
        display: flex;
        align-items: center;
        gap: 9px;
        flex-wrap: wrap;
        font-size: 11px;
        color: var(--a-dim, #7d8496);
      }
      /* Hairlines, never middots. */
      .se-hair {
        width: 13px;
        height: 1px;
        background: var(--a-line, #2a2e38);
        flex: none;
      }
      .se-hint {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        color: var(--a-text, #e7e8ee);
        overflow-wrap: anywhere;
      }
      .se-row-actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .se-sm {
        padding: 5px 10px;
        font-size: 12px;
      }
      .se-sm.on {
        border-color: var(--a-amber, #ffb020);
        color: var(--a-amber, #ffb020);
      }
      .se-del:hover {
        border-color: #ff6b6b;
        color: #ff6b6b;
      }

      .se-scrim {
        position: fixed;
        inset: 0;
        z-index: 120;
        background: rgba(4, 5, 8, 0.72);
        display: grid;
        place-items: center;
        padding: 18px;
      }
      .se-modal {
        width: min(560px, 100%);
        max-height: 88vh;
        overflow-y: auto;
        background: var(--a-panel, #111319);
        border: 1px solid var(--a-line, #23262f);
        border-radius: 14px;
        padding: 18px;
      }
      .se-modal h4 {
        margin: 0 0 14px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 15px;
        color: var(--a-text, #e7e8ee);
      }
      .se-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 11px;
      }
      .se-field > span {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
      }
      .se-area {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 12.5px;
      }
      .se-two {
        display: flex;
        gap: 11px;
        flex-wrap: wrap;
      }
      .se-two .se-field {
        flex: 1;
        min-width: 190px;
      }
      .se-agent {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        padding: 11px 12px;
        border: 1px dashed var(--a-line, #2b3040);
        border-radius: 10px;
        margin: 4px 0 14px;
      }
      .se-agent span {
        font-size: 11.5px;
        line-height: 1.55;
        color: var(--a-dim, #8b90a0);
      }
      .se-agent strong {
        display: block;
        color: var(--a-text, #e7e8ee);
        font-weight: 600;
        font-size: 12.5px;
        margin-bottom: 2px;
      }
      .se-agent code {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11px;
      }
      .se-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      @media (max-width: 720px) {
        .se-row-actions {
          width: 100%;
        }
      }
    `}</style>
  );
}
