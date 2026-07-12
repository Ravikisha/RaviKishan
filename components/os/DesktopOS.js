import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search, LayoutGrid, Sun, Moon, FolderGit2 } from "lucide-react";
import { APPS, getApp } from "./apps";
import { useTheme } from "../utils/ThemeProvider";
import { useSiteContent } from "../../lib/useSiteContent";
import { Kbd, keysFor, shortcutById } from "../../lib/shortcuts";
import { WD, MO, monthMatrix, ZONES, timeIn, pad } from "../../lib/datetime";
import Widgets from "./Widgets";
import Wallpaper from "./Wallpaper";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const Z_CTX = 150000;
const Z_DOCK = 100000;
const Z_FULL = 200000;
const Z_LAUNCH = 300000;
const LS_WIDGETS = "os:widgets";

const openUrl = (u) => u && typeof window !== "undefined" && window.open(u, "_blank", "noopener");

const MIN_W = 340;
const MIN_H = 240;
const DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const MENUBAR_H = 30;   // reserved top strip for the menu bar
const DOCK_RESERVE = 88; // reserved bottom strip for the dock
const SNAP_EDGE = 16;   // px from a screen edge that arms a drag-snap
const LS_WINS = "os:wins";

// target rectangle for a snap zone within the usable desktop area
const snapRect = (zone, vw, vh) => {
  const top = MENUBAR_H + 6;
  const bottom = vh - DOCK_RESERVE;
  const h = Math.max(MIN_H, bottom - top);
  const halfW = Math.floor(vw / 2);
  const halfH = Math.floor(h / 2);
  switch (zone) {
    case "left":  return { x: 0, y: top, w: halfW, h };
    case "right": return { x: vw - halfW, y: top, w: halfW, h };
    case "max":   return { x: 0, y: top, w: vw, h };
    case "tl":    return { x: 0, y: top, w: halfW, h: halfH };
    case "tr":    return { x: vw - halfW, y: top, w: halfW, h: halfH };
    default:      return null;
  }
};

// which snap zone (if any) the pointer is hovering while dragging a title bar
const zoneFromPointer = (x, y, vw) => {
  const nearL = x <= SNAP_EDGE, nearR = x >= vw - SNAP_EDGE;
  const nearT = y <= MENUBAR_H + SNAP_EDGE;
  if (nearT && nearL) return "tl";
  if (nearT && nearR) return "tr";
  if (nearT) return "max";
  if (nearL) return "left";
  if (nearR) return "right";
  return null;
};

