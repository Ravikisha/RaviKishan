import React from "react";
import Seo from "../Seo";
import PageHeader from "../home2/PageHeader";

// Shared shell for /privacy and /terms.
//
// Two pages, one stylesheet — the same reason PostBodyStyles and EditorStyles
// are shared rather than inlined twice. These are also the two pages a Google
// OAuth reviewer opens, so they must not drift apart in tone or in date.
//
// globals.scss pins h1-h4 to a fixed light-theme colour, which beats
// inheritance. Every heading here therefore carries an explicit token class,
// or it disappears on a dark background.
const LegalPage = ({ title, accent, subtitle, path, description, updated, children }) => (
  <>
    <Seo title={`${title} ${accent} — Ravi Kishan`} description={description} path={path} />

    <main className="bg-bg font-sans text-fg antialiased">
      <PageHeader eyebrow="Legal" title={title} accent={accent} subtitle={subtitle} />

      <section className="bg-bg py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-6">
          <p className="mb-12 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            Last updated {updated}
          </p>
          <div className="legal-body">{children}</div>
        </div>
      </section>
    </main>

    <style jsx global>{`
      /* Held to a readable measure. The page is prose and nothing else, so
         the only job here is line length and vertical rhythm. */
      .legal-body {
        max-width: 68ch;
      }
      .legal-body h2 {
        color: var(--c-fg);
        font-family: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
        font-size: 1.35rem;
        font-weight: 700;
        letter-spacing: -0.01em;
        margin: 3rem 0 0.9rem;
        padding-top: 2rem;
        border-top: 1px solid var(--c-edge);
      }
      .legal-body h2:first-child {
        margin-top: 0;
        padding-top: 0;
        border-top: 0;
      }
      .legal-body h3 {
        color: var(--c-fg);
        font-size: 1rem;
        font-weight: 650;
        margin: 1.9rem 0 0.6rem;
      }
      .legal-body p,
      .legal-body li {
        color: var(--c-muted);
        font-size: 0.975rem;
        line-height: 1.75;
      }
      .legal-body p {
        margin: 0 0 1.05rem;
      }
      .legal-body ul {
        margin: 0 0 1.05rem;
        padding-left: 1.1rem;
        list-style: none;
      }
      .legal-body li {
        position: relative;
        margin: 0 0 0.5rem;
        padding-left: 0.9rem;
      }
      .legal-body li::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0.72em;
        width: 5px;
        height: 1px;
        background: var(--c-accent);
      }
      .legal-body strong {
        color: var(--c-fg);
        font-weight: 650;
      }
      .legal-body a {
        color: var(--c-accent-text);
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      .legal-body code {
        font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
        font-size: 0.85em;
        color: var(--c-fg);
        background: var(--c-surface);
        border: 1px solid var(--c-edge);
        border-radius: 4px;
        padding: 0.1em 0.4em;
      }
      /* The Limited Use declaration Google's reviewer looks for. Set apart so
         it is findable on a page skim rather than buried in a paragraph. */
      .legal-callout {
        border: 1px solid var(--c-edge);
        border-left: 2px solid var(--c-accent);
        background: var(--c-surface);
        border-radius: 0 10px 10px 0;
        padding: 1.1rem 1.25rem;
        margin: 1.5rem 0 1.75rem;
      }
      .legal-callout p:last-child {
        margin-bottom: 0;
      }
    `}</style>
  </>
);

export default LegalPage;
