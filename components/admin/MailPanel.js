// The Mail desk.
//
// WHAT THIS PANEL IS FOR, which decided its shape: the question anyone opens a
// mailbox with is "what has arrived and does any of it need me" — not "show me
// the Gmail account". So the default view is every connected mailbox MERGED and
// sorted newest first, and the account is a filter you ask for rather than a
// shelf you must choose before you can see anything.
//
// That is a deliberate departure from the Tasks board, which puts the account
// in the POSITION ("you are inside a shelf"). A merged stream has no position
// left to spend, so here each row says which mailbox it landed in, as an
// address in mono — this admin's mark for an identifier you would copy.
//
// The one thing that cannot be taken back is a sent message, and the mistake
// that actually happens is sending from the wrong address. Everything about
// the composer answers that: see Outbound.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MailStyles from "./MailStyles";
import { mailFrameDoc } from "../../lib/server/mailHtml";
import {
  capability,
  fullWhen,
  getMessage,
  isAddress,
  mailAccounts,
  providerLabel,
  readEveryMailbox,
  readMailbox,
  replyToMail,
  senderName,
  sendMail,
  updateMessage,
  when,
} from "../../lib/mailClient";
import { connectProvider, forgetAccount, setDefaultAccount } from "../../lib/accountsClient";
import { mailServicesConfigured } from "../../lib/mailClient";
import { finishConnect } from "../../lib/socialClient";

const SERVICES = [
  { id: "gmail", label: "Gmail" },
  { id: "outlook", label: "Outlook" },
];

const keyOf = (a) => a.key || `${a.provider}__${a.accountId}`;

/* ================= the head ================= */

