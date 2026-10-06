// YouTube, Instagram and X in the admin — several accounts of each.
//
// DESIGN
//
// The Tasks board already solved this shape: when you can hold more than one
// of a thing, the provider becomes a SHELF you are inside rather than a badge
// on every row. The same language is used here, for the same reason — a post
// goes to exactly one account, and "which account am I about to publish as"
// has to be answerable without reading a label twice.
//
// So: one shelf per provider, the connected accounts as a row of selectable
// chips inside it, and the work for the SELECTED account underneath. The
// selected chip carries the amber left edge used everywhere else in this
// admin for "this is the one".
//
// The one loud element is the composer's weighted counter for X, because X's
// 280 is not 280 characters — a URL always counts as 23 and CJK counts double,
// so a post that looks short can be refused. The counter uses the SAME
// function the server validates with, so it cannot promise a post will fit and
// then have it bounce.
//
// Where a provider refuses something (X cannot edit, Instagram cannot edit a
// caption), the interface says so where the action would have been, rather
// than offering a disabled button that implies a fixable permission.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
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
  weightedLength,
  xAccount,
  xDelete,
  xPosts,
  xPublish,
  xThread,
  ytChannel,
  ytUpdateVideo,
  ytVideos,
} from "../../lib/socialClient";
import { logAdminAction } from "../../lib/auditLog";

