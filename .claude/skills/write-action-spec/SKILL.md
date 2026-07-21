---
name: write-action-spec
description: Produce a reviewable Markdown spec sheet for an Ali Baba Server Action BEFORE any code is written — the contract, auth tier, Zod schema, edge cases, transaction bounds, and cache fan-out, decided and agreed up front. Use whenever the user is about to add or substantially refactor a mutation in src/lib/actions/** or src/app/admin/products/actions.ts, asks to "spec out"/"design"/"plan" an action, describes a new write ("users should be able to cancel their own order", "admins need to bulk-adjust menu prices"), or wants the contract for an action reviewed before implementing. Prefer this over jumping straight to code whenever the auth tier, the revalidation fan-out, or the failure modes are not yet settled — those are the decisions that are expensive to discover halfway through an implementation. Hand the approved spec to scaffold-server-action to write the actual file.
---

# Write an Action Spec

A Server Action is where this platform's invariants concentrate: it is the only
place a write happens, the only place authorization is really enforced, and — for
anything touching a cart or an order — the boundary that decides what the customer
is billed. The expensive mistakes there are not syntax; they are **decisions**:
picking the wrong auth tier, forgetting a surface in the revalidation fan-out,
not noticing a unique constraint that will fire under concurrency.

This skill front-loads those decisions into a short document a human can review in
a minute, before any code exists to argue with.

## How this differs from `scaffold-server-action`

They are two halves of one workflow and should not be collapsed:

- **`write-action-spec` (this skill)** decides *what the action must do* — the contract, the tier, the failure modes, the fan-out. Output is prose + schema, meant to be read and corrected.
- **`scaffold-server-action`** writes the actual `.ts` file to house style once those decisions are settled.

So the blueprint this skill emits is a **skeleton to hand over**, not a finished
implementation — leave the interesting logic as commented intent. If the user
already knows exactly what they want and just needs the file, skip straight to
`scaffold-server-action`; specs are for when something is genuinely undecided.

## Gather the inputs

You need five things. Take whatever the request already gives you and ask only for
the genuine gaps — an interrogation for facts that are obvious from context wastes
the user's time:

1. **Action name + domain** — which file under `src/lib/actions/` it belongs in (products live in `src/app/admin/products/actions.ts`).
2. **Operation** — create / update / delete / status-change / bulk / read-for-write.
3. **Input payload** — the fields the client sends. Watch for anything that looks like a price; see the money rule below.
4. **Who may call it** — resolve to a tier using the table in the next section.
5. **Which surfaces render this entity** — this determines the fan-out, and it is the field most often gotten wrong because it requires knowing the whole app rather than the one action.

If the entity already exists, **check how its siblings are written before speccing**
(`grep` the domain file). Matching an established local pattern beats inventing a
new one, and the sibling usually reveals the edge cases the request forgot.

## Decide the auth tier — five options, not two

This is the decision most worth slowing down for, because getting it wrong is a
security bug rather than a bug. Read the tier off what the action touches:

| If the action… | Gate with | Notes |
|---|---|---|
| mutates catalog/config, ADMIN-only | `ensureAdmin()` from `@/lib/action-utils` | Returns `{ error } \| null` — an *envelope*, so the UI toasts instead of crashing. Gate first, before parsing. |
| is ADMIN-only **and** needs the caller's id | `ensureAdminSession()` | e.g. the self-demotion guard in `manage-users.ts`. |
| reads or writes **orders/revenue** reachable by a MANAGER | `requireDashboardAccess()` + `resolveBranchScope()` | This guard **throws** rather than returning an envelope — wrap it in `try/catch` and convert, or the throw crosses the client boundary. Then spread `branchWhere` at the top level of every `where`; omitting it is a cross-branch data leak, not a style issue. |
| writes a **single order row** a MANAGER can reach | the above **plus** a row-level check | Re-read the row's `branchId` and compare before writing — see `updateOrderStatus` in `orders.ts`. Scoping a list query does not protect a write by id. Narrow on `scope.role === "MANAGER"` first: the ADMIN variant of `DashboardScope` has no `branchId` field. |
| is customer-facing or guest-capable | `getServerSession()`, `userId = session?.user?.id ?? null` | Model on `placeOrder`. Guests are a supported path — don't gate checkout. |

When the request says "admins" or "staff", pin down which: a MANAGER is staff but is
**not** an ADMIN, and the difference decides three of the five rows above.

## The contract every spec must pin down

These are the house rules the spec exists to make explicit. `references/blueprints.md`
has the full worked skeletons for each tier — read it when you get to the blueprint
section rather than reconstructing the shapes from memory.

- **Return a discriminated union, never throw across the client boundary.** `{ success: true; … } | { success: false; error: string }`. The body is uniformly `try { … } catch { return { success: false, error } }`. State the exact success payload in the spec — `{ success: true }` vs `{ success: true; id }` vs `{ success: true; archivedCount }` is a real decision the caller's UI depends on.
- **Validate with the shared Zod schema from `@/lib/validators`**, re-parsed server-side with `safeParse` because the client is never trusted. If no schema fits, the spec should say which one to add there — not define one inline in the action file. (Some older actions hand-roll validation; new work uses Zod.)
- **Translate Prisma error codes, never leak them.** Read with `prismaErrorCode(err)` and map `P2002` → "already exists" (inspect `meta.target` when the message must distinguish fields), `P2003` → foreign-key ("appears in existing orders — mark Out of Stock instead"), `P2025` → "no longer exists". Anything unrecognized → generic message **plus** `console.error`.
- **Prefer a caught constraint violation over a pre-check.** A `findFirst`-then-`create` races under concurrency; a unique index does not. The spec should name which constraint carries each invariant.
- **State the cache fan-out explicitly** — `revalidatePath(...)` per surface, and `updateTag(...)` (Next 16's name; **not** `revalidateTag`) for tagged reads like `footer-links`. There is no automatic discovery, so an unlisted surface serves stale ISR HTML.
- **Money never crosses the wire.** If the payload carries anything price-shaped, that is a finding: the client sends `{ variantId, quantity }` and the server re-resolves through `resolvePrice`. Any `Decimal` leaving for a client component needs `.toNumber()`.
- **Bound the transaction.** Say how many statements it is and whether it grows with input size. Batch reads with `id: { in: [...] }`; an N+1 `findUnique`-per-line holds a Neon transaction open in proportion to cart size.

## Output — the spec sheet

Use this structure. Keep it tight; a spec nobody reads protects nothing.

```markdown
# Action Spec — `actionName`

**File:** `src/lib/actions/<domain>.ts` · **Operation:** <create|update|…> · **Tier:** <ADMIN | ADMIN+MANAGER (branch-scoped) | authenticated user | guest-capable>

## 1. Signature & Schema
​```ts
type ActionNameResult =
  | { success: true; /* … */ }
  | { success: false; error: string };

