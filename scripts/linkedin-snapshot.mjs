// Turn the LinkedIn data export into something the deployed app can read.
//
// WHY THIS EXISTS
// ---------------
// LinkedIn's self-serve API returns a name, an address and a photo. It does
// not return the headline, the About text, positions, skills or the number of
// connections — r_fullprofile is partner-only, and there is no replacement.
// So the only place that data exists is the export LinkedIn emails you, which
// lives in `linkedin/` OUTSIDE the Next.js app and is not deployed.
//
// This takes a snapshot, the same shape of solution as scripts/sync-metrics.mjs
// → lib/metrics.json: a committed JSON file the app imports, refreshed by
// running this when a new export arrives.
//
// WHAT IT DELIBERATELY DOES NOT COPY
// ----------------------------------
// Connections.csv holds 1,148 real people — names, addresses, employers. That
// is other people's personal data and it belongs in the admin-only `contacts`
// collection (see the Contacts tab), never in a file that ships to the browser.
// Only the COUNT travels. Same for e-mail addresses and phone numbers: skipped
// entirely.
//
//   node scripts/linkedin-snapshot.mjs [--dir ../../linkedin] [--dry-run]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY = args.includes("--dry-run");

// The export sits beside the Next.js app in the presence hub, not inside it —
// and this script also runs from a git worktree several levels deeper, where a
// fixed relative path points at nothing. So the directory is FOUND by walking
// up until a folder named `linkedin` with a Profile.csv in it appears.
function findExport(start) {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "linkedin", "Profile.csv");
    if (fs.existsSync(candidate)) return path.dirname(candidate);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.resolve(start, "..", "linkedin");
}

const given = flag("--dir", "");
const DIR = given ? path.resolve(process.cwd(), given) : findExport(path.resolve(here, ".."));
// A .js module rather than .json on purpose: lib/server is loaded BOTH by
// Next's webpack and by plain node (that is what makes the MCP registry
// unit-testable), and a JSON import needs an import assertion in one and must
// not have it in the other. A module sidesteps the whole problem.
const OUT = path.resolve(here, "..", "lib", "linkedinProfile.js");

/* ---------------- a CSV reader for exactly this shape ---------------- */

// Hand-rolled rather than a dependency: LinkedIn's export is RFC 4180 with
// quoted fields, embedded commas and embedded newlines, and that is the whole
// grammar. The same reasoning as the Connections parser in the Contacts tab.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Some of LinkedIn's files open with a "Notes:" preamble before the real
// header, so the header row is FOUND rather than assumed to be row 0 — the
// same trap the Connections importer already hit.
function readTable(file, expect) {
  const full = path.join(DIR, file);
  if (!fs.existsSync(full)) return [];
  const rows = parseCsv(fs.readFileSync(full, "utf8"));
  const headerAt = rows.findIndex((r) => expect.every((k) => r.includes(k)));
  if (headerAt < 0) return [];
  const header = rows[headerAt].map((h) => h.trim());
  return rows.slice(headerAt + 1).map((r) => {
    const o = {};
    header.forEach((h, i) => {
      o[h] = (r[i] || "").trim();
    });
    return o;
  });
}

const countRows = (file, expect) => readTable(file, expect).length;

/* ---------------- the snapshot ---------------- */

const profile = readTable("Profile.csv", ["First Name", "Headline"])[0] || {};
const positions = readTable("Positions.csv", ["Company Name", "Title"]).map((p) => ({
  company: p["Company Name"],
  title: p.Title,
  location: p.Location,
  from: p["Started On"],
  to: p["Finished On"] || "",
}));
const education = readTable("Education.csv", ["School Name"]).map((e) => ({
  school: e["School Name"],
  degree: e["Degree Name"] || "",
  from: e["Start Date"] || "",
  to: e["End Date"] || "",
}));
const patents = readTable("Patents.csv", ["Title", "Issuer"]).map((p) => ({
  title: p.Title,
  issuer: p.Issuer,
  number: p["Patent Number"] || p["Application Number"] || "",
  filedOn: p["Filed On"] || "",
  url: p.Url || "",
}));
// Skills are a flat list and the only interesting thing about 100 of them is
// how many there are, plus the first few as a sample of the voice.
const skills = readTable("Skills.csv", ["Name"]).map((s) => s.Name).filter(Boolean);

const snapshot = {
  // When the export was taken, read from the file itself rather than from
  // "now" — a snapshot that claims to be fresh when the export is three
  // months old is worse than one that says how old it is.
  exportedAt: fs.existsSync(path.join(DIR, "Profile.csv"))
    ? fs.statSync(path.join(DIR, "Profile.csv")).mtime.toISOString().slice(0, 10)
    : "",
  snapshotAt: new Date().toISOString().slice(0, 10),
  name: [profile["First Name"], profile["Last Name"]].filter(Boolean).join(" "),
  headline: (profile.Headline || "").replace(/\s+/g, " ").trim(),
  about: (profile.Summary || "").trim(),
  industry: profile.Industry || "",
  location: profile["Geo Location"] || "",
  websites: (profile.Websites || "").trim(),
  positions,
  education,
  patents,
  skills: { count: skills.length, sample: skills.slice(0, 12) },
  certifications: countRows("Certifications.csv", ["Name"]),
  projects: countRows("Projects.csv", ["Title"]),
  languages: countRows("Languages.csv", ["Name"]),
  volunteering: countRows("Volunteering.csv", ["Company Name"]),
  companiesFollowed: countRows("Company Follows.csv", ["Organization"]),
  // The COUNT only. The 1,148 rows behind it are other people's personal data
  // and belong in the admin-only contacts collection, not in a file the
  // browser downloads.
  connections: countRows("Connections.csv", ["First Name"]),
};

if (!snapshot.headline && !snapshot.name) {
  console.error(
    `No LinkedIn export found at ${DIR}. Download yours from linkedin.com → Settings → Get a copy of your data, unzip it there, and run this again.`
  );
  process.exit(1);
}

const json =
  "// Generated by scripts/linkedin-snapshot.mjs from the LinkedIn data export.\n" +
  "// Do not hand-edit: run `npm run linkedin:snapshot` after downloading a newer\n" +
  "// export. Holds no personal data about anyone else - connections are a COUNT.\n" +
  "const profile = " +
  JSON.stringify(snapshot, null, 2) +
  ";\n\nexport default profile;\n";
if (DRY) {
  console.log(json);
  process.exit(0);
}

const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
if (before === json) {
  console.log("lib/linkedinProfile.js is already current — nothing written.");
} else {
  fs.writeFileSync(OUT, json);
  console.log(`wrote lib/linkedinProfile.js from the export of ${snapshot.exportedAt}`);
}

console.log(
  [
    `  headline       ${snapshot.headline.slice(0, 70)}${snapshot.headline.length > 70 ? "…" : ""}`,
    `  positions      ${positions.length}`,
    `  skills         ${snapshot.skills.count}`,
    `  certifications ${snapshot.certifications}`,
    `  patents        ${patents.length}`,
    `  connections    ${snapshot.connections}  (count only — no names copied)`,
  ].join("\n")
);
