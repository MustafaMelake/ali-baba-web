---
name: scaffold-server-action
description: Scaffold a new "use server" Server Action for the Ali Baba platform that follows the house contract — discriminated-union return, the correct auth gate, shared Zod validation, Prisma-error-code translation, and the revalidatePath fan-out. Use when adding any write/mutation to src/lib/actions/** or src/app/admin/products/actions.ts.
---

# Scaffold a Server Action

Generate a new mutation that is indistinguishable from the existing actions. Follow
`@rules/backend.md`, `@rules/database.md`, and `@rules/business-logic.md`.

## Ask first (if not already clear from the request)

1. **What entity + operation** (e.g. "create promotion", "delete branch")?
2. **Which auth tier** — ADMIN-only (`ensureAdmin`), ADMIN-or-MANAGER branch-scoped (`requireDashboardAccess` + `resolveBranchScope`), or public/guest-capable (like `placeOrder`)?
3. **Which surfaces render this entity** (so the `revalidatePath` fan-out is complete)?

## Non-negotiable checklist

- [ ] Place the file under `src/lib/actions/<domain>.ts` (or `src/app/admin/products/actions.ts` for products). It **is** a `"use server"` file, so it may **only export async functions** — no `type`/`const`/`export type { … }` (that crashes Turbopack). Put any shared type/const in `@/lib/validators` or a plain module and `import type` it.
- [ ] Import shared helpers from `@/lib/action-utils` (`ensureAdmin` / `ensureAdminSession`, `prismaErrorCode`, `slugify`) — never re-implement them.
- [ ] Import the Prisma singleton from `@/lib/prisma`; enums from `@/generated/prisma/enums`.
- [ ] Gate first, then `safeParse` the payload with the shared schema from `@/lib/validators`.
- [ ] Return `{ success: true, … } | { success: false, error }` — never throw to the client. Wrap the body in `try/catch`; map `P2002`/`P2003`/`P2025` via `prismaErrorCode`; log-and-generic-message anything else.
- [ ] Keep any transaction short and Neon-friendly (batch reads with `id: { in: … }`, no N+1 inside `$transaction`).
- [ ] `revalidatePath(...)` every surface that renders the entity (see the fan-out examples in `@rules/backend.md`). Promotions/pricing changes bust the storefront tree with `revalidatePath("/", "layout")`.
- [ ] Money: never accept a client price; resolve server-side through `resolvePrice`/`getStoreSettings`; round with `roundMoney`; `.toNumber()` any `Decimal` before it crosses to a client component.

## Reference template (ADMIN-gated CRUD)

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ensureAdmin, prismaErrorCode } from "@/lib/action-utils";
import { widgetInputSchema } from "@/lib/validators";

type WidgetResult = { success: true; id: string } | { success: false; error: string };

export async function createWidget(input: unknown): Promise<WidgetResult> {
  const gate = await ensureAdmin();
  if (gate) return { success: false, error: gate.error };

  const parsed = widgetInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const widget = await prisma.widget.create({ data: parsed.data });
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

For a **branch-scoped** action, swap the gate for `requireDashboardAccess()` +
`resolveBranchScope(scope, requestedBranchId)` and spread `branchWhere` at the top
level of every `where`. For a **guest-capable** action, model it on `placeOrder`
(`userId = session?.user?.id ?? null`, `checkoutSchema` validation, per-phone throttle).

After scaffolding, verify with the `discount-engine-auditor` agent if the action
touches price/money, and the `schema-guardian` agent if it needs a schema change.
