import React from "react";
import { useSiteContent } from "../../lib/useSiteContent";

// Desktop wallpaper — an editorial portrait hero (behind windows, non-interactive).
// Thin oversized "Hello." + real stats on the left, a grayscale cutout portrait
// bleeding off the bottom-right. One amber accent in an otherwise mono composition.
export default function Wallpaper() {
  const { identity, github } = useSiteContent();
  return (
    <div className="os-wall" aria-hidden="true">
      <div className="os-wall-portrait">
        <img src={identity?.photo || "/assets/myimage.png"} alt="" draggable="false" />
      </div>

      <div className="os-wall-copy">
        <div className="os-wall-stats">
          <div className="os-wall-stat">
            <b>{github?.stars ?? 167}<i> ★</i></b>
            <span>GitHub stars</span>
          </div>
          <div className="os-wall-stat">
            <b>1,200<i>+</i></b>
            <span>problems solved</span>
          </div>
        </div>

        <h1 className="os-wall-hello">Hello<i>.</i></h1>
        <p className="os-wall-role">
          — I&apos;m {identity?.name || "Ravi Kishan"}. I build systems from first principles.
        </p>
      </div>

      <span className="os-wall-year">{github?.since ?? 2019} — now</span>
      <span className="os-wall-hint">open an app ↓</span>

      <style jsx>{`
        .os-wall {
          position: fixed; inset: 0; z-index: 20; pointer-events: none; overflow: hidden;
          background: linear-gradient(120deg, #EDEEF1 0%, #E4E6EA 55%, #DCDEE3 100%);
          --wfg: #14161B; --wmut: #8A8F99; --wline: #D3D6DB;
        }
        :global(html.dark) .os-wall {
          background: linear-gradient(120deg, #0B0D13 0%, #08090F 55%, #050609 100%);
          --wfg: #F4F5F8; --wmut: #6B7280; --wline: #191c24;
        }

        /* inset from the right so the face clears the top-right widget column */
        .os-wall-portrait {
          position: absolute; right: clamp(8px, 13vw, 232px); bottom: 0; height: 94%;
          display: flex; align-items: flex-end; justify-content: flex-end;
        }
        .os-wall-portrait img {
          height: 100%; width: auto; object-fit: contain; object-position: bottom right;
          filter: saturate(1.04) contrast(1.02) drop-shadow(0 24px 48px rgba(0,0,0,.22));
        }
        :global(html.dark) .os-wall-portrait img { filter: saturate(1.02) contrast(1.03) drop-shadow(0 24px 52px rgba(0,0,0,.5)); }

        .os-wall-copy {
          position: absolute; left: clamp(26px, 6vw, 96px); top: 50%; transform: translateY(-52%);
          max-width: 640px;
        }
        .os-wall-stats { display: flex; gap: 46px; margin-bottom: 30px; }
        .os-wall-stat b {
          font-family: "Space Grotesk", sans-serif; font-weight: 600; font-size: 34px;
          letter-spacing: -.02em; color: var(--wfg); line-height: 1;
        }
        .os-wall-stat b i { font-style: normal; color: #FFB020; }
        .os-wall-stat span {
          display: block; margin-top: 6px; font-family: "JetBrains Mono", monospace;
          font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--wmut);
        }

        .os-wall-hello {
          font-family: "Space Grotesk", sans-serif; font-weight: 300;
          font-size: clamp(78px, 14vw, 200px); line-height: .86; letter-spacing: -.045em;
          color: var(--wfg);
        }
        .os-wall-hello i { font-style: normal; color: #FFB020; }
        .os-wall-role {
          margin-top: 22px; max-width: 44ch; font-family: "Inter", sans-serif;
          font-size: clamp(15px, 1.5vw, 20px); line-height: 1.55; color: var(--wmut);
        }

        .os-wall-year {
          position: absolute; left: 24px; bottom: 44px; writing-mode: vertical-rl; transform: rotate(180deg);
          font-family: "JetBrains Mono", monospace; font-size: 11px; letter-spacing: .22em; color: var(--wmut);
        }
        .os-wall-hint {
          position: absolute; left: clamp(26px, 6vw, 96px); bottom: 36px;
          font-family: "JetBrains Mono", monospace; font-size: 11px; letter-spacing: .14em; color: var(--wmut);
        }

        /* mid screens — smaller portrait, still clear of the widgets */
        @media (max-width: 1200px) {
          .os-wall-portrait { right: clamp(8px, 9vw, 150px); height: 80%; }
        }
        /* widgets hide at 900px (see Widgets.js) → portrait can drift back to the
           edge, dimmed so the copy stays readable over it */
        @media (max-width: 900px) {
          .os-wall-portrait { right: -2%; height: 74%; opacity: .5; }
        }
        @media (max-width: 640px) {
          .os-wall-portrait { right: -10%; height: 62%; opacity: .2; }
          .os-wall-copy { left: 22px; right: 22px; max-width: none; }
          .os-wall-stats { gap: 30px; margin-bottom: 22px; }
          .os-wall-year { display: none; }
        }
      `}</style>
    </div>
  );
}
