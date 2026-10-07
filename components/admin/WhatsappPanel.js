// WhatsApp, in the admin.
//
// Lives inside the Agent tab because that is where the connection physically
// is: a WhatsApp session is a socket held open for days plus session keys on
// disk, so it runs on your own server and this panel is a remote control for
// it, not a client.
//
// DESIGN
//
// The loudest thing on this panel is not a chat — it is the warning. Everything
// else here is ordinary (a list, a thread, a box to type in), and the one
// genuinely unusual fact is that using it puts the account at risk. A warning
// you scroll past once and never see again is decoration; this one sits above
// the connect button and does not go away after connecting, because the risk
// does not go away after connecting either.
//
// Sending is deliberately plain and slightly slow: one chat, one message, a
// confirm on the first send to a chat. There is no compose-to-many, no
// scheduling and no templates, because each of those is a step towards the
// thing that gets accounts banned.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

// A timestamp formatted with the viewer's locale and timezone cannot be
// rendered on the server: it is a different string there, and React treats
// that as a hydration failure. Anything locale-dependent waits for mount.
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export default function WhatsappPanel({ client, status, chats, thread, onAction, initialChat = "" }) {
  // `initialChat` exists only so /__whatsapppreview can show an open thread
  // without automating a click into it.
  const [selected, setSelected] = useState(initialChat);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const confirmed = useRef(new Set());
  const tailRef = useRef(null);
  const mounted = useMounted();

  const live = status?.sessions?.find((s) => s.connected) || null;
  const pairing = status?.sessions?.find((s) => s.state === "pairing") || null;

  useEffect(() => {
    if (tailRef.current) tailRef.current.scrollTop = tailRef.current.scrollHeight;
  }, [thread?.messages?.length, selected]);

  const open = useCallback(
    (jid) => {
      setSelected(jid);
      onAction({ action: "read", jid, limit: 80 });
      onAction({ action: "markRead", jid });
    },
    [onAction]
  );

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = chats || [];
    return q ? list.filter((c) => `${c.name} ${c.jid}`.toLowerCase().includes(q)) : list;
  }, [chats, filter]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !selected) return;

    // A confirm on the FIRST message to a chat in this session. Not on every
    // one — that trains you to dismiss it — but enough that a message typed
    // into the wrong thread does not just leave.
    if (!confirmed.current.has(selected)) {
      const who = (chats || []).find((c) => c.jid === selected)?.name || selected;
      // eslint-disable-next-line no-alert
      if (!window.confirm(`Send to ${who}?\n\nThis is a real WhatsApp message from your account.`)) return;
      confirmed.current.add(selected);
    }

    setSending(true);
    setErr("");
    try {
      await onAction({ action: "send", to: selected, text });
      setDraft("");
      onAction({ action: "read", jid: selected, limit: 80 });
    } catch (e) {
      setErr(e.message || "Could not send that.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="wa">
      <Warning />

      {!status?.installed ? (
        <p className="wa-blocked">
          WhatsApp support is not installed on the agent server. Run{" "}
          <code>npm install @whiskeysockets/baileys</code> in <code>agent/</code> and restart agentd.
        </p>
      ) : !live ? (
        <Connect status={status} pairing={pairing} onAction={onAction} />
      ) : (
        <>
          <header className="wa-head">
            <span className="wa-me">
              <i className="wa-dot" aria-hidden="true" />
              {live.me?.name || live.me?.id?.split(":")[0] || "connected"}
            </span>
            <span className="wa-stat">
              {live.chats} chats · {live.sentThisHour} sent this hour
            </span>
            <button className="admin-ghost" type="button" onClick={() => onAction({ action: "disconnect" })}>
              Disconnect
            </button>
            <button
              className="wa-logout"
              type="button"
              title="Unlinks this device on your phone as well"
              onClick={() => {
                // eslint-disable-next-line no-alert
                if (window.confirm("Log out? This unlinks the device on your phone and deletes the session here.")) {
                  onAction({ action: "logout" });
                }
              }}
            >
              Log out
            </button>
          </header>

          {err ? <p className="admin-err">{err}</p> : null}

          <div className="wa-grid">
            <aside className="wa-list">
              <input
                className="admin-input"
                placeholder="Search chats"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Search chats"
              />
              {visible.length === 0 ? (
                <p className="wa-none">
                  No chats cached yet. agentd only sees messages that arrive while it is connected —
                  it does not download your history.
                </p>
              ) : (
                visible.map((c) => (
                  <button
                    key={c.jid}
                    type="button"
                    className={`wa-chat${selected === c.jid ? " on" : ""}`}
                    onClick={() => open(c.jid)}
                  >
                    <span className="wa-chat-name">
                      {c.name}
                      {c.isGroup ? <i>group</i> : null}
                    </span>
                    <span className="wa-chat-prev">{c.preview || "—"}</span>
                    {c.unread ? <span className="wa-unread">{c.unread}</span> : null}
                  </button>
                ))
              )}
            </aside>

            <section className="wa-thread">
              {!selected ? (
                <p className="wa-none">Pick a chat.</p>
              ) : (
                <>
                  <div className="wa-msgs" ref={tailRef}>
                    {(thread?.messages || []).length === 0 ? (
                      <p className="wa-none">{thread?.note || "Nothing cached for this chat yet."}</p>
                    ) : (
                      thread.messages.map((m) => (
                        <article key={m.id} className={`wa-msg${m.fromMe ? " mine" : ""}`}>
                          {!m.fromMe && thread.isGroup ? <b>{m.fromName}</b> : null}
                          <p>{m.text || (m.media ? `[${m.media.kind}]` : `[${m.type}]`)}</p>
                          {/* Empty until mounted: a locale-formatted time
                              differs between server and browser. */}
                          <time suppressHydrationWarning>
                            {mounted && m.at ? new Date(m.at).toLocaleString() : ""}
                          </time>
                        </article>
                      ))
                    )}
                  </div>

                  <form
                    className="wa-compose"
                    onSubmit={(e) => {
                      e.preventDefault();
                      send();
                    }}
                  >
                    <textarea
                      className="admin-input"
                      rows={2}
                      placeholder="Message"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          send();
                        }
                      }}
                    />
                    <button className="admin-primary" type="submit" disabled={sending || !draft.trim()}>
                      {sending ? "Sending…" : "Send"}
                    </button>
                  </form>
                </>
              )}
            </section>
          </div>
        </>
      )}

      <WhatsappStyles />
    </section>
  );
}

