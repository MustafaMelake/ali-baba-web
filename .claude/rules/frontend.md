# Frontend Rules — RSC, Client Islands & Interaction

Scope: `src/app/**` pages/layouts and `src/components/**`. The mental model is
**Server Components by default, Client Components by exception** — a mostly-static
server-rendered tree with thin interactive leaves dropped in exactly where state
is needed.

## Server vs Client boundary

- **Default to a Server Component.** Fetch data directly with Prisma in the component body (or a server-only loader) — no API route, no client `fetch`, no first-paint spinner. The HTML arrives already populated.
- **Reach for `"use client"` only for interactivity**: form state, `useTransition`, optimistic UI, animation, `useSession()`, portals. Keep islands thin leaves (`ProductPurchasePanel`, `EditProductForm`, `ReviewActions`, `AdminOrderFilters` are the reference shapes).
- **There is NO client-side data layer.** No Redux, React Query, or SWR anywhere. Zustand is used *only* for the cart (`src/lib/cart-store.ts`). Order lists, wishlist counts, catalogs, admin tables, analytics are all server state re-derived through Server Components on navigation.

## Mutations — the universal pattern

Every mutation (place order, toggle wishlist, change status, edit product, moderate review, toggle promotion) is a Server Action invoked from a Client Component inside `useTransition`:

```tsx
const [isPending, startTransition] = useTransition();

function handleDelete() {
  startTransition(async () => {
    const result = await deleteProduct(id);          // Server Action
    if (!result.success) { toast.error(result.error); return; }  // sonner
    toast.success("Product deleted");
    router.refresh();                                 // re-run the RSC tree
  });
}
```

- **Never wrap a Server Action call in try/catch for the expected path.** Actions always return `{ success }` — branch on it. `isPending` drives the spinner/disabled state.
- **`router.refresh()` after success** re-runs the current route's Server Components (re-querying Prisma) — no full reload, no lost scroll.
- **Optimistic UI is layered with local `useState`** (instant heart flip, highlighted status chip, selected variant pill) and **rolled back** when the result is `{ success: false }`.

## Pricing & money on the client

- The client is **display-only** for price. Add-to-cart passes the Discount-Engine price the customer *saw*; the server re-resolves and re-bills authoritatively (see `@rules/business-logic.md`).
- **Never render or receive a raw Prisma `Decimal` across the RSC→client boundary** — it does not serialize. The server coerces with `.toNumber()` first; `resolvePrice` already returns plain 2-dp numbers.
- **`tabular-nums` on every numeric node that can change at runtime** — PDP hero price, strikethroughs, variant pills, quantity readout, CTA line total, menu prices. This is the CLS guarantee; `60 → 450` must never reflow.

## The cart is keyed by `variantId`, never the product id

Every drawer/summary React key and every store lookup (`addItem`, `removeItem`, `updateQuantity`) keys on `variantId`. Keying on product id is a historical **billing bug** (adds "Cake — Large" onto the "Cake — Small" line and charges 2× Small). The line still carries `id` (product id) for display/PDP links only — never dedup on it.

## Auth on the client

- Session comes from `useSession()` exported by `@/lib/auth-client` (typed `session.user.role` via `inferAdditionalFields`). **Never import from `better-auth` directly.**
- While `useSession()` is `isPending`, render a **pulse skeleton, not "Sign In"** — a logged-in user must never see a Sign-In flash. Apply this guard to any new auth-aware UI.
- "My Orders" / "Wishlist" are an *is-authenticated* check; the "Admin Dashboard" link is a *role* check (`ADMIN`/`MANAGER`).

## Personalization forces `force-dynamic`

Any page that seeds **per-user wishlist hearts** (`/shop`, `/category/[slug]`, the PDP) or reads the session for personalized render must declare `export const dynamic = "force-dynamic"` — an ISR cache would leak one user's state to the next visitor. Carry this forward on every new product-listing surface. Seed `initialIsFavorited` on the server from `getWishlistedProductIds()` (an O(1) `Set` lookup) so the first paint is already correct — no flash-then-pop-in.

## Search params & Suspense

Any Client Component reading `useSearchParams()` **must** sit under a `<Suspense>` boundary, or the whole route bails to client rendering at build time. `/login` and `/signup` pages are Server Components whose only job is that boundary around a client form that recovers `?redirect=`. Always run a `?redirect=` value through `sanitizeRedirect` from `@/lib/utils` before navigating.

## URL as state

Filters, search, and pagination live in the **URL** (`searchParams`), not client state — bookmarkable, shareable, refresh-proof, and one targeted server query per request. Drive changes with `router.push(pathname + "?" + params, { scroll: false })` inside `useTransition`. Debounce free-text search (~400ms) before it touches the URL. Validate any enum param (e.g. `status`) against the real enum server-side — never trust the raw string in a `where`.

## Motion & portals

- **framer-motion idioms**: a single shared `layoutId` pill animates between active tabs (`layoutId="admin-status-pill"` / `"order-status-pill"`); destructive actions use an inline confirm-in-place control (`AnimatePresence` width/opacity), not a modal.
- **Portals** (`createPortal(…, document.body)`) guard with a render-time check — `if (typeof document === "undefined") return null;` — **not** a `mounted` flag set in `useEffect` (that trips `react-hooks/set-state-in-effect`). Safe because these drawers start closed, so there's nothing to mismatch.

## Styling

Tailwind v4, token-driven. Serif headings, `stone-*` neutral palette, a single turquoise `primary` accent, `rounded-full` pills. Arabic content (café menu item names) is RTL-scoped per element (`dir="rtl" lang="ar"`) inside the otherwise-LTR shell. The `(shop)` layout owns the single `<main>` and the navbar-clearance padding — **pages must not re-add `pt-16/20`** (documented double-offset hazard).
