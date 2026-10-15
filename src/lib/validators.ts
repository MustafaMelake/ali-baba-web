import { z } from "zod";
import { FulfillmentMethod, MarketingEventType } from "@/generated/prisma/enums";
import { daysBetween, isDayKey } from "@/lib/marketing-calendar";

/**
 * Shared validation schemas — imported by BOTH the client forms (for instant
 * feedback) and the server actions (the authoritative check; never trust the
 * client). Kept in a plain module so it can be imported from "use server" files.
 */

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// An optional free-text field that may arrive as "" from an empty input.
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

// A single variant on the edit form. `id` present → an existing row to update;
// absent → a brand-new variant to create.
export const variantInputSchema = z
  .object({
    id: z.string().optional(),
    name: z
      .string()
      .trim()
      .min(1, "Variant name is required")
      .max(80, "Variant name is too long"),
    price: z
      .number({ error: "Enter a valid price" })
      .positive("Price must be greater than 0"),
    // Optional "was" price for promotions. The client maps an empty input to
    // `null`; a non-numeric input arrives as NaN and trips the type error.
    // `null`/`undefined` both mean "no discount" and skip the positivity check.
    compareAtPrice: z
      .number({ error: "Enter a valid original price" })
      .positive("Original price must be greater than 0")
      .nullish(),
    sku: optionalText(64),
  })
  // Business rule: a strike-through original price only makes sense ABOVE the
  // selling price. Attaching the issue to `compareAtPrice` surfaces it inline
  // on that exact input (path → `variants.<i>.compareAtPrice`).
  .refine((v) => v.compareAtPrice == null || v.compareAtPrice > v.price, {
    error: "Original price must be greater than the selling price.",
    path: ["compareAtPrice"],
  });

export type VariantInput = z.infer<typeof variantInputSchema>;

export const productInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(120, "Name is too long"),
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(140, "Slug is too long")
    .regex(slugRegex, "Use lowercase letters, numbers and hyphens only"),
  description: optionalText(2000),
  categoryId: z.string().min(1, "Select a category"),
  images: z.array(z.string()).default([]),
  variants: z.array(variantInputSchema).min(1, "Add at least one variant"),
});

export type ProductInput = z.infer<typeof productInputSchema>;

// Full payload for updating a product, including its (multi-)variant list.
export const productUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(120, "Name is too long"),
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(140, "Slug is too long")
    .regex(slugRegex, "Use lowercase letters, numbers and hyphens only"),
  description: optionalText(2000),
  categoryId: z.string().min(1, "Select a category"),
  images: z.array(z.string()).default([]),
  isAvailable: z.boolean(),
  isFeatured: z.boolean(),
  variants: z.array(variantInputSchema).min(1, "Add at least one variant"),
});

export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

// ─── Checkout ────────────────────────────────────────────────────────────────

// Hard ceilings for a checkout payload, enforced BEFORE any database work so a
// forged payload can't drag `placeOrder` into unbounded queries (its variant
// fetch is `id IN (…)` over at most CHECKOUT_MAX_ITEMS ids). MAX_QUANTITY
// mirrors the DB cart's clamp (MAX_QUANTITY in src/lib/actions/cart.ts).
export const CHECKOUT_MAX_ITEMS = 50;
export const CHECKOUT_MAX_QUANTITY = 99;

/**
 * Rejection message when a single-line sync would push the persisted cart past
 * CHECKOUT_MAX_ITEMS distinct lines. Lives here (a plain module, not the
 * "use server" cart actions) so BOTH the server action and the client store can
 * import the exact same string — the store matches on it to roll back the
 * optimistic line instead of leaving a doomed pending op behind.
 */
export const CART_LIMIT_ERROR = "Cart cannot exceed 50 distinct items.";

/** One order line as the client ships it — the server re-resolves the price. */
export const checkoutItemSchema = z.object({
  variantId: z.string().trim().min(1, "Missing variant."),
  quantity: z
    .number({ error: "Enter a valid quantity" })
    .int("Quantity must be a whole number")
    .min(1, "Quantity must be at least 1")
    .max(
      CHECKOUT_MAX_QUANTITY,
      `Quantity can't exceed ${CHECKOUT_MAX_QUANTITY} per item`,
    ),
});

/**
 * The full checkout payload, shared by the checkout form (instant feedback)
 * and `placeOrder` (the authoritative check — never trust the client copy).
 *
 * `addressLine` is CONDITIONALLY required: a DELIVERY order without a real
 * address is undeliverable, while a PICKUP order carries no address at all.
 * That cross-field rule can't be expressed on the field itself, so it lives
 * in `superRefine` with the issue attached to `addressLine` — the form
 * surfaces it inline on that exact input (path → `addressLine`).
 */
