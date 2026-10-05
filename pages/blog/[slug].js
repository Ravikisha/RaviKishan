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
import { excerptFrom, fetchPublishedPosts, toListItem } from "../../lib/posts";
import PostView from "../../components/blog/PostView";
import { track } from "../../lib/analytics";
import {
  fetchPublishedPostServer,
  fetchPublishedPostsServer,
} from "../../lib/server/publicPosts";

export default function Post({ initialPost = null }) {
  const router = useRouter();
  const { slug } = router.query;
  // Prerendered when the post is published, so the HTML a crawler or an
  // unfurler receives already carries the real title, description, canonical
  // and article text. A draft has no prerender — rules keep it private — so it
  // falls back to the client fetch below, which runs as the signed-in admin.
  const [post, setPost] = useState(initialPost || undefined);
  const [neighbors, setNeighbors] = useState({ previous: null, next: null, related: [] });

  // Start every article at the beginning.
  //
  // Next scrolls to the top on a route change, but this page's height changes
  // twice afterwards — the client fetch swaps the body in, then the diagrams
  // and maths render — and the browser restores the scroll it had before.
  // Clicking "Previous" from the foot of a long post landed 3,199px into the
  // next one, which reads as a broken link rather than a new article.
  useEffect(() => {
    if (!slug || typeof slug !== "string") return;
    // An anchored link (/blog/x#section) is asking for a specific place.
    if (typeof window !== "undefined" && !window.location.hash) {
      window.scrollTo(0, 0);
    }
  }, [slug]);

  useEffect(() => {
    if (!slug || typeof slug !== "string") return;
    let cancelled = false;
    getDoc(doc(db, "posts", slug))
      .then((snap) => {
        if (cancelled) return;
        setPost(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        if (snap.exists()) track("blogView");
      })
      // Keep whatever was prerendered rather than replacing a good article
      // with a not-found page because one request failed.
      .catch(() => !cancelled && setPost((cur) => cur ?? null));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!slug || typeof slug !== "string") return undefined;
    let cancelled = false;
    fetchPublishedPosts()
      .then((rows) => {
        if (cancelled) return;
        const list = rows
          .map(toListItem)
          .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
        const index = list.findIndex((item) => item.url === `/blog/${slug}`);
        const current = index >= 0 ? list[index] : null;
        setNeighbors({
          previous: index > 0 ? list[index - 1] : null,
          next: index >= 0 && index < list.length - 1 ? list[index + 1] : null,
          related: current
            ? list.filter((item) => item.url !== current.url && (item.tags || []).some((t) => (current.tags || []).includes(t))).slice(0, 3)
            : [],
        });
      })
      .catch(() => {});
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

  return (
    <>
      {/* A draft is readable here only because firestore.rules lets the admin
          read one; a signed-out visitor gets the not-found page above. Say so
          plainly, so a preview is never mistaken for the published article. */}
      {!post.published && (
        <div className="post-draft">
          <strong>Draft.</strong> Only you can see this — it is not on /blog and
          search engines are told to skip it.
          <style jsx global>{`
            .post-draft {
              position: sticky;
              top: 0;
              z-index: 40;
              padding: 10px 24px;
              background: var(--c-accent);
              color: #1a1300;
              font: 500 13.5px Inter, sans-serif;
              text-align: center;
            }
            .post-draft strong {
              font-weight: 700;
            }
          `}</style>
        </div>
      )}
      <PostView post={post} {...neighbors} />
    </>
  );
}

// Every published post is prerendered at build time, and anything published
// afterwards is rendered on first request and then cached — so a new post is
// shareable the moment it goes live without waiting for a deploy.
export async function getStaticPaths() {
  try {
    const posts = await fetchPublishedPostsServer();
    return {
      paths: posts.map((p) => ({ params: { slug: p.slug } })),
      fallback: "blocking",
    };
  } catch (_) {
    // A build must not fail because Firestore was briefly unreachable; every
    // path can still be rendered on demand.
    return { paths: [], fallback: "blocking" };
  }
}

export async function getStaticProps({ params }) {
  let initialPost = null;
  try {
    initialPost = await fetchPublishedPostServer(params?.slug);
  } catch (_) {
    initialPost = null;
  }
  // Deliberately NOT notFound: an unpublished post is invisible to this
  // credential-free read, and 404ing here would break previewing a draft.
  return { props: { initialPost }, revalidate: 300 };
}
