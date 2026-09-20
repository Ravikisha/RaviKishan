/* Uploads the documents in mydocs/ into the private Backblaze vault.
 *
 *   node scripts/vault-import.mjs --dry-run     # show the plan, touch nothing
 *   node scripts/vault-import.mjs               # upload + write the manifest
 *
 * Bytes go straight to B2 with the bucket-scoped key. The Firestore metadata
 * cannot be written from here — `vault/` is admin-only and this script has no
 * Firebase session — so it emits vault-manifest.json, which the admin's Vault
 * tab imports in one click while you are signed in.
 *
 * DELIBERATELY NOT UPLOADED:
 *   - Aadhaar and PAN. Those are identity-class and the design encrypts them
 *     in the browser under a passphrase that exists nowhere else. Uploading
 *     them from a script would silently store them unencrypted. Add them
 *     through the admin UI instead.
 *   - certificate.html (a pdf2htmlEX render of certificate.pdf, not a separate
 *     document) and offer_letter_zimyo.pdf (byte-identical to Offer Letter.pdf).
 *   - Photos and generated images, which are not documents.
 *
 * Dates: only set where the filename states one. Salary slips are dated to the
 * last day of the month they name; nothing else gets a date invented for it.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const DOCS = path.resolve(root, "..", "mydocs");
const MANIFEST = path.join(root, "vault-manifest.json");
const DRY = process.argv.includes("--dry-run");

for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { presign, b2Config } = await import("../lib/server/b2.js");

const monthEnd = (year, monthName) => {
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const mi = months.indexOf(monthName.toLowerCase());
  if (mi === -1) return "";
  return new Date(Date.UTC(year, mi + 1, 0)).toISOString().slice(0, 10);
};

const MIME = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".html": "text/html",
};

// filename → the metadata it should carry. `skip` explains why something is
// intentionally left out, so the report is auditable rather than silent.
function classify(name) {
  const n = name.toLowerCase();

  if (/addhar|aadhaar|aadhar/.test(n))
    return { skip: "identity document — upload via the admin so it is encrypted with your passphrase" };
  if (/^pan\./.test(n))
    return { skip: "identity document — upload via the admin so it is encrypted with your passphrase" };
  if (n === "certificate.html")
    return { skip: "pdf2htmlEX render of certificate.pdf, not a separate document" };
  if (n === "offer_letter_zimyo.pdf")
    return { skip: "byte-identical duplicate of 'Offer Letter.pdf'" };
  if (/^myimage\.|^chatgpt image|^image \(|^\d{10,}\.jpg|^results_/.test(n))
    return { skip: "photo or generated image, not a document" };

  const salary = /^salary slip (\w+) (\d{4})\.pdf$/.exec(n);
  if (salary) {
    const [, month, year] = salary;
    const pretty = month.charAt(0).toUpperCase() + month.slice(1);
    return {
      category: "income",
      tags: ["salary-slip", "zimyo", year],
      note: `Zimyo salary slip — ${pretty} ${year}`,
      issuedAt: monthEnd(Number(year), month),
    };
  }
  if (/slips\.pdf$/.test(n))
    return {
      category: "income",
      tags: ["salary-slip", "zimyo", "bundle"],
      note: "Zimyo salary slips — three months in one PDF",
    };

  if (/^offer letter/.test(n))
    return { category: "employment", tags: ["offer-letter", "zimyo"], note: "Zimyo offer letter" };
  if (/experience[ _]letter/.test(n))
    return {
      category: "employment",
      tags: ["experience-letter"],
      note: "Experience letter",
    };

  if (/^marksheet 10/.test(n))
    return { category: "education", tags: ["marksheet", "class-10"], note: "Class 10 marksheet" };
  if (/^marksheet 12/.test(n))
    return { category: "education", tags: ["marksheet", "class-12"], note: "Class 12 marksheet" };
  if (/^graduation marksheet/.test(n))
    return { category: "education", tags: ["marksheet", "graduation"], note: "Graduation marksheet" };
  if (/^pg marksheet/.test(n))
    return { category: "education", tags: ["marksheet", "postgraduate", "vit"], note: "MCA marksheet — VIT Vellore" };
  if (/^pg[ _]provisional/.test(n))
    return {
      category: "education",
      tags: ["provisional-certificate", "postgraduate", "vit"],
      note: "MCA provisional certificate — VIT Vellore",
    };

  if (n === "certificate.pdf")
    return {
      category: "certificate",
      tags: ["internship", "arrowhead-capital", "quantitative", "vit"],
      note:
        "Internship completion — Quantitative Backend Developer Intern, Arrowhead Capital Management, Mumbai. " +
        "Project: real-time algorithmic trading infrastructure with distributed data pipelines, strategy execution and analytics dashboards.",
    };

  return { category: "other", tags: [], note: "" };
}

const safeName = (name) =>
  name.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-90) || "file";

const files = fs.readdirSync(DOCS).filter((f) => fs.statSync(path.join(DOCS, f)).isFile());

const planned = [];
const skipped = [];
for (const name of files.sort()) {
  const c = classify(name);
  if (c.skip) {
    skipped.push({ name, reason: c.skip });
    continue;
  }
  planned.push({ name, ...c });
}

console.log(`bucket: ${b2Config().bucket}   mode: ${DRY ? "DRY RUN" : "UPLOAD"}\n`);
console.log(`will upload ${planned.length} documents:`);
for (const p of planned) {
  const size = fs.statSync(path.join(DOCS, p.name)).size;
  console.log(
    `  ${p.category.padEnd(11)} ${String(Math.round(size / 1024) + "KB").padStart(7)}  ${p.name}` +
      `${p.issuedAt ? `  [${p.issuedAt}]` : ""}`
  );
}
console.log(`\nskipping ${skipped.length}:`);
for (const s of skipped) console.log(`  ${s.name}\n      ${s.reason}`);

if (DRY) {
  console.log("\nDry run — nothing uploaded.");
  process.exit(0);
}

console.log("\nuploading…");
const entries = [];
let failed = 0;
for (const p of planned) {
  const full = path.join(DOCS, p.name);
  const bytes = fs.readFileSync(full);
  const ext = path.extname(p.name).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  const key = `vault/${p.category}/${Date.now()}-${safeName(p.name)}`;

  try {
    const res = await fetch(presign({ method: "PUT", key, expiresIn: 600 }), {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": contentType },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);

    entries.push({
      key,
      filename: safeName(p.name),
      originalName: p.name,
      contentType,
      size: bytes.length,
      storedSize: bytes.length,
      encrypted: false,
      salt: null,
      iv: null,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      category: p.category,
      tags: p.tags || [],
      issuedAt: p.issuedAt || null,
      expiresAt: null,
      note: p.note || "",
      uploadedAt: new Date().toISOString(),
    });
    console.log(`  ✓ ${p.name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${p.name} — ${e.message}`);
  }
}

fs.writeFileSync(
  MANIFEST,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      bucket: b2Config().bucket,
      uploaded: entries.length,
      skipped,
      entries,
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  `\n${entries.length} uploaded, ${failed} failed, ${skipped.length} skipped.\n` +
    `manifest: ${path.relative(root, MANIFEST)}\n\n` +
    `Next: sign in at /admin → Vault → "Import manifest" to create the Firestore\n` +
    `metadata. Aadhaar and PAN still need to go through the UI so they are encrypted.`
);
process.exit(failed ? 1 : 0);
