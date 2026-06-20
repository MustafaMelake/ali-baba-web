import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Legacy UploadThing CDN host.
      { protocol: "https", hostname: "utfs.io" },
      // Current per-app UploadThing CDN host — `file.ufsUrl` (v7) resolves here.
      { protocol: "https", hostname: "*.ufs.sh" },
    ],
  },
};

export default nextConfig;
