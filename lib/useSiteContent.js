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
    getDoc(doc(db, "site", "content"))
      .then((snap) => {
        if (!cancelled && snap.exists()) {
          setContent(mergeContent(snap.data()));
        }
      })
      .catch(() => {
        /* offline / permission / not-configured → keep defaults */
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
