// Single source of truth for homepage facts.
// Traces to: resume/Resume 11 June.pdf, github/github_ravikisha_data/*, linkedin/*.
// Never invent metrics — every number here comes from those sources.

export const identity = {
  name: "Ravi Kishan",
  role: "Software Engineer",
  focus: ["Distributed Systems", "Systems Programming", "Applied AI"],
  location: "Bihar, India",
  now: "Agentic AI Engineer @ Zimyo",
  photo: "/assets/myimage.png",
  github: "https://github.com/Ravikisha",
  linkedin: "https://www.linkedin.com/in/ravikisha/",
  twitter: "https://twitter.com/RaviKishan_",
  email: "ravikishan63392@gmail.com",
  // hero copy, in Ravi's own LinkedIn voice
  tagline: "I rebuild the layers most people take for granted.",
  intro:
    "Software engineer drawn to the systems others treat as magic — a UI runtime, a language interpreter, a container runtime and a distributed datastore, all built from scratch. The fastest way I understand a system is to rebuild it.",
};

// GitHub — github/github_ravikisha_data/profile_info.json + repositories_info.json
export const github = {
  stars: 167,
  repos: 69,
  followers: 39,
  since: 2019,
};

// Résumé PDF — editable from /admin. `url` can point to the bundled file in
// public/ or any hosted PDF (Google Drive, Firebase Storage, etc.).
export const resume = {
  url: "/Ravi_Kishan_Resume.pdf",
  filename: "Ravi_Kishan_Resume.pdf",
  updated: "June 2026",
};

// Publications — patents & papers. Admin-editable; add more entries over time.
export const patents = [
  {
    type: "Indian Patent Application",
    status: "Published",
    title: "A Multilingual Chatbot for Indian Epics Using Generative AI and LLMs",
    number: "App. No. 202541117128",
    date: "Published 19 Dec 2025",
    filed: "Filed Nov 2025",
    abstract:
      "A RAG system over the Bhagavad Gita reaching >95% retrieval accuracy across 5 languages — built with OpenAI embeddings, LangChain and FAISS/Pinecone, and evaluated with BLEU and BERTScore.",
    tags: ["RAG", "LLMs", "NLP", "Vector Search"],
    url: "",
  },
];

// Lines streamed by the hero build-log terminal. Order matters.
export const buildLog = [
  { cmd: "npm i relaxcore", out: "Relax.js runtime — 35% faster render vs React", ok: true },
  { cmd: "downloads --pkg relax*", out: "1,000+ NPM downloads across the Relax ecosystem", ok: true },
  { cmd: "run relaxlang ./epic.rx", out: "custom interpreter: lexer → parser → AST → eval", ok: true },
  { cmd: "kv-store --nodes 3 --replicate", out: "fault-tolerant Go datastore: sharding + replication", ok: true },
  { cmd: "gh stars --user Ravikisha", out: "167 stars across 69 public repositories", ok: true },
  { cmd: "patent status 202541117128", out: "PUBLISHED — RAG over Bhagavad Gita, >95% retrieval / 5 langs", ok: true },
];

// Hard, resume-sourced metrics for the animated stat strip.
export const stats = [
  { value: 4.3, suffix: "×", label: "backtest speedup — SIMD, 18s → 4.2s" },
  { value: 70, suffix: "%", label: "LLM inference cost cut at Zimyo" },
  { value: 1200, suffix: "+", label: "DSA problems solved" },
  { value: 167, suffix: "★", label: "GitHub stars across 69 repos" },
];

// Floating proof chips on the portrait.
export const chips = [
  "Patent holder",
  "1,000+ npm downloads",
  "Gold Medalist",
];

