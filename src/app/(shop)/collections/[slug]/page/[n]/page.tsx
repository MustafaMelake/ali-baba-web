import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { parsePageParam } from "@/lib/pagination";
import { CollectionListing, collectionMetadata } from "../../listing";

// Page 2+ of a collection — a PATH segment, so it shares the ISR cache.
export const revalidate = 60;

// No paths are pre-rendered at build: each URL renders on its first visit, then
// serves from the shared ISR cache like any static page. Without this, a dynamic
// segment is server-rendered on EVERY request (`ƒ`) and `revalidate` above is
// ignored. dynamicParams stays at its default (true), so an
// unknown slug or page number still reaches notFound().
export async function generateStaticParams(): Promise<{ slug: string; n: string }[]> {
  return [];
}

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
