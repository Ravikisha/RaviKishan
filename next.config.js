/** @type {import('next').NextConfig} */
const withPWA = require("next-pwa")({
  dest: "public",
    register: true,
    skipWaiting: true
})
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
  
};
if (process.env.NODE_ENV === "development") {
  console.log("info  - lanUrl:", `http://${require("address").ip()}:3000`);
}

module.exports = withPWA(nextConfig);
