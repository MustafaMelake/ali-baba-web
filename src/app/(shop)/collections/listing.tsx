import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import CollectionCard from "@/components/CollectionCard";
import Pagination from "@/components/Pagination";
import { getCollectionIndexPage } from "@/lib/collections";
import {
  isPageOutOfRange,
  pageHref,
  pageInfo,
  pageSlice,
  STOREFRONT_PAGE_SIZE,
} from "@/lib/pagination";

// ─────────────────────────────────────────────────────────────────────────────
// The /collections index, shared by /collections (page 1) and
// /collections/page/[n]: every ACTIVE collection in the admin's order, with
// listable-product counts from one grouped query. Path-paginated so both routes
// stay on the shared ISR cache.
// ─────────────────────────────────────────────────────────────────────────────

/** Strings kept out of the markup (the Arabic locale swaps this table). */
const COPY = {
  title: "Collections",
  eyebrow: "Curated",
  intro: "Hand-picked selections from our kitchen — for gifting, for celebrating, for every season.",
  empty: "Our first collections are on their way. Explore the shop in the meantime.",
  emptyCta: "Browse all products",
  description: "Curated selections from the Ali Baba kitchen — gift boxes, seasonal favourites and more.",
} as const;

const BASE = "/collections";

export function collectionsIndexMetadata(page: number): Metadata {
  const title = page > 1 ? `${COPY.title} — Page ${page} | Ali Baba` : `${COPY.title} | Ali Baba`;
  return {
    title,
    description: COPY.description,
    alternates: { canonical: pageHref({ kind: "path", base: BASE }, page) },
    openGraph: { title, description: COPY.description },
  };
}

export async function CollectionsIndex({ page }: { page: number }) {
  const { skip, take } = pageSlice(page, STOREFRONT_PAGE_SIZE);
  const { total, cards } = await getCollectionIndexPage(skip, take);

  const info = pageInfo(page, STOREFRONT_PAGE_SIZE, total);
  if (isPageOutOfRange(info)) notFound();

  return (
    <div className="min-h-screen bg-white font-sans">
      <header className="border-b border-stone-100 bg-[#FAFAFA]">
        <div className="mx-auto max-w-screen-xl px-6 pb-12 pt-12 text-center md:px-10 md:pb-16 md:pt-16 lg:px-14">
          <nav
            aria-label="Breadcrumb"
            className="mb-7 flex items-center justify-center gap-1.5 font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-stone-400"
          >
            <Link href="/" className="transition-colors hover:text-primary">
              Home
            </Link>
            <ChevronRight className="h-3 w-3 rtl:-scale-x-100" aria-hidden="true" />
            <span className="text-stone-600">{COPY.title}</span>
          </nav>
          <p className="mb-5 font-sans text-[11px] font-semibold uppercase tracking-[0.35em] text-primary">
            {COPY.eyebrow}
          </p>
          <h1 className="font-serif text-[clamp(2.5rem,6.5vw,5rem)] font-medium leading-[1.03] tracking-tight text-stone-900">
            {COPY.title}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl font-sans text-base leading-relaxed text-stone-500 md:text-lg">
            {COPY.intro}
          </p>
        </div>
      </header>

      <section aria-label={COPY.title} className="mx-auto max-w-screen-xl px-6 py-14 md:px-10 md:py-20 lg:px-14">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <p className="max-w-md font-sans text-sm text-stone-500">{COPY.empty}</p>
            <Link
              href="/shop"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-stone-900 px-7 py-3 font-sans text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors hover:bg-primary"
            >
              {COPY.emptyCta}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <CollectionCard key={c.slug} collection={c} />
            ))}
          </div>
        )}
        <Pagination info={info} mode={{ kind: "path", base: BASE }} />
      </section>
    </div>
  );
}
