# Admin Dashboard — Technical Architecture & Walkthrough

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · Prisma 7 · PostgreSQL (Neon) · Better Auth

This document is a hand-off reference for the e-commerce admin dashboard. It covers system architecture, the relational data model, the three core modules (Analytics, Products, Reviews), and the cross-cutting error-handling/UX conventions that make the surface production-grade.

---

## 1. System Architecture & Stack Overview

### Server Components by default, Client Components by exception

Every route under `/admin` is a Server Component (`page.tsx` with no `"use client"`). Data is fetched directly with Prisma inside the component body — there is no API route, no client-side `fetch`, no loading spinner on first paint. Concretely:

- [`src/app/admin/products/page.tsx`](../src/app/admin/products/page.tsx) and [`src/app/admin/products/[id]/edit/page.tsx`](../src/app/admin/products/[id]/edit/page.tsx) run `prisma.product.findMany` / `findUnique` server-side, in parallel with their sibling lookups via `Promise.all`.
- [`src/app/admin/page.tsx`](../src/app/admin/page.tsx) (the dashboard) and [`src/app/admin/reviews/page.tsx`](../src/app/admin/reviews/page.tsx) both export `export const dynamic = "force-dynamic"`, explicitly opting out of Next's full-route caching. Both surfaces must reflect the database at request time — a stale cached dashboard or a moderation queue that doesn't show a review submitted seconds ago would actively mislead an admin.

This split is deliberate for two reasons:

1. **Security** — Prisma, `DATABASE_URL`, and `requireAdmin()` checks never leave the server. There is no client-exposed data-fetching endpoint for an attacker to probe; the admin bundle ships zero database credentials or query logic.
2. **Performance** — the page HTML arrives already populated. No second round-trip, no client-side waterfall, no hydration-then-fetch flash of empty state.

**Client Components** are reserved for the narrow slice of the tree that needs interactivity: form state, optimistic transitions, animated confirmations. Examples: [`EditProductForm.tsx`](../src/components/admin/EditProductForm.tsx), [`ProductRowActions.tsx`](../src/components/admin/ProductRowActions.tsx), [`ReviewActions.tsx`](../src/components/admin/ReviewActions.tsx), [`ReviewForm.tsx`](../src/components/ReviewForm.tsx). Each is a thin leaf — a Server Component page renders mostly-static markup and drops a Client Component in at the exact point where state is needed, keeping the client JS bundle minimal.

### Mutations: Server Actions + `useTransition`, no client-side data layer

There is no Redux/React Query/SWR anywhere in the admin. Every write goes through a `"use server"` action (e.g. [`src/app/admin/products/actions.ts`](../src/app/admin/products/actions.ts), [`src/lib/actions/reviews.ts`](../src/lib/actions/reviews.ts)) called directly from a Client Component, wrapped in React 19's `useTransition`:

```tsx
const [isPending, startTransition] = useTransition();

function handleDelete() {
  startTransition(async () => {
    const result = await deleteProduct(id);
    if (!result.success) { toast.error(result.error); return; }
    toast.success("Product deleted");
    router.refresh();
  });
}
```

`startTransition` marks the async call as a non-blocking transition: the UI stays interactive and `isPending` flips a button into a spinner state without a full navigation or page reload. On success, `router.refresh()` re-runs the Server Component tree for the current route — re-fetching from Prisma — so the page reflects the new database state without a hard reload. This is the same pattern used for every mutation in the dashboard: create/update/delete products, approve/delete reviews.

---

## 2. Database Schema & Relations (Prisma 7)

### Environment isolation

Prisma 7 separates the CLI's configuration from the runtime client. [`prisma.config.ts`](../prisma.config.ts) is the single source of truth for where the schema and migrations live and which connection string the **CLI** uses (`migrate`, `studio`, `db push`):

```ts
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env["DATABASE_URL"] },
});
```

At runtime, [`src/lib/prisma.ts`](../src/lib/prisma.ts) constructs the actual `PrismaClient` independently, via the `@prisma/adapter-pg` driver adapter over `pg`, and fails fast if `DATABASE_URL` is missing:

```ts
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set. Add it to your .env file.");

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
```

The module-level singleton (cached on `globalThis` outside production) prevents Next.js's dev-mode module reloading from exhausting Postgres connections with a fresh `PrismaClient` on every hot reload.

