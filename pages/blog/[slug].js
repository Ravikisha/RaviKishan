// A post.
//
// Layout concept: the prose column is NOT centred. It sits right of a sticky
// contents rail, and code, images and pull quotes break OUT of the measure to
// the full column width. That asymmetry — narrow words, wide artefacts — is
// the page's signature, and it is functional: code is the thing you actually
// need horizontal room for in writing about systems.
//
// The title is the hero. No eyebrow above it, no kicker, no decoration: set
// very large in Space Grotesk with tight negative tracking and allowed to wrap
// to three lines. Tags sit under it as slightly rotated chips.
import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import Seo from "../../components/Seo";
import { excerptFrom } from "../../lib/posts";
import PostView from "../../components/blog/PostView";
import { track } from "../../lib/analytics";

export default function Post() {
  const router = useRouter();
  const { slug } = router.query;
  const [post, setPost] = useState(undefined);

  useEffect(() => {
    if (!slug || typeof slug !== "string") return;
    let cancelled = false;
    getDoc(doc(db, "posts", slug))
      .then((snap) => {
        if (cancelled) return;
        setPost(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        if (snap.exists()) track("blogView");
      })
      .catch(() => !cancelled && setPost(null));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (post === undefined) {
    return (
      <main className="post-wait">
        <span className="post-wait-dot" aria-hidden="true" />
        <p>Loading</p>
        <style jsx global>{`
          .post-wait {
            min-height: 60vh;
            display: grid;
            place-items: center;
            gap: 10px;
            color: var(--c-muted);
            font-family: Inter, sans-serif;
          }
          .post-wait-dot {
            width: 9px;
            height: 9px;
            border-radius: 50%;
            background: var(--c-accent);
            animation: pulse 1.1s ease-in-out infinite;
          }
          @keyframes pulse {
            0%, 100% { opacity: 0.25; }
            50% { opacity: 1; }
          }
          @media (prefers-reduced-motion: reduce) {
            .post-wait-dot { animation: none; }
          }
        `}</style>
      </main>
    );
  }

  if (!post) {
    return (
      <>
        <Seo title="Post not found" path={`/blog/${slug || ""}`} noindex />
        <main className="post-404">
          <h1>That post isn&apos;t here</h1>
          <p>It may have been unpublished, or the address may be mistyped.</p>
          <Link href="/blog">
            <a className="post-back">All writing</a>
          </Link>
          <style jsx global>{`
            .post-404 {
              min-height: 60vh;
              display: grid;
              place-content: center;
              gap: 10px;
              padding: 24px;
              text-align: center;
              font-family: Inter, sans-serif;
              color: var(--c-fg);
            }
            .post-404 h1 {
              font-family: "Space Grotesk", sans-serif;
              font-size: clamp(1.8rem, 5vw, 2.6rem);
              letter-spacing: -0.03em;
              margin: 0;
            }
            .post-404 p {
              color: var(--c-muted);
              margin: 0;
            }
            .post-back {
              justify-self: center;
              margin-top: 8px;
              color: var(--c-accent-text);
              font-weight: 600;
              text-decoration: underline;
              text-underline-offset: 4px;
            }
          `}</style>
        </main>
      </>
    );
  }

  return <PostView post={post} />;
}
