import React, { useEffect, useMemo, useRef, useState } from "react";
import { Send, LogOut, WifiOff } from "lucide-react";
import { collection, addDoc, onSnapshot, query, orderBy, limit, serverTimestamp } from "firebase/firestore";
import { db } from "../../../lib/firebase";

// The Lobby — a public chat room saved to Firestore. Set a handle, drop a
// message, watch the room live. Every handle gets a generated identity (gradient
// orb + a stable-but-random title); SUDO, the house bot, heckles locally.
const TITLES = [
  "certified vibe engineer", "professional lurker", "touches grass occasionally",
  "senior nap architect", "chief overthinking officer", "part-time genius",
  "bug whisperer", "ctrl+z enthusiast", "compiles on the first try (allegedly)",
  "here for the free wifi", "recovering perfectionist", "stack-overflow archaeologist",
  "keyboard warrior (literal)", "escaped the tutorial", "loves semicolons; too much",
];
const QUICK = ["👋", "🔥", "gm", "hire this dev", "lgtm"];
const LS_NAME = "chat:name", LS_TITLE = "chat:title";

const hashN = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const hueOf = (s) => hashN(s) % 360;
const titleFor = (s) => TITLES[hashN(s + "_t") % TITLES.length];
const initials = (s) => s.trim().slice(0, 2).toUpperCase() || "??";
const clock = (ms) => {
  if (!ms) return "…";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// SUDO heckles — local only, never saved. Trigger → canned reply.
const BOT = [
  { re: /\b(hi|hello|hey|gm|yo)\b/i, say: "oh look, a wild human. welcome to the lobby 👋" },
  { re: /\b(hire|job|recruit|offer)\b/i, say: "smart. the résumé's one window over. i'll put in a good word." },
  { re: /\b(sudo|admin|root)\b/i, say: "nice try. you don't have permission for that. 🔒" },
  { re: /\b(grass|touch grass)\b/i, say: "no, YOU touch grass. i'm a daemon, i can't." },
  { re: /\b(love|awesome|cool|nice|great)\b/i, say: "flattery logged. +1 karma (karma is fake)." },
  { re: /\?\s*$/, say: "great question. i'm a bot though, so… have you tried turning it off and on again?" },
];

function Avatar({ name, hue, bot }) {
  return (
    <span
      className={`ch-av${bot ? " bot" : ""}`}
      style={bot ? undefined : { background: `linear-gradient(140deg, hsl(${hue} 72% 58%), hsl(${(hue + 45) % 360} 72% 46%))` }}
      aria-hidden="true"
    >
      {bot ? ">_" : initials(name)}
    </span>
  );
}

export default function Chat() {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [draftName, setDraftName] = useState("");
  const [msgs, setMsgs] = useState([]);          // from firestore
  const [bots, setBots] = useState([]);          // local SUDO lines
  const [text, setText] = useState("");
  const [status, setStatus] = useState("loading"); // loading | ok | offline
  const [gate, setGate] = useState(true);
  const bodyRef = useRef(null);
  const botId = useRef(0);

  // always open on the name gate; prefill the last handle for convenience
  useEffect(() => {
    try {
      const n = localStorage.getItem(LS_NAME);
      if (n) setDraftName(n);
    } catch (_) {}
  }, []);

  // live subscription
  useEffect(() => {
    const q = query(collection(db, "chat"), orderBy("ts", "desc"), limit(80));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr = snap.docs.map((d) => {
          const v = d.data();
          return { id: d.id, ...v, _t: v.ts?.toMillis ? v.ts.toMillis() : Date.now() };
        }).reverse();
        setMsgs(arr);
        setStatus("ok");
      },
      () => setStatus("offline")
    );
    return () => unsub();
  }, []);

  const feed = useMemo(
    () => [...msgs, ...bots].sort((a, b) => a._t - b._t),
    [msgs, bots]
  );

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [feed.length, gate]);

  const enter = (e) => {
    e.preventDefault();
    const n = draftName.trim().slice(0, 24);
    if (!n) return;
    const t = titleFor(n);
    setName(n); setTitle(t); setGate(false);
    try { localStorage.setItem(LS_NAME, n); localStorage.setItem(LS_TITLE, t); } catch (_) {}
  };

  const heckle = (msg) => {
    const hit = BOT.find((b) => b.re.test(msg));
    if (!hit) return;
    const id = "bot-" + ++botId.current;
    setTimeout(() => {
      setBots((b) => [...b, { id, name: "SUDO", title: "the house bot", bot: true, hue: 38, text: hit.say, _t: Date.now() }]);
    }, 650);
  };

  const send = async (raw) => {
    const t = (raw ?? text).trim().slice(0, 500);
    if (!t || !name) return;
    setText("");
    try {
      await addDoc(collection(db, "chat"), { name, title, hue: hueOf(name), text: t, ts: serverTimestamp() });
      heckle(t);
    } catch (_) {
      setStatus("offline");
    }
  };

  /* ---------- name gate ---------- */
  if (gate) {
    return (
      <div className="ch-gate">
        <div className="ch-gate-orb" />
        <p className="ch-gate-eyebrow">The Lobby · public chat</p>
        <h1 className="ch-gate-title">who goes there?</h1>
        <p className="ch-gate-sub">Pick a handle. It sticks to a color and a title you don&apos;t get to choose.</p>
        <form className="ch-gate-form" onSubmit={enter}>
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            maxLength={24}
            placeholder="anon_coder, grass_toucher…"
            aria-label="Your handle"
          />
          <button type="submit" disabled={!draftName.trim()}>Enter the lobby →</button>
        </form>
        {draftName.trim() && (
          <p className="ch-gate-preview">
            you&apos;ll be <b style={{ color: `hsl(${hueOf(draftName.trim())} 70% 60%)` }}>{draftName.trim().slice(0, 24)}</b>
            {" · "}<em>{titleFor(draftName.trim())}</em>
          </p>
        )}
        <StyleTag />
      </div>
    );
  }

  /* ---------- chat ---------- */
  return (
    <div className="ch">
      <header className="ch-head">
        <span className="ch-room"># the-lobby</span>
        <span className={`ch-status ch-${status}`}>
          {status === "offline" ? <><WifiOff className="h-3 w-3" /> can&apos;t reach the lobby</>
            : status === "loading" ? "connecting…"
            : `${new Set(msgs.map((m) => m.name)).size || 1} here · live`}
        </span>
        <button className="ch-me" onClick={() => setGate(true)} title="Change handle">
          <Avatar name={name} hue={hueOf(name)} />
          <span className="ch-me-tx"><b>{name}</b><em>{title}</em></span>
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="ch-body" ref={bodyRef}>
        {status === "ok" && feed.length === 0 && (
          <div className="ch-empty">
            <p className="ch-empty-1">It&apos;s quiet in here. Suspiciously quiet.</p>
            <p className="ch-empty-2">Be the first to say something you&apos;ll regret.</p>
          </div>
        )}
        {feed.map((m) => {
          const mine = !m.bot && m.name === name;
          return (
            <div key={m.id} className={`ch-row${mine ? " mine" : ""}`}>
              {!mine && <Avatar name={m.name} hue={m.hue ?? hueOf(m.name || "?")} bot={m.bot} />}
              <div className="ch-bub-wrap">
                {!mine && (
                  <div className="ch-meta">
                    <b style={m.bot ? { color: "#FFB020" } : { color: `hsl(${m.hue ?? hueOf(m.name || "?")} 65% 62%)` }}>{m.name}</b>
                    <em>{m.title}</em>
                    <span>{clock(m._t)}</span>
                  </div>
                )}
                <div className={`ch-bub${m.bot ? " bot" : ""}`}>{m.text}</div>
                {mine && <span className="ch-mine-time">{clock(m._t)}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ch-quick">
        {QUICK.map((q) => (
          <button key={q} onClick={() => send(q)}>{q}</button>
        ))}
      </div>

      <form className="ch-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="say something clever (or don't)"
          aria-label="Message"
        />
        <button type="submit" disabled={!text.trim()} aria-label="Send"><Send className="h-4 w-4" /></button>
      </form>

      <StyleTag />
    </div>
  );
}

/* ---------- styles (shared by gate + chat; global so both returns match) ---------- */
function StyleTag() {
  return (
    <style jsx global>{`
      .ch, .ch-gate { height: 100%; display: flex; flex-direction: column; background: var(--c-bg); color: var(--c-fg); font-family: "Inter", sans-serif; }

      /* name gate */
      .ch-gate { align-items: center; justify-content: center; text-align: center; padding: 32px; position: relative; overflow: hidden; }
      .ch-gate-orb { position: absolute; top: -80px; width: 260px; height: 260px; border-radius: 50%; filter: blur(60px); opacity: .5; background: radial-gradient(circle, #FFB020, transparent 70%); }
      .ch-gate-eyebrow { position: relative; font-family: "JetBrains Mono", monospace; font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: var(--c-accentText, var(--c-accent)); }
      .ch-gate-title { position: relative; margin-top: 8px; font-family: "Space Grotesk", sans-serif; font-size: 34px; font-weight: 700; letter-spacing: -.02em; }
      .ch-gate-sub { position: relative; margin-top: 8px; max-width: 34ch; font-size: 13.5px; line-height: 1.6; color: var(--c-muted); }
      .ch-gate-form { position: relative; margin-top: 22px; display: flex; gap: 8px; width: 100%; max-width: 380px; }
      .ch-gate-form input { flex: 1; min-width: 0; background: var(--c-surface); border: 1px solid var(--c-edge); border-radius: 10px; padding: 12px 14px; color: var(--c-fg); font-size: 14px; font-family: "JetBrains Mono", monospace; outline: none; }
      .ch-gate-form input:focus { border-color: var(--c-accent); }
      .ch-gate-form button { flex-shrink: 0; background: var(--c-accent); color: var(--c-accentFg, #0a0b0f); border: none; border-radius: 10px; padding: 0 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
      .ch-gate-form button:disabled { opacity: .4; cursor: not-allowed; }
      .ch-gate-preview { position: relative; margin-top: 14px; font-family: "JetBrains Mono", monospace; font-size: 12px; color: var(--c-muted); }
      .ch-gate-preview em { font-style: normal; color: var(--c-fg); }

      /* header */
      .ch-head { display: flex; align-items: center; gap: 12px; flex-shrink: 0; padding: 12px 16px; border-bottom: 1px solid var(--c-edge); background: var(--c-surface); }
      .ch-room { font-family: "JetBrains Mono", monospace; font-size: 14px; font-weight: 700; color: var(--c-fg); }
      .ch-status { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--c-muted); display: inline-flex; align-items: center; gap: 5px; }
      .ch-status.ch-ok { color: var(--c-live, #4ED0C0); }
      .ch-status.ch-offline { color: #ff6b6b; }
      .ch-me { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; background: var(--c-bg); border: 1px solid var(--c-edge); border-radius: 999px; padding: 4px 10px 4px 4px; cursor: pointer; color: var(--c-muted); transition: border-color .12s; }
      .ch-me:hover { border-color: var(--c-accent); }
      .ch-me-tx { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.1; }
      .ch-me-tx b { font-size: 12px; color: var(--c-fg); font-family: "JetBrains Mono", monospace; }
      .ch-me-tx em { font-style: normal; font-size: 9px; color: var(--c-muted); }

      /* avatar */
      .ch-av { display: grid; place-items: center; height: 32px; width: 32px; flex-shrink: 0; border-radius: 10px; color: #fff; font-family: "JetBrains Mono", monospace; font-size: 11px; font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,.3); }
      .ch-av.bot { background: repeating-linear-gradient(45deg, #1c1f29, #1c1f29 4px, #23262f 4px, #23262f 8px); color: #FFB020; border: 1px solid #FFB020; }

      /* body */
      .ch-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
      .ch-empty { margin: auto; text-align: center; }
      .ch-empty-1 { font-family: "Space Grotesk", sans-serif; font-size: 17px; font-weight: 600; color: var(--c-fg); }
      .ch-empty-2 { margin-top: 4px; font-size: 13px; color: var(--c-muted); }
      .ch-row { display: flex; gap: 10px; align-items: flex-start; }
      .ch-row.mine { flex-direction: row-reverse; }
      .ch-bub-wrap { display: flex; flex-direction: column; max-width: 74%; }
      .ch-row.mine .ch-bub-wrap { align-items: flex-end; }
      .ch-meta { display: flex; align-items: baseline; gap: 7px; margin-bottom: 3px; }
      .ch-meta b { font-family: "JetBrains Mono", monospace; font-size: 12px; }
      .ch-meta em { font-style: normal; font-size: 10px; color: var(--c-muted); }
      .ch-meta span { font-family: "JetBrains Mono", monospace; font-size: 9.5px; color: var(--c-muted); opacity: .7; }
      .ch-bub { padding: 9px 13px; border-radius: 4px 14px 14px 14px; background: var(--c-surface); border: 1px solid var(--c-edge); font-size: 14px; line-height: 1.5; color: var(--c-fg); word-break: break-word; white-space: pre-wrap; }
      .ch-row.mine .ch-bub { border-radius: 14px 4px 14px 14px; background: var(--c-accent); color: var(--c-accentFg, #0a0b0f); border-color: transparent; font-weight: 500; }
      .ch-bub.bot { background: color-mix(in srgb, #FFB020 8%, var(--c-surface)); border-color: color-mix(in srgb, #FFB020 30%, var(--c-edge)); font-family: "JetBrains Mono", monospace; font-size: 13px; }
      .ch-mine-time { margin-top: 3px; font-family: "JetBrains Mono", monospace; font-size: 9.5px; color: var(--c-muted); opacity: .7; }

      /* quick + composer */
      .ch-quick { display: flex; gap: 6px; padding: 8px 16px 0; flex-wrap: wrap; }
      .ch-quick button { background: var(--c-surface); border: 1px solid var(--c-edge); border-radius: 999px; padding: 5px 12px; font-size: 12px; color: var(--c-muted); cursor: pointer; transition: color .12s, border-color .12s; }
      .ch-quick button:hover { color: var(--c-fg); border-color: var(--c-accent); }
      .ch-composer { display: flex; gap: 8px; padding: 12px 16px; flex-shrink: 0; }
      .ch-composer input { flex: 1; min-width: 0; background: var(--c-surface); border: 1px solid var(--c-edge); border-radius: 12px; padding: 11px 15px; color: var(--c-fg); font-size: 14px; outline: none; }
      .ch-composer input:focus { border-color: var(--c-accent); }
      .ch-composer button { display: grid; place-items: center; width: 44px; flex-shrink: 0; background: var(--c-accent); color: var(--c-accentFg, #0a0b0f); border: none; border-radius: 12px; cursor: pointer; }
      .ch-composer button:disabled { opacity: .4; cursor: not-allowed; }
    `}</style>
  );
}