### Core relations

```
Category ──< Product >── MenuPage
                │
                ├──< ProductVariant >── OrderItem >── Order
                │
                └──< Review >── User
```

- **`Product` → `Category` / `MenuPage`** (`onDelete: Restrict` on both): a product is classified by a `Category` and displayed on a `MenuPage`. Restrict means a category or menu page that still has products can't be deleted out from under them.
- **`Product` → `ProductVariant`** (`onDelete: Cascade`): variants are the actual purchasable unit — price lives *only* here, never on `Product`. Deleting a product cleanly cascades to its variants.
- **`ProductVariant` → `OrderItem`** (`onDelete: Restrict`): this is the one Restrict relation the whole CRUD safety model is built around (see §4). A variant that has ever shipped in an order cannot be hard-deleted, full stop — order history is immutable.
- **`OrderItem`** stores a **snapshot** (`productName`, `variantName`, `unitPrice`) captured at purchase time, independent of whatever the product/variant look like later. Orders never need a join back to a live, possibly-edited or possibly-deleted product to render correctly.
- **`Review` → `User` / `Product`** (`onDelete: Cascade` on both): a review is always tied to an authenticated `User` (no anonymous/guest reviews — see §5) and a `Product`.

### `@@unique([userId, productId])` on `Review`

```prisma
model Review {
  ...
  userId    String
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  productId String
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([userId, productId])
  @@index([productId])
  @@index([isApproved])
}
```

This composite unique index is the database-level guarantee behind the one-review-per-customer-per-product rule: Postgres rejects a second `INSERT` for the same `(userId, productId)` pair outright, regardless of what application code does or doesn't check beforehand. It also doubles as the lookup index for "has this user already reviewed this product" queries (`userId` is the leading column). The moderation queue's `@@index([isApproved])` exists for the opposite read pattern — pulling all pending reviews fast regardless of which user or product they belong to.

---

## 3. Module 1: Analytics & Overview Dashboard

[`src/app/admin/page.tsx`](../src/app/admin/page.tsx) renders four headline metrics and a 30-day revenue trend, computed directly from Prisma aggregates — no separate analytics service or cron-computed rollup table.

| Metric | Query | Trend basis |
|---|---|---|
| **Total Revenue** | `order.aggregate({ _sum: { totalAmount } , where: { status: { not: CANCELLED } } })` | last-30-days sum vs. the prior 30 days |
| **Orders Today** | `order.count({ createdAt: { gte: todayStart } })` | vs. yesterday's count |
| **Active Products** | `product.count({ isAvailable: true })` | products created in the last 30 days |
| **Customers** | `user.count({ role: "USER" })` | new signups in the last 30 days |

All eleven queries (four metrics + their comparison windows + recent orders + chart data) run inside a single `Promise.all`, so the page issues one parallel batch to Postgres rather than a sequential waterfall.

