import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, RotateCw, Home, Search, Lock, Zap,
  ExternalLink, X, Github, Newspaper, BookOpen, Map, Rss, Globe,
} from "lucide-react";

// Nova — the browser that ships with raviOS. Type a URL or a search; it loads
// in a frame. Many sites block embedding (a security header, not a bug), so the
// blank/blocked state gets an honest fallback + an "open in a new tab" escape.
const favicon = (host) => `https://www.google.com/s2/favicons?domain=${host}&sz=64`;

const hostOf = (u) => { try { return new URL(u).host; } catch { return ""; } };
const isSecure = (u) => /^https:\/\//i.test(u);

// URL vs. search: a scheme or a dotted host → navigate; anything else → search
const normalize = (raw) => {
  const t = (raw || "").trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(t)) return "http://" + t;
  if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t)) return "https://" + t;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(t);
};

// Hosts that send X-Frame-Options / CSP frame-ancestors and refuse embedding.
// For these we skip the iframe (which would render the browser's native
// "refused to connect" error) and show a clean fallback + open-in-tab instead.
const NO_EMBED = [
  /(^|\.)dev\.to$/i, /(^|\.)github\.com$/i, /(^|\.)linkedin\.com$/i,
  /(^|\.)medium\.com$/i, /(^|\.)twitter\.com$/i, /(^|\.)x\.com$/i,
  /(^|\.)developer\.mozilla\.org$/i, /(^|\.)wikipedia\.org$/i,
  /(^|\.)youtube\.com$/i, /(^|\.)google\.com$/i, /(^|\.)openstreetmap\.org$/i,
  /(^|\.)npmjs\.com$/i, /(^|\.)stackoverflow\.com$/i, /(^|\.)reddit\.com$/i,
  /(^|\.)instagram\.com$/i, /(^|\.)facebook\.com$/i,
];
const blocksEmbed = (host) => !!host && NO_EMBED.some((re) => re.test(host));

const TILES = [
  { name: "GitHub", url: "https://github.com/Ravikisha", icon: Github, a: "#e7e8ee" },
  { name: "dev.to", url: "https://dev.to/ravikishan", icon: Newspaper, a: "#60A5FA" },
  { name: "Wikipedia", url: "https://www.wikipedia.org", icon: BookOpen, a: "#c4c7d2" },
  { name: "Hacker News", url: "https://news.ycombinator.com", icon: Rss, a: "#FFB020" },
  { name: "MDN", url: "https://developer.mozilla.org", icon: Globe, a: "#4ED0C0" },
  { name: "OpenStreetMap", url: "https://www.openstreetmap.org", icon: Map, a: "#34D399" },
];

