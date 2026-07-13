import { requireAdminPage } from "@/lib/session";
import { getAdminFaqs } from "@/lib/actions/faqs";
import PageHeader from "@/components/admin/PageHeader";
import FaqManager from "@/components/admin/FaqManager";

export const metadata = {
  title: "FAQs | Admin",
};

export default async function AdminFaqsPage() {
  // ADMIN-only screen — bounce a MANAGER before any data is read. `getAdminFaqs`
  // re-asserts the same gate server-side (defence in depth, never cosmetic).
  await requireAdminPage();

  // Every FAQ (active + inactive), already ordered by `order` for the list. The
  // FaqRow shape carries no Decimal/Date, so it crosses to the client island as-is.
  const faqs = await getAdminFaqs();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        eyebrow="Storefront Content"
        title="FAQ Manager"
        description="Curate the questions shown in the storefront FAQ section — reorder by dragging, toggle visibility, and edit answers live."
      />

      {/* Fully wired to the `faqs` Server Actions (create / update / delete /
          reorder). Each write busts the homepage FAQ section + this list. */}
      <FaqManager faqs={faqs} />
    </div>
  );
}