**Revenue chart:** orders from the last 30 days are pulled with only `{ createdAt, totalAmount }` selected, then bucketed in-memory into 30 calendar-day buckets (keyed by `year-month-day`) and handed to [`RevenueChart`](../src/components/admin/RevenueChart.tsx) (Recharts) as a `{ date, revenue }[]` series. Bucketing happens in application code rather than a Postgres `GROUP BY ... DATE_TRUNC` — acceptable at current data volume, and keeps timezone bucketing (`startOfDay` uses the server's local time) explicit and easy to reason about.

**Recent Orders feed:** the five most recent orders (`orderBy: { createdAt: "desc" }, take: 5`), rendered with a status pill (`PENDING` → `DELIVERED` → `CANCELLED`, color-coded) and formatted amount. Since the page is `force-dynamic`, this is a live view, not a cached snapshot — refreshing the page always shows the true current order queue.

---

## 4. Module 2: Bulletproof Product Management (CRUD)

### Read

[`src/app/admin/products/page.tsx`](../src/app/admin/products/page.tsx) lists all products `orderBy: { createdAt: "desc" }` (newest first), including each product's `category.name` and its `variants[].price`. Since price lives on the variant, not the product, the list view derives a display price with `Math.min(...prices)` and prefixes it with "from" whenever a product has more than one variant — there is no single canonical "the" price for a multi-variant product.

### Smart Update Flow

[`updateProduct`](../src/app/admin/products/actions.ts) is the most intricate action in the codebase because it has to reconcile an *entire variant list* in one submission — some variants kept, some edited, some brand new, some removed — without ever corrupting order history. The algorithm:

1. **Auth + validation gate.** `requireAdmin()` first; then `productUpdateSchema.safeParse(input)` (shared Zod schema — the same one the client form uses for instant feedback, re-run server-side because the client is never trusted).
2. **Classify incoming variants** against the product's *current* variant set:
   - `existingIds` = the product's variant ids in the DB.
   - `keptIds` = incoming variant ids that are both present in the payload *and* actually belong to this product (guards against a forged/stale id from elsewhere).
   - `removedIds` = `existingIds − keptIds` — variants the admin deleted from the form.
3. **Pre-flight slug check.** A separate `findUnique({ where: { slug } })` runs before the transaction so a slug collision returns a clean `"A product with this slug already exists."` instead of surfacing a raw constraint error mid-transaction.
4. **Transactional core update.** Inside `prisma.$transaction`: update the product's scalar fields, then for each incoming variant either `update` (if its id is in `keptIds`) or `create` (if it has no id, or an id that doesn't belong to this product) — `sortOrder` is set to its index in the submitted array, so on-screen reordering persists.
5. **Post-commit variant cleanup — the safety-critical step.** For each id in `removedIds`, attempt a hard `delete`. Two outcomes:
   - **Succeeds** → the variant was never ordered; it's gone.
   - **Throws P2003** (foreign key violation, because `OrderItem.variant` is `onDelete: Restrict`) → the variant is part of at least one historical order and *cannot* be deleted without destroying that order's referential integrity. The action catches this specific error code and **archives** the variant instead (`isAvailable: false`, `sku: null` to free the SKU for reuse) rather than deleting it. The number of archived variants is returned to the client (`archivedCount`), and [`EditProductForm`](../src/components/admin/EditProductForm.tsx) surfaces it as a `toast.warning`: *"N variant(s) couldn't be deleted (part of existing orders) and were hidden instead."*

This cleanup deliberately runs **after** the transaction commits — a P2003 during cleanup must never roll back an otherwise-valid product update. The two phases have different correctness requirements (the core update is all-or-nothing; the cleanup is best-effort-per-variant), so they're not forced into one transaction.

### Safe Deletion Flow

[`deleteProduct`](../src/app/admin/products/actions.ts) is a single `prisma.product.delete`, but the interesting part is what it does on failure:

```ts
try {
  await prisma.product.delete({ where: { id } });
} catch (err) {
  if (code === "P2003") {
    return { success: false, error: "This product appears in existing orders and can't be deleted. Mark it Out of Stock instead." };
  }
  if (code === "P2025") {
    return { success: false, error: "That product no longer exists." };
  }
  console.error("deleteProduct failed:", err);
  return { success: false, error: "Could not delete the product. Please try again." };
}
```

**Order History Protection:** because `ProductVariant → OrderItem` is `onDelete: Restrict`, attempting to delete a product that has ever sold a unit fails the database constraint *before* any row is touched. Without this catch, that failure would propagate as an unhandled exception → Next.js 500. Instead, the action recognizes Prisma's `P2003` code and converts it into the exact corrective instruction the admin needs: stop trying to delete it, mark it unavailable instead. The same pattern (`P2025` = "record already gone", typically from a double-click or a stale list) returns a clean message rather than a generic crash. [`ProductRowActions.tsx`](../src/components/admin/ProductRowActions.tsx) renders this as an inline `framer-motion` confirm-in-place control (see §6) and surfaces the result via `sonner`.

---

## 5. Module 3: Secure & Moderated Reviews System

### Authentication Gate

[`submitProductReview`](../src/lib/actions/reviews.ts) never accepts a reviewer identity from the client. It calls `getServerSession()` (Better Auth, wrapped in React's `cache()` in [`src/lib/session.ts`](../src/lib/session.ts) so repeated calls in one request don't re-hit the auth layer) and rejects unauthenticated callers outright:

```ts
const session = await getServerSession();
if (!session) return { success: false, error: "Please log in to leave a review." };
```

