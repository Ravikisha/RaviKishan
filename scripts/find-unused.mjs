/* Finds files nothing references.
 *
 *   node scripts/find-unused.mjs
 *
 * Deleting by intuition in a codebase this size is how you remove the one
 * image the résumé page needed. This walks the actual source and reports what
 * is unreferenced, with the evidence, so the decision is made on facts.
 *
 * It is a REPORT, not a deleter. Read it, then remove what you agree with.
 *
 * Caveats it cannot see through (so it says so rather than pretending):
 *   - strings built at runtime, e.g. `"/projects/" + p.image`
 *   - assets named in Firestore content rather than in the repo
 * Both are handled by seeding the reference set from the data files too.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", ".e2e-chrome-profile", "out", ".vercel",
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const all = walk(root);
const rel = (p) => path.relative(root, p).split(path.sep).join("/");

// Every source file's text, concatenated once — the haystack.
const SOURCE_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".json", ".scss", ".css", ".md", ".html", ".yml", ".mjs"]);
// public/ is excluded as a SOURCE of imports, but its manifests and configs
// DO reference assets (manifest.json names every PWA icon), so they must be in
// the haystack or those icons look orphaned.
const sources = all.filter((p) => {
  const r = rel(p);
  if (!SOURCE_EXT.has(path.extname(p).toLowerCase())) return false;
  if (!r.startsWith("public/")) return true;
  return /\.(json|webmanifest|xml|txt)$/.test(r);
});
const haystack = sources.map((p) => fs.readFileSync(p, "utf8")).join("\n");

const mentions = (needle) => haystack.includes(needle);

/* ---------- 1. code files nothing imports ---------- */

// Pages are entry points; so is anything Next or the tooling loads by name.
const ENTRY = /^(pages\/|scripts\/|\.github\/|next\.config|next-sitemap|postcss|tailwind|\.eslintrc)/;

const codeFiles = all.filter((p) => {
  const r = rel(p);
  if (!/\.(js|jsx|mjs)$/.test(r)) return false;
  if (r.startsWith("public/")) return false;
  return !ENTRY.test(r);
});

const unusedCode = [];
for (const p of codeFiles) {
  const r = rel(p);
  const base = path.basename(r).replace(/\.(js|jsx|mjs)$/, "");
  const dirName = path.basename(path.dirname(r));
  // An import may be written "./Foo", "../admin/Foo", or "./Foo.js" — so the
  // character after the basename can be a quote, a slash, OR the dot before
  // an explicit extension. Missing that dot made every explicitly-extended
  // import look unreferenced.
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importish = new RegExp(`["'./][^"']*${esc}["'/.]`);
  const referenced = sources.some((s) => {
    if (s === p) return false;
    const text = fs.readFileSync(s, "utf8");
    return importish.test(text);
  });
  if (!referenced) unusedCode.push({ file: r, hint: base === "index" ? `imported as ${dirName}/` : "" });
}

/* ---------- 2. public assets nothing mentions ---------- */

// Assets referenced by BARE FILENAME in the data files (projects, certs) are
// resolved at runtime, so the data counts as a reference.
const publicFiles = all.filter((p) => rel(p).startsWith("public/"));
const GENERATED = /^public\/(sw\.js|workbox-.*\.js|sitemap.*\.xml|robots\.txt|fallback-.*\.js)$/;

const unusedAssets = [];
let unusedBytes = 0;
for (const p of publicFiles) {
  const r = rel(p);
  if (GENERATED.test(r)) continue;
  const base = path.basename(r);
  const noExt = base.replace(/\.[^.]+$/, "");
  // Match the filename, the path without `public`, or the bare stem (covers
  // `organization: "microsoft"` → /company/microsoft.png).
  if (mentions(base) || mentions(r.replace(/^public/, "")) || mentions(`"${noExt}"`)) continue;
  const size = fs.statSync(p).size;
  unusedAssets.push({ file: r, kb: Math.round(size / 1024) });
  unusedBytes += size;
}

/* ---------- 3. dependencies nothing imports ---------- */

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const unusedDeps = Object.keys(pkg.dependencies || {}).filter((d) => {
  if (d === "mine2") return true; // self-reference
  return !new RegExp(`["']${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(["'/])`).test(haystack);
});

/* ---------- report ---------- */

const show = (title, rows, fmt) => {
  console.log(`\n${title}  (${rows.length})`);
  if (!rows.length) return console.log("  nothing");
  rows.forEach((r) => console.log("  " + fmt(r)));
};

console.log(`scanned ${all.length} files`);
show("Code files nothing imports", unusedCode, (r) => `${r.file}${r.hint ? `   ${r.hint}` : ""}`);
show(
  `Public assets nothing mentions — ${Math.round(unusedBytes / 1024)} KB`,
  unusedAssets.sort((a, b) => b.kb - a.kb),
  (r) => `${String(r.kb).padStart(5)} KB  ${r.file}`
);
show("Dependencies nothing imports", unusedDeps.map((d) => ({ d })), (r) => r.d);

console.log(
  "\nThis is a report. Runtime-built strings can hide a reference, so skim\n" +
    "before deleting — and `git checkout --` brings any tracked file back."
);
