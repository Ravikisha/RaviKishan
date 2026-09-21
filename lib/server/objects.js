// SERVER ONLY. Listing the bucket.
//
// Extracted from pages/api/storage so the MCP tools list the same objects the
// Assets tab does, through the same code. Two implementations of "what is in
// the bucket" is two answers to one question.
import { presign } from "./b2.js";

// Every prefix the app writes to. Listing is scoped to these, so a stray
// object elsewhere in the bucket is simply invisible rather than deletable.
export const PREFIXES = ["media/", "vault/", "resumes/"];

export const inOwnedPrefix = (key) =>
  typeof key === "string" &&
  !key.includes("..") &&
  PREFIXES.some((p) => key.startsWith(p)) &&
  !key.endsWith("/");

// Minimal XML pluck — S3 ListObjectsV2 is a fixed, flat shape, and a parser
// dependency for four tag names is not worth the install.
export function parseList(xml) {
  const out = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const chunk = m[1];
    const pick = (tag) => (chunk.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
    const key = pick("Key")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    if (!key || key.endsWith("/")) continue;
    out.push({
      key,
      size: Number(pick("Size") || 0),
      lastModified: pick("LastModified"),
      etag: pick("ETag").replace(/&quot;|"/g, ""),
    });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1] || null;
  return { objects: out, truncated, next };
}

export async function listPrefix(prefix) {
  const all = [];
  let token = null;
  // Bounded: 10 pages × 1000 keys is far more than this bucket will ever hold,
  // and an unbounded loop against a paid API is how you get a surprise bill.
  for (let page = 0; page < 10; page++) {
    const query = { "list-type": "2", prefix, "max-keys": "1000" };
    if (token) query["continuation-token"] = token;
    const res = await fetch(presign({ method: "GET", key: "", expiresIn: 120, query }));
    if (!res.ok) throw new Error(`Storage list failed (HTTP ${res.status}) for ${prefix}`);
    const { objects, truncated, next } = parseList(await res.text());
    all.push(...objects);
    if (!truncated || !next) break;
    token = next;
  }
  return all;
}
