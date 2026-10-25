import type { Metadata } from "next";
import { CollectionListing, collectionMetadata } from "./listing";

// Shared ISR cache (60s): identical for every visitor. Collection mutations
// revalidate this path; promotion mutations bust the whole storefront tree.
// Page 2+ live at ./page/[n].
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
  return collectionMetadata((await params).slug, 1);
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return <CollectionListing slug={(await params).slug} page={1} />;
}
