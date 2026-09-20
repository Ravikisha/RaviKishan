// Typography for rendered Markdown.
//
// Extracted from PostView because TWO places render post bodies: the live
// article, and the Write/Preview editor in the admin. Previously these styles
// lived only inside PostView's styled-jsx, so the admin's preview pane showed
// unstyled HTML — a preview that does not look like the page is worse than no
// preview at all.
//
// Both now render this component, so there is one definition of what a post
// looks like and the preview cannot drift from the article.
import React from "react";

export default function PostBodyStyles() {
  return (
    <style jsx global>{`
        .post-body {
          font-size: 1.0625rem;
          line-height: 1.78;
          width: 100%;
          max-width: none;
        }
        .post-body > * + * {
          margin-top: 1.15em;
        }
        .post-body h2,
        .post-body h3 {
          color: var(--c-fg);
          font-family: "Space Grotesk", sans-serif;
          letter-spacing: -0.022em;
          line-height: 1.22;
          scroll-margin-top: 90px;
        }
        .post-body h2 {
          font-size: 1.85rem;
          font-weight: 700;
          margin-top: 2.2em;
        }
        .post-body h3 {
          font-size: 1.24rem;
          font-weight: 600;
          margin-top: 1.9em;
        }
        .post-body p a {
          color: var(--c-fg);
          text-decoration: none;
          background-image: linear-gradient(var(--c-accent), var(--c-accent));
          background-repeat: no-repeat;
          background-position: 0 100%;
          background-size: 100% 2px;
          padding-bottom: 1px;
          transition: background-size 0.18s;
        }
        .post-body p a:hover {
          background-size: 100% 0.85em;
        }
        .post-body strong {
          font-weight: 650;
        }
        .post-body code {
          font-family: "JetBrains Mono", ui-monospace, monospace;
          font-size: 0.855em;
          background: var(--c-surface);
          border: 1px solid var(--c-edge);
          border-radius: 5px;
          padding: 1px 5px;
        }
        /* Break out: code gets the whole column, because it is the thing that
           actually needs the width. */
        .post-body pre {
          position: relative;
          background: #0a0b0f;
          color: #eceef3;
          border-radius: 14px;
          padding: 18px 20px;
          overflow-x: auto;
          font-size: 13px;
          line-height: 1.62;
          width: 100%;
        }
        @media (min-width: 1080px) {
          .post-body pre,
          .post-body img,
          .post-body table {
            width: calc(100% + 120px);
            max-width: none;
          }
        }
        .post-body pre code {
          background: none;
          border: none;
          padding: 0;
          font-size: inherit;
          color: inherit;
        }
        .post-body pre.has-copy {
          padding-top: 46px;
        }
        .post-body .code-copy {
          position: absolute;
          top: 12px;
          right: 12px;
          border: 1px solid #394050;
          border-radius: 6px;
          padding: 5px 9px;
          background: #151923;
          color: #c8ceda;
          font: 11px "JetBrains Mono", ui-monospace, monospace;
          cursor: pointer;
        }
        .post-body .code-copy:hover {
          border-color: var(--c-accent);
          color: var(--c-accent);
        }
        .post-body .code-language {
          position: absolute;
          top: 17px;
          left: 20px;
          color: #7d8496;
          font: 11px "JetBrains Mono", ui-monospace, monospace;
          text-transform: lowercase;
        }
        .post-body pre code .hljs-comment,
        .post-body pre code .hljs-quote {
          color: #7f9f73;
        }
        .post-body pre code .hljs-keyword,
        .post-body pre code .hljs-selector-tag,
        .post-body pre code .hljs-literal,
        .post-body pre code .hljs-type {
          color: #c792ea;
        }
        .post-body pre code .hljs-string,
        .post-body pre code .hljs-regexp,
        .post-body pre code .hljs-addition {
          color: #c3e88d;
        }
        .post-body pre code .hljs-number,
        .post-body pre code .hljs-symbol,
        .post-body pre code .hljs-bullet {
          color: #f78c6c;
        }
        .post-body pre code .hljs-title,
        .post-body pre code .hljs-section,
        .post-body pre code .hljs-function {
          color: #82aaff;
        }
        .post-body pre code .hljs-variable,
        .post-body pre code .hljs-attr,
        .post-body pre code .hljs-attribute {
          color: #ffcb6b;
        }
        .post-body pre code .hljs-built_in,
        .post-body pre code .hljs-name {
          color: #89ddff;
        }
        .post-body pre code .hljs-deletion {
          color: #f07178;
        }
        .post-body blockquote {
          margin-left: 0;
          padding: 2px 0 2px 20px;
          border-left: 3px solid var(--c-accent);
          color: var(--c-muted);
          font-size: 1.1em;
          line-height: 1.6;
        }
        .post-body ul,
        .post-body ol {
          padding-left: 1.25em;
        }
        .post-body ul { list-style: disc; }
        .post-body ol { list-style: decimal; }
        .post-body li + li { margin-top: 0.45em; }
        .post-body li::marker { color: var(--c-accent-text); }
        .post-body img {
          border-radius: 12px;
          border: 1px solid var(--c-edge);
          display: block;
        }
        .post-body hr {
          border: none;
          border-top: 1px solid var(--c-edge);
          margin: 2.4em 0;
        }
        .post-body table {
          border-collapse: collapse;
          font-size: 14px;
        }
        .post-body th,
        .post-body td {
          border: 1px solid var(--c-edge);
          padding: 9px 11px;
          text-align: left;
        }
        .post-body th {
          background: var(--c-surface);
          font-weight: 600;
        }
    `}</style>
  );
}
