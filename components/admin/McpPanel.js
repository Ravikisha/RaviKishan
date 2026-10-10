// MCP access tokens.
//
// Mint a token here, paste it into Claude Code / Codex / any MCP client, and
// that client can read and update your information through /api/mcp.
//
// The token is shown ONCE. It is self-contained — it carries your Firebase
// refresh token encrypted with a server-side secret — so there is nothing to
// look up later and nothing stored here but a label and the token id. Losing
// it means minting a new one; leaking it means revoking that id.
import React, { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
} from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { adminJson } from "../../lib/adminFetch";
import { logAdminAction } from "../../lib/auditLog";
import { withFreshAuth } from "../../lib/reauth";

const SCOPES = [
  { id: "read", label: "Read", hint: "Profile, résumé, jobs, posts, links, contacts, vault listings" },
  { id: "write", label: "Write", hint: "Update profile, create jobs, posts and short links" },
  { id: "vault", label: "Vault", hint: "Vault metadata + short-lived document download links" },
  // Never pre-ticked. A token holding this is equivalent to the passwords it
  // can read, so granting it has to be a decision someone makes on purpose.
  {
    id: "secrets",
    label: "Secrets",
    hint: "Read and write stored passwords and API keys — only ones marked readable by agents",
    danger: true,
    warn: "equivalent to the passwords it can read",
  },
  // Never pre-ticked either. Starting runs and answering their approval cards
  // is the human gate on code running on your server; a writing assistant's
  // token must not be able to say yes for you, and the token the agent jobs
  // themselves hold must never carry it.
  {
    id: "agent",
    label: "Agent runs",
    hint: "Start coding runs on the agent server and answer their approval requests — never give this to AGENT_MCP_TOKEN",
    danger: true,
    warn: "can say yes to code running on your server",
  },
];

export const PUBLIC_MCP_URL = "https://www.ravikishan.me/api/mcp";

const when = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

