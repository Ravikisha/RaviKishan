// Résumé access is mode-aware.
//   recruiter mode — the clean view hides all desktop-OS chrome (incl. the
//                    Résumé app), so we navigate to the routed /resume page.
//   dev / playground mode — open the Résumé as a desktop-OS window.
// Mode is stored on <html data-mode> by components/RecruiterMode.js.
export function isRecruiterMode() {
  return (
    typeof document !== "undefined" &&
    document.documentElement.dataset.mode === "recruiter"
  );
}

// Generic: recruiter mode → navigate to the routed page; dev mode → open the
// desktop-OS app. `id` is the app id (apps.js), `route` the recruiter-mode path.
export function openAppOrRoute(id, route, router) {
  if (isRecruiterMode()) {
    if (router && typeof router.push === "function") router.push(route);
    else if (typeof window !== "undefined") window.location.href = route;
  } else if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("os:open", { detail: id }));
  }
}

export function openResume(router) {
  openAppOrRoute("resume", "/resume", router);
}
