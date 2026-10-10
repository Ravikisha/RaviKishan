// The workbench's stylesheet, shared by the Agent tab and /__workbenchpreview
// so the design reference and the real thing cannot drift.
//
// Same console rules as the rest of the admin: amber only for "this wants you"
// and "you are driving", state on the left edge, hairlines rather than boxes,
// mono only for things you would copy (commands, paths, ids, code).
// Every class is wb- prefixed: _map.scss has a global unscoped .text rule, and
// any single-word class name here would collide with something.
//
// styled-jsx: this is a template literal, so CSS comments must never contain
// a backtick.
import React from "react";

export default function WorkbenchStyles() {
  return (
    <style jsx global>{`
      .wb-root {
        min-width: 0;
      }
      .wb-root code,
      .wb-root pre {
        font-family: "JetBrains Mono", ui-monospace, monospace;
      }
      .wb-empty,
      .wb-note {
        margin: 0;
        padding: 8px 2px;
        font-size: 12.5px;
        line-height: 1.5;
        color: var(--a-dim, #7d8496);
      }
      .wb-note code {
        color: var(--a-text, #e9ebf2);
        overflow-wrap: anywhere;
      }
      .wb-err {
        margin: 8px 0;
      }

      /* ---- switcher ---- */
      .wb-switch {
        position: relative;
        margin: 14px 0 12px;
      }
      .wb-switch-in {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      .wb-sw {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 999px;
        color: var(--a-dim, #8b90a0);
        padding: 6px 14px;
        font: inherit;
        font-size: 12.5px;
        cursor: pointer;
        white-space: nowrap;
      }
      .wb-sw.on {
        border-color: var(--a-amber, #ffb020);
        color: var(--a-text, #e9ebf2);
      }
      .wb-sw em,
      .wb-more-sheet em {
        font-style: normal;
        font-size: 11px;
        color: #6b7285;
      }
      .wb-sw em.t-ask,
      .wb-more-sheet em.t-ask {
        color: #1a1300;
        background: var(--a-amber, #ffb020);
        border-radius: 999px;
        padding: 0 6px;
        font-weight: 600;
      }
      .wb-sw em.t-bad,
      .wb-more-sheet em.t-bad {
        color: #ff8a8a;
      }
      .wb-sw-rule {
        width: 1px;
        height: 18px;
        background: var(--a-line, #2b3040);
        margin: 0 4px;
      }
      .wb-sw-more {
        display: none;
      }
      .wb-sw:focus-visible,
      .wb-more-sheet button:focus-visible,
      .wb-srow:focus-visible,
      .wb-seg button:focus-visible,
      .wb-tool summary:focus-visible,
      .wb-hints button:focus-visible,
      .wb-chip select:focus-visible,
      .wb-op-detail summary:focus-visible {
        outline: 2px solid var(--a-amber, #ffb020);
        outline-offset: 2px;
      }
      .wb-more-sheet {
        display: none;
      }

      @media (max-width: 999px) {
        .wb-root {
          padding-bottom: 72px;
        }
        /* One view at a time on a phone: the switcher is a bar at the
           bottom, above the admin's own section bar. */
        .wb-switch {
          position: fixed;
          left: 12px;
          right: 12px;
          bottom: 74px;
          bottom: calc(74px + env(safe-area-inset-bottom));
          z-index: 55;
          margin: 0;
          border: 1px solid var(--a-line, #2b3040);
          border-radius: 14px;
          background: var(--a-panel, #111319);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
          padding: 4px;
        }
        .wb-switch-in {
          flex-wrap: nowrap;
          gap: 2px;
        }
        .wb-sw {
          flex: 1 1 0;
          min-width: 0;
          justify-content: center;
          flex-direction: column;
          gap: 1px;
          border: 0;
          border-top: 2px solid transparent;
          border-radius: 10px;
          padding: 7px 2px 6px;
          font-size: 11.5px;
        }
        .wb-sw span {
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
        }
        .wb-sw.on {
          border-top-color: var(--a-amber, #ffb020);
          background: var(--a-raise, #171a22);
        }
        .wb-sw em {
          font-size: 10px;
        }
        .wb-sw.wb-sw-sec,
        .wb-sw-rule {
          display: none;
        }
        .wb-sw-more {
          display: flex;
        }
        .wb-more-sheet {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
          position: absolute;
          right: 0;
          bottom: calc(100% + 8px);
          left: 0;
          padding: 8px;
          border: 1px solid var(--a-line, #2b3040);
          border-radius: 14px;
          background: var(--a-raise, #171a22);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
        }
        .wb-more-sheet button {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          background: none;
          border: 1px solid var(--a-line, #2b3040);
          border-left: 3px solid var(--a-line, #2b3040);
          border-radius: 9px;
          color: var(--a-text, #e9ebf2);
          padding: 12px;
          font: inherit;
          font-size: 13px;
          text-align: left;
          cursor: pointer;
        }
        .wb-more-sheet button.on {
          border-left-color: var(--a-amber, #ffb020);
        }
      }

      /* ---- chat ---- */
      .wb-chat {
        display: grid;
        gap: 16px;
        min-width: 0;
      }
      @media (min-width: 1000px) {
        .wb-chat {
          grid-template-columns: 272px minmax(0, 1fr);
          height: calc(100vh - 230px);
          min-height: 560px;
        }
        .wb-chat-list,
        .wb-chat-main {
          min-height: 0;
        }
        .wb-chat-list {
          overflow-y: auto;
          padding-right: 4px;
        }
        .wb-chat-main {
          display: flex;
          flex-direction: column;
        }
        .wb-chat-main .wb-transcript {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
        }
        .wb-to-list {
          display: none;
        }
      }
      @media (max-width: 999px) {
        .wb-chat.pane-talk .wb-chat-list,
        .wb-chat.pane-list .wb-chat-main {
          display: none;
        }
        .wb-composer {
          position: sticky;
          bottom: 132px;
          bottom: calc(132px + env(safe-area-inset-bottom));
          z-index: 4;
        }
      }
      .wb-chat-main {
        min-width: 0;
        border-left: 3px solid var(--a-line, #1e222c);
        padding-left: 14px;
      }
      .wb-chat-main.live {
        border-left-color: #c9cdd8;
      }
      .wb-chat-main.ask {
        border-left-color: var(--a-amber, #ffb020);
      }
      .wb-chat-head {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        flex-wrap: wrap;
        min-width: 0;
      }
      .wb-to-list em {
        font-style: normal;
        color: #6b7285;
        margin-left: 4px;
      }
      .wb-chat-title {
        flex: 1 1 240px;
        min-width: 0;
      }
      /* globals.scss pins h1-h4 to a light-theme ink: every heading on the
         console sets its own colour or it vanishes. */
      .wb-chat-title h4 {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        font-size: 17px;
        font-weight: 600;
        line-height: 1.3;
        color: var(--a-text, #e9ebf2);
        overflow-wrap: anywhere;
      }
      .wb-chat-meta,
      .wb-srow-meta {
        display: flex;
        flex-wrap: wrap;
        margin: 4px 0 0;
        font-size: 11px;
        color: #6b7285;
        min-width: 0;
      }
      .wb-chat-meta > span + span,
      .wb-srow-meta > span + span {
        border-left: 1px solid #2f3442;
        margin-left: 8px;
        padding-left: 8px;
      }
      .wb-chat-meta code {
        font-size: 10.5px;
        color: var(--a-dim, #8b90a0);
        overflow-wrap: anywhere;
      }
      .wb-status {
        margin: 8px 0 0;
        min-height: 18px;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
      }
      .wb-status.ask {
        color: var(--a-amber, #ffb020);
        font-weight: 600;
      }
      .wb-blank {
        padding: 18px 0;
        max-width: 60ch;
        color: var(--a-dim, #8b90a0);
        font-size: 13px;
        line-height: 1.6;
      }
      .wb-blank-h {
        margin: 0 0 6px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 19px;
        color: var(--a-text, #e9ebf2);
        line-height: 1.3;
      }
      .wb-blank p {
        margin: 0;
      }
      .wb-resume {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
        padding: 12px 0 4px;
        border-top: 1px solid var(--a-line, #1e222c);
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
      }
      .wb-resume p {
        margin: 0;
        flex: 1 1 260px;
      }

      /* ---- sessions ---- */
      .wb-sessions {
        display: grid;
        gap: 10px;
        min-width: 0;
        align-content: start;
      }
      .wb-sessions-head {
        display: flex;
        gap: 8px;
      }
      .wb-new {
        flex: 1;
      }
      .wb-sgroup {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      .wb-sgroup-h {
        margin: 6px 0 2px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--a-dim, #8b90a0);
      }
      .wb-sgroup-h span {
        color: #5c6377;
        font-weight: 400;
        margin-left: 4px;
      }
      .wb-sgroup-h.ask {
        color: var(--a-amber, #ffb020);
      }
      .wb-srow {
        display: grid;
        gap: 3px;
        text-align: left;
        background: none;
        border: 0;
        border-left: 3px solid transparent;
        border-bottom: 1px solid var(--a-line, #1e222c);
        color: inherit;
        font: inherit;
        padding: 8px 8px 9px 10px;
        cursor: pointer;
        min-width: 0;
      }
      .wb-srow:hover {
        background: rgba(255, 255, 255, 0.02);
      }
      .wb-srow.live {
        border-left-color: #3a3f4d;
      }
      .wb-srow.on {
        border-left-color: #c9cdd8;
        background: var(--a-raise, #171a22);
      }
      .wb-srow.ask {
        border-left-color: var(--a-amber, #ffb020);
      }
      .wb-srow-title {
        font-size: 13px;
        color: var(--a-text, #e9ebf2);
        line-height: 1.35;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow-wrap: anywhere;
      }
      .wb-srow.ask .wb-srow-meta span:first-child {
        color: var(--a-amber, #ffb020);
      }
      .wb-srow-cwd {
        font-size: 10.5px;
        color: #5c6377;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .wb-more {
        justify-self: start;
        margin-top: 6px;
      }

      /* ---- transcript ---- */
      .wb-transcript {
        display: grid;
        gap: 12px;
        align-content: start;
        padding: 12px 2px 16px 0;
        min-width: 0;
      }
      .wb-who {
        margin: 0 0 3px;
        font-family: "Space Grotesk", sans-serif;
        font-size: 11.5px;
        font-weight: 600;
        color: #6b7285;
      }
      .wb-you {
        border-left: 1px solid var(--a-line, #2b3040);
        padding-left: 12px;
        min-width: 0;
      }
      .wb-you.is-sending {
        opacity: 0.7;
      }
      .wb-them {
        min-width: 0;
      }
      .wb-prose {
        margin: 0 0 8px;
        font-size: 14px;
        line-height: 1.6;
        color: var(--a-text, #e9ebf2);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-width: 72ch;
      }
      .wb-say {
        min-width: 0;
      }
      .wb-code {
        margin: 6px 0 10px;
        border: 1px solid var(--a-line, #1e222c);
        border-radius: 8px;
        background: var(--a-void, #08090d);
        overflow: hidden;
        min-width: 0;
        max-width: 100%;
      }
      .wb-code figcaption {
        padding: 5px 11px;
        font-size: 11px;
        color: #6b7285;
        border-bottom: 1px solid var(--a-line, #1e222c);
      }
      .wb-code pre {
        margin: 0;
        padding: 10px 12px;
        overflow-x: auto;
        font-size: 12px;
        line-height: 1.55;
        color: #d7dae4;
        white-space: pre;
        max-height: 420px;
      }
      .wb-caret {
        display: inline-block;
        width: 7px;
        height: 15px;
        background: var(--a-dim, #8b90a0);
        vertical-align: -2px;
        animation: wb-blink 1s steps(2, start) infinite;
      }
      @keyframes wb-blink {
        to {
          visibility: hidden;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .wb-caret {
          animation: none;
        }
      }
      .wb-thinking summary,
      .wb-op-detail summary {
        cursor: pointer;
        font-size: 12px;
        color: #6b7285;
      }
      .wb-thinking p {
        margin: 6px 0 0;
        font-size: 12.5px;
        font-style: italic;
        color: #7d8496;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .wb-tool-wrap {
        display: grid;
        gap: 8px;
        min-width: 0;
      }
      .wb-tool {
        border: 1px solid var(--a-line, #1e222c);
        border-left: 3px solid #3a3f4d;
        border-radius: 9px;
        background: var(--a-raise, #171a22);
        min-width: 0;
      }
      .wb-tool.run {
        border-left-color: #c9cdd8;
      }
      .wb-tool.ok {
        border-left-color: var(--a-line, #2b3040);
      }
      .wb-tool.bad {
        border-left: 3px dashed #d1434f;
      }
      .wb-tool.ask {
        border-left-color: var(--a-amber, #ffb020);
      }
      .wb-tool summary {
        display: flex;
        align-items: baseline;
        gap: 10px;
        padding: 8px 12px;
        cursor: pointer;
        list-style: none;
        min-width: 0;
      }
      .wb-tool summary::-webkit-details-marker {
        display: none;
      }
      .wb-tool-name {
        flex: none;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--a-text, #e9ebf2);
      }
      .wb-tool-name em {
        font-style: normal;
        font-weight: 400;
        color: #6b7285;
        margin-left: 6px;
      }
      .wb-tool-line {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11.5px;
        color: #ffd79a;
      }
      .wb-tool-state {
        flex: none;
        margin-left: auto;
        font-size: 11px;
        color: #6b7285;
      }
      .wb-tool-state.bad {
        color: #ff8a8a;
        font-weight: 600;
      }
      .wb-tool-state.ask {
        color: var(--a-amber, #ffb020);
        font-weight: 600;
      }
      .wb-tool-body {
        border-top: 1px solid var(--a-line, #1e222c);
        padding: 8px 12px 10px;
        min-width: 0;
      }
      .wb-tool-label {
        margin: 4px 0;
        font-size: 11px;
        color: #6b7285;
      }
      .wb-pre {
        margin: 0;
        padding: 8px 10px;
        background: var(--a-void, #08090d);
        border-radius: 7px;
        font-size: 11.5px;
        line-height: 1.5;
        color: var(--a-dim, #9aa0b2);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-height: 300px;
        overflow-y: auto;
      }
      .wb-pre.bad {
        color: #ffb4b4;
      }
      .wb-end,
      .wb-sys {
        margin: 0;
        font-size: 11.5px;
        color: #5c6377;
      }
      .wb-end.bad,
      .wb-err-line {
        color: #ff8a8a;
      }
      .wb-err-line {
        margin: 0;
        font-size: 12.5px;
        overflow-wrap: anywhere;
      }
      .wb-log {
        margin: 0;
        font-size: 11px;
        color: #5c6377;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      /* ---- composer ---- */
      .wb-composer {
        display: grid;
        gap: 8px;
        padding: 10px 0 2px;
        background: var(--a-void, #08090d);
        border-top: 1px solid var(--a-line, #1e222c);
        min-width: 0;
      }
      .wb-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        min-width: 0;
      }
      @media (max-width: 999px) {
        .wb-chips {
          flex-wrap: nowrap;
          overflow-x: auto;
          scrollbar-width: none;
          padding-bottom: 2px;
        }
        .wb-chips::-webkit-scrollbar {
          display: none;
        }
      }
      .wb-chip {
        position: relative;
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 999px;
        padding: 3px 4px 3px 10px;
        font-size: 12px;
        color: var(--a-text, #e9ebf2);
        background: var(--a-raise, #171a22);
      }
      .wb-chip.fixed {
        padding-right: 10px;
        background: none;
        border-style: dashed;
      }
      .wb-chip-k {
        color: #6b7285;
      }
      .wb-chip-v {
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .wb-chip select {
        background: transparent;
        border: 0;
        color: inherit;
        font: inherit;
        padding: 2px 4px;
        border-radius: 999px;
        max-width: 200px;
        cursor: pointer;
      }
      .wb-chip select option {
        background: #171a22;
        color: #e9ebf2;
      }
      .wb-hints {
        list-style: none;
        margin: 0;
        padding: 4px;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 10px;
        background: var(--a-raise, #171a22);
        display: grid;
        gap: 2px;
      }
      .wb-hints button {
        display: flex;
        gap: 10px;
        width: 100%;
        align-items: baseline;
        text-align: left;
        background: none;
        border: 0;
        border-left: 3px solid transparent;
        border-radius: 6px;
        color: var(--a-dim, #8b90a0);
        font: inherit;
        font-size: 12px;
        padding: 6px 8px;
        cursor: pointer;
        min-width: 0;
      }
      .wb-hints button.on {
        border-left-color: var(--a-amber, #ffb020);
        background: rgba(255, 255, 255, 0.03);
      }
      .wb-hints code {
        flex: none;
        color: var(--a-text, #e9ebf2);
      }
      .wb-hints span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .wb-write {
        display: flex;
        gap: 8px;
        align-items: stretch;
        min-width: 0;
      }
      .wb-text {
        flex: 1 1 auto;
        min-width: 0;
        width: auto;
        font-family: inherit;
        font-size: 14px;
        line-height: 1.5;
        resize: vertical;
        min-height: 48px;
      }
      textarea.admin-input.wb-text {
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      }
      .wb-write-btns {
        flex: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .wb-send,
      .wb-interrupt {
        min-width: 92px;
        flex: 1;
      }

      /* ---- desktop / terminal ---- */
      .wb-desk {
        display: grid;
        gap: 16px;
        min-width: 0;
      }
      @media (min-width: 1100px) {
        .wb-desk {
          grid-template-columns: minmax(0, 1fr) 280px;
        }
      }
      .wb-desk-main {
        display: grid;
        gap: 10px;
        min-width: 0;
        align-content: start;
      }
      .wb-desk-bar {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
        min-width: 0;
        margin-bottom: 10px;
      }
      .wb-desk-main .wb-desk-bar {
        margin-bottom: 0;
      }
      .wb-drive {
        flex: 1 1 240px;
        margin: 0;
        font-size: 13px;
        color: var(--a-dim, #8b90a0);
        min-width: 0;
      }
      .wb-drive.on,
      .wb-drive.ask {
        color: var(--a-amber, #ffb020);
        font-weight: 600;
      }
      .wb-desk-btns {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        min-width: 0;
      }
      .wb-screen {
        position: relative;
        width: 100%;
        aspect-ratio: 16 / 9;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 10px;
        background: var(--a-void, #08090d);
        overflow: hidden;
      }
      /* The one loud thing on this view: who is driving. */
      .wb-screen.driving {
        border-color: var(--a-amber, #ffb020);
        box-shadow: 0 0 0 2px var(--a-amber, #ffb020);
      }
      .wb-screen:fullscreen {
        aspect-ratio: auto;
        width: 100vw;
        height: 100vh;
        border-radius: 0;
      }
      .wb-screen-in {
        position: absolute;
        inset: 0;
      }
      .wb-screen-empty {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 20px;
        text-align: center;
        background: repeating-linear-gradient(135deg, transparent 0 14px, rgba(255, 255, 255, 0.015) 14px 15px);
      }
      .wb-screen-empty p {
        margin: 0;
        max-width: 44ch;
        font-size: 13px;
        line-height: 1.55;
        color: var(--a-dim, #7d8496);
      }
      /* The screenshot stream: the picture sets the frame's shape, so a
         click maps straight onto it with no letterbox to correct for. */
      .wb-screen.stream.live {
        aspect-ratio: auto;
      }
      .wb-shot {
        display: block;
        width: 100%;
        height: auto;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }
      .wb-screen.driving .wb-shot {
        cursor: crosshair;
        touch-action: manipulation;
      }
      .wb-desk-mode {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        margin: 0;
        font-size: 11.5px;
        color: #6b7285;
        min-width: 0;
      }
      .wb-desk-how {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 11px;
        overflow-wrap: anywhere;
      }
      .wb-age {
        color: var(--a-dim, #8b90a0);
      }
      .wb-age.stale {
        color: #ff8a8a;
      }
      .wb-deck {
        display: grid;
        gap: 10px;
        min-width: 0;
        padding: 12px 0 2px 12px;
        border-left: 3px solid var(--a-amber, #ffb020);
      }
      .wb-keys {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        min-width: 0;
      }
      .wb-key {
        min-height: 36px;
        min-width: 44px;
      }
      .wb-stepup {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        padding: 10px 12px;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 9px;
        background: var(--a-raise, #171a22);
      }
      .wb-stepup p {
        flex: 1 1 220px;
        margin: 0;
        font-size: 13px;
        color: var(--a-text, #e9ebf2);
        min-width: 0;
      }
      .wb-clip {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        min-width: 0;
      }
      .wb-clip .admin-input {
        flex: 1 1 200px;
        min-width: 0;
        width: auto;
      }
      .wb-dlog {
        min-width: 0;
      }
      .wb-dlog-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0;
        max-height: 60vh;
        overflow-y: auto;
      }
      .wb-dlog-list li {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        column-gap: 8px;
        padding: 7px 0 7px 10px;
        border-left: 3px solid #3a3f4d;
        border-bottom: 1px solid var(--a-line, #1e222c);
        font-size: 12px;
      }
      .wb-dlog-list li.you {
        border-left-color: #c9cdd8;
      }
      .wb-dlog-t {
        color: #5c6377;
        font-size: 11px;
      }
      .wb-dlog-s {
        color: var(--a-text, #e9ebf2);
        overflow-wrap: anywhere;
      }
      .wb-dlog-a {
        grid-column: 2;
        font-size: 10.5px;
        color: #6b7285;
      }
      .wb-term-frame {
        position: relative;
        height: 62vh;
        min-height: 320px;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 10px;
        background: var(--a-void, #08090d);
        overflow: hidden;
      }
      .wb-term-host {
        position: absolute;
        inset: 8px;
      }
      .wb-cwd {
        width: auto;
        flex: 1 1 200px;
        min-width: 0;
      }

      /* ---- previews ---- */
      .wb-prev {
        display: grid;
        gap: 12px;
        min-width: 0;
      }
      .wb-ports {
        display: grid;
        gap: 6px;
        min-width: 0;
      }
      .wb-port {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
        padding: 9px 12px;
        border: 1px solid var(--a-line, #1e222c);
        border-left: 3px solid #3a3f4d;
        border-radius: 9px;
        background: var(--a-raise, #171a22);
        min-width: 0;
      }
      .wb-port.on {
        border-left-color: #c9cdd8;
      }
      .wb-port-n {
        font-size: 14px;
        color: var(--a-text, #e9ebf2);
      }
      .wb-port-what {
        flex: 1 1 160px;
        min-width: 0;
        font-size: 12.5px;
        color: var(--a-dim, #8b90a0);
        overflow-wrap: anywhere;
      }
      .wb-port-btns {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .wb-alink {
        text-decoration: none;
        display: inline-flex;
        align-items: center;
      }
      .wb-pframe {
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 10px;
        overflow: hidden;
        min-width: 0;
      }
      .wb-pframe header {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
        padding: 8px 10px;
        border-bottom: 1px solid var(--a-line, #2b3040);
        background: var(--a-raise, #171a22);
      }
      .wb-pframe header code {
        color: var(--a-text, #e9ebf2);
      }
      .wb-pexp {
        flex: 1 1 140px;
        font-size: 11.5px;
        color: #6b7285;
      }
      .wb-pexp.bad {
        color: #ff8a8a;
      }
      .wb-pframe iframe {
        display: block;
        width: 100%;
        height: 70vh;
        border: 0;
        background: #fff;
      }

      /* ---- review ---- */
      .wb-review {
        display: grid;
        gap: 14px;
        min-width: 0;
      }
      .wb-pinned {
        display: grid;
        gap: 10px;
        min-width: 0;
      }
      .wb-filters {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
        min-width: 0;
      }
      .wb-seg {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        min-width: 0;
      }
      .wb-seg button {
        background: none;
        border: 1px solid var(--a-line, #2b3040);
        border-radius: 999px;
        color: var(--a-dim, #8b90a0);
        padding: 5px 11px;
        font: inherit;
        font-size: 12px;
        cursor: pointer;
        white-space: nowrap;
      }
      .wb-seg button em {
        font-style: normal;
        color: #5c6377;
        margin-left: 4px;
      }
      .wb-seg button.on {
        border-color: #c9cdd8;
        color: var(--a-text, #e9ebf2);
      }
      .wb-seg button:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .wb-ops {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        min-width: 0;
      }
      .wb-op {
        padding: 9px 0 10px 12px;
        border-left: 3px solid var(--a-line, #2b3040);
        border-bottom: 1px solid var(--a-line, #1e222c);
        min-width: 0;
      }
      .wb-op.d-allowed,
      .wb-op.d-auto {
        border-left-color: #c9cdd8;
      }
      .wb-op.d-denied {
        border-left-color: #d1434f;
      }
      .wb-op-top {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 10px;
        align-items: baseline;
        font-size: 11px;
        color: #6b7285;
      }
      .wb-op-kind {
        font-family: "Space Grotesk", sans-serif;
        font-weight: 600;
        font-size: 11.5px;
        color: var(--a-dim, #8b90a0);
      }
      .wb-op-actor {
        font-size: 11px;
        color: var(--a-text, #e9ebf2);
      }
      .wb-op-dec {
        font-weight: 600;
      }
      .wb-op-dec.denied {
        color: #ff8a8a;
      }
      .wb-op-dec.allowed,
      .wb-op-dec.auto {
        color: #86e8ab;
      }
      .wb-op-at {
        margin-left: auto;
      }
      .wb-op-sum {
        margin: 4px 0 0;
        font-size: 13px;
        line-height: 1.45;
        color: var(--a-text, #e9ebf2);
        overflow-wrap: anywhere;
      }
      .wb-op-detail {
        margin-top: 6px;
      }
      .wb-op-detail .wb-pre {
        margin-top: 6px;
      }
      @media (max-width: 720px) {
        /* Stacked actions: the shared card gives Deny a 140px flex basis,
           which in a column becomes 140px of HEIGHT. Still the largest,
           closest target, just not a slab. */
        .wb-root .ag-card-actions .ag-deny {
          flex: none;
          min-height: 58px;
        }
        .wb-chat-meta > span + span,
        .wb-srow-meta > span + span {
          border-left: 0;
          margin-left: 0;
          padding-left: 0;
        }
        .wb-chat-meta,
        .wb-srow-meta {
          column-gap: 12px;
        }
        .wb-op-at {
          margin-left: 0;
          flex-basis: 100%;
        }
        .wb-chat-main {
          padding-left: 10px;
        }
      }
    `}</style>
  );
}
