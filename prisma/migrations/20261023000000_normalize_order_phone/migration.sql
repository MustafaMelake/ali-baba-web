-- Phone normalization (DOMAIN_MAP D-6 + D-7).
--
-- checkoutSchema now stores every customer phone as canonical E.164 for an
-- Egyptian mobile ("+201001234567"), so placeOrder's per-phone PENDING throttle
-- counts "010…" and "+2010…" as ONE phone. This migration brings existing orders
-- onto the same key, then indexes the throttle's COUNT.
--
-- Safe on ANY database (dev or production):
--   • Idempotent — a canonical value maps to itself, and only rows whose value
--     actually changes are touched, so a re-run updates nothing.
--   • Never deletes a row, never touches any other column (a raw UPDATE leaves
--     "updatedAt" as it was — the order's history is unchanged).
--   • A value it can't parse as an Egyptian mobile (landline, foreign, typo) is
--     LEFT AS IT IS and counted in the NOTICE below; the admin UI shows it raw.
--
-- SQL twin of normalizeEgyptMobile (src/lib/validators.ts): Arabic-Indic and
-- Eastern Arabic-Indic digits → ASCII, strip spaces / dashes / dots /
-- parentheses, then accept 01X…, 201X…, +201X…, 00201X… with X ∈ {0,1,2,5}.

DO $$
DECLARE
  normalized integer;
  unparseable integer;
BEGIN
  WITH cleaned AS (
    SELECT
      id,
      regexp_replace(
        translate("customerPhone", '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
        '[[:space:].()-]', '', 'g'
      ) AS c
    FROM "Order"
  ),
  canon AS (
    SELECT
      id,
      CASE
        WHEN c ~ '^[+]201[0125][0-9]{8}$' THEN c
        WHEN c ~ '^00201[0125][0-9]{8}$' THEN '+' || substr(c, 3)
        WHEN c ~ '^201[0125][0-9]{8}$' THEN '+' || c
        WHEN c ~ '^01[0125][0-9]{8}$' THEN '+2' || c
      END AS e164
    FROM cleaned
  )
  UPDATE "Order" AS o
  SET "customerPhone" = canon.e164
  FROM canon
  WHERE o.id = canon.id
    AND canon.e164 IS NOT NULL
    AND o."customerPhone" <> canon.e164;
  GET DIAGNOSTICS normalized = ROW_COUNT;

  SELECT count(*) INTO unparseable
  FROM "Order"
  WHERE "customerPhone" !~ '^[+]201[0125][0-9]{8}$';

  RAISE NOTICE 'Order phone normalization: % row(s) normalized, % row(s) left untouched (not an Egyptian mobile).',
    normalized, unparseable;
END $$;

-- CreateIndex
CREATE INDEX "Order_customerPhone_status_idx" ON "Order"("customerPhone", "status");
