---
name: scaffold-client-island
description: Scaffold a thin "use client" interactive island for the Ali Baba storefront/admin — a Server Action wired through useTransition with optimistic local state, sonner toasts, and rollback on failure. Use when adding an interactive leaf (buttons, forms, toggles, status controls) to an otherwise server-rendered tree.
---

# Scaffold a Client Island

Client Components exist only where interactivity is genuinely needed. Keep the island
a thin leaf; the parent Server Component fetches the data. Follow `@rules/frontend.md`.

## Ask first (if unclear)

1. **What interaction** — one-shot action (delete/approve), a form (create/edit), a toggle, or a multi-option control (status chips, variant pills)?
2. **What optimistic state** should flip instantly, and what does rollback look like?
3. Does it read the **session** (needs `useSession()` + `isPending` skeleton) or **search params** (needs a `<Suspense>` boundary in the parent)?

## Non-negotiable checklist

- [ ] `"use client"` at the top; import the Server Action directly (no `fetch`, no API route).
- [ ] Wrap the call in `useTransition`; drive disabled/spinner state from `isPending`.
- [ ] Branch on `result.success` — **no try/catch** for the expected path. `toast.success` / `toast.error(result.error)` via `sonner` (`toast.warning` for the archived-variant case).
- [ ] On success, `router.refresh()` to re-run the RSC tree. Layer optimistic `useState` on top and **roll it back** on `{ success: false }`.
- [ ] Keys and lookups over `variantId` for anything cart-related — never the product id.
- [ ] `tabular-nums` on every price/quantity node that changes at runtime.
- [ ] Prices are display-only; pass the Discount-Engine value the customer saw. Never a raw `Decimal`.
- [ ] Session-aware UI: render a pulse skeleton while `useSession()` is `isPending` (never a "Sign In" flash). Portals guard with `if (typeof document === "undefined") return null;`.

## Reference template (one-shot destructive action, confirm-in-place)

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { deleteWidget } from "@/lib/actions/widgets";

export function WidgetRowActions({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteWidget(id);
      if (!result.success) { toast.error(result.error); return; }
      toast.success("Widget deleted");
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {confirming ? (
        <motion.div key="confirm" initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: "auto" }} exit={{ opacity: 0, width: 0 }} className="flex items-center gap-2">
          <span className="text-sm text-stone-600">Delete?</span>
          <button disabled={isPending} onClick={handleDelete} className="rounded-full px-3 py-1 text-sm">✓</button>
          <button disabled={isPending} onClick={() => setConfirming(false)} className="rounded-full px-3 py-1 text-sm">✕</button>
        </motion.div>
      ) : (
        <motion.button key="trigger" onClick={() => setConfirming(true)} className="rounded-full px-3 py-1 text-sm">
          Delete
        </motion.button>
      )}
    </AnimatePresence>
  );
}
```

For a **status/tab control**, animate the active pill with a single shared
`layoutId` `<motion.span>` (spring), matching `AdminOrderFilters` / `OrderStatusTabs`.
For a **form**, re-use the shared Zod schema from `@/lib/validators` for instant
client feedback (the server re-parses the same schema regardless).
