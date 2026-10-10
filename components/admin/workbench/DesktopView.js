// The desktop on the box, live.
//
// The agent's browser runs on this desktop, so when a chat clicks or types you
// watch it happen. It opens VIEW-ONLY: a stray tap on a phone must not click
// something on a machine that is in the middle of doing work. "Take control"
// is the one deliberate switch, and while you hold it the frame wears a solid
// amber edge and says so — the one loud thing on this view, because who is
// driving is the only question that matters here.
//
// Two ways to show it, chosen by asking the box first (desktop.status):
//
//   STREAM (the default, and the fallback)  a JPEG screenshot about once a
//     second, scaled to this pane, never two requests in flight, paused while
//     the tab is hidden. Driving sends DISCRETE actions (desktop.action):
//     a click on the picture is mapped back to screen pixels with the size the
//     box reports, plus typed text, a row of key combos, scroll and Open URL.
//     This is what runs on the real box: x11vnc cannot run there under
//     SELinux enforcing, and the owner chose not to weaken SELinux for it.
//
//   VNC (optional)  only when something is listening on 5901. noVNC over a
//     WebSocket opened with a one-time ticket minted over the authenticated
//     agent socket; if it fails or drops, the view falls back to the stream.
//
// Driving needs a sign-in from the last 30 minutes; a refusal for that reason
// offers the sign-in in place, then retries the action it refused.
//
// noVNC is loaded on demand, in the browser only: it touches window at import
// time and nobody who never opens this view should download it.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { reauthenticate } from "../../../lib/reauth";

const FRAME_MS = 1000;
const MAX_BACKOFF_MS = 10_000;

// The combos worth one tap. xdotool key names on the right.
export const KEYS = [
  ["Enter", "Return"],
  ["Esc", "Escape"],
  ["Tab", "Tab"],
  ["Backspace", "BackSpace"],
  ["Ctrl+L", "ctrl+l"],
  ["Ctrl+T", "ctrl+t"],
  ["Ctrl+W", "ctrl+w"],
  ["Ctrl+R", "ctrl+r"],
  ["Alt+Tab", "alt+Tab"],
];

const time = (at) => {
  try {
    return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch (_) {
    return "";
  }
};

// PURE. The scale to ask for: enough pixels for the pane (sharp on a 2x phone,
// capped there), in 0.05 steps so a resize by a pixel does not change it.
export function fitScale(paneWidth, screenWidth = 1600, dpr = 1) {
  if (!paneWidth || !screenWidth) return 0.5;
  const want = (paneWidth * Math.min(Math.max(dpr || 1, 1), 2)) / screenWidth;
  return Math.min(1, Math.max(0.25, Math.ceil(want * 20) / 20));
}

// PURE. A point on the shown picture → screen pixels, clamped to the screen.
export function toScreen({ clientX, clientY }, rect, screen) {
  if (!rect || !rect.width || !rect.height || !screen?.width || !screen?.height) return null;
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return null;
  return {
    x: Math.min(screen.width - 1, Math.max(0, Math.round(fx * screen.width))),
    y: Math.min(screen.height - 1, Math.max(0, Math.round(fy * screen.height))),
  };
}

// Coarse on purpose: this sits in a live region, and "3s old, 4s old, 5s old"
// read aloud every second is noise.
export function frameAge(ms) {
  if (ms == null) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 3) return "updated just now";
  if (s < 10) return "updated a few seconds ago";
  if (s < 60) return `last frame ${Math.floor(s / 10) * 10}s ago`;
  return `last frame ${Math.floor(s / 60)}m ago`;
}

const needsFreshSignIn = (e) =>
  !!e && (e.status === 401 || e.status === 403 || /recent sign|sign in again|sign-in from the last/i.test(String(e.message || "")));
const unknownMessage = (e) => /unknown message/i.test(String(e?.message || ""));

export function DesktopLog({ ops = [] }) {
  const rows = ops.filter((o) => o.kind === "desktop" || o.kind === "browser").slice(0, 60);
  return (
    <aside className="wb-dlog" aria-label="What was done on the desktop">
      <h4 className="wb-sgroup-h">
        On the desktop <span>{rows.length}</span>
      </h4>
      {!rows.length ? <p className="wb-empty">Nothing yet. Clicks, keys and page loads by anyone appear here as they happen.</p> : null}
      <ol className="wb-dlog-list" aria-live="polite" aria-relevant="additions">
        {rows.map((o, i) => (
          <li key={`${o.at}:${i}`} className={o.actor === "owner" ? "you" : "agent"}>
            <span className="wb-dlog-t">{time(o.at)}</span>
            <span className="wb-dlog-s">{o.summary}</span>
            <code className="wb-dlog-a">{o.actor === "owner" ? "you" : o.actor}</code>
          </li>
        ))}
      </ol>
    </aside>
  );
}

