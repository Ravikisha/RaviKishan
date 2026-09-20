// Provides site content to every page/component. Starts from the static
// defaults (so SSR + first client render match — no hydration mismatch), then
// once mounted it fetches the `site/content` doc from Firestore and, if it
// exists, swaps in the edited values. Any fetch error falls back silently to
// the defaults.
import { createContext, useContext, useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";
import { defaultContent, mergeContent } from "./siteContent";

const SiteContentContext = createContext(defaultContent);

export function SiteContentProvider({ children }) {
  const [content, setContent] = useState(defaultContent);

  useEffect(() => {
    let cancelled = false;

    // `?draft=1` renders the site from the unpublished draft instead of the
    // live document, so a change can be reviewed in place before publishing.
    // siteDrafts is admin-only in the rules, so for anyone else the read fails
    // and this quietly falls through to the live content — the preview flag is
    // not a way to leak an unpublished draft.
    const wantsDraft =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("draft") === "1";

    const live = () =>
      getDoc(doc(db, "site", "content")).then((snap) => {
        if (!cancelled && snap.exists()) setContent(mergeContent(snap.data()));
      });

    const load = wantsDraft
      ? getDoc(doc(db, "siteDrafts", "draft")).then((snap) => {
          if (cancelled) return undefined;
          if (snap.exists() && snap.data()?.content) {
            setContent(mergeContent(snap.data().content));
            return undefined;
          }
          return live();
        })
      : live();

    load.catch(() => {
      // draft not readable (not signed in) → fall back to what is published
      if (wantsDraft) live().catch(() => {});
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SiteContentContext.Provider value={content}>
      {children}
    </SiteContentContext.Provider>
  );
}

// Returns the merged content object. Destructure the sections you need:
//   const { systems, identity } = useSiteContent();
export function useSiteContent() {
  return useContext(SiteContentContext);
}
