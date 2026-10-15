import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getStoreSettings } from "@/lib/store-settings";
import { getActiveBranches } from "@/lib/actions/branches";
import { estimateDelivery } from "@/lib/cart-summary";
import CartView from "@/components/cart/CartView";

// Shared ISR cache (60s): the shell holds no per-user data — the cart itself
// lives client-side in the Zustand store — only the store-wide VAT settings and
// branch delivery fees for the summary preview. Pricing-settings and branch
// mutations revalidate "/cart" directly; checkout re-reads both anyway.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Your Bag | Ali Baba",
  description: "Review your selection before checkout.",
  alternates: { canonical: "/cart" },
  // A personal, client-rendered page — nothing for a search engine to index.
  robots: { index: false, follow: true },
};

export default async function CartPage() {
  // Both reads in one round-trip; each degrades on its own so a failure never
  // blanks the page (preview only — placeOrder re-reads the real values). A
  // failure degrades to "calculated at checkout", never to the schema
  // defaults: this HTML is cached, and a guessed 14% VAT would sit here for up
  // to a minute after an admin switched VAT off.
  const [pricing, branches] = await Promise.all([
    getStoreSettings().catch(() => null),
    getActiveBranches().catch(() => null),
  ]);
  const delivery =
    pricing && branches
      ? estimateDelivery(branches.map((b) => b.deliveryFee), pricing.defaultDeliveryFee)
      : null;

  return (
    // The (shop) layout owns <main> and the navbar clearance — editorial spacing only here.
    <div className="mx-auto max-w-screen-xl px-6 py-12 md:px-10 md:py-16 lg:px-14">
      <header className="mb-10 md:mb-14">
        <nav
          aria-label="Breadcrumb"
          className="mb-6 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-stone-400"
        >
          <Link href="/" className="transition-colors hover:text-primary">
            Home
          </Link>
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          <span className="text-stone-600" aria-current="page">
            Cart
          </span>
        </nav>
        <h1 className="font-serif text-[clamp(2.25rem,5vw,3.75rem)] font-medium leading-[1.05] tracking-tight text-stone-900">
          Your Shopping Bag
        </h1>
        <p className="mt-2 text-lg text-stone-400">
          <span dir="rtl" lang="ar">
            سلة المشتريات
          </span>
        </p>
      </header>

      <CartView pricing={pricing && { ...pricing }} delivery={delivery} />
    </div>
  );
}
