// ─────────────────────────────────────────────────────────────────────────────
// Security suite — Edge proxy (src/proxy.ts), session guards (src/lib/session.ts)
// and the open-redirect guard (src/lib/utils.ts → sanitizeRedirect).
//
// Focused on Request/Response boundaries and HTTP status codes. THREE things the
// implementation does differently from a naive reading — tested as they REALLY
// are, not as assumed:
//
//   • The proxy's matcher covers ONLY /my-orders + /wishlist. It does NOT gate
//     /admin — admin routes are gated IN-PAGE by requireAdminPage(). Testing
//     "the proxy intercepts /admin" would assert false security, so requirement
//     #1's admin case is tested against the REAL gate (requireAdminPage).
//   • Interception is `NextResponse.redirect` (default 307), not 302/401, to
//     /login?redirect=<path> (the param is `redirect`, not `callbackUrl`).
//   • sanitizeRedirect blocks absolute + protocol-relative URLs, but a "/\" path
//     BYPASSES it and resolves cross-origin — a real open-redirect gap, flagged.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma/client";
import type { NextRequest } from "next/server";

// ── Edge proxy boundary: cookie presence only (no DB on the Edge). ──
vi.mock("better-auth/cookies", () => ({ getSessionCookie: vi.fn() }));

// ── session.ts boundaries: auth, request headers, navigation, DB, React cache. ──
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({
  // The real redirect() NEVER returns — it throws NEXT_REDIRECT. Mirror that so
  // control flow after a guard's redirect() matches production.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
// Strip React's render-context memoization so getServerSession = cache(fn) is
// just fn() under test (cache() otherwise needs a Server-Component render scope).
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: unknown) => fn };
});

import { proxy, config } from "@/proxy";
import { getSessionCookie } from "better-auth/cookies";
import { requireAdmin, requireAdminPage, requireDashboardAccess } from "@/lib/session";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { sanitizeRedirect } from "@/lib/utils";

const mockedCookie = vi.mocked(getSessionCookie);
const mockedGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockedRedirect = vi.mocked(redirect);
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;

/** A minimal NextRequest — proxy() only reads `.url` and `.nextUrl.pathname`. */
function requestFor(pathname: string): NextRequest {
  return {
    url: `https://mystore.com${pathname}`,
    nextUrl: { pathname },
  } as unknown as NextRequest;
}

beforeEach(() => {
  mockReset(mockPrisma);
  mockedCookie.mockReset();
  mockedGetSession.mockReset();
  mockedRedirect.mockClear(); // keep its throw implementation, clear call history
});

// ═════════════════════════════════════════════════════════════════════════════
// 1a. Proxy — intercepts unauthenticated requests to the routes it DOES guard
// ═════════════════════════════════════════════════════════════════════════════

