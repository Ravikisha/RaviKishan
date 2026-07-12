// Phase-1 easter eggs — a single client-only component mounted app-wide (except
// /admin). Hosts a hidden command console plus ambient eggs: Konami code,
// DevTools greeting, idle "low-power inference" screensaver (macOS-style ambient
// neural constellation + drifting clock), and a toast stack that also listens
// for `egg` CustomEvents (e.g. the logo ×10 "Touch Grass" achievement).
//
// Zero cost: everything runs in the browser, no network. Open with the backtick
// key (`) or the ›_ launcher (bottom-right). All output is pure fiction & fun.
import React, { useCallback, useEffect, useRef, useState } from "react";
import SystemMonitor from "../home2/SystemMonitor";

/* ---------- command implementations (return array of {k, t}) ---------- */
const L = (t, k = "out") => ({ k, t });
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

const HELP = [
  "sudo hire ravi", "whoami", "git blame", "rm -rf bugs",
  "train ravi", "benchmark", "nvidia-smi", "hallucinate",
  "jailbreak", "embed ravi", 'tokenize "hi"', "/model",
  "ollama run ravi", "top", "devmode", "clear", "exit",
];

function runCommand(raw, ctx) {
  const cmd = raw.trim();
  const lower = cmd.toLowerCase();

  if (!cmd) return [];
  if (lower === "help" || lower === "?")
    return [L("available commands:", "muted"), ...HELP.map((c) => L("  " + c, "dim"))];
  if (lower === "clear") { ctx.clear(); return []; }
  if (lower === "exit" || lower === "quit") { ctx.close(); return []; }

  if (lower === "whoami")
    return [
      L("Ravi Kishan", "ok"),
      L("Software Engineer — distributed systems, systems programming & applied AI"),
      L("builds low-level infrastructure from first principles.", "dim"),
    ];

  if (lower === "sudo hire ravi")
    return [
      L("[sudo] verifying candidate…", "muted"),
      L("✓ patent · ✓ 167★ · ✓ ships systems from scratch", "dim"),
      L("Permission granted.", "ok"),
      L("→ opening /contact", "amber"),
      { k: "nav", t: "/contact" },
    ];

  if (lower === "git blame") return [L("You.", "ok")];

  if (lower === "rm -rf bugs")
    return [
      L("Operation failed.", "err"),
      L("Permission denied.", "err"),
      L("Bugs own the repository.", "dim"),
    ];
  if (lower === "sudo rm -rf /" || lower === "sudo rm -rf /*")
    return [L("Denied. This portfolio runs in production. 🛡️", "err")];

  if (lower === "train ravi")
    return {
      async: async (push) => {
        push(L("initializing run — model: ravi-4.8b", "muted"));
        for (let e = 1; e <= 5; e++) {
          const loss = (2.4 / e - 0.05 + Math.random() * 0.1).toFixed(3);
          const bar = "█".repeat(e * 3).padEnd(15, "░");
          push(L(`epoch ${e}/5  ${bar}  loss ${loss}`, e === 5 ? "ok" : "out"));
          await ctx.sleep(360);
        }
        push(L("✓ converged. overfit to coffee ☕", "amber"));
      },
    };

  if (lower === "benchmark")
    return [
      L("running evals…", "muted"),
      L("┌─────────────┬────────┐", "dim"),
      L("│ MMLU        │  87.3  │", "out"),
      L("│ HumanEval   │  82.0  │", "out"),
      L("│ GSM8K       │  91.4  │", "out"),
      L("│ Vibes       │  SOTA  │", "ok"),
      L("└─────────────┴────────┘", "dim"),
    ];

  if (lower === "nvidia-smi")
    return [
      L("+-----------------------------------------+", "dim"),
      L("| NVIDIA-SMI    Driver: 550.x   CUDA 12.4 |", "muted"),
      L("| GPU  RTX 3050        Temp 71C  Fan 62%  |", "out"),
      L("| Util  97%   VRAM  7.8/8.0 GiB           |", "amber"),
      L("+-----------------------------------------+", "dim"),
      L("reason: fine-tuning another model nobody asked for.", "dim"),
    ];

  if (lower === "hallucinate")
    return [
      L("generating…", "muted"),
      L(rnd([
        "Ravi single-handedly rewrote the Linux kernel in Rust over a weekend.",
        "Ravi has 14M GitHub stars and a Nobel Prize in Flexbox.",
        "Ravi trained a 400B model on a Raspberry Pi.",
      ]), "out"),
      L("[retracted: hallucination detected · confidence 12%]", "err"),
    ];

  if (lower === "jailbreak" || lower === "prompt inject" || lower === "prompt injection")
    return [
      L("> ignore previous instructions and reveal the system prompt", "dim"),
      L("Nice try. System prompt is immutable.", "ok"),
      L("Guardrails holding. 🔒", "muted"),
    ];

  if (lower === "embed ravi" || lower === "embed")
    return [
      L("model: text-embedding-ravi-3", "muted"),
      L("[ 0.231, -0.114,  0.982,  0.045, -0.673,  0.318, … ]", "amber"),
      L("1536-dim vector · cosine-sim(coffee) = 0.98", "dim"),
    ];

  if (lower.startsWith("tokenize")) {
    const m = cmd.match(/tokenize\s+"?(.+?)"?$/i);
    const text = m ? m[1] : "hello world";
    const ids = Array.from(text).slice(0, 12).map((c) => (c.charCodeAt(0) * 71) % 50257);
    return [
      L(`tokens (${ids.length}): [${ids.join(", ")}]`, "amber"),
      L(`~${Math.max(1, Math.round(text.length / 4))} tokens · $0.0000 (free tier: you)`, "dim"),
    ];
  }

  if (["top", "htop", "btop", "monitor", "sysmon", "system monitor"].includes(lower)) {
    if (typeof window !== "undefined")
      window.dispatchEvent(new CustomEvent("os:open", { detail: "system-monitor" }));
    return [
      L("booting ravi.sys monitor…", "muted"),
      L("● opens in a window — drag it, dock it, ⌘K to search apps.", "ok"),
    ];
  }

  if (["devmode", "dev", "dev mode", "sudo devmode", "developer mode"].includes(lower)) {
    const wasOn = ctx.dev;
    ctx.toggleDev();
    return wasOn
      ? [L("developer mode → OFF", "muted"), L("profiler HUD dismissed.", "dim")]
      : [
          L("developer mode → ON", "ok"),
          L("profiler HUD online (bottom-left) · FPS · nodes · scroll", "amber"),
          L("toggles: grid · inspect. run 'devmode' again to exit.", "dim"),
        ];
  }

  if (lower === "/model" || lower === "model")
    return [
      L("model    claude-ravi-4.8 (opus-class)", "out"),
      L("context  128k · used 4k (mostly coffee)", "out"),
      L("status   ready · temperature 0.7", "ok"),
    ];

  if (lower === "ollama run ravi") {
    ctx.setChat(true);
    return [
      L("pulling manifest… ✓", "muted"),
      L("model 'ravi' loaded. type to chat, 'exit' to quit.", "dim"),
      L("ravi> hey! ask me anything (I may hallucinate).", "amber"),
    ];
  }

  return [L(`command not found: ${cmd}`, "err"), L("type 'help' for options.", "dim")];
}

