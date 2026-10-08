// YouTube, Instagram and X in the admin — several accounts of each.
//
// DESIGN
//
// The grounding fact is that nothing here can be taken back. X has no edit
// endpoint at any tier, Instagram has no caption edit at all, and YouTube's
// update REPLACES the part it is given. So the job of this screen is not to
// make posting frictionless — it is to make the handle unmissable and the
// refusals plain.
//
// THE ROSTER. "Which account am I about to act as" is ONE question, so it gets
// one answer: a single row of every connected account across all three
// services, with the service as the quiet second line. The previous version
// asked it twice — pick a provider shelf, then pick a chip inside it — and
// stacked three live shelves so you scrolled past accounts you did not want.
// A provider with nothing connected appears as its own invitation; one that is
// not set up on this deployment says so in place, rather than rendering an
// entire empty shelf with a disabled button.
//
// THE HANDLE IS THE LARGEST THING ON THE DESK, set in JetBrains Mono. This
// admin's rule is that mono is for identifiers you would copy, and a handle is
// exactly that; setting it at display size makes the one fact you must not get
// wrong the one you cannot miss. It is also the only thing that moves: it
// swaps when you change account, because that is the only moment when who you
// are has changed.
//
// EVERY PUBLIC CONTROL NAMES THE HANDLE — "Publish as @name", and the confirm
// says it too — because the unrecoverable mistake here is the account, not the
// service.
//
// Where a provider refuses something, the interface says so where the action
// would have been, rather than offering a disabled button that implies a
// permission you could go and fix.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  IG_MAX,
  PROVIDERS,
  X_MAX,
  beginConnect,
  capabilities,
  charsLeft,
  disconnect,
  finishConnect,
  igAccount,
  igMedia,
  igPublish,
  listAccounts,
  providerLabel,
  redirectUrisFor,
  xAccount,
  xDelete,
  xPosts,
  xPublish,
  xThread,
  ytUpdateVideo,
  ytVideos,
} from "../../lib/socialClient";
import { logAdminAction } from "../../lib/auditLog";

/* ---------------- small shared pieces ---------------- */

// A date a person reads, not an ISO string. Same shape everywhere on the desk.
const onDay = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

const num = (n) => (n == null ? "—" : Number(n).toLocaleString());

// "1 comments" is the kind of thing nobody notices in review and everybody
// notices on the page.
const count = (n, one, many = `${one}s`) =>
  `${num(n)} ${Math.abs(Number(n)) === 1 ? one : many}`;

// Instagram reports the account kind as an API enum. MEDIA_CREATOR is not a
// thing anybody calls their account, so it is said the way Instagram itself
// says it in the app.
const ACCOUNT_KIND = {
  MEDIA_CREATOR: "Creator account",
  BUSINESS: "Business account",
  PERSONAL: "Personal account",
};

const Hair = () => <span className="so-hair" aria-hidden="true" />;

// One meter for both composers, because they are the same shape: a cap you can
// cross and a left edge that fills as you approach it. The same gesture as the
// LinkedIn composer, so the two desks read as one system. The empty part of
// the track is what makes it legible as a meter at all — without it a short
// post renders a stub in the corner that reads as a rendering artefact.
export function Meter({ used, max, over, children }) {
  const pct = Math.max(0, Math.min(100, (used / max) * 100));
  const tone = over ? "over" : pct > 90 ? "close" : "fine";
  return (
    <p className={`so-meter ${tone}`}>
      <span className="so-track" aria-hidden="true">
        <span className="so-fill" style={{ width: `${pct}%` }} />
      </span>
      {children}
    </p>
  );
}

// A refusal, stated where the action would have been.
export function Refusal({ cap, title }) {
  if (!cap || cap.available) return null;
  return (
    <p className="so-cant">
      <strong>{title}</strong> {cap.why} {cap.instead}
    </p>
  );
}

// The identity of the account being acted as: the single most important thing
// on this screen, and the only thing that animates.
export function Identity({ account, picture, kind, url, stats }) {
  return (
    <header className="so-id" key={account.accountId}>
      {picture ? (
        <img className="so-face" src={picture} alt="" />
      ) : (
        <span className="so-face so-face-none" aria-hidden="true" />
      )}
      <div className="so-id-body">
        <h4 className={`so-handle${/^@/.test(account.label) ? " so-addr" : ""}`}>
          {account.label}
        </h4>
        <p className="so-kind">
          {kind}
          {account.needsReconnect ? <em className="so-expired">expired — reconnect</em> : null}
          {!account.needsReconnect && account.warning ? (
            <em className="so-soon">{account.expiresInDays} days left</em>
          ) : null}
        </p>
        {stats?.length ? (
          <p className="so-stats">
            {stats.map((s, i) => (
              <React.Fragment key={s}>
                {i ? <Hair /> : null}
                <span>{s}</span>
              </React.Fragment>
            ))}
          </p>
        ) : null}
      </div>
      {url ? (
        <a className="so-visit" href={url} target="_blank" rel="noreferrer">
          {url.replace(/^https?:\/\/(www\.)?/, "")}
        </a>
      ) : null}
    </header>
  );
}

