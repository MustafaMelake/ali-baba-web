import Link from "next/link";
import { unstable_cache } from "next/cache";
import { FaInstagram, FaFacebook, FaTwitter } from "react-icons/fa";
import { prisma } from "@/lib/prisma";
import { CategoryType } from "@/generated/prisma/enums";

/**
 * Footer — a React Server Component.
 *
 * The main nav columns are fully admin-managed: each FooterLink carries a
 * `group` (the column heading) and an `order`, edited from /admin/settings →
 * Footer Navigation. When no managed links exist (or the DB is unreachable /
 * pre-migration) the footer falls back to the category-driven "Collection"
 * column + the static columns below, so the layout is never empty.
 *
 * Everything renders on the server: no framer-motion, no client hooks → zero JS
 * shipped for the footer.
 *
 * Cache: both queries are wrapped in `unstable_cache` — categories tagged
 * `"categories"`, managed links tagged `"footer-links"` — so the footer is
 * served from cache and only re-queries Postgres when a tag is invalidated by
 * the relevant Server Action (read-your-own-writes).
 */

type NavLink = { label: string; href: string };

// ── Static fallback ──────────────────────────────────────────────────────────
// Used if the DB is unreachable (query throws) or returns no shop categories,
// so the column is never empty. Mirrors the original hardcoded set.
const FALLBACK_COLLECTION: NavLink[] = [
  { label: "Oriental Sweets", href: "/category/oriental-sweets" },
  { label: "Modern Pastry", href: "/category/western-sweets" },
  { label: "Bespoke Cakes", href: "/category/eid-sweets" },
  { label: "Luxury Beverages", href: "/category/bakery" },
];

// The non-category columns stay as static config — they aren't slug-driven and
// weren't the source of the 404s.
const STATIC_GROUPS: { heading: string; links: NavLink[] }[] = [
  {
    heading: "Heritage",
    links: [
      { label: "Our Story", href: "/story" },
      { label: "The Artisans", href: "/artisans" },
      { label: "Our Philosophy", href: "/philosophy" },
      { label: "Since 1998", href: "/heritage" },
    ],
  },
  {
    heading: "Boutiques",
    links: [
      { label: "Menouf Boutique", href: "/branches/menouf" },
      { label: "Beba Café", href: "/branches/beba" },
      { label: "Find Us", href: "/branches" },
    ],
  },
  {
    heading: "Client Care",
    links: [
      { label: "Contact Us", href: "/contact" },
      { label: "Custom Orders", href: "/custom" },
      { label: "FAQ", href: "#faq" },
      { label: "Delivery", href: "/delivery" },
    ],
  },
];

const SOCIALS = [
  { Icon: FaInstagram, href: "#", label: "Instagram" },
  { Icon: FaTwitter, href: "#", label: "Twitter" },
  { Icon: FaFacebook, href: "#", label: "Facebook" },
];

// ── Cached data fetch ────────────────────────────────────────────────────────
// Defined at module scope (the recommended `unstable_cache` pattern). Errors are
// intentionally NOT caught here, so a transient DB failure isn't cached as an
// empty result — it propagates and the component falls back to the static list.
const getShopCategories = unstable_cache(
  async () =>
    prisma.category.findMany({
      where: { type: CategoryType.SHOP }, // active storefront categories
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    }),
  ["footer-shop-categories"], // cache key
  { tags: ["categories"], revalidate: 3600 }, // tag-invalidated; 1h safety TTL
);

async function getCollectionLinks(): Promise<NavLink[]> {
  try {
    const categories = await getShopCategories();
    if (categories.length === 0) return FALLBACK_COLLECTION;
    // Cap the column so a large catalogue doesn't create an unwieldy list.
    return categories.slice(0, 6).map((c) => ({
      label: c.name,
      href: `/category/${c.slug}`,
    }));
  } catch (err) {
    console.error("Footer: failed to load categories, using fallback —", err);
    return FALLBACK_COLLECTION;
  }
}

// ── Managed footer columns (admin-editable) ──────────────────────────────────
// The main nav columns are curated from /admin/settings → Footer Navigation:
// each active link carries a `group` (column heading) + `order`. Cached + tagged
// "footer-links"; the settings Server Actions call updateTag("footer-links") so
// an edit shows up on the next render.
const getActiveFooterLinks = unstable_cache(
  async () =>
    prisma.footerLink.findMany({
      where: { isActive: true },
      orderBy: { order: "asc" },
      select: { id: true, label: true, url: true, group: true },
    }),
  ["footer-managed-links"], // cache key
  { tags: ["footer-links"], revalidate: 3600 }, // tag-invalidated; 1h safety TTL
);

