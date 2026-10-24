import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** Strings kept out of the markup (the Arabic locale swaps this table). */
const COPY = {
  count: (n: number) => `${n} ${n === 1 ? "creation" : "creations"}`,
  view: "View collection",
} as const;

export type CollectionCardData = {
  slug: string;
  name: string;
  description: string | null;
  image: string | null;
  /** Listable products in the collection (one grouped query upstream). */
  productCount: number;
};

/**
 * One collection as a card — the /collections index and the cards above a
 * category's "All <category>" grid. A Server Component: one link, no client
 * JS, logical properties only.
 */
export default function CollectionCard({ collection }: { collection: CollectionCardData }) {
  return (
    <Link
      href={`/collections/${collection.slug}`}
      className="group flex flex-col overflow-hidden rounded-3xl border border-stone-200/70 bg-white transition-shadow duration-300 hover:shadow-lg"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-stone-100">
        <Image
          src={collection.image ?? "/placeholder.jpg"}
          alt=""
          fill
          sizes="(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 30vw"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-6 text-start">
        <h3 className="font-serif text-2xl font-medium tracking-tight text-stone-900">
          {collection.name}
        </h3>
        {collection.description && (
          <p className="line-clamp-2 font-sans text-sm leading-relaxed text-stone-500">
            {collection.description}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-3 font-sans text-xs font-semibold uppercase tracking-[0.16em]">
          <span className="tabular-nums text-stone-400">{COPY.count(collection.productCount)}</span>
          <span className="inline-flex items-center gap-1.5 text-stone-700 transition-colors group-hover:text-primary">
            {COPY.view}
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}
