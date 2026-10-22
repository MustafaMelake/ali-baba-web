import { z } from "zod";
import { FulfillmentMethod, MarketingEventType } from "@/generated/prisma/enums";
import { daysBetween, isDayKey } from "@/lib/marketing-calendar";
import { roundMoney } from "@/lib/discounts";

/**
 * Shared validation schemas — imported by BOTH the client forms (for instant
 * feedback) and the server actions (the authoritative check; never trust the
 * client). Kept in a plain module so it can be imported from "use server" files.
 */

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// An optional free-text field that may arrive as "" from an empty input.
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

// ─── Stored image URLs ───────────────────────────────────────────────────────

/**
 * The remote hosts `next/image` will render — MUST mirror `images.remotePatterns`
 * in next.config.ts (the legacy `utfs.io` host + one `*.ufs.sh` label). An image
 * URL on any other host makes `<Image>` throw at render, which takes down the
 * whole ISR page showing it (the homepage, for a location card), not just the card.
 */
const UPLOADTHING_HOST = /^(?:utfs\.io|[^.]+\.ufs\.sh)$/;

export const HOSTED_IMAGE_ERROR = "Upload the image here — pasted links can't be displayed.";

/**
 * The one rule for every image URL an admin action persists (product gallery,
 * category card, location card, hero slide): an UploadThing URL over https, or
 * a /public path. Every admin form uploads through UploadThing, so a legitimate
 * payload always passes; this is the server's refusal of a forged one.
 */
export function isHostedImageUrl(url: string): boolean {
  if (url.startsWith("/")) {
    // A /public path — but not "//host" or "/\host" (browsers resolve both
    // off-site), and no query/fragment (Next 16 refuses a local image with a
    // search string unless `images.localPatterns` allows it).
    return /^\/(?![/\\])[^?#\s]+$/.test(url);
  }
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.port === "" &&
      UPLOADTHING_HOST.test(parsed.hostname)
    );
  } catch {
    return false; // neither a /public path nor an absolute URL
  }
}

const hostedImageUrl = z.string().trim().refine(isHostedImageUrl, HOSTED_IMAGE_ERROR);

// ─── Admin-entered links ─────────────────────────────────────────────────────

export const SAFE_HREF_ERROR = 'Link must start with "/", "#", or "http(s)://".';

/**
 * The one href whitelist for every admin-entered link the storefront renders
 * (footer links, hero slides) — a *security* control against stored XSS via a
 * pasted "javascript:"/"data:" href. Accepts an internal path ("/…"), an
 * in-page anchor ("#…"), or an absolute http(s) URL with a host. Rejects the
 * protocol-relative "//host" and its "/\host" spelling: both start with "/"
 * yet browsers resolve them off-site, so they'd pass an "internal" check.
 */
export function isSafeHref(url: string): boolean {
  return safeHrefError(url) === null;
}

export const PROTOCOL_RELATIVE_ERROR =
  "Links starting with // aren't allowed — use /page or https://…";

/**
 * The same whitelist as `isSafeHref`, returning WHY a link was refused — the
 * protocol-relative case gets its own message, because "must start with /"
 * reads as nonsense to an admin whose link already does. Null when safe.
 */
export function safeHrefError(url: string): string | null {
  if (/^\/[/\\]/.test(url)) return PROTOCOL_RELATIVE_ERROR;
  if (url.startsWith("/") || url.startsWith("#")) return null;
  return /^https?:\/\/[^\s/\\]/i.test(url) ? null : SAFE_HREF_ERROR;
}

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
  images: z.array(hostedImageUrl).default([]),
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
  images: z.array(hostedImageUrl).default([]),
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
/** Longest order note — the /cart notes box and checkout share it with the schema. */
export const ORDER_NOTES_MAX_LENGTH = 1000;

/**
 * Rejection message when a single-line sync would push the persisted cart past
 * CHECKOUT_MAX_ITEMS distinct lines. Lives here (a plain module, not the
 * "use server" cart actions) so BOTH the server action and the client store can
 * import the exact same string — the store matches on it to roll back the
 * optimistic line instead of leaving a doomed pending op behind.
 */
export const CART_LIMIT_ERROR = "Cart cannot exceed 50 distinct items.";

/** Ceiling on any single delivery fee (EGP) — blocks fat-fingered "3500000" typos. */
export const MAX_DELIVERY_FEE = 10_000;

/**
 * THE delivery-fee rule, shared by both admin surfaces that set one (the
 * Settings fee sheet and the Branch modal): a finite number in
 * [0, MAX_DELIVERY_FEE] — 0 means free delivery — rounded to 2 dp like all
 * money. Returns null when invalid.
 */