type FooterColumn = { heading: string; links: NavLink[] };

async function getFooterColumns(): Promise<FooterColumn[]> {
  try {
    const links = await getActiveFooterLinks();
    if (links.length > 0) {
      // Group by `group`, preserving first-appearance order for the columns and
      // (since the query is ordered by `order`) `order` asc within each column.
      const columns = new Map<string, NavLink[]>();
      for (const link of links) {
        const col = columns.get(link.group) ?? [];
        col.push({ label: link.label, href: link.url });
        columns.set(link.group, col);
      }
      return [...columns].map(([heading, groupLinks]) => ({ heading, links: groupLinks }));
    }
  } catch (err) {
    console.error("Footer: failed to load managed links, using fallback —", err);
  }
  // Fallback — the original category-driven Collection + static columns, so the
  // footer is unchanged until an admin curates links (and pre-migration).
  const collectionLinks = await getCollectionLinks();
  return [{ heading: "The Collection", links: collectionLinks }, ...STATIC_GROUPS];
}

// ── Component ────────────────────────────────────────────────────────────────
export default async function Footer() {
  const navGroups = await getFooterColumns();

  return (
    <footer className="bg-[#0F5A6D] text-white">
      <div className="max-w-7xl mx-auto px-6 md:px-12 lg:px-20">
        {/* ─── Brand Statement ─────────────────────────────── */}
        <div className="pt-20 md:pt-28 pb-16 md:pb-20 border-b border-white/10">
          <span className="text-[10px] font-sans font-semibold uppercase tracking-[0.35em] text-white/35 block mb-7">
            Est. 1998 · Menouf, Egypt
          </span>

          {/* Massive brand name — editorial masthead */}
          <h2
            className="font-serif font-medium leading-none tracking-tight text-white/90"
            style={{ fontSize: "clamp(3.5rem, 11vw, 10rem)" }}
          >
            Ali Baba
          </h2>

          <p className="mt-5 font-serif italic text-white/30 text-xl md:text-2xl">
            The art of pure indulgence.
          </p>
        </div>

        {/* ─── Nav ─────────────────────────────────────────── */}
        <div className="py-16 md:py-20 border-b border-white/10">
          {/* Nav link groups — spread across the full row. */}
          <nav
            aria-label="Footer navigation"
            className="grid grid-cols-2 gap-10 md:grid-cols-4 lg:gap-12"
          >
            {navGroups.map((group) => (
              <div key={group.heading}>
                <p className="text-[10px] font-sans font-bold uppercase tracking-[0.25em] text-white/30 mb-5">
                  {group.heading}
                </p>
                <ul className="flex flex-col gap-3.5">
                  {group.links.map((link) => {
                    const external = /^https?:\/\//i.test(link.href);
                    return (
                      <li key={`${group.heading}-${link.href}`}>
                        <Link
                          href={link.href}
                          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                          className="font-sans text-sm text-white/50 hover:text-white/90 transition-colors duration-200"
                        >
                          {link.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* ─── Bottom Bar ──────────────────────────────────── */}
        <div className="py-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <p className="font-sans text-xs text-white/25 tracking-wide">
            © {new Date().getFullYear()} Ali Baba. All rights reserved.
          </p>

          <div className="flex items-center gap-6 flex-wrap">
            {["Privacy Policy", "Terms of Service"].map((label) => (
              <Link
                key={label}
                href="#"
                className="font-sans text-xs text-white/25 hover:text-white/55 transition-colors duration-200"
              >
                {label}
              </Link>
            ))}

            {/* Vertical rule */}
            <span
              className="hidden sm:block w-px h-3.5 bg-white/10"
              aria-hidden="true"
            />

            {/* Social icons */}
            <div className="flex items-center gap-4">
              {SOCIALS.map(({ Icon, href, label }) => (
                <Link
                  key={label}
                  href={href}
                  aria-label={label}
                  className="text-white/25 hover:text-white/65 transition-colors duration-200"
                >
                  <Icon className="w-3.5 h-3.5" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