export default function McpPanel({ user }) {
  const [rows, setRows] = useState(null);
  const [label, setLabel] = useState("");
  const [picked, setPicked] = useState({ read: true, write: false, vault: false, secrets: false, agent: false });
  const [issued, setIssued] = useState(null); // shown once
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("https://www.ravikishan.me");

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
    const unsub = onSnapshot(
      collection(db, "mcpTokens"),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        arr.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        setRows(arr);
      },
      (e) => setErr(e?.code || "read failed")
    );
    return () => unsub();
  }, []);

  const mint = async () => {
    setErr("");
    setMsg("");
    setIssued(null);
    const scopes = Object.entries(picked).filter(([, v]) => v).map(([k]) => k);
    if (!scopes.length) return setErr("Pick at least one scope.");

    const u = auth.currentUser;
    if (!u) return setErr("Not signed in.");

    setBusy(true);
    try {
      // This token can act as you from any machine until revoked — worth
      // proving it is really you right now.
      await withFreshAuth("mint an access token", async () => true);
      const json = await adminJson("/api/mcp/token", { refreshToken: u.refreshToken, scopes, label });

      // Only the LABEL is persisted — never the token.
      await setDoc(doc(db, "mcpTokens", json.jti), {
        label: label.trim() || "Untitled client",
        scopes,
        createdAt: new Date().toISOString(),
        createdBy: user?.email || "",
      });
      await logAdminAction({
        action: "mcp.mint",
        target: json.jti,
        detail: `${label || "Untitled"} · ${scopes.join(", ")}`,
        user,
      });
      setIssued({ ...json, label: label.trim() });
      setLabel("");
    } catch (e) {
      setErr(e?.message || "Could not mint a token.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = (r) => async () => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Revoke "${r.label}"? Any client using it stops working immediately.`)) return;
    try {
      const ref = doc(db, "site", "mcpRevocations");
      const cur = await getDoc(ref);
      const list = (cur.exists() && cur.data().revoked) || [];
      await setDoc(ref, { revoked: [...new Set([...list, r.id])] }, { merge: true });
      await deleteDoc(doc(db, "mcpTokens", r.id));
      await logAdminAction({ action: "mcp.revoke", target: r.id, detail: r.label, user });
      setMsg(`Revoked "${r.label}".`);
    } catch (e) {
      setErr(e?.message || "Revoke failed.");
    }
  };

  const copy = (text) => async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg("Copied.");
    } catch (_) {
      setErr("Clipboard blocked by the browser.");
    }
  };

  const url = `${origin}/api/mcp`;

  // "From anywhere" means the production address, whatever origin this
  // admin happens to be open on. The token is ALWAYS a placeholder here:
  // a real one is shown once, in the card below, and nowhere else.
  const anywhere = [
    {
      id: "endpoint",
      name: "Endpoint",
      what: "endpoint URL",
      note: "Streamable HTTP, JSON-RPC 2.0. Bearer token or OAuth 2.1.",
      code: PUBLIC_MCP_URL,
    },
    {
      id: "claude-code",
      name: "Claude Code CLI",
      what: "command",
      note: "Run in a terminal, with a token minted below in place of <token>.",
      code: `claude mcp add --transport http portfolio ${PUBLIC_MCP_URL} --header "Authorization: Bearer <token>"`,
    },
    {
      id: "claude-connector",
      name: "Claude Desktop / claude.ai",
      what: "connector URL",
      note: "Settings, Connectors, Add custom connector: paste the URL only. It registers itself and sends you to the consent screen (read is ticked; anything else is your choice).",
      code: PUBLIC_MCP_URL,
    },
    {
      id: "codex",
      name: "Codex (~/.codex/config.toml)",
      what: "config",
      note: "The token is read from the environment, so it never sits in the file: export PORTFOLIO_MCP_TOKEN=<token>.",
      code: `[mcp_servers.portfolio]\nurl = "${PUBLIC_MCP_URL}"\nbearer_token_env_var = "PORTFOLIO_MCP_TOKEN"`,
    },
  ];
  const tok = issued?.token || "rkmcp_YOUR_TOKEN";

  const snippets = [
    {
      name: "Claude Code",
      code: `claude mcp add --transport http ravikishan ${url} \\\n  --header "Authorization: Bearer ${tok}"`,
    },
    {
      name: "Codex / generic JSON config",
      code: JSON.stringify(
        {
          mcpServers: {
            ravikishan: {
              type: "http",
              url,
              headers: { Authorization: `Bearer ${tok}` },
            },
          },
        },
        null,
        2
      ),
    },
    {
      name: "Any client, raw check",
      code: `curl -s -X POST ${url} \\\n  -H "Authorization: Bearer ${tok}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    },
  ];

  return (
    <main className="admin-main">
      <div className="vt-intro">
        <strong>MCP access.</strong> Mint a token, paste it into an AI client,
        and it can work with your information through{" "}
        <code>{url}</code>. The token carries your own session, so everything it
        does goes through the same Firestore rules as this page — there is no
        service account and no bypass. It is shown once.
      </div>

      <section className="ops-card mcp-connect" aria-labelledby="mcp-anywhere">
        <div className="ops-head">
          <h3 id="mcp-anywhere">Connect from anywhere</h3>
        </div>
        <p className="admin-sub mcp-connect-copy">
          The production endpoint works from any machine. A client that takes a
          header gets a token minted below; one that only takes a URL (Claude
          Desktop, claude.ai) signs in through this site&apos;s OAuth consent
          screen instead, where you tick the scopes it gets. Never paste a token
          into a prompt or commit it.
        </p>
        <div className="mcp-anywhere">
          {anywhere.map((c) => (
            <div key={c.id} className="mcp-any" data-client={c.id}>
              <div className="mcp-any-head">
                <strong>{c.name}</strong>
                <button
                  className="admin-ghost sm"
                  type="button"
                  onClick={copy(c.code)}
                  aria-label={`Copy the ${c.name} ${c.what}`}
                >
                  Copy
                </button>
              </div>
              <p>{c.note}</p>
              <pre>{c.code}</pre>
            </div>
          ))}
        </div>
        <div className="mcp-need">
          <strong>Scopes the workbench tools need</strong>
          <p>
            <b>read</b> to watch: agent status, runs, chat history, the desktop
            screenshot, previews and the ops log. <b>agent</b> to act: start a run
            or a chat, send or interrupt a message, drive the desktop, answer an
            approval. <b>agent</b> is implied by nothing and is never pre-ticked,
            here or on the consent screen; never give it to{" "}
            <code>AGENT_MCP_TOKEN</code>, or a job could approve itself.
          </p>
        </div>
      </section>

      <section className="ops-card">
        <h3>New token</h3>
        <div className="mcp-form">
          <input
            className="admin-input"
            placeholder="Label — e.g. 'Claude Code on laptop'"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="mcp-scopes">
            {SCOPES.map((s) => (
              <label
                key={s.id}
                className={`mcp-scope${picked[s.id] ? " on" : ""}${s.danger ? " danger" : ""}`}
                data-warn={s.warn || undefined}
              >
                <input
                  type="checkbox"
                  checked={!!picked[s.id]}
                  onChange={(e) => setPicked((p) => ({ ...p, [s.id]: e.target.checked }))}
                />
                <span>
                  <b>{s.label}</b>
                  <i>{s.hint}</i>
                </span>
              </label>
            ))}
          </div>
          <button className="admin-primary" type="button" onClick={mint} disabled={busy}>
            {busy ? "Minting…" : "Mint token"}
          </button>
        </div>
      </section>

      {err && <div className="admin-err">{err}</div>}
      {msg && !err && <div className="rm-ok">{msg}</div>}

      {issued && (
        <section className="ops-card mcp-issued">
          <h3>Copy it now — it will not be shown again</h3>
          <div className="mcp-token">
            <code>{issued.token}</code>
            <button className="admin-primary" type="button" onClick={copy(issued.token)}>
              Copy token
            </button>
          </div>
          <p className="admin-sub">
            Scopes: {issued.scopes.join(", ")} · id {issued.jti}
          </p>
          {snippets.map((s) => (
            <div key={s.name} className="mcp-snippet">
              <div className="mcp-snippet-head">
                <span>{s.name}</span>
                <button className="admin-ghost sm" type="button" onClick={copy(s.code)}>
                  Copy
                </button>
              </div>
              <pre>{s.code}</pre>
            </div>
          ))}
        </section>
      )}

      <section className="ops-card">
        <div className="ops-head">
          <h3>Issued tokens</h3>
          <span className="admin-sub">{rows?.length || 0} active</span>
        </div>
        {rows == null ? (
          <p className="admin-sub">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="admin-sub">No tokens issued yet.</p>
        ) : (
          <div className="ops-list">
            {rows.map((r) => (
              <div key={r.id} className="ops-row">
                <span className="vt-name">{r.label}</span>
                <span className="vt-cat">{(r.scopes || []).join(" · ")}</span>
                <span className="admin-sub">minted {when(r.createdAt)}</span>
                <span className="ops-btns">
                  <button className="admin-ghost sm" type="button" onClick={revoke(r)}>
                    Revoke
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="admin-sub" style={{ marginTop: 10 }}>
          Revoking adds the id to a public deny-list the server checks on every
          request. To kill <em>every</em> token at once, rotate{" "}
          <code>MCP_TOKEN_SECRET</code> in Vercel.
        </p>
      </section>

      <style jsx global>{`
        .mcp-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 10px;
        }
        .mcp-scopes {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .mcp-connect-copy {
          max-width: 760px;
          line-height: 1.55;
          margin: 10px 0;
        }
        .mcp-connect-note {
          margin: 12px 0 0;
        }
        .mcp-anywhere {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }
        .mcp-any {
          min-width: 0;
          padding: 12px;
          border: 1px solid #262a35;
          border-radius: 9px;
          background: #101219;
        }
        .mcp-any-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .mcp-any strong,
        .mcp-need strong {
          color: #e7e8ee;
          font-size: 13px;
        }
        .mcp-any p,
        .mcp-need p {
          margin: 6px 0;
          color: #8b90a0;
          font-size: 11.5px;
          line-height: 1.5;
        }
        .mcp-any pre {
          margin: 0;
          padding: 9px 11px;
          border: 1px solid #1d212b;
          border-radius: 8px;
          background: #0a0b0f;
          color: #cfd3dd;
          font: 11px/1.55 "JetBrains Mono", monospace;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .mcp-any[data-client="endpoint"] pre {
          color: #ffb020;
        }
        .mcp-need {
          margin-top: 12px;
          padding: 10px 12px;
          border-left: 3px solid #ffb020;
          background: #101219;
          border-radius: 0 9px 9px 0;
        }
        .mcp-need b,
        .mcp-need code {
          color: #e7e8ee;
          font-family: "JetBrains Mono", monospace;
          font-size: 11px;
        }
        .mcp-connect button:focus-visible,
        .mcp-scope:focus-within {
          outline: 2px solid #ffb020;
          outline-offset: 2px;
        }
        @media (max-width: 860px) {
          .mcp-anywhere {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 860px) {
          .mcp-scopes {
            grid-template-columns: 1fr;
          }
        }
        .mcp-scope {
          display: flex;
          gap: 9px;
          align-items: flex-start;
          border: 1px solid #262a35;
          border-radius: 10px;
          padding: 10px 12px;
          background: #101219;
          cursor: pointer;
        }
        .mcp-scope.on {
          border-color: #ffb020;
        }
        .mcp-scope b {
          display: block;
          font-size: 12.5px;
          color: #e7e8ee;
        }
        .mcp-scope i {
          display: block;
          font-style: normal;
          font-size: 11px;
          color: #8b90a0;
          margin-top: 2px;
        }
        .mcp-issued {
          border-color: #7a5a12;
          background: #16130b;
        }
        .mcp-token {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin: 8px 0;
        }
        .mcp-token code {
          flex: 1;
          min-width: 260px;
          font-family: "JetBrains Mono", monospace;
          font-size: 11.5px;
          word-break: break-all;
          background: #0a0b0f;
          border: 1px solid #2b3040;
          border-radius: 8px;
          padding: 10px 12px;
          color: #ffb020;
        }
        .mcp-snippet {
          margin-top: 12px;
        }
        .mcp-snippet-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #8b90a0;
          margin-bottom: 5px;
        }
        .mcp-snippet pre {
          background: #0a0b0f;
          border: 1px solid #1d212b;
          border-radius: 8px;
          padding: 11px 13px;
          overflow-x: auto;
          font-family: "JetBrains Mono", monospace;
          font-size: 11.5px;
          line-height: 1.55;
          color: #cfd3dd;
          margin: 0;
        }
        .mcp-scope.danger.on {
          border-color: #a33b45;
          color: #ff9a9a;
        }
        .mcp-scope.danger.on::after {
          content: attr(data-warn);
          display: block;
          margin-top: 4px;
          font-size: 10.5px;
          color: #ff8a8a;
        }
      `}</style>
    </main>
  );
}
