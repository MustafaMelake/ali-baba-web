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