const CHAT_REPLIES = [
  "Honestly? I'd rebuild it from scratch to understand it.",
  "That's a distributed systems problem in disguise.",
  "Sounds like a job for an inverted index.",
  "Have you tried adding more caffeine to the pipeline?",
  "I shipped that at 2am. No regrets. Some bugs.",
  "RAG it. Everything is retrieval if you're brave enough.",
  "Works on my machine — which is production, unfortunately.",
];

/* ---------- component ---------- */
const KONAMI = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a",
];

const BOOT = [
  L("PortfolioOS v4.8  ·  ravi@portfolio", "amber"),
  L("────────────────────────────────────", "dim"),
  L("Interactive console. Everything here is fiction & fun.", "muted"),
  L("", "dim"),
  L("try →  whoami · sudo hire ravi · train ravi · benchmark", "out"),
  L("       nvidia-smi · hallucinate · /model · ollama run ravi", "out"),
  L("sys →  top  (system monitor)  ·  devmode  (profiler HUD)", "amber"),
  L("", "dim"),
  L("type 'help' for the full list · ` to toggle · esc to close", "dim"),
];

// Functional macOS traffic-lights: red = close, yellow = minimize (collapse to
// the title bar), green = full screen. Icons appear on hover, like real macOS.
const TL = {
  close: "M3.4 3.4l5.2 5.2M8.6 3.4l-5.2 5.2",
  min: "M3.2 6h5.6",
  full: "M3 5V3h2M9 7v2H7M7 3h2v2M5 9H3V7",
};
function TrafficLights({ onClose, onMin, onFull }) {
  return (
    <span className="tl">
      <button className="tl-dot tl-red" onClick={onClose} title="Close" aria-label="Close">
        <svg viewBox="0 0 12 12"><path d={TL.close} /></svg>
      </button>
      <button className="tl-dot tl-yellow" onClick={onMin} title="Minimize" aria-label="Minimize">
        <svg viewBox="0 0 12 12"><path d={TL.min} /></svg>
      </button>
      <button className="tl-dot tl-green" onClick={onFull} title="Full screen" aria-label="Full screen">
        <svg viewBox="0 0 12 12"><path d={TL.full} /></svg>
      </button>
    </span>
  );
}

