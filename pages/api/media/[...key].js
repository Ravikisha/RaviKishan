// Public read path for blog media.
//
// The bucket is private (Backblaze will not make one public without payment
// history on the account), so this route presigns a read server-side and
// streams the bytes back under our own domain. That is better than a public
// bucket anyway: the URLs are ravikishan.me/api/media/…, they survive a
// storage migration, and the cache policy is ours to set.
//
// Keys are timestamped and never rewritten, so the response is immutable and
// Vercel's edge cache serves almost every hit without touching this function.
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { presign, assertMediaKey, isVaultConfigured } from "../../../lib/server/b2";

const TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }
  if (!isVaultConfigured()) return res.status(503).end();

  const key = `media/${(req.query.key || []).join("/")}`;
  try {
    assertMediaKey(key);
  } catch (_) {
    return res.status(400).json({ error: "Invalid media path." });
  }

  const ext = key.split(".").pop().toLowerCase();
  // Only image types are served here. An upload is admin-gated, but refusing
  // to serve arbitrary content types means this can never become a way to host
  // an HTML or script payload on the site's own origin.
  if (!TYPES[ext]) return res.status(415).json({ error: "Unsupported media type." });

  try {
    const upstream = await fetch(presign({ method: "GET", key, expiresIn: 120 }));
    // A private bucket answers a missing key with 403 as readily as 404;
    // both mean "no such image" to a reader.
    if (!upstream.ok)
      return res.status(upstream.status === 404 || upstream.status === 403 ? 404 : 502).end();

    res.setHeader("Content-Type", TYPES[ext]);
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "HEAD") {
      upstream.body?.cancel?.();
      return res.status(200).end();
    }

    // Streamed, not buffered. This used to read the whole object into memory
    // before sending a byte, which is fine for a 100 KB screenshot and wasteful
    // for a full-resolution photograph. Piping keeps memory flat whatever the
    // file size.
    res.status(200);
    await pipeline(Readable.fromWeb(upstream.body), res);
    return undefined;
  } catch (_) {
    return res.status(502).end();
  }
}
