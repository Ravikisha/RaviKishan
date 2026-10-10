// The remote desk — a WebRTC desktop session on the agent box, in Jarvis.
//
// ADMIN ONLY (rendered by JarvisPanel, behind the admin's sign-in and
// allow-list). The supervisor checks the same Firebase ID token and allow-list
// on the box, so this is a view, not a boundary.
//
// The screen is the hero: a native <video> holding the session's H.264 track
// at its true aspect ratio, never cropped (object-fit: contain). Under it ONE
// slim bar, the same bar as the legacy stream: where the connection stands and
// a link meter fed by real getStats() on the left, Watch / Drive in the
// middle (amber only while driving), the profile, clipboard, pointer lock,
// fullscreen, reconnect and disconnect on the right, then the drawers. Under
// that, the sessions: state on the left edge, start one, stop one (two taps).
//
// Nothing connects until Connect is pressed. Leaving the tab unmounts this and
// closes the peer connection. Driving needs a sign-in from the last 30 min.
//
// Input: pointer positions are fractions of the PICTURE (the video's content
// box, letterbox excluded — zoom, DPR and fullscreen are all inside
// getBoundingClientRect), moves are coalesced to one per animation frame, and
// every hand-off (blur, hidden tab, pagehide, Watch, disconnect) sends
// release-all. The protocol half is lib/server/remoteDeskShape.js.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DeskApi,
  DeskConnection,
  newIdempotencyKey,
  PROFILES,
  profileById,
  viewable,
  stoppable,
  isLive,
  normalisePoint,
  contentBox,
  movePointer,
  keyMessage,
  xButton,
  makeWheel,
  bindReleaseTriggers,
  linkVerdict,
  fmtKbps,
  capacityView,
  canSwitchTo,
  explainError,
  serverStats,
  restartPlan,
  MAX_CLIP_BYTES,
  utf8Bytes,
} from "../../lib/remoteDesk";
import { isFresh as realIsFresh, reauthenticate } from "../../lib/reauth";
import { DeskBar } from "./workbench/DesktopView";
import { useArmed } from "./AgentPanel";
import RemoteDeskStyles from "./RemoteDeskStyles";

const CONN_LABEL = {
  idle: "Not viewing",
  signalling: "Signalling",
  negotiating: "Negotiating the relay",
  live: "Live",
  reconnecting: "Reconnecting",
  switching: "Switching",
  failed: "Couldn't connect",
  ended: "Ended",
  stopped: "Session stopped",
  replaced: "Taken by another viewer",
};
const CONN_TONE = {
  idle: "idle",
  signalling: "connecting",
  negotiating: "connecting",
  live: "connected",
  reconnecting: "reconnecting",
  switching: "connecting",
  failed: "failed",
  ended: "closed",
  stopped: "closed",
  replaced: "failed",
};
const STATE_WORD = {
  CREATING: "Starting",
  READY: "Ready",
  CONNECTED: "Viewer attached",
  IDLE: "Idle",
  STOPPING: "Stopping",
  STOPPED: "Stopped",
  FAILED: "Failed",
};

