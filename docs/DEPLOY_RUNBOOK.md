# Deploy Runbook — hero slides · hardening · collections

**Release:** the three stacked branches `feat/hero-slides` → `fix/hardening` → `feat/collections`, merged into `main` and deployed to production.
**Prepared:** 2026-10-24. **Status:** ready for review. Nothing has been merged, pushed or deployed yet.

This runbook is the only place the production steps are written down. Every command that touches production is marked **(PROD)**. Run them yourself, in order, and stop at any step whose check fails.

---

## 0. What ships

| Branch | Commits | Contents |
|---|---|---|
| `feat/hero-slides` | `117be09` `d234a57` `003bda8` `c20b349` `a5b0a9f` | UploadThing-only image URLs; shared href whitelist; admin-managed homepage hero slides |
| `fix/hardening` | `c87f0b9` `59a5f00` `7d06e14` `44b9a14` `3c1a4aa` `61205e0` `267d8f0` `a04f148` `7de2ff6` `ef3a360` | Hero money format; canonical E.164 phones + throttle index; `placeOrder` error-whitelist tests; pickup requires an active branch; unused deps removed; store WhatsApp number; `/forgot-password`; admin password reset; the change-password hold |
| `feat/collections` | `b5935be` `7d2fded` `c8b3feb` `7570878` `ce49d23` (+ this runbook) | `/collections` renamed to `/new-arrivals`; one paginator; curated Collections; collection-targeted promotions; charter/docs sync |

Verified locally on the tip of `feat/collections`: typecheck clean, lint clean, **35 test files / 808 tests passing**, and a fresh database built by `prisma migrate deploy` (25 migrations) **diffs empty** against `schema.prisma`. `next build` has **not** been run locally (by rule). The first real build of this code is the Vercel build, which is why step 3 builds a preview against a copy of production first.

---

## 1. Deploy target and build

**Target: Vercel**, via the Git integration. Evidence: `README.md` → "Automated Zero-Downtime Deployments" describes the Vercel build pipeline. There is no `vercel.json` and no local `.vercel/` link, so confirm in the Vercel dashboard which branch is the **Production Branch** (expected: `main`).

**Build command** (`package.json` → `build`):

```bash
prisma generate && prisma migrate deploy && next build
```

`postinstall` also runs `prisma generate`. The generated client (`src/generated/prisma`) is gitignored and always regenerated on the build machine.

**Consequence:** migrations run **inside every Vercel build**, against whatever `DIRECT_URL` (falling back to `DATABASE_URL`) that build's environment points at. That includes **preview builds**. See the warning in §4.

---

## 2. Migrations that will run on production

Production should currently be at the last migration on `main`. This release adds exactly **six** migrations, applied in this order:

