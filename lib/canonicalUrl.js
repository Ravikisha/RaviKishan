// The address to hand to the outside world.
//
// Never localhost, never a Vercel preview domain. A link copied for a
// recruiter, and an image URL embedded in a dev.to article, both have to point
// at the real site — a preview host is the kind of thing that works perfectly
// in testing and ships a dead link.
const CANONICAL = process.env.NEXT_PUBLIC_SITE_URL || "https://ravikishan.me";

export function canonicalOrigin() {
  if (typeof window === "undefined") return CANONICAL;
  return /ravikishan\.me$/.test(window.location.hostname) ? window.location.origin : CANONICAL;
}

export function absoluteUrl(pathOrUrl) {
  const s = String(pathOrUrl || "");
  if (/^https?:\/\//i.test(s)) return s;
  return canonicalOrigin() + (s.startsWith("/") ? s : `/${s}`);
}
