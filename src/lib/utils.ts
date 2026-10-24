import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { percentOff } from "@/lib/discounts"
import { STORE_TZ } from "@/lib/timezone"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * THE slug minter — lowercase, trim, collapse non-alphanumerics to "-", strip
 * stray hyphens.
 *
 * Lives here rather than in `action-utils.ts` because admin forms preview the
 * slug as you type, and that preview must be the *same* function the server
 * mints with — not a mirror of it that can silently drift. `action-utils.ts`
 * is server-only by dependency (its gates pull in the session reader, which
 * reads request headers), so a client component cannot import from it; this
 * module has no dependencies beyond clsx/tailwind-merge and is safe on both
 * sides of the boundary.
 *
 * Non-latin input (e.g. Arabic) slugifies to "" — callers that need a
 * guaranteed non-empty slug must supply their own fallback (see menu.ts).
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * THE money figure formatter — every price node in the app renders through
 * this. Strictly "en-EG" (Western digits) so the same amount never switches
 * numeral systems between surfaces (the cart drawer once used "ar-EG" —
 * Eastern Arabic digits — while checkout used "en-EG"). Bare number only:
 * the currency mark (ج.م / EGP) is rendered by the caller so it can be styled
 * as its own element. Capped at 2 fraction digits — money, not floats.
 */
export function formatMoney(amount: number): string {
  return amount.toLocaleString("en-EG", { maximumFractionDigits: 2 })
}

/** Money formatter for the admin UI. Prices are stored as Floats (EGP). */
export function formatEGP(amount: number) {
  return `EGP ${formatMoney(amount)}`
}

/**
 * A canonical Egyptian mobile ("+201001234567") as staff dial it locally:
 * "010 0123 4567". Anything else — a legacy row the phone migration couldn't
 * normalize — is returned unchanged.
 */
export function formatPhoneLocal(phone: string): string {
  const m = /^\+20(1\d)(\d{4})(\d{4})$/.exec(phone);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : phone;
}

/**
 * A WhatsApp chat link for a canonical Egyptian mobile, optionally with a
 * prefilled message. Null for a non-canonical value (no reliable number).
 */
export function whatsappHref(phone: string, text?: string): string | null {
  if (!/^\+201\d{9}$/.test(phone)) return null;
  const base = `https://wa.me/${phone.slice(1)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

// Every displayed date/time is store (Cairo) wall-clock, never the runtime's
// zone — production renders in UTC, which put dates a day early and order
// times 2–3h off.

/** Compact, locale-stable Cairo date — e.g. "20 Jun 2026". */
export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: STORE_TZ,
  }).format(date)
}

/** Humanized Cairo date + time for invoices — e.g. "21 June 2026 · 14:30". */
export function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: STORE_TZ,
  })
    .format(date)
    .replace(",", " ·")
}

/**
 * Derives a variant's promotional/sale state from its raw form-string inputs.
 * The rule mirrors the storefront (`compareAtPrice > price`): a "compare-at"
 * (original) price only counts as a discount when it parses to a finite number
 * STRICTLY greater than a positive selling price. Returns the percent-off used
 * by the inline sale badge. Kept pure so both admin forms share one rule and
 * can't drift from each other or from the storefront.
 */
export function deriveVariantDiscount(priceInput: string, compareAtInput: string) {
  const price = Number(priceInput)
  const compareAt = Number(compareAtInput)
  const isOnSale =
    compareAtInput.trim() !== "" &&
    Number.isFinite(price) &&
    price > 0 &&
    Number.isFinite(compareAt) &&
    compareAt > price
  // The storefront badge's own math, so the admin preview shows the same figure.
  const percent = isOnSale ? percentOff(price, compareAt) : 0
  return { isOnSale, percentOff: percent }
}

/** SCREAMING_SNAKE_CASE enum value -> "Title Case" — e.g. ORIENTAL_SWEETS -> "Oriental Sweets". */
export function prettyLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/**
 * Guards against an open-redirect: a `redirect` value typically arrives as a raw
 * query-string value, so anyone can link to `/login?redirect=https://evil.com`
 * directly (it never has to pass through our own proxy.ts to be attacker-
 * controlled). Only a same-origin relative path is accepted — absolute URLs and
 * the protocol-relative "//host" AND backslash "/\host" tricks (both of which a
 * browser normalises to a different origin) fall back to "/". Rejecting a second
 * character of "/" OR "\" blocks both in one check. Shared so every auth surface
 * that honors a `?redirect=` (login, signup, password reset, …) applies the
 * identical guard.
 */
export function sanitizeRedirect(path: string | null): string {
  if (!path || !path.startsWith("/") || path[1] === "/" || path[1] === "\\") return "/"
  return path
}