// The headline is the STATE of the inbox, not the name of the section —
// AdminShell already prints "Mail" in the rail, and two headings stacked is
// exactly what a screenshot catches and a component in isolation never does.
// The headline is the STATE of the inbox, and it is the only figure here.
//
// THERE IS DELIBERATELY NO ARRIVAL CHART. One was built and cut: a per-day
// strip drawn from a fetched PAGE renders every day beyond the end of that
// page as an empty bar, which reads as a quiet day and is really "we did not
// look". A chart that cannot tell those apart is worse than no chart. The
// figures that can be honest are the ones below, and they say what they
// counted. get_mail_analytics keeps the per-day numbers because it states its
// sample size in the same breath; a picture cannot.
export function Headline({ unread, counted, mailboxes, loading }) {
  // A fetch in flight used to render EXACTLY like an empty account: "Nothing
  // fetched yet -- 0 mailboxes connected", which is what the panel said in the
  // seconds right after a consent succeeded. Saying nothing is connected while
  // you are still finding out is the one message that must not be guessed.
  if (loading) {
    return (
      <div>
        <p className="mbx-count">Reading your mail…</p>
        <p className="mbx-scope">Asking every connected mailbox for its newest messages.</p>
      </div>
    );
  }
  if (!counted) {
    return (
      <div>
        <p className="mbx-count">Nothing fetched yet</p>
        <p className="mbx-scope">
          {mailboxes} mailbox{mailboxes === 1 ? "" : "es"} connected.
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="mbx-count">
        {unread ? (
          <>
            <b>{unread}</b> unread
          </>
        ) : (
          "Nothing unread"
        )}
      </p>
      <p className="mbx-scope">
        in the {counted} newest across {mailboxes} mailbox{mailboxes === 1 ? "" : "es"}. These count
        what was fetched, not the mailbox.
      </p>
    </div>
  );
}

/* ================= the stream ================= */

export function Row({ m, open, onOpen }) {
  return (
    <button
      type="button"
      className={`mbx-row${m.unread ? " unread" : ""}${open ? " open" : ""}`}
      onClick={() => onOpen(m)}
    >
      <span className="mbx-row-top">
        <span className="mbx-who">{senderName(m)}</span>
        <span className="mbx-ago">{when(m.at)}</span>
      </span>
      <span className="mbx-box">
        {m.account || ""}
        {m.hasAttachment ? <span className="mbx-clip"> · has a file</span> : null}
      </span>
      <span className="mbx-subj">
        {m.subject || "(no subject)"} <span>{m.preview || ""}</span>
      </span>
    </button>
  );
}

/* ================= reading ================= */

// The body of a message, which is the ONLY content in this product written by
// somebody who is not the owner.
//
// It renders in an iframe WITHOUT `allow-same-origin`, so the frame is an
// opaque origin: it cannot read this page's DOM, its cookies or the IndexedDB
// that holds the Firebase session. That boundary -- not the sanitiser -- is
// what makes rendering a stranger's markup acceptable here. `allow-scripts` is
// present only so our own nonce'd height reporter can run; the CSP inside the
// document is `default-src 'none'` with scripts allowed under that one nonce,
// so a <script> that somehow survived sanitising still cannot execute.
export function MailBody({ html, text, allowRemote, onShowImages }) {
  const frame = useRef(null);
  const [height, setHeight] = useState(240);
  // A new nonce per body, so one message's reporter cannot be replayed into
  // the next one's document. The deps look unused to the linter precisely
  // because the value is derived from nothing BUT them changing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nonce = useMemo(() => Math.random().toString(36).slice(2) + Date.now().toString(36), [html, allowRemote]);
  const built = useMemo(
    () => (html ? mailFrameDoc(html, { allowRemoteImages: allowRemote, nonce }) : null),
    [html, allowRemote, nonce]
  );

  useEffect(() => {
    if (!built) return undefined;
    const onMsg = (e) => {
      // An opaque origin reports itself as "null", so the frame is identified
      // by its own window rather than by where it claims to be from.
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const h = Number(e.data?.mbxHeight);
      // No fudge added here: a constant on top of a measurement the parent
      // then feeds back is exactly how the runaway above happened.
      if (Number.isFinite(h) && h > 0) setHeight(Math.min(Math.max(h, 80), 20000));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [built]);

  if (!built) {
    return <div className="mbx-body">{text || "This message has no text body."}</div>;
  }

  return (
    <div className="mbx-html">
      {built.blockedImages > 0 && !allowRemote && (
        <div className="mbx-imgbar">
          <span>
            {built.blockedImages} image{built.blockedImages === 1 ? "" : "s"} not loaded. Loading them
            tells the sender you opened this.
          </span>
          <button type="button" className="admin-ghost" onClick={onShowImages}>
            Show images
          </button>
        </div>
      )}
      <iframe
        ref={frame}
        title="Message"
        className="mbx-frame"
        style={{ height }}
        // No allow-same-origin: the frame cannot reach this page. allow-popups
        // and -to-escape-sandbox are what let a link open in a real tab rather
        // than a scriptless sandboxed one.
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={built.doc}
      />
    </div>
  );
}

export function Reader({ message, onBack, onAct, onReply, busy, allowRemote, onShowImages }) {
  const m = message;
  return (
    <div>
      <button type="button" className="admin-ghost mbx-back" onClick={onBack}>
        Back to the stream
      </button>
      <h3 className="mbx-subject">{m.subject || "(no subject)"}</h3>
      <div className="mbx-meta">
        <span>{senderName(m)}</span>
        <span className="mbx-addr">{m.from?.email}</span>
        <span className="mbx-at">{fullWhen(m.at)}</span>
      </div>
      <div className="mbx-meta" style={{ border: 0, paddingBottom: 0, marginTop: 6 }}>
        <span>arrived in</span>
        <span className="mbx-addr">{m.account || m.to?.[0]?.email || ""}</span>
      </div>
      <MailBody
        html={m.html || ""}
        text={m.body || m.preview || ""}
        allowRemote={!!allowRemote}
        onShowImages={onShowImages}
      />
      <div className="mbx-acts">
        <button type="button" className="admin-primary" onClick={onReply} disabled={busy}>
          Reply
        </button>
        <button
          type="button"
          className="admin-ghost"
          onClick={() => onAct(m.unread ? "read" : "unread")}
          disabled={busy}
        >
          Mark {m.unread ? "read" : "unread"}
        </button>
        {capability(m.provider, "archive").available && (
          <button type="button" className="admin-ghost" onClick={() => onAct("archive")} disabled={busy}>
            Archive
          </button>
        )}
        <button type="button" className="admin-ghost" onClick={() => onAct("trash")} disabled={busy}>
          Move to trash
        </button>
      </div>
    </div>
  );
}

/* ================= the send control ================= */

// THE ONE BOLD ELEMENT, and the reason this panel is shaped the way it is.
//
// Two properties, both structural rather than advisory:
//   1. The button says the ADDRESS, not "Send". The mistake that actually
//      happens with several mailboxes is replying as the wrong person, and a
//      button reading "Send" cannot warn about it.
//   2. The send button DOES NOT EXIST until the exact message has been on
//      screen. "Review what goes out" runs the real dry run on the server, so
//      what is shown is what would be built — and editing anything afterwards
//      takes the button away again. A confirm dialog asks you to agree; this
//      asks you to look.
export function Outbound({ from, reviewed, busy, onReview, onSend, onEdit, label = "Send" }) {
  const prev = useRef(from);
  const [swap, setSwap] = useState(false);
  useEffect(() => {
    if (prev.current !== from) {
      prev.current = from;
      setSwap(true);
      const t = setTimeout(() => setSwap(false), 260);
      return () => clearTimeout(t);
    }
  }, [from]);

  return (
    <div className="mbx-outbound">
      <span className="mbx-as-lede">Goes out as</span>
      <span className={`mbx-as${swap ? " mbx-swap" : ""}`}>{from || "no mailbox chosen"}</span>

      {reviewed ? (
        <>
          <div className="mbx-review">
            <h4>This is what goes out. It cannot be unsent.</h4>
            <dl>
              <dt>To</dt>
              <dd>{(reviewed.to || []).join(", ") || reviewed.to}</dd>
              {reviewed.cc?.length ? (
                <>
                  <dt>Cc</dt>
                  <dd>{reviewed.cc.join(", ")}</dd>
                </>
              ) : null}
              {reviewed.bcc?.length ? (
                <>
                  <dt>Bcc</dt>
                  <dd>{reviewed.bcc.join(", ")}</dd>
                </>
              ) : null}
              <dt>Subject</dt>
              <dd>{reviewed.subject || "(no subject)"}</dd>
            </dl>
            <pre>{reviewed.body}</pre>
          </div>
          <div className="mbx-go">
            <button type="button" className="admin-primary big" onClick={onSend} disabled={busy}>
              {label} as {from}
            </button>
            <button type="button" className="admin-ghost" onClick={onEdit} disabled={busy}>
              Keep editing
            </button>
            {busy && <span className="mbx-sending">Sending…</span>}
          </div>
        </>
      ) : (
        <div className="mbx-go">
          <button type="button" className="admin-primary" onClick={onReview} disabled={busy}>
            Review what goes out
          </button>
          <span className="mbx-scope" style={{ margin: 0 }}>
            Nothing is sent until you have seen it.
          </span>
        </div>
      )}
    </div>
  );
}

/* ================= writing ================= */

export function Composer({ accounts, from, setFrom, draft, setDraft, children }) {
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const [showCc, setShowCc] = useState(false);
  const bad = draft.to && !draft.to.split(",").every((t) => !t.trim() || isAddress(t.trim()));

  return (
    <div className="mbx-form">
      {accounts.length > 1 && (
        <div className="mbx-field">
          <label htmlFor="mbx-from">Send from</label>
          <select
            id="mbx-from"
            className="admin-input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={keyOf(a)} value={keyOf(a)}>
                {a.account} — {providerLabel(a.provider)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="mbx-field">
        <label htmlFor="mbx-to">To</label>
        <input
          id="mbx-to"
          className="admin-input"
          value={draft.to || ""}
          onChange={set("to")}
          placeholder="ada@example.com, grace@example.com"
          autoComplete="off"
        />
        {bad && <p className="admin-err">One of those is not an address yet.</p>}
      </div>
      {showCc ? (
        <div className="mbx-two">
          <div className="mbx-field">
            <label htmlFor="mbx-cc">Cc</label>
            <input id="mbx-cc" className="admin-input" value={draft.cc || ""} onChange={set("cc")} />
          </div>
          <div className="mbx-field">
            <label htmlFor="mbx-bcc">Bcc</label>
            <input id="mbx-bcc" className="admin-input" value={draft.bcc || ""} onChange={set("bcc")} />
          </div>
        </div>
      ) : (
        <button type="button" className="admin-ghost" onClick={() => setShowCc(true)}>
          Add cc or bcc
        </button>
      )}
      <div className="mbx-field mbx-plain">
        <label htmlFor="mbx-subject">Subject</label>
        <input id="mbx-subject" className="admin-input" value={draft.subject || ""} onChange={set("subject")} />
      </div>
      <div className="mbx-field">
        <label htmlFor="mbx-body">Message</label>
        <textarea
          id="mbx-body"
          className="admin-input mbx-write"
          value={draft.body || ""}
          onChange={set("body")}
        />
      </div>
      {children}
    </div>
  );
}

/* ================= the mailboxes ================= */

// WHY THIS ROW EXISTS AT ALL, including with one mailbox connected.
//
// The first version showed Connect buttons only when NOTHING was connected, so
// the moment the first mailbox landed there was no way to add a second -- the
// panel went from "set this up" to "here is your mail" and quietly dropped the
// setup it still needed to offer.
//
// It answers three questions that a chip row of pure filters does not:
//   - which mailboxes do I have, and can I add another
//   - which one does a TOOL act as when a call names none (with two connected
//     and no default the server refuses, and a panel that cannot show that
//     leaves the refusal unexplainable)
//   - how do I get rid of one
//
// "Everything" is still hidden with a single mailbox, because a chooser
// between one thing and itself is chrome for a decision nobody has.
export function Mailboxes({
  accounts,
  configured = {},
  selected,
  onSelect,
  onAdd,
  onMakeDefault,
  onDisconnect,
  busy,
}) {
  const [menu, setMenu] = useState("");
  const close = () => setMenu("");

  useEffect(() => {
    if (!menu) return;
    const away = () => close();
    const esc = (e) => e.key === "Escape" && close();
    document.addEventListener("click", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const stop = (e) => e.stopPropagation();

  return (
    <div className="mbx-boxes" role="group" aria-label="Mailboxes">
      {accounts.length > 1 && (
        <button
          type="button"
          className={`mbx-chip${selected === "all" ? " on" : ""}`}
          onClick={() => onSelect("all")}
        >
          Everything <em>{accounts.length} mailboxes</em>
        </button>
      )}

      {accounts.map((a) => {
        const k = keyOf(a);
        return (
          <span className="mbx-box-chip" key={k}>
            <button
              type="button"
              className={`mbx-chip${selected === k ? " on" : ""}${a.needsReconnect ? " mbx-gone" : ""}`}
              onClick={() => onSelect(k)}
            >
              {a.account}{" "}
              <em>
                {a.needsReconnect ? "reconnect" : providerLabel(a.provider)}
                {a.isDefault ? " · default" : ""}
              </em>
            </button>
            <button
              type="button"
              className="mbx-more"
              aria-label={`Options for ${a.account}`}
              aria-expanded={menu === k}
              onClick={(e) => {
                stop(e);
                setMenu(menu === k ? "" : k);
              }}
            >
              ···
            </button>
            {menu === k && (
              <div className="mbx-menu" onClick={stop}>
                {a.isDefault ? (
                  <p className="mbx-menu-note">
                    Tools act as this mailbox when a call names none.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      onMakeDefault(a);
                    }}
                    disabled={busy}
                  >
                    Make this the one tools use
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onAdd(a.provider);
                  }}
                >
                  Reconnect{a.needsReconnect ? "" : " to refresh permissions"}
                </button>
                <button
                  type="button"
                  className="mbx-danger"
                  onClick={() => {
                    close();
                    onDisconnect(a);
                  }}
                  disabled={busy}
                >
                  Disconnect
                </button>
              </div>
            )}
          </span>
        );
      })}

      <span className="mbx-box-chip">
        <button
          type="button"
          className="mbx-chip mbx-add"
          aria-expanded={menu === "add"}
          onClick={(e) => {
            stop(e);
            setMenu(menu === "add" ? "" : "add");
          }}
          disabled={busy}
        >
          Add a mailbox
        </button>
        {menu === "add" && (
          <div className="mbx-menu" onClick={stop}>
            {SERVICES.map((svc) =>
              // A service with no OAuth client on this deployment is not a
              // disabled button: there is nothing there to press, and a
              // disabled button implies a permission you could go and fix.
              configured[svc.id] === false ? (
                <p className="mbx-menu-note" key={svc.id}>
                  {svc.label} needs {(configured[`${svc.id}Missing`] || []).join(" and ")} on this
                  deployment.
                </p>
              ) : (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => {
                    close();
                    onAdd(svc.id);
                  }}
                >
                  {svc.label}
                </button>
              )
            )}
            <p className="mbx-menu-note">
              You pick the account on the provider&apos;s own screen, so a second one can be added
              at any time.
            </p>
          </div>
        )}
      </span>
    </div>
  );
}

/* ================= states ================= */

export function Unreadable({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="mbx-note">
      {rows.map((r) => (
        <div key={`${r.provider}-${r.account}`}>
          <b>
            {r.account} ({providerLabel(r.provider)})
          </b>{" "}
          could not be read — {r.error} Everything below is from the mailboxes that answered.
        </div>
      ))}
    </div>
  );
}

export function NotConnected({ configured = {}, onConnect, busy }) {
  return (
    <div className="mbx-empty">
      <h3>No mailbox yet</h3>
      <p>
        Connect Gmail or Outlook and this reads both at once, newest first, with the mailbox each
        message landed in on its own row. Replies quote the original and go out from the address you
        pick — and nothing is sent until the exact message has been on screen.
      </p>
      <div className="mbx-connect">
        {SERVICES.map((s) =>
          configured[s.id] === false ? (
            <span className="mbx-unset" key={s.id}>
              {s.label} is not set up on this deployment. It needs{" "}
              {(configured[`${s.id}Missing`] || []).map((e, i) => (
                <React.Fragment key={e}>
                  {i ? " and " : ""}
                  <code>{e}</code>
                </React.Fragment>
              ))}
              .
            </span>
          ) : (
            <button
              type="button"
              className="admin-primary"
              key={s.id}
              onClick={() => onConnect(s.id)}
              disabled={busy}
            >
              Connect {s.label}
            </button>
          )
        )}
      </div>
    </div>
  );
}

/* ================= the panel ================= */

const blank = { to: "", cc: "", bcc: "", subject: "", body: "" };

export default function MailPanel() {
  const [accounts, setAccounts] = useState([]);
  // Which of the two services this deployment could connect at all. A service
  // with no OAuth client is not a disabled button -- it is a dashed note
  // naming the variables it wants, because there is nothing there to press.
  const [configured, setConfigured] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [lens, setLens] = useState({ account: "all", unreadOnly: false });
  const [query, setQuery] = useState("");
  const [stream, setStream] = useState({ messages: [], unreadable: [] });

  const [open, setOpen] = useState(null); // the message being read, in full
  const [mode, setMode] = useState("read"); // read | new | reply
  const [draft, setDraft] = useState(blank);
  const [from, setFrom] = useState("");
  const [reviewed, setReviewed] = useState(null);
  const [sent, setSent] = useState("");
  // Per message, and deliberately NOT remembered. "Load remote images" is a
  // decision about one sender, and a sticky setting quietly turns it into a
  // decision about all of them.
  const [showImages, setShowImages] = useState(false);

  const sender = useMemo(() => accounts.find((a) => keyOf(a) === from) || accounts[0], [accounts, from]);

  const load = useCallback(async () => {
    setErr("");
    try {
      const { accounts: list } = await mailAccounts();
      setAccounts(list);
      if (list.length && !from) setFrom(keyOf(list[0]));
      if (list.length) {
        const live = list.filter((a) => !a.needsReconnect);
        const out =
          lens.account === "all"
            ? await readEveryMailbox({ max: 25, query })
            : await (async () => {
                const a = list.find((x) => keyOf(x) === lens.account) || live[0];
                const r = await readMailbox(a.provider, a.accountId, { max: 50, query });
                return {
                  messages: (r.messages || []).map((m) => ({ ...m, account: r.account, accountId: a.accountId })),
                  unreadable: [],
                };
              })();
        setStream({ messages: out.messages || [], unreadable: out.unreadable || [] });
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoaded(true);
    }
  }, [lens.account, query, from]);

  useEffect(() => {
    // A consent that fully succeeded must leave a row, or the panel still says
    // "not connected" after it worked — the fault the GA and LinkedIn panels
    // both had, and the same one-line fix.
    (async () => {
      const q = new URLSearchParams(window.location.search);
      const back = q.get("connected");
      // Held rather than written straight to `err`, because load() clears err
      // on its way in -- so a consent that succeeded at Google and then failed
      // to be claimed here reported NOTHING, and the panel simply came back
      // with the mailbox missing. That is the worst shape a connection bug can
      // take: it looks like the provider refused.
      let claimFailed = "";
      if (back === "gmail" || back === "outlook") {
        try {
          await finishConnect(back);
        } catch (e) {
          claimFailed = e.message;
        }
        q.delete("connected");
        // `tab` is rewritten below, so leaving the old one in `rest` produced
        // ?tab=mail&tab=mail — harmless, and exactly the kind of thing that
        // makes a URL look broken when somebody reads it over your shoulder.
        q.delete("tab");
        const rest = q.toString();
        window.history.replaceState({}, "", `/admin?tab=mail${rest ? `&${rest}` : ""}`);
      }
      // Asked ONCE, not per refresh: it changes when a deployment variable
      // changes, not when mail arrives. The Add menu needs it whether or not
      // anything is connected, so it cannot hang off the empty state.
      mailServicesConfigured()
        .then(setConfigured)
        .catch(() => {});
      await load();
      if (claimFailed) {
        setErr(
          `${providerLabel(back)} approved the connection, but this page could not store it: ${claimFailed} Press Add a mailbox and try again.`
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loaded) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens.account]);

  const shown = useMemo(
    () => (lens.unreadOnly ? stream.messages.filter((m) => m.unread) : stream.messages),
    [stream.messages, lens.unreadOnly]
  );
  const unread = stream.messages.filter((m) => m.unread).length;

  async function openMessage(m) {
    setMode("read");
    setSent("");
    setShowImages(false);
    setOpen(m); // show what the stream already knows, then fill in the body
    try {
      const full = await getMessage(m.provider, m.accountId, m.id);
      setOpen({ ...m, ...full, account: m.account, accountId: m.accountId });
      if (m.unread) {
        await updateMessage(m.provider, m.accountId, m.id, "read").catch(() => {});
        setStream((s) => ({
          ...s,
          messages: s.messages.map((x) => (x.id === m.id ? { ...x, unread: false } : x)),
        }));
      }
    } catch (e) {
      setErr(e.message);
    }
  }

  async function act(change) {
    setBusy(true);
    try {
      await updateMessage(open.provider, open.accountId, open.id, change);
      if (change === "read" || change === "unread") {
        const u = change === "unread";
        setOpen((o) => ({ ...o, unread: u }));
        setStream((s) => ({
          ...s,
          messages: s.messages.map((x) => (x.id === open.id ? { ...x, unread: u } : x)),
        }));
      } else {
        setStream((s) => ({ ...s, messages: s.messages.filter((x) => x.id !== open.id) }));
        setOpen(null);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Consent happens on the provider's own screen in front of the person whose
  // account it is -- which is also why no MCP tool can do this.
  const addMailbox = (provider) =>
    connectProvider(provider, "mail").catch((e) => setErr(e.message));

  async function makeDefault(a) {
    setBusy(true);
    setErr("");
    try {
      await setDefaultAccount("mail", keyOf(a));
      setAccounts((xs) => xs.map((x) => ({ ...x, isDefault: keyOf(x) === keyOf(a) })));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function dropMailbox(a) {
    // Disconnecting removes a stored credential and nothing else -- no mail is
    // touched, and reconnecting restores it -- so this asks rather than
    // demanding a typed confirmation.
    if (!window.confirm(`Disconnect ${a.account}? Mail in that account is untouched, and you can connect it again at any time.`)) {
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await forgetAccount(a.provider, a.accountId);
      if (lens.account === keyOf(a)) setLens({ ...lens, account: "all" });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const edit = (d) => {
    setDraft(d);
    setReviewed(null); // seeing it is what makes the button exist; changing it takes it away
  };

  async function review() {
    setBusy(true);
    setErr("");
    try {
      const out =
        mode === "reply"
          ? await replyToMail({
              provider: open.provider,
              accountId: open.accountId,
              messageId: open.id,
              body: draft.body,
              dryRun: true,
            })
          : await sendMail({
              provider: sender?.provider,
              accountId: sender?.accountId,
              to: draft.to,
              cc: draft.cc || undefined,
              bcc: draft.bcc || undefined,
              subject: draft.subject,
              body: draft.body,
              dryRun: true,
            });
      setReviewed(out);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reallySend() {
    setBusy(true);
    setErr("");
    try {
      if (mode === "reply") {
        const r = await replyToMail({
          provider: open.provider,
          accountId: open.accountId,
          messageId: open.id,
          body: draft.body,
        });
        setSent(`Replied to ${r.to} as ${r.sentAs}.`);
      } else {
        const r = await sendMail({
          provider: sender?.provider,
          accountId: sender?.accountId,
          to: draft.to,
          cc: draft.cc || undefined,
          bcc: draft.bcc || undefined,
          subject: draft.subject,
          body: draft.body,
        });
        setSent(`Sent to ${(r.to || []).join(", ")} as ${r.sentAs}.`);
      }
      setDraft(blank);
      setReviewed(null);
      setMode("read");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const live = accounts.filter((a) => !a.needsReconnect);

  if (loaded && !accounts.length) {
    return (
      <div className="mbx-panel">
        <MailStyles />
        {err && <p className="admin-err">{err}</p>}
        <div className="mbx-desk">
          <NotConnected
            configured={configured}
            busy={busy}
            onConnect={(p) => connectProvider(p, "mail").catch((e) => setErr(e.message))}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mbx-panel">
      <MailStyles />

      <div className="mbx-head">
        <Headline
          unread={unread}
          counted={stream.messages.length}
          mailboxes={accounts.length}
          loading={!loaded}
        />
      </div>

      <Mailboxes
        accounts={accounts}
        configured={configured}
        selected={lens.account}
        busy={busy}
        onSelect={(k) => setLens({ ...lens, account: k })}
        onAdd={addMailbox}
        onMakeDefault={makeDefault}
        onDisconnect={dropMailbox}
      />

      <div className="mbx-lens">
        <button
          type="button"
          className={`mbx-chip${lens.unreadOnly ? " on" : ""}`}
          onClick={() => setLens({ ...lens, unreadOnly: !lens.unreadOnly })}
        >
          Unread <em>{unread}</em>
        </button>
        <input
          className="admin-input mbx-find"
          placeholder={
            live[0]?.provider === "outlook" ? "Search — plain words" : "Search — from:ada, is:unread, has:attachment"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button type="button" className="admin-ghost" onClick={load} disabled={busy}>
          Refresh
        </button>
        <button
          type="button"
          className="admin-primary"
          onClick={() => {
            setMode("new");
            setOpen(null);
            setDraft(blank);
            setReviewed(null);
            setSent("");
          }}
        >
          Write a message
        </button>
      </div>

      {err && <p className="admin-err">{err}</p>}
      {sent && <p className="mbx-done">{sent}</p>}
      <Unreadable rows={stream.unreadable} />

      <div className={`mbx-wrap${open || mode === "new" ? " mbx-reading" : ""}`}>
        <div className="mbx-stream">
          {!loaded ? (
            <div className="mbx-empty">
              <h3>Reading…</h3>
              <p>This takes a moment on the first load of each mailbox.</p>
            </div>
          ) : !shown.length ? (
            <div className="mbx-empty">
              <h3>{lens.unreadOnly ? "Nothing unread" : query ? "No match" : "Nothing here"}</h3>
              <p>
                {lens.unreadOnly
                  ? "Everything fetched has been read."
                  : query
                  ? "Try fewer words, or clear the search to see the whole stream."
                  : "This mailbox answered with no messages."}
              </p>
            </div>
          ) : (
            shown.map((m) => (
              <Row key={`${m.provider}-${m.id}`} m={m} open={open?.id === m.id} onOpen={openMessage} />
            ))
          )}
        </div>

        <div className="mbx-desk">
          {mode === "new" ? (
            <>
              <h3 className="mbx-subject">New message</h3>
              <Composer accounts={accounts} from={from} setFrom={setFrom} draft={draft} setDraft={edit}>
                <Outbound
                  from={sender?.account || ""}
                  reviewed={reviewed}
                  busy={busy}
                  onReview={review}
                  onSend={reallySend}
                  onEdit={() => setReviewed(null)}
                />
              </Composer>
            </>
          ) : mode === "reply" && open ? (
            <>
              <button type="button" className="admin-ghost" onClick={() => setMode("read")}>
                Back to the message
              </button>
              <h3 className="mbx-subject">Reply to {senderName(open)}</h3>
              <div className="mbx-meta">
                <span>in the thread</span>
                <span className="mbx-addr">{open.subject}</span>
              </div>
              <div className="mbx-form" style={{ marginTop: 12 }}>
                <div className="mbx-field">
                  <label htmlFor="mbx-reply">Your reply</label>
                  <textarea
                    id="mbx-reply"
                    className="admin-input mbx-write"
                    value={draft.body || ""}
                    onChange={(e) => edit({ ...draft, body: e.target.value })}
                  />
                  <p className="mbx-scope" style={{ marginTop: 4 }}>
                    The message you are answering is quoted beneath this.
                  </p>
                </div>
                <Outbound
                  from={open.account || ""}
                  reviewed={reviewed}
                  busy={busy}
                  label="Reply"
                  onReview={review}
                  onSend={reallySend}
                  onEdit={() => setReviewed(null)}
                />
              </div>
            </>
          ) : open ? (
            <Reader
              message={open}
              busy={busy}
              allowRemote={showImages}
              onShowImages={() => setShowImages(true)}
              onBack={() => setOpen(null)}
              onAct={act}
              onReply={() => {
                setMode("reply");
                setDraft(blank);
                setReviewed(null);
              }}
            />
          ) : (
            <div className="mbx-empty">
              <h3>Pick a message</h3>
              <p>
                Reading one marks it read and shows the whole body. Replies stay in the thread and go
                out from the mailbox the message arrived in.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
