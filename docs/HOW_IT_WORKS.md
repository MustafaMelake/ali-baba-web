# Admin Dashboard — How It Works

**Audience:** new developers onboarding onto the codebase, and stakeholders who want an accurate picture of what's been built.
**Companion doc:** for line-by-line implementation detail, see [`ARCHITECTURE.md`](./ARCHITECTURE.md). This report stays at the operational level — what happens, in what order, and why.

---

## 1. Executive Summary

The Admin Dashboard is the operational control center for the platform's e-commerce side: catalog management, order visibility, revenue analytics, and customer review moderation, all behind an authenticated, role-gated `/admin` surface.

**Tech stack:**

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI runtime | React 19 |
| Mutations | Server Actions (`"use server"`) — no separate REST/GraphQL API layer |
| Database | PostgreSQL (Neon), accessed via Prisma 7 with the `@prisma/adapter-pg` driver adapter |
| Auth | Better Auth (session-based, role field on `User`: `USER` \| `ADMIN`) |
| Styling | Tailwind CSS v4 |
| Motion / feedback | `framer-motion` for inline transitions, `sonner` for toasts |

**Design philosophy:** every admin page renders fully populated on first load — no spinner-then-fetch — because data comes from Prisma queries running directly inside Server Components. Every mutation (create, edit, delete, approve, reject) happens through a Server Action invoked from a small Client Component, wrapped in React's `useTransition` so the UI never blocks or full-page-reloads. The result is a dashboard that *feels* like a single-page app while staying server-rendered, server-validated, and credential-free on the client.

---

## 2. Dashboard Overview & Analytics

The landing page at `/admin` ([`src/app/admin/page.tsx`](../src/app/admin/page.tsx)) is marked `export const dynamic = "force-dynamic"` — it intentionally opts out of Next's route caching, because a stale revenue number or order count would actively mislead whoever's looking at it.

**How the four headline metrics are produced:**

- **Total Revenue** — sum of `totalAmount` across all non-cancelled orders (`prisma.order.aggregate`).
- **Orders Today** — count of orders created since local midnight.
- **Active Products** — count of products flagged `isAvailable: true`.
- **Customers** — count of `User` rows with `role: "USER"`.

Each metric is paired with a trend badge. Revenue and Orders compare the current period against the prior one of equal length (last 30 days vs. the 30 before that; today vs. yesterday) and render a percentage delta. Products and Customers instead show a simple "+N new" count, since a percentage comparison is less meaningful for slower-moving totals.

All of this — the four metrics, their comparison-period counterparts, the recent-orders list, and the chart's raw data — is fetched in **one parallel `Promise.all` batch**, not a sequence of awaited queries. The page issues its full set of reads to Postgres at once and waits for the slowest one, rather than waiting on each in turn.

**The revenue chart** (Recharts, via [`RevenueChart.tsx`](../src/components/admin/RevenueChart.tsx)) is fed by pulling every non-cancelled order from the last 30 days and bucketing its `totalAmount` into the calendar day it was created, entirely in application code. The result is a 30-point `{ date, revenue }` series — a true day-by-day revenue trend, not a sampled or estimated one.

**The Recent Orders feed** shows the five newest orders with a color-coded status pill (`Pending` → `Preparing` → `Shipped` → `Delivered`, or `Cancelled`) and the order total — a live look at what's currently moving through the business, refreshed on every page load.

---

## 3. Product Management Lifecycle (CRUD)

### Listing

`/admin/products` ([`src/app/admin/products/page.tsx`](../src/app/admin/products/page.tsx)) fetches every product newest-first, joined with its category name and the price of each of its variants. Because **price lives on the variant, not the product** (a product can be sold in multiple sizes/formats at different prices), the list shows a derived "from ₴X" price — the minimum across that product's variants — rather than a single fixed price.

### Creation & Updating

Creating a product ([`createProduct`](../src/app/admin/products/actions.ts)) is a straightforward validated insert: the form payload is re-validated server-side against the same Zod schema the client uses (never trusting client-side validation alone), then the product and its first variant are created together in one nested Prisma write.

**Updating is the more delicate operation**, because an edit can simultaneously: keep some variants unchanged, edit others, add brand-new ones, and remove others — all in a single form submission. [`updateProduct`](../src/app/admin/products/actions.ts) handles this in two phases:

1. **Inside a database transaction:** the product's own fields are updated, and each submitted variant is either updated in place (if its id already belongs to this product) or created fresh (if it's new). If anything in this phase fails, the whole update rolls back — the product is never left half-updated.
2. **After the transaction commits:** any variant that existed before but is missing from the new submission is treated as "removed" by the admin, and the system attempts to actually delete it.

This second phase is where order-history safety kicks in — covered next, since it's the same mechanism used for full product deletion.

### Safe Deletion

Both "remove this variant" and "delete this whole product" run into the same database rule: a `ProductVariant` that has ever appeared in a placed order **cannot be deleted**, because the `Order Item → Variant` relationship is configured with referential-integrity protection (`onDelete: Restrict`) — Postgres will refuse the delete rather than risk an order that references a missing item.

Rather than letting that refusal surface as a server crash, both flows catch it specifically:

