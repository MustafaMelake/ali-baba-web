---
name: write-action-spec
description: Produce a reviewable Markdown spec sheet for an Ali Baba Server Action BEFORE any code is written — verifying against prisma/schema.prisma that the models, relations and columns actually exist, then pinning down the contract, auth tier, Zod schema, edge cases, transaction bounds, and cache fan-out. Raises a Blocker with the required Prisma additions when the schema cannot support the action. Use whenever the user is about to add or substantially refactor a mutation in src/lib/actions/** or src/app/admin/products/actions.ts, asks to "spec out"/"design"/"plan" an action, describes a new write ("users should be able to cancel their own order", "admins need to bulk-adjust menu prices"), or wants the contract for an action reviewed before implementing. Prefer this over jumping straight to code whenever the auth tier, the revalidation fan-out, or the failure modes are not yet settled — those are the decisions that are expensive to discover halfway through an implementation. Hand the approved spec to scaffold-server-action to write the actual file.
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

## Step 0 — Verify the schema before writing any spec content

**Open `prisma/schema.prisma` and confirm every model, relation, and column the
action touches actually exists.** Do this before the tier, before the Zod schema,
before anything — and never from memory or from what the request implies.

A spec is dangerous precisely because it reads as authoritative. One written against
a table that doesn't exist looks completely implementable — correct guards, plausible
Prisma calls, a sensible fan-out — and the gap only surfaces when someone tries to
build it. That wastes the review the spec existed to earn.

**Check three levels, not one.** Stopping at "does the model exist" is the trap: the
models are usually right there and the *relationship* between them is what's missing.

1. **Models** — every one named in the payload or the write.
2. **Relations** — the FK that joins them. Two models existing does not mean they're connected.
3. **Columns** — the specific fields being read or written, including their types.

```bash
grep -n -A25 "^model <Name> " prisma/schema.prisma      # per model: fields + relations
grep -niE "<column>|<concept>" prisma/schema.prisma     # does this concept exist at all?
```

A worked case: a request to "update stock quantity for a variant at a branch" names
`ProductVariant` and `Branch`, and **both exist** — a model-level check passes
cleanly. But `ProductVariant` has only `isAvailable: Boolean` and no quantity, and
`Branch` relates to `User` and `Order` and nothing else. There is no join and no
count. The action is unbuildable, and only a relation-and-column-level check catches it.

### When something is missing

Lead the output with a **Blocker** section — before any spec content, so it cannot be
skimmed past — containing the Prisma additions the action requires:

```markdown
## ⚠️ Blocker — schema does not support this action

<one line per gap, each citing `schema.prisma:<line>` for what IS there>

​```prisma
model NewThing {
  // the additions required, with onDelete policies chosen deliberately
}
​```

`schema-guardian` must review this migration before implementation.
```

Then continue the spec, clearly marked **provisional — not implementable until the
migration lands**. Continuing is deliberate: the act of speccing is what surfaces the
consequences that should shape the schema (does the order path decrement this? does
the cart have branch context at all?), and those belong in front of the user *before*
they design the migration, not after. What must never happen is a spec that reads as
ready to build when it isn't — the Blocker header is what prevents that.

If the missing structure is large enough that the whole design depends on unanswered
schema questions, say so and stop; a provisional spec resting on five guesses is
worse than a clear "decide the model first."

Choose `onDelete` policies deliberately in any proposed model and justify them —
`database.md` treats those policies as the data-safety contract, and a Cascade
proposed by reflex on the order chain destroys history.

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
<!-- Blocker section FIRST if Step 0 found gaps; omit entirely when the schema is sound. -->

# Action Spec — `actionName`

**File:** `src/lib/actions/<domain>.ts` · **Operation:** <create|update|…> · **Tier:** <ADMIN | ADMIN+MANAGER (branch-scoped) | authenticated user | guest-capable>
<!-- If blocked, add: **Status:** PROVISIONAL — not implementable until the migration in the Blocker lands. -->

## 0. Prerequisite schema
<!-- Only when blocked: the exact models/columns/relations that must exist first. Omit when nothing is missing. -->

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
