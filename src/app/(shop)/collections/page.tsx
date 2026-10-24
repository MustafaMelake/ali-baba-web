import type { Metadata } from "next";
import { CollectionsIndex, collectionsIndexMetadata } from "./listing";

// Shared ISR cache (60s): identical for every visitor. Collection mutations
// revalidate "/collections" directly; page 2+ live at ./page/[n] and age out on
// their own window.
export const revalidate = 60;

export function generateMetadata(): Metadata {
  return collectionsIndexMetadata(1);
}

export default function CollectionsPage() {
  return <CollectionsIndex page={1} />;
}
