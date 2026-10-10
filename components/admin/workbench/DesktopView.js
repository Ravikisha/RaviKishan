// The desktop on the box, live.
//
// The agent's browser runs on this desktop, so when a chat clicks or types you
// watch it happen. It opens VIEW-ONLY: a stray tap on a phone must not click
// something on a machine that is in the middle of doing work. "Take control"
// is the one deliberate switch, and while you hold it the frame wears a solid
// amber edge and says so — the one loud thing on this view, because who is
// driving is the only question that matters here.
//
// Three ways to show it, chosen by asking the box first (desktop.status):
//
//   PUSH (the default)  the box PUSHES frames over the socket as binary
//     messages (desktop.stream.start) and this view acks each one after
//     drawing it. The old loop was request → capture → base64 → render →
//     request, so the tunnel's ~400 ms round trip sat inside every frame and
//     the owner saw 1–2 fps. Now the round trip only bounds how many frames
//     may be un-acked (two), not how often one arrives. Frames are decoded
//     with createImageBitmap off the main thread and drawn on a canvas; a
//     frame that arrives while one is decoding replaces the waiting one.
//     The view adapts: when the box reports frames held back for a slow link
//     for 3 s, scale and quality step down (desktop.stream.update); after
//     10 s healthy they step back up. The readout under the bar is measured
//     (fps drawn, latency against the box's clock, link), not decoration.
//     Hidden tab: the stream is STOPPED on the box, not just ignored here.
//
//   POLL (an agentd from before the push stream)  a JPEG screenshot about
//     once a second, never two requests in flight. Driving sends DISCRETE
//     actions (desktop.action):
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
import { streamSettings, assessLink, adaptStep, LINK_WINDOW_MS, frameLatency, clockOffset } from "../../../lib/server/desktopStreamShape";

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

// The stream's pure half (ladder, link assessment, adaptation, latency) is
// shared with e2e:workbench, which tests it without a browser.
export { STREAM_LEVELS, STREAM_MAX_SCALE, streamSettings, assessLink, adaptStep, LINK_WINDOW_MS } from "../../../lib/server/desktopStreamShape";

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