- **Removing a variant during an edit:** if the hard-delete is rejected, the action falls back to *archiving* the variant instead (marks it unavailable and frees its SKU) so it disappears from sale without breaking any past order. The admin is told via a toast: *"N variant(s) couldn't be deleted (part of existing orders) and were hidden instead."*
- **Deleting an entire product:** if any of its variants are tied to an order, the delete is rejected the same way, and the admin sees: *"This product appears in existing orders and can't be deleted. Mark it Out of Stock instead."*

In both cases, the underlying Prisma/Postgres error code is `P2003` (foreign-key constraint violation). The action layer recognizes that specific code and translates it into a precise, actionable instruction — instead of a generic 500 error, the admin is told exactly what happened and exactly what to do about it. Order history is never compromised, and the admin is never left guessing why a delete "didn't work."

---

## 4. Review Moderation System

### Submission & the authentication gate

Customers submit reviews from the product detail page via [`ReviewForm.tsx`](../src/components/ReviewForm.tsx), which posts to the [`submitProductReview`](../src/lib/actions/reviews.ts) server action. Before anything else happens, the action checks for an active session (`getServerSession()`) and rejects the submission outright if there isn't one — **there is no anonymous review path.**

Critically, the reviewer's identity is never taken from form input. The `userId` and the display name shown on the review are both pulled directly from the authenticated session server-side, not from anything the browser sends. A user cannot submit a review *as* someone else, and cannot inject an arbitrary name.

Every new review is created with `isApproved: false` by default — nothing a customer submits is visible to other shoppers until an admin acts on it.

### Anti-spam: one review per customer per product

The database enforces a unique constraint on the combination of `userId` and `productId` on the `Review` table. This means Postgres itself will refuse a second review from the same customer on the same product — it's not a soft application-level check that could be bypassed by a race condition or a retried request; it's a hard guarantee at the data layer.

When a customer who's already reviewed a product tries again, that database refusal comes back as error code `P2002` (unique constraint violation). The action catches this specific code and turns it into a clean message — *"You've already reviewed this product."* — instead of a generic failure. The net effect: every customer gets exactly one voice per product, enforced in a way that can't be raced or bypassed.

### Admin moderation

`/admin/reviews` ([`src/app/admin/reviews/page.tsx`](../src/app/admin/reviews/page.tsx)) lists every review with pending ones sorted to the top, newest-first within each group — so the admin's attention goes straight to the moderation backlog rather than scrolling past everything already handled. A badge in the page header shows the live pending count.

Each review carries two actions:

- **Approve** — flips `isApproved` to `true`. Only shown for reviews not yet approved.
- **Reject / Delete** — permanently removes the review. The same action serves both "reject a pending submission" and "take down an already-published review"; the button label changes accordingly.

Both actions immediately refresh two surfaces: the moderation queue itself, and — only when relevant — the public product page the review belongs to (an approval always needs the public page refreshed; deleting a review that was never approved doesn't, since the public page never showed it). This targeted cache invalidation (`revalidatePath`) means an approval becomes visible to customers within the same request cycle, with no manual cache-busting step.

---

## 5. State Management & UI/UX

There is deliberately **no client-side global state library** anywhere in the admin (no Redux, no React Query/SWR cache). The dashboard gets its "instant" feel from three coordinated techniques instead:

1. **Server Components as the default data layer.** Every page fetches its own data directly from Prisma at render time. The HTML that reaches the browser is already complete — there's nothing to "load in" after the fact.
2. **`useTransition` for every mutation.** Each interactive control (delete a product, approve a review, save an edit) calls its Server Action inside `startTransition(async () => { ... })`. This marks the call as a non-urgent update: the page stays fully interactive while it's in flight, and a single `isPending` flag drives a button's spinner state. When the action resolves, `router.refresh()` re-runs the current route's Server Components — pulling fresh data from the database — without a full page reload or losing scroll position.
3. **Predictable action results, never thrown exceptions.** Every Server Action returns a consistent `{ success: true, ... } | { success: false, error: string }` shape. The calling component never needs its own try/catch — it checks `result.success` and either shows a `sonner.toast.success(...)` or a `sonner.toast.error(result.error)` with a message that's already specific and human-readable (the action did the work of translating raw database errors like `P2002`/`P2003` into plain language before the client ever sees them).

**Notable interaction polish:**

- **Inline delete confirmation.** Clicking delete (on a product row, or a review) doesn't open a modal — it morphs the button itself into a compact "Delete? ✓ ✕" control via `framer-motion`'s `AnimatePresence`, requiring one deliberate extra click before anything destructive happens, with no jarring context switch.
- **Fractional star ratings.** The star display used throughout (`StarRating.tsx`) renders a precise partial fill (e.g., 4.3 out of 5) using two layered star rows and a CSS width clip — no canvas, no SVG path math, and it needs no client-side JavaScript at all, so it renders straight from the server.
- **Toast-driven feedback everywhere.** Every create, update, delete, approve, and reject ends with an immediate `sonner` toast — success, error, or (for the archived-variant case) a warning — so the admin always knows the outcome of an action the moment it completes, without needing to infer it from a page state change.

---

### In one sentence

The admin dashboard is server-rendered and server-validated end to end — Prisma queries and Server Actions do all the real work, the database's own constraints (`P2003` for order history, `P2002` for review spam) are treated as the source of truth rather than re-implemented in application code, and the client side exists only to make those server-side results feel instant.