export async function actionName(input: unknown): Promise<ActionNameResult>;
​```
Zod schema (add to `@/lib/validators` if absent):
​```ts
export const actionNameSchema = z.object({ /* … */ });
​```

## 2. Authentication & Permissions
- Gate: `<guard>` — rationale in one line.
- Branch scoping: <`branchWhere` spread at top level of every order `where` / N/A and why>.
- Row-level check: <re-read `branchId` before write / N/A>.

## 3. Edge Cases, Limits & Transactions
| Case | Trigger | Behaviour |
|---|---|---|
| … | … | … |
- **Constraints relied on:** `@@unique([...])` → caught `P2002` → "<message>".
- **Transaction:** <N statements, bounded by …> or "no transaction needed".
- **Limits:** <CHECKOUT_MAX_ITEMS / throttles / none>.

## 4. Cache Invalidation
| Surface | Call | Why |
|---|---|---|
| `/admin/…` | `revalidatePath("/admin/…")` | … |

## 5. Implementation Blueprint
​```ts
// skeleton — real logic left as commented intent
​```

## Open Questions
- <anything you had to assume; empty if none>
```

The **Open Questions** section is the point of the whole exercise — a spec that
silently guesses at an undecided thing has just moved the mistake later. If you
assumed a fan-out surface, a limit, or a tier, say so there.

## After the spec

Present it and stop. Don't write the action file in the same breath — the spec's
value is the review step, and pre-empting it by implementing wastes that. Once the
user has corrected it, hand off to `scaffold-server-action`.

Two follow-ups worth naming when they apply: if the action touches price, VAT,
delivery fees, or revenue, flag that `discount-engine-auditor` should review the
implementation; if it needs a schema or constraint change, flag `schema-guardian`
before the migration.
