import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { parsePageParam } from "@/lib/pagination";
import { CollectionsIndex, collectionsIndexMetadata } from "../../listing";

// Page 2+ of the collections index — a PATH segment, so it shares the ISR cache.
// (The slug "page" is reserved for collections, so this never shadows one.)
export const revalidate = 60;

type Params = Promise<{ n: string }>;

async function resolvePage(params: Params) {
  const page = parsePageParam((await params).n);
  if (page === null) notFound();
  if (page === 1) permanentRedirect("/collections"); // one canonical URL per page
  return page;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return collectionsIndexMetadata(await resolvePage(params));
}

export default async function CollectionsPageN({ params }: { params: Params }) {
  return <CollectionsIndex page={await resolvePage(params)} />;
}
