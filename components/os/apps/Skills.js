import React, { useRef, useState } from "react";
import { Layers } from "lucide-react";

const dv = (slug) => `https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${slug}.svg`;
const si = (slug) => `https://cdn.jsdelivr.net/npm/simple-icons@13/icons/${slug}.svg`;
const monogram = (name) => {
  const w = (name || "").split(/[\s/]+/).filter(Boolean);
  return (w.length > 1 ? w.slice(0, 2).map((x) => x[0]).join("") : (name || "").slice(0, 3)).toUpperCase();
};

const skillGroups = [
  { label: "Languages", items: [
    { n: "JavaScript", i: "javascript/javascript-original" }, { n: "TypeScript", i: "typescript/typescript-original" },
    { n: "Python", i: "python/python-original" }, { n: "Java", i: "java/java-original" },
    { n: "Go", i: "go/go-original-wordmark" }, { n: "Rust", i: "rust/rust-original" },
    { n: "C++", i: "cplusplus/cplusplus-original" }, { n: "C", i: "c/c-original" } ] },
  { label: "AI / ML", items: [
    { n: "PyTorch", i: "pytorch/pytorch-original" }, { n: "TensorFlow", i: "tensorflow/tensorflow-original" },
    { n: "LangChain", si: "langchain" }, { n: "OpenAI", si: "openai" }, { n: "NumPy", i: "numpy/numpy-original" },
    { n: "Pandas", i: "pandas/pandas-original" }, { n: "Jupyter", i: "jupyter/jupyter-original" },
    { n: "LangGraph" }, { n: "RAG" }, { n: "FAISS" }, { n: "Fine-tuning" } ] },
  { label: "Backend", items: [
    { n: "Node.js", i: "nodejs/nodejs-original" }, { n: "Express", i: "express/express-original" },
    { n: "FastAPI", i: "fastapi/fastapi-original" }, { n: "Spring Boot", i: "spring/spring-original" },
    { n: "GraphQL", i: "graphql/graphql-plain" }, { n: "Kafka", i: "apachekafka/apachekafka-original" },
    { n: "gRPC", i: "grpc/grpc-original" }, { n: "WebSockets" }, { n: "Microservices" } ] },
  { label: "Frontend", items: [
    { n: "React", i: "react/react-original" }, { n: "Next.js", i: "nextjs/nextjs-original" },
    { n: "Redux", i: "redux/redux-original" }, { n: "TailwindCSS", i: "tailwindcss/tailwindcss-original" },
    { n: "Module Federation", i: "webpack/webpack-original" } ] },
  { label: "Databases & Infra", items: [
    { n: "PostgreSQL", i: "postgresql/postgresql-original" }, { n: "MongoDB", i: "mongodb/mongodb-original" },
    { n: "Redis", i: "redis/redis-original" }, { n: "Elasticsearch", i: "elasticsearch/elasticsearch-original" },
    { n: "AWS", i: "amazonwebservices/amazonwebservices-original-wordmark" }, { n: "GCP", i: "googlecloud/googlecloud-original" },
    { n: "Docker", i: "docker/docker-original" }, { n: "Kubernetes", i: "kubernetes/kubernetes-original" },
    { n: "Terraform", i: "terraform/terraform-original" }, { n: "CI/CD", i: "githubactions/githubactions-original" },
    { n: "Linux", i: "linux/linux-original" }, { n: "CUDA", si: "nvidia" } ] },
  { label: "Concepts", items: [
    { n: "Distributed Systems" }, { n: "System Design" }, { n: "Concurrency" }, { n: "Caching" },
    { n: "Scalability" }, { n: "Fault Tolerance" }, { n: "DSA" }, { n: "OOP" } ] },
];

const SkillCard = ({ item }) => {
  const ref = useRef(null);
  const src = item.i ? dv(item.i) : item.si ? si(item.si) : null;
  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(500px) rotateX(${-py * 14}deg) rotateY(${px * 16}deg)`;
  };
  const reset = () => { if (ref.current) ref.current.style.transform = ""; };
  return (
    <div
      ref={ref} onMouseMove={onMove} onMouseLeave={reset}
      className="flex flex-col items-center gap-3 rounded-xl border border-edge bg-surface p-4 text-center transition-[border-color,box-shadow] duration-200 will-change-transform hover:border-amber/50 hover:shadow-[0_10px_28px_-12px_rgba(0,0,0,0.4)]"
      style={{ transformStyle: "preserve-3d" }}
    >
      <span className="grid h-12 w-12 place-items-center rounded-lg bg-white p-2">
        {src ? (
          <img src={src} alt="" loading="lazy" className="h-full w-full object-contain"
            onError={(e) => {
              const img = e.currentTarget;
              const parent = img.parentElement;
              img.style.display = "none";
              if (parent) {
                parent.textContent = monogram(item.n);
                parent.className = "grid h-12 w-12 place-items-center rounded-lg bg-white font-display text-sm font-bold text-ink";
              }
            }} />
        ) : (
          <span className="font-display text-sm font-bold text-ink">{monogram(item.n)}</span>
        )}
      </span>
      <span className="font-mono text-[11px] leading-tight text-fg">{item.n}</span>
    </div>
  );
};

export default function Skills() {
  const [active, setActive] = useState("all");
  const total = skillGroups.reduce((n, g) => n + g.items.length, 0);
  const groups = active === "all" ? skillGroups : skillGroups.filter((g) => g.label === active);

  return (
    <div className="flex h-full flex-col bg-bg font-sans text-fg">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-5 py-3">
        <Layers className="h-4 w-4 text-accentText" />
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-accentText">Skills</span>
        <span className="font-mono text-xs text-muted">{total} across {skillGroups.length} domains</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {["all", ...skillGroups.map((g) => g.label)].map((l) => (
            <button
              key={l}
              onClick={() => setActive(l)}
              className={`rounded-full border px-3 py-1 font-mono text-[10px] transition-colors ${
                active === l ? "border-accent bg-accent text-accentFg" : "border-edge bg-surface text-muted hover:text-fg"
              }`}
            >
              {l === "all" ? "All" : l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-10 overflow-y-auto p-5">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="mb-4 flex items-baseline gap-3">
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">{g.label}</p>
              <span className="h-px flex-1 bg-edge" />
              <span className="font-mono text-xs text-muted">{g.items.length}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {g.items.map((it) => <SkillCard key={it.n} item={it} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
