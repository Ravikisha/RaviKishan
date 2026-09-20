// Short links: ravikishan.me/l/<slug> → wherever you point it.
//
// Resolved in the browser from the public `links` collection, so this needs no
// server and no redeploy — add a slug in the admin and the URL works instantly.
// Click counts are incremented here; firestore.rules lets an anonymous visitor
// bump ONLY the clicks/lastClickAt fields, by exactly one, and nothing else.
import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { doc, getDoc, updateDoc, increment, serverTimestamp } from "firebase/firestore";
import { db } from "../../lib/firebase";
import Seo from "../../components/Seo";

export default function ShortLink() {
  const router = useRouter();
  const { slug } = router.query;
  const [state, setState] = useState("resolving");
  const [target, setTarget] = useState("");

  useEffect(() => {
    if (!slug || typeof slug !== "string") return;
    let cancelled = false;

    (async () => {
      try {
        const snap = await getDoc(doc(db, "links", slug.toLowerCase()));
        if (cancelled) return;
        if (!snap.exists() || snap.data().active === false) {
          setState("missing");
          return;
        }
        const url = snap.data().url;
        if (!/^https?:\/\//i.test(url || "")) {
          // Never hand the browser a javascript: or data: URL, whatever is in
          // the document.
          setState("missing");
          return;
        }
        setTarget(url);
        setState("going");

        // Fire-and-forget; a blocked or failed count must not delay the jump.
        updateDoc(doc(db, "links", slug.toLowerCase()), {
          clicks: increment(1),
          lastClickAt: serverTimestamp(),
        }).catch(() => {});

        window.location.replace(url);
      } catch (_) {
        if (!cancelled) setState("missing");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <>
      <Seo
        title="Redirecting…"
        description="Short link"
        path={`/l/${slug || ""}`}
        noindex
      />
      <main
        style={{
          minHeight: "70vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          textAlign: "center",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {state === "missing" ? (
          <div>
            <h1 style={{ fontSize: 22, marginBottom: 8 }}>Link not found</h1>
            <p style={{ opacity: 0.7, fontSize: 14 }}>
              This short link doesn&apos;t exist or has been turned off.
            </p>
            <p style={{ marginTop: 16 }}>
              <Link href="/">
                <a style={{ color: "#92600a", fontWeight: 600 }}>
                  Go to ravikishan.me →
                </a>
              </Link>
            </p>
          </div>
        ) : (
          <div>
            <p style={{ opacity: 0.7, fontSize: 14 }}>Redirecting…</p>
            {target && (
              <p style={{ marginTop: 12, fontSize: 13 }}>
                <a href={target} style={{ color: "#92600a" }}>
                  Continue manually
                </a>
              </p>
            )}
          </div>
        )}
      </main>
    </>
  );
}