export default function Browser() {
  const [hist, setHist] = useState([]);
  const [hi, setHi] = useState(-1);
  const [nonce, setNonce] = useState(0);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState(false);       // "may be blocked" nudge
  const inputRef = useRef(null);
  const hintTimer = useRef(null);

  const url = hi >= 0 ? hist[hi] : "";
  const onStart = hi < 0;

  useEffect(() => setInput(url), [url]);
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  const navigate = (raw) => {
    const u = normalize(raw);
    if (!u) return;
    setHist((h) => [...h.slice(0, hi + 1), u]);
    setHi((i) => i + 1);
    beginLoad();
  };
  const beginLoad = () => {
    setLoading(true); setHint(false);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(true), 4000); // slow → likely blocked
  };
  const back = () => { if (hi >= 0) { setHi((i) => i - 1); if (hi - 1 >= 0) beginLoad(); } };
  const forward = () => { if (hi < hist.length - 1) { setHi((i) => i + 1); beginLoad(); } };
  const reload = () => { if (!onStart) { setNonce((n) => n + 1); beginLoad(); } };
  const home = () => { setHi(-1); setInput(""); setLoading(false); setHint(false); setTimeout(() => inputRef.current?.focus(), 40); };
  const openExternal = () => url && window.open(url, "_blank", "noopener");

  const submit = (e) => { e.preventDefault(); navigate(input); };
  const onLoaded = () => { setLoading(false); clearTimeout(hintTimer.current); };

  const secure = isSecure(url);
  const host = hostOf(url);
  const searching = /duckduckgo\.com\/\?q=/.test(url);
  const blocked = !onStart && blocksEmbed(host);

  return (
    <div className="br">
      {/* toolbar */}
      <div className="br-bar">
        <div className="br-nav">
          <button onClick={back} disabled={hi < 0} title="Back" aria-label="Back"><ArrowLeft className="h-4 w-4" /></button>
          <button onClick={forward} disabled={hi >= hist.length - 1} title="Forward" aria-label="Forward"><ArrowRight className="h-4 w-4" /></button>
          <button onClick={reload} disabled={onStart} title="Reload" aria-label="Reload"><RotateCw className={`h-4 w-4${loading ? " br-spin" : ""}`} /></button>
          <button onClick={home} title="New tab" aria-label="New tab"><Home className="h-4 w-4" /></button>
        </div>

        <form className="br-addr" onSubmit={submit}>
          <span className="br-addr-ic">
            {searching ? <Search className="h-3.5 w-3.5" /> : secure ? <Lock className="h-3.5 w-3.5 br-lock" /> : <Zap className="h-3.5 w-3.5" />}
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={(e) => e.target.select()}
            spellCheck={false}
            autoComplete="off"
            placeholder="Search or enter a URL"
            aria-label="Address and search"
          />
          {host && !onStart && <span className="br-host">{host}</span>}
        </form>

        <button className="br-ext" onClick={openExternal} disabled={onStart} title="Open in a new tab" aria-label="Open in a new tab">
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>

      {loading && !blocked && <div className="br-load"><span /></div>}

      {hint && !onStart && !blocked && (
        <div className="br-blocked">
          <span><b>{host}</b> may block embedding — that&apos;s a security setting, not a bug.</span>
          <button onClick={openExternal}>Open in a new tab <ExternalLink className="h-3 w-3" /></button>
          <button className="br-blocked-x" onClick={() => setHint(false)} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* content */}
      <div className="br-view">
        {onStart ? (
          <div className="br-start">
            <div className="br-brand"><span className="br-diamond" /> Nova</div>
            <form className="br-search" onSubmit={submit}>
              <Search className="h-5 w-5" />
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoFocus
                spellCheck={false}
                placeholder="Search or type a URL, then Enter"
                aria-label="Search or type a URL"
              />
            </form>
            <div className="br-tiles">
              {TILES.map((t) => {
                const Icon = t.icon;
                return (
                  <button key={t.name} className="br-tile" onClick={() => navigate(t.url)}>
                    <span className="br-tile-ic"><img src={favicon(hostOf(t.url))} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} /><Icon className="h-4 w-4" style={{ color: t.a }} /></span>
                    <span className="br-tile-nm">{t.name}</span>
                  </button>
                );
              })}
            </div>
            <p className="br-note">the browser that ships with raviOS · some sites block embedding — those open in a new tab</p>
          </div>
        ) : blocked ? (
          <div className="br-noembed">
            <span className="br-ne-fav">
              <img src={favicon(host)} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            </span>
            <div className="br-ne-host">{host}</div>
            <p className="br-ne-msg">
              <b>{host}</b> won&apos;t load inside a frame — it sends a security header that blocks embedding. Not a Nova bug, just the web being cautious.
            </p>
            <div className="br-ne-actions">
              <button className="br-ne-open" onClick={openExternal}>
                Open {host} <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button className="br-ne-back" onClick={hi > 0 ? back : home}>
                {hi > 0 ? "Back" : "New tab"}
              </button>
            </div>
          </div>
        ) : (
          <iframe
            key={url + "#" + nonce}
            src={url}
            title="Nova browser"
            className="br-frame"
            onLoad={onLoaded}
            referrerPolicy="no-referrer"
            allow="fullscreen; clipboard-write"
          />
        )}
      </div>

      <style jsx>{`
        .br { height: 100%; display: flex; flex-direction: column; background: #0a0b0f; color: #e7e8ee; font-family: "Inter", sans-serif; }
        .br-bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #101218; border-bottom: 1px solid #1c1f29; }
        .br-nav { display: flex; gap: 2px; }
        .br-nav button, .br-ext {
          display: grid; place-items: center; height: 32px; width: 32px; border-radius: 8px;
          background: none; border: none; color: #8b90a0; cursor: pointer; transition: background .12s, color .12s;
        }
        .br-nav button:hover:not(:disabled), .br-ext:hover:not(:disabled) { background: #1a1d26; color: #e7e8ee; }
        .br-nav button:disabled, .br-ext:disabled { opacity: .35; cursor: default; }
        .br-spin { animation: br-spin 1s linear infinite; }
        @keyframes br-spin { to { transform: rotate(360deg); } }

        .br-addr { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; border-radius: 10px; background: #0a0b0f; border: 1px solid #23262f; transition: border-color .12s; }
        .br-addr:focus-within { border-color: #60A5FA; }
        .br-addr-ic { display: grid; place-items: center; color: #6b7080; flex-shrink: 0; }
        .br-lock { color: #34D399; }
        .br-addr input { flex: 1; min-width: 0; background: none; border: none; outline: none; color: #e7e8ee; font-family: "JetBrains Mono", monospace; font-size: 12.5px; }
        .br-addr input::placeholder { color: #565b6b; }
        .br-host { flex-shrink: 0; font-family: "JetBrains Mono", monospace; font-size: 10px; color: #565b6b; }

        .br-load { height: 2px; background: transparent; overflow: hidden; }
        .br-load span { display: block; height: 100%; width: 40%; background: linear-gradient(90deg, transparent, #60A5FA, transparent); animation: br-load 1.1s ease-in-out infinite; }
        @keyframes br-load { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }

        .br-blocked { display: flex; align-items: center; gap: 12px; padding: 9px 14px; background: color-mix(in srgb, #FFB020 10%, #101218); border-bottom: 1px solid #2a2620; font-size: 12.5px; color: #c4c7d2; }
        .br-blocked b { color: #FFB020; font-family: "JetBrains Mono", monospace; }
        .br-blocked button { display: inline-flex; align-items: center; gap: 5px; background: #FFB020; color: #0a0b0f; border: none; border-radius: 7px; padding: 5px 10px; font-size: 11.5px; font-weight: 700; cursor: pointer; }
        .br-blocked-x { margin-left: auto; background: none !important; color: #6b7080 !important; padding: 4px !important; }
        .br-blocked-x:hover { color: #e7e8ee !important; }

        .br-view { flex: 1; min-height: 0; background: #06070a; position: relative; }
        .br-frame { width: 100%; height: 100%; border: none; background: #fff; }

        /* fallback for sites that refuse embedding */
        .br-noembed {
          height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 14px; padding: 32px; text-align: center;
          background: radial-gradient(120% 90% at 50% 16%, #12151d, #08090e 72%);
        }
        .br-ne-fav {
          display: grid; place-items: center; height: 64px; width: 64px; border-radius: 18px;
          background: #141821; border: 1px solid #23262f; box-shadow: 0 14px 32px rgba(0,0,0,.4);
        }
        .br-ne-fav img { height: 34px; width: 34px; border-radius: 8px; }
        .br-ne-host { font-family: "JetBrains Mono", monospace; font-size: 14px; color: #e7e8ee; letter-spacing: .01em; }
        .br-ne-msg { max-width: 42ch; font-size: 13px; line-height: 1.6; color: #8b90a0; }
        .br-ne-msg b { color: #FFB020; font-family: "JetBrains Mono", monospace; font-weight: 400; }
        .br-ne-actions { margin-top: 6px; display: flex; align-items: center; gap: 10px; }
        .br-ne-open {
          display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
          background: #FFB020; color: #0a0b0f; border: none; border-radius: 9px;
          padding: 9px 15px; font-size: 12.5px; font-weight: 700; font-family: "Inter", sans-serif;
          transition: filter .12s;
        }
        .br-ne-open:hover { filter: brightness(1.07); }
        .br-ne-back {
          cursor: pointer; background: none; border: 1px solid #23262f; color: #8b90a0;
          border-radius: 9px; padding: 9px 15px; font-size: 12.5px; font-family: "Inter", sans-serif;
          transition: color .12s, border-color .12s;
        }
        .br-ne-back:hover { color: #e7e8ee; border-color: #3a3f4c; }
        .br-ne-open:focus-visible, .br-ne-back:focus-visible { outline: 2px solid #60A5FA; outline-offset: 2px; }

        /* start page */
        .br-start { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; background: radial-gradient(120% 90% at 50% 12%, #12151d, #08090e 70%); }
        .br-brand { display: flex; align-items: center; gap: 10px; font-family: "Space Grotesk", sans-serif; font-size: 30px; font-weight: 700; color: #F4F5F8; }
        .br-diamond { height: 13px; width: 13px; border-radius: 3px; background: #60A5FA; transform: rotate(45deg); box-shadow: 0 0 16px rgba(96,165,250,.6); }
        .br-search { margin-top: 24px; width: 100%; max-width: 520px; display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-radius: 14px; background: #101218; border: 1px solid #23262f; color: #6b7080; transition: border-color .15s; }
        .br-search:focus-within { border-color: #60A5FA; }
        .br-search input { flex: 1; min-width: 0; background: none; border: none; outline: none; color: #e7e8ee; font-size: 15px; font-family: "Inter", sans-serif; }
        .br-search input::placeholder { color: #565b6b; }
        .br-tiles { margin-top: 30px; display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; width: 100%; max-width: 560px; }
        .br-tile { display: flex; flex-direction: column; align-items: center; gap: 9px; background: none; border: none; cursor: pointer; padding: 4px; }
        .br-tile-ic { position: relative; display: grid; place-items: center; height: 52px; width: 52px; border-radius: 14px; background: #141821; border: 1px solid #23262f; transition: transform .15s, border-color .15s; }
        .br-tile:hover .br-tile-ic { transform: translateY(-3px); border-color: #60A5FA; }
        .br-tile-ic img { position: absolute; inset: 0; margin: auto; height: 22px; width: 22px; border-radius: 4px; background: #141821; }
        .br-tile-nm { font-size: 11.5px; color: #8b90a0; }
        .br-note { margin-top: 30px; font-family: "JetBrains Mono", monospace; font-size: 10.5px; color: #4b5060; text-align: center; max-width: 46ch; line-height: 1.6; }

        @media (max-width: 640px) {
          .br-host { display: none; }
          .br-tiles { grid-template-columns: repeat(3, 1fr); }
        }
        @media (prefers-reduced-motion: reduce) { .br-spin, .br-load span { animation: none; } }
      `}</style>
    </div>
  );
}
