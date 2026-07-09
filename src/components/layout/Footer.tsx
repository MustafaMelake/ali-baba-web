import Link from "next/link";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

/**
 * Footer — a React Server Component.
 *
 * The nav columns come EXCLUSIVELY from the admin-managed FooterLink table
 * (/admin/settings → Footer Navigation): each active link carries a `group`
 * (the column heading) and an `order`. There is deliberately NO hardcoded
 * fallback — an empty table (or an unreachable DB) collapses the nav section
 * entirely rather than rendering placeholder links to routes that don't exist.
 *
 * Everything renders on the server: no framer-motion, no client hooks → zero JS
 * shipped for the footer.
 *
 * Cache: the query is wrapped in `unstable_cache` tagged "footer-links"; the
 * settings Server Actions call updateTag("footer-links") on every write so an
 * edit shows up on the next render (read-your-own-writes).
 */

type NavLink = { label: string; href: string };

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
    // Group by `group`, preserving first-appearance order for the columns and
    // (since the query is ordered by `order`) `order` asc within each column.
    const columns = new Map<string, NavLink[]>();
    for (const link of links) {
      const col = columns.get(link.group) ?? [];
      col.push({ label: link.label, href: link.url });
      columns.set(link.group, col);
    }
    return [...columns].map(([heading, groupLinks]) => ({ heading, links: groupLinks }));
  } catch (err) {
    // No fallback by design — an empty result collapses the nav section.
    console.error("Footer: failed to load managed links —", err);
    return [];
  }
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

        {/* ─── Nav — admin-managed links only; the whole section collapses
               when no active FooterLink rows exist ─────────────────────── */}
        {navGroups.length > 0 && (
        <div className="py-16 md:py-20 border-b border-white/10">
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
        )}

        {/* ─── Bottom Bar ──────────────────────────────────── */}
        <div className="py-7">
          <p className="font-sans text-xs text-white/25 tracking-wide">
            © {new Date().getFullYear()} Ali Baba. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
