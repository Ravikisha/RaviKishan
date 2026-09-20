// OAuth consent screen.
//
// A page rather than an API route, because this is where the human actually
// is: the client redirects a browser here, the admin signs in with Firebase if
// they are not already, sees exactly what is being asked for, and approves.
//
// The authorization code is issued in the BROWSER, from the signed-in
// session's refresh token, and handed to /api/oauth/token on redemption. That
// keeps the no-service-account property: the server never needs credentials of
// its own to know who approved.
import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from "firebase/auth";
import { auth } from "../../lib/firebase";
import { isAdminEmail } from "../../lib/adminAllowlist";

const SCOPE_TEXT = {
  read: "Read your profile, résumé, jobs, posts, links, contacts and vault listings",
  write: "Create and update your content, jobs, posts and short links",
  vault: "List private documents and mint short-lived download links",
};

export default function Authorize() {
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [client, setClient] = useState(null);

  const q = router.query;
  const scopes = String(q.scope || "read")
    .split(/[\s+]+/)
    .filter((s) => ["read", "write", "vault"].includes(s));

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u || null)), []);

  // Validate the request before showing any consent UI — an invalid request
  // must never render an "Approve" button.
  useEffect(() => {
    if (!router.isReady) return;
    (async () => {
      try {
        const res = await fetch("/api/oauth/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: q.client_id,
            redirect_uri: q.redirect_uri,
            response_type: q.response_type,
            code_challenge: q.code_challenge,
            code_challenge_method: q.code_challenge_method,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error_description || json.error);
        setClient(json);
      } catch (e) {
        setErr(e.message || "Invalid authorization request.");
      }
    })();
  }, [router.isReady, q.client_id, q.redirect_uri, q.response_type, q.code_challenge, q.code_challenge_method]);

  const signIn = async () => {
    setErr("");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (e) {
      if (!/popup-closed|cancelled-popup/.test(e?.code || "")) setErr(e?.message || "Sign-in failed.");
    }
  };

  const approve = async () => {
    setErr("");
    setBusy(true);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch("/api/oauth/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          client_id: q.client_id,
          redirect_uri: q.redirect_uri,
          code_challenge: q.code_challenge,
          scopes,
          refreshToken: auth.currentUser.refreshToken,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error_description || json.error);

      const url = new URL(q.redirect_uri);
      url.searchParams.set("code", json.code);
      if (q.state) url.searchParams.set("state", String(q.state));
      window.location.replace(url.toString());
    } catch (e) {
      setErr(e.message || "Could not authorize.");
      setBusy(false);
    }
  };

  const deny = () => {
    try {
      const url = new URL(q.redirect_uri);
      url.searchParams.set("error", "access_denied");
      if (q.state) url.searchParams.set("state", String(q.state));
      window.location.replace(url.toString());
    } catch (_) {
      setErr("Denied.");
    }
  };

  const wrongAccount = user && !isAdminEmail(user.email);

  return (
    <>
      <Head>
        <title>Authorize access</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="oa-wrap">
        <div className="oa-card">
          <h1>Authorize access</h1>

          {err && <div className="oa-err">{err}</div>}

          {!err && !client && <p className="oa-sub">Checking the request…</p>}

          {client && (
            <>
              <p className="oa-sub">
                <strong>{client.client_name || "An application"}</strong> wants to
                access your personal data on ravikishan.me.
              </p>

              <ul className="oa-scopes">
                {scopes.map((s) => (
                  <li key={s}>{SCOPE_TEXT[s]}</li>
                ))}
              </ul>

              <p className="oa-redirect">
                You will be returned to <code>{client.redirect_uri}</code>
              </p>

              {user === undefined && <p className="oa-sub">Checking your session…</p>}

              {user === null && (
                <button className="oa-primary" type="button" onClick={signIn}>
                  Sign in to continue
                </button>
              )}

              {wrongAccount && (
                <>
                  <div className="oa-err">
                    {user.email} is not the owner of this site.
                  </div>
                  <button className="oa-ghost" type="button" onClick={() => signOut(auth)}>
                    Use a different account
                  </button>
                </>
              )}

              {user && !wrongAccount && (
                <>
                  <p className="oa-as">
                    Signed in as <strong>{user.email}</strong>
                  </p>
                  <div className="oa-actions">
                    <button className="oa-ghost" type="button" onClick={deny} disabled={busy}>
                      Deny
                    </button>
                    <button className="oa-primary" type="button" onClick={approve} disabled={busy}>
                      {busy ? "Authorizing…" : "Approve"}
                    </button>
                  </div>
                  <p className="oa-note">
                    You can revoke this at any time from the admin&apos;s MCP tab.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <style jsx global>{`
        body {
          background: #0d0e13;
        }
        .oa-wrap {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          color: #e7e8ee;
        }
        .oa-card {
          width: 100%;
          max-width: 420px;
          background: #15171e;
          border: 1px solid #262a35;
          border-radius: 14px;
          padding: 28px;
        }
        .oa-card h1 {
          font-size: 19px;
          margin: 0 0 12px;
        }
        .oa-sub {
          color: #b9bdca;
          font-size: 13.5px;
          line-height: 1.6;
          margin: 0 0 14px;
        }
        .oa-scopes {
          list-style: none;
          padding: 0;
          margin: 0 0 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .oa-scopes li {
          background: #0f1117;
          border: 1px solid #262a35;
          border-left: 3px solid #ffb020;
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 12.5px;
          color: #cfd3dd;
        }
        .oa-redirect {
          font-size: 11.5px;
          color: #8b90a0;
          margin: 0 0 16px;
          word-break: break-all;
        }
        .oa-redirect code {
          font-family: "JetBrains Mono", monospace;
          color: #b9bdca;
        }
        .oa-as {
          font-size: 12.5px;
          color: #8b90a0;
          margin: 0 0 12px;
        }
        .oa-actions {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }
        .oa-primary {
          background: #ffb020;
          color: #1a1300;
          border: none;
          border-radius: 8px;
          padding: 10px 18px;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        }
        .oa-ghost {
          background: none;
          border: 1px solid #2b3040;
          color: #b9bdca;
          border-radius: 8px;
          padding: 10px 16px;
          font-size: 13px;
          cursor: pointer;
        }
        .oa-primary:disabled,
        .oa-ghost:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .oa-err {
          background: #2b1214;
          border: 1px solid #5a2a2e;
          color: #ff9a9a;
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 12.5px;
          margin-bottom: 14px;
        }
        .oa-note {
          font-size: 11px;
          color: #6b7080;
          margin: 14px 0 0;
        }
      `}</style>
    </>
  );
}
