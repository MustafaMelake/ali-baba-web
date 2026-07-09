import Navbar from "@/components/Navbar";
import Footer from "@/components/layout/Footer";

/**
 * Storefront chrome for EVERY (shop) route: the fixed Navbar (which also
 * mounts the CartSidebar drawer) on top, the Footer at the bottom, and the
 * page content between them. Previously Navbar/Footer were hand-rendered on
 * only the homepage and category pages, leaving every other route without
 * navigation — and without the cart drawer "Add to Cart" tries to open.
 *
 * The Navbar is `fixed top-0` with height h-16 md:h-20, so the clearance
 * padding lives ONCE here on <main>. Pages must NOT add their own
 * `pt-16 md:pt-20` — that would double the offset.
 */
export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navbar />
      {/* flex-grow pushes the Footer to the bottom (root body is flex-col). */}
      <main className="flex-grow pt-16 md:pt-20">{children}</main>
      <Footer />
    </>
  );
}
