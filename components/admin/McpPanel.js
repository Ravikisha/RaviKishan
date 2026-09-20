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
import { logAdminAction } from "../../lib/auditLog";
import { withFreshAuth } from "../../lib/reauth";

const SCOPES = [
  { id: "read", label: "Read", hint: "Profile, résumé, jobs, posts, links, contacts, vault listings" },
  { id: "write", label: "Write", hint: "Update profile, create jobs, posts and short links" },
  { id: "vault", label: "Vault", hint: "Vault metadata + short-lived document download links" },
];

const when = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

export default function McpPanel({ user }) {
  const [rows, setRows] = useState(null);
  const [label, setLabel] = useState("");
  const [picked, setPicked] = useState({ read: true, write: false, vault: false });
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
      const idToken = await u.getIdToken();
      const res = await fetch("/api/mcp/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ refreshToken: u.refreshToken, scopes, label }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

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
              <label key={s.id} className={`mcp-scope${picked[s.id] ? " on" : ""}`}>
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
      `}</style>
    </main>
  );
}
