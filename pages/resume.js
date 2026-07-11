import React from "react";
import Head from "next/head";
import { motion } from "framer-motion";
import {
  Download,
  ExternalLink,
  Mail,
  Github,
  Linkedin,
  MapPin,
  Award,
} from "lucide-react";
import { useSiteContent } from "../lib/useSiteContent";
import PageHeader from "../components/home2/PageHeader";
import ClosingCTA from "../components/home2/ClosingCTA";

// Stable, resume-sourced blocks (resume/Resume 11 June.pdf).
const patent = {
  title: "A Multilingual Chatbot for Indian Epics Using Generative AI & LLMs",
  meta: "Indian Patent Application (Published) · App. No. 202541117128",
  detail:
    "RAG system over the Bhagavad Gita reaching >95% retrieval accuracy across 5 languages (OpenAI embeddings, LangChain, FAISS/Pinecone); evaluated with BLEU and BERTScore.",
};

const skillGroups = [
  { label: "Languages", items: "JavaScript · TypeScript · Python · Java · Go · Rust · C++" },
  { label: "AI / ML", items: "PyTorch · LangChain · LangGraph · RAG · Vector DBs · Fine-tuning" },
  { label: "Backend", items: "Node.js · FastAPI · Spring Boot · GraphQL · gRPC · Kafka" },
  { label: "Frontend", items: "React · Next.js · Redux · TailwindCSS · Module Federation" },
  { label: "Infra", items: "PostgreSQL · Redis · AWS · GCP · Docker · Kubernetes · Terraform · CUDA" },
];

const Eyebrow = ({ children }) => (
  <div className="mb-4 flex items-center gap-3">
    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accentText">
      {children}
    </p>
    <span className="h-px flex-1 bg-edge" />
  </div>
);

