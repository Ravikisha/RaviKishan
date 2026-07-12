import React, { useMemo, useState } from "react";
import { ExternalLink, BadgeCheck, Search } from "lucide-react";
import { certifications } from "../../../lib/certifications";

const si = (slug) => `https://cdn.jsdelivr.net/npm/simple-icons@13/icons/${slug}.svg`;
const authIcon = {
  HackerRank: "hackerrank", Udemy: "udemy", Google: "google", Meta: "meta",
  Kaggle: "kaggle", Oracle: "oracle", JetBrains: "jetbrains", Coursera: "coursera",
  Microsoft: "microsoft", IBM: "ibm", AWS: "amazonaws", freeCodeCamp: "freecodecamp",
};
const monogram = (name) => {
  const w = (name || "").split(/[\s/]+/).filter(Boolean);
  return (w.length > 1 ? w.slice(0, 2).map((x) => x[0]).join("") : (name || "").slice(0, 3)).toUpperCase();
};

const Card = ({ c }) => {
  const slug = authIcon[c.authority];
  return (
    <a
      href={c.url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-4 rounded-xl border border-edge bg-surface p-4 transition-colors hover:border-amber/40"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white p-2">
        {slug ? (
          <img
            src={si(slug)} alt={c.authority} loading="lazy" className="h-full w-full object-contain"
            onError={(e) => {
              const img = e.currentTarget;
              const parent = img.parentElement;
              img.style.display = "none";
              if (parent) {
                parent.textContent = monogram(c.authority);
                parent.className = "grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white font-display text-xs font-bold text-ink";
              }
            }}
          />
        ) : (
          <span className="font-display text-xs font-bold text-ink">{monogram(c.authority)}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-fg" title={c.name}>{c.name}</h3>
        <p className="mt-0.5 font-mono text-[11px] text-muted">
          {c.authority}{c.year ? ` · ${c.year}` : ""}
        </p>
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-accentText" />
    </a>
  );
};

export default function Certificates() {
  const [q, setQ] = useState("");
  const [auth, setAuth] = useState("all");

  const authorities = useMemo(
    () => ["all", ...Array.from(new Set(certifications.map((c) => c.authority))).sort()],
    []
  );
  const shown = certifications.filter((c) => {
    const okA = auth === "all" || c.authority === auth;
    const okQ = !q || (c.name + " " + c.authority).toLowerCase().includes(q.toLowerCase());
    return okA && okQ;
  });

  return (
    <div className="flex h-full flex-col bg-bg font-sans text-fg">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-edge px-5 py-3">
        <BadgeCheck className="h-4 w-4 text-accentText" />
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-accentText">Certifications</span>
        <span className="font-mono text-xs text-muted">{certifications.length} verified</span>
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search…"
            className="w-32 bg-transparent font-mono text-xs text-fg outline-none placeholder:text-muted"
          />
        </div>
      </div>

      {/* authority filter */}
      <div className="flex flex-wrap gap-1.5 border-b border-edge px-5 py-2.5">
        {authorities.map((a) => (
          <button
            key={a}
            onClick={() => setAuth(a)}
            className={`rounded-full border px-3 py-1 font-mono text-[10px] transition-colors ${
              auth === a ? "border-accent bg-accent text-accentFg" : "border-edge bg-surface text-muted hover:text-fg"
            }`}
          >
            {a === "all" ? `All · ${certifications.length}` : a}
          </button>
        ))}
      </div>

      {/* grid */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {shown.map((c, i) => <Card key={c.name + i} c={c} />)}
        </div>
        {shown.length === 0 && (
          <p className="py-16 text-center font-mono text-sm text-muted">No certificates match.</p>
        )}
      </div>
    </div>
  );
}