// What a service that is not connected yet needs. "Not set up — missing
// X_CLIENT_ID" names a state and offers no route out, and for all three the
// route is genuinely non-obvious. This is the same shape as the LinkedIn and
// Analytics panels, for the same reason: the unconnected state is where a
// panel most needs to explain itself, and it is the state it spends the least
// time in once it works.
//
// It is NOT a Connect button. A button that cannot work is worse than no
// button, because you only find out after pressing it.
export function ProviderSetup({ provider, missing }) {
  const [copied, setCopied] = useState("");
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const setup = provider.setup;
  if (!setup) return null;
  const uris = redirectUrisFor(provider.id, origin);
  const needs = missing?.length ? missing : setup.env || [];

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("");
    }
  };

  return (
    <div className="so-pane so-setup">
      <header className="so-id">
        <div className="so-id-body">
          <h4 className="so-handle">{provider.label}</h4>
          <p className="so-kind">Not set up on this deployment</p>
          {needs.length ? (
            <p className="so-stats">
              <span>
                Needs{" "}
                {needs.map((e, i) => (
                  <React.Fragment key={e}>
                    {i ? ", " : ""}
                    <code>{e}</code>
                  </React.Fragment>
                ))}{" "}
                in the Environment tab
              </span>
            </p>
          ) : null}
        </div>
      </header>

      <div className="so-work">
        {setup.why ? <p className="so-why">{setup.why}</p> : null}

        {/* Stated up front, not in a footnote: a cost is the part of a setup
            you cannot undo by deleting the app. */}
        {setup.cost ? (
          <table className="so-cost">
            <tbody>
              {setup.cost.map(([what, rate]) => (
                <tr key={what}>
                  <th scope="row">{what}</th>
                  <td>{rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <ol className="so-steps">
          {setup.steps.map((step, i) => (
            <li key={step.title}>
              <span className="so-step-n">{i + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.body}</p>
                {step.link ? (
                  <a className="so-step-link" href={step.link} target="_blank" rel="noreferrer noopener">
                    {step.link.replace(/^https?:\/\//, "")}
                  </a>
                ) : null}
                {step.uris ? (
                  <ul className="so-uris">
                    {uris.map((u) => (
                      <li key={u}>
                        <code>{u}</code>
                        <button type="button" className="admin-ghost so-sm" onClick={() => copy(u)}>
                          {copied === u ? "Copied" : "Copy"}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        {setup.warning ? <p className="so-cant">{setup.warning}</p> : null}
      </div>
    </div>
  );
}

// Every account you can act as, across every service, in one row. "Which
// account am I about to act as" is ONE question, so it is asked once — the
// previous version asked it twice, as a provider shelf and then a chip inside
// it, and stacked three live shelves so you scrolled past accounts you did not
// want. Position carries the service; the amber edge carries the selection,
// the same language as everywhere else in this admin.
export function Roster({ providers, who, onPick, onConnect, busy }) {
  return (
    <nav className="so-roster" aria-label="Accounts you can act as">
      {providers.flatMap((p) =>
        (p.accounts || []).map((a) => {
          const on = who?.accountId === a.accountId;
          return (
            <button
              key={`${p.provider}:${a.accountId}`}
              type="button"
              aria-current={on ? "true" : undefined}
              className={`so-who${on ? " on" : ""}${a.needsReconnect ? " stale" : ""}`}
              onClick={() => onPick({ provider: p.provider, accountId: a.accountId })}
            >
              <span className="so-who-name">{a.label}</span>
              <span className="so-who-kind">
                {providerLabel(p.provider)}
                {a.needsReconnect ? " · expired" : ""}
              </span>
            </button>
          );
        })
      )}

      {/* A service with nothing connected is an invitation; one that is not
          set up here says so in place of a button that cannot work. */}
      {providers
        .filter((p) => !(p.accounts || []).length)
        .map((p) =>
          p.configured ? (
            <button
              key={p.provider}
              type="button"
              className="so-who so-add"
              disabled={!!busy}
              onClick={() => onConnect(p.provider)}
            >
              <span className="so-who-name">Connect {providerLabel(p.provider)}</span>
              <span className="so-who-kind">Nothing connected yet</span>
            </button>
          ) : (
            // Selectable, but what it opens is the CHECKLIST, not a Connect
            // button — the thing worth avoiding is an action that cannot
            // succeed, not an explanation of why.
            <button
              key={p.provider}
              type="button"
              aria-current={who?.provider === p.provider && !who?.accountId ? "true" : undefined}
              className={`so-who so-todo${
                who?.provider === p.provider && !who?.accountId ? " on" : ""
              }`}
              onClick={() => onPick({ provider: p.provider, accountId: null })}
            >
              <span className="so-who-name">{providerLabel(p.provider)}</span>
              <span className="so-who-kind">
                {p.missing?.length ? `Needs ${p.missing.join(", ")}` : "Not set up here"}
              </span>
            </button>
          )
        )}
    </nav>
  );
}

/* ================= the panel ================= */

export default function SocialPanel({ user }) {
  const [providers, setProviders] = useState(null);
  const [caps, setCaps] = useState(null);
  const [who, setWho] = useState(null); // { provider, accountId }
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setBusy("Reading your accounts…");
    try {
      const rows = await listAccounts();
      setProviders(rows);
      setCaps(await capabilities().catch(() => null));
      // Open on the first account there is, so the desk is usable without a
      // click — but never move off an account the person already chose.
      setWho((cur) => {
        if (cur && rows.some((p) => p.accounts?.some((a) => a.accountId === cur.accountId)))
          return cur;
        for (const p of rows) {
          if (p.accounts?.length) return { provider: p.provider, accountId: p.accounts[0].accountId };
        }
        return null;
      });
    } catch (e) {
      setErr(e.message || "Could not read the connected accounts.");
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    (async () => {
      const q = new URLSearchParams(window.location.search);
      const connected = q.get("connected");
      const failed = q.get("connectError");
      if (failed) setErr(failed);
      if (connected && ["youtube", "instagram", "x"].includes(connected)) {
        setBusy(`Saving the ${providerLabel(connected)} connection…`);
        try {
          const rec = await finishConnect(connected);
          setMsg(`${providerLabel(connected)} connected${rec?.label ? ` as ${rec.label}` : ""}.`);
          if (rec?.accountId) setWho({ provider: connected, accountId: rec.accountId });
          logAdminAction({
            action: "social.connect",
            target: `${connected}:${rec?.accountId || ""}`,
            detail: rec?.label || "",
            user,
          });
        } catch (e) {
          setErr(e.message || "That connection could not be saved.");
        }
      }
      if (connected || failed) {
        const url = new URL(window.location.href);
        ["connected", "connectError", "account"].forEach((k) => url.searchParams.delete(k));
        window.history.replaceState({}, "", url.toString());
      }
      await load();
    })();
    // Page-load sequence, deliberately once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async (provider) => {
    setErr("");
    setBusy(`Opening ${providerLabel(provider)}…`);
    try {
      await beginConnect(provider);
    } catch (e) {
      setBusy("");
      setErr(e.message);
    }
  };

  const unlink = async (provider, account) => {
    if (!window.confirm(`Disconnect ${account.label}? The MCP tools lose it too.`)) return;
    await disconnect(provider, account.accountId);
    logAdminAction({ action: "social.disconnect", target: `${provider}:${account.accountId}`, user });
    setMsg(`${account.label} disconnected.`);
    setWho(null);
    await load();
  };

  const row = providers?.find((p) => p.provider === who?.provider);
  const account = row?.accounts?.find((a) => a.accountId === who?.accountId);
  const meta = PROVIDERS.find((p) => p.id === who?.provider);
  const total = (providers || []).reduce((n, p) => n + (p.accounts?.length || 0), 0);

  return (
    <div className="so-main">
      <div className="ops-head">
        <div>
          <p className="admin-sub so-sub">
            Everything here acts as the account you pick, and the MCP tools share the same
            connections. Nothing published from this desk can be edited afterwards.
          </p>
        </div>
        <span className="so-actions">
          <button className="admin-ghost" type="button" onClick={load} disabled={!!busy}>
            Refresh
          </button>
        </span>
      </div>

      {busy ? <p className="so-busy">{busy}</p> : null}
      {err ? <p className="admin-err">{err}</p> : null}
      {msg ? <p className="so-ok">{msg}</p> : null}

      {providers === null ? (
        <p className="so-busy">Checking your accounts…</p>
      ) : (
        <>
          <Roster providers={providers} who={who} onPick={setWho} onConnect={connect} busy={busy} />

          {!total ? (
            <p className="so-empty so-firstrun">
              Connect a service above and this becomes the desk you post from.
            </p>
          ) : null}

          {meta && !account && !row?.configured ? (
            <section className="so-desk" data-provider={meta.id}>
              <ProviderSetup provider={meta} missing={row?.missing} />
            </section>
          ) : null}

          {account && meta ? (
            <section className="so-desk" data-provider={meta.id}>
              {meta.id === "youtube" ? (
                <YouTubePane account={account} onError={setErr} onMsg={setMsg} />
              ) : meta.id === "instagram" ? (
                <InstagramPane
                  account={account}
                  caps={caps?.instagram}
                  onError={setErr}
                  onMsg={setMsg}
                  user={user}
                />
              ) : (
                <XPane
                  account={account}
                  caps={caps?.x}
                  onError={setErr}
                  onMsg={setMsg}
                  user={user}
                />
              )}

              <footer className="so-foot">
                <button
                  className="admin-ghost so-sm"
                  type="button"
                  disabled={!!busy}
                  onClick={() => connect(meta.id)}
                >
                  Add another {meta.noun}
                </button>
                <button
                  className="admin-ghost so-sm so-unlink"
                  type="button"
                  onClick={() => unlink(meta.id, account)}
                >
                  Disconnect {account.label}
                </button>
              </footer>
            </section>
          ) : null}
        </>
      )}

      <SocialStyles />
    </div>
  );
}

/* ================= X ================= */

export function XPane({ account, caps, onError, onMsg, user }) {
  const accountId = account.accountId;
  const [profile, setProfile] = useState(null);
  const [text, setText] = useState("");
  const [thread, setThread] = useState(false);
  const [posts, setPosts] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    xAccount(accountId)
      .then((p) => live && setProfile(p))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [accountId]);

  const parts = useMemo(
    () => (thread ? text.split(/\n\s*---\s*\n/).map((t) => t.trim()).filter(Boolean) : [text]),
    [text, thread]
  );
  const worst = useMemo(() => parts.reduce((n, t) => Math.min(n, charsLeft(t)), X_MAX), [parts]);
  const over = worst < 0;

  const send = async () => {
    if (!text.trim()) return;
    if (over) return onError(`One part is ${-worst} weighted characters over.`);
    if (
      !window.confirm(
        thread
          ? `Post this thread of ${parts.length} as ${account.label}? X has no edit.`
          : `Post this as ${account.label}? X has no edit.`
      )
    )
      return;
    setSending(true);
    try {
      const out = thread ? await xThread(accountId, parts) : await xPublish(accountId, text);
      onMsg(thread ? `Thread posted (${out.count} parts).` : `Posted. ${out.url || ""}`);
      logAdminAction({ action: "x.post", target: accountId, detail: text.slice(0, 80), user });
      setText("");
    } catch (e) {
      onError(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="so-pane">
      <Identity
        account={account}
        picture={profile?.picture}
        kind="X"
        url={profile?.url}
        stats={
          profile
            ? [
                count(profile.followers, "follower"),
                count(profile.posts, "post"),
                `${num(profile.following)} following`,
              ]
            : null
        }
      />

      <div className="so-work">
        <label className="so-field so-field-big">
          <span>Post</span>
          <textarea
            className={`so-text${over ? " over" : ""}`}
            rows={thread ? 10 : 5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What are you building?"
          />
        </label>

        <Meter used={X_MAX - Math.max(worst, 0)} max={X_MAX} over={over}>
          <span className="so-count">{over ? `${-worst} over` : `${worst} left`}</span>
          <Hair />
          <span className="so-dim">
            {thread ? `${parts.length} part${parts.length === 1 ? "" : "s"} · ` : ""}a link counts
            as 23, CJK as 2
          </span>
        </Meter>

        <div className="so-row-end">
          <label className="so-check">
            <input
              type="checkbox"
              checked={thread}
              onChange={(e) => setThread(e.target.checked)}
            />
            Thread — split parts with a line containing only ---
          </label>
          <span className="so-spacer" />
          <button
            className="admin-primary"
            type="button"
            onClick={send}
            disabled={sending || !text.trim() || over}
          >
            {thread ? `Post thread as ${account.label}` : `Post as ${account.label}`}
          </button>
        </div>

        <Refusal cap={caps?.editPost} title="No editing." />
      </div>

      <div className="so-section">
        <div className="so-listhead">
          <h5>Published</h5>
          <button
            className="admin-ghost so-sm"
            type="button"
            onClick={async () => {
              try {
                setPosts((await xPosts(accountId, 10)).posts);
              } catch (e) {
                onError(e.message);
              }
            }}
          >
            Load
          </button>
        </div>
        {posts === null ? (
          <p className="so-dim so-note">
            Reading posts is billed — X ended its free tier on 6 February 2026, so this is behind a
            button rather than loaded automatically.
          </p>
        ) : posts.length === 0 ? (
          <p className="so-empty">No posts returned.</p>
        ) : (
          <ul className="so-list">
            {posts.map((t) => (
              <li key={t.id} className="so-item">
                <div>
                  <p className="so-item-text">{t.text}</p>
                  <p className="so-item-meta">
                    <span>{onDay(t.createdAt)}</span>
                    <Hair />
                    <span>{count(t.likes ?? 0, "like")}</span>
                    {t.edits > 1 ? (
                      <>
                        <Hair />
                        <span>{t.edits} versions</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <button
                  className="admin-ghost so-sm"
                  type="button"
                  onClick={async () => {
                    if (!window.confirm("Delete this post? X has no undo.")) return;
                    try {
                      await xDelete(accountId, t.id);
                      setPosts((ps) => ps.filter((x) => x.id !== t.id));
                      onMsg("Deleted.");
                    } catch (e) {
                      onError(e.message);
                    }
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ================= Instagram ================= */

export function InstagramPane({ account, caps, onError, onMsg, user }) {
  const accountId = account.accountId;
  const [profile, setProfile] = useState(null);
  const [media, setMedia] = useState(null);
  const [form, setForm] = useState({ imageUrl: "", caption: "", isReel: false });
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    setProfile(null);
    setMedia(null);
    (async () => {
      try {
        const [a, m] = await Promise.all([
          igAccount(accountId),
          igMedia(accountId, 12).then((j) => j.media),
        ]);
        if (live) {
          setProfile(a);
          setMedia(m);
        }
      } catch (e) {
        if (live) onError(e.message);
      }
    })();
    return () => {
      live = false;
    };
  }, [accountId, onError]);

  // Both of Instagram's caps, counted the same way the server validates them.
  // Hashtags past 30 are SILENTLY DROPPED rather than refused, and a caption
  // cannot be edited, so the count is shown before it matters rather than
  // reported after the post is permanent.
  const tags = useMemo(() => (form.caption.match(/#[\wÀ-ɏ]+/g) || []).length, [form.caption]);
  const overCaption = form.caption.length > IG_MAX;
  const overTags = tags > 30;

  const publish = async () => {
    if (!form.imageUrl)
      return onError("Instagram fetches the file, so it needs a publicly reachable image URL.");
    if (overCaption) return onError(`That caption is ${form.caption.length - IG_MAX} characters over.`);
    if (overTags) return onError(`That caption has ${tags} hashtags; Instagram keeps 30 and drops the rest.`);
    if (!window.confirm(`Publish as ${account.label}? The caption cannot be edited afterwards.`))
      return;
    setSending(true);
    try {
      const out = await igPublish(accountId, form);
      onMsg(`Published. ${out.url || ""}`);
      logAdminAction({
        action: "instagram.post",
        target: accountId,
        detail: form.caption.slice(0, 80),
        user,
      });
      setForm({ imageUrl: "", caption: "", isReel: false });
      setMedia(await igMedia(accountId, 12).then((j) => j.media));
    } catch (e) {
      onError(e.message);
    } finally {
      setSending(false);
    }
  };

  const limit = profile?.publishingLimit;
  const stats = profile
    ? [
        count(profile.followers, "follower"),
        count(profile.mediaCount, "post"),
        ...(limit?.remaining != null
          ? [`${num(limit.remaining)} of ${num(limit.limit)} publishes left today`]
          : []),
      ]
    : null;

  return (
    <div className="so-pane">
      <Identity
        account={account}
        picture={profile?.picture}
        kind={ACCOUNT_KIND[profile?.accountType] || "Instagram"}
        url={profile?.url}
        stats={stats}
      />

      <div className="so-work">
        <label className="so-field">
          <span>Image URL</span>
          <input
            className="admin-input"
            value={form.imageUrl}
            onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
            placeholder="https://ravikishan.me/api/media/…"
          />
          <small>
            Instagram fetches the file rather than accepting an upload, so this has to be reachable
            without signing in. A signed or expiring URL fails.
          </small>
        </label>

        <label className="so-field so-field-big">
          <span>Caption</span>
          <textarea
            className={`so-text${overCaption || overTags ? " over" : ""}`}
            rows={5}
            value={form.caption}
            onChange={(e) => setForm({ ...form, caption: e.target.value })}
            placeholder="Say what it is."
          />
        </label>

        <Meter used={form.caption.length} max={IG_MAX} over={overCaption || overTags}>
          <span className="so-count">
            {overCaption ? `${form.caption.length - IG_MAX} over` : `${IG_MAX - form.caption.length} left`}
          </span>
          {tags ? (
            <>
              <Hair />
              <span className={overTags ? "so-count over" : "so-dim"}>
                {tags} of 30 hashtags{overTags ? " — the extras are dropped" : ""}
              </span>
            </>
          ) : null}
        </Meter>

        <div className="so-row-end">
          <label className="so-check">
            <input
              type="checkbox"
              checked={form.isReel}
              onChange={(e) => setForm({ ...form, isReel: e.target.checked })}
            />
            Publish as a Reel
          </label>
          <span className="so-spacer" />
          <button
            className="admin-primary"
            type="button"
            onClick={publish}
            disabled={sending || !form.imageUrl || overCaption || overTags}
          >
            Publish as {account.label}
          </button>
        </div>

        <Refusal cap={caps?.editCaption} title="Fixed once published." />
      </div>

      <div className="so-section">
        <h5>Published</h5>
        {media === null ? (
          <p className="so-dim so-note">Reading your posts…</p>
        ) : media.length === 0 ? (
          <p className="so-empty">Nothing published from this account yet.</p>
        ) : (
          <ul className="so-grid">
            {media.map((m) => (
              <li key={m.id}>
                <a className="so-tile" href={m.url} target="_blank" rel="noreferrer">
                  {m.thumbnail ? (
                    <img src={m.thumbnail} alt="" loading="lazy" />
                  ) : (
                    <span className="so-tile-none" aria-hidden="true" />
                  )}
                </a>
                <p className="so-tile-day">{onDay(m.timestamp)}</p>
                <p className="so-tile-meta">
                  <span>{count(m.likes ?? 0, "like")}</span>
                  <Hair />
                  <span>{count(m.comments ?? 0, "comment")}</span>
                </p>
                {m.caption ? <p className="so-tile-cap">{m.caption}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ================= YouTube ================= */

export function YouTubePane({ account, onError, onMsg }) {
  const accountId = account.accountId;
  const [channel, setChannel] = useState(null);
  const [videos, setVideos] = useState(null);
  const [editing, setEditing] = useState(null);

  const reload = useCallback(async () => {
    try {
      const out = await ytVideos(accountId, 25);
      setChannel(out.channel);
      setVideos(out.videos);
    } catch (e) {
      onError(e.message);
    }
  }, [accountId, onError]);

  useEffect(() => {
    setChannel(null);
    setVideos(null);
    reload();
  }, [reload]);

  const save = async (video, patch) => {
    try {
      const out = await ytUpdateVideo(accountId, video.id, patch);
      setVideos((vs) => vs.map((v) => (v.id === video.id ? { ...v, ...out } : v)));
      setEditing(null);
      onMsg("Saved. Unmentioned fields were preserved.");
    } catch (e) {
      onError(e.message);
    }
  };

  return (
    <div className="so-pane">
      <Identity
        account={account}
        picture={channel?.thumbnail}
        kind="YouTube channel"
        url={channel?.url}
        stats={
          channel
            ? [
                count(channel.subscribers, "subscriber"),
                count(channel.videos, "public video"),
                count(channel.views, "view"),
              ]
            : null
        }
      />

      <div className="so-section">
        <div className="so-listhead">
          <h5>Videos</h5>
          <span className="so-dim so-sm">Newest first</span>
        </div>
        <p className="so-dim so-note">
          Editing here is safe: YouTube&apos;s update replaces the whole record and deletes anything
          left out, so every save reads the video first and merges — changing a title cannot wipe the
          description or tags. Uploading is not offered; publish in Studio, then set the metadata
          here.
        </p>

        {videos === null ? (
          <p className="so-dim so-note">Reading the channel…</p>
        ) : videos.length === 0 ? (
          <p className="so-empty">No videos on this channel.</p>
        ) : (
          <ul className="so-list">
            {videos.map((v) => (
              <li key={v.id} className={`so-item so-video${editing === v.id ? " editing" : ""}`}>
                {v.thumbnail ? <img className="so-thumb" src={v.thumbnail} alt="" loading="lazy" /> : null}
                <div className="so-video-body">
                  {editing === v.id ? (
                    <VideoEditor video={v} onCancel={() => setEditing(null)} onSave={(p) => save(v, p)} />
                  ) : (
                    <>
                      <p className="so-item-text">{v.title}</p>
                      <p className="so-item-meta">
                        <span>{onDay(v.publishedAt)}</span>
                        <Hair />
                        <span>{v.privacy}</span>
                        <Hair />
                        <span>{count(v.views ?? 0, "view")}</span>
                      </p>
                    </>
                  )}
                </div>
                {editing === v.id ? null : (
                  <button className="admin-ghost so-sm" type="button" onClick={() => setEditing(v.id)}>
                    Edit
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function VideoEditor({ video, onCancel, onSave }) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description || "");
  const [tags, setTags] = useState((video.tags || []).join(", "));
  const [privacy, setPrivacy] = useState(video.privacy || "public");

  return (
    <div className="so-editor">
      <label className="so-field">
        <span>Title — {100 - title.length} left</span>
        <input className="admin-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="so-field">
        <span>Description</span>
        <textarea
          className="admin-input so-area"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="so-field">
        <span>Tags, comma separated</span>
        <input className="admin-input" value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <div className="so-row-end">
        <label className="so-field so-privacy">
          <span>Visibility</span>
          <select
            className="admin-input"
            value={privacy}
            onChange={(e) => setPrivacy(e.target.value)}
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
        </label>
        <span className="so-spacer" />
        <button className="admin-ghost so-sm" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="admin-primary"
          type="button"
          onClick={() =>
            onSave({
              title,
              description,
              tags: tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
              privacy,
            })
          }
          disabled={!title.trim() || title.length > 100}
        >
          Save changes
        </button>
      </div>
    </div>
  );
}

/* ================= styles ================= */

export function SocialStyles() {
  return (
    <style jsx global>{`
      .so-main {
        max-width: 1020px;
      }
      .so-sub {
        max-width: 68ch;
        line-height: 1.55;
        margin: 6px 0 0;
      }
      .so-busy,
      .so-ok {
        font-size: 12.5px;
        margin: 10px 0;
      }
      .so-busy {
        color: var(--a-dim, #8b90a0);
      }
      .so-ok {
        color: var(--a-amber, #ffb020);
        overflow-wrap: anywhere;
      }
      .so-dim {
        color: var(--a-dim, #8b90a0);
      }
      .so-note {
        font-size: 12px;
        line-height: 1.55;
        max-width: 72ch;
        margin: 0 0 14px;
      }
      .so-empty {
        font-size: 12.5px;
        color: #5c6377;
        margin: 4px 0 0;
      }
      .so-firstrun {
        margin-top: 18px;
      }

      /* ---- the roster: one row, every account, every service ----
         "Which account am I about to act as" is one question, so it is asked
         once. Position carries the service; the amber edge carries the
         selection, as it does everywhere else in this admin. */
      .so-roster {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 20px 0 0;
      }
      .so-who {
        display: flex;
        flex-direction: column;
        gap: 2px;
        align-items: flex-start;
        text-align: left;
        padding: 9px 14px;
        border: 1px solid var(--a-line, #2b3040);
        border-left-width: 3px;
        border-radius: 10px;
        background: var(--a-raise, #15171d);
        font: inherit;
        cursor: pointer;
        color: var(--a-dim, #8b90a0);
      }
      .so-who-name {
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
      }
      .so-who-kind {
        font-size: 10.5px;
        color: var(--a-dim, #7d8496);
      }
      .so-who:hover:not(.so-off):not(:disabled) {
        border-color: #3a4154;
      }
      .so-who.on {
        border-left-color: var(--a-amber, #ffb020);
      }
      .so-who.on .so-who-name {
        font-weight: 600;
      }
      .so-who.stale {
        border-left-color: #a33b45;
      }
      .so-who.stale .so-who-kind {
        color: #ff8a8a;
      }
      .so-who.so-add,
      .so-who.so-todo {
        border-style: dashed;
        background: none;
      }
      .so-who.so-todo .so-who-name {
        color: var(--a-dim, #8b90a0);
      }
      .so-who.so-todo.on .so-who-name {
        color: var(--a-text, #e7e8ee);
      }
      .so-who:focus-visible {
        outline: 2px solid var(--a-amber, #ffb020);
        outline-offset: 2px;
      }

      /* ---- the desk ---- */
      .so-desk {
        margin: 18px 0 0;
      }
      .so-pane {
        border: 1px solid var(--a-line, #23262f);
        border-radius: 14px;
        background: var(--a-raise, #15171d);
        padding: 20px;
      }

      /* The identity. The handle is the largest thing on the screen and is set
         in mono because it is an identifier — the one fact that must not be
         got wrong, since nothing published here can be edited back. */
      .so-id {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--a-line, #23262f);
      }
      .so-face {
        width: 46px;
        height: 46px;
        border-radius: 50%;
        object-fit: cover;
        flex: none;
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #2b3040);
      }
      .so-face-none {
        display: block;
      }
      .so-id-body {
        flex: 1;
        min-width: 0;
      }
      .so-handle {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 30px;
        line-height: 1.1;
        font-weight: 700;
        letter-spacing: -0.03em;
        color: var(--a-text, #e7e8ee);
        overflow-wrap: anywhere;
        animation: so-swap 220ms ease-out;
      }
      /* A label beginning with @ is an ADDRESS, not a name, so it is set in
         the face this admin reserves for identifiers you would copy. A channel
         called "Asap God" is a name and reads as a terminal string in mono. */
      .so-handle.so-addr {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-weight: 500;
        font-size: 27px;
        letter-spacing: -0.02em;
      }
      /* The one moving thing on the page, and only when who you are changed. */
      @keyframes so-swap {
        from {
          opacity: 0;
          transform: translateX(-6px);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .so-handle {
          animation: none;
        }
      }
      .so-kind {
        margin: 5px 0 0;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .so-kind em {
        font-style: normal;
        font-size: 11px;
      }
      .so-expired {
        color: #ff8a8a;
      }
      .so-soon {
        color: #ffd27a;
      }
      .so-stats {
        margin: 10px 0 0;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
      }
      .so-visit {
        flex: none;
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
        text-decoration: none;
        border-bottom: 1px solid var(--a-line, #2b3040);
        padding-bottom: 1px;
      }
      .so-visit:hover {
        color: var(--a-text, #e7e8ee);
        border-bottom-color: var(--a-amber, #ffb020);
      }

      /* Hairlines, never middots. */
      .so-hair {
        width: 14px;
        height: 1px;
        background: var(--a-line, #2a2e38);
        flex: none;
      }

      .so-work {
        padding: 18px 0 0;
      }
      .so-section {
        margin-top: 20px;
        padding-top: 18px;
        border-top: 1px solid var(--a-line, #23262f);
      }
      .so-pane h5 {
        margin: 0 0 10px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 13px;
        font-weight: 600;
        color: var(--a-text, #e7e8ee);
      }

      .so-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 14px;
      }
      .so-field > span {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
      }
      /* The hint belongs to the field it explains, not to a paragraph above
         the whole form. */
      .so-field small {
        font-size: 11px;
        line-height: 1.5;
        color: var(--a-dim, #6f7687);
        max-width: 68ch;
      }
      .so-field-big {
        margin-bottom: 8px;
      }
      .so-text {
        display: block;
        width: 100%;
        border-radius: 10px;
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #2b3040);
        resize: vertical;
        color: var(--a-text, #e7e8ee);
        font: inherit;
        font-size: 14.5px;
        line-height: 1.6;
        padding: 13px 14px;
      }
      .so-text:focus {
        outline: none;
        border-color: var(--a-amber, #ffb020);
      }
      .so-text.over {
        border-color: #ff6b6b;
      }
      .so-area {
        font-family: inherit;
      }

      /* One meter for both composers. The empty part of the track is what
         makes it read as a meter rather than a stray amber tick. */
      .so-meter {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 0 14px;
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
        flex-wrap: wrap;
      }
      .so-track {
        width: 96px;
        height: 3px;
        border-radius: 2px;
        background: var(--a-line, #2a2e38);
        overflow: hidden;
        flex: none;
      }
      .so-fill {
        display: block;
        height: 100%;
        background: #4d5465;
        transition: width 120ms linear;
      }
      .so-meter.close .so-fill {
        background: var(--a-amber, #ffb020);
      }
      .so-meter.over .so-fill {
        background: #ff6b6b;
        width: 100% !important;
      }
      .so-meter.close .so-count {
        color: #ffd27a;
      }
      .so-meter.over .so-count,
      .so-count.over {
        color: #ff8a8a;
      }
      @media (prefers-reduced-motion: reduce) {
        .so-fill {
          transition: none;
        }
      }

      /* A refusal is stated where the action would have been, not shown as a
         disabled button that implies a permission you could go and fix. */
      .so-cant {
        margin: 14px 0 0;
        padding: 10px 12px;
        border-radius: 9px;
        border: 1px dashed var(--a-line, #2b3040);
        font-size: 11.5px;
        line-height: 1.55;
        color: var(--a-dim, #8b90a0);
        max-width: 76ch;
      }
      .so-cant strong {
        color: #9aa1b4;
        font-weight: 600;
      }

      .so-row-end {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .so-spacer {
        flex: 1;
      }
      .so-privacy {
        max-width: 190px;
        margin-bottom: 0;
      }
      .so-check {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
      }
      .so-sm {
        padding: 5px 10px;
        font-size: 12px;
      }
      .so-listhead {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
      }
      .so-listhead h5 {
        margin-bottom: 10px;
      }

      .so-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .so-item {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 9px 8px 9px 11px;
        border-radius: 8px;
        border-left: 2px solid var(--a-line, #2a2e38);
      }
      .so-item:hover {
        background: rgba(255, 255, 255, 0.03);
      }
      .so-item.editing {
        border-left-color: var(--a-amber, #ffb020);
        background: rgba(255, 255, 255, 0.02);
      }
      .so-item > div {
        flex: 1;
        min-width: 0;
      }
      .so-item-text {
        margin: 0;
        font-size: 13px;
        line-height: 1.45;
        color: var(--a-text, #e7e8ee);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .so-item-meta {
        margin: 4px 0 0;
        display: flex;
        align-items: center;
        gap: 9px;
        font-size: 11px;
        color: var(--a-dim, #7d8496);
        flex-wrap: wrap;
      }
      .so-video {
        align-items: center;
      }
      .so-video-body {
        flex: 1;
        min-width: 0;
      }
      .so-thumb {
        width: 86px;
        height: 48px;
        object-fit: cover;
        border-radius: 6px;
        flex: none;
      }
      .so-editor {
        padding: 4px 0;
      }

      /* The record of what was published. The old grid showed a thumbnail and
         a like count, and threw away the date, the comments and the caption
         the API already returns — so it could not answer "what did I post". */
      .so-grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
        gap: 18px 14px;
      }
      .so-tile {
        display: block;
        aspect-ratio: 1;
        border-radius: 10px;
        overflow: hidden;
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #23262f);
      }
      .so-tile:hover,
      .so-tile:focus-visible {
        border-color: var(--a-amber, #ffb020);
        outline: none;
      }
      .so-tile img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .so-tile-none {
        display: block;
        width: 100%;
        height: 100%;
      }
      .so-tile-day {
        margin: 8px 0 0;
        font-size: 11.5px;
        color: var(--a-text, #e7e8ee);
      }
      .so-tile-meta {
        margin: 3px 0 0;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: var(--a-dim, #7d8496);
      }
      .so-tile-cap {
        margin: 5px 0 0;
        font-size: 11px;
        line-height: 1.45;
        color: var(--a-dim, #6f7687);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      /* ---- the setup checklist ---- */
      .so-why {
        margin: 0 0 16px;
        font-size: 12.5px;
        line-height: 1.6;
        color: var(--a-dim, #8b90a0);
        max-width: 68ch;
      }
      /* A cost is the part of a setup you cannot undo by deleting the app, so
         it is a table at the top rather than a sentence at the bottom. */
      .so-cost {
        border-collapse: collapse;
        margin: 0 0 20px;
        font-size: 12px;
      }
      .so-cost th,
      .so-cost td {
        text-align: left;
        font-weight: 400;
        padding: 6px 0;
        border-bottom: 1px solid var(--a-line, #23262f);
        color: var(--a-dim, #8b90a0);
      }
      .so-cost th {
        padding-right: 28px;
        color: var(--a-text, #e7e8ee);
      }
      .so-cost td {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        white-space: nowrap;
      }
      /* Numbered because it genuinely IS a sequence — step three cannot be
         done before step two. */
      .so-steps {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .so-steps > li {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .so-step-n {
        flex: none;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 1px solid var(--a-line, #2b3040);
        display: grid;
        place-items: center;
        font-size: 11px;
        color: var(--a-dim, #8b90a0);
      }
      .so-steps strong {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: var(--a-text, #e7e8ee);
      }
      .so-steps p {
        margin: 4px 0 0;
        font-size: 12px;
        line-height: 1.6;
        color: var(--a-dim, #8b90a0);
        max-width: 68ch;
      }
      .so-step-link {
        display: inline-block;
        margin-top: 7px;
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
        text-decoration: none;
        border-bottom: 1px solid var(--a-line, #2b3040);
      }
      .so-step-link:hover {
        color: var(--a-text, #e7e8ee);
        border-bottom-color: var(--a-amber, #ffb020);
      }
      .so-uris {
        list-style: none;
        margin: 9px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .so-uris li {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .so-uris code,
      .so-setup .so-stats code {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11.5px;
        color: var(--a-text, #e7e8ee);
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #23262f);
        border-radius: 6px;
        padding: 3px 7px;
        overflow-wrap: anywhere;
      }
      .so-setup .so-id {
        padding-bottom: 14px;
      }

      .so-foot {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 14px;
      }
      .so-unlink:hover {
        border-color: #ff6b6b;
        color: #ff6b6b;
      }

      @media (max-width: 720px) {
        .so-pane {
          padding: 16px;
        }
        /* .so-addr also sets a size, so the phone override has to match its
           specificity or the handle stays at its desktop size. */
        .so-handle,
        .so-handle.so-addr {
          font-size: 22px;
        }
        .so-face {
          width: 38px;
          height: 38px;
        }
        .so-visit {
          display: none;
        }
        .so-privacy {
          max-width: 100%;
        }
        .so-row-end .admin-primary {
          width: 100%;
        }
        .so-grid {
          grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
        }
        /* A hairline between items dangles at the end of a wrapped line, which
           reads as a rendering fault. Narrow enough to wrap, space separates
           instead. */
        .so-stats .so-hair,
        .so-meter .so-hair,
        .so-item-meta .so-hair,
        .so-tile-meta .so-hair {
          display: none;
        }
        .so-stats,
        .so-item-meta,
        .so-tile-meta {
          gap: 16px;
        }
        .so-meter {
          gap: 12px;
        }
      }
    `}</style>
  );
}
