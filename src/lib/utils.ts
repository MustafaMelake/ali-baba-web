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

/** SCREAMING_SNAKE_CASE enum value -> "Title Case" — e.g. ORIENTAL_SWEETS -> "Oriental Sweets". */
export function prettyLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}
