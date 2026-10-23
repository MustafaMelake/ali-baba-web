import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { parsePageParam } from "@/lib/pagination";
import { NewArrivalsListing, newArrivalsMetadata } from "../../listing";

// Page 2+ of New Arrivals — a PATH segment, so it shares the ISR cache.
export const revalidate = 60;

type Params = Promise<{ n: string }>;

/** Page number from the segment: 2+ renders; 1 → the bare URL; junk → 404. */
async function resolvePage(params: Params) {
  const page = parsePageParam((await params).n);
  if (page === null) notFound();
  if (page === 1) permanentRedirect("/new-arrivals"); // one canonical URL per page
  return page;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return newArrivalsMetadata(await resolvePage(params));
}

export default async function NewArrivalsPageN({ params }: { params: Params }) {
  return <NewArrivalsListing page={await resolvePage(params)} />;
}
