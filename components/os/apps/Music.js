import React, { useEffect, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Music2, ExternalLink } from "lucide-react";

// raviOS Music — a real player backed by the YouTube IFrame API. Pick a track,
// it plays; songs auto-advance; scrub with the native controls or the bar here.
// Video IDs were looked up from each song's official upload.
const TRACKS = [
  { t: "Sajni", a: "Jal — The Band", id: "W31LlujrB08" },
  { t: "Attention", a: "Charlie Puth", id: "nfs8NYg7yQM" },
  { t: "There's Nothing Holdin' Me Back", a: "Shawn Mendes", id: "dT2owtxkU8k" },
  { t: "Sunflower", a: "Post Malone, Swae Lee", id: "ApXoWvfEYVU" },
  { t: "Sugar", a: "Maroon 5", id: "09R8_2nJtjg" },
  { t: "Kachaudi Gali", a: "Coke Studio Bharat · Rekha Bhardwaj", id: "UQ3sp9aAmjs" },
  { t: "Kya Mujhe Pyaar Hai", a: "KK · Woh Lamhe", id: "lrAM_H7v8wM" },
  { t: "Gone, Gone, Gone", a: "Phillip Phillips", id: "oozQ4yV__Vw" },
  { t: "Despacito", a: "Luis Fonsi ft. Daddy Yankee", id: "kJQP7kiw5Fk" },
  { t: "Stereo Hearts", a: "Gym Class Heroes ft. Adam Levine", id: "T3E9Wjbq44E" },
  { t: "Pasoori", a: "Coke Studio 14 · Ali Sethi x Shae Gill", id: "5Eqb_-j3FDA" },
  { t: "Die With A Smile", a: "Lady Gaga, Bruno Mars", id: "kPa7bsKwL-c" },
  { t: "Why This Kolaveri Di", a: "Dhanush · Anirudh", id: "YR12Z8f1Dh8" },
  { t: "Locked Away", a: "R. City ft. Adam Levine", id: "6GUm5g8SG4o" },
  { t: "Bye Bye Bye", a: "*NSYNC", id: "Eo-KmOd3i7s" },
  { t: "Aaoge Tum Kabhi", a: "The Local Train", id: "i96UO8-GFvw" },
  { t: "Blinding Lights", a: "The Weeknd", id: "4NRXx6U8ABQ" },
  { t: "I Ain't Worried", a: "OneRepublic · Top Gun: Maverick", id: "mNEUkkoUoIA" },
  { t: "Do I Wanna Know?", a: "Arctic Monkeys", id: "bpOSxM0rNPM" },
  { t: "We Will Rock You", a: "Queen", id: "-tJYN-eG1zk" },
];