// Above the connect button, and it stays after connecting — because the risk
// stays after connecting.
export function Warning() {
  return (
    <p className="wa-warn" role="note">
      <b>This connects as your personal account through an unofficial client.</b> WhatsApp&rsquo;s
      terms do not permit that, and accounts are banned for automated behaviour — what you would
      lose is your real conversation history. The official API cannot do this: it works on a
      separate business number and starts with no chats. There is no bulk send and nothing replies
      on its own.
    </p>
  );
}

export function Connect({ status, pairing, onAction }) {
  return (
    <div className="wa-connect">
      {pairing?.qr ? (
        <>
          <p>Open WhatsApp on your phone → Settings → Linked devices → Link a device.</p>
          <QrCode value={pairing.qr} />
          <p className="wa-sub">The code rotates every 20 seconds; this updates with it.</p>
        </>
      ) : (
        <>
          <p>
            {status?.hasSession
              ? "A saved session exists on the server. Reconnecting will not need a new QR code."
              : "Not connected. You will scan a QR code with your phone."}
          </p>
          <button className="admin-primary" type="button" onClick={() => onAction({ action: "connect" })}>
            {status?.hasSession ? "Reconnect" : "Connect WhatsApp"}
          </button>
        </>
      )}
    </div>
  );
}

// The QR is rendered from the raw string rather than fetched from an image
// service. A pairing code is a credential for the duration it is on screen,
// and handing it to a third party to draw would be handing out the session.
export function QrCode({ value, size = 232 }) {
  const [svg, setSvg] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const QR = await import("qrcode");
        const out = await QR.toString(value, { type: "svg", margin: 1, width: size });
        if (alive) setSvg(out);
      } catch (_) {
        if (alive) setSvg("");
      }
    })();
    return () => {
      alive = false;
    };
  }, [value, size]);

  if (!svg) {
    return (
      <pre className="wa-qr-fallback" aria-label="Pairing code">
        {value}
      </pre>
    );
  }
  // eslint-disable-next-line react/no-danger
  return <div className="wa-qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function WhatsappStyles() {
  return (
    <style jsx global>{`
      .wa {
        display: block;
      }
      /* The one loud element, and it does not fade after connecting. */
      .wa-warn {
        margin: 0 0 14px;
        padding: 12px 14px;
        border: 1px solid #6d2a31;
        border-left-width: 3px;
        border-radius: 10px;
        background: rgba(163, 59, 69, 0.1);
        color: #ffb4b4;
        font-size: 12.5px;
        line-height: 1.6;
        max-width: 92ch;
      }
      .wa-warn b {
        color: #ff9a9a;
      }
      .wa-blocked,
      .wa-none {
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
        line-height: 1.6;
        margin: 0;
        padding: 12px 2px;
      }
      .wa-connect {
        display: grid;
        gap: 12px;
        justify-items: start;
        max-width: 60ch;
      }
      .wa-connect p {
        margin: 0;
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
        line-height: 1.55;
      }
      .wa-sub {
        color: var(--a-dim, #8b90a0) !important;
        font-size: 12px !important;
      }
      .wa-qr {
        background: #fff;
        padding: 10px;
        border-radius: 10px;
        line-height: 0;
      }
      .wa-qr-fallback {
        background: var(--a-void, #0d0e13);
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 8px;
        padding: 10px;
        font-size: 9px;
        max-width: 100%;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-all;
        color: var(--a-dim, #8b90a0);
      }

      .wa-head {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .wa-me {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
      }
      .wa-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #4ade80;
      }
      .wa-stat {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
        margin-right: auto;
      }
      .wa-logout {
        background: none;
        border: 1px solid #5a2a30;
        color: #ff8a8a;
        border-radius: 9px;
        padding: 9px 14px;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }

      .wa-grid {
        display: grid;
        grid-template-columns: minmax(220px, 300px) 1fr;
        gap: 14px;
        align-items: start;
      }
      .wa-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 64vh;
        overflow-y: auto;
      }
      .wa-chat {
        position: relative;
        display: grid;
        gap: 2px;
        text-align: left;
        background: var(--a-raise, #15171d);
        border: 1px solid var(--a-line, #23262f);
        border-left: 2px solid transparent;
        border-radius: 9px;
        padding: 9px 11px;
        font: inherit;
        color: inherit;
        cursor: pointer;
      }
      .wa-chat.on {
        border-left-color: var(--a-amber, #ffb020);
      }
      .wa-chat-name {
        font-size: 13px;
        color: var(--a-text, #e7e8ee);
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .wa-chat-name i {
        font-style: normal;
        font-size: 9.5px;
        color: #6b7285;
        border: 1px solid var(--a-line, #2a2e38);
        border-radius: 4px;
        padding: 0 4px;
      }
      .wa-chat-prev {
        font-size: 11.5px;
        color: var(--a-dim, #7d8496);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .wa-unread {
        position: absolute;
        right: 9px;
        top: 9px;
        background: var(--a-amber, #ffb020);
        color: #1a1300;
        font-size: 10px;
        font-weight: 700;
        border-radius: 999px;
        padding: 1px 6px;
      }

      .wa-thread {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
      }
      .wa-msgs {
        max-height: 54vh;
        overflow-y: auto;
        background: var(--a-void, #0d0e13);
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .wa-msg {
        max-width: 72%;
        align-self: flex-start;
        background: var(--a-raise, #15171d);
        border: 1px solid var(--a-line, #23262f);
        border-radius: 10px;
        padding: 7px 10px;
      }
      .wa-msg.mine {
        align-self: flex-end;
        background: rgba(255, 176, 32, 0.1);
        border-color: rgba(255, 176, 32, 0.3);
      }
      .wa-msg b {
        display: block;
        font-size: 10.5px;
        color: var(--a-amber, #ffb020);
        margin-bottom: 2px;
      }
      .wa-msg p {
        margin: 0;
        font-size: 13px;
        line-height: 1.45;
        color: var(--a-text, #e7e8ee);
        white-space: pre-wrap;
        word-break: break-word;
      }
      .wa-msg time {
        display: block;
        margin-top: 3px;
        font-size: 10px;
        color: #5c6377;
      }
      .wa-compose {
        display: flex;
        gap: 8px;
        align-items: flex-end;
      }
      .wa-compose textarea {
        flex: 1;
        font-family: inherit;
        font-size: 13px;
        resize: vertical;
      }

      @media (max-width: 860px) {
        .wa-grid {
          grid-template-columns: 1fr;
        }
        .wa-list {
          max-height: 32vh;
        }
      }
    `}</style>
  );
}