export function parseDeliveryFee(value: number): number | null {
  const fee = Number(value);
  if (!Number.isFinite(fee) || fee < 0 || fee > MAX_DELIVERY_FEE) return null;
  return roundMoney(fee);
}

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
// ─── Phone numbers ───────────────────────────────────────────────────────────

/** Egyptian mobile operators' national prefixes: 010, 011, 012, 015. */
const EGYPT_MOBILE_NATIONAL = /^1[0125]\d{8}$/;

export const PHONE_ERROR = "Enter an Egyptian mobile number, e.g. 010 1234 5678.";

/**
 * THE phone normalizer — every stored customer phone is canonical E.164
 * ("+201001234567"), so the per-phone checkout throttle, admin search and the
 * wa.me links see one customer as one phone however it was typed.
 *
 * Accepts the national form (01…), the country-code forms (201…, +201…,
 * 00201…), separators (spaces, dashes, dots, parentheses) and Arabic-Indic /
 * Eastern Arabic-Indic digits. Egyptian MOBILES only — the store calls back on
 * WhatsApp. Returns null for anything else.
 *
 * Mirrored in SQL by the 20261023000000_normalize_order_phone migration — keep
 * the two in step.
 */
export function normalizeEgyptMobile(raw: string): string | null {
  const ascii = (raw ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s\-.()]/g, "");

  let national: string;
  if (/^\+20\d+$/.test(ascii)) national = ascii.slice(3);
  else if (/^0020\d+$/.test(ascii)) national = ascii.slice(4);
  else if (/^20\d+$/.test(ascii)) national = ascii.slice(2);
  else if (/^0\d+$/.test(ascii)) national = ascii.slice(1);
  else return null;

  return EGYPT_MOBILE_NATIONAL.test(national) ? `+20${national}` : null;
}

/**
 * The digits an admin's search box should match against canonical phones:
 * "0100 123", "+20100123", "٠١٠٠" all reduce to "100123…". Null when the query
 * carries too few digits to be a phone fragment.
 */
export function phoneSearchDigits(query: string): string | null {
  const digits = (query ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "")
    .replace(/^(?:0020|20|0)/, "");
  return digits.length >= 3 ? digits : null;
}

/**
 * The store's WhatsApp number (Admin → Settings). Same normalizer as checkout,
 * so it is always a dialable canonical mobile; blank clears it (→ null).
 */
export const storeWhatsappSchema = z.object({
  whatsappNumber: z
    .string()
    .trim()
    .max(30, "Phone number is too long")
    .transform((value, ctx) => {
      if (value === "") return null;
      const phone = normalizeEgyptMobile(value);
      if (!phone) {
        ctx.addIssue({ code: "custom", message: PHONE_ERROR });
        return z.NEVER;
      }
      return phone;
    }),
});

/**
 * A PICKUP order needs a real, active branch to be collected from. Shared so
 * the checkout's blocked-state note is word-for-word placeOrder's refusal.
 */
export const PICKUP_UNAVAILABLE_ERROR =
  "Pickup isn't available from that branch right now — please choose another branch or delivery.";

