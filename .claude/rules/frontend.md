# Frontend Rules — RSC, Client Islands & Interaction

Scope: `src/app/**` pages/layouts and `src/components/**`. The mental model is
**Server Components by default, Client Components by exception** — a mostly-static
server-rendered tree with thin interactive leaves dropped in exactly where state
is needed.

## Server vs Client boundary

- **Default to a Server Component.** Fetch data directly with Prisma in the component body (or a server-only loader) — no API route, no client `fetch`, no first-paint spinner. The HTML arrives already populated.
- **Reach for `"use client"` only for interactivity**: form state, `useTransition`, optimistic UI, animation, `useSession()`, portals. Keep islands thin leaves (`ProductPurchasePanel`, `EditProductForm`, `ReviewActions`, `AdminOrderFilters` are the reference shapes).
- **There is NO client-side data layer.** No Redux, React Query, or SWR anywhere. Zustand holds only client-owned UI state, in four narrow stores: the cart (`src/lib/cart-store.ts`, the only persisted one), the wishlist-heart id set (`src/lib/wishlist-store.ts`, see **Caching** below), the admin mobile-nav toggle (`src/lib/admin-ui-store.ts`), and the seasonal-intro latch (`src/lib/seasonal-intro-store.ts`). A new store must be equally narrow — order lists, catalogs, admin tables, analytics are all server state re-derived through Server Components on navigation, never cached in a store.

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

## Caching: never seed per-user state into a shared-cache page

The rule is **not** "personalization forces `force-dynamic`" — that trade was
deliberately reversed. The rule is: a page served from a **shared cache must not
render per-user state at all**. Personalization that would otherwise force a
catalog route dynamic is hydrated client-side instead.

Three modes, and each catalog surface has already picked one — **do not "fix" a
page by moving it between them without a reason that outlives the diff:**

| Surface | Mode | Why |
|---|---|---|
| `/` (homepage — hero slides, slider, locations, FAQs), `/category/[slug]` (+ `/page/[n]`), `/product/[slug]`, `/new-arrivals` (+ `/page/[n]`), `/collections` (+ `/page/[n]`), `/collections/[slug]` (+ `/page/[n]`), `/forgot-password`, `/cart` (shell only — the cart renders client-side) | `export const revalidate = 60` (ISR) | No per-request input, no per-user data → cacheable. This is the perf win the wishlist store exists to protect. |
| `/shop` | **No export** — dynamic by nature | It `await`s `searchParams` for the server-side category filter, which is request-time data. A `revalidate` here would be **inert**, not wrong; don't add one to "make it consistent." |
| `/my-orders`, `/wishlist`, `/account/change-password`, `/admin/**` | `export const dynamic = "force-dynamic"` | Genuinely per-user/per-role server-rendered data with no client-hydration path. |

**A dynamic-segment ISR route also needs `generateStaticParams`.** `revalidate = 60` alone does **not** make `/product/[slug]`, `/category/[slug]`, `/collections/[slug]` or any `/page/[n]` cacheable. With no `generateStaticParams`, Next server-renders a dynamic segment on every request (`ƒ` in the build table; production showed `Cache-Control: private, no-cache, no-store` and a MISS on every hit). Each of these routes exports `generateStaticParams() { return []; }`. Nothing is pre-rendered at build, and each URL renders on its first visit, then serves from the cache (`●`). Leave `dynamicParams` at its default so unknown slugs still reach `notFound()`; that 404 is cached for the window too, which is why create actions bust their new path. `next dev` renders everything per request, so confirm a caching change with `npx next build` (the route table) — never `npm run build`, which runs `migrate deploy`.

**Wishlist hearts hydrate client-side, never server-seeded.** `getWishlistedProductIds()`
is called from **`src/lib/wishlist-store.ts` only** — never from a page. The cached
HTML paints with empty hearts; once `useSession()` resolves, the first `WishlistButton`
to mount calls `ensureLoaded(userId)`, which fetches **once per user** and shares one
`ReadonlySet<string>` across every heart on the page. Toggles are optimistic against
that store and roll back on failure. Guests short-circuit to a known-empty set with no
round-trip, which also wipes the previous user's hearts on sign-out.

So: **do not reintroduce an `initialIsFavorited` server prop** and do not add
`force-dynamic` to a catalog route to make wishlist state work. Both undo a deliberate
decision — the store's docblock calls the dynamic route "the trap this store removes."
Any new personalized affordance on a cached surface follows the same shape: cached
shell, client store keyed by user, one fetch, optimistic writes.

**A per-visitor *layout* preference on a cached surface goes on `<html>`, not in React.**
The phone grid density (2-up / 1-up, `src/lib/grid-density.ts`) is the reference. An
inline `<head>` script in the root layout copies the saved choice from `localStorage`
onto `<html data-grid>` before first paint, and CSS variants (`grid-1up:` / `grid-2up:`)
read it. The toggle only writes the attribute and storage. A preference that changes
layout must never wait for hydration, or it flashes and shifts.

