import React, { useMemo, useState } from "react";
import {
  Folder, FileCode, FileText, FileBadge, Package, Github, BookOpen,
  ExternalLink, Home, ChevronRight, Star,
} from "lucide-react";
import { useSiteContent } from "../../../lib/useSiteContent";

// Finder — a browsable "filesystem" over the real portfolio content. Each folder
// maps to a content collection; opening a file jumps to the relevant app or the
// source (repo / docs / PDF). It doubles as a discovery-oriented navigation hub.
const openApp = (id) => window.dispatchEvent(new CustomEvent("os:open", { detail: id }));
const openUrl = (u) => u && window.open(u, "_blank", "noopener");
const slug = (n) => (n || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default function Files() {
  const { projects, systems, patents, identity, resume } = useSiteContent();
  const [loc, setLoc] = useState("projects");
  const [sel, setSel] = useState(null);

  const locations = [
    { id: "projects", name: "projects" },
    { id: "systems", name: "systems" },
    { id: "writing", name: "writing" },
    { id: "patents", name: "patents" },
    { id: "root", name: "home" },
  ];

  const items = useMemo(() => {
    if (loc === "projects")
      return (projects || []).map((p) => ({
        key: p.name,
        name: slug(p.name) + (p.link && p.link.includes("npm") ? "" : ""),
        ext: p.link && p.link.includes("npm") ? "pkg" : "repo",
        icon: p.link && p.link.includes("npm") ? Package : FileCode,
        meta: (p.skills || []).slice(0, 3).join(" · "),
        star: p.featured,
        onOpen: () => openUrl(p.github || p.link || p.docs),
        links: [
          p.github && { icon: Github, label: "Repo", u: p.github },
          p.docs && { icon: BookOpen, label: "Docs", u: p.docs },
          p.link && { icon: ExternalLink, label: "Open", u: p.link },
        ].filter(Boolean),
        desc: p.description,
      }));
    if (loc === "systems")
      return (systems || []).map((s) => ({
        key: s.name,
        name: slug(s.name),
        ext: (s.kind || "system").toLowerCase().split(" ")[0],
        icon: FileCode,
        meta: s.metric,
        onOpen: () => openUrl(s.href),
        links: [s.href && { icon: Github, label: "Source", u: s.href }].filter(Boolean),
        desc: s.blurb,
      }));
    if (loc === "writing")
      return [
        { key: "blog", name: "all-posts", ext: "app", icon: BookOpen, meta: "live from dev.to + Medium", onOpen: () => openApp("blog"), desc: "Open the Blog app — deep-dives on the systems I build." },
      ];
    if (loc === "patents")
      return (patents || []).map((p) => ({
        key: p.title,
        name: slug(p.title).slice(0, 34),
        ext: "pdf",
        icon: FileBadge,
        meta: [p.type, p.status && `(${p.status})`, p.number].filter(Boolean).join(" · "),
        onOpen: () => openApp("resume"),
        desc: p.abstract,
      }));
    // home
    return [
      { key: "resume", name: "resume", ext: "pdf", icon: FileText, meta: resume?.updated ? `updated ${resume.updated}` : "", onOpen: () => openApp("resume"), desc: "The one-page résumé." },
      { key: "about", name: "about", ext: "txt", icon: FileText, meta: identity?.role, onOpen: () => openApp("about"), desc: identity?.intro },
      { key: "readme", name: "README", ext: "md", icon: FileText, meta: "why I build from scratch", onOpen: () => openApp("notes"), desc: "Open Notes." },
      { key: "projects", name: "projects", ext: "dir", icon: Folder, meta: `${(projects || []).length} items`, onOpen: () => setLoc("projects") },
      { key: "systems", name: "systems", ext: "dir", icon: Folder, meta: `${(systems || []).length} items`, onOpen: () => setLoc("systems") },
    ];
  }, [loc, projects, systems, patents, identity, resume]);

  const current = items.find((i) => i.key === sel) || null;

  return (
    <div className="fl">
      <aside className="fl-side">
        <p className="fl-side-h">Locations</p>
        {locations.map((l) => (
          <button
            key={l.id}
            className={`fl-loc${loc === l.id ? " on" : ""}`}
            onClick={() => { setLoc(l.id); setSel(null); }}
          >
            {l.id === "root" ? <Home className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
            {l.name}
          </button>
        ))}
        <p className="fl-side-h" style={{ marginTop: 14 }}>Apps</p>
        <button className="fl-loc" onClick={() => window.dispatchEvent(new CustomEvent("os:launchpad"))}>
          <Folder className="h-4 w-4" /> Applications
        </button>
      </aside>

      <main className="fl-main">
        <div className="fl-path">
          <Home className="h-3.5 w-3.5" /> <ChevronRight className="h-3 w-3" />
          <span>{locations.find((l) => l.id === loc)?.name}</span>
          <span className="fl-count">{items.length} items</span>
        </div>

        <div className="fl-list">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <div
                key={it.key}
                className={`fl-row${sel === it.key ? " sel" : ""}`}
                onClick={() => setSel(it.key)}
                onDoubleClick={it.onOpen}
              >
                <span className="fl-ic"><Icon className="h-4 w-4" /></span>
                <span className="fl-name">
                  {it.name}<em>.{it.ext}</em>
                  {it.star && <Star className="fl-star h-3 w-3" />}
                </span>
                <span className="fl-meta">{it.meta}</span>
              </div>
            );
          })}
        </div>
      </main>

      {current && (
        <aside className="fl-info">
          <div className="fl-info-ic"><current.icon className="h-7 w-7" /></div>
          <p className="fl-info-name">{current.name}.{current.ext}</p>
          {current.meta && <p className="fl-info-meta">{current.meta}</p>}
          {current.desc && <p className="fl-info-desc">{current.desc}</p>}
          <div className="fl-info-actions">
            <button className="fl-open" onClick={current.onOpen}>Open</button>
            {(current.links || []).map((l) => {
              const Icon = l.icon;
              return (
                <button key={l.label} className="fl-link" onClick={() => openUrl(l.u)}>
                  <Icon className="h-3.5 w-3.5" /> {l.label}
                </button>
              );
            })}
          </div>
        </aside>
      )}

      <style jsx>{`
        .fl { display: grid; grid-template-columns: 168px 1fr; min-height: 100%; background: var(--c-bg); color: var(--c-fg); font-family: "Inter", sans-serif; }
        .fl:has(.fl-info) { grid-template-columns: 168px 1fr 240px; }
        .fl-side { border-right: 1px solid var(--c-edge); background: var(--c-surface); padding: 14px 10px; }
        .fl-side-h { font-family: "JetBrains Mono", monospace; font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: var(--c-muted); padding: 0 6px 8px; }
        .fl-loc { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: none; border: none; cursor: pointer; color: var(--c-fg); font-size: 13px; padding: 7px 8px; border-radius: 7px; transition: background .12s; }
        .fl-loc:hover { background: color-mix(in srgb, var(--c-fg) 6%, transparent); }
        .fl-loc.on { background: var(--c-accent); color: var(--c-accentFg, #0a0b0f); }
        .fl-loc.on :global(svg) { color: currentColor; }
        .fl-loc :global(svg) { color: var(--c-accentText, var(--c-accent)); }
        .fl-main { display: flex; flex-direction: column; min-width: 0; }
        .fl-path { display: flex; align-items: center; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--c-edge); font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--c-muted); }
        .fl-path span { color: var(--c-fg); }
        .fl-count { margin-left: auto; color: var(--c-muted); }
        .fl-list { flex: 1; overflow: auto; padding: 6px; }
        .fl-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: default; }
        .fl-row:hover { background: color-mix(in srgb, var(--c-fg) 5%, transparent); }
        .fl-row.sel { background: var(--c-accent); color: var(--c-accentFg, #0a0b0f); }
        .fl-row.sel .fl-meta, .fl-row.sel .fl-name em { color: color-mix(in srgb, var(--c-accentFg, #0a0b0f) 75%, transparent); }
        .fl-ic { color: var(--c-accentText, var(--c-accent)); flex-shrink: 0; }
        .fl-row.sel .fl-ic { color: currentColor; }
        .fl-name { font-size: 13px; font-family: "JetBrains Mono", monospace; display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
        .fl-name em { font-style: normal; color: var(--c-muted); }
        .fl-star { color: #FFB020; }
        .fl-meta { margin-left: auto; font-size: 11px; color: var(--c-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 46%; }
        .fl-info { border-left: 1px solid var(--c-edge); background: var(--c-surface); padding: 20px 16px; display: flex; flex-direction: column; align-items: center; text-align: center; }
        .fl-info-ic { display: grid; place-items: center; height: 60px; width: 60px; border-radius: 14px; color: var(--c-accentText, var(--c-accent)); background: color-mix(in srgb, var(--c-accent) 12%, transparent); }
        .fl-info-name { margin-top: 12px; font-family: "JetBrains Mono", monospace; font-size: 13px; word-break: break-all; }
        .fl-info-meta { margin-top: 4px; font-family: "JetBrains Mono", monospace; font-size: 10.5px; color: var(--c-accentText, var(--c-accent)); }
        .fl-info-desc { margin-top: 12px; font-size: 12px; line-height: 1.55; color: var(--c-muted); }
        .fl-info-actions { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
        .fl-open { background: var(--c-accent); color: var(--c-accentFg, #0a0b0f); border: none; border-radius: 8px; padding: 7px 16px; font-size: 12px; font-weight: 700; cursor: pointer; }
        .fl-link { display: inline-flex; align-items: center; gap: 5px; background: var(--c-bg); border: 1px solid var(--c-edge); color: var(--c-muted); border-radius: 8px; padding: 6px 10px; font-size: 11px; cursor: pointer; transition: color .12s, border-color .12s; }
        .fl-link:hover { color: var(--c-fg); border-color: var(--c-muted); }
        @media (max-width: 640px) {
          .fl, .fl:has(.fl-info) { grid-template-columns: 1fr; }
          .fl-side { display: none; }
          .fl-info { display: none; }
        }
      `}</style>
    </div>
  );
}
