# Blueprints — the three auth tiers, and a worked spec

Skeletons for the Implementation Blueprint section, plus one full spec sheet as a
format exemplar. Each skeleton is distilled from a real action in this repo — the
citation tells you where to read the finished version when a detail matters.

## Contents

- [A. ADMIN-gated CRUD](#a-admin-gated-crud)
- [B. Branch-scoped (ADMIN + MANAGER)](#b-branch-scoped-admin--manager)
- [C. Guest-capable customer write](#c-guest-capable-customer-write)
- [D. Prisma error translation](#d-prisma-error-translation)
- [E. Worked example — a full spec sheet](#e-worked-example--a-full-spec-sheet)

---

## A. ADMIN-gated CRUD

The common case. Reference: `src/lib/actions/manage-branches.ts`,
`src/lib/actions/categories.ts`.

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ensureAdmin, prismaErrorCode } from "@/lib/action-utils";
import { widgetInputSchema } from "@/lib/validators";

// Inline type declarations are safe in a "use server" file — they're erased at
// compile time and are the house pattern. Only `export type { X }` re-exports
// and exported runtime values break under Turbopack.
type CreateWidgetResult =
  | { success: true; id: string }
  | { success: false; error: string };

export async function createWidget(input: unknown): Promise<CreateWidgetResult> {
  // Gate FIRST — never let an unauthorized caller's payload reach validation,
  // and never let the gate throw across the client boundary.
  const gate = await ensureAdmin();
  if (gate) return { success: false, error: gate.error };

  const parsed = widgetInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const widget = await prisma.widget.create({ data: parsed.data });

    // Fan-out: every surface that renders a widget.
    revalidatePath("/admin/widgets");

    return { success: true, id: widget.id };
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2002") return { success: false, error: "A widget with that name already exists." };
    console.error("createWidget failed:", err);
    return { success: false, error: "Could not create the widget. Please try again." };
  }
}
```

## B. Branch-scoped (ADMIN + MANAGER)

The tier with the sharpest failure mode. A MANAGER is pinned to one branch, and the
scoping has **two** independent parts — miss either and it leaks.

Reference: `updateOrderStatus` in `src/lib/actions/orders.ts`,
`src/lib/actions/dashboard.ts` for the read side.

Three details here are easy to get wrong, and each one is load-bearing:

```ts
export async function updateWidgetStatus(id: string, status: WidgetStatus) {
  // (1) requireDashboardAccess THROWS on every unauthorized case — it does not
  // return an envelope. Wrap it, or the throw crosses the client boundary and
  // breaks the platform's "never throw to the client" contract.
  let scope;
  try {
    scope = await requireDashboardAccess();
  } catch {
    return { success: false, error: "Unauthorized." };
  }

  try {
    // (2) ROW-level check — scoping a LIST does not protect a write BY ID.
    // Narrow on the role first: `DashboardScope` is a discriminated union and
    // the ADMIN variant has NO `branchId` property at all, so `scope.branchId`
    // only typechecks inside this narrowing. An ADMIN legitimately skips it.
    if (scope.role === "MANAGER") {
      const row = await prisma.widget.findUnique({
        where: { id },
        select: { branchId: true },
      });
      if (!row) return { success: false, error: "That widget no longer exists." };
      if (row.branchId !== scope.branchId) {
        return { success: false, error: "That widget belongs to another branch." };
      }
    }

    await prisma.widget.update({ where: { id }, data: { status } });

    revalidatePath("/admin/widgets");
    return { success: true };
  } catch (err) {
    console.error("updateWidgetStatus failed:", err);
    return { success: false, error: "Could not update the status." };
  }
}
```

**(3) For the READ side, collapse the union with `resolveBranchScope` rather than
reaching into it.** That helper is what turns "caller's scope × optionally-requested
branch" into the single value a filter needs — and it's where a MANAGER asking for
someone else's branch gets rejected:

```ts
const scope = await requireDashboardAccess();
const branchId = resolveBranchScope(scope, params?.branchId); // string | undefined

// `{}` (undefined) = unrestricted, i.e. an ADMIN seeing every branch.
const branchWhere: Prisma.OrderWhereInput = branchId ? { branchId } : {};
```

Spread `branchWhere` at the **top level** of every order-reading `where` from there
(`dashboard.ts` does this at nine call sites). The `branchId ? … : {}` shape is not
defensive noise — an unconditional `{ branchId }` would filter admins on `undefined`
and silently return nothing.

## C. Guest-capable customer write

Guests are a first-class path — this is a cash-on-delivery business and checkout
must work signed-out. Reference: `placeOrder` in `src/lib/actions/orders.ts`.

```ts
export async function placeSomething(input: unknown) {
  // No gate — a null session is a valid caller. Identity is recorded if present.
  const session = await getServerSession();
  const userId = session?.user?.id ?? null;

  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // Abuse throttle stands in for the authentication that isn't there —
  // placeOrder caps simultaneously-PENDING orders per exact customerPhone.
  // Any guest-writable action needs an equivalent, or it's an open endpoint.

  try {
    const result = await prisma.$transaction(async (tx) => {
      // ONE batched read carrying everything the loop needs — never an N+1
      // findUnique per line, which holds the transaction open in proportion
      // to input size (Neon).
      const rows = await tx.thing.findMany({ where: { id: { in: ids } } });

      // Pure in-memory loop. Throw here to roll the whole thing back —
      // a partial write is worse than a failed one.
      // Prices are re-resolved server-side; the client sent none.

      return tx.order.create({ data: { userId /* … */ } });
    });

    revalidatePath("/admin");
    revalidatePath("/admin/orders");
    if (userId) revalidatePath("/my-orders"); // a guest has no such page
    return { success: true, id: result.id };
  } catch (err) {
    console.error("placeSomething failed:", err);
    return { success: false, error: "Could not complete that. Please try again." };
  }
}
```

## D. Prisma error translation

Reference: `uniqueViolationMessage` in `src/lib/actions/manage-branches.ts` for the
multi-field case.

| Code | Means | Message shape |
|---|---|---|
| `P2002` | unique violation | "A branch with this name already exists." / "You've already reviewed this product." Inspect `err.meta.target` when one action can violate several unique columns. |
| `P2003` | FK constraint | "…appears in existing orders — mark it Out of Stock instead." Name the *remedy*, since the user can't delete the row. |
| `P2025` | record not found | "That … no longer exists." |
| anything else | unknown | Generic user message **plus** `console.error(err)` — the log is the only diagnosis path once the message is generic. |

Distinguishing several unique columns:

```ts
function uniqueViolationMessage(err: unknown): string | null {
  if (prismaErrorCode(err) !== "P2002") return null;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  const on = (field: string) =>
    Array.isArray(target) && target.some((t) => String(t).includes(field));
  if (on("name")) return "A branch with this name already exists.";
  if (on("slug")) return "That slug is already in use.";
  return "That value must be unique.";
}
```

## E. Worked example — a full spec sheet

What a finished spec looks like, for an action that doesn't exist yet.

---

# Action Spec — `cancelOwnOrder`

**File:** `src/lib/actions/orders.ts` · **Operation:** status-change · **Tier:** authenticated user (own rows only)

## 1. Signature & Schema

```ts
type CancelOwnOrderResult =
  | { success: true }
  | { success: false; error: string };

export async function cancelOwnOrder(input: unknown): Promise<CancelOwnOrderResult>;
```

Zod schema (add to `@/lib/validators`):

```ts
export const cancelOwnOrderSchema = z.object({
  orderId: z.string().min(1, "Order id is required."),
});
```

## 2. Authentication & Permissions

- Gate: `getServerSession()` — a signed-in customer, **not** staff. Null session → `{ success: false, error: "Please sign in." }`.
- Ownership: re-read `order.userId` and require it equals the session user. This is the customer-side analogue of the manager row-level check — a session alone doesn't entitle you to *this* order.
- Branch scoping: N/A — scoping is for staff dashboards; a customer is scoped by ownership.
- Guest orders (`userId: null`) are **not** cancellable this way; there's no identity to check against.

## 3. Edge Cases, Limits & Transactions

| Case | Trigger | Behaviour |
|---|---|---|
| Order not found | bad/stale id | `P2025` or null read → "That order no longer exists." |
| Not the caller's order | id belongs to another user | Same "no longer exists" message — don't confirm the row exists to a non-owner. |
| Already past PENDING | status is PREPARING/SHIPPED/DELIVERED | "This order is already being prepared — call the branch to change it." |
| Already CANCELLED | repeat submit / double-click | Idempotent success, so a retry isn't an error. |

- **Constraints relied on:** none unique here; the status guard is a read-then-write inside one transaction to avoid a TOCTOU race with an admin moving the order forward.
- **Transaction:** 2 statements — `findUnique` (status + userId) then `update`.
- **Limits:** none beyond the status gate.
- **Money:** none — status only. No `Decimal` crosses the boundary.

## 4. Cache Invalidation

| Surface | Call | Why |
|---|---|---|
| `/my-orders` | `revalidatePath("/my-orders")` | The customer's own list shows the new status. |
| `/admin/orders` | `revalidatePath("/admin/orders")` | Staff queue must drop it. |
| `/admin` | `revalidatePath("/admin")` | Dashboard counters are status-derived. |

Revenue aggregates need no special handling — they count `DELIVERED` only, and a
cancelled order was never in them.

## 5. Implementation Blueprint

```ts
export async function cancelOwnOrder(input: unknown): Promise<CancelOwnOrderResult> {
  const session = await getServerSession();
  if (!session?.user?.id) return { success: false, error: "Please sign in." };

  const parsed = cancelOwnOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // read status + userId, assert ownership, assert PENDING,
      // early-return idempotently if already CANCELLED, then update
    });

    revalidatePath("/my-orders");
    revalidatePath("/admin/orders");
    revalidatePath("/admin");
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return { success: false, error: "That order no longer exists." };
    }
    console.error("cancelOwnOrder failed:", err);
    return { success: false, error: "Could not cancel the order. Please try again." };
  }
}
```

## Open Questions

- Should cancelling restock anything? There's no stock counter on `ProductVariant` today, so assuming no.
- Is a cancellation window (e.g. 10 minutes) wanted on top of the PENDING check?
