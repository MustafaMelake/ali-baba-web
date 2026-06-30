import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Money formatter for the admin UI. Prices are stored as Floats (EGP). */
export function formatEGP(amount: number) {
  return `EGP ${amount.toLocaleString("en-EG", { maximumFractionDigits: 2 })}`
}

/** Compact, locale-stable date — e.g. "20 Jun 2026". */
export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date)
}

/** Humanized date + time for invoices — e.g. "21 June 2026 · 14:30". */
export function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
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
  const percentOff = isOnSale ? Math.round((1 - price / compareAt) * 100) : 0
  return { isOnSale, percentOff }
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
 * the protocol-relative "//host" trick (which browsers resolve to a different
 * origin) both fall back to "/". Shared so every auth surface that honors a
 * `?redirect=` (login, signup, password reset, …) applies the identical guard.
 */
export function sanitizeRedirect(path: string | null): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/"
  return path
}
