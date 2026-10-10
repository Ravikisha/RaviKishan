// BROWSER. The ONE authenticated fetch for this deployment's own /api routes.
//
// There used to be about fourteen private copies of "get the Firebase ID token,
// POST to /api/…": one per client module and several inline in panels. That
// was harmless while a request carried nothing but the bearer. It stopped being
// harmless with orgs: the server acts in whichever org the `x-org-id` header
// names, and a helper that forgets the header does not fail — it silently acts
// in Relax. One function means one place that can forget, and it does not.
//
// SAME-ORIGIN /api ONLY. The admin also talks straight to Google Tasks,
// Microsoft Graph and api.github.com, and those must never receive either
// header: our Firebase ID token is not theirs to see, and a custom header turns
// a simple request into a CORS preflight they refuse. `isOwnApi` is the gate,
// and it is checked on the resolved URL, so "//evil.example/api/x" is not ours.
import { auth } from "./firebase";
import { currentOrgId } from "./orgState";

export function isOwnApi(url) {
  if (typeof window === "undefined") return false;
  try {
    const u = new URL(String(url), window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith("/api/");
  } catch (_) {
    return false;
  }
}

// Headers for one of our own routes. `requireAuth: false` lets a caller that
// treats "signed out" as "nothing to show" ask anyway and handle the 401.
export async function adminHeaders(extra = {}, { requireAuth = true } = {}) {
  const headers = { ...extra, "x-org-id": currentOrgId() };
  const user = auth.currentUser;
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  else if (requireAuth) throw new Error("Not signed in.");
  return headers;
}

// fetch(), with our headers added when — and only when — the URL is ours.
export async function adminRequest(url, init = {}, opts = {}) {
  if (!isOwnApi(url)) return fetch(url, init);
  const headers = await adminHeaders(init.headers || {}, opts);
  return fetch(url, { ...init, headers });
}

// The common case: POST a JSON body, get JSON back, throw on a refusal.
// The thrown Error carries what the routes put beside the message — `code`,
// `provider`, `status` and the whole body as `data` — because several panels
// branch on them (a delete refusal lists the accounts in its way, a 409 names
// the org an account belongs to).
export async function adminJson(url, body, { method = "POST", requireAuth = true } = {}) {
  const init = { method, headers: {} };
  if (method !== "GET" && method !== "HEAD") {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body || {});
  }
  const res = await adminRequest(url, init, { requireAuth });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error || `HTTP ${res.status}`);
    e.code = json.code || "";
    e.provider = json.provider || "";
    e.status = res.status;
    e.data = json;
    throw e;
  }
  return json;
}
