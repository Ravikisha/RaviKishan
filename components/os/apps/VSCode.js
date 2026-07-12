import React, { useMemo, useState } from "react";
import { Files, Search, GitBranch, Bug, Blocks, Settings, X, TerminalSquare, AlertCircle } from "lucide-react";

// VS Code, but the codebase is Ravi. Authentic Dark+ chrome; every file is a
// real fact expressed as code. The joke is the content, the flex is the fidelity.
// Signature twist: the status bar is amber (#FFB020) — this is Ravi's fork.

const C = {
  comment: "#6A9955", string: "#CE9178", kw: "#569CD6", num: "#B5CEA8",
  type: "#4EC9B0", prop: "#9CDCFE", punct: "#D4D4D4", fn: "#DCDCAA", def: "#D4D4D4",
};

/* ---------- tiny syntax highlighter ---------- */
const CODE_RE = new RegExp(
  "(\\/\\/[^\\n]*)" +
  "|(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)" +
  "|\\b(const|let|var|export|default|import|from|function|return|if|else|for|while|interface|type|satisfies|as|new|class|extends|implements|async|await|true|false|null|undefined|void|this|of|in)\\b" +
  "|\\b(\\d[\\d_]*(?:\\.\\d+)?)\\b" +
  "|([A-Z][A-Za-z0-9_]*)" +
  "|([A-Za-z_$][\\w$]*)(?=\\s*:)" +
  "|([{}\\[\\]()<>;,.=+\\-*/:?|&!])",
  "g"
);
const CODE_COLORS = [null, C.comment, C.string, C.kw, C.num, C.type, C.prop, C.punct];

function tkCode(line) {
  const out = [];
  let last = 0, m;
  CODE_RE.lastIndex = 0;
  while ((m = CODE_RE.exec(line))) {
    if (m.index > last) out.push({ v: line.slice(last, m.index), c: C.def });
    const gi = m.slice(1).findIndex((g) => g !== undefined) + 1;
    out.push({ v: m[0], c: CODE_COLORS[gi] || C.def });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ v: line.slice(last), c: C.def });
  return out.length ? out : [{ v: " ", c: C.def }];
}
function tkMd(line) {
  if (line.trimStart().startsWith("#")) return [{ v: line, c: C.kw }];
  if (line.trimStart().startsWith(">")) return [{ v: line, c: C.comment }];
  return line.split(/(`[^`]*`|\*\*[^*]*\*\*)/).filter(Boolean).map((p) =>
    p.startsWith("`") ? { v: p, c: C.string } : p.startsWith("**") ? { v: p, c: C.fn } : { v: p, c: C.def }
  );
}
function tkEnv(line) {
  const hi = line.indexOf("#");
  const code = hi >= 0 ? line.slice(0, hi) : line;
  const comment = hi >= 0 ? line.slice(hi) : "";
  const out = [];
  const eq = code.indexOf("=");
  if (eq >= 0) {
    out.push({ v: code.slice(0, eq), c: C.prop });
    out.push({ v: "=", c: C.punct });
    out.push({ v: code.slice(eq + 1), c: C.string });
  } else out.push({ v: code, c: C.def });
  if (comment) out.push({ v: comment, c: C.comment });
  return out;
}
function tkLog(line) {
  const m = line.match(/^(\[[A-Z]+\])(.*)$/);
  if (!m) return [{ v: line, c: C.def }];
  const lvl = m[1];
  const col = lvl.includes("ERROR") ? "#F48771" : lvl.includes("WARN") ? "#FFB020" : lvl.includes("HINT") ? "#4EC9B0" : "#569CD6";
  return [{ v: lvl, c: col }, { v: m[2], c: C.def }];
}
const HL = { md: tkMd, env: tkEnv, log: tkLog };
const highlight = (line, lang) => (HL[lang] || tkCode)(line);

