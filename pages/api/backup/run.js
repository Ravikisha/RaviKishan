// Nightly backup. Exports every Firestore collection to a JSON object in the
// private Backblaze bucket under vault/_backups/.
//
// Authenticated with an MCP token rather than a new credential: it already
// means "act as the admin", it is scoped, and it is revocable. The token needs
// `read` (to export) and `vault` (to write into the bucket).
//
// Run by .github/workflows/backup.yml on a cron, or by hand:
//   curl -X POST https://www.ravikishan.me/api/backup/run \
//     -H "Authorization: Bearer $MCP_TOKEN"
//
// The manual one-click export in the admin still exists; this is the version
// that happens whether or not you remember.
import { verifyToken, hasScope, isMcpConfigured } from "../../../lib/server/mcpToken";
import { idTokenFor, isRevoked, listDocuments, getDocument } from "../../../lib/server/firestoreRest";
import { presign, isVaultConfigured, b2Config } from "../../../lib/server/b2";

// Everything except `stats`, which is high-volume and reconstructible.
const COLLECTIONS = [
  "vault",
  "jobs",
  "posts",
  "links",
  "contacts",
  "mail",
  "myportifilio",
  "chat",
  "resumeFiles",
  "mcpTokens",
  "auditLog",
];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!isMcpConfigured() || !isVaultConfigured())
    return res.status(503).json({ error: "Backup needs MCP_TOKEN_SECRET and the B2_* variables." });

  const header = req.headers.authorization || "";
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw) return res.status(401).json({ error: "Missing bearer token." });

  let claims;
  try {
    claims = verifyToken(raw);
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }
  if (await isRevoked(claims.jti)) return res.status(401).json({ error: "Token revoked." });
  if (!hasScope(claims, "read") || !hasScope(claims, "vault"))
    return res.status(403).json({ error: "This token needs both the read and vault scopes." });

  let idToken;
  try {
    idToken = await idTokenFor(claims.rt);
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }

  const out = {
    takenAt: new Date().toISOString(),
    note:
      "Firestore contents only. Vault documents are metadata — the bytes live " +
      "beside this file in the same bucket under vault/, keyed by `key`.",
    siteContent: null,
    collections: {},
  };
  const counts = {};
  const failures = {};

  try {
    out.siteContent = await getDocument(idToken, "site/content");
  } catch (e) {
    failures.siteContent = e.message;
  }

  for (const name of COLLECTIONS) {
    try {
      const rows = await listDocuments(idToken, name, { pageSize: 300 });
      out.collections[name] = rows;
      counts[name] = rows.length;
    } catch (e) {
      failures[name] = e.message;
      counts[name] = 0;
    }
  }

  const body = Buffer.from(JSON.stringify(out, null, 2), "utf8");
  const key = `vault/_backups/${out.takenAt.slice(0, 10)}-firestore.json`;

  try {
    const put = await fetch(presign({ method: "PUT", key, expiresIn: 600 }), {
      method: "PUT",
      body,
      headers: { "Content-Type": "application/json" },
    });
    if (!put.ok) throw new Error(`storage rejected the upload (HTTP ${put.status})`);
  } catch (e) {
    return res.status(502).json({ error: e.message, counts, failures });
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return res.status(200).json({
    ok: true,
    key,
    bucket: b2Config().bucket,
    bytes: body.length,
    documents: total,
    counts,
    // Surfaced rather than swallowed: a backup that silently skipped a
    // collection is worse than one that failed loudly.
    failures: Object.keys(failures).length ? failures : undefined,
  });
}