const Section = ({ children, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-40px" }}
    transition={{ delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
  >
    {children}
  </motion.div>
);

const Resume = () => {
  const { resume, identity, experience, education, systems, credentials } =
    useSiteContent();
  const url = resume?.url || "/Ravi_Kishan_Resume.pdf";
  const filename = resume?.filename || "Ravi_Kishan_Resume.pdf";

  const contacts = [
    { icon: Mail, label: identity.email, href: `mailto:${identity.email}` },
    { icon: Github, label: "Ravikisha", href: identity.github },
    { icon: Linkedin, label: "in/ravikisha", href: identity.linkedin },
    { icon: MapPin, label: identity.location, href: null },
  ];

  return (
    <>
      <Head>
        <title>Résumé — Ravi Kishan</title>
        <meta
          name="description"
          content="Ravi Kishan's résumé — software engineer in distributed systems, systems programming and applied AI."
        />
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>

      <main className="bg-bg font-sans text-fg antialiased">
        <PageHeader
          eyebrow="Résumé"
          title="The one-page"
          accent="version."
          subtitle={`Read it here, or take the PDF.${
            resume?.updated ? ` Updated ${resume.updated}.` : ""
          }`}
        >
          <div className="flex flex-wrap gap-3">
            <a
              href={url}
              download={filename}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-accentFg transition-transform hover:-translate-y-0.5"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </a>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-edge bg-surface px-5 py-3 text-sm font-semibold text-fg transition-colors hover:border-muted"
            >
              <ExternalLink className="h-4 w-4 text-muted" />
              Open PDF
            </a>
          </div>
        </PageHeader>

        {/* résumé document */}
        <section className="bg-bg py-16">
          <div className="mx-auto max-w-4xl px-6">
            <motion.article
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden rounded-2xl border border-edge bg-surface shadow-2xl shadow-black/10 dark:shadow-black/40"
            >
              {/* masthead */}
              <div className="relative border-b border-edge px-8 py-8 sm:px-10">
                <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-amber/10 blur-3xl" />
                <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
                      {identity.name}
                    </h2>
                    <p className="mt-1 font-mono text-sm text-accentText">
                      {identity.role} · {identity.focus?.join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {contacts.map((c) => {
                      const Icon = c.icon;
                      const inner = (
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted transition-colors hover:text-fg">
                          <Icon className="h-3.5 w-3.5 text-accentText" />
                          {c.label}
                        </span>
                      );
                      return c.href ? (
                        <a
                          key={c.label}
                          href={c.href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {inner}
                        </a>
                      ) : (
                        <span key={c.label}>{inner}</span>
                      );
                    })}
                  </div>
                </div>
                <p className="relative mt-6 max-w-3xl text-sm leading-relaxed text-muted">
                  {identity.intro}
                </p>
              </div>

              {/* body */}
              <div className="grid grid-cols-1 gap-x-10 gap-y-10 px-8 py-10 sm:px-10 lg:grid-cols-[1.6fr_1fr]">
                {/* main column */}
                <div className="space-y-10">
                  <Section>
                    <Eyebrow>Experience</Eyebrow>
                    <div className="space-y-7">
                      {experience.map((job) => (
                        <div key={job.org} className="flex gap-4">
                          <span
                            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-edge"
                            style={{ background: job.logoBg }}
                          >
                            <img
                              src={job.logo}
                              alt={job.org}
                              className="h-5 w-auto max-w-[70px] object-contain"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                              <h3 className="font-display text-base font-bold text-fg">
                                {job.title}
                                <span className="text-accentText"> · {job.org}</span>
                              </h3>
                              <span className="font-mono text-[11px] text-muted">
                                {job.period}
                              </span>
                            </div>
                            <ul className="mt-2 space-y-1.5">
                              {job.points.map((p, j) => (
                                <li
                                  key={j}
                                  className="flex gap-2 text-sm leading-relaxed text-muted"
                                >
                                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-live" />
                                  {p}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section delay={0.05}>
                    <Eyebrow>Selected work</Eyebrow>
                    <div className="space-y-4">
                      {(systems || []).slice(0, 4).map((s) => (
                        <a
                          key={s.name}
                          href={s.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group block"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <h3 className="font-display text-base font-bold text-fg group-hover:text-accentText">
                              {s.name}
                              <span className="ml-2 font-mono text-[11px] font-normal uppercase tracking-wider text-muted">
                                {s.kind}
                              </span>
                            </h3>
                            <span className="font-mono text-[11px] text-live">
                              {s.metric}
                            </span>
                          </div>
                          <p className="mt-1 text-sm leading-relaxed text-muted">
                            {s.blurb}
                          </p>
                        </a>
                      ))}
                    </div>
                  </Section>
                </div>

                {/* aside column */}
                <div className="space-y-10">
                  <Section delay={0.05}>
                    <Eyebrow>Education</Eyebrow>
                    <div className="space-y-4">
                      {education.map((e) => (
                        <div key={e.degree} className="flex gap-3">
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-edge"
                            style={{ background: e.logoBg }}
                          >
                            <img
                              src={e.logo}
                              alt={e.school}
                              className="h-6 w-6 object-contain"
                              onError={(ev) => {
                                ev.currentTarget.style.display = "none";
                              }}
                            />
                          </span>
                          <div>
                            <h3 className="font-display text-sm font-bold text-fg">
                              {e.school}
                            </h3>
                            <p className="text-xs text-muted">{e.degree}</p>
                            <p className="mt-1 font-mono text-[11px] text-accentText">
                              GPA {e.gpa}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section delay={0.1}>
                    <Eyebrow>Skills</Eyebrow>
                    <div className="space-y-3">
                      {skillGroups.map((g) => (
                        <div key={g.label}>
                          <p className="font-mono text-[11px] uppercase tracking-wider text-fg">
                            {g.label}
                          </p>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted">
                            {g.items}
                          </p>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section delay={0.15}>
                    <Eyebrow>Patent</Eyebrow>
                    <div className="rounded-lg border border-edge bg-bg p-4">
                      <div className="flex items-start gap-2">
                        <Award className="mt-0.5 h-4 w-4 shrink-0 text-accentText" />
                        <h3 className="font-display text-sm font-bold leading-snug text-fg">
                          {patent.title}
                        </h3>
                      </div>
                      <p className="mt-2 font-mono text-[11px] text-muted">
                        {patent.meta}
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-muted">
                        {patent.detail}
                      </p>
                    </div>
                  </Section>

                  <Section delay={0.2}>
                    <Eyebrow>Highlights</Eyebrow>
                    <ul className="space-y-2">
                      {credentials.map((c) => (
                        <li
                          key={c}
                          className="flex items-start gap-2 text-xs text-muted"
                        >
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                          {c}
                        </li>
                      ))}
                    </ul>
                  </Section>
                </div>
              </div>

              {/* footer strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-8 py-4 sm:px-10">
                <span className="font-mono text-[11px] text-muted">
                  {resume?.updated ? `Updated ${resume.updated}` : "Résumé"}
                </span>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accentText hover:underline"
                >
                  View the original PDF
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </motion.article>
          </div>
        </section>

        <ClosingCTA />
      </main>
    </>
  );
};

export default Resume;
