// Resolving the image fields on projects and certificates.
//
// These fields predate any upload feature and hold BARE FILENAMES resolved
// against a folder in public/ — `image: "gitasaar.jpg"` renders as
// `/projects/gitasaar.jpg`, and `organization: "microsoft"` renders as
// `/company/microsoft.png`.
//
// Uploads cannot use that convention: Vercel's filesystem is read-only at
// runtime, so a new poster goes to object storage and comes back as
// `/api/media/…`. Rather than migrate 38 posters and 10 logos, these helpers
// accept BOTH shapes — anything that already looks like a path or a URL is
// used as-is, anything else keeps the legacy folder convention.
//
// That means old entries keep working untouched and new ones just work.

const isResolved = (v) => /^(https?:)?\/\//i.test(v) || String(v).startsWith("/");

const inFolder = (folder, v, ext = "") => {
  const s = String(v || "").trim();
  if (!s) return "";
  if (isResolved(s)) return s;
  return `${folder}/${s}${ext && !s.includes(".") ? ext : ""}`;
};

// Project poster — legacy: a filename in public/projects/
export const projectImage = (v) => inFolder("/projects", v);

// Certificate image — legacy: a filename in public/certificates/
export const certificateImage = (v) => inFolder("/certificates", v);

// Organisation logo — legacy: a SLUG, so the .png is appended when the value
// carries no extension of its own.
export const orgLogo = (v) => inFolder("/company", v, ".png");

// The logos bundled in public/company/. Offered in the admin picker alongside
// anything already uploaded, so the common case needs no upload at all.
export const BUNDLED_LOGOS = [
  "coursera",
  "github",
  "google",
  "hackerrank",
  "ibm",
  "langchain",
  "linkedin",
  "microsoft",
  "udemy",
];