// Top 6 builds — curated from github/github_ravikisha_data for a systems-engineer story
// (runtime · language · search · cache · distributed store · load balancer).
export const systems = [
  {
    name: "Relax.js",
    kind: "UI Runtime",
    blurb:
      "A React alternative in TypeScript: fine-grained signals/effects, a deterministic scheduler with priority lanes + budgets, and a Babel-compiled fast path with SSR, hydration and SSG.",
    metric: "35% faster than React · 1,000+ npm downloads",
    stack: ["TypeScript", "Babel", "SSR"],
    stars: null,
    href: "https://github.com/Ravikisha/Relax.js",
    npm: "https://npmjs.com/package/relaxcore",
  },
  {
    name: "RelaxSearch",
    kind: "Search Engine",
    blurb:
      "A lightweight full-text search engine in Go with an Elasticsearch-style inverted index, a web crawler and a ranking algorithm over indexed documents.",
    metric: "inverted index · crawler · ranking",
    stack: ["Go", "Elasticsearch"],
    stars: 28,
    href: "https://github.com/Ravikisha/RelaxSearch",
    npm: null,
  },
  {
    name: "Redis-Clone",
    kind: "In-Memory Datastore",
    blurb:
      "A Redis server reimplemented in Rust and Go — RESP protocol, core data structures and an event loop — because rebuilding it is the fastest way to actually understand it.",
    metric: "RESP protocol · single-threaded event loop",
    stack: ["Rust", "Go"],
    stars: 17,
    href: "https://github.com/Ravikisha/Redis-Clone",
    npm: null,
  },
  {
    name: "RelaxLang",
    kind: "Interpreted Language",
    blurb:
      "A programming language built from scratch in Java/C — lexer, parser, AST and tree-walking interpreter — inspired by Lox, shipped in a Dockerized execution environment.",
    metric: "lexer → parser → AST → interpreter",
    stack: ["Java", "C", "Docker"],
    stars: null,
    href: "https://github.com/Ravikisha/RelaxLang",
    npm: "https://hub.docker.com/r/ravikishan63392/relaxlang",
  },
  {
    name: "Distributed KV Store",
    kind: "Distributed Datastore",
    blurb:
      "A scalable, fault-tolerant key-value store in Go with sharding, replication and multithreaded request handling across nodes for high availability under node failure.",
    metric: "sharding · replication · high availability",
    stack: ["Go", "Concurrency"],
    stars: 3,
    href: "https://github.com/Ravikisha/Distributed-KV-Database",
    npm: null,
  },
  {
    name: "Load Balancer",
    kind: "Traffic Router",
    blurb:
      "An NGINX/HAProxy-style load balancer in TypeScript — round-robin and weighted strategies, health checks and reverse-proxying across backend pools.",
    metric: "round-robin · weighted · health checks",
    stack: ["TypeScript", "Node.js"],
    stars: 4,
    href: "https://github.com/Ravikisha/Load-Balancer-Implementation",
    npm: null,
  },
];

export const education = [
  {
    degree: "MCA — Master of Computer Applications",
    school: "VIT Vellore",
    period: "2024 — 2026",
    gpa: "9.5 / 10",
    logo: "/assets/logo-vit.png",
    logoBg: "#FFFFFF",
  },
  {
    degree: "BCA — Bachelor of Computer Applications",
    school: "PIMR, Gwalior",
    period: "2021 — 2024",
    gpa: "9.6 / 10 · Gold Medalist",
    logo: "/assets/logo-pimr.png",
    logoBg: "#FFFFFF",
  },
  {
    degree: "Higher Secondary (12th), Science — BSEB",
    school: "R.S.B. Inter High School",
    period: "2019 — 2021",
    gpa: "74%",
    logo: "/assets/logo-bseb.png",
    logoBg: "#FFFFFF",
  },
  {
    degree: "Matriculation (10th) — BSEB",
    school: "R.S.B. Inter High School",
    period: "2017 — 2019",
    gpa: "84%",
    logo: "/assets/logo-bseb.png",
    logoBg: "#FFFFFF",
  },
];

export const experience = [
  {
    org: "Zimyo",
    title: "Agentic AI Engineer",
    place: "Gurugram",
    period: "Apr 2026 — Present",
    logo: "/assets/logo-zimyo.png",
    logoBg: "#000000",
    points: [
      "Built an agentic AI platform for HRMS automation on LangChain + LangGraph — natural-language multi-step workflows across payroll, attendance and employee-lifecycle modules.",
      "Engineered a dynamic API-ingestion engine that parses REST schemas and auto-generates executable workflow graphs, killing manual config for 5+ HR modules.",
      "Cut LLM inference cost 70% by consolidating multi-turn generation into a single schema-constrained call.",
    ],
    current: true,
  },
  {
    org: "Arrowhead Capital Management",
    title: "Quantitative Developer Intern",
    place: "Mumbai",
    period: "Jul 2025 — Apr 2026",
    logo: "/assets/logo-arrowhead.png",
    logoBg: "#FFFFFF",
    points: [
      "Designed a vectorized backtesting engine over 5M+ time-series records using SIMD intrinsics — 18s → 4.2s (4.3× speedup).",
      "Built ETL pipelines with multi-layer validation + caching (+30% research throughput) and rolling-window risk analytics (Sharpe, max drawdown, VaR).",
    ],
    current: false,
  },
  {
    org: "Chiti Infotech",
    title: "Full-Stack Developer Intern",
    place: "Gwalior",
    period: "Jan 2023 — Sep 2023",
    logo: "/assets/logo-chiti.png",
    logoBg: "#000000",
    points: [
      "Migrated a legacy PHP monolith to a modular React SPA (40% faster frontend) and reworked the REST layer with caching (−25% latency).",
    ],
    current: false,
  },
];

// Real stack from the resume TECHNICAL SKILLS block, for the marquee.
export const marquee = [
  "TypeScript", "Go", "Rust", "Python", "Java", "C++",
  "LangGraph", "PyTorch", "RAG", "FAISS", "gRPC", "Kafka",
  "PostgreSQL", "Redis", "Kubernetes", "CUDA", "Next.js", "SIMD",
];

export const credentials = [
  "MCA, VIT Vellore — GPA 9.5/10",
  "Graduation Gold Medalist",
  "Named inventor · published Indian patent",
  "Microsoft Learn Student Ambassador",
];