/* ---------- the "codebase" ---------- */
const FILES = [
  {
    id: "readme", name: "README.md", lang: "md", dot: "#519ABA", modified: false,
    content: `# ravikishan.me
> I rebuild the layers most people take for granted.

**Software Engineer** — distributed systems, systems programming & applied AI.
Currently **Agentic AI Engineer @ Zimyo**. Open to hard systems + AI problems.

## in this workspace
- \`whoami.ts\`      — the type-safe me
- \`skills.json\`    — the stack (CSS confidence: low)
- \`experience.ts\`  — where it shipped
- \`patent.md\`      — yes, a real one
- \`.env\`           — you didn't see this

<!-- press the play button on any file. or don't. it's chill. -->`,
  },
  {
    id: "whoami", name: "whoami.ts", lang: "ts", dot: "#4EC9B0", modified: true,
    content: `// Software Engineer — distributed systems, systems programming & applied AI.

interface Human {
  name: string;
  role: string;
  buildsFromScratch: boolean;
}

export const ravi = {
  name: "Ravi Kishan",
  role: "Software Engineer",
  now: "Agentic AI Engineer @ Zimyo",
  location: "Bihar, India",
  focus: ["distributed systems", "systems programming", "applied AI"],

  coffee: Infinity,          // TODO: add a rate limiter
  sleep: undefined,          // deprecated since 2019
  buildsFromScratch: true,   // a runtime, a language, a datastore…
} satisfies Human;           // ✅ type-checks (mostly)

// $ git blame whoami.ts  →  author: You. every line. 2am.
export default ravi;`,
  },
  {
    id: "skills", name: "skills.json", lang: "json", dot: "#CBCB41", modified: false,
    content: `{
  "languages": ["Go", "Rust", "TypeScript", "Python", "Java", "C++"],
  "ai_ml":     ["LangGraph", "RAG", "FAISS", "PyTorch", "Fine-tuning"],
  "systems":   ["gRPC", "Kafka", "Redis", "Kubernetes", "CUDA", "SIMD"],

  "css":        "27%",   // still Googling flexbox
  "confidence": "99.8%", // model output — do not trust
  "willToRebuildAnything": true
}`,
  },
  {
    id: "experience", name: "experience.ts", lang: "ts", dot: "#4EC9B0", modified: false,
    content: `export const experience = [
  {
    org: "Zimyo",
    title: "Agentic AI Engineer",
    since: "Apr 2026",
    wins: [
      "agentic HRMS platform on LangChain + LangGraph",
      "cut LLM inference cost 70% — one schema-constrained call",
    ],
  },
  {
    org: "Arrowhead Capital",
    title: "Quantitative Developer Intern",
    wins: [
      "SIMD-vectorized backtester over 5M+ records: 18s → 4.2s (4.3×)",
      "risk analytics: Sharpe · max drawdown · VaR",
    ],
  },
] as const;
// see also: backtest_life.py  (open the Quant Desk app 👀)`,
  },
  {
    id: "patent", name: "patent.md", lang: "md", dot: "#519ABA", modified: false,
    content: `# 📜 Patent — Published

**A Multilingual Chatbot for Indian Epics using Generative AI & LLMs**
App. No. \`202541117128\` · Published 19 Dec 2025

- RAG over the **Bhagavad Gita**
- **> 95% retrieval accuracy** across **5 languages**
- OpenAI embeddings · LangChain · FAISS / Pinecone
- evaluated with BLEU + BERTScore

> named inventor. yes, really.`,
  },
  {
    id: "bugs", name: "bugs.log", lang: "log", dot: "#F48771", modified: false,
    content: `[INFO]  bugs opened today .......... 37
[INFO]  bugs fixed .................. 2
[WARN]  bugs re-classified "feature"  35
[INFO]  root cause .................. "works on my machine"
[ERROR] Cannot find module 'work-life-balance'
[HINT]  did you mean 'side-project'?`,
  },
  {
    id: "env", name: ".env", lang: "env", dot: "#DCDCAA", modified: false,
    content: `# .gitignore'd, obviously. (you didn't see this)
NAME=Ravi Kishan
GITHUB_STARS=167
NPM_DOWNLOADS=1000+          # the "+" is load-bearing
DSA_SOLVED=1200
COFFEE_TOKEN=████████████    # rotated hourly
SLEEP_SECRET=undefined
DEPLOY_ON_FRIDAY=false       # learned this the hard way`,
  },
];

const PROBLEMS = [
  { s: "warn", f: "whoami.ts", m: "'sleep' is declared but its value is never read.", code: "ts(6133)" },
  { s: "error", f: "bugs.log", m: "Cannot find name 'work_life_balance'. Did you mean 'side_project'?", code: "ts(2552)" },
  { s: "warn", f: "bugs.log", m: "This bug is intentional. Suppress with // @ts-feature.", code: "ts(0)" },
  { s: "info", f: "life.ts", m: 'Unreachable code detected: "// take a break".', code: "ts(7027)" },
  { s: "error", f: "whoami.ts", m: "'coffee' is possibly 'Infinity'.", code: "ts(2532)" },
];
const TERMINAL = [
  { t: "ravi@raviOS ~/ravikishan.me $ git log --oneline -1", c: C.def },
  { t: "a1b2c3d (HEAD -> main) ship first, sleep later", c: C.comment },
  { t: "ravi@raviOS ~/ravikishan.me $ npm run build", c: C.def },
  { t: "✓ compiled — 0 errors, 3 strong opinions", c: "#4EC9B0" },
  { t: "ravi@raviOS ~/ravikishan.me $ whoami", c: C.def },
  { t: "a guy who rebuilds things instead of reading the docs", c: C.string },
];

