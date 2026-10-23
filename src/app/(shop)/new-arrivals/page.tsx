import type { Metadata } from "next";
import { NewArrivalsListing, newArrivalsMetadata } from "./listing";

// Shared ISR cache (60s), matching the category pages and the PDP: this page is
// identical for every visitor (wishlist hearts hydrate client-side from the
// shared store — never seeded here), so it regenerates at most once a minute.
// Product and category mutations revalidate "/new-arrivals" directly; promotion
// mutations bust the whole storefront tree via revalidatePath("/", "layout").
// The 60s window only bounds pure time-based promotion liveness. Page 2+ live
// at ./page/[n].
export const revalidate = 60;

export function generateMetadata(): Metadata {
  return newArrivalsMetadata(1);
}

export default function NewArrivalsPage() {
  return <NewArrivalsListing page={1} />;
}
