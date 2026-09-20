/* Verifies the dev.to import path against the real account.
 *
 *   node scripts/devto-check.mjs
 *
 * Everything up to the Firestore write is checked here: the key authenticates,
 * all articles come back with bodies, and each converts to a valid post record
 * with a unique slug. The write itself needs a signed-in browser session
 * (posts/ is admin-only), so the last step is the Import button.
 *
 * This matters because a bad conversion is silent: a post imports "fine" and
 * simply has an empty body, or two articles collide on one slug and one
 * overwrites the other.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { whoami, listMine, toPost, isDevtoConfigured } = await import("../lib/server/devto.js");
const { SLUG_RE } = await import("../lib/posts.js").catch(() => ({ SLUG_RE: /^[a-z0-9][a-z0-9-]{1,59}$/ }));

let pass = 0;
let fail = 0;
const check = (cond, name, detail) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

console.log("connection");
check(isDevtoConfigured(), "DEVTO_API_KEY is present");
const me = await whoami();
check(!!me?.username, `authenticated as ${me?.username}`, JSON.stringify(me).slice(0, 120));

console.log("\narticles");
const articles = await listMine();
check(articles.length > 0, `fetched ${articles.length} articles`);
check(
  articles.every((a) => typeof a.body_markdown === "string" && a.body_markdown.length > 0),
  "every article has a markdown body",
  `${articles.filter((a) => !a.body_markdown).length} without one`
);

console.log("\nconversion to post records");
const posts = articles.map(toPost);

check(
  posts.every((p) => SLUG_RE.test(p.slug)),
  "every slug is URL-safe",
  posts.filter((p) => !SLUG_RE.test(p.slug)).map((p) => p.slug).slice(0, 3).join(", ")
);

const slugs = posts.map((p) => p.slug);
const dupes = slugs.filter((s2, i) => slugs.indexOf(s2) !== i);
check(dupes.length === 0, "slugs are unique (a collision would overwrite a post)", dupes.join(", "));

check(posts.every((p) => p.title && p.title !== "Untitled"), "every post has a real title");
check(posts.every((p) => p.body.length > 50), "no post converted to an empty body");
check(
  posts.every((p) => !Number.isNaN(Date.parse(p.publishedAt))),
  "every publishedAt parses as a date"
);
check(posts.every((p) => p.source === "devto"), "provenance is recorded as devto");
check(
  posts.every((p) => p.canonicalUrl && /^https?:\/\//.test(p.canonicalUrl)),
  "every post carries a canonical URL back to dev.to",
  posts.filter((p) => !p.canonicalUrl).map((p) => p.slug).slice(0, 3).join(", ")
);
check(posts.every((p) => p.readingTime >= 1), "reading time is set");

// Firestore rejects a document over 1 MiB, which would fail the import for
// that one article only — worth knowing before it happens.
const heavy = posts.filter((p) => Buffer.byteLength(JSON.stringify(p), "utf8") > 900_000);
check(heavy.length === 0, "no article is near Firestore's 1 MiB document limit", heavy.map((p) => p.slug).join(", "));

const totalKB = Math.round(
  posts.reduce((n, p) => n + Buffer.byteLength(JSON.stringify(p), "utf8"), 0) / 1024
);
const biggest = posts.slice().sort((a, b) => b.body.length - a.body.length)[0];

console.log(
  `\n     ${posts.length} articles → ${totalKB} KB total\n` +
    `     longest: "${biggest.title.slice(0, 52)}" (${Math.round(biggest.body.length / 1024)} KB)\n` +
    `     tagged:  ${posts.filter((p) => p.tags.length).length}   with cover: ${posts.filter((p) => p.cover).length}`
);

console.log(`\n${pass} passed, ${fail} failed`);
console.log(
  "\nThe Firestore write needs your session: /admin → Writing → Show dev.to articles → Import all."
);
process.exit(fail ? 1 : 0);
