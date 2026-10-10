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
import { orgParam } from "./orgState";

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
    // Name the org in the URL from the first paint. A bare /admin took it
    // from localStorage, which another tab can change; written here, a
    // refresh of THIS page reopens THIS org.
    const org = orgParam();
    const here = new URL(window.location.href);
    if (org && here.searchParams.get("org") !== org) {
      here.searchParams.set("org", org);
      window.history.replaceState(window.history.state, "", here.toString());
    }
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
    //
    // Except ?org=. The org is not the section's state, it is the whole
    // console's: dropping it on a tab switch would make the next refresh
    // reopen in whatever this browser last remembered rather than the org on
    // screen. orgParam() is the org this page loaded in — Relax included, so
    // no admin URL leaves its org to localStorage.
    const next = new URL(url.pathname, url.origin);
    if (view !== fallback) next.searchParams.set("tab", view);
    const org = orgParam();
    if (org) next.searchParams.set("org", org);
    window.history.pushState({}, "", next.toString());
  }, [view, synced, fallback]);

  return [view, setView];
}
