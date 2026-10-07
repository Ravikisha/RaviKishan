// The admin's open section, kept in the URL as ?tab=.
//
// A refresh lands where you were, Back steps through the sections you visited,
// and a link to a section opens it. The admin used to read ?tab= once on mount
// (for the PWA's home-screen shortcuts) and never write it, so every refresh
// dropped you on Content.
//
// Shared by pages/admin.js and /__adminpreview, so the preview's refresh test
// exercises the code the real admin runs.
import { useEffect, useState } from "react";

export default function useTabInUrl(tabs, fallback = "content") {
  const valid = (t) => !!t && tabs.some(([k]) => k === t);
  const [view, setView] = useState(fallback);
  // Until the URL has been read, `view` is the fallback, and writing it back
  // would erase the very ?tab= a refresh is trying to restore.
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const fromUrl = () => {
      const t = new URLSearchParams(window.location.search).get("tab");
      return valid(t) ? t : fallback;
    };
    setView(fromUrl());
    setSynced(true);
    const onPop = () => setView(fromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // Once: `tabs` is a module constant and the listener reads the URL itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!synced) return;
    const url = new URL(window.location.href);
    if ((url.searchParams.get("tab") || fallback) === view) return;
    // Any other parameter (an OAuth callback's result, ?source=pwa) belonged to
    // the section being left, so it does not travel to the next one.
    const next = new URL(url.pathname, url.origin);
    if (view !== fallback) next.searchParams.set("tab", view);
    window.history.pushState({}, "", next.toString());
  }, [view, synced, fallback]);

  return [view, setView];
}
