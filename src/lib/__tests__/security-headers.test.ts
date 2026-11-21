// ─────────────────────────────────────────────────────────────────────────────
// Security headers (src/lib/security-headers.ts) — audit L-2.
//
// Pins the enforced headers, that the full CSP ships REPORT-ONLY, that it
// allows the R2 image host (so admin previews and any direct R2 <img> load),
// and that it never lets a third-party script host in.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, r2OriginFrom, securityHeaders } from "@/lib/security-headers";

const R2 = "https://media.alibaba-patisserie.com";
const byKey = (headers: { key: string; value: string }[]) => Object.fromEntries(headers.map((h) => [h.key, h.value]));

describe("securityHeaders", () => {
  const h = byKey(securityHeaders({ r2Origin: R2, dev: false }));

  it("enforces HSTS, nosniff, Referrer-Policy, frame-ancestors and Permissions-Policy", () => {
    expect(h["Strict-Transport-Security"]).toBe("max-age=63072000");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Content-Security-Policy"]).toBe("frame-ancestors 'self'");
    expect(h["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["Permissions-Policy"]).toContain("geolocation=()");
  });

  it("ships the full CSP as Report-Only — the enforced CSP is frame-ancestors alone", () => {
    expect(h["Content-Security-Policy-Report-Only"]).toContain("default-src 'self'");
    expect(h["Content-Security-Policy"]).not.toContain("script-src");
  });
});

describe("contentSecurityPolicy", () => {
  it("allows the R2 image host in img-src (plus self, data: and blob: previews)", () => {
    const csp = contentSecurityPolicy({ r2Origin: R2, dev: false });
    expect(csp).toContain(`img-src 'self' data: blob: ${R2}`);
  });

  it("allows no third-party script host, no framing of others, no plugins", () => {
    const csp = contentSecurityPolicy({ r2Origin: R2, dev: false });
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(scriptSrc).toBe("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("adds only what next dev needs in development", () => {
    const csp = contentSecurityPolicy({ r2Origin: null, dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws:");
    expect(contentSecurityPolicy({ r2Origin: null, dev: false })).not.toContain("unsafe-eval");
  });

  it("omits the R2 host cleanly when it isn't configured", () => {
    expect(contentSecurityPolicy({ r2Origin: null, dev: false })).toContain("img-src 'self' data: blob:;");
  });
});

describe("r2OriginFrom", () => {
  it("reduces the public base URL to its https origin", () => {
    expect(r2OriginFrom("https://pub-abc.r2.dev/prefix/")).toBe("https://pub-abc.r2.dev");
  });

  it.each([undefined, "", "http://insecure.example", "not a url"])("returns null for %o", (raw) => {
    expect(r2OriginFrom(raw)).toBeNull();
  });
});