While the store's status is `loading` (or `useSession()` is `isPending`), render the
neutral/empty affordance — see the pulse-skeleton rule in **Auth on the client** above;
a logged-in user must not see a filled heart flash off.

## Search params & Suspense

Any Client Component reading `useSearchParams()` **must** sit under a `<Suspense>` boundary, or the whole route bails to client rendering at build time. `/login` and `/signup` pages are Server Components whose only job is that boundary around a client form that recovers `?redirect=`. Always run a `?redirect=` value through `sanitizeRedirect` from `@/lib/utils` before navigating.

## URL as state

Filters, search, and pagination live in the **URL** (`searchParams`), not client state — bookmarkable, shareable, refresh-proof, and one targeted server query per request. Drive changes with `router.push(pathname + "?" + params, { scroll: false })` inside `useTransition`. Debounce free-text search (~400ms) before it touches the URL. Validate any enum param (e.g. `status`) against the real enum server-side — never trust the raw string in a `where`.

**Pagination — one helper, two URL shapes.** Every list paginates through `src/lib/pagination.ts` + the server `<Pagination>` component (24 per storefront page, 25 per admin page; plain links, `rel=prev/next`, a canonical per page). **ISR routes paginate by PATH segment** (`/category/[slug]/page/[n]`, `/new-arrivals/page/[n]`, `/collections/page/[n]`, `/collections/[slug]/page/[n]`) — `?page=` would read `searchParams` and turn them dynamic, undoing the caching table above. Already-dynamic routes use `?page=` (`/shop`, `/wishlist`, `/my-orders`, admin lists). Page 1 is only ever the bare URL (`/page/1` permanently redirects; `?page=1` is never emitted). A malformed or out-of-range page is `notFound()` — never silently clamped. Changing a filter drops `page`. The admin orders board keeps its cursor pagination.

## Motion & portals

- **framer-motion idioms**: a single shared `layoutId` pill animates between active tabs (`layoutId="admin-status-pill"` / `"order-status-pill"`); destructive actions use an inline confirm-in-place control (`AnimatePresence` width/opacity), not a modal.
- **Every modal dialog and drawer uses `useDialogFocus(open)`** (`src/lib/use-dialog-focus.ts`) on its `role="dialog" aria-modal="true"` element: focus moves in on open (an `autoFocus` field wins), Tab/Shift+Tab stay inside the topmost dialog, and focus returns to the opener on close. Each dialog still owns its Escape handler. (The search palette predates the hook and keeps its own equivalent trap.)
- **Decoration loads lazily and fails silently.** A purely decorative client chunk (the seasonal intro's `SeasonScene`) is `next/dynamic(…, { ssr: false })` from a Client Component (a Server Component can't pass `ssr: false`), rendered only once it will actually show — and its loader **`.catch`es to an empty component**: Next's app-router `dynamic` is a bare `React.lazy`, so a failed chunk fetch (offline, deploy skew) otherwise throws into the route's error boundary and replaces the page. Time anything user-visible from when the chunk *mounts*, not when it was requested (React reveals Suspense content in ~300 ms batches).
- **Portals** (`createPortal(…, document.body)`) guard with a render-time check — `if (typeof document === "undefined") return null;` — **not** a `mounted` flag set in `useEffect` (that trips `react-hooks/set-state-in-effect`). Safe because these drawers start closed, so there's nothing to mismatch.

## Styling

Tailwind v4, token-driven. Serif headings, `stone-*` neutral palette, a single turquoise `primary` accent, `rounded-full` pills. Arabic content (café menu item names) is RTL-scoped per element (`dir="rtl" lang="ar"`) inside the otherwise-LTR shell. The `(shop)` layout owns the single `<main>` and the navbar-clearance padding — **pages must not re-add `pt-16/20`** (documented double-offset hazard).

**Logical properties only in NEW UI — storefront and admin.** The site becomes Arabic + English, so every new component uses direction-agnostic utilities: `start`/`end` (not `left`/`right`), `ps`/`pe`, `ms`/`me`, `text-start`/`text-end`, `rounded-s`/`rounded-e`, `border-s`/`border-e`, and `rtl:` variants for what has no logical form (a horizontal gradient direction, a directional icon flip via `rtl:-scale-x-100`). A carousel/scroller takes a `direction` prop and maps arrow keys to reading direction. Keep UI strings out of the markup where practical (a copy table, as `HERO_COPY` in `src/lib/hero-slides.ts`) — no i18n framework yet, so don't build one. Then RTL is a `dir` flip, not a rewrite; `HeroCarousel` is the reference (verified under `dir="rtl"`). **Existing components are not retrofitted yet** — that's tracked debt (DOMAIN_MAP §18.2), not license to keep writing `ml-`/`pr-`/`left-` in new code.
