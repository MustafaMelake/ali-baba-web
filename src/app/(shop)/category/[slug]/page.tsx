import type { Metadata } from "next";
import { CategoryListing, categoryMetadata } from "./listing";

// Shared ISR cache: this page is identical for every visitor (wishlist hearts
// hydrate client-side from the shared store), so it regenerates at most once a
// minute. 60s bounds promotion-window staleness; category mutations revalidate
// this path directly, and promotion mutations bust the whole storefront tree
// via revalidatePath("/", "layout"). Page 2+ live at ./page/[n].
export const revalidate = 60;

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
