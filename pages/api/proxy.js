// Reverse proxy for the Nova browser app. Fetches a target page server-side,
// strips the headers that block framing (X-Frame-Options, Content-Security-
// Policy) and rewrites asset URLs so relative paths keep working when the page
// is served back from our origin.
//
// SCOPE / HONESTY: this makes static and lightly-scripted pages embeddable. It
// does NOT fix heavy JS SPAs (Google, YouTube, etc.) — their scripts fetch the
// real origin at runtime (CORS/absolute URLs, service workers, auth), which a
// URL-rewriting proxy can't rewrite. Those still won't work framed.
//
// SECURITY: an open proxy is dual-use. Guards below block SSRF to private /
// loopback / cloud-metadata addresses, cap size + time, and allow GET only. The
// browser frames this response WITHOUT `allow-same-origin`, so proxied scripts
// run in a null origin and cannot read this site's cookies/storage.

import dns from "dns";
import net from "net";

const MAX_BYTES = 6 * 1024 * 1024; // 6 MB cap
const TIMEOUT_MS = 12000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const proxied = (abs) => `/api/proxy?url=${encodeURIComponent(abs)}`;

// true for addresses we must never fetch (SSRF protection)
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.");
  }
  return true;
}

async function assertSafeHost(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost"))
    throw new Error("blocked host");
  if (net.isIP(h)) {
    if (isPrivateIp(h)) throw new Error("blocked address");
    return;
  }
  // resolve the name and reject if ANY address is private
  const addrs = await dns.promises.lookup(h, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error("could not resolve host");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("blocked address");
}

// resolve a possibly-relative URL against a base, then wrap it through us.
// returns null for things we should leave alone (data:, #, javascript:, …)
function rewriteOne(value, base) {
  const v = (value || "").trim();
  if (!v || /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i.test(v)) return null;
  try {
    return proxied(new URL(v, base).href);
  } catch {
    return null;
  }
}

function rewriteSrcset(value, base) {
  return value
    .split(",")
    .map((part) => {
      const seg = part.trim();
      const sp = seg.indexOf(" ");
      const u = sp === -1 ? seg : seg.slice(0, sp);
      const d = sp === -1 ? "" : seg.slice(sp);
      const r = rewriteOne(u, base);
      return (r || u) + d;
    })
    .join(", ");
}

const rewriteCssUrls = (css, base) =>
  css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => {
      const r = rewriteOne(u, base);
      return r ? `url(${q}${r}${q})` : m;
    })
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => {
      const r = rewriteOne(u, base);
      return r ? `@import ${q}${r}${q}` : m;
    });

function rewriteHtml(html, base) {
  return (
    html
      // drop things that would fight the proxy or break on rewritten bytes
      .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
      .replace(/<base[^>]*>/gi, "")
      .replace(/\s(integrity|nonce)=("[^"]*"|'[^']*')/gi, "")
      // url-bearing attributes
      .replace(/\b(href|src|action|poster|data-src)\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, attr, _q, dq, sq) => {
        const val = dq != null ? dq : sq;
        const r = rewriteOne(val, base);
        return r ? `${attr}="${r}"` : m;
      })
      .replace(/\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _q, dq, sq) => {
        const val = dq != null ? dq : sq;
        return `srcset="${rewriteSrcset(val, base)}"`;
      })
      // inline styles / <style> blocks
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => {
        const r = rewriteOne(u, base);
        return r ? `url(${q}${r}${q})` : m;
      })
  );
}

export default async function handler(req, res) {
  const raw = req.query.url;
  const target = Array.isArray(raw) ? raw[0] : raw;

  if (!target) return res.status(400).send("Missing url parameter.");

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).send("Invalid url.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return res.status(400).send("Only http and https are allowed.");

  try {
    await assertSafeHost(parsed.host);
  } catch (e) {
    return res.status(403).send("That address can't be proxied.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(parsed.href, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const base = upstream.url || parsed.href; // final URL after redirects
    const ct = (upstream.headers.get("content-type") || "").toLowerCase();
    const len = Number(upstream.headers.get("content-length") || 0);
    if (len && len > MAX_BYTES) return res.status(413).send("Response too large.");

    // strip framing/security headers; set our own permissive ones
    res.removeHeader("X-Frame-Options");
    res.removeHeader("Content-Security-Policy");
    res.setHeader("X-Proxied-By", "nova");
    res.setHeader("Cache-Control", "public, max-age=300");

    if (ct.includes("text/html")) {
      const html = await upstream.text();
      if (html.length > MAX_BYTES) return res.status(413).send("Response too large.");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(rewriteHtml(html, base));
    }
    if (ct.includes("text/css")) {
      const css = await upstream.text();
      res.setHeader("Content-Type", "text/css; charset=utf-8");
      return res.status(200).send(rewriteCssUrls(css, base));
    }
    // js, images, fonts, json, … — pass through untouched
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_BYTES) return res.status(413).send("Response too large.");
    res.setHeader("Content-Type", ct || "application/octet-stream");
    return res.status(200).send(buf);
  } catch (e) {
    const msg = e && e.name === "AbortError" ? "The site took too long to respond." : "Could not load that site.";
    return res.status(502).send(msg);
  } finally {
    clearTimeout(timer);
  }
}

// allow larger proxied bodies to flow back through the API route
export const config = { api: { responseLimit: false } };
