import React, { useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { Send, ShieldCheck, CheckCircle2, AlertCircle, Lock } from "lucide-react";
import { db } from "../../../lib/firebase";

// Mail — a focused compose window in raviOS. One job: write a message that lands
// in Ravi's inbox. The recipient is fixed (you're always writing to Ravi), so the
// UI reads like a real mail client header: To / From / Subject / body. Saved to
// Firestore `mail`; surfaced in the admin Inbox.
const TO_NAME = "Ravi Kishan";
const TO_EMAIL = "ravikishan63392@gmail.com";
const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export default function Mail() {
  const [f, setF] = useState({ name: "", email: "", subject: "", body: "" });
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const ready =
    f.name.trim() && validEmail(f.email) && f.subject.trim() && f.body.trim();

  const send = async (e) => {
    e.preventDefault();
    if (!ready || status === "sending") return;
    setStatus("sending");
    try {
      await addDoc(collection(db, "mail"), {
        name: f.name.trim(),
        email: f.email.trim(),
        subject: f.subject.trim(),
        message: f.body.trim(),
        to: TO_EMAIL,
        read: false,
        ts: serverTimestamp(),
        date: new Date().toLocaleString(),
      });
      setStatus("sent");
    } catch (_) {
      setStatus("error");
    }
  };

  const reset = () => { setF({ name: "", email: "", subject: "", body: "" }); setStatus("idle"); };

  if (status === "sent") {
    return (
      <div className="ml">
        <div className="ml-done">
          <span className="ml-seal"><CheckCircle2 size={30} strokeWidth={2.2} /></span>
          <h2>Message delivered</h2>
          <p>It&apos;s in {TO_NAME.split(" ")[0]}&apos;s inbox. Expect a reply at <b>{f.email.trim()}</b>.</p>
          <button className="ml-again" onClick={reset}>Write another</button>
        </div>
        <StyleTag />
      </div>
    );
  }

  return (
    <form className="ml" onSubmit={send}>
      {/* header */}
      <div className="ml-top">
        <div className="ml-top-l">
          <span className="ml-ic"><Send size={15} strokeWidth={2.3} /></span>
          <div>
            <div className="ml-title">New message</div>
            <div className="ml-sub">Goes straight to my inbox — no forms lost to the void.</div>
          </div>
        </div>
      </div>

      {/* recipient (locked) */}
      <div className="ml-hrow ml-to">
        <span className="ml-lbl">To</span>
        <div className="ml-chip">
          <img src="/assets/banner-image.png" alt="" aria-hidden="true" />
          <div className="ml-chip-tx">
            <b>{TO_NAME}</b>
            <em>{TO_EMAIL}</em>
          </div>
          <span className="ml-chip-lock" title="Locked recipient"><Lock size={12} strokeWidth={2.4} /></span>
        </div>
      </div>

      {/* sender */}
      <div className="ml-hrow ml-split">
        <span className="ml-lbl">From</span>
        <input className="ml-in" value={f.name} onChange={set("name")} placeholder="Your name" aria-label="Your name" required />
        <input
          className={`ml-in${f.email && !validEmail(f.email) ? " bad" : ""}`}
          type="email" value={f.email} onChange={set("email")}
          placeholder="you@company.com" aria-label="Your email" required
        />
      </div>

      {/* subject */}
      <div className="ml-hrow">
        <span className="ml-lbl">Re</span>
        <input className="ml-in ml-subj" value={f.subject} onChange={set("subject")} placeholder="What's this about?" aria-label="Subject" required />
      </div>

      {/* body */}
      <textarea
        className="ml-body"
        value={f.body}
        onChange={set("body")}
        placeholder={`Hi Ravi,\n\n`}
        aria-label="Message"
        required
      />

      {/* footer */}
      <div className="ml-foot">
        <span className="ml-secure"><ShieldCheck size={13} strokeWidth={2.2} /> Sent over an encrypted connection</span>
        <div className="ml-foot-r">
          {status === "error" && (
            <span className="ml-err"><AlertCircle size={13} strokeWidth={2.3} /> Didn&apos;t send — check your connection.</span>
          )}
          <span className="ml-count">{f.body.length}</span>
          <button type="submit" className="ml-send" disabled={!ready || status === "sending"}>
            <Send size={14} strokeWidth={2.4} />
            {status === "sending" ? "Sending…" : "Send message"}
          </button>
        </div>
      </div>

      <StyleTag />
    </form>
  );
}

function StyleTag() {
  return (
    <style jsx global>{`
      .ml {
        height: 100%; display: flex; flex-direction: column;
        background: var(--c-bg); color: var(--c-fg); font-family: "Inter", sans-serif;
      }
      .ml-top { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 14px; }
      .ml-top-l { display: flex; align-items: center; gap: 12px; }
      .ml-ic {
        display: grid; place-items: center; height: 34px; width: 34px; border-radius: 10px; flex-shrink: 0;
        color: var(--c-accentFg, #0a0b0f); background: var(--c-accent);
        box-shadow: 0 4px 12px color-mix(in srgb, var(--c-accent) 35%, transparent);
      }
      .ml-title { font-family: "Space Grotesk", sans-serif; font-size: 17px; font-weight: 700; letter-spacing: -.01em; color: var(--c-fg); }
      .ml-sub { margin-top: 1px; font-size: 12px; color: var(--c-muted); }

      /* mail-header rows */
      .ml-hrow { display: flex; align-items: center; gap: 12px; padding: 0 18px; border-top: 1px solid var(--c-edge); min-height: 46px; }
      .ml-lbl {
        flex-shrink: 0; width: 34px; font-family: "JetBrains Mono", monospace; font-size: 11px;
        letter-spacing: .1em; text-transform: uppercase; color: var(--c-muted);
      }
      .ml-split .ml-in { flex: 1; min-width: 0; }
      .ml-in {
        flex: 1; min-width: 0; background: none; border: none; outline: none;
        color: var(--c-fg); font-size: 14px; font-family: "Inter", sans-serif; padding: 12px 0;
      }
      .ml-in::placeholder { color: color-mix(in srgb, var(--c-muted) 75%, transparent); }
      .ml-in.bad { color: #f0776b; }
      .ml-subj { font-weight: 600; }

      /* locked recipient chip */
      .ml-to { padding-top: 4px; padding-bottom: 4px; }
      .ml-chip {
        display: inline-flex; align-items: center; gap: 10px; margin: 7px 0;
        padding: 6px 12px 6px 6px; border-radius: 999px;
        background: var(--c-surface); border: 1px solid var(--c-edge);
      }
      .ml-chip img { height: 28px; width: 28px; border-radius: 50%; object-fit: cover; object-position: 52% 12%; flex-shrink: 0; }
      .ml-chip-tx { display: flex; flex-direction: column; line-height: 1.15; }
      .ml-chip-tx b { font-size: 12.5px; font-weight: 600; color: var(--c-fg); }
      .ml-chip-tx em { font-style: normal; font-family: "JetBrains Mono", monospace; font-size: 10.5px; color: var(--c-muted); }
      .ml-chip-lock { display: grid; place-items: center; margin-left: 2px; color: var(--c-accentText, var(--c-accent)); }

      /* body */
      .ml-body {
        flex: 1; min-height: 0; resize: none; border: none; outline: none;
        border-top: 1px solid var(--c-edge);
        padding: 16px 18px; background: none; color: var(--c-fg);
        font-family: "Inter", sans-serif; font-size: 14.5px; line-height: 1.65;
      }
      .ml-body::placeholder { color: color-mix(in srgb, var(--c-muted) 70%, transparent); }

      /* footer */
      .ml-foot {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 12px 18px; border-top: 1px solid var(--c-edge); background: var(--c-surface);
      }
      .ml-secure { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--c-muted); }
      .ml-secure :global(svg) { color: var(--c-live, #4ED0C0); }
      .ml-foot-r { display: flex; align-items: center; gap: 12px; }
      .ml-err { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: #f0776b; }
      .ml-count { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--c-muted); opacity: .8; font-variant-numeric: tabular-nums; }
      .ml-send {
        display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
        background: var(--c-accent); color: var(--c-accentFg, #0a0b0f); border: none;
        border-radius: 9px; padding: 9px 16px; font-size: 13px; font-weight: 700; font-family: "Inter", sans-serif;
        transition: transform .12s, filter .12s, opacity .12s;
      }
      .ml-send:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); }
      .ml-send:disabled { opacity: .45; cursor: not-allowed; }
      .ml-send:focus-visible { outline: 2px solid var(--c-accentText, var(--c-accent)); outline-offset: 2px; }

      /* delivered state */
      .ml-done { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 32px; text-align: center; }
      .ml-seal {
        display: grid; place-items: center; height: 62px; width: 62px; border-radius: 50%; margin-bottom: 6px;
        color: var(--c-live, #4ED0C0);
        background: color-mix(in srgb, var(--c-live, #4ED0C0) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--c-live, #4ED0C0) 40%, transparent);
        animation: ml-pop .4s cubic-bezier(.2,1.4,.4,1);
      }
      @keyframes ml-pop { from { transform: scale(.6); opacity: 0; } }
      .ml-done h2 { font-family: "Space Grotesk", sans-serif; font-size: 20px; font-weight: 700; color: var(--c-fg); }
      .ml-done p { max-width: 34ch; font-size: 13.5px; line-height: 1.6; color: var(--c-muted); }
      .ml-done p b { color: var(--c-fg); font-family: "JetBrains Mono", monospace; font-size: 12.5px; }
      .ml-again {
        margin-top: 10px; cursor: pointer; background: none; color: var(--c-fg);
        border: 1px solid var(--c-edge); border-radius: 9px; padding: 9px 16px; font-size: 13px; font-weight: 600;
        transition: border-color .12s;
      }
      .ml-again:hover { border-color: var(--c-accent); }

      @media (prefers-reduced-motion: reduce) { .ml-seal { animation: none; } }
    `}</style>
  );
}
