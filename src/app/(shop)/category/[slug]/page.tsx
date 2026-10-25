import type { Metadata } from "next";
import { CategoryListing, categoryMetadata } from "./listing";

// Shared ISR cache: this page is identical for every visitor (wishlist hearts
// hydrate client-side from the shared store), so it regenerates at most once a
// minute. 60s bounds promotion-window staleness; category mutations revalidate
// this path directly, and promotion mutations bust the whole storefront tree
// via revalidatePath("/", "layout"). Page 2+ live at ./page/[n].
export const revalidate = 60;

// No paths are pre-rendered at build: each URL renders on its first visit, then
// serves from the shared ISR cache like any static page. Without this, a dynamic
// segment is server-rendered on EVERY request (`ƒ`) and `revalidate` above is
// ignored. dynamicParams stays at its default (true), so an unknown slug
// still reaches notFound().
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return categoryMetadata(slug, 1);
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <CategoryListing slug={slug} page={1} />;
}
