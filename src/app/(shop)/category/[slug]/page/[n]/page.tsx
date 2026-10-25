import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { parsePageParam } from "@/lib/pagination";
import { CategoryListing, categoryMetadata } from "../../listing";

// Page 2+ of a category — a PATH segment, not ?page=, so it shares the ISR cache
// (frontend.md caching table). Same 60s window as page 1.
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

/** Page number from the segment: 2+ renders; 1 → the bare URL; junk → 404. */
async function resolvePage(params: Params) {
  const { slug, n } = await params;
  const page = parsePageParam(n);
  if (page === null) notFound();
  if (page === 1) permanentRedirect(`/category/${slug}`); // one canonical URL per page
  return { slug, page };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, page } = await resolvePage(params);
  return categoryMetadata(slug, page);
}

export default async function CategoryPageN({ params }: { params: Params }) {
  const { slug, page } = await resolvePage(params);
  return <CategoryListing slug={slug} page={page} />;
}