export const checkoutSchema = z
  .object({
    items: z
      .array(checkoutItemSchema)
      .min(1, "Your cart is empty.")
      .max(
        CHECKOUT_MAX_ITEMS,
        `Orders are limited to ${CHECKOUT_MAX_ITEMS} different items.`,
      ),
    fulfillment: z.enum(FulfillmentMethod),
    addressLine: optionalText(500),
    pickupBranch: optionalText(120),
    branchId: z.string().nullish(),
    customerName: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(120, "Name is too long"),
    customerPhone: z
      .string()
      .trim()
      .min(1, "Phone number is required")
      .max(30, "Phone number is too long"),
    orderNotes: optionalText(1000),
  })
  .superRefine((data, ctx) => {
    // `optionalText` trims, so a whitespace-only address arrives here as "";
    // the extra .trim() is belt-and-braces against future schema edits.
    if (
      data.fulfillment === FulfillmentMethod.DELIVERY &&
      (!data.addressLine || data.addressLine.trim().length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["addressLine"],
        message: "Please add a delivery address.",
      });
    }
  });

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const categoryUpdateSchema = z.object({
  id: z.string().min(1, "Missing category id"),
  subtitle: optionalText(160),
  image: optionalText(2048),
});

export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

// ─── Storefront search ───────────────────────────────────────────────────────

/** Shortest query worth a round-trip — anything shorter shows suggestions. */
export const SEARCH_MIN_QUERY_LENGTH = 2;
/** Longest query accepted. The search input caps itself at the same length. */
export const SEARCH_MAX_QUERY_LENGTH = 64;
/** Words matched per query — bounds the size of the generated `where`. */
export const SEARCH_MAX_TOKENS = 5;

/**
 * THE canonical form of a search query. The search palette gates its
 * round-trip on it and `searchCatalog` matches on it, so both sides always
 * agree on what was searched. Strips `%`, `_` and `\` — LIKE metacharacters in
 * the ILIKE the search compiles to, and nothing a product name needs — so
 * matching stays literal however the driver treats wildcards, then collapses
 * whitespace.
 */
export function normalizeSearchQuery(raw: string): string {
  return raw.replace(/[%_\\]/g, "").replace(/\s+/g, " ").trim();
}

/** The words a normalized query matches on (every one must hit). */
export function searchTokens(query: string): string[] {
  return query.split(" ").filter(Boolean).slice(0, SEARCH_MAX_TOKENS);
}

export const searchQuerySchema = z
  .string()
  .trim()
  .max(SEARCH_MAX_QUERY_LENGTH, "That search is too long.")
  .transform(normalizeSearchQuery)
  .pipe(
    z
      .string()
      .min(
        SEARCH_MIN_QUERY_LENGTH,
        `Type at least ${SEARCH_MIN_QUERY_LENGTH} characters to search.`,
      ),
  );

// ─── Marketing calendar ──────────────────────────────────────────────────────

/** Longest reminder accepted — past a year it's a typo, not a season. */
export const MARKETING_EVENT_MAX_DAYS = 366;

// A Cairo calendar date as the date input submits it ("YYYY-MM-DD").
const calendarDate = z.string().trim().refine(isDayKey, "Pick a valid date.");

// Optional free text: blank collapses to null so the column stays NULL.
const optionalNote = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (max ${max} characters).`)
    .nullish()
    .transform((value) => value || null);

/**
 * A custom marketing-calendar reminder, shared by the calendar form (instant
 * feedback) and the marketing-events actions (the authoritative re-parse).
 * `targetDiscountPercent` is a planning note in whole percent — it never
 * prices anything; a live discount is still a Promotion.
 */
export const marketingEventSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(2, "Title must be at least 2 characters.")
      .max(120, "Title is too long (max 120 characters)."),
    type: z.enum(MarketingEventType, { error: "Pick an event type." }),
    startDate: calendarDate,
    endDate: calendarDate,
    notes: optionalNote(1000, "Notes"),
    strategy: optionalNote(300, "Strategy"),
    targetDiscountPercent: z
      .number({ error: "Enter the target discount as a number." })
      .int("Use a whole percentage.")
      .min(1, "Target discount must be at least 1%.")
      .max(100, "Target discount can't exceed 100%.")
      .nullish()
      .transform((value) => value ?? null),
  })
  .superRefine((data, ctx) => {
    if (!isDayKey(data.startDate) || !isDayKey(data.endDate)) return;
    if (data.endDate < data.startDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date can't be before the start date.",
      });
    } else if (daysBetween(data.startDate, data.endDate) + 1 > MARKETING_EVENT_MAX_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "A reminder can span at most a year.",
      });
    }
  });

/** What the calendar form sends (blank optionals may still be "" / undefined). */
export type MarketingEventInput = z.input<typeof marketingEventSchema>;
/** The normalized reminder the actions write. */
export type MarketingEventData = z.output<typeof marketingEventSchema>;

/**
 * Flattens a ZodError into a `{ "path.to.field": "message" }` map. Stable across
 * Zod minor versions (reads `.issues` directly) and handles nested paths like
 * `variant.price`.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