/* ============================ Window ============================ */
function Win({ win, app, onClose, onMin, onFull, onFocus, onMove, onResize, onSnap, onSnapHint }) {
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [closing, setClosing] = useState(false);
  const winRef = useRef(null);
  const genieRef = useRef(null);   // active minimize/restore Animation
  const prevMin = useRef(win.min); // detect the min↔restore transition

  // move keyboard focus into a freshly opened window (announces the dialog)
  useEffect(() => {
    const t = setTimeout(() => winRef.current?.focus({ preventScroll: true }), 40);
    return () => clearTimeout(t);
  }, []);

  // macOS "genie": the window necks into a thin column that gets sucked down
  // into its own dock icon (reversed on restore). Driven with the Web Animations
  // API so it can multi-keyframe + reverse without touching the CSS `animation`
  // property that owns the open-pop. transform-origin at bottom-centre gives the
  // funnel; scaleX collapses first (the neck), scaleY drains last (the drop).
  useLayoutEffect(() => {
    const el = winRef.current;
    const was = prevMin.current;
    prevMin.current = win.min;
    if (!el || win.min === was || win.full) return; // only on the actual toggle

    // geometry: window bottom-centre → dock-tile centre (fall to bottom if none)
    const tile = document.querySelector(`[data-osdock="${win.id}"]`);
    const bx = win.x + win.w / 2, by = win.y + win.h;
    let gx = 0, gy = window.innerHeight - by + 40;
    if (tile) { const r = tile.getBoundingClientRect(); gx = r.left + r.width / 2 - bx; gy = r.top + r.height / 2 - by; }

    genieRef.current?.cancel();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { el.style.opacity = win.min ? "0" : ""; return; }

    el.style.transformOrigin = "50% 100%";
    const frames = [
      { transform: "translate(0px,0px) scale(1,1)", borderRadius: "12px", opacity: 1, offset: 0 },
      { transform: `translate(${gx * 0.12}px,${gy * 0.05}px) scale(.82,1.03)`, opacity: 1, offset: 0.22 },
      { transform: `translate(${gx * 0.72}px,${gy * 0.45}px) scale(.18,.8)`, borderRadius: "26px", opacity: 1, offset: 0.62 },
      { transform: `translate(${gx}px,${gy}px) scale(.05,.04)`, borderRadius: "50%", opacity: 0, offset: 1 },
    ];
    const anim = el.animate(frames, {
      duration: win.min ? 500 : 440,
      easing: win.min ? "cubic-bezier(.4,.02,.25,1)" : "cubic-bezier(.2,.7,.3,1)",
      fill: "forwards",
      direction: win.min ? "normal" : "reverse",
    });
    genieRef.current = anim;
    // on restore, drop the held transform so normal styles resume cleanly
    if (!win.min) anim.onfinish = () => { anim.cancel(); el.style.transformOrigin = ""; el.style.opacity = ""; };
  }, [win.min, win.full, win.id, win.x, win.y, win.w, win.h]);

  const onTitleDown = (e) => {
    if (win.full || e.button !== 0) return;
    onFocus(win.id);
    const sx = e.clientX, sy = e.clientY, ox = win.x, oy = win.y;
    setDragging(true);
    let zone = null;
    const move = (ev) => {
      onMove(
        win.id,
        clamp(ox + ev.clientX - sx, -win.w + 100, window.innerWidth - 100),
        clamp(oy + ev.clientY - sy, 8, window.innerHeight - 60)
      );
      // drag-to-edge tiling: highlight a snap zone as the pointer nears an edge
      zone = zoneFromPointer(ev.clientX, ev.clientY, window.innerWidth);
      onSnapHint(zone);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onSnapHint(null);
      if (zone) onSnap(win.id, zone);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startResize = (dir) => (e) => {
    if (win.full || e.button !== 0) return;
    e.stopPropagation();
    onFocus(win.id);
    const sx = e.clientX, sy = e.clientY;
    const { x, y, w, h } = win;
    setResizing(true);
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let nx = x, ny = y, nw = w, nh = h;
      if (dir.includes("e")) nw = Math.max(MIN_W, w + dx);
      if (dir.includes("s")) nh = Math.max(MIN_H, h + dy);
      if (dir.includes("w")) { nw = clamp(w - dx, MIN_W, x + w); nx = x + (w - nw); }
      if (dir.includes("n")) { nh = clamp(h - dy, MIN_H, y + h); ny = y + (h - nh); }
      onResize(win.id, { x: nx, y: ny, w: nw, h: nh });
    };
    const up = () => {
      setResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const close = () => {
    setClosing(true);
    setTimeout(() => onClose(win.id), 200);
  };

  const Body = app.Component;
  const cls = [
    "os-win",
    win.full ? "full" : "",
    win.min ? "min" : "",
    dragging || resizing ? "static" : "",
    closing ? "closing" : "",
    app.dark ? "dark" : "",
  ].join(" ");

  const style = win.full
    ? { zIndex: Z_FULL }
    : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z };

  return (
    <div
      className={cls}
      style={style}
      onPointerDown={() => onFocus(win.id)}
      ref={winRef}
      role="dialog"
      aria-label={`${app.name} — ${app.tag}`}
      tabIndex={-1}
    >
      <div className="os-title" onPointerDown={onTitleDown} onDoubleClick={() => onFull(win.id)}>
        <span className="os-lights" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button className="os-l red" onClick={close} aria-label="Close">
            <svg viewBox="0 0 12 12"><path d="M4.2 4.2 L7.8 7.8 M7.8 4.2 L4.2 7.8" /></svg>
          </button>
          <button className="os-l yellow" onClick={() => onMin(win.id)} aria-label="Minimize">
            <svg viewBox="0 0 12 12"><path d="M3.8 6 H8.2" /></svg>
          </button>
          <button className="os-l green" onClick={() => onFull(win.id)} aria-label="Full screen">
            <svg viewBox="0 0 12 12" className="fill"><path d="M3.4 3.4 H7 L3.4 7 Z" /><path d="M8.6 8.6 H5 L8.6 5 Z" /></svg>
          </button>
        </span>
        <span className="os-title-tx">
          {app.name}
          <em>— {app.tag}</em>
        </span>
      </div>
      <div className="os-body">
        <Body />
      </div>
      {!win.full &&
        DIRS.map((d) => (
          <div key={d} className={`os-rz ${d}`} onPointerDown={startResize(d)} />
        ))}
    </div>
  );
}

/* ============================ Dock ============================ */
function Dock({ wins, apps, onSelect, onLaunchpad, launchOpen }) {
  const [mx, setMx] = useState(null);
  const scale = (el) => {
    if (mx == null || !el) return 1;
    const r = el.getBoundingClientRect();
    return clamp(1.55 - Math.abs(mx - (r.left + r.width / 2)) / 120, 1, 1.55);
  };
  const anyFull = wins.some((w) => w.full && !w.min);
  if (anyFull) return null; // fullscreen hides the dock (macOS behaviour)

  return (
    <div className="os-dock-wrap" style={{ zIndex: Z_DOCK }}>
      <div className="os-dock" role="toolbar" aria-label="Dock" onPointerMove={(e) => setMx(e.clientX)} onPointerLeave={() => setMx(null)}>
        {wins.map((w) => {
          const a = apps.find((x) => x.id === w.appId);
          if (!a) return null;
          const Icon = a.icon;
          return (
            <button
              key={w.id}
              data-osdock={w.id}
              className={`os-dock-item ${w.min ? "min" : ""}`}
              ref={(el) => el && (el.style.transform = `scale(${scale(el)})`)}
              onClick={() => onSelect(w.id)}
              title={a.name}
              aria-label={`${a.name}${w.min ? ", minimized" : ", open"}`}
            >
              <span className="os-dock-ic" style={{ "--a": a.accent }}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="os-dock-tip">{a.name}</span>
              <span className="os-dock-dot" />
            </button>
          );
        })}

        {wins.length > 0 && <span className="os-dock-sep" />}

        <button
          className={`os-dock-item launch ${launchOpen ? "active" : ""}`}
          ref={(el) => el && (el.style.transform = `scale(${scale(el)})`)}
          onClick={onLaunchpad}
          title="All apps"
          aria-label="All apps — open Spotlight"
          aria-haspopup="dialog"
          aria-expanded={launchOpen}
        >
          <span className="os-dock-ic launch-ic">
            <LayoutGrid className="h-5 w-5" />
          </span>
          <span className="os-dock-tip">All apps</span>
        </button>
      </div>
    </div>
  );
}

/* ============================ Spotlight / Launchpad ============================ */
function Launchpad({ open, onClose, onLaunch }) {
  const { projects } = useSiteContent();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement; // restore focus on close
    setQ("");
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => { clearTimeout(t); if (opener && opener.focus) opener.focus(); };
  }, [open]);
  if (!open) return null;

  const ql = q.trim().toLowerCase();
  const launch = (a) => { onClose(); a.external ? a.external() : onLaunch(a.id); };

  // keep focus inside the dialog while it's open
  const onTrap = (e) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const f = [...panelRef.current.querySelectorAll('button,input,[tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const appGrid = APPS.filter(
    (a) => a.name.toLowerCase().includes(ql) || a.tag.toLowerCase().includes(ql)
  );

  // content search — apps + projects (jump straight to the repo/link)
  const appHits = appGrid.map((a) => ({
    key: "app-" + a.id, type: "App", label: a.name, sub: a.tag, icon: a.icon,
    accent: a.accent, desktopOnly: a.desktopOnly, run: () => launch(a),
  }));
  const projHits = ql
    ? (projects || [])
        .filter((p) => {
          const hay = `${p.name} ${(p.skills || []).join(" ")} ${(p.tags || []).join(" ")} ${p.description || ""}`.toLowerCase();
          return hay.includes(ql);
        })
        .slice(0, 8)
        .map((p) => ({
          key: "proj-" + p.name, type: "Project", label: p.name,
          sub: (p.skills || []).slice(0, 3).join(" · "), icon: FolderGit2, accent: "#FFB020",
          run: () => { onClose(); const u = p.github || p.link || p.docs; u ? openUrl(u) : onLaunch("projects"); },
        }))
    : [];
  const results = [...appHits, ...projHits];

  return (
    <div className="os-lp" style={{ zIndex: Z_LAUNCH }} onMouseDown={onClose}>
      <div
        className="os-lp-in"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Spotlight — search apps and projects"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onTrap}
      >
        <div className="os-lp-search">
          <Search className="h-5 w-5" aria-hidden="true" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search apps, projects, skills…"
            aria-label="Search apps, projects and skills"
            role="combobox"
            aria-controls="os-sp-list"
            aria-expanded={ql.length > 0}
            aria-activedescendant={ql && results[active] ? "sp-" + active : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && ql) { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
              else if (e.key === "ArrowUp" && ql) { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === "Enter") { const r = ql ? results[active] : results[0]; if (r) r.run(); }
              else if (e.key === "Escape") onClose();
            }}
          />
        </div>

        {ql ? (
          <div className="os-sp-results" id="os-sp-list" role="listbox" aria-label="Results">
            {results.length === 0 && <p className="os-sp-empty">No matches for “{q}”.</p>}
            {results.map((r, i) => {
              const Icon = r.icon;
              return (
                <button
                  key={r.key}
                  id={"sp-" + i}
                  role="option"
                  aria-selected={i === active}
                  className={`os-sp-row${i === active ? " active" : ""}${r.desktopOnly ? " os-desktop-only" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={r.run}
                >
                  <span className="os-sp-ic" style={{ "--a": r.accent }} aria-hidden="true"><Icon className="h-4 w-4" /></span>
                  <span className="os-sp-tx"><b>{r.label}</b><em>{r.sub}</em></span>
                  <span className="os-sp-type">{r.type}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="os-lp-grid">
            {APPS.map((a) => {
              const Icon = a.icon;
              return (
                <button key={a.id} className={`os-lp-app${a.desktopOnly ? " os-desktop-only" : ""}`} onClick={() => launch(a)}>
                  <span className="os-lp-ic" style={{ "--a": a.accent }}><Icon className="h-8 w-8" /></span>
                  <span className="os-lp-name">{a.name}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="os-lp-hint">
          <span><Kbd keys={keysFor(shortcutById("search"))} /> search</span>
          <span><Kbd keys={keysFor(shortcutById("fullscreen"))} /> full-screen</span>
          <span><Kbd keys={keysFor(shortcutById("shortcuts"))} /> all shortcuts</span>
          <span><Kbd keys={keysFor(shortcutById("escape"))} /> close</span>
        </div>
      </div>
    </div>
  );
}

/* ============================ Context menu ============================ */
function ContextMenu({ ctx, onClose, onLaunchpad, widgets, onToggleWidgets, onCascade, onMinAll, onOpen }) {
  const menuRef = useRef(null);
  useEffect(() => {
    if (!ctx) return;
    const t = setTimeout(() => menuRef.current?.querySelector("button")?.focus(), 20);
    return () => clearTimeout(t);
  }, [ctx]);
  if (!ctx) return null;

  const x = Math.min(ctx.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 220);
  const y = Math.min(ctx.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 300);
  const act = (fn) => () => { onClose(); fn(); };

  const onKey = (e) => {
    const items = [...(menuRef.current?.querySelectorAll("button") || [])];
    const i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); (items[i + 1] || items[0])?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (items[i - 1] || items[items.length - 1])?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
  };

  return (
    <div className="os-ctx-layer" style={{ zIndex: Z_CTX }} onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        className="os-ctx"
        style={{ left: x, top: y }}
        ref={menuRef}
        role="menu"
        aria-label="Desktop"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
          <>
            <button role="menuitem" className="os-ctx-item" onClick={act(onLaunchpad)}>New Window…</button>
            <button role="menuitemcheckbox" aria-checked={widgets} className="os-ctx-item" onClick={act(onToggleWidgets)}>{widgets ? "Hide" : "Show"} Widgets</button>
            <div className="os-ctx-div" role="separator" />
            <button role="menuitem" className="os-ctx-item" onClick={act(onCascade)}>Arrange Windows</button>
            <button role="menuitem" className="os-ctx-item" onClick={act(onMinAll)}>Minimize All</button>
            <div className="os-ctx-div" role="separator" />
            <button role="menuitem" className="os-ctx-item" onClick={act(() => onOpen("welcome"))}>About This Desktop</button>
          </>
      </div>
    </div>
  );
}

/* ===================== Date/time flyout (menu bar) ===================== */
function DateTimePopover({ onOpen, onClose }) {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    const onDoc = (e) => { if (!e.target.closest(".os-dt, .os-mb-clock")) onClose(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDoc);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDoc); };
  }, [onClose]);

  const y = t.getFullYear(), m = t.getMonth(), today = t.getDate();
  const cells = monthMatrix(y, m);

  return (
    <div className="os-dt" role="dialog" aria-label="Date and time">
      <div className="os-dt-top">
        <div className="os-dt-day">{t.toLocaleDateString("en-US", { weekday: "long" })}</div>
        <div className="os-dt-date">{MO[m]} {today}</div>
        <div className="os-dt-time">
          {pad(t.getHours())}:{pad(t.getMinutes())}<span>:{pad(t.getSeconds())}</span>
          <em>{ZONES[0].label} · {timeIn(t, "UTC")} UTC</em>
        </div>
      </div>

      <div className="os-dt-cal">
        <div className="os-dt-wd">{WD.map((d) => <span key={d}>{d[0]}</span>)}</div>
        <div className="os-dt-grid">
          {cells.map((d, i) => (
            <span key={i} className={`os-dt-cell${d === today ? " today" : ""}${d ? "" : " empty"}`}>{d || ""}</span>
          ))}
        </div>
      </div>

      <button className="os-dt-open" onClick={() => { onClose(); onOpen("calendar"); }}>
        Open Calendar →
      </button>
    </div>
  );
}

/* ============================ Menu bar ============================ */
function MenuBar({ wins, apps, onOpen, onLaunchpad }) {
  const { theme, toggleTheme } = useTheme();
  const [now, setNow] = useState("");
  const [menu, setMenu] = useState(false);
  const [cal, setCal] = useState(false);
  const [mounted, setMounted] = useState(false);
  const logoRef = useRef(null);
  const mbMenuRef = useRef(null);
  useEffect(() => setMounted(true), []);

  // focus the first item when the ◆ menu opens
  useEffect(() => {
    if (menu) { const t = setTimeout(() => mbMenuRef.current?.querySelector("button")?.focus(), 20); return () => clearTimeout(t); }
  }, [menu]);
  const onMenuKey = (e) => {
    const items = [...(mbMenuRef.current?.querySelectorAll("button") || [])];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); (items[i + 1] || items[0])?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (items[i - 1] || items[items.length - 1])?.focus(); }
  };

  useEffect(() => {
    const t = () => {
      const d = new Date();
      const wd = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      const tm = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      setNow(`${wd}  ${tm}`);
    };
    t();
    const id = setInterval(t, 20000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e) => { if (!e.target.closest(".os-mb-menu, .os-mb-logo")) setMenu(false); };
    const onEsc = (e) => { if (e.key === "Escape") { setMenu(false); logoRef.current?.focus(); } };
    window.addEventListener("pointerdown", onDoc);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("pointerdown", onDoc);
      window.removeEventListener("keydown", onEsc);
    };
  }, [menu]);

  const anyFull = wins.some((w) => w.full && !w.min);
  if (anyFull) return null; // fullscreen hides the menu bar (macOS behaviour)

  const vis = wins.filter((w) => !w.min);
  const front = vis.length ? vis.reduce((a, b) => (b.z > a.z ? b : a)) : null;
  const frontApp = front ? apps.find((a) => a.id === front.appId) : null;

  const act = (fn) => () => { setMenu(false); fn(); };

  return (
    <div className="os-menubar" role="menubar" aria-label="Menu bar">
      <div className="os-mb-left">
        <button
          className="os-mb-logo"
          ref={logoRef}
          onClick={() => setMenu((v) => !v)}
          aria-label="System menu"
          aria-haspopup="menu"
          aria-expanded={menu}
        >
          <img
            src="/assets/banner-image.png"
            alt=""
            aria-hidden="true"
            style={{ height: 16, width: 16, borderRadius: 4, objectFit: "cover", objectPosition: "52% 12%" }}
          />{" "}
          <span className="os-mb-first">Ravi</span>
          <span className="os-mb-last">&nbsp;Kishan</span>
        </button>
        <span className="os-mb-app">{frontApp ? frontApp.name : "Desktop"}</span>
        <span className="os-mb-fade" aria-hidden="true">Ravi Kishan</span>

        {menu && (
          <div className="os-mb-menu" role="menu" aria-label="System" ref={mbMenuRef} onKeyDown={onMenuKey}>
            <button role="menuitem" onClick={act(() => onOpen("about"))}>About Ravi Kishan</button>
            <button role="menuitem" className="os-desktop-only" onClick={act(() => onOpen("shortcuts"))}>Keyboard Shortcuts…</button>
            <div className="os-mb-div" />
            <button role="menuitem" onClick={act(() => onLaunchpad())}>All Apps…</button>
            <button role="menuitem" onClick={act(() => onOpen("terminal"))}>Open Terminal</button>
            <button role="menuitem" onClick={act(() => onOpen("system-monitor"))}>System Monitor</button>
            <div className="os-mb-div" />
            <button role="menuitem" onClick={act(() => toggleTheme())}>
              Switch to {mounted && theme === "dark" ? "Light" : "Dark"} theme
            </button>
          </div>
        )}
      </div>

      <div className="os-mb-right">
        <button className="os-mb-icon" onClick={toggleTheme} aria-label="Toggle theme">
          {mounted && theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
        <span className="os-mb-live"><span className="os-mb-dot" /> live</span>
        <button
          className="os-mb-clock"
          onClick={() => setCal((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={cal}
          aria-label="Show date and time"
        >
          {now || "—"}
        </button>
        {cal && <DateTimePopover onOpen={onOpen} onClose={() => setCal(false)} />}
      </div>
    </div>
  );
}

/* ============================ DesktopOS ============================ */
export default function DesktopOS() {
  const [wins, setWins] = useState([]);
  const [launch, setLaunch] = useState(false);
  const [snapHint, setSnapHint] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [widgets, setWidgets] = useState(true);
  const { theme, toggleTheme } = useTheme();
  const z = useRef(30);
  const nid = useRef(0);

  const focus = useCallback((id) => {
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, z: ++z.current } : w)));
  }, []);

  // spawns a NEW window (multiple instances) — unless the app is a singleton,
  // in which case an existing window is focused/restored instead.
  const openApp = useCallback((appId) => {
    const app = getApp(appId);
    if (!app) return;
    if (app.external) return app.external();
    setWins((ws) => {
      if (app.singleton) {
        const ex = ws.find((w) => w.appId === appId);
        if (ex) return ws.map((w) => (w.id === ex.id ? { ...w, min: false, z: ++z.current } : w));
      }
      const i = ws.length;
      const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
      const vh = typeof window !== "undefined" ? window.innerHeight : 800;
      const w = Math.min(app.w || 720, vw - 40);
      const h = Math.min(app.h || 520, vh - 150);
      const baseX = (vw - w) / 2 - 60;
      return [
        ...ws,
        {
          id: `${appId}#${++nid.current}`,
          appId,
          x: clamp(baseX + (i % 6) * 30, 12, vw - w - 12),
          y: clamp(84 + (i % 6) * 30, 72, vh - h - 120),
          w, h, z: ++z.current, min: false, full: false,
        },
      ];
    });
  }, []);

  const close = useCallback((id) => setWins((ws) => ws.filter((w) => w.id !== id)), []);
  const minimize = useCallback((id) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, min: true } : w))), []);
  // macOS-style dock toggle:
  //   minimized       → restore + focus
  //   frontmost       → minimize
  //   open but behind → bring to front
  const select = useCallback((id) => {
    setWins((ws) => {
      const w = ws.find((x) => x.id === id);
      if (!w) return ws;
      if (w.min) {
        return ws.map((x) => (x.id === id ? { ...x, min: false, z: ++z.current } : x));
      }
      const visible = ws.filter((x) => !x.min);
      const topZ = visible.length ? Math.max(...visible.map((x) => x.z)) : 0;
      if (w.z === topZ) {
        return ws.map((x) => (x.id === id ? { ...x, min: true } : x));
      }
      return ws.map((x) => (x.id === id ? { ...x, z: ++z.current } : x));
    });
  }, []);
  const toggleFull = useCallback(
    (id) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, full: !w.full, min: false, z: ++z.current } : w))),
    []
  );
  const move = useCallback((id, x, y) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, x, y } : w))), []);
  const resize = useCallback((id, patch) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w))), []);

  // bring the most-buried visible window to the front (window cycling)
  const cycle = useCallback(() => {
    setWins((ws) => {
      const vis = ws.filter((w) => !w.min);
      if (vis.length < 2) return ws;
      const back = vis.reduce((a, b) => (b.z < a.z ? b : a));
      return ws.map((w) => (w.id === back.id ? { ...w, z: ++z.current } : w));
    });
  }, []);

  // arrange all visible windows in a cascade; or minimize everything
  const cascade = useCallback(() => {
    setWins((ws) => {
      let k = 0;
      return ws.map((w) => (w.min ? w : { ...w, x: 44 + k * 30, y: 52 + k++ * 30, full: false, z: ++z.current }));
    });
  }, []);
  const minimizeAll = useCallback(() => setWins((ws) => ws.map((w) => ({ ...w, min: true }))), []);

  useEffect(() => {
    try {
      const wg = localStorage.getItem(LS_WIDGETS); if (wg != null) setWidgets(wg === "1");
    } catch (_) {}
  }, []);
  const toggleWidgets = useCallback(() => {
    setWidgets((v) => {
      const nv = !v;
      try { localStorage.setItem(LS_WIDGETS, nv ? "1" : "0"); } catch (_) {}
      return nv;
    });
  }, []);

  // right-click the empty desktop → context menu (native menu stays on windows,
  // dock, menu bar, links, inputs and buttons)
  useEffect(() => {
    const onCtx = (e) => {
      const t = e.target;
      if (t.closest && t.closest(".os-win, .os-dock, .os-menubar, .os-lp, .os-ctx, a, button, input, textarea, [contenteditable]")) return;
      e.preventDefault();
      setCtx({ x: e.clientX, y: e.clientY, view: "main" });
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);
  const closeCtx = useCallback(() => setCtx(null), []);

  // tile a window into a snap zone (drag-to-edge + keyboard)
  const applySnap = useCallback((id, zone) => {
    const r = snapRect(zone, window.innerWidth, window.innerHeight);
    if (!r) return;
    setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...r, full: false, min: false, z: ++z.current } : w)));
  }, []);

  // center + restore a window to its app's default size
  const centerWin = useCallback((id) => {
    setWins((ws) =>
      ws.map((w) => {
        if (w.id !== id) return w;
        const app = getApp(w.appId);
        const vw = window.innerWidth, vh = window.innerHeight;
        const wdt = Math.min(app?.w || 720, vw - 40);
        const hgt = Math.min(app?.h || 520, vh - MENUBAR_H - DOCK_RESERVE);
        return {
          ...w,
          w: wdt, h: hgt,
          x: Math.round((vw - wdt) / 2),
          y: Math.round((vh - hgt - MENUBAR_H) / 2) + MENUBAR_H,
          full: false, min: false, z: ++z.current,
        };
      })
    );
  }, []);

  // keep a live ref so the global keydown handler can read current windows
  const winsRef = useRef([]);
  winsRef.current = wins;
  const frontmost = () => {
    const vis = winsRef.current.filter((w) => !w.min);
    if (!vis.length) return null;
    return vis.reduce((a, b) => (b.z > a.z ? b : a)).id;
  };

  // ---- persistence: restore open windows on load, save on change ----
  const saveGuard = useRef(0);
  useEffect(() => {
    let restored = false;
    try {
      const raw = localStorage.getItem(LS_WINS);
      if (raw) {
        const saved = JSON.parse(raw);
        const valid = (saved.wins || []).filter((w) => getApp(w.appId));
        if (valid.length) {
          setWins(valid);
          z.current = Math.max(30, ...valid.map((w) => w.z || 30));
          nid.current = saved.nid || valid.length;
          restored = true;
        }
      }
    } catch (_) {}

    // first-run guidance: auto-open Welcome once, dev mode only, after the boot
    // sequence, and only on a fresh desktop (nothing restored)
    try {
      const mode = localStorage.getItem("mode") || "recruiter";
      const welcomed = localStorage.getItem("os:welcomed");
      if (mode !== "recruiter" && !welcomed && !restored) {
        localStorage.setItem("os:welcomed", "1");
        const t = setTimeout(() => openApp("welcome"), 2400);
        return () => clearTimeout(t);
      }
    } catch (_) {}
  }, [openApp]);
  useEffect(() => {
    if (saveGuard.current < 1) { saveGuard.current += 1; return; } // skip initial empty commit
    try {
      localStorage.setItem(LS_WINS, JSON.stringify({ wins, nid: nid.current }));
    } catch (_) {}
  }, [wins]);

  // deep-link: ?open=<appId> launches that app on load (shareable app links)
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get("open");
      if (p && getApp(p)) {
        const t = setTimeout(() => openApp(p), 400);
        return () => clearTimeout(t);
      }
    } catch (_) {}
  }, [openApp]);

  // inter-app command bus — the Terminal (and any app) drives the OS via os:cmd.
  // e.g.  theme · close · snap left · widgets · arrange
  useEffect(() => {
    const onCmd = (e) => {
      const { action, arg } = e.detail || {};
      const f = frontmost();
      switch (action) {
        case "theme":
          if (!arg || (arg === "dark") !== (theme === "dark")) toggleTheme();
          break;
        case "close": if (f) close(f); break;
        case "minimize": if (f) minimize(f); break;
        case "fullscreen": if (f) toggleFull(f); break;
        case "arrange": cascade(); break;
        case "widgets": toggleWidgets(); break;
        case "snap":
          if (f) { if (arg === "center") centerWin(f); else applySnap(f, arg); }
          break;
        default: break;
      }
    };
    window.addEventListener("os:cmd", onCmd);
    return () => window.removeEventListener("os:cmd", onCmd);
  }, [theme, toggleTheme, close, minimize, toggleFull, cascade, toggleWidgets, applySnap, centerWin]);

  useEffect(() => {
    const onOpen = (e) => openApp(e.detail);
    const onLp = () => setLaunch(true);
    const onKey = (e) => {
      const el = document.activeElement;
      const typing =
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      // always available — even while typing in a field
      if (mod && k === "k") { e.preventDefault(); setLaunch((v) => !v); return; }
      if (e.key === "Escape") {
        setLaunch(false);
        setCtx(null);
        setWins((ws) => ws.map((w) => (w.full ? { ...w, full: false } : w)));
        return;
      }
      // don't hijack typing for the rest (forms, terminal, search boxes)
      if (typing) return;

      // shortcuts cheat sheet — ⌘/Ctrl + / (reliable cross-platform), or bare ?
      if ((mod && e.key === "/") || e.key === "?") { e.preventDefault(); openApp("shortcuts"); return; }
      if (mod && e.altKey && k === "t") { e.preventDefault(); openApp("terminal"); return; }
      if (mod && e.altKey && k === "m") {
        const f = frontmost();
        if (f) { e.preventDefault(); minimize(f); }
        return;
      }
      if (mod && k === "enter") {
        const f = frontmost();
        if (f) { e.preventDefault(); toggleFull(f); }
        return;
      }
      if (mod && k === "backspace") {
        const f = frontmost();
        if (f) { e.preventDefault(); close(f); }
        return;
      }
      // window tiling — ⌘/Ctrl + ⌥/Alt + arrows
      if (mod && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const f = frontmost();
        if (!f) return;
        e.preventDefault();
        if (e.key === "ArrowLeft") applySnap(f, "left");
        else if (e.key === "ArrowRight") applySnap(f, "right");
        else if (e.key === "ArrowUp") applySnap(f, "max");
        else centerWin(f);
        return;
      }
      if (mod && e.key === "ArrowRight") { e.preventDefault(); cycle(); return; }
    };
    window.addEventListener("os:open", onOpen);
    window.addEventListener("os:launchpad", onLp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("os:open", onOpen);
      window.removeEventListener("os:launchpad", onLp);
      window.removeEventListener("keydown", onKey);
    };
  }, [openApp, minimize, toggleFull, close, cycle, applySnap, centerWin]);

  const snapPreview = snapHint ? snapRect(snapHint, typeof window !== "undefined" ? window.innerWidth : 0, typeof window !== "undefined" ? window.innerHeight : 0) : null;

  return (
    <>
      <Wallpaper />
      {widgets && <Widgets />}

      <MenuBar wins={wins} apps={APPS} onOpen={openApp} onLaunchpad={() => setLaunch(true)} />

      {wins.map((w) => (
        <Win
          key={w.id}
          win={w}
          app={getApp(w.appId)}
          onClose={close}
          onMin={minimize}
          onFull={toggleFull}
          onFocus={focus}
          onMove={move}
          onResize={resize}
          onSnap={applySnap}
          onSnapHint={setSnapHint}
        />
      ))}

      {/* drag-to-edge snap preview */}
      {snapPreview && (
        <div
          className="os-snap-preview"
          style={{ left: snapPreview.x, top: snapPreview.y, width: snapPreview.w, height: snapPreview.h }}
        />
      )}

      <Dock wins={wins} apps={APPS} onSelect={select} onLaunchpad={() => setLaunch((v) => !v)} launchOpen={launch} />
      <Launchpad open={launch} onClose={() => setLaunch(false)} onLaunch={openApp} />

      <ContextMenu
        ctx={ctx}
        onClose={closeCtx}
        onLaunchpad={() => setLaunch(true)}
        widgets={widgets}
        onToggleWidgets={toggleWidgets}
        onCascade={cascade}
        onMinAll={minimizeAll}
        onOpen={openApp}
      />

      <style jsx global>{`
        /* ---------- window ---------- */
        .os-win {
          position: fixed; display: flex; flex-direction: column;
          border-radius: 12px; overflow: hidden;
          background: var(--c-surface); border: 1px solid var(--c-edge);
          box-shadow: 0 28px 80px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3);
          transition: left .3s cubic-bezier(.16,1,.3,1), top .3s cubic-bezier(.16,1,.3,1),
            width .3s cubic-bezier(.16,1,.3,1), height .3s cubic-bezier(.16,1,.3,1),
            transform .28s cubic-bezier(.16,1,.3,1), opacity .2s ease, border-radius .3s;
          animation: oswin-in .3s cubic-bezier(.16,1,.3,1) both;
          transform-origin: center bottom;
        }
        .os-win.dark { background: #0a0b0f; border-color: #23262f; }
        .os-win.static { transition: none; user-select: none; }
        .os-win.full {
          left: 0 !important; top: 0 !important;
          width: 100vw !important; height: 100vh !important;
          border-radius: 0; border: none;
        }
        /* minimize = macOS genie: the WAAPI animation (see Win) owns the visual
           warp into the dock icon; this rule only stops interaction with the
           minimized window while its held final frame keeps it hidden. */
        .os-win.min { pointer-events: none; }
        /* close = quick collapse + fade, accelerating out */
        .os-win.closing {
          transform: scale(.86); opacity: 0; transform-origin: 50% 50%;
          transition: transform .2s cubic-bezier(.4,0,1,1), opacity .2s ease;
        }
        @keyframes oswin-in { from { transform: scale(.92) translateY(14px); opacity: 0; } }

        .os-title {
          display: flex; align-items: center; gap: 12px; flex-shrink: 0;
          height: 40px; padding: 0 14px; cursor: grab; touch-action: none;
          border-bottom: 1px solid var(--c-edge);
          background: linear-gradient(var(--c-surface), color-mix(in srgb, var(--c-surface) 92%, #000));
        }
        .os-title:active { cursor: grabbing; }
        .os-win.dark .os-title { background: linear-gradient(#15171e, #0f1116); border-color: #1c1f29; }
        .os-lights { display: flex; gap: 8px; }
        .os-l { display: grid; place-items: center; height: 12px; width: 12px; border-radius: 50%; border: none; cursor: pointer; padding: 0; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.22); }
        .os-l svg { width: 12px; height: 12px; display: block; }
        .os-l svg path { stroke: rgba(0,0,0,.55); stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; fill: none; }
        .os-l svg.fill path { fill: rgba(0,0,0,.55); stroke: none; }
        .os-l.red { background: #ff5f57; } .os-l.yellow { background: #febc2e; } .os-l.green { background: #28c840; }
        .os-l:hover { filter: brightness(1.1); }
        .os-title-tx { font-family: "JetBrains Mono", monospace; font-size: 12px; color: var(--c-muted); pointer-events: none; }
        .os-win.dark .os-title-tx { color: #8b90a0; }
        .os-title-tx em { font-style: normal; opacity: .6; margin-left: 4px; }
        .os-body { flex: 1; min-height: 0; overflow: auto; }
        /* resize handles — macOS-style edge/corner drag */
        .os-rz { position: absolute; z-index: 5; }
        .os-rz.n { top: -3px; left: 8px; right: 8px; height: 7px; cursor: ns-resize; }
        .os-rz.s { bottom: -3px; left: 8px; right: 8px; height: 7px; cursor: ns-resize; }
        .os-rz.e { right: -3px; top: 8px; bottom: 8px; width: 7px; cursor: ew-resize; }
        .os-rz.w { left: -3px; top: 8px; bottom: 8px; width: 7px; cursor: ew-resize; }
        .os-rz.ne { top: -4px; right: -4px; width: 14px; height: 14px; cursor: nesw-resize; }
        .os-rz.nw { top: -4px; left: -4px; width: 14px; height: 14px; cursor: nwse-resize; }
        .os-rz.se { bottom: -4px; right: -4px; width: 14px; height: 14px; cursor: nwse-resize; }
        .os-rz.sw { bottom: -4px; left: -4px; width: 14px; height: 14px; cursor: nesw-resize; }

        /* ---------- dock ---------- */
        .os-dock-wrap { position: fixed; left: 0; right: 0; bottom: 14px; display: flex; justify-content: center; pointer-events: none; }
        .os-dock {
          pointer-events: auto; display: flex; align-items: flex-end; gap: 8px;
          padding: 8px 10px; border-radius: 20px;
          background: color-mix(in srgb, var(--c-surface) 78%, transparent);
          border: 1px solid var(--c-edge); backdrop-filter: blur(18px) saturate(1.6);
          box-shadow: 0 18px 50px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06);
          transition: gap .2s;
          max-width: calc(100vw - 20px); flex-wrap: wrap; justify-content: center;
        }
        .os-dock-item { flex: 0 0 auto; }
        .os-dock-item { position: relative; background: none; border: none; cursor: pointer; padding: 0; transform-origin: bottom center; transition: transform .1s ease; }
        .os-dock-ic {
          display: grid; place-items: center; height: 44px; width: 44px; border-radius: 13px;
          color: var(--a); background: color-mix(in srgb, var(--a) 18%, var(--c-bg));
          border: 1px solid color-mix(in srgb, var(--a) 32%, transparent);
        }
        .os-dock-ic.launch-ic { --a: var(--c-accent); color: var(--c-fg); background: color-mix(in srgb, var(--c-fg) 8%, var(--c-bg)); border-color: var(--c-edge); }
        .os-dock-item.launch.active .os-dock-ic { border-color: var(--c-accent); color: var(--c-accent); }
        .os-dock-dot { position: absolute; left: 50%; bottom: -5px; height: 4px; width: 4px; border-radius: 50%; background: var(--c-muted); transform: translateX(-50%); }
        .os-dock-item.min .os-dock-dot { background: var(--c-accent); }
        .os-dock-sep { align-self: center; width: 1px; height: 32px; background: var(--c-edge); margin: 0 2px; }
        .os-dock-tip {
          position: absolute; left: 50%; top: -34px; transform: translateX(-50%);
          white-space: nowrap; padding: 4px 9px; border-radius: 7px; font-size: 11px;
          font-family: "JetBrains Mono", monospace; color: var(--c-fg);
          background: var(--c-surface); border: 1px solid var(--c-edge);
          opacity: 0; transition: opacity .15s; pointer-events: none;
          box-shadow: 0 8px 20px rgba(0,0,0,.35);
        }
        .os-dock-item:hover .os-dock-tip { opacity: 1; }

        /* ---------- launchpad ---------- */
        .os-lp {
          position: fixed; inset: 0; display: grid; place-items: start center; padding: 12vh 20px 20px;
          background: color-mix(in srgb, var(--c-bg) 62%, transparent);
          backdrop-filter: blur(26px) saturate(1.3);
          animation: os-fade .3s ease;
        }
        @keyframes os-fade { from { opacity: 0; } }
        .os-lp-in { width: 100%; max-width: 720px; max-height: 80vh; display: flex; flex-direction: column; }
        .os-lp-search {
          display: flex; align-items: center; gap: 10px; margin: 0 auto 40px; max-width: 420px;
          padding: 12px 16px; border-radius: 12px; color: var(--c-muted);
          background: color-mix(in srgb, var(--c-surface) 70%, transparent);
          border: 1px solid var(--c-edge);
        }
        .os-lp-search input { flex: 1; background: none; border: none; outline: none; color: var(--c-fg); font-size: 15px; font-family: "Inter", sans-serif; }
        .os-lp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 20px 8px; overflow-y: auto; align-content: start; min-height: 0; flex: 1; padding: 4px 6px 12px; }
        .os-lp-app { display: flex; flex-direction: column; align-items: center; gap: 10px; background: none; border: none; cursor: pointer; padding: 10px; border-radius: 16px; transition: transform .15s, background .15s; }
        .os-lp-app:hover { transform: translateY(-3px); background: color-mix(in srgb, var(--c-fg) 6%, transparent); }
        .os-lp-ic {
          display: grid; place-items: center; height: 76px; width: 76px; border-radius: 20px;
          color: var(--a); background: color-mix(in srgb, var(--a) 18%, var(--c-surface));
          border: 1px solid color-mix(in srgb, var(--a) 30%, transparent);
          box-shadow: 0 10px 26px rgba(0,0,0,.3);
        }
        .os-lp-name { font-size: 12.5px; color: var(--c-fg); font-family: "Inter", sans-serif; }
        .os-lp-hint {
          margin-top: 40px; display: flex; flex-wrap: wrap; justify-content: center;
          gap: 8px 18px; font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--c-muted);
        }
        .os-lp-hint span { display: inline-flex; align-items: center; gap: 6px; }
        /* shared keycaps (used here + in the Shortcuts app) */
        .os-kbd { display: inline-flex; align-items: center; gap: 4px; }
        .os-kbd kbd {
          font-family: "JetBrains Mono", monospace; font-size: 11px; line-height: 1;
          min-width: 20px; height: 20px; padding: 0 6px;
          display: inline-flex; align-items: center; justify-content: center;
          color: var(--c-fg); background: var(--c-surface);
          border: 1px solid var(--c-edge); border-radius: 5px;
          box-shadow: 0 1px 0 var(--c-edge);
        }

        /* ---------- context menu ---------- */
        .os-ctx-layer { position: fixed; inset: 0; }
        .os-ctx {
          position: fixed; min-width: 204px; padding: 6px;
          background: color-mix(in srgb, var(--c-surface) 96%, transparent);
          border: 1px solid var(--c-edge); border-radius: 11px;
          box-shadow: 0 22px 54px rgba(0,0,0,.42); backdrop-filter: blur(20px);
          font-family: "Inter", sans-serif; animation: os-fade .12s ease;
        }
        .os-ctx-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: none; border: none; cursor: pointer; font-size: 13px; color: var(--c-fg); padding: 8px 10px; border-radius: 7px; transition: background .1s, color .1s; }
        .os-ctx-item:hover { background: var(--c-accent); color: var(--c-accentFg, #0a0b0f); }
        .os-ctx-div { height: 1px; margin: 5px 6px; background: var(--c-edge); }

        /* ---------- spotlight results ---------- */
        .os-sp-results { overflow-y: auto; min-height: 0; flex: 1; padding: 2px 4px 12px; display: flex; flex-direction: column; gap: 5px; }
        .os-sp-empty { text-align: center; color: var(--c-muted); font-family: "JetBrains Mono", monospace; font-size: 13px; padding: 30px; }
        .os-sp-row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; background: color-mix(in srgb, var(--c-surface) 55%, transparent); border: 1px solid var(--c-edge); border-radius: 12px; padding: 10px 14px; cursor: pointer; transition: border-color .12s, background .12s; }
        .os-sp-row:hover, .os-sp-row.active { border-color: var(--c-accent); background: color-mix(in srgb, var(--c-accent) 8%, transparent); }

        /* ---------- visible keyboard focus (a11y) ---------- */
        .os-win:focus-visible { outline: 2px solid var(--c-accent); outline-offset: -2px; }
        .os-l:focus-visible, .os-dock-item:focus-visible, .os-lp-app:focus-visible,
        .os-sp-row:focus-visible, .os-ctx-item:focus-visible, .os-mb-logo:focus-visible,
        .os-mb-icon:focus-visible, .os-mb-menu button:focus-visible, .os-rz:focus-visible {
          outline: 2px solid var(--c-accent); outline-offset: 2px;
        }
        .os-lp-search:focus-within { border-color: var(--c-accent); }
        .os-ctx-item:focus-visible { background: var(--c-accent); color: var(--c-accentFg, #0a0b0f); outline: none; }
        .os-mb-menu button:focus-visible { background: var(--c-accent); color: var(--c-accentFg, #0a0b0f); outline: none; }
        .os-sp-ic { display: grid; place-items: center; height: 34px; width: 34px; border-radius: 9px; color: var(--a); background: color-mix(in srgb, var(--a) 16%, var(--c-bg)); border: 1px solid color-mix(in srgb, var(--a) 30%, transparent); flex-shrink: 0; }
        .os-sp-tx { display: flex; flex-direction: column; min-width: 0; flex: 1; }
        .os-sp-tx b { font-size: 14px; color: var(--c-fg); font-weight: 600; }
        .os-sp-tx em { font-style: normal; font-size: 11.5px; color: var(--c-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .os-sp-type { font-family: "JetBrains Mono", monospace; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--c-muted); border: 1px solid var(--c-edge); border-radius: 5px; padding: 2px 6px; flex-shrink: 0; }

        /* ---------- menu bar ---------- */
        .os-menubar {
          position: fixed; top: 0; left: 0; right: 0; height: ${MENUBAR_H}px; z-index: 100000;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 12px; font-family: "JetBrains Mono", monospace; font-size: 12px;
          color: var(--c-fg); background: color-mix(in srgb, var(--c-surface) 72%, transparent);
          border-bottom: 1px solid var(--c-edge); backdrop-filter: blur(18px) saturate(1.5);
          animation: os-fade .4s ease;
        }
        .os-mb-left, .os-mb-right { display: flex; align-items: center; gap: 14px; }
        .os-mb-left { position: relative; }
        .os-mb-logo {
          display: inline-flex; align-items: center; gap: 6px; background: none; border: none;
          cursor: pointer; color: var(--c-fg); font-family: inherit; font-size: 12px; font-weight: 700;
          padding: 3px 6px; border-radius: 6px; transition: background .15s; white-space: nowrap;
        }
        .os-mb-first, .os-mb-last { white-space: nowrap; }
        .os-mb-logo:hover { background: color-mix(in srgb, var(--c-fg) 10%, transparent); }
        .os-mb-diamond { height: 8px; width: 8px; border-radius: 2px; background: var(--c-accent); transform: rotate(45deg); }
        .os-mb-app { font-weight: 700; }
        .os-mb-fade { color: var(--c-muted); opacity: .7; }
        .os-mb-right { font-size: 11.5px; color: var(--c-muted); }
        .os-mb-icon {
          display: grid; place-items: center; height: 24px; width: 24px; border-radius: 6px;
          background: none; border: none; cursor: pointer; color: var(--c-muted); transition: color .15s, background .15s;
        }
        .os-mb-icon:hover { color: var(--c-accentText, var(--c-accent)); background: color-mix(in srgb, var(--c-fg) 8%, transparent); }
        .os-mb-live { display: inline-flex; align-items: center; gap: 5px; color: var(--c-live, #4ED0C0); }
        .os-mb-dot { height: 6px; width: 6px; border-radius: 50%; background: var(--c-live, #4ED0C0); box-shadow: 0 0 6px var(--c-live, #4ED0C0); animation: os-mb-blink 2.4s infinite; }
        @keyframes os-mb-blink { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
        .os-mb-clock {
          color: var(--c-fg); font-variant-numeric: tabular-nums; font-family: inherit; font-size: inherit;
          background: none; border: none; cursor: pointer; padding: 4px 8px; border-radius: 7px;
          transition: background .12s;
        }
        .os-mb-clock:hover { background: color-mix(in srgb, var(--c-fg) 10%, transparent); }

        /* ---------- date/time flyout ---------- */
        .os-dt {
          position: fixed; top: ${MENUBAR_H + 4}px; right: 10px; width: 288px; z-index: 100001;
          padding: 16px 16px 12px; border-radius: 14px;
          background: color-mix(in srgb, var(--c-surface) 96%, transparent);
          border: 1px solid var(--c-edge); backdrop-filter: blur(22px) saturate(1.4);
          box-shadow: 0 24px 60px rgba(0,0,0,.42);
          font-family: "Inter", sans-serif; animation: os-dt-in .16s cubic-bezier(.16,1,.3,1);
        }
        @keyframes os-dt-in { from { opacity: 0; transform: translateY(-6px); } }
        .os-dt-top { padding-bottom: 14px; border-bottom: 1px solid var(--c-edge); }
        .os-dt-day { font-family: "JetBrains Mono", monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--c-accentText, var(--c-accent)); }
        .os-dt-date { margin-top: 3px; font-family: "Space Grotesk", sans-serif; font-size: 26px; font-weight: 700; letter-spacing: -.02em; color: var(--c-fg); }
        .os-dt-time { margin-top: 6px; display: flex; align-items: baseline; gap: 10px; font-family: "JetBrains Mono", monospace; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--c-fg); }
        .os-dt-time span { color: var(--c-accentText, var(--c-accent)); }
        .os-dt-time em { font-style: normal; font-size: 10px; font-weight: 400; color: var(--c-muted); letter-spacing: .02em; }
        .os-dt-cal { padding: 12px 0 6px; }
        .os-dt-wd, .os-dt-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
        .os-dt-wd span { text-align: center; font-family: "JetBrains Mono", monospace; font-size: 9px; color: var(--c-muted); padding-bottom: 6px; }
        .os-dt-grid { gap: 2px; }
        .os-dt-cell { display: grid; place-items: center; aspect-ratio: 1; border-radius: 7px; font-family: "JetBrains Mono", monospace; font-size: 11.5px; color: var(--c-fg); }
        .os-dt-cell.today { background: var(--c-accent); color: var(--c-accentFg, #0a0b0f); font-weight: 700; }
        .os-dt-open {
          margin-top: 8px; width: 100%; text-align: left; background: none; border: none; cursor: pointer;
          font-family: "JetBrains Mono", monospace; font-size: 11.5px; color: var(--c-accentText, var(--c-accent));
          padding: 9px 8px 4px; border-top: 1px solid var(--c-edge); transition: opacity .12s;
        }
        .os-dt-open:hover { opacity: .7; }
        @media (prefers-reduced-motion: reduce) { .os-dt { animation: none; } }
        .os-mb-menu {
          position: absolute; top: ${MENUBAR_H - 2}px; left: 0; min-width: 232px;
          display: flex; flex-direction: column; padding: 6px; gap: 1px;
          background: color-mix(in srgb, var(--c-surface) 96%, transparent);
          border: 1px solid var(--c-edge); border-radius: 10px;
          box-shadow: 0 20px 50px rgba(0,0,0,.4); backdrop-filter: blur(20px);
          animation: os-fade .15s ease;
        }
        .os-mb-menu button {
          text-align: left; background: none; border: none; cursor: pointer;
          font-family: inherit; font-size: 12px; color: var(--c-fg);
          padding: 8px 10px; border-radius: 6px; transition: background .12s, color .12s;
        }
        .os-mb-menu button:hover { background: var(--c-accent); color: var(--c-accentFg, #0a0b0f); }
        .os-mb-div { height: 1px; margin: 4px 2px; background: var(--c-edge); }

        /* ---------- snap preview ---------- */
        .os-snap-preview {
          position: fixed; z-index: 90000; pointer-events: none; border-radius: 12px;
          background: color-mix(in srgb, var(--c-accent) 16%, transparent);
          border: 1.5px solid var(--c-accent);
          box-shadow: 0 0 0 100vmax rgba(0,0,0,0.04) inset;
          transition: left .12s ease, top .12s ease, width .12s ease, height .12s ease;
          animation: os-fade .12s ease;
        }

        @media (max-width: 640px) {
          .os-menubar { padding: 0 6px; font-size: 10px; }
          .os-mb-last { display: none; } /* first name only on phones — no wrap */
          .os-mb-fade { display: none; }
          .os-mb-live { display: none; }
          .os-mb-app { display: none; } /* free room so the date/time fits at the top */
          .os-mb-left, .os-mb-right { gap: 8px; }
          .os-mb-logo { font-size: 10px; padding: 2px 4px; }
          .os-mb-icon { height: 20px; width: 20px; }
          /* keep the date/time visible + compact in the top bar */
          .os-mb-clock { font-size: 9.5px; padding: 2px 5px; letter-spacing: -0.02em; }
          .os-dock-wrap { bottom: 10px; }
          .os-dock { gap: 5px; padding: 6px 8px; }
          .os-dock-ic { height: 38px; width: 38px; border-radius: 11px; }
          .os-lp { padding: 8vh 12px 14px; }
          .os-lp-in { max-height: 84vh; }
          .os-lp-search { margin-bottom: 20px; padding: 10px 14px; }
          .os-lp-grid { grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 14px 4px; }
          .os-lp-ic { height: 58px; width: 58px; border-radius: 16px; }
          .os-lp-name { font-size: 11px; }
          /* no physical keyboard on phones — hide shortcut hints + the Shortcuts app */
          .os-lp-hint { display: none; }
          .os-desktop-only { display: none !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .os-win, .os-dock-item, .os-lp, .os-ctx, .os-menubar, .os-mb-menu, .os-snap-preview { animation: none; transition: none; }
        }
      `}</style>
    </>
  );
}
