// The rendered article. Extracted so the post route and the design preview
// render byte-identical markup — a preview that drifts from the real page is
// worse than no preview.
import React, { useMemo, useRef } from "react";
import Link from "next/link";
import { marked } from "marked";
import Seo from "../Seo";
import ClosingCTA from "../home2/ClosingCTA";
import ArticleRail from "./ArticleRail";
import PostBodyStyles from "./PostBodyStyles";
import CopyLinkButton from "../home2/CopyLinkButton";
import { readingMinutes, excerptFrom } from "../../lib/posts";

const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d) ? "" : d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
};

// Deterministic per-tag tilt so a chip always leans the same way — random
// rotation on every render reads as noise rather than as a decision.
const tilt = (s) => {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ((h % 5) - 2) * 1.5;
};

export default function PostView({ post }) {
  const bodyRef = useRef(null);
  const html = useMemo(
    () => (post?.body ? marked.parse(post.body, { mangle: false, headerIds: true }) : ""),
    [post?.body]
  );

  const mins = post.readingTime || readingMinutes(post.body);
  const deck = post.excerpt || excerptFrom(post.body);

  return (
    <>
      <Seo
        title={`${post.title} — Ravi Kishan`}
        description={deck}
        path={`/blog/${post.slug}`}
        image={post.cover || undefined}
        type="article"
        canonical={post.source === "devto" ? post.canonicalUrl || post.devtoUrl : undefined}
      />

      <main className="post">
        <header className="post-head">
          <h1 className="post-title">{post.title}</h1>
          {deck && <p className="post-deck">{deck}</p>}

          <div className="post-meta">
            <time dateTime={post.publishedAt}>{fmtDate(post.publishedAt)}</time>
            <span className="post-rule" aria-hidden="true" />
            <span>{mins} min read</span>
            {post.devtoUrl && (
              <>
                <span className="post-rule" aria-hidden="true" />
                <a href={post.devtoUrl} target="_blank" rel="noreferrer">
                  {post.source === "devto" ? "first published on dev.to" : "also on dev.to"}
                </a>
              </>
            )}
          </div>

          {post.tags?.length > 0 && (
            <ul className="post-tags">
              {post.tags.map((t) => (
                <li key={t} style={{ "--tilt": `${tilt(t)}deg` }}>
                  <Link href={`/blog?tag=${encodeURIComponent(t)}`}>
                    <a>{t}</a>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </header>

        {post.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="post-cover" src={post.cover} alt="" />
        )}

        <div className="post-grid">
          <ArticleRail containerRef={bodyRef} />
          <article
            ref={bodyRef}
            className="post-body"
            // Authored by the single allow-listed admin through the CMS, so the
            // Markdown source is trusted input, not visitor-supplied content.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>

        <footer className="post-foot">
          <CopyLinkButton path={`/blog/${post.slug}`} label="Copy link to this post" />
          <Link href="/blog">
            <a className="post-back">All writing</a>
          </Link>
        </footer>

        <ClosingCTA />
      </main>

      <PostBodyStyles />

      <style jsx global>{`
        .post {
          background: var(--c-bg);
          color: var(--c-fg);
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        /* ---- masthead ---- */
        .post-head {
          max-width: 1180px;
          margin: 0 auto;
          padding: clamp(46px, 9vw, 96px) 24px 34px;
        }
        .post-title {
          /* globals.scss pins h1-h4 to a fixed light-theme colour; the blog
             uses the semantic token so dark mode is actually readable. */
          color: var(--c-fg);
          font-family: "Space Grotesk", sans-serif;
          font-weight: 700;
          font-size: clamp(2.5rem, 7.4vw, 5.4rem);
          line-height: 0.96;
          letter-spacing: -0.042em;
          margin: 0;
          max-width: 17ch;
          text-wrap: balance;
        }
        .post-deck {
          margin: 22px 0 0;
          font-size: clamp(1.05rem, 2vw, 1.3rem);
          line-height: 1.55;
          color: var(--c-muted);
          max-width: 48ch;
        }
        .post-meta {
          margin-top: 26px;
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
          font-size: 13px;
          color: var(--c-muted);
        }
        .post-meta a {
          color: var(--c-accent-text);
          text-decoration: none;
          border-bottom: 1px solid color-mix(in srgb, var(--c-accent) 45%, transparent);
        }
        /* A hairline instead of a middle dot — the dot-joined meta string is
           on every generated page on the internet. */
        .post-rule {
          width: 22px;
          height: 1px;
          background: var(--c-edge);
        }

        .post-tags {
          list-style: none;
          margin: 22px 0 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 9px;
        }
        .post-tags a {
          display: inline-block;
          transform: rotate(var(--tilt));
          padding: 5px 12px;
          border: 1px solid var(--c-edge);
          border-radius: 999px;
          background: var(--c-surface);
          color: var(--c-fg);
          font-size: 12.5px;
          font-weight: 500;
          text-decoration: none;
          transition: border-color 0.15s, transform 0.15s;
        }
        .post-tags a:hover {
          border-color: var(--c-accent);
          transform: rotate(0deg);
        }

        .post-cover {
          display: block;
          width: min(1180px, calc(100% - 48px));
          margin: 0 auto 10px;
          border-radius: 14px;
          border: 1px solid var(--c-edge);
        }

        /* ---- the asymmetric grid: rail + prose, artefacts break out ---- */
        .post-grid {
          max-width: 1180px;
          margin: 0 auto;
          padding: 24px 24px 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 0;
        }
        @media (min-width: 1080px) {
          .post-grid {
            grid-template-columns: 210px minmax(0, 1fr);
            gap: 48px;
          }
        }


        .post-foot {
          max-width: 1180px;
          margin: 0 auto;
          padding: 56px 24px 20px;
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
          border-top: 1px solid var(--c-edge);
          margin-top: 64px;
        }
        .post-back {
          color: var(--c-muted);
          font-size: 14px;
          font-weight: 500;
          text-decoration: none;
        }
        .post-back:hover {
          color: var(--c-fg);
        }
      `}</style>
    </>
  );
}