describe("proxy — unauthenticated interception (customer account routes)", () => {
  it("redirects a cookieless /my-orders request to /login (307), preserving the destination", () => {
    mockedCookie.mockReturnValue(null); // no Better Auth session cookie → logged out
    const res = proxy(requestFor("/my-orders"));

    // NextResponse.redirect defaults to 307 (Next's temporary redirect) — not 302/401.
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect")).toBe("/my-orders"); // round-trip target
  });

  it("redirects a cookieless /wishlist request to /login", () => {
    mockedCookie.mockReturnValue(null);
    const res = proxy(requestFor("/wishlist"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("lets an authenticated request pass through (NextResponse.next, no redirect)", () => {
    mockedCookie.mockReturnValue("ba.session-token.value"); // cookie present
    const res = proxy(requestFor("/my-orders"));
    expect(res.status).toBe(200); // NextResponse.next() → 200 passthrough
    expect(res.headers.get("location")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1b. Proxy matcher scope — /admin is NOT edge-gated (in-page guard instead)
// ═════════════════════════════════════════════════════════════════════════════

describe("proxy — matcher scope (admin is not proxy-gated)", () => {
  it("matches exactly the customer account routes, bare AND wildcarded", () => {
    expect(config.matcher).toEqual([
      "/my-orders",
      "/my-orders/:path*",
      "/wishlist",
      "/wishlist/:path*",
    ]);
  });

  it("does NOT match /admin — the edge proxy is optimistic; the admin gate is requireAdminPage", () => {
    // Deliberate (@rules/backend.md): if the proxy silently 'protected' /admin a
    // reviewer might assume the edge is the admin gate. It is not — the real
    // interception is asserted below against requireAdminPage().
    expect(config.matcher.some((m) => m.includes("/admin"))).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1c. The REAL admin gate — requireAdminPage() intercepts /admin/* in-page
// ═════════════════════════════════════════════════════════════════════════════

describe("requireAdminPage — the real /admin interception", () => {
  it("redirects an unauthenticated visitor to /login", async () => {
    mockedGetSession.mockResolvedValue(null); // logged out
    await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mockedRedirect).toHaveBeenCalledWith("/login");
  });

  it("bounces a non-admin (MANAGER) away to /admin", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "m1", role: "MANAGER" } });
    await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT:/admin");
    expect(mockedRedirect).toHaveBeenCalledWith("/admin");
  });

  it("admits an ADMIN without redirecting", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const session = await requireAdminPage();
    expect(session).toMatchObject({ user: { role: "ADMIN" } });
    expect(mockedRedirect).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Session invalidation — guards evaluate the actual session, not the path
// ═════════════════════════════════════════════════════════════════════════════

describe("session guards — logged-out rejection (token presence, not path)", () => {
  it("requireAdmin throws for a logged-out caller", async () => {
    mockedGetSession.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toThrow("Unauthorized: admin access required.");
  });

  it("requireAdmin throws for a valid-but-non-admin session (role is evaluated, not mere presence)", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "u1", role: "USER" } });
    await expect(requireAdmin()).rejects.toThrow("Unauthorized");
  });

  it("requireAdmin returns the session for an admin", async () => {
    mockedGetSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await expect(requireAdmin()).resolves.toMatchObject({ user: { role: "ADMIN" } });
  });

  it("requireDashboardAccess throws for a logged-out caller and never touches the DB", async () => {
    mockedGetSession.mockResolvedValue(null);
    await expect(requireDashboardAccess()).rejects.toThrow("Unauthorized: authentication required.");
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("requireDashboardAccess re-reads role+branch LIVE from the DB (not from the token)", async () => {
    // Proves the guard trusts the DB, not the session payload — a demoted user
    // loses access on their very next request, not whenever the token refreshes.
    mockedGetSession.mockResolvedValue({ user: { id: "m1", role: "MANAGER" } });
    mockPrisma.user.findUnique.mockResolvedValue({ role: "MANAGER", branchId: "b1" } as never);

    const scope = await requireDashboardAccess();
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "m1" },
      select: { role: true, branchId: true },
    });
    expect(scope).toEqual({ userId: "m1", role: "MANAGER", branchId: "b1" });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Open-redirect prevention — sanitizeRedirect
// ═════════════════════════════════════════════════════════════════════════════

describe("sanitizeRedirect — open-redirect prevention", () => {
  it.each([
    "https://evil-phishing-site.com",
    "http://evil.com",
    "//evil.com", // protocol-relative → cross-origin
    "javascript:alert(document.cookie)",
    "   /leading-space", // does not start with "/" → rejected
  ])("neutralises the hostile redirect %o → '/'", (vector) => {
    expect(sanitizeRedirect(vector)).toBe("/");
  });

  it("falls back to '/' for null / empty input", () => {
    expect(sanitizeRedirect(null)).toBe("/");
    expect(sanitizeRedirect("")).toBe("/");
  });

  it("passes through a legitimate same-origin relative path", () => {
    expect(sanitizeRedirect("/my-orders")).toBe("/my-orders");
    expect(sanitizeRedirect("/wishlist/abc?tab=1")).toBe("/wishlist/abc?tab=1");
  });
});

describe("sanitizeRedirect — backslash open-redirect (hardened)", () => {
  // A path beginning "/\" is NOT "//", so it once slipped past the guard — the
  // WHATWG URL parser normalises "\" → "/" for http(s), making it protocol-
  // relative to a hostile origin, which router.push() would then navigate to.
  // The guard now rejects a 2nd character of "/" OR "\", closing both variants.
  const BACKSLASH_EXPLOIT = "/" + String.fromCharCode(92) + "evil.com"; // "/\evil.com"

  it("would resolve CROSS-ORIGIN if left unsanitized (why it must be blocked)", () => {
    // The latent severity: the RAW value resolves to a hostile origin in a browser.
    expect(new URL(BACKSLASH_EXPLOIT, "https://mystore.com").origin).toBe("https://evil.com");
  });

  it("collapses the backslash path to '/' — bypass blocked", () => {
    expect(sanitizeRedirect(BACKSLASH_EXPLOIT)).toBe("/");
  });
});
