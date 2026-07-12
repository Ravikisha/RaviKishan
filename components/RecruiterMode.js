import React, { useEffect, useState } from "react";
import { Eye, Terminal } from "lucide-react";

// Dual-mode toggle. Ctrl/Cmd + Shift + R (or the corner chip) flips between:
//   dev mode      — the full playground (console, dock, dashboards, eggs)
//   recruiter mode — a clean, distraction-free view: all the playful chrome is
//                    hidden, leaving just the professional portfolio.
// Implemented as a data-attribute on <html> + CSS, so it hides other components'
// chrome without importing or touching them.
export default function RecruiterMode() {
  const [recruiter, setRecruiter] = useState(false);

  const apply = (v) => {
    setRecruiter(v);
    document.documentElement.dataset.mode = v ? "recruiter" : "dev";
    try {
      localStorage.setItem("mode", v ? "recruiter" : "dev");
    } catch (_) {}
  };

  useEffect(() => {
    let saved = "recruiter";
    try {
      saved = localStorage.getItem("mode") || "recruiter";
    } catch (_) {}
    apply(saved === "recruiter");

    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "R" || e.key === "r")) {
        e.preventDefault();
        apply(document.documentElement.dataset.mode !== "recruiter");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <button
        className={`rm-chip${recruiter ? " on" : ""}`}
        onClick={() => apply(!recruiter)}
        title="Toggle recruiter / dev mode — Ctrl/Cmd + Shift + R"
      >
        <span className="rm-knob" aria-hidden="true">
          {recruiter ? <Terminal size={13} strokeWidth={2.4} /> : <Eye size={13} strokeWidth={2.4} />}
        </span>
        <span className="rm-txt">{recruiter ? "Exit to dev" : "Recruiter view"}</span>
        <kbd className="rm-kbd">⇧⌘R</kbd>
      </button>

      <style jsx global>{`
        /* recruiter-only surfaces (e.g. the routed Résumé nav link): hidden by
           default, shown only when recruiter mode is active */
        .rm-only { display: none !important; }
        :root[data-mode="recruiter"] .rm-only { display: inline-flex !important; }

        /* block-level recruiter-only surfaces (whole page sections moved to a
           desktop app in dev mode, e.g. the certifications section) */
        .rm-only-block { display: none !important; }
        :root[data-mode="recruiter"] .rm-only-block { display: block !important; }

        /* the top navbar is recruiter-only — dev mode is single-page + dock */
        .rm-nav { display: none !important; }
        :root[data-mode="recruiter"] .rm-nav { display: block !important; }

        /* hide the playful chrome in recruiter mode */
        :root[data-mode="recruiter"] .egg-launcher,
        :root[data-mode="recruiter"] .os-dock-wrap,
        :root[data-mode="recruiter"] .egg-toasts,
        :root[data-mode="recruiter"] .dev-hud,
        :root[data-mode="recruiter"] .egg-overlay,
        :root[data-mode="recruiter"] .mon-overlay,
        :root[data-mode="recruiter"] .os-lp-overlay,
        :root[data-mode="recruiter"] .os-win,
        :root[data-mode="recruiter"] .os-menubar,
        :root[data-mode="recruiter"] .os-snap-preview,
        :root[data-mode="recruiter"] .os-wall,
        :root[data-mode="recruiter"] .os-widgets,
        :root[data-mode="recruiter"] .os-ctx-layer,
        :root[data-mode="recruiter"] .egg-saver,
        :root[data-mode="recruiter"] .packet {
          display: none !important;
        }

        .rm-chip {
          position: fixed;
          left: 16px;
          bottom: 16px;
          z-index: 60;
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 5px 13px 5px 5px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--c-surface, #15171e) 78%, transparent);
          border: 1px solid var(--c-edge, #262a35);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.05);
          -webkit-backdrop-filter: blur(16px) saturate(1.4);
          backdrop-filter: blur(16px) saturate(1.4);
          font-family: "JetBrains Mono", ui-monospace, monospace;
          cursor: pointer;
          transition: border-color 0.18s, box-shadow 0.18s, transform 0.18s;
        }
        .rm-chip:hover {
          border-color: color-mix(in srgb, var(--c-accent, #ffb020) 55%, var(--c-edge, #262a35));
          box-shadow: 0 14px 36px rgba(0, 0, 0, 0.22), 0 0 0 3px rgba(255, 176, 32, 0.1);
          transform: translateY(-1px);
        }
        .rm-chip:active { transform: translateY(0); }
        .rm-chip:focus-visible { outline: 2px solid var(--c-accent, #ffb020); outline-offset: 3px; }

        /* signature: the amber knob — an OS-grade toggle affordance */
        .rm-knob {
          display: grid;
          place-items: center;
          height: 24px;
          width: 24px;
          border-radius: 50%;
          color: #0a0c13;
          background: linear-gradient(150deg, #ffc247, #ffb020);
          box-shadow: 0 2px 6px rgba(255, 176, 32, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.4);
          transition: transform 0.2s;
        }
        .rm-chip:hover .rm-knob { transform: rotate(-8deg) scale(1.05); }

        .rm-txt {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.01em;
          color: var(--c-fg, #e7e8ee);
        }
        .rm-kbd {
          font-size: 9.5px;
          line-height: 1;
          color: var(--c-muted, #8b90a0);
          background: color-mix(in srgb, var(--c-fg, #e7e8ee) 6%, transparent);
          border: 1px solid var(--c-edge, #262a35);
          border-bottom-width: 2px;
          border-radius: 5px;
          padding: 3px 5px;
        }

        /* recruiter active — the knob turns teal (exit affordance) */
        .rm-chip.on .rm-knob {
          background: linear-gradient(150deg, #63e6d6, #4ed0c0);
          box-shadow: 0 2px 6px rgba(78, 208, 192, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.4);
        }
        .rm-chip.on { border-color: color-mix(in srgb, #4ed0c0 40%, var(--c-edge, #262a35)); }

        @media (max-width: 640px) {
          .rm-kbd { display: none; } /* no physical keyboard on phones */
          .rm-chip { padding-right: 14px; }
        }

        /* dev mode is a fixed single-screen desktop — never scroll the page.
           recruiter mode keeps the long scrolling portfolio. */
        :root[data-mode="dev"],
        :root[data-mode="dev"] body {
          height: 100%;
          overflow: hidden;
          overscroll-behavior: none;
        }

        /* mobile: the dock owns the bottom edge, so lift the chip clear of it
           (and clear of the wallpaper's "open an app" hint) */
        @media (max-width: 640px) {
          :root[data-mode="dev"] .rm-chip { bottom: 80px; }
        }
      `}</style>
    </>
  );
}