| # | Migration | Effect on existing rows | Lock / duration |
|---|---|---|---|
| 1 | `20261022000000_add_hero_slide_model` | None. New `HeroSlide` table (FK → `Product` `ON DELETE SET NULL`) + 2 indexes | Instant |
| 2 | **`20261023000000_normalize_order_phone`** — ⚠ **data migration** | **Rewrites `Order.customerPhone`** on every row that parses as an Egyptian mobile into canonical E.164 (`+201XXXXXXXXX`). See the box below. Then `CREATE INDEX "Order_customerPhone_status_idx"` | One `UPDATE` over `Order` + a non-concurrent index build (blocks order **writes** for the duration, seconds at today's volume) |
| 3 | `20261023000100_store_whatsapp_number` | None. `StoreSettings.whatsappNumber TEXT NULL` | Instant (metadata) |
| 4 | `20261023000200_user_must_change_password` | None. `User.mustChangePassword BOOLEAN NOT NULL DEFAULT false`; every existing user reads `false` | Instant (metadata-only on PG 11+) |
| 5 | `20261024000000_add_collections` | None. New `Collection`, `CollectionProduct`, `CollectionCategory` tables. Every cascade removes link rows only | Instant |
| 6 | `20261024000100_collection_promotions` | None. New implicit join `_CollectionToPromotion` | Instant |

> **The phone normalization (migration 2), explicitly**
>
> - **What it changes:** only `Order.customerPhone`, and only on rows where the cleaned value is an Egyptian mobile in another format. Cleaning means Arabic-Indic and Eastern Arabic-Indic digits become ASCII, and spaces, dots, parentheses and dashes are removed. Accepted forms are `01X…`, `201X…`, `+201X…` and `00201X…`, with X ∈ {0,1,2,5}.
> - **What it never does:** delete a row, or touch any other column. A raw `UPDATE` leaves `updatedAt` alone.
> - **Values it can't parse** (landlines, foreign numbers, typos, free text) are **left exactly as they are** and counted.
> - **Idempotent:** a canonical value maps to itself, and only rows whose value changes are updated, so a re-run updates 0 rows.
> - **Reporting:** it emits `RAISE NOTICE 'Order phone normalization: N normalized, M left untouched'`. **`prisma migrate deploy` does not print server NOTICEs**, so don't rely on the build log. Run the SQL reports in §5 before and after instead.
> - **Not reversible from the migration itself.** The original formatting is overwritten. If you ever need the raw values back, restore from the pre-deploy Neon branch (§3). Dev result for reference: 32/32 orders canonical, 0 untouched.
> - **Behavioural effect:** the PENDING-order throttle (≤ 3 per phone) now treats `010…` and `+2010…` as one customer. A customer who already has more than 3 PENDING orders under different spellings will be refused new orders until staff move some along. The §5 query lists them.

**Expected `migrate status` before deploying:** exactly the six names above pending. **If anything else is pending, or any migration shows as failed, stop**: production has drifted from `main`, and that needs its own review. `20261017000000_sync_schema_catchup` is expected to be recorded as applied already (see `.claude/rules/database.md`).

**Old code on the new schema** (the window between `migrate deploy` and the new deployment going live, and after any rollback): every change is additive. New tables, a nullable column, and a column with a constant default are all invisible to the old Prisma client. The one wrinkle is that the old checkout keeps writing phones as typed. §6 step 3 re-normalizes any that landed in that window.

---

## 3. Before you deploy

1. **Back up production (PROD).** In the Neon console, open the production project, go to **Branches → Create branch**, choose the production branch as the parent at **Current point in time**, and name it `pre-deploy-2026-10-24`. It is an instant copy-on-write snapshot. With the CLI:
   ```bash
   neonctl branches create --project-id <PROJECT_ID> --parent <PROD_BRANCH> --name pre-deploy-2026-10-24
   ```
   Note the time you created it, and check the project's **history retention** window, which bounds point-in-time restore as a second fallback. Optionally, also take a logical dump over the direct URL: `pg_dump "<PROD_DIRECT_URL>" -Fc -f alibaba-pre-deploy-2026-10-24.dump`.
2. **Check production's migration state, read-only (PROD).** Use the direct (non-pooled) URL:
   ```bash
   DIRECT_URL="<PROD_DIRECT_URL>" DATABASE_URL="<PROD_DIRECT_URL>" npx prisma migrate status
   ```
   Expect the six pending migrations from §2 and nothing else.
3. **Run the phone "before" report (PROD, read-only).** Run §5 query A and save the output.
4. **Rehearse on a copy (strongly recommended).** Create a second Neon branch from production, e.g. `deploy-rehearsal`. Point Vercel's **Preview** environment `DATABASE_URL` / `DIRECT_URL` at it, push the branches (§4), and let the preview build run the six migrations on real production data. Run §5 query B against the rehearsal branch and the §6 smoke checklist against the preview URL. Delete the rehearsal branch afterwards.
5. **Check the environment variables** (§7) in Vercel for **Production** *and* **Preview** scopes.

---

## 4. Merge plan

Current state: none of the three branches has been pushed, and `main` == `origin/main` == `076878a` is the merge base of the whole stack. `main` has nothing the stack lacks, so `main` can **fast-forward** to the tip of `feat/collections`, and that tip contains all three branches.

> ⚠ **Preview builds run migrations.** Pushing any branch triggers a Vercel preview build, which runs `prisma migrate deploy` against the **Preview** environment's database. If Preview shares production's `DATABASE_URL`/`DIRECT_URL`, **pushing a branch migrates production before anything is merged.** Point Preview at a Neon branch (§3.4) before the first push.

**Option A — fast-forward (recommended; one production deploy):**
```bash
git checkout main
git merge --ff-only feat/collections   # main now = feat/collections tip
git push origin main                   # triggers the production build
```

**Option B — three PRs (if you want review history on GitHub):**
1. `git push -u origin feat/hero-slides fix/hardening feat/collections`.
2. Open three PRs, all targeting `main`, and merge them **in order**: `feat/hero-slides`, then `fix/hardening`, then `feat/collections`. After each merge, the next PR's diff shrinks to its own commits.
3. Use **merge commits or rebase-merge, not squash**. Squashing a lower PR rewrites its commits, and the stacked branches above it would then conflict and need a rebase.
4. Each merge to `main` is a production deploy. That's fine, since each step is self-consistent and the migrations apply incrementally. Or merge all three back-to-back and let the last deploy win.

Never force-push `main`.

---

## 5. Data reports for the phone migration

**A — before (PROD, read-only):**
```sql
SELECT count(*)                                                       AS orders,
       count(*) FILTER (WHERE "customerPhone" ~ '^[+]201[0125][0-9]{8}$') AS already_canonical
FROM "Order";
```

**B — after deploy (PROD, read-only).** Everything left un-normalized, newest first:
```sql
SELECT "orderNumber", "customerPhone", status, "createdAt"
FROM "Order"
WHERE "customerPhone" !~ '^[+]201[0125][0-9]{8}$'
ORDER BY "createdAt" DESC;
```
Expected: only genuine non-mobiles (landlines, foreign numbers, typos). Any **Egyptian mobile** in this list came from the old checkout during the deploy window. Fix those with §6 step 3.

**C — customers now over the throttle (PROD, read-only, informational):**
```sql
SELECT "customerPhone", count(*) AS pending
FROM "Order" WHERE status = 'PENDING'
GROUP BY 1 HAVING count(*) >= 3
ORDER BY pending DESC;
```

---

## 6. Deploy and post-deploy smoke checklist

1. Merge per §4. Watch the Vercel build log: `prisma migrate deploy` must list the six migrations as applied, then `next build` must succeed. **If the build fails, production keeps serving the previous deployment** (no outage). Go to §8.
2. **(PROD)** Re-run `npx prisma migrate status` with the direct URL. Expect "Database schema is up to date!".
3. **(PROD)** Run §5 query B. If it lists Egyptian mobiles written during the deploy window, re-run **only the `DO $$ … END $$;` block** from `prisma/migrations/20261023000000_normalize_order_phone/migration.sql`, not the `CREATE INDEX`. It is idempotent and safe. Run query B again.
4. **(PROD) Configure the store:** Admin → Settings → **Store WhatsApp**. Until it's set, `/forgot-password` shows the neutral "contact the store" message.

**Smoke checklist** (production URL, after the build is live):

- [ ] **Homepage hero.** With no live hero slide, the classic hero and the promo seal render as before. Create a slide in `/admin/hero` (it starts inactive), publish it, and confirm the carousel replaces the classic hero within one request. The price pill reads "N ج.م". Unpublish it again if it was only a test.
- [ ] **Category pagination.** On a category with more than 24 listable products, `/category/<slug>/page/2` renders, has its own canonical, and has prev/next links. `/category/<slug>/page/1` permanently redirects to `/category/<slug>`. `/category/<slug>/page/999` returns a 404.
- [ ] **`/new-arrivals`** lists the newest products. `/collections` is now the Collections index; the old "collections" content moved to `/new-arrivals`.
- [ ] **A collection page.** In `/admin/collections`, create a collection (it starts as a draft), add 2–3 products, link a category, and publish. Then check that `/collections/<slug>` shows them in curated order, the category's page 1 shows the collection card, and the footer Collections column shows it if "Footer" is on.
- [ ] **Promo price on a collection product equals the billed price.** Create a PERCENTAGE promotion targeting only that collection, live now. Check the discounted price and strikethrough on the collection page, the category page, the PDP, the search palette and the cart. Then place a **guest** order containing that product and confirm the order's line `unitPrice` in `/admin/orders` equals the price shown. Switch the collection to inactive and confirm the discount disappears storefront-wide on the next request. Afterwards, deactivate or delete the test promotion and collection.
- [ ] **Guest checkout.** Delivery to a branch area works. Pickup with an active branch works. A phone typed as `0100 123 4567` is stored as `+201001234567` (admin drawer shows `010 0123 4567`). A non-mobile such as `0225551234` is refused inline.
- [ ] **Forgot-password flow.** From `/login`, open "Forgot password?" and submit an email. WhatsApp opens to the configured number with the prefilled message, and no network request goes to the app.
- [ ] **Admin reset.** In `/admin/users`, use "Reset password" on a test customer (never your own row; the button isn't offered there). The one-time dialog shows the temporary password and a WhatsApp link with no password in its URL. Sign in as that customer with the temporary password: every page redirects to `/account/change-password`. Choose a new password and the hold lifts. The old temporary password no longer works.
- [ ] **Admin sanity.** As a MANAGER, `/admin` and `/admin/orders` are still branch-scoped, and `/admin/collections` and `/admin/hero` bounce. Admin order search finds an order by `010…`, `+2010…` or Arabic-Indic digits.

---

## 7. Environment variables

**No new environment variables** are introduced by this release. The new code reads none (verified by grep; the only new `process.env` references are `TZ` pins in tests). Confirm the existing set in Vercel for both the **Production** and **Preview** scopes:

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | Runtime (`src/lib/prisma.ts`, pooled) | **Hard-required** at module load |
| `DIRECT_URL` | `prisma.config.ts`: **build-time `migrate deploy`** | Must be the **direct, non-pooled** Neon URL. If it's missing, migrations fall back to the pooled `DATABASE_URL`, which can't hold the advisory lock. `.env` locally has no `DIRECT_URL`, so confirm it exists in Vercel |
| `BETTER_AUTH_SECRET` | Better Auth | Unchanged |
| `BETTER_AUTH_URL` | Better Auth | The production origin |
| `NEXT_PUBLIC_APP_URL` | Auth client base URL | Optional |
| `UPLOADTHING_TOKEN` | UploadThing (incl. the new `heroImage` / `collectionImage` routes) | Unchanged. (`UPLOADTHING_SECRET` also exists in `.env`, as the legacy v6 name) |

---

## 8. Rollback plan

**If the build fails** (migration error or `next build` error), production keeps serving the last good deployment, so there's no outage.
1. **(PROD)** Run `npx prisma migrate status` to see what applied. Migrations that completed stay applied. They're additive, and the old code is unaffected by them.
2. If a migration is marked **failed**, inspect what it created before doing anything. After fixing the cause, run `npx prisma migrate resolve --rolled-back <name>` (or `--applied` if its objects fully exist), then redeploy. **Never delete rows from `_prisma_migrations` by hand and never `db push`.**

**If the new deployment misbehaves (app-level):**
1. In Vercel, go to Deployments, open the previous production deployment, and choose **Instant Rollback**. The schema stays as is, which is safe because every change is additive and the old code runs on it unchanged. New data (hero slides, collections, the WhatsApp number) simply goes dormant.
2. Side effects of running old code to know about. Users flagged `mustChangePassword` aren't held, but their temporary password still works. New orders store phones as typed again. When you roll forward later, re-run the normalization `DO` block (§6 step 3).
3. **Don't** write down-migrations or drop the new tables and columns to "match" the old code. It isn't needed, and it would discard data.

**If production data is damaged (last resort):**
1. Export anything written since the deploy that you need to keep, at minimum `SELECT * FROM "Order" WHERE "createdAt" > '<deploy time>'` plus their `OrderItem`s.
2. In Neon, restore the production branch from `pre-deploy-2026-10-24` (or point-in-time restore to just before the deploy), roll the app back as above, then re-enter the exported orders.
3. The only data rewrite in this release is the phone normalization, which overwrites formatting only. Restoring is therefore justified only if something else went wrong.

---

## 9. After a successful deploy

- Delete the `deploy-rehearsal` Neon branch, if you made one. Keep `pre-deploy-2026-10-24` for a week, then delete it.
- The open debts this release leaves are tracked in `docs/DOMAIN_MAP.md` §18.2 (D-19 – D-27).
