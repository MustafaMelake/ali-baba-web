---
name: sync-charter
description: Audit the Ali Baba governance docs (.claude/CLAUDE.md, .claude/rules/*.md, docs/) against what the code actually does, and report drift as a table before changing anything. Use this whenever the user asks to sync/audit/check the charter, rules, CLAUDE.md, or architecture docs; whenever they say a rule "feels wrong", "is stale", or contradicts the code; after merging a branch or finishing a refactor that moved a cache surface, a file boundary, a Prisma constraint, or a revalidatePath fan-out; and before starting work in a layer whose rules you are about to trust. Also use it proactively when you notice, mid-task, that a rule file describes something the code no longer does — that is exactly the condition this skill exists to catch.
---

# Sync Charter — reconcile the rules with reality

`.claude/rules/*.md` and `.claude/CLAUDE.md` are loaded into **every** session. That
makes a stale rule worse than a missing one: it doesn't merely fail to help, it
actively steers every future session toward undoing a deliberate decision. This skill
finds those cases and fixes the prose — carefully, because the prose is not always
the thing that's wrong.

## The distinction that makes this skill safe

When a rule and the code disagree, there are **two opposite diagnoses**, and getting
them backwards is the one way this skill can do real damage:

- **DRIFTED** — the code deliberately moved on; the rule is a fossil. *Fix the prose.*
- **VIOLATED** — the code accidentally broke a rule that is still correct and still
  load-bearing. *Fix the code. Never touch the prose.*

"Reconcile the docs to the code" is the naive framing, and it is dangerous: applied to
a VIOLATED row it launders a live bug into documented, blessed behavior. A missing
`status: DELIVERED` on a revenue query is a bug that overstates the client's income.
Silently rewriting `business-logic.md` to say revenue counts all orders would make that
bug permanent and invisible. So never let a disagreement default to "update the doc."

**How to tell them apart — look for evidence of intent, not just difference:**

| Signal | Points to |
|---|---|
| A docblock/comment explaining the new approach and why | DRIFTED |
| A test asserting the new behavior | DRIFTED |
| A commit message describing the change as deliberate | DRIFTED |
| The new pattern is consistent across **every** call site | DRIFTED |
| One file differs while its siblings still follow the rule | VIOLATED |
| The difference removes a guard (auth, branch scope, rounding, `status`) | VIOLATED |
| The difference has no comment, no test, no commit rationale | VIOLATED |

A worked example, because this case is the reason the skill exists: `frontend.md` once
mandated `force-dynamic` on catalog routes. The code had them on `revalidate = 60`.
That looked like a violation — but `src/lib/wishlist-store.ts` carried a docblock
calling the dynamic route "the trap this store removes," the client store was wired
into every heart consistently, and `getWishlistedProductIds()` was called from no page
at all. That is overwhelming evidence of intent → **DRIFTED**, fix the prose. Had the
store not existed and one page simply lost its guard, the same surface difference would
have been **VIOLATED**.

When the evidence is genuinely mixed, report it as **AMBIGUOUS** and let the user
decide. Guessing here is worse than asking.

## Scope first — don't boil the ocean

A full audit of four rule files plus `docs/` produces more rows than anyone will read,
and a wall of `VERIFIED` buries the two rows that matter. Pick a scope from the request:

- **Diff-scoped** (best default after a branch/refactor): `git diff --name-only main...HEAD`, then audit only the rules governing the layers those files live in.
- **Layer-scoped**: the user names a file or area ("check the backend rules").
- **Claim-scoped**: the user doubts one specific rule.
- **Full sweep**: only when explicitly asked, or when the charter has never been audited.

State the scope you chose in one line before you start, so the user can redirect you
cheaply if you picked wrong.

## Verify against the code — every row, no exceptions

The failure mode to guard against is confirming a rule from memory because it *sounds*
like something this codebase would do. You have read these rule files this session;
that familiarity is exactly what makes false confirmation easy. **A row without a
`file:line` you actually opened is not a finding.**

So: for every claim, run the grep or open the file, and put the concrete evidence in
the Code Reality column. If a claim can't be mechanically checked — a rationale, an
aesthetic convention, a "planned roadmap surface" — mark it **UNCHECKABLE** and move
on. That is a legitimate, useful verdict; padding the table with soft confirmations is
not.

`references/claim-catalog.md` holds the concrete checks per rule file — the specific
greps for cache exports, `revalidatePath` fan-outs, `Decimal` columns, `onDelete`
policies, the `"use server"` export constraint, single-`now` discipline,
`DELIVERED`-only revenue, and the rest. **Read it before auditing**; it is the
accumulated knowledge of where these claims actually live, and rederiving it each time
wastes a lot of grep.

Two checks worth running first, because they are cheap and historically the highest-yield:

1. **Dead references.** Every `path/to/file.ts`, `functionName()`, and exported symbol named in a rule — does it still exist, and is it still called from where the rule says? The force-dynamic drift was catchable this way alone: the rule named a function that no page called anymore.
2. **Deleted-model reintroduction.** `database.md` lists models/columns that must not come back. Grep for each; a hit is a serious finding.

## Output — the drift table

Report every audited claim in one table, most severe first (**VIOLATED**, then
**DRIFTED**, then **AMBIGUOUS**, then **UNCHECKABLE**, then **VERIFIED**). The user
asked for five columns and this keeps them, with the verdict column carrying the four
extra states above — a two-state verdict cannot express "the code is wrong," which is
the finding they most need to see:

```
## Charter audit — <scope>

| Rule File & Line | Stated Claim | Code Reality | Verdict | Proposed Edit |
|---|---|---|---|---|
| `rules/frontend.md:53` | `/shop`, `/category/[slug]`, PDP must be `force-dynamic` | `category/[slug]/page.tsx:13` + `product/[slug]/page.tsx:22` are `revalidate = 60`; `getWishlistedProductIds` called only from `wishlist-store.ts:74`, whose docblock calls force-dynamic "the trap this store removes" | **DRIFTED** | Replace with the three-mode caching table; add do-not-reintroduce note for `initialIsFavorited` |
| `rules/business-logic.md:71` | Revenue counts `DELIVERED` only | `analytics.ts:88` `branchSales` groupBy omits `status` | **VIOLATED** | None — fix the code: add `status: DELIVERED` to the `where` |
```

Keep claims and realities short enough to scan; put the supporting detail in prose
below the table only for rows that need it. Then close with a summary line —
`N verified · N drifted · N violated · N uncheckable` — and, if anything drifted or was
violated, a short **Recommended order of operations** (code fixes before prose edits,
so the prose describes a codebase that is already correct).

## Never edit a rule file before the user has seen the table

These files govern every future session, so an unreviewed edit propagates silently and
indefinitely. Present the table, then stop and ask which rows to apply. Apply only the
rows the user names.

Two things that follow from that, and are easy to get wrong:

- **A `VIOLATED` row is never fixed by editing prose.** If the user asks you to "just fix them all," apply the DRIFTED prose edits and re-surface the VIOLATED rows as code work needing its own decision.
- **Preserve each rule file's voice.** Match the surrounding density, bolding, and table style — a section that reads like it was written by a different author is a signal future readers will misread as untrustworthy. When a rule needs to change, say what the code does *and* name the superseded pattern as a do-not-reintroduce, since the old pattern will otherwise look like a bug to whoever reads the code next.

Finally: `CLAUDE.md`'s working agreements require `docs/` to track file boundaries,
Prisma constraints, and cache surfaces. If an applied edit invalidates a claim in
`ARCHITECTURE.md`, `DOMAIN_MAP.md`, `HOW_IT_WORKS.md`, or `STOREFRONT_ARCHITECTURE.md`,
flag it in the summary — fixing a rule file while leaving the same stale claim in
`docs/` just relocates the drift.
