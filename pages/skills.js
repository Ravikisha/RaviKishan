import React, { useRef } from "react";
import Head from "next/head";
import { motion } from "framer-motion";
import { ExternalLink, BadgeCheck } from "lucide-react";
import PageHeader from "../components/home2/PageHeader";
import ClosingCTA from "../components/home2/ClosingCTA";
import { certifications } from "../lib/certifications";

// devicon CDN — https://devicon.dev (colored logos)
const dv = (slug) =>
  `https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${slug}.svg`;
// simple-icons CDN — brand marks devicon doesn't carry (monochrome)
const si = (slug) => `https://cdn.jsdelivr.net/npm/simple-icons@13/icons/${slug}.svg`;

// Stack from resume/Resume 11 June.pdf TECHNICAL SKILLS, clustered + iconed.
const skillGroups = [
  {
    label: "Languages",
    items: [
      { n: "JavaScript", i: "javascript/javascript-original" },
      { n: "TypeScript", i: "typescript/typescript-original" },
      { n: "Python", i: "python/python-original" },
      { n: "Java", i: "java/java-original" },
      { n: "Go", i: "go/go-original-wordmark" },
      { n: "Rust", i: "rust/rust-original" },
      { n: "C++", i: "cplusplus/cplusplus-original" },
      { n: "C", i: "c/c-original" },
    ],
  },
  {
    label: "AI / ML",
    items: [
      { n: "PyTorch", i: "pytorch/pytorch-original" },
      { n: "TensorFlow", i: "tensorflow/tensorflow-original" },
      { n: "LangChain", si: "langchain" },
      { n: "OpenAI", si: "openai" },
      { n: "NumPy", i: "numpy/numpy-original" },
      { n: "Pandas", i: "pandas/pandas-original" },
      { n: "Jupyter", i: "jupyter/jupyter-original" },
      { n: "LangGraph" },
      { n: "RAG" },
      { n: "FAISS" },
      { n: "Fine-tuning" },
    ],
  },
  {
    label: "Backend",
    items: [
      { n: "Node.js", i: "nodejs/nodejs-original" },
      { n: "Express", i: "express/express-original" },
      { n: "FastAPI", i: "fastapi/fastapi-original" },
      { n: "Spring Boot", i: "spring/spring-original" },
      { n: "GraphQL", i: "graphql/graphql-plain" },
      { n: "Kafka", i: "apachekafka/apachekafka-original" },
      { n: "gRPC", i: "grpc/grpc-original" },
      { n: "WebSockets" },
      { n: "Microservices" },
    ],
  },
  {
    label: "Frontend",
    items: [
      { n: "React", i: "react/react-original" },
      { n: "Next.js", i: "nextjs/nextjs-original" },
      { n: "Redux", i: "redux/redux-original" },
      { n: "TailwindCSS", i: "tailwindcss/tailwindcss-original" },
      { n: "Module Federation", i: "webpack/webpack-original" },
    ],
  },
  {
    label: "Databases & Infra",
    items: [
      { n: "PostgreSQL", i: "postgresql/postgresql-original" },
      { n: "MongoDB", i: "mongodb/mongodb-original" },
      { n: "Redis", i: "redis/redis-original" },
      { n: "Elasticsearch", i: "elasticsearch/elasticsearch-original" },
      { n: "AWS", i: "amazonwebservices/amazonwebservices-original-wordmark" },
      { n: "GCP", i: "googlecloud/googlecloud-original" },
      { n: "Docker", i: "docker/docker-original" },
      { n: "Kubernetes", i: "kubernetes/kubernetes-original" },
      { n: "Terraform", i: "terraform/terraform-original" },
      { n: "CI/CD", i: "githubactions/githubactions-original" },
      { n: "Linux", i: "linux/linux-original" },
      { n: "CUDA", si: "nvidia" },
    ],
  },
  {
    label: "Concepts",
    items: [
      { n: "Distributed Systems" },
      { n: "System Design" },
      { n: "Concurrency" },
      { n: "Caching" },
      { n: "Scalability" },
      { n: "Fault Tolerance" },
      { n: "DSA" },
      { n: "OOP" },
    ],
  },
];

