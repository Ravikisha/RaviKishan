import React from "react";
import {
  Search, Keyboard, Command, SquareStack, TerminalSquare, MousePointerClick,
  FolderGit2, Layers, FileText, Newspaper, User, Mail,
} from "lucide-react";
import { Kbd, keysFor, shortcutById } from "../../../lib/shortcuts";

// First-run guide for dev mode — explains the desktop, its shortcuts, and offers
// quick-launch tiles. Auto-opens once (DesktopOS sets os:welcomed); also openable
// any time from the ◆ menu or Launchpad.
const open = (id) =>
  typeof window !== "undefined" &&
  window.dispatchEvent(new CustomEvent("os:open", { detail: id }));

const TIPS = [
  { icon: Search, k: "search", label: "Search & open any app" },
  { icon: Keyboard, k: "shortcuts", label: "See every keyboard shortcut" },
  { icon: TerminalSquare, k: "console", label: "Open the command console" },
];

const APPS = [
  { id: "projects", icon: FolderGit2, name: "Projects", a: "#FFB020" },
  { id: "skills", icon: Layers, name: "Skills", a: "#A78BFA" },
  { id: "resume", icon: FileText, name: "Résumé", a: "#FFB020" },
  { id: "blog", icon: Newspaper, name: "Blog", a: "#60A5FA" },
  { id: "about", icon: User, name: "About", a: "#4ED0C0" },
  { id: "contact", icon: Mail, name: "Contact", a: "#FFB020" },
];

export default function Welcome() {
  return (
    <div className="wc">
      <div className="wc-hero">
        <span className="wc-diamond" />
        <h1 className="wc-title">
          Welcome — <span>Ravi Kishan</span>
        </h1>
        <p className="wc-sub">
          The desktop edition. You&apos;re in <b>dev mode</b> — a playground OS.
          Drag windows, snap them to the edges, open apps from the dock.
        </p>
        <p className="wc-note">
          Want the clean, one-page site instead? Press{" "}
          <Kbd keys={keysFor(shortcutById("recruiter"))} /> for recruiter view.
        </p>
      </div>

      <div className="wc-block">
        <p className="wc-label">Get around</p>
        <div className="wc-tips">
          {TIPS.map((t) => {
            const Icon = t.icon;
            return (
              <div key={t.k} className="wc-tip">
                <span className="wc-tip-ic"><Icon className="h-4 w-4" /></span>
                <span className="wc-tip-tx">{t.label}</span>
                <Kbd keys={keysFor(shortcutById(t.k))} />
              </div>
            );
          })}
          <div className="wc-tip">
            <span className="wc-tip-ic"><SquareStack className="h-4 w-4" /></span>
            <span className="wc-tip-tx">Drag a window to a screen edge to tile it</span>
            <span className="wc-chip">drag → edge</span>
          </div>
          <div className="wc-tip">
            <span className="wc-tip-ic"><MousePointerClick className="h-4 w-4" /></span>
            <span className="wc-tip-tx">Traffic lights close · minimize · full-screen</span>
            <span className="wc-chip wc-lights"><i /><i /><i /></span>
          </div>
          <div className="wc-tip">
            <span className="wc-tip-ic"><Command className="h-4 w-4" /></span>
            <span className="wc-tip-tx">Everything lives in the top menu bar too</span>
            <span className="wc-chip">◆ menu</span>
          </div>
        </div>
      </div>

      <div className="wc-block">
        <p className="wc-label">Jump in</p>
        <div className="wc-apps">
          {APPS.map((a) => {
            const Icon = a.icon;
            return (
              <button key={a.id} className="wc-app" onClick={() => open(a.id)}>
                <span className="wc-app-ic" style={{ "--a": a.a }}><Icon className="h-6 w-6" /></span>
                <span className="wc-app-name">{a.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        .wc {
          min-height: 100%;
          padding: 26px 26px 30px;
          background: var(--c-bg);
          color: var(--c-fg);
          font-family: "Inter", sans-serif;
        }
        .wc-hero { position: relative; padding-bottom: 22px; border-bottom: 1px solid var(--c-edge); }
        .wc-diamond {
          display: inline-block; height: 13px; width: 13px; border-radius: 3px;
          background: var(--c-accent); transform: rotate(45deg);
          box-shadow: 0 0 18px color-mix(in srgb, var(--c-accent) 60%, transparent);
        }
        .wc-title {
          margin-top: 14px; font-family: "Space Grotesk", sans-serif;
          font-size: 28px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1;
        }
        .wc-title span { color: var(--c-accentText, var(--c-accent)); }
        .wc-sub { margin-top: 10px; max-width: 46ch; font-size: 14px; line-height: 1.6; color: var(--c-muted); }
        .wc-sub b { color: var(--c-fg); font-weight: 600; }
        .wc-note {
          margin-top: 12px; display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap;
          font-family: "JetBrains Mono", monospace; font-size: 11.5px; color: var(--c-muted);
        }
        .wc-block { margin-top: 22px; }
        .wc-label {
          font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: 0.16em;
          text-transform: uppercase; color: var(--c-muted); margin-bottom: 10px;
        }
        .wc-tips { display: flex; flex-direction: column; gap: 8px; }
        .wc-tip {
          display: flex; align-items: center; gap: 12px;
          padding: 11px 13px; border: 1px solid var(--c-edge); border-radius: 11px;
          background: var(--c-surface);
        }
        .wc-tip-ic {
          display: grid; place-items: center; height: 30px; width: 30px; flex-shrink: 0;
          border-radius: 8px; color: var(--c-accentText, var(--c-accent));
          background: color-mix(in srgb, var(--c-accent) 12%, transparent);
        }
        .wc-tip-tx { flex: 1; font-size: 13px; }
        .wc-chip {
          font-family: "JetBrains Mono", monospace; font-size: 10.5px; color: var(--c-muted);
          padding: 3px 8px; border: 1px solid var(--c-edge); border-radius: 6px; background: var(--c-bg);
        }
        .wc-lights { display: inline-flex; gap: 5px; align-items: center; padding: 6px 8px; }
        .wc-lights i { height: 9px; width: 9px; border-radius: 50%; }
        .wc-lights i:nth-child(1) { background: #ff5f57; }
        .wc-lights i:nth-child(2) { background: #febc2e; }
        .wc-lights i:nth-child(3) { background: #28c840; }
        .wc-apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 12px; }
        .wc-app {
          display: flex; flex-direction: column; align-items: center; gap: 8px;
          padding: 12px 6px; border: 1px solid var(--c-edge); border-radius: 12px;
          background: var(--c-surface); cursor: pointer; transition: transform .15s, border-color .15s;
        }
        .wc-app:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--c-accent) 50%, var(--c-edge)); }
        .wc-app-ic {
          display: grid; place-items: center; height: 44px; width: 44px; border-radius: 12px;
          color: var(--a); background: color-mix(in srgb, var(--a) 16%, var(--c-bg));
          border: 1px solid color-mix(in srgb, var(--a) 30%, transparent);
        }
        .wc-app-name { font-size: 11.5px; color: var(--c-fg); }
      `}</style>
    </div>
  );
}