export const checkoutSchema = z
  .object({
    items: z
      .array(checkoutItemSchema)
      .min(1, "Your cart is empty.")
      .max(
        CHECKOUT_MAX_ITEMS,
        `Orders are limited to ${CHECKOUT_MAX_ITEMS} different items.`,
      )
      // One line per variant — the cart is keyed by variantId, so only a
      // crafted payload repeats one, and that would sidestep the per-line
      // CHECKOUT_MAX_QUANTITY cap and split one item across order lines.
      .refine(
        (items) => new Set(items.map((item) => item.variantId)).size === items.length,
        "Each item can only appear once in an order.",
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
    // Normalized to canonical E.164 — the throttle and admin views key on it.
    customerPhone: z
      .string()
      .trim()
      .min(1, "Phone number is required")
      .max(30, "Phone number is too long")
      .transform((value, ctx) => {
        const phone = normalizeEgyptMobile(value);
        if (!phone) {
          ctx.addIssue({ code: "custom", message: PHONE_ERROR });
          return z.NEVER;
        }
        return phone;
      }),
    orderNotes: optionalText(ORDER_NOTES_MAX_LENGTH),
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

// ─── Hero slides ─────────────────────────────────────────────────────────────

/**
 * Soft cap on stored slides (admin list + the bound on one reorder
 * transaction). The storefront separately shows at most HERO_MAX_LIVE_SLIDES.
 */
export const HERO_MAX_SLIDES = 12;

/**
 * One homepage hero slide, shared by the admin modal (instant feedback) and the
 * hero-slides actions (the authoritative re-parse). Overlay copy is all
 * optional — a designed image may carry its own text. Exactly ONE destination:
 * a product (CTA → its page, optional display-only price) or a whitelisted
 * link. `showPrice` only means something on a product slide; the renderer
 * ignores it otherwise. Dates are Cairo calendar days, resolved to instants by
 * storeDateStart / storeDateEnd in the action, exactly like promotions.
 */
export const heroSlideSchema = z
  .object({
    eyebrow: optionalNote(40, "Eyebrow"),
    title: optionalNote(90, "Headline"),
    subtitle: optionalNote(200, "Subtitle"),
    ctaLabel: z
      .string()
      .trim()
      .min(2, "Button label must be at least 2 characters.")
      .max(30, "Button label is too long (max 30 characters)."),
    showPrice: z.boolean(),
    imageDesktop: z
      .string({ error: "Upload a desktop image." })
      .trim()
      .min(1, "Upload a desktop image.")
      .refine(isHostedImageUrl, HOSTED_IMAGE_ERROR),
    imageMobile: z
      .string()
      .trim()
      .refine((url) => url === "" || isHostedImageUrl(url), HOSTED_IMAGE_ERROR)
      .nullish()
      .transform((value) => value || null),
    imageAlt: z
      .string()
      .trim()
      .min(2, "Describe the image (including any text written on it).")
      .max(300, "Image description is too long (max 300 characters)."),
    productId: z
      .string()
      .trim()
      .nullish()
      .transform((value) => value || null),
    linkUrl: z
      .string()
      .trim()
      .max(2048, "Link is too long.")
      .superRefine((url, ctx) => {
        const error = url === "" ? null : safeHrefError(url);
        if (error) ctx.addIssue({ code: "custom", message: error });
      })
      .nullish()
      .transform((value) => value || null),
    isActive: z.boolean(),
    startsOn: calendarDate.nullish().or(z.literal("")).transform((value) => value || null),
    endsOn: calendarDate.nullish().or(z.literal("")).transform((value) => value || null),
  })
  .superRefine((data, ctx) => {
    if (Boolean(data.productId) === Boolean(data.linkUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["productId"],
        message: "Choose exactly one destination — a product or a link.",
      });
    }
    if (data.startsOn && data.endsOn && data.endsOn < data.startsOn) {
      ctx.addIssue({
        code: "custom",
        path: ["endsOn"],
        message: "End date can't be before the start date.",
      });
    }
  });

/** What the hero modal sends (blank optionals may still be "" / undefined). */
export type HeroSlideInput = z.input<typeof heroSlideSchema>;
/** The normalized slide the actions write (dates still Cairo day keys). */
export type HeroSlideData = z.output<typeof heroSlideSchema>;

/** A full reordering of the hero slides — every id once, bounded by the cap. */
export const heroSlideReorderSchema = z
  .array(z.string().trim().min(1, "Missing slide."))
  .min(1, "Nothing to reorder.")
  .max(HERO_MAX_SLIDES, "Too many slides in one reorder.")
  .refine((ids) => new Set(ids).size === ids.length, {
    error: "Each slide may appear only once.",
  });

// ─── Branch stock ────────────────────────────────────────────────────────────

/**
 * Ceiling on variants flipped in one branch-stock write — a whole product's
 * variants at once ("Mark product out of stock"). Keeps the write's
 * `variantId IN (…)` lists bounded against a forged payload.
 */
export const BRANCH_STOCK_MAX_VARIANTS = 50;

/**
 * One branch-stock toggle, shared by the inventory island and
 * `setBranchStock`. `branchId` is what the caller ASKS for — the action still
 * resolves it through `resolveBranchScope`, so a MANAGER naming another branch
 * is refused there, not trusted here. Omitted → the caller's own branch.
 */
export const branchStockSchema = z.object({
  branchId: z.string().trim().min(1).optional(),
  variantIds: z
    .array(z.string().trim().min(1, "Missing variant."))
    .min(1, "Pick at least one item.")
    .max(BRANCH_STOCK_MAX_VARIANTS, "Too many items in one change.")
    .refine((ids) => new Set(ids).size === ids.length, {
      error: "Each item may appear only once.",
    }),
  isAvailable: z.boolean({ error: "Choose in stock or out of stock." }),
});

export type BranchStockInput = z.infer<typeof branchStockSchema>;

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