const monogram = (name) => {
  const w = name.split(/[\s/]+/).filter(Boolean);
  return (w.length > 1 ? w.slice(0, 2).map((x) => x[0]).join("") : name.slice(0, 3)).toUpperCase();
};

// Icon card with a subtle pointer-tilt on hover (no scaling).
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
  const reset = () => {
    if (ref.current) ref.current.style.transform = "";
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      className="flex flex-col items-center gap-3 rounded-xl border border-edge bg-surface p-4 text-center transition-[border-color,box-shadow] duration-200 will-change-transform hover:border-amber/50 hover:shadow-[0_10px_28px_-12px_rgba(0,0,0,0.4)]"
      style={{ transformStyle: "preserve-3d" }}
    >
      <span className="grid h-12 w-12 place-items-center rounded-lg bg-white p-2">
        {src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            className="h-full w-full object-contain"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              e.currentTarget.parentElement.textContent = monogram(item.n);
              e.currentTarget.parentElement.className =
                "grid h-12 w-12 place-items-center rounded-lg bg-white font-display text-sm font-bold text-ink";
            }}
          />
        ) : (
          <span className="font-display text-sm font-bold text-ink">
            {monogram(item.n)}
          </span>
        )}
      </span>
      <span className="font-mono text-[11px] leading-tight text-fg">{item.n}</span>
    </div>
  );
};

const authIcon = {
  HackerRank: "hackerrank",
  Udemy: "udemy",
  Google: "google",
  Meta: "meta",
  Kaggle: "kaggle",
  Oracle: "oracle",
  JetBrains: "jetbrains",
  Coursera: "coursera",
};

const CertCard = ({ c, i }) => {
  const slug = authIcon[c.authority];
  return (
    <motion.a
      href={c.url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: (i % 6) * 0.04, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="group flex items-center gap-4 rounded-xl border border-edge bg-surface p-4 transition-colors hover:border-amber/40"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white p-2">
        {slug ? (
          <img
            src={si(slug)}
            alt={c.authority}
            loading="lazy"
            className="h-full w-full object-contain"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              e.currentTarget.parentElement.textContent = monogram(c.authority);
              e.currentTarget.parentElement.className =
                "grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white font-display text-xs font-bold text-ink";
            }}
          />
        ) : (
          <span className="font-display text-xs font-bold text-ink">
            {monogram(c.authority)}
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-fg" title={c.name}>
          {c.name}
        </h3>
        <p className="mt-0.5 font-mono text-[11px] text-muted">
          {c.authority}
          {c.year ? ` · ${c.year}` : ""}
        </p>
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-accentText" />
    </motion.a>
  );
};

const Skills = () => {
  return (
    <>
      <Head>
        <title>Skills — Ravi Kishan</title>
        <meta
          name="description"
          content="Ravi Kishan's technical stack — languages, AI/ML, backend, infrastructure — and 40+ certifications."
        />
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>

      <main className="bg-bg font-sans text-fg antialiased">
        <PageHeader
          eyebrow="Skills"
          title="The"
          accent="toolbox."
          subtitle="Seven languages, an AI stack, and the infrastructure to run it all in production."
        />

        {/* clustered stack — icon cards */}
        <section className="border-b border-edge bg-bg py-20">
          <div className="mx-auto max-w-6xl space-y-12 px-6">
            {skillGroups.map((g) => (
              <div key={g.label}>
                <div className="mb-5 flex items-baseline gap-3">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
                    {g.label}
                  </p>
                  <span className="h-px flex-1 bg-edge" />
                  <span className="font-mono text-xs text-muted">
                    {g.items.length}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                  {g.items.map((it) => (
                    <SkillCard key={it.n} item={it} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* certifications from LinkedIn */}
        <section id="certificate" className="bg-bg py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mb-10 flex items-center gap-3">
              <BadgeCheck className="h-4 w-4 text-accentText" />
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-accentText">
                Certifications
              </p>
              <span className="h-px flex-1 bg-edge" />
              <span className="font-mono text-xs text-muted">
                {certifications.length}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {certifications.map((c, i) => (
                <CertCard key={c.name + i} c={c} i={i} />
              ))}
            </div>
          </div>
        </section>

        <ClosingCTA />
      </main>
    </>
  );
};

export default Skills;