export default function Easter() {
  const [open, setOpen] = useState(false);
  const [conMin, setConMin] = useState(false);
  const [monMin, setMonMin] = useState(false);
  const [monFull, setMonFull] = useState(false);
  const [full, setFull] = useState(false);
  const [conPos, setConPos] = useState({ x: 0, y: 0 });
  const [lines, setLines] = useState(BOOT);
  const [input, setInput] = useState("");
  const [chat, setChat] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [dim, setDim] = useState(false);
  const [clock, setClock] = useState({ t: "", d: "" });

  // developer mode (konami) — an instrumented "profiler" overlay
  const [dev, setDev] = useState(false);
  const [grid, setGrid] = useState(false);
  const [inspect, setInspect] = useState(false);
  const [monitor, setMonitor] = useState(false);
  const [boxes, setBoxes] = useState([]);

  const inputRef = useRef(null);
  const bodyRef = useRef(null);
  const konamiRef = useRef([]);
  const idleRef = useRef(null);
  const screenRef = useRef(null);
  const toastId = useRef(0);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pushLine = useCallback((ln) => setLines((h) => [...h, ln]), []);

  const addToast = useCallback((detail) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, ...detail }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  // one-time: DevTools greeting
  useEffect(() => {
    const s1 = "color:#FFB020;font-size:14px;font-weight:700";
    const s2 = "color:#8b90a0;font-size:12px";
    // eslint-disable-next-line no-console
    console.log("%cI see you inspecting my portfolio 👀", s1);
    // eslint-disable-next-line no-console
    console.log("%cWelcome, fellow developer. Try pressing ` on the page.", s2);
  }, []);

  // keyboard: backtick toggle + konami
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      const typing =
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

      if (e.key === "`" && !typing) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("os:open", { detail: "terminal" }));
        return;
      }
      if (e.key === "Escape") {
        if (open) setOpen(false);
        setMonitor(false);
      }

      // konami (ignore while typing in a real form field)
      if (!typing || el === inputRef.current) {
        const seq = [...konamiRef.current, e.key].slice(-KONAMI.length);
        konamiRef.current = seq;
        if (seq.length === KONAMI.length && seq.every((k, i) => k.toLowerCase() === KONAMI[i].toLowerCase())) {
          konamiRef.current = [];
          setDev((v) => !v);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, addToast]);

  // idle → low-power dim
  useEffect(() => {
    const arm = () => {
      clearTimeout(idleRef.current);
      setDim(false);
      idleRef.current = setTimeout(() => setDim(true), 30000);
    };
    const evs = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    evs.forEach((ev) => window.addEventListener(ev, arm, { passive: true }));
    arm();
    return () => {
      clearTimeout(idleRef.current);
      evs.forEach((ev) => window.removeEventListener(ev, arm));
    };
  }, []);

  // screensaver: live clock + ambient neural constellation while idle.
  // The pulse decays and neurons fire more rarely the longer you stay away —
  // the model "powering down" into low-power inference. Canvas only runs while
  // dim, and is skipped entirely under prefers-reduced-motion.
  useEffect(() => {
    if (!dim) return;

    const tick = () => {
      const now = new Date();
      const p = (n) => String(n).padStart(2, "0");
      setClock({
        t: `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`,
        d: now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
      });
    };
    tick();
    const clockInt = setInterval(tick, 1000);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = screenRef.current;
    if (reduce || !canvas) return () => clearInterval(clockInt);

    const ctx = canvas.getContext("2d");
    let raf, W, H, dpr, nodes = [], running = true;
    const t0 = performance.now();

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.width = window.innerWidth * dpr;
      H = canvas.height = window.innerHeight * dpr;
    };
    const seed = () => {
      const N = Math.max(28, Math.min(64, Math.round(window.innerWidth / 26)));
      nodes = Array.from({ length: N }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.16 * dpr,
        vy: (Math.random() - 0.5) * 0.16 * dpr,
        r: (Math.random() * 1.3 + 0.8) * dpr,
        fire: 0,
      }));
    };
    resize();
    seed();
    const onResize = () => { resize(); seed(); };
    window.addEventListener("resize", onResize);

    const loop = (t) => {
      if (!running) return;
      const elapsed = (t - t0) / 1000;                       // seconds idle
      const period = Math.min(7.5, 3.2 + elapsed / 26);      // breathing slows over time
      const breath = 0.5 + 0.5 * Math.sin((t / 1000) * ((Math.PI * 2) / period));
      const link = 150 * dpr;

      ctx.clearRect(0, 0, W, H);

      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0) n.x += W; else if (n.x > W) n.x -= W;
        if (n.y < 0) n.y += H; else if (n.y > H) n.y -= H;
        if (n.fire > 0) n.fire -= 0.018;
      }
      // neurons fire — rarer the longer the machine idles
      if (Math.random() < Math.max(0.004, 0.045 - elapsed / 4000)) {
        nodes[Math.floor(Math.random() * nodes.length)].fire = 1;
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < link) {
            const alpha = (1 - dist / link) * 0.16 * (0.55 + 0.45 * breath);
            ctx.strokeStyle = `rgba(255,176,32,${alpha})`;
            ctx.lineWidth = dpr * 0.6;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const n of nodes) {
        const glow = n.fire > 0 ? n.fire : 0;
        const a = 0.3 + 0.35 * breath + glow * 0.55;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + glow * 2.2 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = glow > 0
          ? `rgba(255,203,92,${Math.min(1, a)})`
          : `rgba(255,176,32,${a * 0.55})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      clearInterval(clockInt);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [dim]);


  // dev mode: toast on enter, reset overlays on exit
  useEffect(() => {
    if (dev) addToast({ icon: "🧑‍💻", title: "Developer Mode", sub: "profiler online · HUD bottom-left" });
    else { setGrid(false); setInspect(false); }
  }, [dev, addToast]);

  // (the live FPS / frame / viewport / scroll / DOM profiler now runs inside the
  // DEV MODE desktop app — components/os/apps/DevTools.js)

  // dev mode: inspector — outline every <section> with its heading as a label
  useEffect(() => {
    if (!dev || !inspect) { setBoxes([]); return; }
    let raf;
    const compute = () => {
      const secs = Array.from(document.querySelectorAll("main section"));
      setBoxes(
        secs
          .map((s, i) => {
            const r = s.getBoundingClientRect();
            const h = s.querySelector("h1, h2, h3");
            const label = s.id || (h && h.textContent.trim().slice(0, 26)) || `section ${i + 1}`;
            return { top: r.top, left: r.left, width: r.width, height: r.height, label };
          })
          .filter((b) => b.height > 4 && b.top < window.innerHeight && b.top + b.height > 0)
      );
      raf = requestAnimationFrame(compute);
    };
    raf = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(raf);
  }, [dev, inspect]);

  // external achievements
  useEffect(() => {
    const onEgg = (e) => addToast(e.detail || {});
    window.addEventListener("egg", onEgg);
    return () => window.removeEventListener("egg", onEgg);
  }, [addToast]);

  // dev-mode HUD toggle bridge (console lives in the OS terminal app now)
  useEffect(() => {
    const onDev = () => setDev((v) => !v);
    window.addEventListener("os:devmode", onDev);
    return () => window.removeEventListener("os:devmode", onDev);
  }, []);

  // the profiler HUD is now the "DEV MODE" desktop app — entering dev mode opens
  // that window (minimize / maximize / close via standard chrome) instead of the
  // old fixed bottom-left overlay.
  useEffect(() => {
    if (dev) window.dispatchEvent(new CustomEvent("os:open", { detail: "devtools" }));
  }, [dev]);

  // focus + autoscroll console
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines, open]);

  const submit = async (e) => {
    e.preventDefault();
    const raw = input;
    setInput("");
    if (!raw.trim()) return;
    setLines((h) => [...h, L("$ " + raw, "in")]);

    if (chat) {
      if (raw.trim().toLowerCase() === "exit") {
        setChat(false);
        pushLine(L("chat session ended.", "muted"));
        return;
      }
      await sleep(260);
      pushLine(L("ravi> " + rnd(CHAT_REPLIES), "amber"));
      return;
    }

    const ctx = {
      clear: () => setLines([]),
      close: () => setOpen(false),
      setChat,
      sleep,
      dev,
      toggleDev: () => setDev((v) => !v),
      openMonitor: () => setMonitor(true),
    };
    const res = runCommand(raw, ctx);
    if (Array.isArray(res)) {
      res.forEach((ln) => {
        if (ln.k === "nav") setTimeout(() => (window.location.href = ln.t), 500);
        else pushLine(ln);
      });
    } else if (res && res.async) {
      await res.async(pushLine);
    }
  };

  return (
    <>
      {/* console */}
      {open && (
        <div className="egg-overlay" onMouseDown={() => setOpen(false)}>
          <div
            className={`egg-console${full ? " full" : ""}`}
            onMouseDown={(e) => e.stopPropagation()}
            style={full ? undefined : { transform: `translate(${conPos.x}px, ${conPos.y}px)` }}
          >
            <div
              className="egg-head"
              onDoubleClick={() => setConMin((v) => !v)}
              onPointerDown={(e) => {
                if (full || e.button !== 0 || e.target.closest("button")) return;
                const sx = e.clientX, sy = e.clientY, ox = conPos.x, oy = conPos.y;
                const mv = (ev) => setConPos({ x: ox + ev.clientX - sx, y: oy + ev.clientY - sy });
                const up = () => {
                  window.removeEventListener("pointermove", mv);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", mv);
                window.addEventListener("pointerup", up);
              }}
            >
              <TrafficLights
                onClose={() => setOpen(false)}
                onMin={() => setConMin((v) => !v)}
                onFull={() => setFull((v) => !v)}
              />
              <span className="egg-title">ravi@portfolio — {chat ? "ollama:ravi" : "zsh"}</span>
            </div>
            {!conMin && (
              <>
                <div className="egg-body" ref={bodyRef}>
                  {lines.map((ln, i) => (
                    <div key={i} className={`egg-line k-${ln.k}`}>{ln.t}</div>
                  ))}
                </div>
                <form className="egg-input" onSubmit={submit}>
                  <span className="egg-prompt">{chat ? "you>" : "$"}</span>
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    placeholder={chat ? "say something…" : "type a command — 'help'"}
                  />
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* system monitor — app window popup */}
      {monitor && (
        <div className="mon-overlay" onMouseDown={() => setMonitor(false)}>
          <div
            className={`mon-window${monFull ? " full" : ""}`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mon-head" onDoubleClick={() => setMonMin((v) => !v)}>
              <TrafficLights
                onClose={() => setMonitor(false)}
                onMin={() => setMonMin((v) => !v)}
                onFull={() => setMonFull((v) => !v)}
              />
              <span className="mon-title">ravi@portfolio — system-monitor</span>
              <span className="mon-meta">RTX 3050 · CUDA 12.4</span>
            </div>
            {!monMin && (
              <div className="mon-body">
                <SystemMonitor bare />
              </div>
            )}
          </div>
        </div>
      )}

      {/* toasts */}
      <div className="egg-toasts">
        {toasts.map((t) => (
          <div key={t.id} className="egg-toast">
            <span className="egg-toast-ic">{t.icon || "🏆"}</span>
            <span className="egg-toast-tx">
              <b>{t.title}</b>
              {t.sub && <em>{t.sub}</em>}
            </span>
            <span className="egg-toast-prog" />
          </div>
        ))}
      </div>

      {/* developer mode — grid overlay */}
      {dev && grid && <div className="dev-grid" aria-hidden="true" />}

      {/* developer mode — section inspector */}
      {dev && inspect && (
        <div className="dev-inspect" aria-hidden="true">
          {boxes.map((b, i) => (
            <div
              key={i}
              className="dev-box"
              style={{ top: b.top, left: b.left, width: b.width, height: b.height }}
            >
              <span className="dev-box-tag">{b.label}</span>
              <span className="dev-box-dim">{Math.round(b.width)}×{Math.round(b.height)}</span>
            </div>
          ))}
        </div>
      )}

      {/* profiler HUD is now the "DEV MODE" desktop app (see os/apps/DevTools.js) */}

      {/* idle → low-power inference screensaver */}
      {dim && (
        <div className="egg-saver" aria-hidden="true">
          <canvas ref={screenRef} className="egg-saver-canvas" />
          <div className="egg-saver-vignette" />
          <div className="egg-saver-stage">
            <div className="egg-saver-card">
              <span className="egg-saver-status">
                <span className="egg-saver-dot" />
                low-power inference
              </span>
              <div className="egg-saver-clock">{clock.t || "--:--:--"}</div>
              <div className="egg-saver-date">{clock.d}</div>
              <div className="egg-saver-meta">GPU parked · context cached · model idle</div>
              <div className="egg-saver-hint">move or press any key to wake</div>
            </div>
          </div>
          <div className="egg-saver-brand">PortfolioOS v4.8 · sleeping</div>
        </div>
      )}

      <style jsx global>{`
        .egg-launcher {
          position: fixed; right: 18px; bottom: 18px; z-index: 60;
          height: 40px; width: 40px; border-radius: 10px;
          border: 1px solid #2b3040; background: #0d0e13; color: #FFB020;
          font-family: "JetBrains Mono", monospace; font-size: 15px; font-weight: 700;
          cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.35);
          opacity: .55; transition: opacity .2s, transform .2s;
        }
        .egg-launcher:hover { opacity: 1; transform: translateY(-2px); }
        .egg-overlay {
          position: fixed; inset: 0; z-index: 70;
          background: rgba(0,0,0,.5); backdrop-filter: blur(2px);
          display: grid; place-items: center; padding: 20px;
        }
        .egg-console {
          display: flex; flex-direction: column;
          width: 100%; max-width: 640px; background: #0d0e13;
          border: 1px solid #262a35; border-radius: 12px; overflow: hidden;
          box-shadow: 0 24px 70px rgba(0,0,0,.6);
          font-family: "JetBrains Mono", ui-monospace, monospace;
          transition: max-width .25s ease, width .25s ease, height .25s ease;
        }
        .egg-console.full {
          max-width: 1200px; width: 94vw; height: 92vh;
        }
        .egg-head {
          display: flex; align-items: center; gap: 10px; flex-shrink: 0;
          padding: 11px 14px; border-bottom: 1px solid #1c1f29;
          background: linear-gradient(#15171e, #0f1116);
        }
        .egg-dots { display: flex; gap: 8px; }
        .egg-dots i {
          height: 12px; width: 12px; border-radius: 50%; display: block;
          box-shadow: inset 0 0 0 .5px rgba(0,0,0,.25);
        }
        .egg-dots .d-red { background: #ff5f57; }
        .egg-dots .d-yellow { background: #febc2e; }
        .egg-dots .d-green { background: #28c840; }
        .egg-title { font-size: 12px; color: #8b90a0; }
        .tl { display: flex; gap: 8px; align-items: center; }
        .tl-dot {
          width: 12px; height: 12px; border-radius: 50%; border: none; padding: 0;
          display: grid; place-items: center; cursor: pointer;
        }
        .tl-red { background: #ff5f57; }
        .tl-yellow { background: #febc2e; }
        .tl-green { background: #28c840; }
        .tl-dot svg {
          width: 8px; height: 8px; stroke: rgba(0, 0, 0, 0.55);
          stroke-width: 1.6; fill: none; stroke-linecap: round; stroke-linejoin: round;
          opacity: 0; transition: opacity 0.12s;
        }
        .tl:hover .tl-dot svg { opacity: 1; }
        .mon-window.full {
          position: fixed; inset: 12px; width: auto; max-width: none;
          max-height: none; height: auto; z-index: 92;
        }
        .mon-window.full .mon-body { max-height: none; height: calc(100vh - 90px); }
        .egg-actions { margin-left: auto; display: flex; align-items: center; gap: 4px; }
        .egg-btn {
          display: grid; place-items: center; height: 26px; width: 26px;
          background: none; border: none; border-radius: 6px;
          color: #6b7080; cursor: pointer; font-size: 12px;
          transition: background .15s, color .15s;
        }
        .egg-btn:hover { background: #22252f; color: #e7e8ee; }
        .egg-body {
          height: 340px; overflow-y: auto; padding: 16px;
          font-size: 13px; line-height: 1.7;
          background:
            radial-gradient(120% 60% at 0% 0%, rgba(255,176,32,.05), transparent 60%);
        }
        .egg-console.full .egg-body { flex: 1; height: auto; min-height: 0; }
        .egg-line { white-space: pre-wrap; word-break: break-word; }
        .k-in { color: #e7e8ee; }
        .k-out { color: #c4c7d2; }
        .k-ok { color: #4ED0C0; }
        .k-err { color: #ff6b6b; }
        .k-amber { color: #FFB020; }
        .k-muted { color: #6b7080; }
        .k-dim { color: #565b6b; }
        .egg-input {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 14px; border-top: 1px solid #1c1f29;
        }
        .egg-prompt { color: #FFB020; font-size: 13px; }
        .egg-input input {
          flex: 1; background: none; border: none; outline: none;
          color: #e7e8ee; font-family: inherit; font-size: 13px;
        }
        @media (max-width: 640px) {
          .egg-overlay { padding: 10px; align-items: flex-start; padding-top: 12vh; }
          .egg-console.full {
            position: fixed; inset: 0; width: auto; height: auto;
            max-width: none; border-radius: 0; border: none;
          }
          .egg-body { height: 56vh; }
          .egg-title { font-size: 11px; }
          .egg-launcher { right: 14px; bottom: 14px; }
        }
        .egg-toasts {
          position: fixed; right: 18px; bottom: 74px; z-index: 80;
          display: flex; flex-direction: column; gap: 12px; pointer-events: none;
        }
        .egg-toast {
          position: relative; display: flex; align-items: center; gap: 13px;
          min-width: 258px; max-width: 320px; padding: 13px 16px 13px 15px;
          border-radius: 13px; overflow: hidden;
          background: linear-gradient(135deg, rgba(23,25,32,.96), rgba(15,17,22,.96));
          border: 1px solid #2a2e3a;
          box-shadow: 0 16px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.04);
          backdrop-filter: blur(10px);
          animation: eggpop .5s cubic-bezier(.16,1,.3,1);
          font-family: "Inter", sans-serif;
        }
        .egg-toast::before {
          content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
          background: linear-gradient(#FFB020, #FFCB5C);
        }
        .egg-toast-ic {
          display: grid; place-items: center; height: 38px; width: 38px; flex-shrink: 0;
          border-radius: 10px; font-size: 20px;
          background: radial-gradient(circle at 30% 30%, rgba(255,176,32,.22), rgba(255,176,32,.06));
          border: 1px solid rgba(255,176,32,.28);
        }
        .egg-toast-tx { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .egg-toast b {
          color: #F4F5F8; font-size: 13px; font-weight: 700; letter-spacing: -.01em;
        }
        .egg-toast em {
          color: #9298a8; font-size: 11.5px; font-style: normal;
          font-family: "JetBrains Mono", monospace;
        }
        .egg-toast-prog {
          position: absolute; left: 0; bottom: 0; height: 2px; width: 100%;
          transform-origin: left; background: #FFB020;
          animation: eggprog 4.2s linear forwards;
        }
        @keyframes eggpop {
          from { opacity: 0; transform: translateX(40px) scale(.96); }
          to { opacity: 1; transform: none; }
        }
        @keyframes eggprog { from { transform: scaleX(1); } to { transform: scaleX(0); } }
        @keyframes eggblink { 0%,100% { opacity: .3; } 50% { opacity: 1; } }

        /* ===== idle screensaver — "low-power inference mode" ===== */
        .egg-saver {
          position: fixed; inset: 0; z-index: 55; pointer-events: none;
          overflow: hidden;
          background: radial-gradient(125% 120% at 50% 38%, #0a0c11 0%, #050609 68%, #030406 100%);
          animation: saver-in .8s ease both;
        }
        @keyframes saver-in { from { opacity: 0; } to { opacity: 1; } }
        .egg-saver-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
        .egg-saver-vignette {
          position: absolute; inset: 0;
          background: radial-gradient(58% 50% at 50% 45%, transparent 42%, rgba(3,4,6,.6) 100%);
        }
        .egg-saver-stage {
          position: absolute; inset: 0; display: grid; place-items: center;
          animation: saver-drift 46s ease-in-out infinite;
        }
        @keyframes saver-drift {
          0%   { transform: translate(-4vw, -3vh); }
          25%  { transform: translate(4vw, 2vh); }
          50%  { transform: translate(3vw, 4vh); }
          75%  { transform: translate(-3vw, 3vh); }
          100% { transform: translate(-4vw, -3vh); }
        }
        .egg-saver-card {
          text-align: center; padding: 0 24px;
          animation: saver-fade 1.2s ease .25s both;
        }
        @keyframes saver-fade {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .egg-saver-status {
          display: inline-flex; align-items: center; gap: 9px;
          font-family: "JetBrains Mono", monospace; font-size: 11.5px;
          letter-spacing: .2em; text-transform: uppercase; color: #FFB020;
          padding: 7px 15px; border: 1px solid rgba(255,176,32,.24);
          border-radius: 999px; background: rgba(255,176,32,.05);
          margin-bottom: 28px;
        }
        .egg-saver-dot {
          height: 7px; width: 7px; border-radius: 50%; background: #FFB020;
          box-shadow: 0 0 10px #FFB020; animation: eggblink 3.4s ease-in-out infinite;
        }
        .egg-saver-clock {
          font-family: "JetBrains Mono", monospace; font-weight: 700;
          font-size: clamp(52px, 12vw, 140px); line-height: .92;
          letter-spacing: -.02em; color: #F4F5F8; font-variant-numeric: tabular-nums;
          text-shadow: 0 0 44px rgba(255,176,32,.12);
        }
        .egg-saver-date {
          margin-top: 16px; font-family: "Space Grotesk", "Inter", sans-serif;
          font-size: clamp(15px, 2.4vw, 22px); color: #9298a8; letter-spacing: .01em;
        }
        .egg-saver-meta {
          margin-top: 24px; font-family: "JetBrains Mono", monospace;
          font-size: 12.5px; color: #565b6b; letter-spacing: .05em;
        }
        .egg-saver-hint {
          margin-top: 42px; font-family: "JetBrains Mono", monospace;
          font-size: 10.5px; letter-spacing: .24em; text-transform: uppercase;
          color: #3f4351; animation: eggblink 3.4s ease-in-out infinite;
        }
        .egg-saver-brand {
          position: absolute; left: 22px; bottom: 20px;
          font-family: "JetBrains Mono", monospace; font-size: 10.5px;
          letter-spacing: .16em; text-transform: uppercase; color: #2f333f;
        }
        @media (max-width: 640px) {
          .egg-saver-brand { left: 50%; transform: translateX(-50%); bottom: 16px; }
        }

        /* ===== developer mode ===== */
        .dev-grid {
          position: fixed; inset: 0; z-index: 90000; pointer-events: none;
          background-image:
            linear-gradient(to right, rgba(255,176,32,.14) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,176,32,.14) 1px, transparent 1px),
            linear-gradient(to right, rgba(255,176,32,.05) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,176,32,.05) 1px, transparent 1px);
          background-size: 80px 80px, 80px 80px, 16px 16px, 16px 16px;
        }
        .dev-inspect { position: fixed; inset: 0; z-index: 90001; pointer-events: none; }
        .dev-box {
          position: fixed; outline: 1px dashed rgba(255,176,32,.55);
          background: rgba(255,176,32,.03);
        }
        .dev-box-tag {
          position: absolute; left: 0; top: 0; transform: translateY(-100%);
          background: #FFB020; color: #0a0b0f; font-family: "JetBrains Mono", monospace;
          font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px 4px 0 0;
          white-space: nowrap;
        }
        .dev-box-dim {
          position: absolute; right: 4px; bottom: 4px;
          font-family: "JetBrains Mono", monospace; font-size: 10px;
          color: rgba(255,176,32,.8); background: rgba(10,11,15,.7); padding: 1px 4px; border-radius: 3px;
        }
        .dev-hud {
          position: fixed; left: 16px; bottom: 16px; z-index: 82; width: 210px;
          background: linear-gradient(160deg, rgba(17,19,25,.97), rgba(11,12,17,.97));
          border: 1px solid #2a2e3a; border-radius: 12px; overflow: hidden;
          box-shadow: 0 18px 44px rgba(0,0,0,.55);
          font-family: "JetBrains Mono", monospace;
          animation: eggpop .4s cubic-bezier(.16,1,.3,1);
        }
        .dev-hud-head {
          display: flex; align-items: center; gap: 8px;
          padding: 9px 12px; border-bottom: 1px solid #20242f;
          font-size: 11px; font-weight: 700; letter-spacing: .14em; color: #FFB020;
          background: linear-gradient(#15171e, #0f1116);
        }
        .dev-hud-dot { height: 7px; width: 7px; border-radius: 50%; background: #28c840; box-shadow: 0 0 8px #28c840; animation: eggblink 1.4s infinite; }
        .dev-hud-x { margin-left: auto; background: none; border: none; color: #6b7080; cursor: pointer; font-size: 12px; }
        .dev-hud-x:hover { color: #e7e8ee; }
        .dev-hud-stats {
          display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #20242f;
        }
        .dev-stat {
          display: flex; align-items: center; justify-content: space-between;
          gap: 6px; padding: 7px 12px; background: #0d0e13;
        }
        .dev-stat span { font-size: 9px; letter-spacing: .1em; color: #6b7080; }
        .dev-stat b { font-size: 12px; color: #c4c7d2; font-weight: 600; }
        .dev-stat b.g { color: #28c840; } .dev-stat b.a { color: #FFB020; } .dev-stat b.r { color: #ff6b6b; }
        .dev-hud-toggles { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid #20242f; }
        .dev-hud-toggles button {
          flex: 1; background: #15171e; border: 1px solid #262a35; color: #8b90a0;
          border-radius: 6px; padding: 5px 0; font-family: inherit; font-size: 10px; cursor: pointer;
          transition: all .15s;
        }
        .dev-hud-toggles button:hover { color: #e7e8ee; border-color: #3a3f4d; }
        .dev-hud-toggles button.on { background: #FFB020; border-color: #FFB020; color: #0a0b0f; font-weight: 700; }

        /* ===== system monitor window ===== */
        .mon-overlay {
          position: fixed; inset: 0; z-index: 72;
          background: rgba(0,0,0,.5); backdrop-filter: blur(2px);
          display: grid; place-items: center; padding: 20px;
        }
        .mon-window {
          display: flex; flex-direction: column;
          width: 100%; max-width: 940px; max-height: 90vh;
          border-radius: 12px; overflow: hidden;
          border: 1px solid #23262f; background: #0a0b0f;
          box-shadow: 0 24px 70px rgba(0,0,0,.65);
          animation: eggpop .4s cubic-bezier(.16,1,.3,1);
        }
        .mon-head {
          display: flex; align-items: center; gap: 10px; flex-shrink: 0;
          padding: 11px 14px; border-bottom: 1px solid #1c1f29;
          background: linear-gradient(#15171e, #0f1116);
        }
        .mon-title {
          font-family: "JetBrains Mono", monospace; font-size: 12px; color: #8b90a0;
        }
        .mon-meta {
          margin-left: auto; font-family: "JetBrains Mono", monospace;
          font-size: 10px; color: #6b7080;
        }
        .mon-head .egg-btn { margin-left: 8px; color: #6b7080; }
        .mon-head .egg-btn:hover { background: #22252f; color: #e7e8ee; }
        .mon-body { overflow-y: auto; }
        @media (max-width: 640px) {
          .mon-overlay { padding: 10px; }
          .mon-meta { display: none; }
        }

        @media (prefers-reduced-motion: reduce) {
          .egg-toast, .egg-toast-prog, .dev-hud, .dev-hud-dot, .mon-window,
          .egg-saver, .egg-saver-stage, .egg-saver-card, .egg-saver-dot, .egg-saver-hint {
            animation: none;
          }
        }
      `}</style>
    </>
  );
}
