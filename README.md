<div align="center">

# 🍰 Ali Baba — Patisserie & Café Lounge

**A modern, high-performance, fully dynamic commerce platform** — pairing an elegant storefront with a robust, custom-built Admin Dashboard.

[![Next.js](https://img.shields.io/badge/Next.js-16.2-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://neon.tech)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38BDF8?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Framer Motion](https://img.shields.io/badge/Framer_Motion-12-0055FF?style=for-the-badge&logo=framer&logoColor=white)](https://www.framer.com/motion/)

</div>

---

> **Ali Baba** is a single Next.js deployment running two businesses at once: a full-funnel
> e-commerce patisserie — catalog → cart → checkout → orders → multi-branch fulfilment → admin console —
> and a structurally sealed, dine-in café menu. It is engineered **Server-Components-first**, with the
> server as the single source of truth for price, stock, identity, and permission. Built for a
> multi-branch patisserie operating in Egypt (Cairo time, EGP, cash-on-delivery).

---

## 📚 Table of Contents

- [Core Tech Stack](#-core-tech-stack)
- [Key Features](#-key-features)
- [Architecture & Database Strategy](#-architecture--database-strategy)
- [Getting Started](#-getting-started)
- [Available Scripts](#-available-scripts)
- [Project Structure](#-project-structure)

---

## 🧱 Core Tech Stack

| Layer | Technology | Why it's here |
|---|---|---|
| **Framework** | **Next.js 16.2** — App Router, RSC-first | Server Components are the default data layer. HTML arrives already populated — no first-paint spinners. |
| **UI Runtime** | **React 19.2** | `useTransition` on every mutation, `cache()` for request-level dedupe. No `useEffect`-driven loading. |
| **Styling** | **Tailwind CSS v4** | Token-driven design system: serif headings, warm `stone-*` neutrals, a single turquoise accent, `rounded-full` pills. |
| **Motion** | **Framer Motion 12** | Smooth micro-interactions, shared-`layoutId` pills, and drag-and-drop reordering via `<Reorder>`. |
| **Database** | **PostgreSQL** on **Neon** (pooled) | Relational, exact-money data model. Every currency column is `Decimal`. |
| **ORM** | **Prisma 7** + `@prisma/adapter-pg` | Driver-adapter over `pg`, with a clean pooled-vs-direct connection split. |
| **Auth & RBAC** | **Better Auth 1.6** | DB-backed sessions (not JWT). Roles: `USER · ADMIN · MANAGER`. |
| **Client State** | **Zustand 5** (`persist`) | Used narrowly — **only** for the cart, keyed by `variantId`. Everything else is server state. |
| **Media** | **UploadThing 7** | Admin-only, role-gated upload endpoints. The database stores URL strings only. |
| **Feedback / Charts** | `sonner` · `Recharts` · `Embla` | A toast on every mutation; bespoke analytics dashboards; buttery carousels. |

---

## ✨ Key Features

### 🛍️ Storefront
- **Fully responsive** across every breakpoint, with a **dynamic visual café menu** rendered from the database.
- An elegant, animated **FAQ accordion** section — content managed entirely from the admin console.
- A bespoke **"Our Locations"** showcase using **asymmetrical, editorial layouts** — staggered cards composed dynamically from live database branches, not hardcoded markup.
- Server-rendered catalog, cart, and checkout with a pure, shared **Discount Engine** guaranteeing *the shown price is always the billed price*.

### 🔎 Dynamic, Real-Time SEO
- Emits compliant **JSON-LD structured data** (`LocalBusiness`, `Bakery`, `CafeOrCoffeeShop`) generated **in real time from database branches** and injected into the document — built from the *same rows* that render the locations grid, so structured data can never drift from what visitors see.

### 🎛️ Bespoke Admin Dashboard
- Deliberately **hand-built without heavy UI component libraries** — **no React Hook Form**, no generated form kits. Just standard React state, **custom Tailwind forms**, and thin interactive islands.
- **Drag-and-drop list reordering** powered by Framer Motion's **`<Reorder>`** component (FAQs, locations, footer links).
- Full operational surface: products & variants, categories, promotions, orders, branches, users, reviews moderation, café menu, and **Recharts-powered analytics** (revenue, branch sales, peak hours).

### 🔐 Role-Based Security (RBAC)
- **Security is structural, not cosmetic.** Every page and every Server Action re-enforces permission — sidebar link-hiding is decoration only.
- **Server Actions are guarded internally** via a single `@/lib/session` door (`requireAdmin` / `requireDashboardAccess`); a `MANAGER` is pinned to their branch on every order and revenue query.
- **UploadThing endpoints are locked to `ADMIN`** — the middleware rejects any non-admin session with an `UploadThingError`, so even a `MANAGER` cannot upload.

---

## 🏛️ Architecture & Database Strategy

> This is the heart of the platform's operational robustness. Ali Baba runs a **modern Prisma 7 setup** with an intentional split between how the *application runtime* and *tooling* reach the database.

### 🔌 Pooled vs. Direct Connections

Neon exposes two connection endpoints, and Ali Baba uses each for exactly what it's good at:

| Concern | Connection | Configured in |
|---|---|---|
| **App runtime** (serverless, high-concurrency queries) | **Pooled** `DATABASE_URL` via the `pg` driver adapter | [`src/lib/prisma.ts`](src/lib/prisma.ts) |
| **CLI & build-time migrations** (DDL, advisory locks) | **Direct** `DIRECT_URL` | [`prisma.config.ts`](prisma.config.ts) |

- The **application runtime** builds its `PrismaClient` over a **pooled** connection through the `@prisma/adapter-pg` driver adapter — the right fit for a bursty, serverless workload. The client also forces `ipv4first` DNS resolution (Neon advertises both AAAA + A records; broken IPv6 routing otherwise caused intermittent `ETIMEDOUT`s) and memoizes on `globalThis` outside production to survive dev hot-reload without exhausting connections.
- **CLI operations and Vercel build-time migrations** (`migrate deploy`, `studio`, `db push`) run over the **direct, non-pooled** `DIRECT_URL`. The pooler runs in transaction mode and *cannot* hold the advisory lock or execute the DDL that `migrate deploy` requires.
- Crucially, this is wired up **elegantly through `prisma.config.ts`** — Prisma 7's config-driven datasource — rather than hardcoding a legacy `directUrl` field inside `schema.prisma`. The schema stays clean; the connection strategy lives with the tooling.

```ts
// prisma.config.ts — the CLI-only datasource, with a safe local fallback
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Direct (non-pooled) for migrations; falls back to DATABASE_URL locally.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
```

### 🚀 Automated Zero-Downtime Deployments

The Vercel build pipeline runs a single, deterministic chain that keeps the deployed schema in perfect lockstep with the code that expects it:

```bash
prisma generate && prisma migrate deploy && next build
```

1. **`prisma generate`** — regenerates the type-safe client against the current schema.
2. **`prisma migrate deploy`** — applies any pending migrations over `DIRECT_URL` **before** the app is built and shipped, so a release never boots against an un-migrated database.
3. **`next build`** — compiles the production bundle.

The result is **automated, zero-downtime migrations on every deploy** — no manual DB steps, no drift, no "did someone run the migration?" moments.

---

## 🚦 Getting Started

### Prerequisites
- **Node.js 20+**
- A **PostgreSQL** database (a [Neon](https://neon.tech) project is recommended — it provides both the pooled and direct URLs out of the box).

### 1. Clone the repository
```bash
git clone https://github.com/your-org/ali-baba-web.git
cd ali-baba-web
```

### 2. Install dependencies
```bash
npm install
```
> The `postinstall` hook automatically runs `prisma generate`, so the type-safe client is ready immediately after install.

### 3. Configure your environment
Create a `.env` file in the project root:

```dotenv
# Pooled connection — used by the application at runtime (via the pg adapter)
DATABASE_URL="postgresql://user:password@ep-xxxx-pooler.neon.tech/dbname?sslmode=require"

# Direct connection — used by the Prisma CLI & build-time migrations
DIRECT_URL="postgresql://user:password@ep-xxxx.neon.tech/dbname?sslmode=require"

# Optional
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### 4. Run database migrations
```bash
npx prisma migrate deploy
```

### 5. Launch the development server
```bash
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** to view the storefront. The Admin Dashboard lives at **`/admin`**.

---

## 🛠️ Available Scripts

| Script | Command | Purpose |
|---|---|---|
| **Dev** | `npm run dev` | Start the local development server. |
| **Build** | `npm run build` | `prisma generate && prisma migrate deploy && next build` — the production pipeline. |
| **Start** | `npm run start` | Serve the production build. |
| **Lint** | `npm run lint` | Run ESLint. |
| **Test** | `npm run test` | Run the Vitest suite once. |
| **Test (watch)** | `npm run test:watch` | Vitest in watch mode. |
| **Coverage** | `npm run test:coverage` | Vitest with a V8 coverage report. |

---

## 📁 Project Structure

A clean, layered architecture — **Server Components by default, Client Components by exception.**

```text
ali-baba-web/
├── prisma/
│   ├── schema.prisma            # The relational data model (PostgreSQL)
│   └── migrations/              # Version-controlled schema history
├── prisma.config.ts             # Prisma 7 CLI datasource (DIRECT_URL strategy)
├── docs/                        # Architecture & domain documentation
│
├── src/
│   ├── app/
│   │   ├── (shop)/              # 🛍️  Customer storefront (RSC)
│   │   │   ├── page.tsx         #     Home · shop · category · product · menu
│   │   │   ├── checkout/        #     Guest-capable checkout flow
│   │   │   └── my-orders/       #     Authenticated order history
│   │   ├── admin/               # 🎛️  Staff console — products, orders,
│   │   │   │                    #     promotions, branches, analytics, FAQs…
│   │   │   └── layout.tsx       #     RBAC-guarded shell
│   │   ├── api/
│   │   │   ├── auth/[...all]/    #     Better Auth handler (pass-through)
│   │   │   └── uploadthing/      #     Role-gated media endpoints (ADMIN only)
│   │   └── layout.tsx
│   │
│   ├── components/
│   │   ├── admin/               # 🧩  Bespoke dashboard modules (custom
│   │   │   │                    #     Tailwind forms, Framer <Reorder> lists)
│   │   │   ├── analytics/       #     Recharts dashboards
│   │   │   └── menu/            #     Café menu editors
│   │   └── *.tsx                #     Storefront components (Hero, FAQs, …)
│   │
│   ├── lib/
│   │   ├── actions/             # ⚡  "use server" Server Actions — the ONLY
│   │   │   │                    #     write layer (no REST/GraphQL API)
│   │   │   ├── orders.ts        #     placeOrder — the price-integrity boundary
│   │   │   ├── locations.ts     #     Dynamic branches → JSON-LD source
│   │   │   └── …                #     cart · reviews · promotions · users …
│   │   ├── discounts.ts         #     Pure, shared Discount Engine
│   │   ├── session.ts           #     Every auth guard — the one door
│   │   ├── prisma.ts            #     Pooled PrismaClient singleton (pg adapter)
│   │   ├── validators.ts        #     Shared client + server Zod schemas
│   │   └── timezone.ts          #     Africa/Cairo store-day math (DST-safe)
│   │
│   ├── generated/prisma/        # Checked-in generated Prisma client
│   └── proxy.ts                 # Next 16 edge interceptor (never middleware.ts)
│
├── public/                      # Static assets
└── package.json
```

---

<div align="center">

**Crafted with precision for a business that runs on it.** 🍰☕

*Server-truth pricing · Exact-money accounting · Structural RBAC · Zero-downtime migrations*

</div>
