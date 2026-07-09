import { requireAdminPage } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getFooterLinks } from "@/lib/actions/settings";
import { getStoreSettings } from "@/lib/store-settings";
import PageHeader from "@/components/admin/PageHeader";
import FooterLinksManager from "@/components/admin/FooterLinksManager";
import PricingSettingsManager from "@/components/admin/PricingSettingsManager";

export const metadata = {
  title: "Settings | Admin",
};

export default async function AdminSettingsPage() {
  await requireAdminPage();

  // Footer links, the global pricing settings (VAT + default delivery fee), and
  // ALL branches whose per-area fees the admin edits here. Inactive branches are
  // included (rendered dimmed) so a fee can be corrected before reactivation —
  // otherwise a stale fee would silently resurrect the moment a branch is
  // toggled back on. Active branches sort first; inactive fall to the bottom.
  const [footerLinks, pricingSettings, branches] = await Promise.all([
    getFooterLinks(),
    getStoreSettings(),
    prisma.branch.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        deliveryFee: true,
        isActive: true,
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        eyebrow="Configuration"
        title="Store Settings"
        description="Control live pricing (VAT & delivery fees) and the storefront footer navigation."
      />

      {/* Pricing — VAT + delivery fees, wired to the `store-settings` actions.
          The same rows placeOrder reads, so a save here changes real billing. */}
      <PricingSettingsManager settings={pricingSettings} branches={branches} />

      {/* Footer Navigation — fully wired to the `settings` Server Actions. */}
      <FooterLinksManager links={footerLinks} />
    </div>
  );
}
