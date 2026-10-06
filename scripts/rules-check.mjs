// Are the LIVE Firestore rules the ones we think we published?
//
// `firebase deploy` reports success when the file compiles and uploads. It
// cannot tell you the rules do what you meant — and the rules ARE the security
// boundary here, because there is no service account anywhere in this
// deployment and nothing else stands between a collection and the internet.
//
// So this asks the real database, over the public REST API, with the public web
// key and NO credentials: exactly what an anonymous visitor can reach.
//
//   npm run rules:check
import fs from "fs";
import path from "path";

const PROJECT = "myportifilio-3ab5f";

// The same key the browser ships; it is not a secret, it identifies the project.
function apiKey() {
  if (process.env.NEXT_PUBLIC_FIREBASE_API_KEY) return process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  for (const f of [".env.local", ".env"]) {
    try {
      const m = fs
        .readFileSync(path.join(process.cwd(), f), "utf8")
        .match(/NEXT_PUBLIC_FIREBASE_API_KEY\s*=\s*"?([^"\r\n]+)"?/);
      if (m) return m[1].trim();
    } catch (_) {}
  }
  try {
    const m = fs
      .readFileSync(path.join(process.cwd(), "lib/firebase.js"), "utf8")
      .match(/apiKey:\s*"([^"]+)"/);
    if (m) return m[1];
  } catch (_) {}
  return "";
}

const KEY = apiKey();
if (!KEY) {
  console.error("No Firebase web API key found (NEXT_PUBLIC_FIREBASE_API_KEY).");
  process.exit(1);
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

let pass = 0;
const fails = [];
const check = (ok, name, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const status = async (p) => {
  const res = await fetch(`${BASE}/${p}${p.includes("?") ? "&" : "?"}key=${KEY}`);
  return res.status;
};

// Anything holding a credential, someone else's personal data, or an
// unpublished draft. A 200 on any of these is the whole game.
const PRIVATE = [
  ["integrations", "connected task accounts (sealed refresh tokens)"],
  ["vault", "identity document metadata"],
  ["contacts", "1,000+ people's personal data"],
  ["jobs", "the job tracker"],
  ["postVersions", "post snapshots, which include draft bodies"],
  ["linkedinPosts", "what this app published to LinkedIn"],
  ["socialAccounts", "sealed YouTube, Instagram and X credentials"],
  ["notes", "note bodies, including unfinished ones"],
  ["siteDrafts", "unpublished site content"],
  ["auditLog", "the audit trail"],
  ["mcpTokens", "MCP token records"],
  ["oauthCodes", "single-use OAuth grants"],
];

console.log("\nprivate collections are closed to an anonymous reader");
for (const [c, why] of PRIVATE) {
  const s = await status(c);
  check(s === 403, `${c} is denied — ${why}`, `HTTP ${s}`);
}

console.log("\npublic collections still answer");
for (const c of ["links", "gallery"]) {
  const s = await status(`${c}?pageSize=1`);
  check(s === 200, `${c} is world-readable`, `HTTP ${s}`);
}

console.log("\nposts are per-document, so an unconstrained list must be refused");
{
  // The rule is `published == true || isAdmin()`. Firestore evaluates that per
  // document, so a bare list cannot be satisfied and is rejected outright —
  // which is the behaviour that stops drafts leaking. lib/posts.js constrains
  // every public list with where("published","==",true).
  const s = await status("posts?pageSize=1");
  check(s === 403, "a bare list of posts is refused rather than returning drafts", `HTTP ${s}`);

  // ...and the constrained query the site actually uses still works.
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "posts" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "published" },
            op: "EQUAL",
            value: { booleanValue: true },
          },
        },
        limit: 3,
      },
    }),
  });
  const rows = res.ok ? await res.json() : [];
  const found = Array.isArray(rows) ? rows.filter((r) => r.document).length : 0;
  check(res.status === 200, "the constrained published-only query is allowed", `HTTP ${res.status}`);
  check(found > 0, "and it returns published posts", `${found} rows`);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("\nfailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
