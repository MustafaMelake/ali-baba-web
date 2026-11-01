import type { NextConfig } from "next";

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
  images: {
    remotePatterns: [
      // Cloudflare R2 — where every upload lands (/api/upload).
      ...r2RemotePattern(),
      // LEGACY UploadThing hosts — kept until scripts/migrate-images-to-r2.ts
      // has moved every stored URL to R2; removed together with UPLOADTHING_HOST
      // in validators.ts.
      { protocol: "https", hostname: "utfs.io" },
      { protocol: "https", hostname: "*.ufs.sh" },
    ],
  },
};

export default nextConfig;
