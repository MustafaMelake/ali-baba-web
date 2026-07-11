# Ali Baba Platform — Engineering Charter

A **single Next.js deployment running two businesses**: an e-commerce patisserie
(catalog → cart → checkout → orders → multi-branch fulfillment → admin console)
and a **structurally sealed** dine-in café menu. Built for one client — a
multi-branch patisserie operating in Egypt (Cairo time, EGP, cash-on-delivery).

This file is the always-loaded contract. The modular rule files below are
imported into every session — read them before touching the corresponding layer.

---

## Core stack (authoritative — do not substitute)

| Layer | Choice | Non-negotiable |
|---|---|---|
| Framework | **Next.js 16.2** (App Router, RSC-first) | Server Components are the default data layer. The request interceptor is `src/proxy.ts` — Next 16's renamed middleware, **never** `middleware.ts`. |
| UI runtime | **React 19.2** | `useTransition` for every mutation; `cache()` for request-level dedupe. No `useEffect`-driven loading state. |
| Styling | **Tailwind CSS v4** | Token-driven: serif headings, `stone-*` neutrals, one turquoise `primary` accent, `rounded-full` pills. |
| Database | **PostgreSQL (Neon)** via **Prisma 7** + `@prisma/adapter-pg` | Relational, **not** MongoDB. Every money column is `Decimal` (except `StoreSettings.vatRate`, a `Float` rate). |
| Auth & RBAC | **Better Auth 1.6** | DB-backed sessions (not JWT). `role`: `USER \| ADMIN \| MANAGER`. Read only through `@/lib/session` / `@/lib/auth-client`. |
| Client state | **Zustand 5** (`persist`) | Used narrowly for the cart only, keyed by `variantId`. Everything else is server state. |
| Pricing | **Discount Engine** `src/lib/discounts.ts` | One pure, dependency-free resolver shared by storefront, cart, checkout preview **and** `placeOrder`. |
| Media / feedback / motion | UploadThing · `sonner` · `framer-motion` · Recharts · Embla | Admin-only uploads; a toast on every mutation. |

## The five rules everything else derives from

1. **The server is the only source of truth for price, stock, identity, and permission.** The browser is never trusted with any of them. The client sends `{ variantId, quantity }` — never a price.
2. **Every write is a Server Action** returning a discriminated union (`{ success: true, … } | { success: false, error }`) — never a thrown exception across the client boundary. There is no REST/GraphQL data API.
3. **Prices live ONLY on `ProductVariant`.** Carts and orders carry a `variantId`; the server resolves price at read/bill time.
4. **Let the database enforce invariants.** Catch Prisma error codes (`P2002` / `P2003` / `P2025`) and translate them into user-facing messages — don't re-implement constraints as racy app-level pre-checks.
5. **Money is exact.** All currency is `Decimal`; all arithmetic goes through `roundMoney` (2-dp); the shown price is always the billed price.

## Where things live

- `src/app/(shop)/**` — customer storefront · `src/app/admin/**` — staff console
- `src/lib/actions/**` + `src/app/admin/products/actions.ts` — `"use server"` write actions
- `src/lib/discounts.ts` — pricing math (highest blast radius) · `src/lib/session.ts` — every auth guard
- `src/lib/validators.ts` — shared client+server Zod schemas · `src/lib/action-utils.ts` — shared action helpers
- `src/lib/timezone.ts` — Africa/Cairo store-day math · `src/lib/prisma.ts` — the client singleton
- `prisma/schema.prisma` — data model · `src/generated/prisma` — checked-in generated client (`@/generated/prisma/client`, `/enums`)

## Modular rules (loaded every session)

@rules/frontend.md
@rules/backend.md
@rules/database.md
@rules/business-logic.md

## Working agreements

- Match the surrounding code's idioms, comment density, and naming. This codebase is highly consistent by design — new code should be indistinguishable from what's there.
- When you change a file boundary, a Prisma constraint, or a cache surface, update the relevant doc in `docs/` (`ARCHITECTURE.md`, `DOMAIN_MAP.md`, `HOW_IT_WORKS.md`, `STOREFRONT_ARCHITECTURE.md`).
- Prefer the specialized sub-agents in `.claude/agents/` when touching the schema or the money path — they encode the invariants those layers cannot express in types.
