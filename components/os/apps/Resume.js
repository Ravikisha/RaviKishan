import React from "react";
import {
  Download,
  ExternalLink,
  Mail,
  Github,
  Linkedin,
  MapPin,
  Award,
} from "lucide-react";
import { useSiteContent } from "../../../lib/useSiteContent";

// Résumé, rendered as a desktop app (window body). Same document the old
// /resume page showed — sourced from lib/facts via useSiteContent — but framed
// as a scrollable window with a sticky PDF toolbar instead of a routed page.
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

export default function Resume() {
  const { resume, identity, experience, education, systems, credentials, patents } =
    useSiteContent();
  const url = resume?.url || "/Ravi_Kishan_Resume.pdf";
  const filename = resume?.filename || "Ravi_Kishan_Resume.pdf";
  const pub = (patents && patents[0]) || null;

  const contacts = [
    { icon: Mail, label: identity.email, href: `mailto:${identity.email}` },
    { icon: Github, label: "Ravikisha", href: identity.github },
    { icon: Linkedin, label: "in/ravikisha", href: identity.linkedin },
    { icon: MapPin, label: identity.location, href: null },
  ];

  return (
    <div className="min-h-full bg-bg font-sans text-fg antialiased">
      {/* toolbar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-edge bg-surface/95 px-5 py-3 backdrop-blur">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accentText">
            Résumé
          </p>
          <p className="truncate text-xs text-muted">
            {resume?.updated ? `Updated ${resume.updated}` : "The one-page version"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={url}
            download={filename}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accentFg transition-transform hover:-translate-y-0.5"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </a>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-semibold text-fg transition-colors hover:border-muted"
          >
            <ExternalLink className="h-4 w-4 text-muted" />
            Open PDF
          </a>
        </div>
      </div>

      {/* résumé document */}
      <div className="px-5 py-6 sm:px-8">
        <article className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-edge bg-surface shadow-xl shadow-black/10 dark:shadow-black/40">
          {/* masthead */}
          <div className="relative border-b border-edge px-6 py-7 sm:px-8">
            <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-amber/10 blur-3xl" />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-display text-3xl font-bold tracking-tight text-fg">
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
                    <a key={c.label} href={c.href} target="_blank" rel="noopener noreferrer">
                      {inner}
                    </a>
                  ) : (
                    <span key={c.label}>{inner}</span>
                  );
                })}
              </div>
            </div>
            <p className="relative mt-5 max-w-3xl text-sm leading-relaxed text-muted">
              {identity.intro}
            </p>
          </div>

          {/* body */}
          <div className="grid grid-cols-1 gap-x-10 gap-y-10 px-6 py-8 sm:px-8 lg:grid-cols-[1.6fr_1fr]">
            {/* main column */}
            <div className="space-y-10">
              <div>
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
              </div>

              <div>
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
                        <span className="font-mono text-[11px] text-live">{s.metric}</span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{s.blurb}</p>
                    </a>
                  ))}
                </div>
              </div>
            </div>

            {/* aside column */}
            <div className="space-y-10">
              <div>
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
                        <h3 className="font-display text-sm font-bold text-fg">{e.school}</h3>
                        <p className="text-xs text-muted">{e.degree}</p>
                        <p className="mt-1 font-mono text-[11px] text-accentText">GPA {e.gpa}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Eyebrow>Skills</Eyebrow>
                <div className="space-y-3">
                  {skillGroups.map((g) => (
                    <div key={g.label}>
                      <p className="font-mono text-[11px] uppercase tracking-wider text-fg">
                        {g.label}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted">{g.items}</p>
                    </div>
                  ))}
                </div>
              </div>

              {pub && (
                <div>
                  <Eyebrow>Patent</Eyebrow>
                  <div className="rounded-lg border border-edge bg-bg p-4">
                    <div className="flex items-start gap-2">
                      <Award className="mt-0.5 h-4 w-4 shrink-0 text-accentText" />
                      <h3 className="font-display text-sm font-bold leading-snug text-fg">
                        {pub.title}
                      </h3>
                    </div>
                    <p className="mt-2 font-mono text-[11px] text-muted">
                      {[pub.type, pub.status && `(${pub.status})`, pub.number]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-muted">{pub.abstract}</p>
                  </div>
                </div>
              )}

              <div>
                <Eyebrow>Highlights</Eyebrow>
                <ul className="space-y-2">
                  {credentials.map((c) => (
                    <li key={c} className="flex items-start gap-2 text-xs text-muted">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* footer strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-6 py-4 sm:px-8">
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
        </article>
      </div>
    </div>
  );
}
