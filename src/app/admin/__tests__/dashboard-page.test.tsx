// ─────────────────────────────────────────────────────────────────────────────
// /admin — visitor analytics must never take the dashboard down (audit H-2).
//
// The visitor funnel used to share one Promise.all with the revenue stats, so a
// slow or failing analytics query blanked the whole staff dashboard (and
// showed "manager not linked to a branch" for any error). It now streams in
// its own Suspense section. These specs server-render the REAL page tree
// (react-dom/static prerender) with the analytics loader failing or hanging,
// and assert revenue + recent orders still render while only the visitor card
// is replaced.
//
// Boundary mocks only: the session reader, the two dashboard loaders, and the
// two chart components (Recharts measures the DOM, irrelevant here).
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

vi.mock("@/lib/session", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/actions/dashboard", () => ({
  getDashboardStats: vi.fn(),
  getVisitorFunnel: vi.fn(),
}));
vi.mock("@/components/admin/RevenueChart", () => ({ default: () => <div data-testid="revenue-chart" /> }));
vi.mock("@/components/admin/VisitorFunnelCard", () => ({
  default: ({ month }: { month: { uniqueVisitors: number } }) => (
    <section data-testid="visitor-card">visitors: {month.uniqueVisitors}</section>
  ),
}));

import AdminDashboardPage from "@/app/admin/page";
import { getServerSession } from "@/lib/session";
import { getDashboardStats, getVisitorFunnel } from "@/lib/actions/dashboard";

const mockedSession = vi.mocked(getServerSession);
const mockedStats = vi.mocked(getDashboardStats);
const mockedFunnel = vi.mocked(getVisitorFunnel);
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

const STATS = {
  scope: { role: "ADMIN" as const, branchId: null, branchName: null },
  totalRevenue: 123456,
  revenueLast30: 54321,
  revenuePrev30: 50000,
  ordersToday: 7,
  ordersYesterday: 5,
  activeProducts: 40,
  newProducts30: 2,
  customers: 300,
  newCustomers30: 12,
  recentOrders: [
    {
      id: "o1",
      orderNumber: 10042,
      customerName: "Mona Hassan",
      totalAmount: 450,
      status: "PENDING" as const,
      createdAt: new Date("2026-11-20T10:00:00Z"),
    },
  ],
  chartData: [],
};

const SUMMARY = { uniqueVisitors: 16, pageViews: 96, steps: [], daily: [] };

/** Fully server-render the page, waiting for every Suspense boundary to resolve. */
async function renderPage(): Promise<string> {
  const { prerenderToNodeStream } = await import("react-dom/static");
  const element = await AdminDashboardPage();
  const { prelude } = await prerenderToNodeStream(element);
  const chunks: Buffer[] = [];
  for await (const chunk of prelude as Readable) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSession.mockResolvedValue({ user: { id: "u1", name: "Amira Saleh", role: "ADMIN" } } as never);
  mockedStats.mockResolvedValue(STATS as never);
  mockedFunnel.mockResolvedValue({ week: SUMMARY, month: SUMMARY, branchScoped: false } as never);
});

describe("admin dashboard — the visitor funnel is isolated from the money", () => {
  it("renders revenue and recent orders when the analytics query THROWS — only the visitor card is replaced", async () => {
    mockedFunnel.mockRejectedValue(new Error("canceling statement due to statement timeout"));

    const html = await renderPage();

    expect(html).toContain("Total Revenue");
    expect(html).toContain("10042"); // the recent order still renders
    expect(html).toContain("Mona Hassan");
    expect(html).toContain("Visitor stats are unavailable right now");
    expect(html).not.toContain("Dashboard unavailable");
    expect(html).not.toContain("isn’t linked to a branch");
    expect(consoleError).toHaveBeenCalledWith(
      "Visitor funnel unavailable — the dashboard renders without it:",
      expect.any(Error),
    );
  });

  it("does not await analytics before rendering the page shell (no shared Promise.all)", async () => {
    let settle!: (v: unknown) => void;
    mockedFunnel.mockReturnValue(new Promise((r) => (settle = r)) as never);

    // The page function resolves while the analytics promise is still pending…
    const element = await AdminDashboardPage();
    expect(element).toBeTruthy();
    expect(mockedStats).toHaveBeenCalledTimes(1);
    settle({ week: SUMMARY, month: SUMMARY, branchScoped: false });
  });

  it("renders the visitor card normally when analytics succeed", async () => {
    const html = await renderPage();

    expect(html).toContain('data-testid="visitor-card"');
    expect(html).toMatch(/visitors: (<!-- -->)?16/); // React separates adjacent text nodes
    expect(html).toContain("Total Revenue");
  });

  it("still shows the branch notice when the STATS loader refuses (a branchless manager)", async () => {
    mockedStats.mockRejectedValue(new Error("Forbidden: this manager has no branch assigned."));

    const html = await renderPage();

    expect(html).toContain("Dashboard unavailable");
    expect(mockedFunnel).not.toHaveBeenCalled();
  });
});
