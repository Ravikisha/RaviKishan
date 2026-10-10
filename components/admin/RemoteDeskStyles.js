// The remote desk's own styles. Everything shared with the legacy stream
// (the bar, the meter, the readout, Watch / Drive, the icon buttons, the
// empty frame) comes from WorkbenchStyles and JarvisStyles, so the two
// screens read as one interface; this file holds only what is new.
import React from "react";

export default function RemoteDeskStyles() {
  return (
    <style jsx global>{`
      .rd-root {
        min-width: 0;
      }
      /* the picture: as large as the room left, at the session's own ratio */
      .rd-screen {
        width: min(100%, calc((100vh - var(--jp-room, 168px)) * var(--rd-ar, 1.7778)));
        width: min(100%, calc((100dvh - var(--jp-room, 168px)) * var(--rd-ar, 1.7778)));
        margin-inline: auto;
        background: #000;
        box-sizing: border-box;
      }
      .jp-stage .wb-screen.rd-screen {
        width: min(100%, calc((100vh - var(--jp-room, 168px)) * var(--rd-ar, 1.7778)));
        width: min(100%, calc((100dvh - var(--jp-room, 168px)) * var(--rd-ar, 1.7778)));
      }
      .rd-video {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #000;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }
      .rd-screen.driving .rd-video {
        touch-action: none;
      }
      .rd-screen:focus {
        outline: none;
      }
      /* driving, but the keys are not captured (focus is elsewhere): the
         edge is dashed until the picture has focus again */
      .rd-screen.driving:not(.keys) {
        box-shadow: none;
        outline: 2px dashed var(--a-amber, #ffb020);
        outline-offset: 1px;
      }
      .rd-screen:fullscreen {
        width: 100vw;
        height: 100vh;
        max-width: none;
        aspect-ratio: auto !important;
        border: 0;
        border-radius: 0;
        margin: 0;
      }
      .rd-veil {
        background: repeating-linear-gradient(135deg, #07080b 0 14px, #0a0c10 14px 15px);
      }
      .rd-fail {
        max-width: 52ch;
        text-align: left;
      }
      .rd-fail p {
        margin: 0 0 10px;
        font-size: 13px;
        line-height: 1.55;
        color: var(--a-dim, #8b90a0);
      }
      .rd-fail .rd-fail-what {
        font-family: "Space Grotesk", sans-serif;
        font-size: clamp(17px, 2vw, 22px);
        font-weight: 600;
        line-height: 1.2;
        color: #ffb4b4;
      }
      .rd-acts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .rd-blank .rd-acts .jp-connect-btn {
        margin: 0;
      }

      /* the readout is a button: it opens every measurement */
      .rd-rate {
        background: none;
        border: 0;
        padding: 8px 0;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
        text-align: left;
        border-radius: 6px;
      }
      .rd-rate:hover b {
        text-decoration: underline;
        text-decoration-color: #3a3f4d;
        text-underline-offset: 3px;
      }
      .rd-rate:focus-visible,
      .rd-prof-sel:focus-visible,
      .rd-sess-toggle:focus-visible {
        outline: 2px solid var(--a-amber, #ffb020);
        outline-offset: 2px;
      }
      .rd-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 0;
        margin: 4px 0 0;
        font-size: 12px;
      }
      .rd-stats > span + span {
        border-left: 1px solid #2f3442;
        margin-left: 8px;
        padding-left: 8px;
      }
      .rd-prof {
        display: inline-flex;
      }
      .rd-prof-sel {
        min-height: 40px;
        max-width: 110px;
        padding: 0 6px;
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 8px;
        color: var(--a-text, #e9ebf2);
        font: inherit;
        font-size: 12.5px;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
      }
      .rd-prof-sel:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .rd-prof-sel option {
        background: #0f1117;
        color: #e9ebf2;
      }
      .wb-icon.on {
        color: var(--a-text, #e9ebf2);
        background: var(--a-raise, #171a22);
      }

      /* everything under the bar lines up with the picture */
      .jp-stage .rd-stats,
      .jp-stage .rd-stepup,
      .jp-stage .rd-restart,
      .jp-stage .rd-clip,
      .jp-stage .rd-note,
      .jp-stage .rd-sessions {
        width: min(100%, calc((100vh - var(--jp-room, 168px)) * 16 / 9));
        width: min(100%, calc((100dvh - var(--jp-room, 168px)) * 16 / 9));
        margin-inline: auto;
        box-sizing: border-box;
      }
      .rd-stepup,
      .rd-restart,
      .rd-note {
        margin-top: 10px;
      }
      /* the desk itself refused: the edge says it came from the box */
      .rd-stepup.from-desk,
      .rd-restart:not(.moved) {
        border-left: 3px solid var(--a-amber, #ffb020);
      }
      .rd-restart p b {
        font-weight: 600;
        color: var(--a-text, #e9ebf2);
      }
      .rd-restart-why {
        color: #ffb4b4;
      }
      .rd-clip {
        display: grid;
        gap: 10px;
        margin-top: 10px;
        padding: 12px 0 2px 12px;
        border-left: 3px solid var(--a-line, #2b3040);
        min-width: 0;
      }
      .rd-clip-send {
        display: grid;
        gap: 8px;
        min-width: 0;
      }
      .rd-clip-text {
        width: 100%;
        box-sizing: border-box;
        resize: vertical;
        min-height: 60px;
      }
      .rd-clip-in {
        display: grid;
        gap: 8px;
        min-width: 0;
      }
      .rd-clip-got {
        margin: 0;
        max-height: 160px;
        overflow: auto;
        padding: 10px 12px;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 8px;
        background: var(--a-void, #08090d);
        color: var(--a-text, #e9ebf2);
        font-size: 12.5px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .rd-clip-in .ag-ghost {
        justify-self: start;
      }

      /* the sessions */
      .rd-sessions {
        margin-top: 20px;
        padding-bottom: 24px;
        min-width: 0;
      }
      .rd-sess-head {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px 14px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--a-line, #1e222c);
      }
      .rd-sess-h,
      .rd-sess-toggle {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 16px;
        font-weight: 600;
        color: var(--a-text, #e9ebf2);
      }
      .rd-sess-h em,
      .rd-sess-toggle em {
        font-style: normal;
        font-weight: 400;
        font-size: 12.5px;
        color: var(--a-dim, #7d8496);
        margin-left: 4px;
      }
      .rd-sess-toggle {
        display: none;
        background: none;
        border: 0;
        padding: 8px 0;
        cursor: pointer;
      }
      .rd-cap {
        display: inline-flex;
        flex-wrap: wrap;
        margin: 0;
        font-size: 12.5px;
        color: var(--a-dim, #7d8496);
        min-width: 0;
      }
      .rd-cap > span + span {
        border-left: 1px solid #2f3442;
        margin-left: 8px;
        padding-left: 8px;
      }
      .rd-cap[data-full="1"] > span:first-child {
        color: #ff8a8a;
      }
      .rd-refresh {
        margin-left: auto;
      }
      .rd-sess-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
      }
      .rd-sess {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 0 10px 12px;
        border-left: 3px solid #c9cdd8;
        border-bottom: 1px solid var(--a-line, #1e222c);
        min-width: 0;
      }
      .rd-sess.s-connected {
        border-left-color: #4ade80;
      }
      .rd-sess.s-idle {
        border-left-style: dashed;
        border-left-color: #8b90a0;
      }
      .rd-sess.s-creating,
      .rd-sess.s-stopping {
        border-left-style: dashed;
        border-left-color: #5c6377;
      }
      .rd-sess.s-stopped {
        border-left-color: #3a3f4d;
      }
      .rd-sess.s-stopped .rd-sess-name {
        color: var(--a-dim, #7d8496);
      }
      .rd-sess.s-failed {
        border-left-color: #ff6b6b;
      }
      .rd-sess.s-failed .rd-sess-st {
        color: #ff8a8a;
      }
      .rd-sess.current {
        background: var(--a-raise, #171a22);
      }
      .rd-sess-tx {
        flex: 1 1 auto;
        min-width: 0;
      }
      .rd-sess-name {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 14.5px;
        color: var(--a-text, #e9ebf2);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .rd-sess-meta {
        margin: 3px 0 0;
        display: flex;
        flex-wrap: wrap;
        font-size: 12px;
        color: var(--a-dim, #7d8496);
        font-variant-numeric: tabular-nums;
        min-width: 0;
      }
      .rd-sess-meta > * + * {
        border-left: 1px solid #2f3442;
        margin-left: 8px;
        padding-left: 8px;
      }
      .rd-sess-acts {
        flex: none;
        display: flex;
        gap: 6px;
        padding-right: 8px;
      }
      .rd-sess-acts button {
        min-height: 40px;
      }
      .rd-new {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 14px;
        min-width: 0;
      }
      .rd-new-name {
        flex: 1 1 180px;
        min-width: 0;
      }
      .rd-new-prof {
        flex: 0 0 auto;
        width: auto;
      }
      .rd-full {
        flex: 1 1 100%;
        margin: 0;
      }

      @media (max-width: 640px) {
        /* a phone: one view at a time. While a session is on screen the
           list folds behind its own heading, under the thumb. */
        .rd-root.viewing .rd-sess-toggle {
          display: inline-block;
        }
        .rd-root.viewing .rd-sess-h {
          display: none;
        }
        .rd-root.viewing .rd-sessions:not(.open) .rd-sess-body {
          display: none;
        }
        .rd-sess {
          flex-wrap: wrap;
        }
        .rd-sess-acts {
          flex: 1 1 100%;
          justify-content: flex-end;
        }
        .rd-new-name {
          flex-basis: 100%;
        }
        .rd-new-go {
          flex: 1 1 auto;
        }
        .rd-acts > button {
          flex: 1 1 auto;
        }
        .rd-prof-sel {
          max-width: 96px;
        }
      }
    `}</style>
  );
}
