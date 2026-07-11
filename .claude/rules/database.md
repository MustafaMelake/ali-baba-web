# Database Rules — Prisma 7 · PostgreSQL (Neon)

The datastore is **PostgreSQL (Neon)**, accessed through **Prisma 7** with the
`@prisma/adapter-pg` driver adapter over `pg`. It is **relational — not MongoDB,
not any document store.** If any source implies otherwise, this is authoritative:
`prisma/schema.prisma` declares `provider = "postgresql"`.

## Layout & environment

- Schema: `prisma/schema.prisma`. Generator `prisma-client` emits to `src/generated/prisma` (**checked in**) — import as `@/generated/prisma/client` and `@/generated/prisma/enums`.
- **CLI vs runtime split (Prisma 7):** `prisma.config.ts` is the single source of truth for schema path, migrations path, and the connection string the **CLI** uses (`migrate`, `studio`, `db push`). At runtime, `src/lib/prisma.ts` builds the `PrismaClient` independently via the driver adapter and **hard-throws if `DATABASE_URL` is missing**. It also sets `dns.setDefaultResultOrder("ipv4first")` (Neon advertises AAAA+A; broken IPv6 caused `ETIMEDOUT`) and memoizes on `globalThis` outside production to survive dev hot-reload without exhausting connections.
- Env contract: `DATABASE_URL` (hard-required at module load), `NEXT_PUBLIC_APP_URL` (optional).

## Money is `Decimal` — everywhere but the VAT rate

Every currency column is `Decimal`, so no binary-float drift accumulates at rest: `ProductVariant.price` / `compareAtPrice`, `Promotion.value`, `Order.subtotal` / `deliveryFee` / `totalAmount`, `OrderItem.unitPrice`, `Branch.deliveryFee`, `StoreSettings.defaultDeliveryFee`, `MenuItem.price`. **The one deliberate exception is `StoreSettings.vatRate` (`Float`)** — it's a rate/fraction (`0.14`), not a currency amount. Prisma returns `Decimal` as objects: **`.toNumber()` at the client-component serialization boundary** (never pass a raw `Decimal` across the RSC boundary); `src/lib/discounts.ts` accepts `number | Decimal`; writes pass plain numbers, which Prisma coerces.

## Prices live ONLY on `ProductVariant`

The cardinal schema rule, enforced everywhere. `Product` has **no** price column. Variants are the purchasable unit; carts and orders carry a `variantId` and the server resolves price at read/bill time. A product's "from ₤X" display price is `min(variants[].price)`, derived. The client never supplies a price anywhere in the platform.

## Deletion physics — the referential-integrity contract

These `onDelete` policies *are* the data-safety model. **Do not weaken them** — flipping any `Restrict` on the order chain to `Cascade` silently destroys order history.

| Relation | Policy | Meaning |
|---|---|---|
| `Product → Category` | **Restrict** | a category with products can't be deleted |
| `Product → ProductVariant` | **Cascade** | deleting a product cascades to its variants… |
| `ProductVariant → OrderItem` | **Restrict** | …**but** an ever-ordered variant can't be hard-deleted — the invariant the whole CRUD-safety model is built on |
| `OrderItem → Order` | Cascade | items die with their order |
| `Order → User` | **SetNull** | orders outlive account deletion |
| `Order → Branch` | **SetNull** | history survives branch deletion; row becomes "unassigned" (Super-Admin-only) |
| `User → Branch` | **Restrict** | a staffed branch can't be deleted (reassign or deactivate first) |
| `Review → User` / `→ Product` | Cascade | reviews die with either |
| `CartItem → User` / `→ ProductVariant` | Cascade | no orphan cart lines |
| `WishlistItem → User` / `→ Product` | Cascade | — |
| `MenuItem → MenuCategory` | Cascade | café items die with their category |

**Ordered variants are archived, not deleted.** When an edit removes a variant that has shipped, `updateProduct` catches the `P2003` **after** the transaction commits and archives it (`isAvailable: false`, `sku: null` to free the SKU) instead of deleting — reporting `archivedCount` to the UI. This cleanup runs post-commit deliberately: a `P2003` must never roll back an otherwise-valid product update.

## Snapshots — order history never joins back to the live catalog

`OrderItem` stores `productName`, `variantName`, `unitPrice` (the **already-discounted** price billed), and `quantity`, captured at purchase. Orders render entirely from these snapshots even after the product/variant is edited or archived. Never join a placed order back to a live `Product`/`Variant` to render it.

## Let the DB own invariants — catch, don't pre-check

Prefer a unique constraint + caught error over an application-level pre-check that can race under concurrency:

- `Review @@unique([userId, productId])` → the `P2002` *is* the "You've already reviewed this product" path (one review per customer per product). Also indexed on `productId` and `isApproved` (moderation queue).
- `CartItem @@unique([userId, variantId])` → the upsert key for cart sync.
- `WishlistItem @@unique([userId, productId])`.
- `StoreSettings` is a **singleton** `id @default("store")` — never create a second row; a missing row is answered from frozen in-memory defaults that must mirror the schema defaults.
- `Category.slug`, `Product.slug`, `Branch.slug`, `MenuCategory.slug`, `Order.orderNumber` are all `@unique`. Slugs are minted once at creation and **never regenerated on rename** (so `/[slug]` links never 404).

## Constraints the schema can't express (enforced in app logic)

- **"MANAGER ⇒ has a `branchId`"** — `branchId` is optional (`USER`/`ADMIN` have none), so it's enforced at two chokepoints: assignment (`updateUserRole` requires a valid branch) and access (`requireDashboardAccess` rejects a branchless manager). See `@rules/backend.md`.
- **`MenuItem` price parity in a fixed-price category** is an admin-workflow convention (bulk `updateMany` multiply), not a DB constraint. If a fixed-price category renders a wrong price, check for divergent `MenuItem.price` rows first.

## Two sealed worlds — don't confuse the models

The commerce catalog (`Category`, `Product`, `ProductVariant`) and the café menu (`MenuCategory`, `MenuItem`) are **different models with no foreign key between them**. The café menu has no variants, no promotions, no cart/order path. Never wire an Add-to-Cart or a `Promotion` onto a `MenuItem`. (`Category` ≠ `MenuCategory`.)

## Migrations & vestigial columns

- Change the schema only via a Prisma migration (`prisma/migrations/`); the generated client is regenerated and checked in.
- **Deleted models/columns — do not reintroduce:** `MenuPage` (+ `Product.menuPageId`), `ProductVariant.sortOrder`, `CategoryType`/`Category.type`/`MenuPage.type`, and the `CategoryIdentifier` enum are all gone. Variants sort strictly by `price: asc` everywhere.
- **Retained-by-decision (not dead code):** `Order.deliveryCity` + the `DeliveryLocation` enum (legacy-order rendering only; checkout no longer writes them) and `Branch.address` / `Branch.phone` (planned roadmap surfaces).
