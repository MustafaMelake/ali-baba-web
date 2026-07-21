# Claim Catalog — what to check, and how

Concrete verification recipes for the checkable claims in `.claude/CLAUDE.md` and
`.claude/rules/*.md`. Run from the repo root. Every command here has been run against
this repo; they are starting points, not a script to execute blindly — read the output
and think about what it means before assigning a verdict.

Ordered roughly by yield: the cheap structural checks near the top have historically
caught more real drift than the deep semantic ones.

## Contents

- [0. Universal: dead references](#0-universal-dead-references)
- [1. CLAUDE.md — stack and layout](#1-claudemd--stack-and-layout)
- [2. frontend.md — caching, boundaries, conventions](#2-frontendmd--caching-boundaries-conventions)
- [3. backend.md — actions, auth, revalidation](#3-backendmd--actions-auth-revalidation)
- [4. database.md — schema invariants](#4-databasemd--schema-invariants)
- [5. business-logic.md — money and time](#5-business-logicmd--money-and-time)
- [6. Uncheckable by design](#6-uncheckable-by-design)

---

## 0. Universal: dead references

The highest-yield check, and the one that caught the force-dynamic drift. Rules name
files, functions, and exports; code moves. A rule pointing at something that no longer
exists — or that exists but is called from nowhere the rule describes — is drifted
almost by definition.

Extract every backticked path and identifier from the rule file under audit, then:

```bash
# Does the named file still exist?
ls src/lib/wishlist-store.ts

# Does the named symbol still exist, and who calls it?
grep -rn "getWishlistedProductIds" src
```

The tell: a symbol defined in one place and imported in *zero* places the rule
mentions. That's not a violation, it's a rule describing a wiring that was replaced.

## 1. CLAUDE.md — stack and layout

**"Where things live" paths still exist:**

```bash
for p in src/lib/discounts.ts src/lib/session.ts src/lib/validators.ts \
         src/lib/action-utils.ts src/lib/timezone.ts src/lib/prisma.ts \
         prisma/schema.prisma src/generated/prisma; do
  [ -e "$p" ] || echo "MISSING: $p"
done
```

**Declared versions match `package.json`** (Next 16.2, React 19.2, Prisma 7, Zod, Tailwind v4):

```bash
node -e "const p=require('./package.json');console.log({...p.dependencies,...p.devDependencies})"
```

A major-version bump that the charter still describes with the old number is real
drift — the rules are written against framework specifics (`proxy.ts` vs
`middleware.ts`, Prisma 7's CLI/runtime split) that change across majors.

**The interceptor is `src/proxy.ts`, never `middleware.ts`:**

```bash
ls src/proxy.ts src/middleware.ts 2>&1
```

**Declared libraries are actually used** — a charter naming a library the code
abandoned (or listing one while a competitor is installed) is drift. `sonner` is the
charter's toast library:

```bash
grep -rl "from \"sonner\"" src | wc -l
grep -rl "react-toastify" src | wc -l   # nonzero here = a real inconsistency
```

## 2. frontend.md — caching, boundaries, conventions

**Cache mode per route** — the three-mode table must match reality:

```bash
grep -rn "export const dynamic\|export const revalidate" src/app --include=page.tsx
```

Cross-check each result against the rule's table. Remember the `/shop` case: a route
with *no* export may be correct because it reads `searchParams` and is dynamic by
nature. Confirm before calling a missing export a violation:

```bash
grep -n "searchParams" "src/app/(shop)/shop/page.tsx"
```

**No per-user state seeded into a cached page** — the invariant behind the table. For
any page on `revalidate`, confirm it does not read the session or per-user data:

```bash
grep -rn "getServerSession\|getWishlistedProductIds" src/app --include=page.tsx
```

A hit inside a file that also declares `revalidate` is a **VIOLATED** row — that is a
cross-user state leak, not a doc problem.

**Tailwind tokens** (`stone-*` neutrals, no `gray/slate/zinc/neutral`):

```bash
grep -rEn "(bg|text|border|ring|divide|from|to|via)-(gray|slate|zinc|neutral)-[0-9]" src --include=*.tsx
```

**`tabular-nums` on runtime-changing numerics** — partially checkable; the grep finds
where it *is* used, but proving every price node has it needs judgment:

```bash
grep -rln "tabular-nums" src --include=*.tsx
```

**Cart keyed by `variantId`, never product id:**

```bash
grep -n "variantId\|\bid\b" src/lib/cart-store.ts | head -40
```

**Portals guard render-time, not via a `mounted` effect flag:**

```bash
grep -rn "createPortal" src --include=*.tsx -A3 -B3
```

## 3. backend.md — actions, auth, revalidation

**`"use server"` files must not export runtime values** — the Turbopack constraint that
crashed checkout. Two traps here, and getting them confused produces a table full of
false positives:

*Trap 1 — identify the real `"use server"` modules.* `grep -rl '"use server"'` also
matches files that merely *mention* the directive in a comment, including
`validators.ts`, `dashboard.ts`, and `analytics.ts`, which are deliberately plain
modules. Match the directive at the top of the file instead:

```bash
for f in $(grep -rl 'use server' src); do
  head -1 "$f" | grep -q '"use server"' && echo "$f"
done
```

*Trap 2 — only some exports are dangerous.* An **inline** `export type Foo = …` or
`export interface Foo {}` is erased by the compiler and is the established house
pattern in all 15 action files — flagging those is noise. What actually breaks is a
`export type { X }` **re-export** (miscompiled into a runtime reference under
Turbopack) or an exported runtime **value**:

```bash
for f in $(grep -rl 'use server' src); do
  head -1 "$f" | grep -q '"use server"' || continue
  out=$(grep -nE "^export (type|)\s*\{|^export (const|let|var|class|enum) " "$f")
  [ -n "$out" ] && { echo "── $f"; echo "$out"; }
done
```

Any hit is **VIOLATED**, not drift — it's a live runtime crash, not a documentation
question. Note that `backend.md` currently states the constraint more broadly than the
code observes it (it forbids `type` and `interface` outright); if that phrasing is in
scope for your audit, the imprecision itself is a **DRIFTED** row.

**Session read through one door** — `@/lib/session` or `@/lib/auth-client` only:

```bash
grep -rn "from \"better-auth" src
```

Four hits are legitimate and expected — don't report them: `lib/auth.ts` and
`lib/auth-client.ts` *are* the wrappers, `api/auth/[...all]/route.ts` is the vendored
pass-through, and `proxy.ts`'s `getSessionCookie` is the documented edge exception
(plus its spec). A fifth hit — a page, component, or action importing `better-auth`
directly — is the finding.

**Shared helpers imported, not re-implemented:**

```bash
grep -rn "function ensureAdmin\|function prismaErrorCode\|function slugify" src
```

The canonical definitions live in `action-utils.ts`; any *other* definition site is a
candidate finding. As of writing, `slugify` is redefined in three admin client
components (`BranchModal`, `EditProductForm`, `NewProductForm`) — worth confirming
whether that's live duplication or a deliberate client-side copy, since
`action-utils.ts` is a plain module and *is* importable from a client component.
Check before assigning a verdict rather than reporting the count.

**MANAGER branch scoping** — every order-reading `where` spreads `branchWhere`. A
query over orders that omits it is a cross-branch data leak:

```bash
grep -rn "branchWhere" src/lib
grep -rn "prisma.order.findMany\|prisma.order.aggregate\|prisma.order.groupBy" src/lib
```

Compare the two lists; an order query absent from the first is a candidate **VIOLATED**.

**Edge proxy imports stay edge-safe:**

```bash
grep -n "^import" src/proxy.ts
```

Any `@/lib/prisma`, `@/lib/auth`, or Node builtin here breaks the Edge build.

**`revalidatePath` fan-outs match the documented lists:**

```bash
grep -rn "revalidatePath\|updateTag" src/lib/actions src/app/admin/products/actions.ts
```

The rule names specific fan-outs (product mutations → `/admin/products`, `/shop`, `/`,
both slugs on rename; promotions → `revalidatePath("/", "layout")`; `placeOrder` →
`/admin`, `/admin/orders`, `/my-orders`). Compare per action. A *missing* path is a
stale-cache bug (**VIOLATED**); a *new* path the rule doesn't mention is usually
**DRIFTED** — the fan-out list needs updating.

**Proxy matcher lists each protected root bare and wildcarded:**

```bash
grep -n -A20 "matcher" src/proxy.ts
```

## 4. database.md — schema invariants

**Money columns are `Decimal`, except `StoreSettings.vatRate` (`Float`):**

```bash
grep -nE "(price|Price|amount|Amount|fee|Fee|subtotal|total|value)\s+(Decimal|Float|Int)" prisma/schema.prisma
```

A money field typed `Float` or `Int` is **VIOLATED** — that's binary-float drift at rest.

**`onDelete` policies match the deletion-physics table:**

```bash
grep -nE "onDelete:\s*(Cascade|Restrict|SetNull)" prisma/schema.prisma
```

Compare every row. A `Restrict` on the order chain flipped to `Cascade` silently
destroys order history — the most severe single finding available in this repo.

**Prices only on `ProductVariant`** — `Product` must have no price column:

```bash
grep -n -A30 "^model Product " prisma/schema.prisma | grep -iE "price|Decimal"
```

**Unique constraints the app relies on catching:**

```bash
grep -nE "@@unique|@unique" prisma/schema.prisma
```

Expect `Review [userId, productId]`, `CartItem [userId, variantId]`,
`WishlistItem [userId, productId]`, and unique slugs on Category/Product/Branch/
MenuCategory plus `Order.orderNumber`.

**Deleted models must not return:**

```bash
grep -nE "MenuPage|menuPageId|sortOrder|CategoryType|CategoryIdentifier" prisma/schema.prisma src/generated/prisma/*.ts 2>/dev/null
```

**Two sealed worlds** — no FK between commerce catalog and café menu:

```bash
grep -n -A20 "^model MenuItem " prisma/schema.prisma
```

A relation to `Product`/`ProductVariant`/`Promotion` here is **VIOLATED**.

**Generated client is current with the schema.** If `schema.prisma` is newer than the
checked-in client, the rule's "regenerated and checked in" claim is stale in practice:

```bash
git log -1 --format=%cd prisma/schema.prisma
git log -1 --format=%cd src/generated/prisma
```

## 5. business-logic.md — money and time

**Single `now` per request** — one `new Date()` threaded into both
`livePromotionWhere(now)` and `resolvePrice(…, now)`:

```bash
grep -rn "new Date()" src/lib/actions src/app --include=*.ts --include=*.tsx | grep -v test
grep -rn "livePromotionWhere\|resolvePrice" src
```

A surface calling `livePromotionWhere(new Date())` inline *and* `resolvePrice` with a
separate instant is **VIOLATED** — two lines of one order can price against different
instants.

**Discount math lives only in `discounts.ts`:**

```bash
grep -rn "compareAtPrice\|discountAmount\|finalPrice" src/components src/app --include=*.tsx
```

Components should be *displaying* these, never computing them. Arithmetic on a
promotion value inside a component is **VIOLATED**.

**`roundMoney` is the 2-dp authority:**

```bash
grep -rn "roundMoney" src/lib
grep -rn "Math.round(.*100" src --include=*.ts | grep -v roundMoney
```

The second command finds hand-rolled rounding that bypasses the helper.

**Revenue counts `DELIVERED` only** — the highest-consequence reporting rule:

```bash
grep -rn "DELIVERED" src/lib/actions/dashboard.ts src/lib/actions/analytics.ts
grep -rnE "\\\$queryRaw|groupBy|aggregate" src/lib/actions/dashboard.ts src/lib/actions/analytics.ts
```

Every *revenue* aggregate needs `status: DELIVERED`. Order-**volume** counters
deliberately do not — before flagging, confirm which kind you're looking at, or you'll
report a false positive against a documented exception.

**Store-day math via `timezone.ts`, never the server's local clock:**

```bash
grep -rn "STORE_TZ\|storeMidnight\|storeMonthStart\|storeDayKey" src
grep -rn "AT TIME ZONE" src
grep -rn "getFullYear()\|setHours(0" src/lib/actions   # local-clock day math = VIOLATED
```

**`placeOrder` takes no client price:**

```bash
grep -n "price" src/lib/actions/orders.ts | head -30
grep -n "placeOrder\|checkoutSchema" src/lib/validators.ts
```

A `price` field on the inbound payload schema is **VIOLATED** — the price-integrity
boundary is the single most consequential invariant in the platform.

**Shared cart limits are single-sourced:**

```bash
grep -rn "CHECKOUT_MAX_QUANTITY\|CHECKOUT_MAX_ITEMS" src
```

Literal `99`/`50` anywhere these belong = duplication.

## 6. Uncheckable by design

Mark **UNCHECKABLE** and don't force a verdict. These are rationale, aesthetics, or
intent that no grep resolves:

- *Why* a decision was made (the Neon IPv6 `ETIMEDOUT` story, why forks over threads in Vitest).
- "Retained-by-decision" items — `Order.deliveryCity`, the `DeliveryLocation` enum, `Branch.address`/`phone`. Unused **is the documented state**; absence of usage is not drift.
- Roadmap/planned surfaces.
- Aesthetic conventions ("serif headings", "rounded-full pills") beyond a token grep.
- `MenuItem` fixed-price parity — an admin workflow convention, explicitly not a DB constraint.

One caution: a rule saying "X is deliberately not Y" is checkable in the *opposite*
direction from most. `action-utils.ts` is deliberately **not** `"use server"`; finding
that directive there would be **VIOLATED**, and finding it absent is **VERIFIED**.
Read the polarity of the claim before running the grep.