export default function SocialPanel({ user }) {
  const [providers, setProviders] = useState(null);
  const [caps, setCaps] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setBusy("Reading your accounts…");
    try {
      const rows = await listAccounts();
      setProviders(rows);
      setCaps(await capabilities().catch(() => null));
      // Default each shelf to its first account, so the panel is usable
      // without a click.
      setSelected((cur) => {
        const next = { ...cur };
        for (const p of rows) {
          if (!next[p.provider] && p.accounts?.length) next[p.provider] = p.accounts[0].accountId;
        }
        return next;
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
    await load();
  };

  return (
    <div className="so-main">
      <div className="ops-head">
        <div>
          <h3>Social</h3>
          <p className="admin-sub so-sub">
            YouTube, Instagram and X — several accounts of each. Everything here goes to the account
            you have selected on that shelf, and the same connections serve the MCP tools.
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
        PROVIDERS.map((p) => {
          const row = providers.find((x) => x.provider === p.id) || {
            configured: false,
            accounts: [],
          };
          const accounts = row.accounts || [];
          const current = accounts.find((a) => a.accountId === selected[p.id]) || accounts[0];

          return (
            <section className="so-shelf" key={p.id} data-provider={p.id}>
              <header className="so-shelf-head">
                <div>
                  <h4>{p.label}</h4>
                  <p>
                    {!row.configured
                      ? `Not set up on this deployment${
                          row.missing?.length ? ` — missing ${row.missing.join(", ")}` : ""
                        }.`
                      : accounts.length === 0
                      ? `No ${p.noun} connected yet.`
                      : `${accounts.length} ${p.noun}${accounts.length === 1 ? "" : "s"} connected.`}
                  </p>
                </div>
                <button
                  className="admin-ghost"
                  type="button"
                  disabled={!row.configured || !!busy}
                  onClick={() => connect(p.id)}
                >
                  {accounts.length ? `Add another ${p.noun}` : `Connect ${p.label}`}
                </button>
              </header>

              {accounts.length ? (
                <>
                  <div className="so-accounts" role="tablist" aria-label={`${p.label} accounts`}>
                    {accounts.map((a) => (
                      <button
                        key={a.accountId}
                        type="button"
                        role="tab"
                        aria-selected={current?.accountId === a.accountId}
                        className={`so-chip${current?.accountId === a.accountId ? " on" : ""}${
                          a.needsReconnect ? " stale" : ""
                        }`}
                        onClick={() => setSelected((s) => ({ ...s, [p.id]: a.accountId }))}
                      >
                        <span className="so-chip-label">{a.label}</span>
                        {a.needsReconnect ? (
                          <em>expired</em>
                        ) : a.warning ? (
                          <em>{a.expiresInDays}d left</em>
                        ) : null}
                      </button>
                    ))}
                  </div>

                  {current ? (
                    <div className="so-work">
                      {p.id === "youtube" ? (
                        <YouTubePane accountId={current.accountId} onError={setErr} onMsg={setMsg} />
                      ) : p.id === "instagram" ? (
                        <InstagramPane
                          accountId={current.accountId}
                          caps={caps?.instagram}
                          onError={setErr}
                          onMsg={setMsg}
                        />
                      ) : (
                        <XPane
                          accountId={current.accountId}
                          caps={caps?.x}
                          onError={setErr}
                          onMsg={setMsg}
                          user={user}
                        />
                      )}
                      <div className="so-foot">
                        <button
                          className="admin-ghost so-unlink"
                          type="button"
                          onClick={() => unlink(p.id, current)}
                        >
                          Disconnect {current.label}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          );
        })
      )}

      <SocialStyles />
    </div>
  );
}

/* ================= X ================= */

export function XPane({ accountId, caps, onError, onMsg, user }) {
  const [text, setText] = useState("");
  const [thread, setThread] = useState(false);
  const [posts, setPosts] = useState(null);
  const [sending, setSending] = useState(false);

  const parts = useMemo(
    () => (thread ? text.split(/\n\s*---\s*\n/).map((t) => t.trim()).filter(Boolean) : [text]),
    [text, thread]
  );
  const worst = useMemo(
    () => parts.reduce((n, t) => Math.min(n, charsLeft(t)), X_MAX),
    [parts]
  );
  const tone = worst < 0 ? "over" : worst < 30 ? "close" : "fine";

  const send = async () => {
    if (!text.trim()) return;
    if (worst < 0) return onError(`One part is ${-worst} weighted characters over.`);
    if (!window.confirm(thread ? `Post this thread of ${parts.length}?` : "Post this to X now?"))
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
      <div className="so-compose-head">
        <h5>Post</h5>
        <label className="so-check">
          <input type="checkbox" checked={thread} onChange={(e) => setThread(e.target.checked)} />
          Thread — split parts with a line containing only ---
        </label>
      </div>

      <div className={`so-compose ${tone}`}>
        <textarea
          className="so-text"
          rows={thread ? 10 : 5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What are you building?"
          aria-label="Post text"
        />
      </div>

      <div className="so-meter">
        <span className={`so-count ${tone}`}>
          {worst >= 0 ? `${worst} left` : `${-worst} over`}
        </span>
        <span className="so-hair" aria-hidden="true" />
        <span className="so-dim">
          {thread ? `${parts.length} part${parts.length === 1 ? "" : "s"} · ` : ""}
          {X_MAX} weighted — a URL counts as 23, CJK as 2
        </span>
      </div>

      <div className="so-row-end">
        <button
          className="admin-primary"
          type="button"
          onClick={send}
          disabled={sending || !text.trim() || worst < 0}
        >
          {thread ? `Post thread` : "Post to X"}
        </button>
      </div>

      {caps?.editPost && !caps.editPost.available ? (
        <p className="so-cant">
          <strong>No editing.</strong> {caps.editPost.why} {caps.editPost.instead}
        </p>
      ) : null}

      <div className="so-listhead">
        <h5>Recent posts</h5>
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
                  <span>{(t.createdAt || "").slice(0, 10)}</span>
                  <span className="so-hair" aria-hidden="true" />
                  <span>{t.likes ?? 0} likes</span>
                  {t.edits > 1 ? (
                    <>
                      <span className="so-hair" aria-hidden="true" />
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
  );
}

/* ================= Instagram ================= */

export function InstagramPane({ accountId, caps, onError, onMsg }) {
  const [account, setAccount] = useState(null);
  const [media, setMedia] = useState([]);
  const [form, setForm] = useState({ imageUrl: "", caption: "", isReel: false });
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [a, m] = await Promise.all([
          igAccount(accountId),
          igMedia(accountId, 12).then((j) => j.media),
        ]);
        if (live) {
          setAccount(a);
          setMedia(m);
        }
      } catch (e) {
        onError(e.message);
      }
    })();
    return () => {
      live = false;
    };
  }, [accountId, onError]);

  const publish = async () => {
    if (!form.imageUrl) return onError("Instagram fetches the file, so it needs a public image URL.");
    if (!window.confirm("Publish to Instagram now? The caption cannot be edited afterwards.")) return;
    setSending(true);
    try {
      const out = await igPublish(accountId, form);
      onMsg(`Published. ${out.url || ""}`);
      setForm({ imageUrl: "", caption: "", isReel: false });
      setMedia(await igMedia(accountId, 12).then((j) => j.media));
    } catch (e) {
      onError(e.message);
    } finally {
      setSending(false);
    }
  };

  const limit = account?.publishingLimit;

  return (
    <div className="so-pane">
      {account ? (
        <p className="so-stats">
          <span>{account.followers ?? "—"} followers</span>
          <span className="so-hair" aria-hidden="true" />
          <span>{account.mediaCount ?? "—"} posts</span>
          <span className="so-hair" aria-hidden="true" />
          <span>{account.accountType || "—"}</span>
          {limit?.remaining != null ? (
            <>
              <span className="so-hair" aria-hidden="true" />
              <span>{limit.remaining} of {limit.limit} posts left today</span>
            </>
          ) : null}
        </p>
      ) : null}

      <h5>Publish</h5>
      <p className="so-dim so-note">
        Instagram fetches the file from a public URL rather than accepting an upload, so paste a
        reachable image URL. A caption cannot be changed once published.
      </p>
      <label className="so-field">
        <span>Image URL</span>
        <input
          className="admin-input"
          value={form.imageUrl}
          onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
          placeholder="https://ravikishan.me/api/media/…"
        />
      </label>
      <label className="so-field">
        <span>Caption</span>
        <textarea
          className="admin-input so-area"
          rows={4}
          value={form.caption}
          onChange={(e) => setForm({ ...form, caption: e.target.value })}
        />
      </label>
      <div className="so-row-end">
        <label className="so-check">
          <input
            type="checkbox"
            checked={form.isReel}
            onChange={(e) => setForm({ ...form, isReel: e.target.checked })}
          />
          Reel
        </label>
        <button className="admin-primary" type="button" onClick={publish} disabled={sending}>
          Publish to Instagram
        </button>
      </div>

      {caps?.editCaption && !caps.editCaption.available ? (
        <p className="so-cant">
          <strong>No caption editing.</strong> {caps.editCaption.why} {caps.editCaption.instead}
        </p>
      ) : null}

      <h5>Recent posts</h5>
      {media.length === 0 ? (
        <p className="so-empty">Nothing to show yet.</p>
      ) : (
        <div className="so-grid">
          {media.map((m) => (
            <a key={m.id} className="so-tile" href={m.url} target="_blank" rel="noreferrer">
              {m.thumbnail ? <img src={m.thumbnail} alt="" /> : <span className="so-tile-none" />}
              <span className="so-tile-meta">{m.likes ?? 0} ♥</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= YouTube ================= */

export function YouTubePane({ accountId, onError, onMsg }) {
  const [channel, setChannel] = useState(null);
  const [videos, setVideos] = useState([]);
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
      {channel ? (
        <p className="so-stats">
          <span>{channel.subscribers.toLocaleString()} subscribers</span>
          <span className="so-hair" aria-hidden="true" />
          <span>{channel.videos.toLocaleString()} videos</span>
          <span className="so-hair" aria-hidden="true" />
          <span>{channel.views.toLocaleString()} views</span>
        </p>
      ) : null}

      <p className="so-dim so-note">
        Editing here is safe: YouTube&apos;s update replaces the whole record and deletes anything
        left out, so every save reads the video first and merges — changing a title cannot wipe the
        description or tags. Uploading is not offered; publish in Studio, then set the metadata here.
      </p>

      {videos.length === 0 ? (
        <p className="so-empty">No videos on this channel.</p>
      ) : (
        <ul className="so-list">
          {videos.map((v) => (
            <li key={v.id} className="so-item so-video">
              {v.thumbnail ? <img className="so-thumb" src={v.thumbnail} alt="" /> : null}
              <div className="so-video-body">
                {editing === v.id ? (
                  <VideoEditor video={v} onCancel={() => setEditing(null)} onSave={(p) => save(v, p)} />
                ) : (
                  <>
                    <p className="so-item-text">{v.title}</p>
                    <p className="so-item-meta">
                      <span>{(v.publishedAt || "").slice(0, 10)}</span>
                      <span className="so-hair" aria-hidden="true" />
                      <span>{v.privacy}</span>
                      <span className="so-hair" aria-hidden="true" />
                      <span>{(v.views ?? 0).toLocaleString()} views</span>
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
          <span>Privacy</span>
          <select className="admin-input" value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
        </label>
        <span className="so-spacer" />
        <button className="admin-ghost" type="button" onClick={onCancel}>
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
        max-width: 70ch;
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
        max-width: 74ch;
        margin: 0 0 12px;
      }
      .so-empty {
        font-size: 12.5px;
        color: #5c6377;
        margin: 4px 0 0;
      }

      /* ---- the shelf: which account you are inside ---- */
      .so-shelf {
        margin: 22px 0 0;
        border-top: 1px solid var(--a-line, #23262f);
        padding-top: 16px;
      }
      .so-shelf-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        padding-left: 12px;
        border-left: 3px solid var(--a-line, #23262f);
      }
      .so-shelf-head h4 {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 16px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: var(--a-text, #e7e8ee);
      }
      .so-shelf-head p {
        margin: 4px 0 0;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
        max-width: 70ch;
        line-height: 1.5;
      }

      /* Accounts are chips, and the selected one carries the amber edge used
         everywhere else in this admin for "this is the one". */
      .so-accounts {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin: 14px 0 0 15px;
      }
      .so-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        border-radius: 9px;
        border: 1px solid var(--a-line, #2b3040);
        border-left-width: 3px;
        background: var(--a-raise, #15171d);
        color: var(--a-dim, #8b90a0);
        font: inherit;
        font-size: 12.5px;
        cursor: pointer;
      }
      .so-chip.on {
        border-left-color: var(--a-amber, #ffb020);
        color: var(--a-text, #e7e8ee);
        font-weight: 600;
      }
      .so-chip.stale {
        border-left-color: #a33b45;
      }
      .so-chip em {
        font-style: normal;
        font-size: 10.5px;
        color: #ffd27a;
      }
      .so-chip.stale em {
        color: #ff8a8a;
      }

      .so-work {
        margin: 14px 0 0 15px;
      }
      .so-pane {
        border: 1px solid var(--a-line, #23262f);
        border-radius: 12px;
        background: var(--a-raise, #15171d);
        padding: 16px;
      }
      .so-pane h5 {
        margin: 16px 0 8px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
      }
      .so-pane h5:first-child {
        margin-top: 0;
      }
      .so-stats {
        margin: 0 0 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        font-size: 12px;
        color: var(--a-dim, #8b90a0);
      }
      /* Hairlines, never middots. */
      .so-hair {
        width: 14px;
        height: 1px;
        background: var(--a-line, #2a2e38);
        flex: none;
      }

      .so-compose-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .so-compose-head h5 {
        margin: 0;
      }
      .so-compose {
        position: relative;
        margin-top: 8px;
        border-radius: 10px;
        overflow: hidden;
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #2b3040);
      }
      .so-compose:focus-within {
        border-color: var(--a-amber, #ffb020);
      }
      .so-compose.over {
        border-color: #ff6b6b;
      }
      .so-text {
        display: block;
        width: 100%;
        background: none;
        border: 0;
        resize: vertical;
        color: var(--a-text, #e7e8ee);
        font: inherit;
        font-size: 14.5px;
        line-height: 1.6;
        padding: 13px 14px;
      }
      .so-text:focus {
        outline: none;
      }
      .so-meter {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 8px 2px 12px;
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      .so-count.close {
        color: #ffd27a;
      }
      .so-count.over {
        color: #ff8a8a;
      }

      /* A refusal is stated where the action would have been, not shown as a
         disabled button that implies a permission you could go and fix. */
      .so-cant {
        margin: 12px 0 0;
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

      .so-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 10px;
      }
      .so-field > span {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
      }
      .so-area {
        font-family: inherit;
      }
      .so-row-end {
        display: flex;
        align-items: flex-end;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 4px;
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

      .so-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
        gap: 8px;
      }
      .so-tile {
        position: relative;
        display: block;
        aspect-ratio: 1;
        border-radius: 8px;
        overflow: hidden;
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #23262f);
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
      .so-tile-meta {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        padding: 4px 6px;
        font-size: 10.5px;
        color: #fff;
        background: linear-gradient(transparent, rgba(0, 0, 0, 0.65));
      }

      .so-foot {
        margin-top: 12px;
      }
      .so-unlink:hover {
        border-color: #ff6b6b;
        color: #ff6b6b;
      }

      @media (max-width: 720px) {
        .so-work,
        .so-accounts {
          margin-left: 0;
        }
        .so-privacy {
          max-width: 100%;
        }
      }
    `}</style>
  );
}
