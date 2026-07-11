---
name: scaffold-admin-page
description: Scaffold a new admin console route (src/app/admin/**) as a Server Component — correct role guard (requireAdminPage vs requireDashboardAccess + branch scope), parallel Prisma reads in one Promise.all, force-dynamic where data must be live, and Decimal→number coercion at the client boundary. Use when adding a page under /admin.
---

# Scaffold an Admin Page

Admin pages are Server Components that query Prisma directly and drop thin client
islands in for interactivity. Follow `@rules/backend.md` and `@rules/frontend.md`.

## Ask first (if unclear)

1. **Who may see it** — ADMIN-only (`requireAdminPage()`), or ADMIN + branch-scoped MANAGER (dashboard/orders style, via a `requireDashboardAccess`-gated loader)?
2. **Must it be live** (revenue, order queues, moderation) → `export const dynamic = "force-dynamic"`, or is cached acceptable?
3. **Is the data branch-scoped?** If it reads orders/revenue, it MUST spread `branchWhere`.

## Non-negotiable checklist

- [ ] Server Component — **no `"use client"`** on the page. Data via Prisma in the body or a server-only loader (`dashboard.ts`/`analytics.ts` style), **not** a client fetch.
- [ ] **Auth gate at the top.** ADMIN-only page → `requireAdminPage()` (redirects a MANAGER to `/admin`). Manager-accessible page → put the gate in the loader via `requireDashboardAccess()` + `resolveBranchScope()`; the coarse `admin/layout.tsx` gate is not enough.
- [ ] Live surfaces (dashboard, orders, reviews, analytics) → `export const dynamic = "force-dynamic"` — a stale revenue number misleads the operator.
- [ ] Batch all reads into **one `Promise.all`** — one parallel round-trip, not a sequential waterfall.
- [ ] Every order/revenue query spreads `branchWhere` at the top level (cross-branch leak otherwise). Revenue counts `DELIVERED` only; date windows use `src/lib/timezone.ts` (Cairo). See `@rules/business-logic.md`.
- [ ] `.toNumber()` every `Decimal` before passing it to a client island (charts, tables). Never serialize a raw `Decimal`.
- [ ] Filters/search/pagination live in `searchParams` (validate enums like `status` before use); cursor pagination, not offset `skip`, for large lists.

## Reference template (ADMIN-only, live)

```tsx
// src/app/admin/widgets/page.tsx
import { requireAdminPage } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { WidgetTable } from "@/components/admin/WidgetTable";

export const dynamic = "force-dynamic";

export default async function AdminWidgetsPage() {
  await requireAdminPage();

  const [widgets, pendingCount] = await Promise.all([
    prisma.widget.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.widget.count({ where: { isApproved: false } }),
  ]);

  // Coerce Decimal money to plain numbers before it crosses to a client island.
  const rows = widgets.map((w) => ({ ...w, price: w.price.toNumber() }));

  return <WidgetTable rows={rows} pendingCount={pendingCount} />;
}
```

For a **branch-scoped** page, drop `requireAdminPage()` and instead call a loader
that runs `requireDashboardAccess()` + `resolveBranchScope()` and `AND`s `branchWhere`
into every query (mirror `getDashboardStats` / `getOrders` in `dashboard.ts`). Render
the scope in the copy ("Here's what's happening at {branchName}…") and handle the
branchless-manager empty state gracefully rather than throwing to a 500.
