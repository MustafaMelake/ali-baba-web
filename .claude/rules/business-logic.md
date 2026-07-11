# Business-Logic Rules — Pricing, Money, Fulfillment & Time

These are the domain invariants that protect the client's margins and books. They
run through the highest-blast-radius modules in the platform (`src/lib/discounts.ts`,
`placeOrder`, `src/lib/timezone.ts`). Treat every rule here as load-bearing.

## The Discount Engine (`src/lib/discounts.ts`) — one pure resolver, every surface

The engine is a **pure, dependency-free module** (no Prisma, no React) shared by all seven price surfaces: shop cards, category cards, PDP, homepage badge, logged-in cart hydration, guest re-pricing, wishlist cards — **and `placeOrder`'s billing**. That shared usage is *the* mechanism guaranteeing the shown price equals the billed price. **Never re-implement discount math inside a component** — cards and the PDP call the same functions; the math only ever lives in `discounts.ts`.

The three helpers a surface uses:

- `livePromotionWhere(now)` — a Prisma `where` (`isActive && startDate ≤ now ≤ endDate`) spread into every `promotions` include, alongside `PROMOTION_SELECT_FIELDS` for a uniform shape.
- `gatherPromotions(variantPromos, productPromos, categoryPromos)` — merges + de-dupes (by id) the three targeting levels. A promotion applies to a variant if it targets the **variant**, its **parent product**, or that product's **category**.
- `resolvePrice(basePrice, promos, now)` → `{ basePrice, finalPrice, discountAmount, hasDiscount, appliedPromotion }`.

### "Cheapest Wins" — the formalized overlap rule

When several live promotions apply, **exactly one** applies: the one yielding the **lowest** final price (best for the customer). Promotions **never stack**. There is deliberately **no priority/exclusivity field** — don't add one. `ProductVariant.compareAtPrice` is a purely **visual** manual "was" price (a strikethrough fallback shown only when no live promotion applies); it is **never an input to the discount math**.

### Single `now` per request — mandatory

Capture `const now = new Date()` **once** per request and pass the *same* instant to both `livePromotionWhere(now)` (the DB filter) and `resolvePrice(…, now)` (the in-memory re-check). This is what stops a promotion expiring mid-render/mid-loop from pricing two lines of one order against different instants. Any new consumer must follow it.

## Money math — `roundMoney` is the 2-dp authority

- All currency rounds through `roundMoney` (`Math.round((n + Number.EPSILON) * 100) / 100`); discounts floor at 0.
- **Order of operations (never reorder):** per-line discount **first** → `subtotal = roundMoney(Σ discounted line × qty)` → `vat = isVatEnabled ? roundMoney(subtotal × vatRate) : 0` (on the **discounted** subtotal) → `deliveryFee` (DELIVERY → `roundMoney(branch.deliveryFee ?? settings.defaultDeliveryFee)`; PICKUP → 0) → `totalAmount = roundMoney(subtotal + deliveryFee + vat)`. **Four rounding points**; nothing off-grid reaches the `Decimal` columns. VAT and delivery never apply to the pre-discount price.

## VAT is a residual — not a stored column

Only `subtotal`, `deliveryFee`, and `totalAmount` persist. Every receipt derives VAT as `Math.max(0, totalAmount - subtotal - deliveryFee)`. This guarantees the breakdown always reconciles to the total and lets legacy orders (flat-fee, no-VAT era) render `VAT 0` instead of `NaN`. The invariant `total = subtotal + fee + vat` couples three read sites (`dashboard.ts`, `/my-orders`, the admin order drawer) — changing how VAT is stored means touching all three.

## `placeOrder` — the price-integrity boundary

The most consequential write path. The client sends only `{ variantId, quantity }[]` + fulfillment + contact + a resolved `branchId` — **no price ever crosses the wire.** Server-side, inside a two-statement transaction: batched `findMany({ id: { in: … } })` with the three-level live-promotion hierarchy → in-memory loop that **throws (rolls back the whole order)** on any missing/unavailable variant or parent product → `resolvePrice` per line → the discounted `finalPrice` is **snapshotted** onto `OrderItem`. Order preconditions: shared `checkoutSchema` validation (a DELIVERY order **must** carry a non-empty `addressLine`), and a per-phone throttle (**≤ 3 simultaneously-`PENDING` orders per exact `customerPhone`** — Egypt COD fake-order protection). Never thread a client price into the payload "for convenience."

## Reporting — two formalized rules

1. **Revenue strictly counts `DELIVERED` orders only** — not "non-cancelled." Unconfirmed PENDING/PREPARING/SHIPPED cash is never revenue. Every revenue aggregate, groupBy, and raw rollup (dashboard, branch sales, star-of-month, top products) carries `status: DELIVERED`. **Order-*volume* counters** (today/yesterday, peak hours) deliberately stay status-agnostic (they exclude at most `CANCELLED`) — they measure activity, not money.
2. **Every business "day"/"month" is an `Africa/Cairo` calendar boundary**, expressed as an exact UTC instant. Use `src/lib/timezone.ts` (`STORE_TZ`, `storeMidnight`, `storeMonthStart`, `storeDayKey`) — **DST-safe** (Egypt reinstated DST in 2023; a hardcoded UTC+2 is wrong for part of the year) and **never the Node server's local clock**. Raw-SQL analytics do the equivalent with `AT TIME ZONE`, importing the same `STORE_TZ` so JS and SQL agree on the store day.

## Branches — four hats, soft retirement

A `Branch` is simultaneously a **pickup point**, a **delivery area**, the **per-branch delivery-fee source**, and the **unit of MANAGER RBAC**. Retire with `isActive: false`; deletion is deliberately hard (blocked by `User.branch` Restrict). At checkout the `"Other Areas"` option is a client-side sentinel (`id: "__other__"`) that maps to `branchId: null` (→ unassigned → Super-Admin-only) — **it must never reach the server.** The delivery fee shipped to the client is display-only; `placeOrder` re-reads the fee from the real, active branch row.

## Cart sync — identity & intent, never money

`CartItem` persists only `{ userId, variantId, quantity }` — no price column; `getDbCartAction` re-resolves price on every read. The store keys everything on `variantId`. A **record-then-confirm `pendingOps` ledger** writes intent to `localStorage` before each logged-in sync leaves and clears it only on exact-match confirmation, so a failed sync replays on the next hydrate. `CartSyncProvider` distinguishes **hydrate** (already-logged-in on mount — plain adopt, never sum) from the **one true merge** (guest → logged-in — server SUMs, clamped). Shared limits from `@/lib/validators`: `CHECKOUT_MAX_QUANTITY = 99` (per line) and `CHECKOUT_MAX_ITEMS = 50` (distinct lines, enforced by the store, the cart actions, `checkoutSchema`, and the DB-cart cap alike).

## Reviews

Auth-gated (no anonymous path); `userId` + `authorName` come from the session, **never** form input (`authorName` is a point-in-time snapshot). Created `isApproved: false` — invisible until an admin approves. Moderation revalidates the queue always, and the public PDP only when the change affects it.
