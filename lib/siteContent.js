// The full editable content model for the site, assembled from the existing
// static sources. These act as the DEFAULT / seed values: the site renders
// from these until (and unless) a `site/content` document exists in Firestore,
// so the public site can never go blank because of the CMS.
//
// The admin editor (pages/admin.js) reads/writes exactly this shape.
import * as facts from "./facts";
import { data as projects } from "../components/data_projects";
import { data as languages } from "../components/data_pl";
import { data as certificates } from "../components/data_cert";

// Projects: array order = display order on /projects (admin drag order wins,
// seeded by legacy `rank`). The homepage "Featured Projects" shows the ones with
// `featured: true` (first 6). Every project is normalized to carry a `featured`
// boolean so the admin editor always renders its Featured toggle.
const orderedProjects = [...projects]
  .sort((a, b) => (a.rank || 99) - (b.rank || 99))
  .map((p) => ({ featured: !!p.featured, ...p }));

export const defaultContent = {
  // --- homepage (lib/facts.js) ---
  identity: facts.identity,
  github: facts.github, // stars / repos / followers counts
  buildLog: facts.buildLog,
  stats: facts.stats,
  chips: facts.chips,
  systems: facts.systems, // the curated GitHub-repo "systems built" cards
  education: facts.education,
  experience: facts.experience,
  marquee: facts.marquee,
  credentials: facts.credentials,
  resume: facts.resume, // /resume page — PDF link (admin-editable)
  patents: facts.patents, // Publications section — patents & papers

  // --- projects (drives /projects AND homepage Featured Projects top-6) ---
  projects: orderedProjects,
  languages, // /skills programming-language badges (components/data_pl.js)
  certificates, // certificate section (components/data_cert.js)
};

// Order + friendly labels for the admin editor. Keys not listed here still
// render (appended), but this drives grouping and titles.
export const sectionMeta = [
  { key: "identity", label: "Identity / Hero" },
  { key: "github", label: "GitHub counts (stars / repos / followers)" },
  { key: "stats", label: "Stat strip" },
  { key: "chips", label: "Portrait proof chips" },
  { key: "buildLog", label: "Hero build-log terminal" },
  { key: "systems", label: "Systems built (GitHub repo cards)" },
  { key: "experience", label: "Experience timeline" },
  { key: "education", label: "Education" },
  { key: "credentials", label: "Highlights / credentials" },
  { key: "patents", label: "Publications (patents & papers)" },
  { key: "resume", label: "Résumé (PDF link)" },
  { key: "marquee", label: "Skills marquee" },
  {
    key: "projects",
    label: "Projects (toggle ‘Featured’ → shows on homepage · first 6 starred)",
  },
  { key: "languages", label: "Skills page — languages & tools" },
  { key: "certificates", label: "Certificates" },
];

// Shallow top-level merge: each section present in Firestore replaces the whole
// default section (the admin always saves complete sections). Missing sections
// fall back to defaults. Returns a fresh object; never mutates the default.
export function mergeContent(remote) {
  if (!remote || typeof remote !== "object") return { ...defaultContent };
  return { ...defaultContent, ...remote };
}
