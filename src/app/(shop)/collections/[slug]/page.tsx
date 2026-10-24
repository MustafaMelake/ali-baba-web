import type { Metadata } from "next";
import { CollectionListing, collectionMetadata } from "./listing";

// Shared ISR cache (60s): identical for every visitor. Collection mutations
// revalidate this path; promotion mutations bust the whole storefront tree.
// Page 2+ live at ./page/[n].
export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  return collectionMetadata((await params).slug, 1);
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return <CollectionListing slug={(await params).slug} page={1} />;
}
