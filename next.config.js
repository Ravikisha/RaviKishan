/** @type {import('next').NextConfig} */

// Service-worker caching policy.
//
// FIRST MATCH WINS, so the never-cache rules come first. This ordering is the
// whole security story of the PWA: /api/vault/sign hands back presigned
// Backblaze URLs, which are bearer credentials with a few minutes of life. A
// cached copy could be replayed, and Workbox caches by URL regardless of the
// Cache-Control header the route sets, so it has to be excluded explicitly.
// Firebase auth and Firestore are excluded for a different reason: stale admin
// data is worse than no admin data.
const runtimeCaching = [
  {
    // vault signing + every other API route
    urlPattern: /\/api\//,
    handler: "NetworkOnly",
  },
  {
    // Firebase (auth, Firestore), Google APIs, and Backblaze object storage
    urlPattern: ({ url }) =>
      /(^|\.)(googleapis\.com|firebaseio\.com|firebaseapp\.com|backblazeb2\.com)$/.test(
        url.hostname
      ),
    handler: "NetworkOnly",
  },
  {
    // Immutable build output — safe to cache hard, it is content-hashed.
    urlPattern: /\/_next\/static\/.*/i,
    handler: "CacheFirst",
    options: {
      cacheName: "next-static",
      expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
    },
  },
  {
    urlPattern: /\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf)$/i,
    handler: "StaleWhileRevalidate",
    options: {
      cacheName: "assets",
      expiration: { maxEntries: 120, maxAgeSeconds: 30 * 24 * 60 * 60 },
    },
  },
  {
    urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
    handler: "StaleWhileRevalidate",
    options: {
      cacheName: "google-fonts",
      expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 },
    },
  },
  {
    // Page navigations: always try the network so a deploy is picked up, but
    // keep a copy so the installed app opens its shell when offline instead of
    // showing the browser's error page.
    urlPattern: ({ request }) => request.mode === "navigate",
    handler: "NetworkFirst",
    options: {
      cacheName: "pages",
      networkTimeoutSeconds: 5,
      expiration: { maxEntries: 40, maxAgeSeconds: 7 * 24 * 60 * 60 },
    },
  },
];

const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  // PWA service-worker generation writes into public/ on every build, which the
  // dev file-watcher then treats as a change → infinite recompile loop (and the
  // ENOENT ".next/server/pages/*" 500s). Disable it in dev; keep it in prod.
  disable: process.env.NODE_ENV === "development",
  runtimeCaching,
});

const nextConfig = {
  images: {
    domains: ["cdn.pixabay.com", "cdn.jsdelivr.net","upload.wikimedia.org","images.unsplash.com","bit.ly","raw.githubusercontent.com","cdn.rareblocks.xyz","4achievers.in","hackr.io","icons.veryicon.com","cdn-icons-png.flaticon.com"],
    loader: "akamai",
    path: ""
  },
  // basePath: process.env.NEXT_PUBLIC_BASE_PATH || '/portifilio',
  // assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH || '/portifilio',
  reactStrictMode: true,
  swcMinify: true,

  async rewrites() {
    return [
      {
        // A pages/ directory cannot begin with a dot, so the RFC 9728
        // discovery document is served from pages/api/well-known/ and mapped
        // to the well-known path MCP clients actually probe.
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/well-known/oauth-protected-resource",
      },
      {
        // Some clients append the resource path to the well-known prefix.
        source: "/.well-known/oauth-protected-resource/api/mcp",
        destination: "/api/well-known/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/well-known/oauth-authorization-server",
      },
      {
        // OpenID-style discovery path, which some clients probe first.
        source: "/.well-known/openid-configuration",
        destination: "/api/well-known/oauth-authorization-server",
      },
    ];
  },

  async headers() {
    return [
      {
        // The manifest must be served with the right type for install to be
        // offered, and must not be cached hard while it is being iterated on.
        source: "/admin.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
      {
        // The admin is private: keep it out of every index and every shared
        // cache, however it is reached.
        source: "/admin",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/api/vault/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/api/mcp/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

if (process.env.NODE_ENV === "development") {
  console.log("info  - lanUrl:", `http://${require("address").ip()}:3000`);
}

module.exports = withPWA(nextConfig);
