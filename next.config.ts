import type { NextConfig } from "next";
import { r2OriginFrom, securityHeaders } from "./src/lib/security-headers";

/**
 * The R2 public host `next/image` may load from — the same
 * NEXT_PUBLIC_R2_PUBLIC_BASE_URL that `isHostedImageUrl` (validators.ts)
 * accepts, read at build time. Unset (e.g. a local build without the env) →
 * no pattern, and an R2 image would fail to render, so set it on every Vercel
 * scope. Must stay in step with isHostedImageUrl: a stored URL on a host
 * missing here makes `<Image>` throw and takes down the whole ISR page.
 */
function r2RemotePattern() {
  const raw = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
  if (!raw) return [];
  try {
    const url = new URL(raw);
    const prefix = url.pathname.replace(/\/+$/, "");
    return [{ protocol: "https" as const, hostname: url.hostname, pathname: `${prefix}/**` }];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  experimental: {},
  turbopack: {
    root: __dirname,
  },
  // Audit L-2 — HSTS, nosniff, Referrer-Policy, frame-ancestors and a
  // Permissions-Policy on every response, plus the full CSP in Report-Only
  // mode (it allows the same R2 host as remotePatterns below).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          r2Origin: r2OriginFrom(process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL),
          dev: process.env.NODE_ENV === "development",
        }),
      },
    ];
  },
  images: {
    remotePatterns: [
      // Cloudflare R2 — where every upload lands (/api/upload). The only remote
      // host: the UploadThing hosts went once every stored URL had been moved
      // (scripts/migrate-images-to-r2.ts).
      ...r2RemotePattern(),
    ],
  },
};

export default nextConfig;
