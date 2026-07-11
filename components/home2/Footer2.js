import React from "react";
import Link from "next/link";
import { Github, Linkedin, Mail } from "lucide-react";
import { identity } from "../../lib/facts";

const cols = [
  {
    title: "Navigate",
    links: [
      { label: "Systems", href: "/#systems" },
      { label: "Projects", href: "/projects" },
      { label: "About", href: "/about" },
      { label: "Résumé", href: "/resume" },
    ],
  },
  {
    title: "Connect",
    links: [
      { label: "GitHub", href: identity.github, ext: true },
      { label: "LinkedIn", href: identity.linkedin, ext: true },
      { label: "Email", href: `mailto:${identity.email}`, ext: true },
    ],
  },
];

const Footer2 = () => {
  return (
    <footer className="border-t border-edge bg-bg">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2 font-mono text-sm font-semibold text-fg">
              <span className="grid h-8 w-8 place-items-center rounded-md border border-edge bg-surface text-accentText">
                RK
              </span>
              ravikishan<span className="text-accentText">.me</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              {identity.role} — distributed systems, systems programming &amp;
              applied AI. Building infrastructure from first principles.
            </p>
            <div className="mt-5 flex gap-2">
              <IconLink href={identity.github} label="GitHub">
                <Github className="h-4 w-4" />
              </IconLink>
              <IconLink href={identity.linkedin} label="LinkedIn">
                <Linkedin className="h-4 w-4" />
              </IconLink>
              <IconLink href={`mailto:${identity.email}`} label="Email">
                <Mail className="h-4 w-4" />
              </IconLink>
            </div>
          </div>

          {cols.map((c) => (
            <div key={c.title}>
              <h4 className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
                {c.title}
              </h4>
              <ul className="mt-4 space-y-2.5">
                {c.links.map((l) =>
                  l.ext ? (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted transition-colors hover:text-accentText"
                      >
                        {l.label}
                      </a>
                    </li>
                  ) : (
                    <li key={l.label}>
                      <Link href={l.href}>
                        <a className="text-sm text-muted transition-colors hover:text-accentText">
                          {l.label}
                        </a>
                      </Link>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-edge pt-6 font-mono text-xs text-muted sm:flex-row sm:items-center">
          <span>© {identity.name} · {identity.location}</span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-live shadow-[0_0_8px_#4ED0C0]" />
            built from first principles
          </span>
        </div>
      </div>
    </footer>
  );
};

const IconLink = ({ href, label, children }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={label}
    className="rounded-lg border border-edge bg-surface p-2.5 text-muted transition-colors hover:border-amber/50 hover:text-accentText"
  >
    {children}
  </a>
);

export default Footer2;