const ago = (at, now) => {
  const t = typeof at === "number" ? at : Date.parse(at || "");
  if (!t || !now) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

function defaultDeps() {
  return {
    api: new DeskApi(),
    makeConnection: (opts) => new DeskConnection(opts),
    isFresh: () => realIsFresh(),
    reauth: () => reauthenticate(),
  };
}

export default function RemoteDesk({ deps = null, trail = null, onConnectAgent = () => {}, onDisconnectAgent = () => {}, onLegacy = null }) {
  const d = useMemo(() => deps || defaultDeps(), [deps]);
  const host = d.api.host || "desk.ravikishan.me";

  // idle → loading → ready | down
  const [phase, setPhase] = useState("idle");
  const [problem, setProblem] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [cap, setCap] = useState(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [now, setNow] = useState(0);

  const [viewing, setViewing] = useState(null);
  const [conn, setConn] = useState({ status: "idle" });
  const [input, setInput] = useState(false);
  const [stats, setStats] = useState(null);
  const [server, setServer] = useState(null);
  const [details, setDetails] = useState(false);
  const [videoSize, setVideoSize] = useState({ w: 16, h: 9 });

  const [drive, setDriveState] = useState(false);
  const [keysOn, setKeysOn] = useState(false);
  // "" | "gate" (Drive pressed with a stale sign-in) | "server" (the desk
  // said auth/stale-sign-in and is dropping input)
  const [stepUp, setStepUp] = useState("");
  // A size change the box refused (profile/needs-restart): the offer of a
  // new session at that size. {profile, from, key, phase, error?, to?}
  const [restart, setRestart] = useState(null);
  const [locked, setLocked] = useState(false);
  const [full, setFull] = useState(false);
  const [asked, setAsked] = useState("");
  const [clipOpen, setClipOpen] = useState(false);
  const [clipText, setClipText] = useState("");
  const [remoteClip, setRemoteClip] = useState(null);
  const [clipNote, setClipNote] = useState("");
  const [listOpen, setListOpen] = useState(false);

  const connRef = useRef(null);
  const videoRef = useRef(null);
  const screenRef = useRef(null);
  const virt = useRef(null);
  const dragging = useRef(0);
  const wheel = useRef(makeWheel());
  const driveRef = useRef(false);
  driveRef.current = drive;
  const askedRef = useRef("");
  const viewingRef = useRef(null);
  const serverPrev = useRef(null);

  const sender = () => connRef.current?.sender || null;

  // A clock for "started 4 min ago", only while there is a list to date.
  useEffect(() => {
    if (phase !== "ready") return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [phase]);

  /* ---------- the list ---------- */

  const load = useCallback(async () => {
    const [s, c] = await Promise.allSettled([d.api.sessions(), d.api.capacity()]);
    if (s.status === "rejected") throw s.reason;
    setSessions(s.value);
    setCap(c.status === "fulfilled" ? c.value : null);
    return s.value;
  }, [d]);

  // Kept fresh while you are here and the tab is showing; a session started
  // or stopped elsewhere (or by its idle timer) shows up within 10 s.
  useEffect(() => {
    if (phase !== "ready") return undefined;
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      load().catch(() => {});
    }, 10000);
    return () => clearInterval(t);
  }, [phase, load]);

  /* ---------- connect / disconnect ---------- */

  const closeView = useCallback(() => {
    const c = connRef.current;
    connRef.current = null;
    if (c) c.close();
    if (videoRef.current) videoRef.current.srcObject = null;
    setViewing(null);
    setConn({ status: "idle" });
    setInput(false);
    setStats(null);
    setServer(null);
    serverPrev.current = null;
    setDriveState(false);
    setStepUp("");
    setAsked("");
    askedRef.current = "";
    viewingRef.current = null;
    setRemoteClip(null);
    if (typeof document !== "undefined" && document.pointerLockElement) document.exitPointerLock();
  }, []);

  // The owner's Connect: the list from the desk, and the agent socket for
  // the drawers. Nothing before this has touched the network.
  const connectNow = async () => {
    setProblem(null);
    setNote("");
    setPhase("loading");
    try {
      onConnectAgent();
    } catch (_) {}
    try {
      await load();
      setPhase("ready");
    } catch (e) {
      setProblem(explainError(e, { host }));
      setPhase("down");
    }
  };

  const disconnectNow = () => {
    closeView();
    setRestart(null);
    setPhase("idle");
    setProblem(null);
    try {
      onDisconnectAgent();
    } catch (_) {}
  };

  const view = (s) => {
    if (!viewable(s.state)) return;
    closeView();
    setViewing(s);
    viewingRef.current = s;
    setListOpen(false);
    setNote("");
    const c = d.makeConnection({
      sessionId: s.id,
      onState: (st) => {
        if (connRef.current !== c) return;
        if (st.input !== undefined) setInput(!!st.input);
        // "the input channel opened" arrives as the same status with no
        // detail: keep what the status already said (the profile it is
        // switching to, the try it is on).
        setConn((prev) => (prev.status === st.status ? { ...prev, ...st } : st));
        // A renegotiation keeps the session and the owner's hands: Drive
        // stays on and simply has nothing to send until the new channel
        // opens. Everything else that is not on the way to live lets go.
        if (st.status !== "live" && st.status !== "signalling" && st.status !== "negotiating" && st.status !== "switching") {
          setDriveState(false);
        }
        if (st.status === "switching") {
          serverPrev.current = null;
          setServer(null);
          setAsked("");
          askedRef.current = "";
          setNote("");
          if (st.profile) {
            const next = { ...(viewingRef.current || s), profile: st.profile, width: st.width, height: st.height, fps: st.fps };
            viewingRef.current = next;
            setViewing(next);
          }
        }
        if (st.status === "failed" || st.status === "replaced" || st.status === "stopped") setInput(false);
        if (st.status === "stopped") load().catch(() => {});
      },
      onTrack: (stream) => {
        if (connRef.current !== c) return;
        const v = videoRef.current;
        if (!v || !stream) return;
        v.srcObject = stream;
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      },
      onStats: (st) => connRef.current === c && setStats(st),
      onStatus: (m) => {
        if (connRef.current !== c) return;
        if (m.t === "stats") {
          const sv = serverStats(m, Date.now(), serverPrev.current);
          serverPrev.current = sv && sv.next;
          setServer(sv);
        } else if (m.t === "error" && m.code === "profile/needs-restart") {
          // Xvfb cannot resize: that size is a new session, not a switch.
          const want = askedRef.current;
          setAsked("");
          askedRef.current = "";
          setNote("");
          if (want) setRestart({ profile: want, from: viewingRef.current || s, key: newIdempotencyKey(), phase: "offer", why: m.error || "" });
        } else if (m.t === "error" && m.code === "auth/stale-sign-in") {
          // The desk is dropping input: let go here too, then ask for the
          // sign-in that brings it back.
          c.sender && c.sender.releaseAll("stale");
          setDriveState(false);
          setStepUp("server");
        } else if (m.t === "clip") {
          setRemoteClip(typeof m.text === "string" ? m.text : "");
          setClipOpen(true);
          setClipNote("");
        } else if (m.t === "res") {
          setNote(`Now ${m.profile}${m.width ? `, ${m.width}×${m.height} at ${m.fps} fps` : ""}.`);
        } else if (m.t === "error") {
          if (m.code && /^profile\//.test(m.code)) {
            setAsked("");
            askedRef.current = "";
          }
          setNote(`${m.error || "Refused"}${m.code ? ` (${m.code})` : ""}`);
        }
      },
    });
    connRef.current = c;
    c.connect();
  };

  const reconnect = () => {
    const c = connRef.current;
    if (!c) return;
    setDriveState(false);
    c.connect();
  };

  // Leaving the tab (or switching to the legacy stream) unmounts this.
  useEffect(() => () => {
    const c = connRef.current;
    connRef.current = null;
    if (c) c.close();
  }, []);

  /* ---------- drive ---------- */

  const live = conn.status === "live";
  const switching = conn.status === "switching";

  const setDrive = async (on) => {
    if (!on) {
      sender()?.releaseAll("watch");
      setDriveState(false);
      setStepUp("");
      if (document.pointerLockElement) document.exitPointerLock();
      return;
    }
    let fresh = false;
    try {
      fresh = await d.isFresh();
    } catch (_) {
      fresh = false;
    }
    if (!fresh) return setStepUp("gate");
    setStepUp("");
    setDriveState(true);
    setTimeout(() => screenRef.current?.focus({ preventScroll: true }), 0);
  };
  // The step-up sign-in, then the FRESH token on the socket that is already
  // open: the desk checks auth_time itself, so a sign-in it never hears
  // about would leave it dropping input. Nothing reconnects.
  const confirmStepUp = async () => {
    try {
      await d.reauth();
      const c = connRef.current;
      if (c && c.reauth) await c.reauth();
      setStepUp("");
      setDriveState(true);
      setTimeout(() => screenRef.current?.focus({ preventScroll: true }), 0);
    } catch (e) {
      setNote(e.message === "Cancelled." ? "Still watching: the sign-in was cancelled." : `Sign-in failed: ${e.message}`);
      setStepUp("");
    }
  };

  // The hands-left triggers, bound while driving.
  useEffect(() => {
    if (!drive) return undefined;
    return bindReleaseTriggers({ win: window, doc: document, onRelease: (why) => sender()?.releaseAll(why) });
  }, [drive]);

  // Losing the picture means losing control. A renegotiation is not losing
  // it: the same session comes back at a new frame rate.
  useEffect(() => {
    if (!live && !switching && drive) setDriveState(false);
  }, [live, switching, drive]);

  const point = (e, clamp = false) => {
    const v = videoRef.current;
    if (!v) return null;
    return normalisePoint(e, v.getBoundingClientRect(), v.videoWidth, v.videoHeight, { clamp });
  };

  const onPointerMove = (e) => {
    const s = sender();
    if (!drive || !s) return;
    if (locked) {
      const v = videoRef.current;
      const box = v && contentBox(v.getBoundingClientRect(), v.videoWidth, v.videoHeight);
      virt.current = movePointer(virt.current, e.movementX, e.movementY, box);
      s.move(virt.current.x, virt.current.y);
      return;
    }
    const p = point(e, dragging.current > 0);
    if (!p || (!p.inside && !dragging.current)) return;
    virt.current = { x: p.x, y: p.y };
    s.move(p.x, p.y);
  };
  const onPointerDown = (e) => {
    const s = sender();
    if (!drive || !s) return;
    screenRef.current?.focus({ preventScroll: true });
    const p = locked ? virt.current || { x: 0.5, y: 0.5, inside: true } : point(e);
    if (!p || p.inside === false) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
    dragging.current += 1;
    virt.current = { x: p.x, y: p.y };
    s.buttonDown(xButton(e.button), p.x, p.y);
  };
  const onPointerUp = (e) => {
    const s = sender();
    if (!s) return;
    const p = locked ? virt.current || { x: 0.5, y: 0.5 } : point(e, true);
    dragging.current = Math.max(0, dragging.current - 1);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (p) s.buttonUp(xButton(e.button), p.x, p.y);
  };

  // Wheel and keys need a non-passive native listener to be prevented.
  useEffect(() => {
    const el = screenRef.current;
    if (!el || !drive) return undefined;
    const onWheel = (e) => {
      const s = sender();
      if (!s) return;
      e.preventDefault();
      const n = wheel.current(e);
      if (n) s.wheel(n.dx, n.dy);
    };
    const onKey = (e) => {
      const s = sender();
      if (!s) return;
      const m = keyMessage(e, e.type === "keyup" ? "up" : "down");
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      if (m.t === "kd") s.keyDown(m.code, m.key);
      else s.keyUp(m.code, m.key);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("keydown", onKey);
    el.addEventListener("keyup", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("keyup", onKey);
    };
  }, [drive]);

  // Pointer lock and fullscreen report back through document events.
  useEffect(() => {
    const onLock = () => setLocked(!!document.pointerLockElement && document.pointerLockElement === videoRef.current);
    const onFull = () => setFull(!!document.fullscreenElement && document.fullscreenElement === screenRef.current);
    document.addEventListener("pointerlockchange", onLock);
    document.addEventListener("fullscreenchange", onFull);
    return () => {
      document.removeEventListener("pointerlockchange", onLock);
      document.removeEventListener("fullscreenchange", onFull);
    };
  }, []);

  const toggleLock = () => {
    const v = videoRef.current;
    if (!v) return;
    if (document.pointerLockElement) document.exitPointerLock();
    else {
      try {
        const r = v.requestPointerLock();
        if (r && r.catch) r.catch(() => setNote("The browser refused pointer lock. Click the picture first, then try again."));
      } catch (_) {
        setNote("The browser refused pointer lock.");
      }
    }
  };
  const toggleFull = () => {
    const el = screenRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => setNote("The browser refused full screen."));
  };

  /* ---------- profile, clipboard ---------- */

  const sessionCount = sessions.filter((s) => isLive(s.state)).length;
  const current = asked || viewing?.profile || "";
  const changeProfile = (id) => {
    const s = sender();
    if (!s || id === current) return;
    const ok = canSwitchTo(id, null, sessionCount);
    if (!ok.allowed) return setNote(ok.reason);
    if (s.profile(id)) {
      setAsked(id);
      askedRef.current = id;
      setRestart(null);
      setNote(`Asked the box for ${id}. The picture changes when it is applied.`);
    }
  };

  const pasteHere = async () => {
    setClipNote("");
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) throw Object.assign(new Error("unsupported"), { name: "NotSupportedError" });
      const t = await navigator.clipboard.readText();
      setClipText(t);
      if (!t) setClipNote("This device's clipboard is empty.");
    } catch (e) {
      setClipNote(
        e.name === "NotAllowedError"
          ? "The browser did not allow reading your clipboard. Paste into the box above with Ctrl+V instead."
          : "This browser cannot read the clipboard from a button. Paste into the box above instead."
      );
    }
  };
  const sendClip = (e) => {
    e.preventDefault();
    const s = sender();
    if (!s || !drive) return;
    if (utf8Bytes(clipText) > MAX_CLIP_BYTES - 64) return setClipNote("That is more than 64 KB; the desk takes at most 64 KB at a time.");
    if (s.clipboard(clipText)) setClipNote(`Sent ${clipText.length} characters to the desktop's clipboard. Paste there with Ctrl+V.`);
    else setClipNote("Not sent: the input channel is closed.");
  };
  const pullClip = () => {
    const s = sender();
    if (!s) return;
    setClipNote("Asked the desktop for its clipboard.");
    s.pullClipboard();
  };
  const copyHere = async () => {
    try {
      await navigator.clipboard.writeText(remoteClip || "");
      setClipNote("Copied to this device.");
    } catch (_) {
      const pre = document.querySelector(".rd-clip-got");
      if (pre) {
        const r = document.createRange();
        r.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
      setClipNote("The browser did not allow writing your clipboard. The text is selected — copy it by hand.");
    }
  };

  /* ---------- sessions ---------- */

  const capView = capacityView(cap, sessions);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("1080p30");
  const idem = useRef("");
  if (!idem.current) idem.current = newIdempotencyKey();

  const create = async (e) => {
    e.preventDefault();
    const nm = name.trim();
    if (!nm) return;
    setBusy("create");
    setNote("");
    try {
      const s = await d.api.create({ name: nm, profile }, idem.current);
      idem.current = newIdempotencyKey();
      setName("");
      setNote(`Started ${s && s.name ? s.name : nm}.`);
      await load().catch(() => {});
    } catch (err) {
      const x = explainError(err, { host });
      setNote(`${x.what} ${x.todo}`);
    } finally {
      setBusy("");
    }
  };
  // The refused size, as a new session beside this one. The key is minted
  // with the offer, so a double tap (or a retry after a lost answer) gets the
  // same session back instead of a second one.
  const startRestart = async () => {
    const r = restart;
    if (!r || r.phase === "starting") return;
    const plan = restartPlan(r.from, r.profile, capView);
    if (!plan.allowed) return;
    setRestart({ ...r, phase: "starting", error: "" });
    try {
      const made = await d.api.create({ name: plan.name, profile: plan.profile }, r.key);
      const list = await load().catch(() => null);
      const row = (list || []).find((x) => x.id === made.id) || made;
      setRestart({ ...r, phase: "moved", to: row, error: "" });
      if (viewable(row.state)) view(row);
      else setNote(`Started ${row.name || row.id}. View it from the list once it is ready.`);
    } catch (err) {
      const x = explainError(err, { host });
      setRestart({ ...r, phase: "offer", error: `${x.what} ${x.todo}` });
    }
  };
  const stopOld = async () => {
    const r = restart;
    if (!r) return;
    setRestart(null);
    await stop(r.from);
  };

  const stop = async (s) => {
    setBusy(`stop:${s.id}`);
    setNote("");
    try {
      if (viewing && viewing.id === s.id) closeView();
      await d.api.stop(s.id);
      setNote(`Stopping ${s.name || s.id}.`);
      await load().catch(() => {});
    } catch (err) {
      const x = explainError(err, { host });
      setNote(`${x.what} ${x.todo}`);
    } finally {
      setBusy("");
    }
  };

  /* ---------- render ---------- */

  const verdict = linkVerdict(stats, profileById(current)?.fps || 30);
  const connLabel =
    conn.status === "reconnecting" && conn.attempt
      ? `Reconnecting (try ${conn.attempt} of ${conn.of || 3})`
      : switching
      ? `Switching to ${conn.profile || "the new profile"}…`
      : CONN_LABEL[conn.status] || conn.status;
  const failure =
    conn.status === "failed" || conn.status === "replaced" || conn.status === "stopped"
      ? explainError({ code: conn.status === "stopped" ? "session/stopped" : conn.code, closeCode: conn.closeCode }, { host })
      : null;
  const plan = restart ? restartPlan(restart.from, restart.profile, capView) : null;

  const statsLine = stats ? (
    <>
      <span>
        <b>{stats.fps == null ? "–" : Math.round(stats.fps)}</b> fps
      </span>
      <span>
        <b>{fmtKbps(stats.kbps) || "–"}</b>
      </span>
      <span>
        <b>{stats.rttMs == null ? "–" : stats.rttMs}</b> ms
      </span>
      <span className="wb-rate-q">{verdict.words}</span>
    </>
  ) : null;

  const lead = (
    <span className="jp-conn rd-lead">
      <span className={`ag-conn ${CONN_TONE[conn.status] || "idle"}`} role="status" title={connLabel}>
        <i aria-hidden="true" />
        {viewing ? connLabel : phase === "ready" ? "Connected to the desk" : "Not connected"}
      </span>
      {phase !== "idle" ? (
        <button type="button" className="jp-link rd-disconnect" onClick={disconnectNow}>
          Disconnect
        </button>
      ) : null}
      {live ? (
        <>
          <span className={`wb-meter l-${verdict.level}`} title={verdict.words} aria-hidden="true">
            <i style={{ width: `${Math.round(verdict.meter * 100)}%` }} />
          </span>
          <button
            type="button"
            className={`wb-rate rd-rate l-${verdict.level}`}
            aria-expanded={details}
            aria-controls="rd-stats"
            title="All the link measurements"
            onClick={() => setDetails((x) => !x)}
          >
            {statsLine || <span>measuring</span>}
          </button>
        </>
      ) : null}
    </span>
  );

  const mid = viewing ? (
    <>
      <p className={`wb-drive wb-sr${drive ? " on" : ""}`} role="status" aria-live="polite">
        {drive ? (keysOn ? "Driving: pointer and keys go to the desktop" : "Driving: click the picture to send keys") : "Watching only"}
      </p>
      <div className="wb-mode" role="group" aria-label="Watch or drive the desktop">
        <button type="button" className={`wb-watch${!drive ? " on" : ""}`} aria-pressed={!drive} disabled={!live} onClick={() => setDrive(false)}>
          Watch
        </button>
        <button type="button" className={`wb-take${drive ? " on" : ""}`} aria-pressed={drive} disabled={!live || !input} onClick={() => setDrive(!drive)}>
          Drive
        </button>
      </div>
    </>
  ) : null;

  const tools = viewing ? (
    <>
      <label className="rd-prof">
        <span className="wb-sr">Picture quality</span>
        <select
          className="rd-prof-sel"
          value={current}
          disabled={!live || !input}
          onChange={(e) => changeProfile(e.target.value)}
          title="The box encodes in software: 1080p60 only when it is the only session"
        >
          {PROFILES.map((p) => {
            const ok = canSwitchTo(p.id, null, sessionCount);
            return (
              <option key={p.id} value={p.id} disabled={!ok.allowed && p.id !== current}>
                {p.id}
                {!ok.allowed && p.id !== current ? " (only alone)" : ""}
              </option>
            );
          })}
        </select>
      </label>
      <button type="button" className={`wb-icon${clipOpen ? " on" : ""}`} aria-pressed={clipOpen} aria-label="Clipboard" title="Send text to the desktop's clipboard, or get its clipboard" disabled={!live} onClick={() => setClipOpen((x) => !x)}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M7 4h6v2.5H7zM5.5 5H4v12h12V5h-1.5" />
        </svg>
      </button>
      {drive ? (
        <button type="button" className={`wb-icon rd-lock${locked ? " on" : ""}`} aria-pressed={locked} aria-label="Pointer lock" title="Lock the pointer to the picture (Esc releases it)" onClick={toggleLock}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6 9V6.5a4 4 0 0 1 8 0V9M4.5 9h11v8h-11z" />
          </svg>
        </button>
      ) : null}
      <button type="button" className="wb-icon" aria-label={full ? "Leave full screen" : "Full screen"} title="Full screen" disabled={!live} onClick={toggleFull}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5" />
        </svg>
      </button>
      <button type="button" className="wb-icon" aria-label="Reconnect" title="Reconnect to this session" onClick={reconnect}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2" />
        </svg>
      </button>
    </>
  ) : null;

  const trailEl = trail;

  const ar = videoSize.w / videoSize.h || 16 / 9;

  return (
    <div className={`rd-root${viewing ? " viewing" : ""}`} data-phase={phase} data-conn={conn.status}>
      {phase === "idle" || phase === "loading" || phase === "down" ? (
        <div className={`jp-blank rd-blank${phase === "down" ? " is-down" : ""}`}>
          {phase === "down" && problem ? (
            <div className="jp-down rd-down" role="alert" aria-label="Remote desk unreachable">
              <p className="jp-line">{problem.what}</p>
              <p className="jp-what">{problem.todo}</p>
              <div className="rd-acts">
                <button type="button" className="admin-primary jp-connect-btn rd-connect" onClick={connectNow}>
                  Try again
                </button>
                {problem.legacy && onLegacy ? (
                  <button type="button" className="ag-ghost rd-legacy" onClick={onLegacy}>
                    Use the legacy stream
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="jp-down rd-idle" aria-label="Not connected">
              <p className="jp-line">{phase === "loading" ? "Asking the desk for its sessions…" : "The desktop appears here once you connect."}</p>
              <p className="jp-what">Nothing connects until you ask. Leaving this tab closes the connection.</p>
              <button type="button" className="admin-primary jp-connect-btn rd-connect" onClick={connectNow} disabled={phase === "loading"}>
                Connect<code>{host}</code>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          ref={screenRef}
          className={`wb-screen rd-screen${live ? " live" : ""}${drive ? " driving" : ""}${drive && keysOn ? " keys" : ""}${full ? " full" : ""}`}
          style={{ aspectRatio: `${videoSize.w} / ${videoSize.h}`, "--rd-ar": ar }}
          tabIndex={drive ? 0 : -1}
          aria-label={drive ? "The box's desktop. Pointer and keys go to it while this has focus." : "The box's desktop"}
          onFocus={() => setKeysOn(true)}
          onBlur={() => {
            setKeysOn(false);
            if (driveRef.current) sender()?.releaseAll("focus");
          }}
        >
          <video
            ref={videoRef}
            className="rd-video"
            autoPlay
            playsInline
            muted
            disablePictureInPicture
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) setVideoSize({ w: v.videoWidth, h: v.videoHeight });
            }}
            onResize={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) setVideoSize({ w: v.videoWidth, h: v.videoHeight });
            }}
            onPointerMove={onPointerMove}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(e) => drive && e.preventDefault()}
          />
          {!live ? (
            <div className="wb-screen-empty rd-veil">
              {failure ? (
                <div className="rd-fail" role="alert">
                  <p className="rd-fail-what">{failure.what}</p>
                  <p>{failure.todo}</p>
                  <div className="rd-acts">
                    {conn.status === "stopped" ? (
                      <button type="button" className="admin-primary rd-to-list" onClick={() => setListOpen(true)}>
                        Pick another session
                      </button>
                    ) : (
                      <button type="button" className="admin-primary" onClick={reconnect}>
                        Reconnect
                      </button>
                    )}
                    {failure.legacy && onLegacy ? (
                      <button type="button" className="ag-ghost rd-legacy" onClick={onLegacy}>
                        Use the legacy stream
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p>
                  {!viewing
                    ? "Pick a session below to view it, or start one."
                    : switching
                    ? `Switching to ${conn.profile || "the new profile"}: the box rebuilt the stream${conn.fps ? ` at ${conn.fps} fps` : ""}. Input comes back when the new channel opens.`
                    : conn.status === "negotiating"
                    ? "Negotiating the relay: TURN over TCP 443."
                    : conn.status === "reconnecting"
                    ? `The connection dropped. ${connLabel}.`
                    : conn.status === "ended"
                    ? "The session ended the connection. Reconnect to watch it again."
                    : `Signalling through ${host}.`}
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}

      <DeskBar lead={lead} mid={mid} tools={tools} trail={trailEl} />

      {details && live && stats ? (
        <p id="rd-stats" className="wb-rate rd-stats" aria-label="Link measurements">
          <span>{stats.fps == null ? "–" : stats.fps} fps</span>
          <span>{fmtKbps(stats.kbps) || "–"}</span>
          <span>RTT {stats.rttMs == null ? "–" : `${stats.rttMs} ms`}</span>
          <span>jitter {stats.jitterMs == null ? "–" : `${stats.jitterMs} ms`}</span>
          <span>loss {stats.lossPct == null ? "–" : `${stats.lossPct}%`}</span>
          <span>decode {stats.decodeMs == null ? "–" : `${stats.decodeMs} ms`}</span>
          <span>{stats.width ? `${stats.width}×${stats.height}` : "–"}</span>
          {server ? (
            <>
              <span title="What the box is sending, by its own count">box {fmtKbps(server.kbps) || "–"}</span>
              <span>encode {server.encodeMs != null ? `${server.encodeMs} ms` : "–"}</span>
              <span>encoded {server.encodedFps != null ? `${server.encodedFps} fps` : "–"}</span>
              <span title={server.droppedTotal != null ? `${server.droppedTotal} dropped since the stream started` : ""}>
                dropped {server.droppedPerSec != null ? `${server.droppedPerSec}/s` : "–"}
              </span>
            </>
          ) : null}
        </p>
      ) : null}

      {stepUp ? (
        <div className={`wb-stepup rd-stepup${stepUp === "server" ? " from-desk" : ""}`} role="alert" data-why={stepUp}>
          <p>
            {stepUp === "server"
              ? "The desk stopped taking your input: your sign-in is more than 30 minutes old, and it checks that itself. Sign in again and Drive picks up where it was."
              : "Driving the desktop needs a sign-in from the last 30 minutes. Confirm it is you and Drive turns on."}
          </p>
          <button type="button" className="admin-primary" onClick={confirmStepUp}>
            Sign in again
          </button>
          <button type="button" className="ag-ghost" onClick={() => setStepUp("")}>
            Keep watching
          </button>
        </div>
      ) : null}

      {restart && plan ? (
        <RestartOffer
          r={restart}
          plan={plan}
          onStart={startRestart}
          onStopOld={stopOld}
          onDismiss={() => setRestart(null)}
          stopping={busy === `stop:${restart.from?.id}`}
        />
      ) : null}

      {clipOpen && viewing ? (
        <section className="rd-clip" aria-label="Clipboard">
          <form className="rd-clip-send" onSubmit={sendClip}>
            <textarea
              className="admin-input rd-clip-text"
              rows={2}
              value={clipText}
              onChange={(e) => setClipText(e.target.value)}
              placeholder="Text for the desktop's clipboard"
              aria-label="Text for the desktop's clipboard"
            />
            <div className="rd-acts">
              <button type="button" className="ag-ghost" onClick={pasteHere}>
                Paste from this device
              </button>
              <button type="submit" className="ag-ghost rd-clip-go" disabled={!drive || !clipText || !input} title={drive ? "" : "Drive to send"}>
                {drive ? "Send to the desktop" : "Drive to send"}
              </button>
              <button type="button" className="ag-ghost rd-clip-pull" disabled={!input} onClick={pullClip}>
                Get the desktop&apos;s clipboard
              </button>
            </div>
          </form>
          {remoteClip !== null ? (
            <div className="rd-clip-in">
              <pre className="rd-clip-got">{remoteClip || "(empty)"}</pre>
              <button type="button" className="ag-ghost rd-clip-copy" disabled={!remoteClip} onClick={copyHere}>
                Copy to this device
              </button>
            </div>
          ) : null}
          {clipNote ? (
            <p className="wb-note" role="status">
              {clipNote}
            </p>
          ) : null}
        </section>
      ) : null}

      {note ? (
        <p className="wb-note rd-note" role="status" aria-live="polite">
          {note}
        </p>
      ) : null}

      {phase === "ready" ? (
        <section className={`rd-sessions${listOpen ? " open" : ""}`} aria-label="Desktop sessions">
          <header className="rd-sess-head">
            <h3 className="rd-sess-h">
              Sessions <em>{sessions.filter((s) => isLive(s.state)).length}</em>
            </h3>
            <button type="button" className="rd-sess-toggle" aria-expanded={listOpen} onClick={() => setListOpen((x) => !x)}>
              Sessions <em>{sessions.filter((s) => isLive(s.state)).length}</em>
            </button>
            <p className="rd-cap" data-full={capView.full ? "1" : "0"}>
              <span>
                {capView.running} of {capView.max} running
              </span>
              <span>1080p60 only when it is the only session</span>
            </p>
            <button type="button" className="jp-link rd-refresh" onClick={() => load().catch((e) => setNote(explainError(e, { host }).what))}>
              Refresh
            </button>
          </header>
          <div className="rd-sess-body">
            {!sessions.length ? <p className="wb-empty">No sessions yet. Start one: each is its own desktop, with its own user and limits on the box.</p> : null}
            <ol className="rd-sess-list">
              {sessions.map((s) => (
                <SessionRow
                  key={s.id}
                  s={s}
                  now={now}
                  current={viewing && viewing.id === s.id}
                  busy={busy === `stop:${s.id}`}
                  onView={() => view(s)}
                  onStop={() => stop(s)}
                />
              ))}
            </ol>
            <form className="rd-new" onSubmit={create}>
              <input
                className="admin-input rd-new-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  idem.current = newIdempotencyKey();
                }}
                placeholder="Name, e.g. kontainer"
                aria-label="New session name"
                maxLength={60}
                disabled={capView.full}
              />
              <select
                className="admin-input rd-new-prof"
                value={profile}
                onChange={(e) => {
                  setProfile(e.target.value);
                  idem.current = newIdempotencyKey();
                }}
                aria-label="New session quality"
                disabled={capView.full}
              >
                {PROFILES.map((p) => (
                  <option key={p.id} value={p.id} disabled={!capView.profiles[p.id].allowed}>
                    {p.id}
                    {!capView.profiles[p.id].allowed && !capView.full ? " (only alone)" : ""}
                  </option>
                ))}
              </select>
              <button type="submit" className="admin-primary rd-new-go" disabled={capView.full || !name.trim() || busy === "create" || !capView.profiles[profile]?.allowed}>
                {busy === "create" ? "Starting…" : "Start session"}
              </button>
              {capView.full ? <p className="wb-note rd-full">The box is full: stop a session to start another.</p> : null}
            </form>
          </div>
        </section>
      ) : null}

      <RemoteDeskStyles />
    </div>
  );
}

// The box refused a size change: a running desktop cannot be resized. Say
// that plainly, then offer the one way through (a new session at that size,
// beside this one), and once on it, the old one is still running: offer to
// stop it, two taps, or leave it.
function RestartOffer({ r, plan, onStart, onStopOld, onDismiss, stopping }) {
  const [armed, press] = useArmed();
  const from = r.from || {};
  const fromName = from.name || from.id || "this session";
  if (r.phase === "moved") {
    return (
      <div className="wb-stepup rd-restart moved" role="status" data-phase="moved">
        <p>
          Now on <b>{(r.to && (r.to.name || r.to.id)) || plan.name}</b> at {r.profile}. <b>{fromName}</b> is still running at {from.profile}.
        </p>
        <button type="button" className={`ag-ghost danger rd-restart-stop${armed ? " armed" : ""}`} disabled={stopping} onClick={() => press(onStopOld)}>
          {stopping ? "Stopping…" : armed ? `Tap again to stop ${fromName}` : `Stop ${fromName}`}
        </button>
        <button type="button" className="ag-ghost rd-restart-keep" onClick={onDismiss}>
          Keep both
        </button>
      </div>
    );
  }
  return (
    <div className="wb-stepup rd-restart" role="alert" data-phase={r.phase}>
      <p>
        {r.profile} is a different size from {from.profile || "this session"}, and a running desktop cannot change size. It needs a new session; this one keeps running.
        {!plan.allowed ? <span className="rd-restart-why"> {plan.reason}</span> : null}
        {r.error ? <span className="rd-restart-why"> {r.error}</span> : null}
      </p>
      <button type="button" className="admin-primary rd-restart-go" disabled={!plan.allowed || r.phase === "starting"} onClick={onStart}>
        {r.phase === "starting" ? "Starting…" : `Start a ${r.profile} session and view it`}
      </button>
      <button type="button" className="ag-ghost rd-restart-keep" onClick={onDismiss}>
        Stay on {from.profile || "this one"}
      </button>
    </div>
  );
}

function SessionRow({ s, now, current, busy, onView, onStop }) {
  const [armed, press] = useArmed();
  const st = s.state;
  return (
    <li className={`rd-sess s-${st.toLowerCase()}${current ? " current" : ""}`} data-state={st} data-id={s.id} aria-current={current ? "true" : undefined}>
      <div className="rd-sess-tx">
        <p className="rd-sess-name">{s.name || s.id}</p>
        <p className="rd-sess-meta">
          <span className="rd-sess-st">{STATE_WORD[st] || st}</span>
          <span>{s.profile}</span>
          {s.width ? (
            <span>
              {s.width}×{s.height}
            </span>
          ) : null}
          {s.createdAt ? <span>started {ago(s.createdAt, now)}</span> : null}
        </p>
      </div>
      <div className="rd-sess-acts">
        {viewable(st) ? (
          <button type="button" className="ag-ghost rd-view" disabled={current} onClick={onView}>
            {current ? "Viewing" : "View"}
          </button>
        ) : null}
        {stoppable(st) ? (
          <button type="button" className={`ag-ghost danger rd-stop${armed ? " armed" : ""}`} disabled={busy} onClick={() => press(onStop)}>
            {busy ? "Stopping…" : armed ? "Tap again to stop" : "Stop"}
          </button>
        ) : null}
      </div>
    </li>
  );
}
