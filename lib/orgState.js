// BROWSER. Which organisation the admin is acting in.
//
// Every connection, default, person and saved sign-in now belongs to an org,
// and the server decides which org a request acts in from ONE header,
// `x-org-id`, that lib/adminFetch.js adds to every same-origin /api call. This
// module is the single place that header's value comes from.
//
// Where the org is read from, in order:
//
//   ?org=          a link, a refresh, and — the one that matters — the OAuth
//                  callback, which appends &org=<id> so a consent started in
//                  Acme lands back in Acme rather than in whatever this browser
//                  last remembered.
//   localStorage   rk-org, so opening a BARE /admin reopens the last org —
//                  and useTabInUrl then writes it into the URL, so every
//                  admin URL names its org and a refresh never asks storage.
//   relax          the default org, which always exists.
//
// It is read ONCE per page load and then held. useTabInUrl rewrites the URL
// when the section changes, and an org that silently changed under a panel
// mid-session is exactly the failure orgs exist to prevent.
//
// Switching orgs RELOADS the admin (setOrg). Module-level token caches
// (lib/taskProviders.js, lib/github.js), the account each panel has selected,
// and half-loaded panel state all belong to the org being left. A reload is the
// one way to guarantee none of it survives into the next org — clearing them
// by hand is a list somebody forgets to extend.
import { DEFAULT_ORG, isOrgId } from "./server/orgShape";

export { DEFAULT_ORG };

const KEY = "rk-org";
let held = "";

const fromUrl = () => {
  try {
    const v = new URLSearchParams(window.location.search).get("org");
    return isOrgId(v) ? v : "";
  } catch (_) {
    return "";
  }
};

const fromStore = () => {
  try {
    const v = window.localStorage.getItem(KEY);
    return isOrgId(v) ? v : "";
  } catch (_) {
    return "";
  }
};

const remember = (id) => {
  try {
    if (id === DEFAULT_ORG) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, id);
  } catch (_) {
    /* private window, blocked storage: the URL still carries it */
  }
};

// The org this page acts in. On the server (prerender) there is no window and
// no request to act for, so it is the default.
export function currentOrgId() {
  if (typeof window === "undefined") return DEFAULT_ORG;
  if (held) return held;
  const url = fromUrl();
  held = url || fromStore() || DEFAULT_ORG;
  // An org that arrived in the URL is remembered, so the callback's &org= also
  // decides where the NEXT plain /admin opens.
  if (url) remember(url);
  return held;
}

// Switch org: remember it, then reload the admin at the same section.
export function setOrg(id) {
  if (!isOrgId(id) || typeof window === "undefined") return;
  remember(id);
  const here = new URL(window.location.href);
  const next = new URL(here.pathname, here.origin);
  const tab = here.searchParams.get("tab");
  if (tab) next.searchParams.set("tab", tab);
  // Explicit for EVERY org, Relax included. A Relax URL that carried no org
  // was not self-describing: a refresh (or a Back that missed the bfcache)
  // fell through to localStorage, which another tab may have switched to
  // Acme — and the panels then acted as Acme under a page the user knew as
  // Relax. localStorage now only decides a bare /admin (the PWA start_url).
  next.searchParams.set("org", id);
  window.location.assign(next.toString());
}

// For useTabInUrl: the org parameter every admin URL carries — always set,
// including for Relax (see setOrg).
export function orgParam() {
  return currentOrgId();
}

// Per-org localStorage keys. A remembered GA property or LinkedIn account is a
// choice made INSIDE one org; carried into another it would preselect an
// account that org cannot use.
export const orgKey = (base) => {
  const id = currentOrgId();
  return id === DEFAULT_ORG ? base : `${base}__${id}`;
};
