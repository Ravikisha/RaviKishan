/* Round-trips a real object through the private Backblaze vault bucket using
 * the same presigner the API route uses.
 *
 *   node scripts/b2-check.mjs
 *
 * This is the storage-layer test: it proves the SigV4 signature is accepted by
 * Backblaze, that the bucket is genuinely private (an unsigned GET must fail),
 * that bytes survive the round trip, and that delete works. The auth layer in
 * front of it (/api/vault/sign) is covered separately by e2e-check.js.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// Minimal .env.local reader — no dotenv dependency for a dev-only script.
for (const line of fs
  .readFileSync(path.join(root, ".env.local"), "utf8")
  .split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { presign, assertVaultKey, b2Config } = await import("../lib/server/b2.js");

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

const cfg = b2Config();
console.log(`bucket: ${cfg.bucket}  endpoint: ${cfg.endpoint}  region: ${cfg.region}\n`);

const key = `vault/_selftest/${Date.now()}-roundtrip.bin`;
const body = Buffer.from(
  `vault self-test ${new Date().toISOString()}\n${"x".repeat(2048)}`,
  "utf8"
);

// key validation
try {
  assertVaultKey(key);
  check(true, "key accepted by assertVaultKey");
} catch (e) {
  check(false, "key accepted by assertVaultKey", e.message);
}
for (const bad of ["vault/../secrets", "other/thing", "vault/a b", "/vault/x", "vault//x", "vault/x/", "vault/"]) {
  let threw = false;
  try {
    assertVaultKey(bad);
  } catch (_) {
    threw = true;
  }
  check(threw, `rejects bad key ${JSON.stringify(bad)}`);
}

// the bucket must not be readable without a signature
const unsignedUrl = `${cfg.endpoint}/${cfg.bucket}/${key}`;
const unsigned = await fetch(unsignedUrl);
check(
  unsigned.status === 401 || unsigned.status === 403 || unsigned.status === 404,
  "bucket refuses unsigned reads",
  `HTTP ${unsigned.status}`
);

// PUT
const putUrl = presign({ method: "PUT", key, expiresIn: 300 });
const put = await fetch(putUrl, {
  method: "PUT",
  body,
  headers: { "Content-Type": "application/octet-stream" },
});
check(put.ok, "presigned PUT accepted", `HTTP ${put.status} ${(await put.text()).slice(0, 160)}`);

// GET
const getUrl = presign({ method: "GET", key, expiresIn: 300 });
const got = await fetch(getUrl);
check(got.ok, "presigned GET accepted", `HTTP ${got.status}`);
if (got.ok) {
  const back = Buffer.from(await got.arrayBuffer());
  check(back.length === body.length, "byte length round-trips", `${back.length} vs ${body.length}`);
  check(back.equals(body), "bytes are identical");
  check(
    (got.headers.get("x-amz-server-side-encryption") || "").toUpperCase().includes("AES256"),
    "stored with SSE-B2 at rest",
    got.headers.get("x-amz-server-side-encryption") || "no header"
  );
}

// still private after upload
const unsigned2 = await fetch(unsignedUrl);
check(
  unsigned2.status === 401 || unsigned2.status === 403,
  "uploaded object is not publicly readable",
  `HTTP ${unsigned2.status}`
);

// an expired signature must be refused
const expired = presign({ method: "GET", key, expiresIn: 1 });
await new Promise((r) => setTimeout(r, 2500));
const stale = await fetch(expired);
check(!stale.ok, "expired signature is refused", `HTTP ${stale.status}`);

// DELETE + confirm gone
const del = await fetch(presign({ method: "DELETE", key, expiresIn: 120 }), { method: "DELETE" });
check(del.ok, "presigned DELETE accepted", `HTTP ${del.status}`);
const after = await fetch(presign({ method: "GET", key, expiresIn: 120 }));
check(after.status === 404, "object is gone after delete", `HTTP ${after.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