const mmColor = (ln) => {
  const t = ln.trimStart();
  if (t.startsWith("//") || t.startsWith("#") || t.startsWith(">")) return "#3a4a34";
  if (!t) return "transparent";
  return "#3c3c44";
};
const errs = PROBLEMS.filter((p) => p.s === "error").length;
const warns = PROBLEMS.filter((p) => p.s === "warn").length;

export default function VSCode() {
  const [openIds, setOpenIds] = useState(["whoami", "readme"]);
  const [active, setActive] = useState("whoami");
  const [panel, setPanel] = useState("problems"); // problems | terminal | null
  const file = FILES.find((f) => f.id === active) || FILES[0];
  const lines = useMemo(() => file.content.split("\n"), [file]);

  const openFile = (id) => {
    setActive(id);
    setOpenIds((o) => (o.includes(id) ? o : [...o, id]));
  };
  const closeTab = (id, e) => {
    e.stopPropagation();
    setOpenIds((o) => {
      const next = o.filter((x) => x !== id);
      if (id === active && next.length) setActive(next[next.length - 1]);
      return next;
    });
  };

  return (
    <div className="vs">
      <div className="vs-main">
        {/* activity bar */}
        <div className="vs-activity">
          <button className="vs-act active" title="Explorer"><Files className="h-5 w-5" /></button>
          <button className="vs-act" title="Search"><Search className="h-5 w-5" /></button>
          <button className="vs-act" title="Source Control">
            <GitBranch className="h-5 w-5" /><span className="vs-badge">1</span>
          </button>
          <button className="vs-act" title="Run & Debug"><Bug className="h-5 w-5" /></button>
          <button className="vs-act" title="Extensions"><Blocks className="h-5 w-5" /><span className="vs-badge amber">☕</span></button>
          <button className="vs-act bottom" title="Settings"><Settings className="h-5 w-5" /></button>
        </div>

        {/* explorer */}
        <div className="vs-side">
          <div className="vs-side-h">Explorer</div>
          <div className="vs-folder">▾ RAVIKISHAN.ME</div>
          {FILES.map((f) => (
            <button
              key={f.id}
              className={`vs-file ${active === f.id ? "active" : ""}`}
              onClick={() => openFile(f.id)}
            >
              <span className="vs-file-dot" style={{ background: f.dot }} />
              <span className="vs-file-name">{f.name}</span>
              {f.modified && <span className="vs-file-m">M</span>}
            </button>
          ))}
          <div className="vs-side-foot">2am commits · 0 regrets</div>
        </div>

        {/* editor column */}
        <div className="vs-editor-col">
          {/* tabs */}
          <div className="vs-tabs">
            {openIds.map((id) => {
              const f = FILES.find((x) => x.id === id);
              if (!f) return null;
              return (
                <div
                  key={id}
                  className={`vs-tab ${active === id ? "active" : ""}`}
                  onClick={() => setActive(id)}
                >
                  <span className="vs-file-dot" style={{ background: f.dot }} />
                  {f.name}
                  <span className="vs-tab-x" onClick={(e) => closeTab(id, e)}>
                    {f.modified && active !== id ? <span className="vs-dot-unsaved" /> : <X className="h-3 w-3" />}
                  </span>
                </div>
              );
            })}
            <div className="vs-breadcrumb">ravikishan.me › src › {file.name}</div>
          </div>

          {/* code + minimap */}
          <div className="vs-body">
            <div className="vs-code">
              {lines.map((ln, i) => (
                <div className={`vs-ln ${i === 0 ? "cur" : ""}`} key={i}>
                  <span className="vs-gutter">{i + 1}</span>
                  <span className="vs-src">
                    {highlight(ln, file.lang).map((t, j) => (
                      <span key={j} style={{ color: t.c }}>{t.v}</span>
                    ))}
                    {i === 0 && <span className="vs-caret" />}
                  </span>
                </div>
              ))}
            </div>
            <div className="vs-minimap">
              {lines.map((ln, i) => (
                <div key={i} className="vs-mm" style={{ width: `${Math.min(96, ln.trim().length * 1.4)}%`, background: mmColor(ln) }} />
              ))}
            </div>
          </div>

          {/* bottom panel */}
          {panel && (
            <div className="vs-panel">
              <div className="vs-panel-tabs">
                <button className={panel === "problems" ? "on" : ""} onClick={() => setPanel("problems")}>
                  Problems <span className="vs-pill">{PROBLEMS.length}</span>
                </button>
                <button className={panel === "terminal" ? "on" : ""} onClick={() => setPanel("terminal")}>Terminal</button>
                <button className="vs-panel-x" onClick={() => setPanel(null)}><X className="h-3.5 w-3.5" /></button>
              </div>
              <div className="vs-panel-body">
                {panel === "problems" ? (
                  PROBLEMS.map((p, i) => (
                    <div className="vs-prob" key={i}>
                      <AlertCircle className={`h-3.5 w-3.5 ${p.s}`} />
                      <span className="vs-prob-m">{p.m}</span>
                      <span className="vs-prob-f">{p.f}</span>
                      <span className="vs-prob-c">{p.code}</span>
                    </div>
                  ))
                ) : (
                  <div className="vs-term">
                    {TERMINAL.map((t, i) => <div key={i} style={{ color: t.c }}>{t.t}</div>)}
                    <div className="vs-term-live"><span style={{ color: C.def }}>ravi@raviOS ~/ravikishan.me $ </span><span className="vs-caret" /></div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* status bar — amber: this is Ravi's fork */}
      <div className="vs-status">
        <span className="vs-st-branch"><GitBranch className="h-3 w-3" /> main*</span>
        <button className="vs-st-item" onClick={() => setPanel("problems")}>
          <AlertCircle className="h-3 w-3" /> {errs} <span className="vs-tri">⚠</span> {warns}
        </button>
        <button className="vs-st-item" onClick={() => setPanel(panel ? null : "terminal")}>
          <TerminalSquare className="h-3 w-3" /> terminal
        </button>
        <span className="vs-st-spacer" />
        <span className="vs-st-item">Ln 1, Col 1</span>
        <span className="vs-st-item">Spaces: 2</span>
        <span className="vs-st-item">UTF-8</span>
        <span className="vs-st-item">LF</span>
        <span className="vs-st-item">{file.lang === "ts" ? "TypeScript" : file.lang === "json" ? "JSON" : file.lang === "md" ? "Markdown" : "Plaintext"}</span>
        <span className="vs-st-item">Prettier ✓</span>
        <span className="vs-st-item">☕ 100%</span>
      </div>

      <style jsx>{`
        .vs { height: 100%; display: flex; flex-direction: column; background: #1e1e1e; color: #d4d4d4; font-family: "Inter", system-ui, sans-serif; font-size: 12px; }
        .vs-main { flex: 1; display: flex; min-height: 0; }
        /* activity bar */
        .vs-activity { width: 48px; background: #333333; display: flex; flex-direction: column; align-items: center; padding: 8px 0; gap: 4px; }
        .vs-act { position: relative; height: 40px; width: 40px; display: grid; place-items: center; color: #858585; background: none; border: none; border-left: 2px solid transparent; cursor: pointer; }
        .vs-act:hover { color: #fff; }
        .vs-act.active { color: #fff; border-left-color: #FFB020; }
        .vs-act.bottom { margin-top: auto; }
        .vs-badge { position: absolute; right: 4px; bottom: 6px; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 7px; background: #FFB020; color: #1e1e1e; font-size: 9px; font-weight: 700; display: grid; place-items: center; }
        .vs-badge.amber { background: transparent; font-size: 11px; }
        /* explorer */
        .vs-side { width: 210px; background: #252526; display: flex; flex-direction: column; border-right: 1px solid #1a1a1a; }
        .vs-side-h { padding: 10px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #bbb; }
        .vs-folder { padding: 4px 12px; font-size: 11px; font-weight: 700; color: #ccc; text-transform: uppercase; letter-spacing: .04em; }
        .vs-file { display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 12px 4px 24px; background: none; border: none; color: #cccccc; cursor: pointer; text-align: left; font-size: 13px; }
        .vs-file:hover { background: #2a2d2e; }
        .vs-file.active { background: #37373d; }
        .vs-file-dot { height: 9px; width: 9px; border-radius: 2px; flex: 0 0 auto; }
        .vs-file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .vs-file-m { color: #4ED0C0; font-size: 11px; font-weight: 700; }
        .vs-side-foot { margin-top: auto; padding: 8px 16px; font-family: "JetBrains Mono", monospace; font-size: 10px; color: #5a5a5a; }
        /* editor */
        .vs-editor-col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .vs-tabs { display: flex; align-items: center; background: #252526; border-bottom: 1px solid #1a1a1a; overflow-x: auto; }
        .vs-tab { display: flex; align-items: center; gap: 7px; padding: 7px 10px 7px 12px; background: #2d2d2d; color: #969696; border-right: 1px solid #1a1a1a; cursor: pointer; white-space: nowrap; font-size: 12.5px; }
        .vs-tab.active { background: #1e1e1e; color: #fff; box-shadow: inset 0 1.5px 0 #FFB020; }
        .vs-tab-x { display: grid; place-items: center; height: 16px; width: 16px; border-radius: 4px; }
        .vs-tab-x:hover { background: #ffffff22; }
        .vs-dot-unsaved { height: 8px; width: 8px; border-radius: 50%; background: #fff; }
        .vs-breadcrumb { margin-left: 14px; font-family: "JetBrains Mono", monospace; font-size: 11px; color: #6a6a6a; white-space: nowrap; }
        .vs-body { flex: 1; display: flex; min-height: 0; position: relative; }
        .vs-code { flex: 1; overflow: auto; padding: 8px 0; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 13px; line-height: 1.55; }
        .vs-ln { display: flex; padding: 0 8px 0 0; white-space: pre; }
        .vs-ln.cur { background: #ffffff08; }
        .vs-gutter { width: 44px; flex: 0 0 auto; text-align: right; padding-right: 16px; color: #6e7681; user-select: none; }
        .vs-ln.cur .vs-gutter { color: #c6c6c6; }
        .vs-src { flex: 1; }
        .vs-caret { display: inline-block; width: 1px; height: 1.05em; background: #FFB020; vertical-align: text-bottom; margin-left: 1px; animation: vsblink 1.05s step-end infinite; }
        @keyframes vsblink { 50% { opacity: 0; } }
        .vs-minimap { width: 62px; flex: 0 0 auto; background: #1e1e1e; padding: 8px 8px 8px 4px; display: flex; flex-direction: column; gap: 1px; overflow: hidden; border-left: 1px solid #2a2a2a; }
        .vs-mm { height: 2px; border-radius: 1px; }
        /* panel */
        .vs-panel { height: 190px; border-top: 1px solid #2a2a2a; background: #1e1e1e; display: flex; flex-direction: column; }
        .vs-panel-tabs { display: flex; align-items: center; gap: 4px; padding: 4px 10px; border-bottom: 1px solid #2a2a2a; }
        .vs-panel-tabs button { background: none; border: none; color: #969696; cursor: pointer; padding: 4px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1.5px solid transparent; }
        .vs-panel-tabs button.on { color: #fff; border-bottom-color: #FFB020; }
        .vs-panel-x { margin-left: auto; }
        .vs-pill { background: #ffffff1a; border-radius: 8px; padding: 0 6px; font-size: 10px; }
        .vs-panel-body { flex: 1; overflow: auto; padding: 8px 12px; font-family: "JetBrains Mono", monospace; font-size: 12px; }
        .vs-prob { display: grid; grid-template-columns: 18px 1fr auto auto; align-items: center; gap: 10px; padding: 3px 0; color: #cccccc; }
        .vs-prob .error { color: #F48771; } .vs-prob .warn { color: #FFB020; } .vs-prob .info { color: #4ED0C0; }
        .vs-prob-f { color: #6a9955; font-size: 11px; } .vs-prob-c { color: #6e7681; font-size: 11px; }
        .vs-term > div { line-height: 1.6; }
        .vs-term-live { display: flex; align-items: center; }
        /* status bar — the amber fork */
        .vs-status { display: flex; align-items: center; gap: 0; height: 24px; background: #FFB020; color: #241a00; font-size: 11px; font-family: "JetBrains Mono", monospace; }
        .vs-st-branch, .vs-st-item { display: inline-flex; align-items: center; gap: 5px; padding: 0 9px; height: 100%; }
        .vs-st-branch { font-weight: 700; }
        .vs-st-item { background: none; border: none; color: #241a00; cursor: pointer; }
        .vs-st-item:hover { background: #00000018; }
        .vs-tri { margin-left: 4px; }
        .vs-st-spacer { flex: 1; }
        @media (prefers-reduced-motion: reduce) { .vs-caret { animation: none; } }
        @media (max-width: 720px) { .vs-side { width: 150px; } .vs-minimap { display: none; } .vs-activity { width: 42px; } }
      `}</style>
    </div>
  );
}
