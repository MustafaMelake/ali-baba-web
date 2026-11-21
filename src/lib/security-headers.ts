// ─────────────────────────────────────────────────────────────────────────────
// Security headers (audit L-2) — applied to every route by next.config.ts.
//
// Plain + pure (reads only the values passed in) so it is unit-tested and
// next.config can import it with a relative path. Enforced now: HSTS, nosniff,
// Referrer-Policy, frame-ancestors (+ X-Frame-Options for old browsers) and a
// Permissions-Policy. The full Content-Security-Policy ships in REPORT-ONLY
// mode first: violations appear in the browser console without breaking
// anything, and it is promoted to enforcing once a few days of real traffic
// show it clean (docs/DEPLOY_RUNBOOK.md §15).
// ─────────────────────────────────────────────────────────────────────────────

export type SecurityHeader = { key: string; value: string };

/**
 * The CSP the site is moving to. Everything is same-origin except images on
 * the R2 public host:
 *   - scripts: Next's own chunks + its inline bootstrap, the grid-density head
 *     script, Vercel Analytics (served from /_vercel/… on our origin) →
 *     'self' 'unsafe-inline' (no third-party script hosts at all);
 *   - styles: framer-motion and next/font write inline styles → 'unsafe-inline';
 *   - images: /_next/image + /public (self), admin previews of uploads (the R2
 *     public host and blob: object URLs), data: placeholders;
 *   - fonts: next/font self-hosts them;
 *   - nothing is framed, no plugins, forms post only to us.
 * `dev` adds what `next dev` needs ('unsafe-eval' for React Refresh, ws: HMR).
 */
export function contentSecurityPolicy({ r2Origin, dev }: { r2Origin: string | null; dev: boolean }): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(r2Origin ? [r2Origin] : [])],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(dev ? ["ws:"] : [])],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "manifest-src": ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/** Every header next.config attaches to `/:path*`. */
export function securityHeaders({ r2Origin, dev }: { r2Origin: string | null; dev: boolean }): SecurityHeader[] {
  return [
    // Two years, the browsers' preload-list minimum. No includeSubDomains /
    // preload yet: those bind every subdomain of the production domain to
    // HTTPS for two years — opt in deliberately once the domain is final.
    { key: "Strict-Transport-Security", value: "max-age=63072000" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Enforced on its own (clickjacking defence) while the full CSP is report-only.
    { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    },
    { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy({ r2Origin, dev }) },
  ];
}

/** The R2 public origin from NEXT_PUBLIC_R2_PUBLIC_BASE_URL (https only), or null. */
export function r2OriginFrom(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