// `variant="bar"` is Jarvis: the frame is the page, and every status line,
// the Watch / Drive switch and the tools collapse into ONE slim bar under it.
// `lead` and `trail` are the host's own pieces for either end of that bar
// (Jarvis puts its connection state first and its drawer toggles last).
export default function DesktopView({ client = null, connected = false, ops = [], initialControl = false, variant = "page", lead = null, trail = null }) {
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

  // ---- push state ----
  const canvasRef = useRef(null);
  const [pic, setPic] = useState(null); // {width, height} of the SCREEN, once a frame is drawn
  const [rate, setRate] = useState(null); // {fps, latency, link, settings, source}
  const [marks, setMarks] = useState([]); // local "you clicked here" markers
  const [source, setSource] = useState(""); // what the box captures with: ffmpeg | import
  const marksRef = useRef([]);
  const push = useRef({ alive: false, decoding: false, pending: null, samples: [], drawn: [], lastAt: 0, keepAt: 0, offset: 0, level: 0, slowFor: 0, okFor: 0, settings: null, source: "" });

  const pushMode = mode === "push";
  const stream = mode === "stream" || pushMode;
  const live = pushMode ? !!pic : mode === "stream" ? !!shot : mode === "vnc" && state === "live";
  const driving = control && live;

  const setMarksBoth = (fn) => {
    marksRef.current = fn(marksRef.current);
    setMarks(marksRef.current);
  };

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
      const canPush = typeof client.desktopStreamStart === "function" && typeof client.on === "function";
      setMode(old || st?.vnc === "up" ? "vnc" : canPush ? "push" : "stream");
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

  /* ---------------- the push stream ---------------- */
  useEffect(() => {
    if (mode !== "push" || !connected || !client) return undefined;
    const P = push.current;
    Object.assign(P, { alive: true, decoding: false, pending: null, samples: [], drawn: [], lastAt: 0, keepAt: 0, offset: 0, level: 0, slowFor: 0, okFor: 0, settings: null, source: "" });
    let started = false;
    let retry = null;
    let fails = 0;

    const paint = async (bytes) => {
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const blob = new Blob([bytes], { type: "image/jpeg" });
      let src;
      let release = () => {};
      if (typeof createImageBitmap === "function") {
        // Decoded off the main thread: a frame never stalls a click.
        src = await createImageBitmap(blob);
        release = () => src.close?.();
      } else {
        const url = URL.createObjectURL(blob);
        try {
          src = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error("undecodable frame"));
            im.src = url;
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      if (!P.alive) return release(), false;
      if (canvas.width !== src.width) canvas.width = src.width;
      if (canvas.height !== src.height) canvas.height = src.height;
      canvas.getContext("2d").drawImage(src, 0, 0);
      release();
      return true;
    };

    const draw = async (f) => {
      P.decoding = true;
      let ok = false;
      try {
        ok = await paint(f.image);
      } catch (_) {}
      // Acked whether or not it decoded: an ack is "send the next one", and a
      // bad frame must not stall the stream.
      client.desktopStreamAck(f.header.seq);
      P.decoding = false;
      if (!P.alive) return;
      if (ok) {
        const t = Date.now();
        P.lastAt = t;
        P.drawn.push(t);
        const h = f.header;
        const w = h.width || screenSize.current.width;
        const ht = h.height || screenSize.current.height;
        if (w !== screenSize.current.width || ht !== screenSize.current.height) screenSize.current = { width: w, height: ht };
        setPic((p) => (p && p.width === w && p.height === ht ? p : { width: w, height: ht }));
        // A marker stays until a frame sent AFTER the action's reply is drawn.
        if (marksRef.current.some((m) => m.clearAfter && f.receivedAt > m.clearAfter)) {
          setMarksBoth((ms) => ms.filter((m) => !(m.clearAfter && f.receivedAt > m.clearAfter)));
        }
      }
      if (P.pending) {
        const next = P.pending;
        P.pending = null;
        draw(next);
      }
    };

    const onFrame = (f) => {
      if (!P.alive) return;
      const h = f.header || {};
      if (h.keepalive) {
        P.keepAt = f.receivedAt;
        return;
      }
      const latency = frameLatency(h.takenAt, f.receivedAt, P.offset);
      P.samples.push({ at: f.receivedAt, latency, skipped: h.skipped || 0 });
      if (P.samples.length > 200) P.samples.splice(0, P.samples.length - 200);
      // Latest wins: one frame decoding, at most one waiting.
      if (P.decoding) P.pending = f;
      else draw(f);
    };
    const off = client.on("frame", onFrame);

    const start = async () => {
      clearTimeout(retry);
      if (!P.alive || (typeof document !== "undefined" && document.hidden)) return;
      // Measured here as well: this effect runs before the resize observer
      // below has taken its first reading.
      const w = frame.current?.clientWidth || 0;
      if (w) scaleRef.current = fitScale(w, screenSize.current.width, typeof window !== "undefined" ? window.devicePixelRatio : 1);
      const s = streamSettings(P.level, scaleRef.current);
      const t0 = Date.now();
      try {
        const r = await client.desktopStreamStart(s);
        const t1 = Date.now();
        if (!P.alive) return client.desktopStreamStop();
        // The box's clock against ours, from the reply's midpoint: takenAt is
        // the box's, receivedAt is ours, and latency is meaningless without it.
        P.offset = clockOffset(r?.at, t0, t1);
        P.settings = { fps: r?.fps ?? s.fps, scale: r?.scale ?? s.scale, quality: r?.quality ?? s.quality };
        P.source = r?.source || "";
        setSource(P.source);
        if (r?.width) screenSize.current = { width: r.width, height: r.height };
        started = true;
        fails = 0;
        setStreamErr("");
        setPaused(false);
      } catch (e) {
        if (!P.alive) return;
        // An agentd from before the push stream: poll the way it always did.
        if (unknownMessage(e)) return setMode("stream");
        fails += 1;
        setStreamErr(e.message);
        retry = setTimeout(start, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** fails));
      }
    };
    start();

    const onVis = () => {
      if (document.hidden) {
        // Stopped ON THE BOX: a hidden tab must not cost the link anything.
        started = false;
        clearTimeout(retry);
        client.desktopStreamStop();
        setPaused(true);
        return;
      }
      setPaused(false);
      start();
    };
    document.addEventListener("visibilitychange", onVis);

    const tick = setInterval(() => {
      const t = Date.now();
      P.drawn = P.drawn.filter((x) => t - x <= LINK_WINDOW_MS);
      P.samples = P.samples.filter((x) => t - x.at <= 10_000);
      const link = assessLink(P.samples, t);
      const lat = P.samples.filter((x) => t - x.at <= LINK_WINDOW_MS && Number.isFinite(x.latency)).map((x) => x.latency).sort((a, b) => a - b);
      if (started) {
        const step = adaptStep(P, link);
        P.level = step.level;
        P.slowFor = step.slowFor;
        P.okFor = step.okFor;
        const want = streamSettings(P.level, scaleRef.current);
        const cur = P.settings || {};
        // A step on the ladder, or a pane that now wants different pixels.
        if (want.fps !== cur.fps || want.scale !== cur.scale || want.quality !== cur.quality) {
          try {
            client.desktopStreamUpdate(want);
            P.settings = want;
          } catch (_) {}
        }
      }
      // Markers that never saw their frame go after 3 s.
      if (marksRef.current.some((m) => t - m.at > 3000)) setMarksBoth((ms) => ms.filter((m) => t - m.at <= 3000));
      setRate({
        fps: Math.round((P.drawn.length / (LINK_WINDOW_MS / 1000)) * 10) / 10,
        latency: lat.length ? Math.round(lat[Math.floor(lat.length / 2)]) : null,
        link,
        level: P.level,
        settings: P.settings,
        source: P.source,
        lastAt: P.lastAt,
        heardAt: Math.max(P.lastAt, P.keepAt),
      });
      setNow(t);
    }, 1000);

    return () => {
      P.alive = false;
      P.pending = null;
      clearTimeout(retry);
      clearInterval(tick);
      clearTimeout(clickTimer.current);
      off();
      document.removeEventListener("visibilitychange", onVis);
      client.desktopStreamStop();
      setPic(null);
      setRate(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, connected, client]);

  // Ask for as many pixels as the pane shows, no more.
  useEffect(() => {
    if (!stream || !frame.current) return undefined;
    const measure = () => {
      const w = frame.current?.clientWidth || 0;
      scaleRef.current = fitScale(w, screenSize.current.width, typeof window !== "undefined" ? window.devicePixelRatio : 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(frame.current);
    return () => ro.disconnect();
  }, [stream]);

  /* ---------------- driving, one action at a time ---------------- */
  // `mark` is the local marker for this action, if it has one: it waits for
  // the reply, then for the first frame after it.
  const act = (a, mark = null) => {
    queue.current = queue.current.then(async () => {
      setActErr("");
      try {
        await client.desktopAction(a);
        setDid(describe(a));
        setStepUp(null);
        if (mark) setMarksBoth((ms) => ms.map((m) => (m.id === mark ? { ...m, clearAfter: Date.now() } : m)));
        // The push stream needs no asking: the box pushes the result itself.
        if (mode === "stream") kick();
      } catch (e) {
        if (mark) setMarksBoth((ms) => ms.filter((m) => m.id !== mark));
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

  const picEl = () => (pushMode ? canvasRef.current : shotImg.current);
  const pointFrom = (e) => toScreen(e, picEl()?.getBoundingClientRect(), screenSize.current);

  // Instant local feedback: a marker where you clicked, drawn NOW, held until
  // a frame from after the action arrives — so a click never looks ignored
  // while it crosses the tunnel.
  const markAt = (e, kind = "left") => {
    const r = picEl()?.getBoundingClientRect();
    if (!r || !r.width) return null;
    const id = `m${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const m = { id, kind, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, at: Date.now(), clearAfter: 0 };
    setMarksBoth((ms) => [...ms.slice(-4), m]);
    return id;
  };

  // A double-click arrives as a click (detail 1) then a click (detail 2): the
  // first waits a moment, and the second replaces it with ONE double_click —
  // never two clicks and a double. Read from detail rather than dblclick,
  // which not every input path fires. The marker does not wait.
  const onShotClick = (e) => {
    if (!driving) return;
    const p = pointFrom(e);
    if (!p) return;
    lastPoint.current = p;
    clearTimeout(clickTimer.current);
    // The single click this replaces never goes, so neither does its marker.
    const replaced = clickTimer.mark;
    if (replaced) setMarksBoth((ms) => ms.filter((m) => m.id !== replaced));
    clickTimer.mark = null;
    const mark = markAt(e, e.detail === 2 ? "double" : "left");
    if (e.detail === 1) clickTimer.mark = mark;
    if (e.detail === 2) {
      act({ action: "double_click", ...p, button: "left" }, mark);
      return;
    }
    if (e.detail > 2) return;
    clickTimer.current = setTimeout(() => {
      clickTimer.mark = null;
      act({ action: "click", ...p, button: "left" }, mark);
    }, 220);
  };
  const onShotContext = (e) => {
    if (!driving) return;
    e.preventDefault();
    const p = pointFrom(e);
    if (!p) return;
    lastPoint.current = p;
    act({ action: "click", ...p, button: "right" }, markAt(e, "right"));
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
  const setDrive = (next) => {
    if (next === control) return;
    setControl(next);
    setStepUp(null);
    setActErr("");
    if (mode === "vnc" && rfb.current) {
      rfb.current.viewOnly = !next;
      if (next) rfb.current.focus();
    }
  };
  const toggleControl = () => setDrive(!control);

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
    : stream && !live
    ? streamErr || (paused ? "Paused while this tab is hidden." : displayDown ? "The desktop display is not running on the box. Start agentd-desktop." : "Loading the desktop…")
    : driving
    ? stream
      ? "You are driving. Clicks, keys and text go to the box."
      : "You are driving. Your clicks and keys reach the box."
    : stream
    ? "Watching. Nothing you do here reaches the box."
    : "Watching. Clicks and keys are not sent.";

  // What is showing it, as separate facts: rendered with hairlines between
  // them, never joined into one string with middots.
  const how = !connected || mode === "off" || mode === "probe"
    ? []
    : stream
    ? [
        pushMode ? `Live stream${source ? ` (${source})` : ""}` : "Screenshot stream",
        ...(boxStatus ? [`VNC ${boxStatus.vnc === "up" ? "up" : "off"}`, `browser ${boxStatus.browser || "unknown"}`] : []),
      ]
    : [`VNC${legacy ? " (older agentd)" : ""}`];

  // Push: the box sends nothing while the screen is still (plus a keepalive
  // every 5 s), so an old FRAME is not a stale stream — silence is.
  const heardAt = pushMode && rate ? rate.heardAt || 0 : 0;
  const lastFrameAt = pushMode ? rate?.lastAt || 0 : shot?.receivedAt || 0;
  const still = pushMode && lastFrameAt && now - lastFrameAt >= 3000 && heardAt && now - heardAt < 12_000;
  const age = !stream || !live
    ? ""
    : paused
    ? "paused while this tab is hidden"
    : still
    ? "live, the screen has not changed"
    : pushMode && heardAt && now - heardAt >= 12_000
    ? `no word from the box for ${Math.round((now - heardAt) / 1000)}s`
    : frameAge(now - (lastFrameAt || now));
  const stale = stream && live && !paused && (pushMode ? !!heardAt && now - heardAt >= 12_000 : now - lastFrameAt > 10_000);
  const settings = rate?.settings;
  const quality = !pushMode || !rate ? "" : rate.link === "slow" ? "slow link" : rate.link === "idle" ? "idle" : "good link";
  const showRate = pushMode && rate && live && !paused;

  // The link meter's length: frames drawn against frames asked for, held down
  // by latency past a quarter of a second. Real numbers, not decoration.
  const meter = !showRate
    ? 0
    : (() => {
        const want = settings?.fps || 5;
        const byFps = rate.link === "idle" ? 1 : Math.min(1, (rate.fps || 0) / want);
        const lat = rate.latency;
        const byLat = lat == null ? 0.6 : lat <= 250 ? 1 : Math.max(0.12, 1 - (lat - 250) / 1750);
        return Math.max(0.08, Math.min(1, byFps * byLat));
      })();

  // Measured, every second: frames DRAWN here, the box-to-screen delay against
  // the box's own clock, and what the link is doing. Not a live region —
  // numbers read aloud every second are noise.
  const rateEl = showRate ? (
    <span
      className={`wb-rate l-${rate.link}`}
      data-fps={rate.fps}
      data-latency={rate.latency ?? ""}
      data-link={rate.link}
      data-level={rate.level}
      title={settings ? `Asking for ${settings.fps} fps at ${Math.round(settings.scale * 100)}% scale, quality ${settings.quality}` : ""}
    >
      <span>
        <b>{rate.fps}</b> fps
      </span>
      <span>
        <b>{rate.latency == null ? "no reading" : `${rate.latency} ms`}</b>
      </span>
      <span className="wb-rate-q">{quality}</span>
      {settings && variant !== "bar" ? (
        <span>
          {Math.round(settings.scale * 100)}% at quality {settings.quality}
        </span>
      ) : null}
    </span>
  ) : null;

  const ageEl = age ? (
    <span
      className={`wb-age${stale ? " stale" : ""}${variant === "bar" && !stale && !paused ? " wb-sr" : ""}`}
      aria-live="polite"
      aria-atomic="true"
    >
      {age}
    </span>
  ) : null;

  const screenEl = (
    <div
      ref={frame}
      className={`wb-screen${driving ? " driving" : ""}${live ? " live" : ""}${stream ? " stream" : ""}${pushMode ? " pushed" : ""}`}
      style={
        pushMode && pic
          ? { aspectRatio: `${pic.width} / ${pic.height}`, "--wb-ar": pic.width / pic.height }
          : mode === "stream" && shot
          ? { aspectRatio: `${shot.width} / ${shot.height}` }
          : undefined
      }
    >
      {mode === "vnc" ? <div ref={screen} className="wb-screen-in" /> : null}
      {pushMode || (mode === "stream" && shot) ? (
        // The picture and its click markers share one box, so a marker's
        // percentages are the picture's — in a pane or in full screen.
        <div className="wb-pic" style={pushMode && !pic ? { display: "none" } : undefined}>
          {pushMode ? (
            <canvas
              ref={canvasRef}
              className="wb-shot"
              role="img"
              aria-label={pic ? `The box's desktop, ${pic.width} by ${pic.height}, live.${driving ? " Click to click there; right-click for a right-click." : ""}` : "The box's desktop, loading."}
              onClick={onShotClick}
              onContextMenu={onShotContext}
            />
          ) : (
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
          )}
          {marks.map((m) => (
            <span
              key={m.id}
              className={`wb-mark k-${m.kind}${m.clearAfter ? " sent" : ""}`}
              style={{ left: `${m.fx * 100}%`, top: `${m.fy * 100}%` }}
              aria-hidden="true"
            />
          ))}
        </div>
      ) : null}
      {!live ? (
        <div className="wb-screen-empty">
          <p>{!connected ? "The desktop appears here once the agent server is connected." : word}</p>
        </div>
      ) : null}
    </div>
  );

  const deckEl =
    stream && driving ? (
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
    ) : null;

  const extrasEl = (
    <>
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
    </>
  );

  const vncConnect =
    mode === "vnc" && (state === "failed" || state === "idle") ? (
      <button type="button" className="ag-ghost" disabled={!connected} onClick={connectVnc}>
        Connect
      </button>
    ) : null;

  if (variant === "bar") {
    return (
      <div className="wb-desk wb-desk-barred">
        <div className="wb-desk-main">
          {screenEl}
          <DeskBar
            lead={
              <>
                {lead}
                {showRate ? (
                  <span className={`wb-meter l-${rate.link}`} title={how.join(", ")} aria-hidden="true">
                    <i style={{ width: `${Math.round(meter * 100)}%` }} />
                  </span>
                ) : null}
                {rateEl}
                {ageEl}
              </>
            }
            mid={
              <>
                <p className={`wb-drive wb-sr${driving ? " on" : ""}`} role="status" aria-live="polite">
                  {word}
                </p>
                <div className="wb-mode" role="group" aria-label="Watch or drive the desktop">
                  <button type="button" className={`wb-watch${!control ? " on" : ""}`} aria-pressed={!control} disabled={!live} onClick={() => setDrive(false)}>
                    Watch
                  </button>
                  <button type="button" className={`wb-take${control ? " on" : ""}`} aria-pressed={control} disabled={!live} onClick={() => setDrive(true)}>
                    Drive
                  </button>
                </div>
              </>
            }
            tools={
              <>
                <button type="button" className="wb-icon" disabled={!live} onClick={screenshot} aria-label="Screenshot" title="Download a full-size screenshot">
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M3 6.5h3l1.5-2h5L14 6.5h3v9H3z" />
                    <circle cx="10" cy="11" r="3" />
                  </svg>
                </button>
                <button type="button" className="wb-icon" disabled={!live} onClick={fullscreen} aria-label="Full screen" title="Full screen">
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5" />
                  </svg>
                </button>
                {vncConnect}
              </>
            }
            trail={trail}
          />
          {deckEl}
          {extrasEl}
        </div>
        <DesktopLog ops={ops} />
      </div>
    );
  }

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
            {vncConnect}
          </div>
        </div>

        {how.length || age ? (
          <p className="wb-desk-mode">
            {how.length ? (
              <span className="wb-desk-how">
                {how.map((h) => (
                  <span key={h}>{h}</span>
                ))}
              </span>
            ) : null}
            {ageEl}
            {rateEl}
          </p>
        ) : null}

        {screenEl}
        {deckEl}
        {extrasEl}
      </div>
      <DesktopLog ops={ops} />
    </div>
  );
}

// The one slim bar under the frame (Jarvis). Exported so the panel can draw
// the same bar while there is no stream yet: connection on the left, the
// Watch / Drive switch in the middle, tools and drawers on the right.
export function DeskBar({ lead = null, mid = null, tools = null, trail = null }) {
  return (
    <div className="wb-bar">
      <div className="wb-bar-l">{lead}</div>
      {mid ? <div className="wb-bar-c">{mid}</div> : null}
      <div className="wb-bar-r">
        {tools ? <span className="wb-desk-btns wb-tools">{tools}</span> : null}
        {trail}
      </div>
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
