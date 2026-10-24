import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { parsePageParam } from "@/lib/pagination";
import { CollectionListing, collectionMetadata } from "../../listing";

// Page 2+ of a collection — a PATH segment, so it shares the ISR cache.
export const revalidate = 60;

type Params = Promise<{ slug: string; n: string }>;

async function resolvePage(params: Params) {
  const { slug, n } = await params;
  const page = parsePageParam(n);
  if (page === null) notFound();
  if (page === 1) permanentRedirect(`/collections/${slug}`); // one canonical URL per page
  return { slug, page };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, page } = await resolvePage(params);
  return collectionMetadata(slug, page);
}

export default async function CollectionPageN({ params }: { params: Params }) {
  const { slug, page } = await resolvePage(params);
  return <CollectionListing slug={slug} page={page} />;
}