`userId` and `authorName` are then taken **only** from `session.user` — `authorName` is a point-in-time snapshot of the display name at submission, decoupled from whatever the user later renames their account to. There is no `name` field in the submitted `FormData` at all; the form only collects `rating` and `comment`. Every new review is created with `isApproved: false` — nothing a customer submits is ever visible until an admin explicitly approves it.

### Anti-Spam Mechanism

The `@@unique([userId, productId])` constraint on `Review` (§2) is enforced at the database layer, so `submitProductReview` doesn't need an extra pre-check query — it simply attempts the `create` and handles the failure:

```ts
try {
  await prisma.review.create({ data: { productId, userId: session.user.id, ... } });
  ...
} catch (err) {
  if (prismaErrorCode(err) === "P2002") {
    return { success: false, error: "You've already reviewed this product." };
  }
  ...
}
```

This is the same defensive pattern used throughout the codebase: let Postgres be the single source of truth for the invariant, and translate its error code into a clean, specific user-facing message rather than either (a) trusting an application-level check that could race under concurrent requests, or (b) leaking a raw constraint-violation message.

### Admin Moderation Panel (`/admin/reviews`)

[`src/app/admin/reviews/page.tsx`](../src/app/admin/reviews/page.tsx) queries all reviews with a compound sort — `orderBy: [{ isApproved: "asc" }, { createdAt: "desc" }]` — so every pending review (`isApproved: false` sorts first under `asc`) surfaces above the already-approved backlog, newest-first within each group. A pending counter badge in the page header (`pendingCount`) gives the admin an at-a-glance queue size.

Each review row exposes [`ReviewActions`](../src/components/admin/ReviewActions.tsx) — Approve (hidden once already approved) and Delete/Reject (always available, used both to reject a pending review and to remove a published one). Both actions call their respective server action, then `revalidatePath`:

```ts
revalidatePath("/admin/reviews");                       // moderation queue
revalidatePath(`/product/${review.product.slug}`);      // public product page
```

`approveReview` always revalidates both paths (a newly-approved review needs to appear publicly). `deleteReview` only revalidates the public product page if the deleted review `isApproved` was `true` — deleting a still-pending review can't have changed anything the public page renders, so the extra revalidation is skipped.

---

## 6. Error Handling, UX, and Edge Cases

### Predictable result shapes, never a thrown exception to the client

Every Server Action in this codebase returns a discriminated union instead of throwing:

```ts
type UpdateProductResult = { success: true; archivedCount: number } | { success: false; error: string };
```

The body is uniformly `try { ... } catch (err) { return { success: false, error: "..." } }`, with Prisma error codes (`P2002`, `P2003`, `P2025`) inspected via a small shared `prismaErrorCode(err)` helper and mapped to a specific, actionable message; anything unrecognized falls through to a generic message plus a `console.error` for server-side diagnosis. The client side never needs a try/catch around a Server Action call — it checks `result.success` and branches. This is what makes the `useTransition` + `toast` pattern safe to apply uniformly across the whole admin: the action contract guarantees a result is always returned, never an unhandled rejection.

### Premium interaction details

- **Inline `framer-motion` delete confirmation** — [`ProductRowActions.tsx`](../src/components/admin/ProductRowActions.tsx) and [`ReviewActions.tsx`](../src/components/admin/ReviewActions.tsx) both replace a destructive button with an inline "Delete? ✓ ✕" control via `AnimatePresence`/`motion.div` (width/opacity transition), rather than a modal — destructive actions stay one click away but require a deliberate second click, with no context-switching dialog.
- **Fractional star rendering** — [`StarRating.tsx`](../src/components/StarRating.tsx) is a zero-hook, server-renderable component: a grey 5-star row sits underneath, and an identical amber 5-star row is absolutely positioned on top and clipped with `width: {pct}%` (`pct = (rating / 5) * 100`), producing a precisely partial-filled star (e.g. 4.3/5) with two `<span>` layers and no canvas/SVG math.
- **Immediate feedback via `sonner`** — every mutation pairs its `useTransition` callback with a `toast.success` / `toast.error` (and, for the archived-variant case, `toast.warning`), so the admin gets confirmation or a specific failure reason the instant a transition resolves, without waiting on a page navigation.