const fmt = (s) => {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

export default function Music() {
  const [i, setI] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState({ cur: 0, dur: 0 });
  const player = useRef(null);
  const iRef = useRef(0);
  const hostRef = useRef(null);
  const listRef = useRef(null);

  iRef.current = i;
  const cur = TRACKS[i];

  const goto = (n) => {
    const ni = (n + TRACKS.length) % TRACKS.length;
    setI(ni);
    try { player.current?.loadVideoById(TRACKS[ni].id); } catch (_) {}
  };
  const next = () => goto(iRef.current + 1);
  const prev = () => goto(iRef.current - 1);
  const toggle = () => {
    const p = player.current;
    if (!p) return;
    playing ? p.pauseVideo() : p.playVideo();
  };

  // ---- YouTube IFrame API ----
  useEffect(() => {
    let alive = true;
    const build = () => {
      if (!alive || !hostRef.current || !window.YT?.Player) return;
      player.current = new window.YT.Player(hostRef.current, {
        videoId: TRACKS[0].id,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: () => setReady(true),
          onStateChange: (e) => {
            setPlaying(e.data === 1);          // 1 = playing
            if (e.data === 0) next();          // 0 = ended → auto-advance
          },
        },
      });
    };
    if (window.YT?.Player) build();
    else {
      const prevCb = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prevCb && prevCb(); build(); };
      if (!document.getElementById("yt-iframe-api")) {
        const tag = document.createElement("script");
        tag.id = "yt-iframe-api";
        tag.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(tag);
      }
    }
    return () => { alive = false; try { player.current?.destroy(); } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // progress ticker
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const p = player.current;
      if (p?.getDuration) setPos({ cur: p.getCurrentTime() || 0, dur: p.getDuration() || 0 });
    }, 500);
    return () => clearInterval(id);
  }, [ready]);

  // keep the active row in view
  useEffect(() => {
    listRef.current?.querySelector(".mu-row.on")?.scrollIntoView({ block: "nearest" });
  }, [i]);

  const seek = (e) => {
    const p = player.current;
    if (!p?.getDuration) return;
    const r = e.currentTarget.getBoundingClientRect();
    p.seekTo(((e.clientX - r.left) / r.width) * (p.getDuration() || 0), true);
  };
  const pct = pos.dur ? (pos.cur / pos.dur) * 100 : 0;

  return (
    <div className="mu">
      <div className="mu-stage">
        <div className="mu-video"><div ref={hostRef} /></div>
        {!ready && <div className="mu-loading"><Music2 className="h-5 w-5" /> loading player…</div>}
      </div>

      <div className="mu-now">
        <div className="mu-meta">
          <p className="mu-eyebrow">Now Playing · {i + 1}/{TRACKS.length}</p>
          <h1 className="mu-track" title={cur.t}>{cur.t}</h1>
          <p className="mu-artist">{cur.a}</p>
        </div>
        <a className="mu-yt" href={`https://youtu.be/${cur.id}`} target="_blank" rel="noopener noreferrer" title="Open on YouTube">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="mu-seekwrap">
        <span className="mu-time">{fmt(pos.cur)}</span>
        <div className="mu-seek" onClick={seek}><span className="mu-fill" style={{ width: `${pct}%` }} /></div>
        <span className="mu-time">{fmt(pos.dur)}</span>
      </div>

      <div className="mu-ctrls">
        <button onClick={prev} aria-label="Previous"><SkipBack className="h-5 w-5" /></button>
        <button className="mu-play" onClick={toggle} disabled={!ready} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
        </button>
        <button onClick={next} aria-label="Next"><SkipForward className="h-5 w-5" /></button>
      </div>

      <div className="mu-list" ref={listRef}>
        <p className="mu-list-h">Playlist · {TRACKS.length} tracks</p>
        {TRACKS.map((tr, n) => (
          <button key={tr.id} className={`mu-row${n === i ? " on" : ""}`} onClick={() => { goto(n); player.current?.playVideo(); }}>
            <span className="mu-thumb"><img src={`https://i.ytimg.com/vi/${tr.id}/default.jpg`} alt="" loading="lazy" />
              {n === i && playing && <span className="mu-eq"><i /><i /><i /></span>}
            </span>
            <span className="mu-row-t">{tr.t}<em>{tr.a}</em></span>
          </button>
        ))}
      </div>

      <style jsx>{`
        .mu { height: 100%; display: flex; flex-direction: column; background: var(--c-bg); color: var(--c-fg); font-family: "Inter", sans-serif; }
        .mu-stage { position: relative; background: #000; flex-shrink: 0; }
        /* cap the video height so the controls + playlist stay in view on wide /
           maximized windows (the player letterboxes inside this box) */
        .mu-video { position: relative; width: 100%; height: clamp(160px, 34vh, 320px); }
        .mu-video :global(iframe), .mu-video :global(div) { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
        .mu-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; color: #8b90a0; font-family: "JetBrains Mono", monospace; font-size: 12px; }

        .mu-now { display: flex; align-items: flex-start; gap: 10px; padding: 14px 16px 8px; }
        .mu-meta { min-width: 0; flex: 1; }
        .mu-eyebrow { font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--c-accentText, #FFB020); }
        .mu-track { margin-top: 5px; font-family: "Space Grotesk", sans-serif; font-size: 20px; font-weight: 700; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mu-artist { margin-top: 2px; font-size: 13px; color: var(--c-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mu-yt { display: grid; place-items: center; height: 30px; width: 30px; flex-shrink: 0; border-radius: 8px; color: var(--c-muted); border: 1px solid var(--c-edge); }
        .mu-yt:hover { color: var(--c-fg); border-color: var(--c-muted); }

        .mu-seekwrap { display: flex; align-items: center; gap: 10px; padding: 4px 16px; }
        .mu-time { font-family: "JetBrains Mono", monospace; font-size: 10.5px; color: var(--c-muted); width: 34px; text-align: center; }
        .mu-seek { flex: 1; height: 5px; border-radius: 3px; background: var(--c-edge); cursor: pointer; overflow: hidden; }
        .mu-seek:hover { height: 7px; }
        .mu-fill { display: block; height: 100%; background: linear-gradient(90deg, #FFB020, #FFCB5C); border-radius: 3px; }

        .mu-ctrls { display: flex; align-items: center; justify-content: center; gap: 20px; padding: 8px 0 12px; }
        .mu-ctrls button { background: none; border: none; color: var(--c-fg); cursor: pointer; display: grid; place-items: center; transition: opacity .12s; opacity: .8; }
        .mu-ctrls button:hover:not(:disabled) { opacity: 1; }
        .mu-play { height: 48px; width: 48px; border-radius: 50% !important; background: var(--c-accent) !important; color: var(--c-accentFg, #0a0b0f) !important; opacity: 1 !important; }
        .mu-play:hover:not(:disabled) { filter: brightness(1.08); }
        .mu-play:disabled { opacity: .4; cursor: default; }

        .mu-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 10px; border-top: 1px solid var(--c-edge); }
        .mu-list-h { position: sticky; top: 0; background: var(--c-bg); font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--c-muted); padding: 12px 8px 8px; }
        .mu-row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; background: none; border: none; cursor: pointer; padding: 8px; border-radius: 9px; transition: background .12s; }
        .mu-row:hover { background: color-mix(in srgb, var(--c-fg) 6%, transparent); }
        .mu-row.on { background: color-mix(in srgb, var(--c-accent) 12%, transparent); }
        .mu-thumb { position: relative; height: 40px; width: 56px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: var(--c-surface); }
        .mu-thumb img { height: 100%; width: 100%; object-fit: cover; }
        .mu-eq { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 2.5px; background: rgba(0,0,0,.55); }
        .mu-eq i { width: 3px; height: 6px; background: #FFB020; border-radius: 1px; animation: mu-eq .8s ease-in-out infinite; }
        .mu-eq i:nth-child(2) { animation-delay: .2s; } .mu-eq i:nth-child(3) { animation-delay: .4s; }
        @keyframes mu-eq { 0%,100% { height: 5px; } 50% { height: 16px; } }
        .mu-row-t { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 13.5px; color: var(--c-fg); white-space: nowrap; overflow: hidden; }
        .mu-row.on .mu-row-t { color: var(--c-accentText, #FFB020); }
        .mu-row-t em { font-style: normal; font-size: 11.5px; color: var(--c-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        @media (prefers-reduced-motion: reduce) { .mu-eq i { animation: none; } }
      `}</style>
    </div>
  );
}