export default function DesktopView({ client = null, connected = false, ops = [], initialControl = false }) {
  const frame = useRef(null);
  const screen = useRef(null);
  const shotImg = useRef(null);
  const rfb = useRef(null);
  const [mode, setMode] = useState("off"); // off | probe | vnc | stream
  const [boxStatus, setBoxStatus] = useState(null);
  const [legacy, setLegacy] = useState(false);
  const [state, setState] = useState("idle"); // vnc: idle | connecting | live | failed
  const [why, setWhy] = useState("");
  const [control, setControl] = useState(!!initialControl);
  const [clip, setClip] = useState("");
  const [remoteClip, setRemoteClip] = useState("");
  const [sent, setSent] = useState("");

  // ---- stream state ----
  const [shot, setShot] = useState(null); // {src, width, height, receivedAt}
  const [streamErr, setStreamErr] = useState("");
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [typed, setTyped] = useState("");
  const [url, setUrl] = useState("");
  const [did, setDid] = useState("");
  const [actErr, setActErr] = useState("");
  const [stepUp, setStepUp] = useState(null); // the action a stale sign-in refused
  const loop = useRef({ timer: null, inflight: false, again: false, alive: false, fails: 0 });
  const screenSize = useRef({ width: 1600, height: 900 });
  const scaleRef = useRef(0.5);
  const lastPoint = useRef(null);
  const clickTimer = useRef(null);
  const queue = useRef(Promise.resolve());

  const stream = mode === "stream";
  const live = stream ? !!shot : mode === "vnc" && state === "live";
  const driving = control && live;

  /* ---------------- VNC (optional) ---------------- */
  const disconnect = () => {
    try {
      rfb.current?.disconnect();
    } catch (_) {}
    rfb.current = null;
  };

  const toStream = (reason) => {
    disconnect();
    setControl(false);
    setState("idle");
    setWhy(reason || "");
    setMode("stream");
  };

  const connectVnc = async () => {
    if (!client || !connected || rfb.current) return;
    setState("connecting");
    setWhy("");
    try {
      const ticket = await client.desktopTicket();
      const { default: RFB } = await import("@novnc/novnc/lib/rfb");
      if (!screen.current) return;
      const r = new RFB(screen.current, client.desktopUrl(ticket), { shared: true });
      r.viewOnly = true;
      r.scaleViewport = true;
      r.resizeSession = false;
      r.background = "#08090d";
      r.addEventListener("connect", () => setState("live"));
      r.addEventListener("disconnect", (e) => {
        rfb.current = null;
        setControl(false);
        if (e.detail?.clean) setState("idle");
        else toStream("The VNC connection dropped, so this is the screenshot stream instead.");
      });
      r.addEventListener("securityfailure", (e) => setWhy(e.detail?.reason || "The desktop refused the connection."));
      r.addEventListener("clipboard", (e) => setRemoteClip(String(e.detail?.text || "")));
      rfb.current = r;
    } catch (e) {
      rfb.current = null;
      toStream(`VNC is not available (${e.message}), so this is the screenshot stream instead.`);
    }
  };

  /* ---------------- which mode: ask the box ---------------- */
  useEffect(() => {
    if (!connected || !client) {
      setMode("off");
      return undefined;
    }
    let gone = false;
    setMode("probe");
    (async () => {
      let st = null;
      let old = false;
      try {
        st = await client.desktopStatus();
      } catch (e) {
        // An agentd from before the stream knows no desktop.status; it can
        // still show VNC the way it always did.
        old = unknownMessage(e);
        if (!old) setWhy(e.message);
      }
      if (gone) return;
      setLegacy(old);
      setBoxStatus(st);
      if (st?.screen?.width) screenSize.current = { width: st.screen.width, height: st.screen.height };
      setMode(old || st?.vnc === "up" ? "vnc" : "stream");
    })();
    return () => {
      gone = true;
    };
  }, [connected, client]);

  useEffect(() => {
    if (mode !== "vnc") return undefined;
    connectVnc();
    return disconnect;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /* ---------------- the stream ---------------- */
  const pull = useCallback(async () => {
    const st = loop.current;
    clearTimeout(st.timer);
    st.timer = null;
    if (!st.alive || !client) return;
    if (typeof document !== "undefined" && document.hidden) {
      setPaused(true);
      return;
    }
    if (st.inflight) {
      st.again = true;
      return;
    }
    st.inflight = true;
    const started = Date.now();
    let delay = FRAME_MS;
    try {
      const m = await client.desktopShot({ scale: scaleRef.current, quality: 70 });
      if (st.alive) {
        const data = m.data || m.png || "";
        if (!data) throw new Error("The box sent an empty frame.");
        const width = m.width || screenSize.current.width;
        const height = m.height || screenSize.current.height;
        screenSize.current = { width, height };
        setShot({ src: `data:${m.mime || "image/png"};base64,${data}`, width, height, receivedAt: Date.now() });
        setStreamErr("");
        st.fails = 0;
        delay = Math.max(0, FRAME_MS - (Date.now() - started));
      }
    } catch (e) {
      st.fails += 1;
      delay = Math.min(MAX_BACKOFF_MS, FRAME_MS * 2 ** st.fails);
      setStreamErr(unknownMessage(e) ? "This agentd cannot send screenshots. Update agentd on the box." : e.message);
    } finally {
      st.inflight = false;
      if (st.alive) {
        if (st.again) {
          st.again = false;
          delay = 0;
        }
        st.timer = setTimeout(pull, delay);
      }
    }
  }, [client]);

  // A fresh frame now (after an action), without a second request in flight.
  const kick = useCallback(() => {
    const st = loop.current;
    if (!st.alive) return;
    if (st.inflight) st.again = true;
    else pull();
  }, [pull]);

  useEffect(() => {
    if (mode !== "stream" || !connected || !client) return undefined;
    const st = loop.current;
    st.alive = true;
    st.fails = 0;
    pull();
    const onVis = () => {
      if (document.hidden) {
        setPaused(true);
        return;
      }
      setPaused(false);
      if (st.alive && !st.timer && !st.inflight) pull();
    };
    document.addEventListener("visibilitychange", onVis);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      st.alive = false;
      clearTimeout(st.timer);
      st.timer = null;
      clearInterval(tick);
      clearTimeout(clickTimer.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mode, connected, client, pull]);

  // Ask for as many pixels as the pane shows, no more.
  useEffect(() => {
    if (mode !== "stream" || !frame.current) return undefined;
    const measure = () => {
      const w = frame.current?.clientWidth || 0;
      scaleRef.current = fitScale(w, screenSize.current.width, typeof window !== "undefined" ? window.devicePixelRatio : 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(frame.current);
    return () => ro.disconnect();
  }, [mode]);

  /* ---------------- driving, one action at a time ---------------- */
  const act = (a) => {
    queue.current = queue.current.then(async () => {
      setActErr("");
      try {
        await client.desktopAction(a);
        setDid(describe(a));
        setStepUp(null);
        kick();
      } catch (e) {
        if (needsFreshSignIn(e)) setStepUp(a);
        else setActErr(unknownMessage(e) ? "This agentd cannot take actions from the panel yet. Update agentd on the box." : e.message);
      }
    });
    return queue.current;
  };

  const confirmAndRetry = async () => {
    const a = stepUp;
    try {
      await reauthenticate();
      await client.reauth();
      setStepUp(null);
      if (a) await act(a);
    } catch (e) {
      setActErr(`Not confirmed: ${e.message}`);
    }
  };

  const pointFrom = (e) => toScreen(e, shotImg.current?.getBoundingClientRect(), screenSize.current);

  // A double-click arrives as a click (detail 1) then a click (detail 2): the
  // first waits a moment, and the second replaces it with ONE double_click —
  // never two clicks and a double. Read from detail rather than dblclick,
  // which not every input path fires.
  const onShotClick = (e) => {
    if (!driving) return;
    const p = pointFrom(e);
    if (!p) return;
    lastPoint.current = p;
    clearTimeout(clickTimer.current);
    if (e.detail === 2) {
      act({ action: "double_click", ...p, button: "left" });
      return;
    }
    if (e.detail > 2) return;
    clickTimer.current = setTimeout(() => act({ action: "click", ...p, button: "left" }), 260);
  };
  const onShotContext = (e) => {
    if (!driving) return;
    e.preventDefault();
    const p = pointFrom(e);
    if (!p) return;
    lastPoint.current = p;
    act({ action: "click", ...p, button: "right" });
  };

  const sendText = (e) => {
    e.preventDefault();
    if (!typed) return;
    act({ action: "type", text: typed });
    setTyped("");
  };
  const openUrl = (e) => {
    e.preventDefault();
    const raw = url.trim();
    if (!raw) return;
    act({ action: "open_url", url: /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}` });
    setUrl("");
  };
  const scroll = (direction) => act({ action: "scroll", direction, amount: 5, ...(lastPoint.current || {}) });

  /* ---------------- shared controls ---------------- */
  const toggleControl = () => {
    const next = !control;
    setControl(next);
    setStepUp(null);
    setActErr("");
    if (mode === "vnc" && rfb.current) {
      rfb.current.viewOnly = !next;
      if (next) rfb.current.focus();
    }
  };

  const download = (href) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = `desktop-${Date.now()}.${/jpeg/.test(href.slice(0, 30)) ? "jpg" : "png"}`;
    a.click();
  };

  const screenshot = async () => {
    try {
      if (mode === "vnc" && rfb.current) return download(rfb.current.toDataURL("image/png"));
      // The full-size PNG, not the scaled frame on screen.
      const m = await client.desktopShot();
      download(`data:${m.mime || "image/png"};base64,${m.data || m.png}`);
    } catch (e) {
      setWhy(`Could not take a screenshot: ${e.message}`);
    }
  };

  const fullscreen = () => {
    const el = frame.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  };

  const sendClip = (e) => {
    e.preventDefault();
    if (!clip || !rfb.current) return;
    rfb.current.clipboardPasteFrom(clip);
    setSent(`Sent ${clip.length} character${clip.length === 1 ? "" : "s"} to the desktop clipboard.`);
    setClip("");
  };

  const displayDown = boxStatus?.display === "down";

  const word = !connected
    ? "Not connected to the agent server."
    : mode === "probe"
    ? "Checking the desktop…"
    : mode === "vnc" && state === "connecting"
    ? "Connecting to the desktop…"
    : mode === "vnc" && state !== "live"
    ? why || "Not showing the desktop."
    : stream && !shot
    ? streamErr || (displayDown ? "The desktop display is not running on the box. Start agentd-desktop." : "Loading the desktop…")
    : driving
    ? stream
      ? "You are driving. Clicks, keys and text go to the box."
      : "You are driving. Your clicks and keys reach the box."
    : stream
    ? "Watching. Nothing you do here reaches the box."
    : "Watching. Clicks and keys are not sent.";

  const how = !connected || mode === "off" || mode === "probe"
    ? ""
    : stream
    ? `Screenshot stream${boxStatus ? ` · VNC ${boxStatus.vnc === "up" ? "up" : "off"} · browser ${boxStatus.browser || "unknown"}` : ""}`
    : `VNC${legacy ? " (older agentd)" : ""}`;

  const age = stream && shot ? (paused ? "paused while this tab is hidden" : frameAge(now - shot.receivedAt)) : "";
  const stale = stream && shot && !paused && now - shot.receivedAt > 10_000;

  return (
    <div className="wb-desk">
      <div className="wb-desk-main">
        <div className="wb-desk-bar">
          <p className={`wb-drive${driving ? " on" : ""}`} role="status" aria-live="polite">
            {word}
          </p>
          <div className="wb-desk-btns">
            <button
              type="button"
              className={control ? "admin-primary wb-take" : "ag-ghost wb-take"}
              aria-pressed={control}
              disabled={!live}
              onClick={toggleControl}
            >
              {control ? "Hand back" : "Take control"}
            </button>
            <button type="button" className="ag-ghost" disabled={!live} onClick={screenshot}>
              Screenshot
            </button>
            <button type="button" className="ag-ghost" disabled={!live} onClick={fullscreen}>
              Full screen
            </button>
            {mode === "vnc" && (state === "failed" || state === "idle") ? (
              <button type="button" className="ag-ghost" disabled={!connected} onClick={connectVnc}>
                Connect
              </button>
            ) : null}
          </div>
        </div>

        {how || age ? (
          <p className="wb-desk-mode">
            {how ? <span className="wb-desk-how">{how}</span> : null}
            {age ? (
              <span className={`wb-age${stale ? " stale" : ""}`} aria-live="polite" aria-atomic="true">
                {age}
              </span>
            ) : null}
          </p>
        ) : null}

        <div
          ref={frame}
          className={`wb-screen${driving ? " driving" : ""}${live ? " live" : ""}${stream ? " stream" : ""}`}
          style={stream && shot ? { aspectRatio: `${shot.width} / ${shot.height}` } : undefined}
        >
          {mode === "vnc" ? <div ref={screen} className="wb-screen-in" /> : null}
          {stream && shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={shotImg}
              className="wb-shot"
              src={shot.src}
              alt={`The box's desktop, ${shot.width} by ${shot.height}, as of ${time(shot.receivedAt)}.${driving ? " Click to click there; right-click for a right-click." : ""}`}
              draggable={false}
              onClick={onShotClick}
              onContextMenu={onShotContext}
            />
          ) : null}
          {!live ? (
            <div className="wb-screen-empty">
              <p>{!connected ? "The desktop appears here once the agent server is connected." : word}</p>
            </div>
          ) : null}
        </div>

        {stream && driving ? (
          <div className="wb-deck" aria-label="Drive the desktop">
            {stepUp ? (
              <div className="wb-stepup" role="alert">
                <p>Driving the desktop needs a sign-in from the last 30 minutes. Confirm it is you and the action is sent.</p>
                <button type="button" className="admin-primary" onClick={confirmAndRetry}>
                  Sign in again
                </button>
                <button type="button" className="ag-ghost" onClick={() => setStepUp(null)}>
                  Cancel
                </button>
              </div>
            ) : null}
            <form className="wb-clip" onSubmit={sendText}>
              <input
                className="admin-input"
                placeholder="Text to type on the desktop"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label="Text to type on the desktop"
                autoComplete="off"
                maxLength={2000}
              />
              <button type="submit" className="ag-ghost" disabled={!typed}>
                Send
              </button>
            </form>
            <div className="wb-keys" role="group" aria-label="Keys">
              {KEYS.map(([label, combo]) => (
                <button key={combo} type="button" className="ag-ghost wb-key" data-combo={combo} onClick={() => act({ action: "key", combo })}>
                  {label}
                </button>
              ))}
              <button type="button" className="ag-ghost wb-key" onClick={() => scroll("up")} aria-label="Scroll up">
                Scroll ↑
              </button>
              <button type="button" className="ag-ghost wb-key" onClick={() => scroll("down")} aria-label="Scroll down">
                Scroll ↓
              </button>
            </div>
            <form className="wb-clip" onSubmit={openUrl}>
              <input
                className="admin-input"
                placeholder="https://… to open in the desktop browser"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-label="Address to open on the desktop"
                autoComplete="off"
                inputMode="url"
              />
              <button type="submit" className="ag-ghost" disabled={!url.trim()}>
                Open URL
              </button>
            </form>
            <p className="wb-note" role="status" aria-live="polite">
              {actErr ? <span className="admin-err">{actErr}</span> : did ? `Sent: ${did}` : "Click the picture to click there. Each action refreshes the frame."}
            </p>
          </div>
        ) : null}

        {mode === "vnc" ? (
          <form className="wb-clip" onSubmit={sendClip}>
            <input
              className="admin-input"
              placeholder="Text to paste on the desktop"
              value={clip}
              onChange={(e) => setClip(e.target.value)}
              disabled={!live}
              aria-label="Text to send to the desktop clipboard"
              autoComplete="off"
            />
            <button type="submit" className="ag-ghost" disabled={!live || !clip}>
              Send to clipboard
            </button>
          </form>
        ) : null}
        {sent ? (
          <p className="wb-note" role="status">
            {sent}
          </p>
        ) : null}
        {remoteClip ? (
          <p className="wb-note">
            The desktop copied: <code>{remoteClip.slice(0, 200)}</code>{" "}
            <button type="button" className="ag-ghost" onClick={() => navigator.clipboard?.writeText(remoteClip).catch(() => {})}>
              Copy here
            </button>
          </p>
        ) : null}
      </div>
      <DesktopLog ops={ops} />
    </div>
  );
}

// The line the panel shows after an action; the box writes its own to the log.
function describe(a) {
  switch (a.action) {
    case "click":
      return `${a.button === "right" ? "Right-click" : "Click"} at (${a.x}, ${a.y})`;
    case "double_click":
      return `Double-click at (${a.x}, ${a.y})`;
    case "type":
      return `typed ${a.text.length} character${a.text.length === 1 ? "" : "s"}`;
    case "key":
      return `pressed ${a.combo}`;
    case "scroll":
      return `scrolled ${a.direction}`;
    case "open_url":
      return `opened ${a.url}`;
    default:
      return a.action;
  }
}
