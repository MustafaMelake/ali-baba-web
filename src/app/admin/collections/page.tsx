import { requireAdminPage } from "@/lib/session";
import { getAdminCollections } from "@/lib/actions/collections";
import PageHeader from "@/components/admin/PageHeader";
import CollectionsManager from "@/components/admin/CollectionsManager";

export const metadata = {
  title: "Collections | Admin",
};

// Admin lists always render live data.
export const dynamic = "force-dynamic";

export default async function AdminCollectionsPage() {
  // ADMIN-only — bounce a MANAGER before any data is read. getAdminCollections
  // re-asserts the same gate (defence in depth, never cosmetic).
  await requireAdminPage();
  const collections = await getAdminCollections();

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Catalog"
        title="Collections"
        description="Curated sets of products, each with its own page — shown on /collections, in the footer and on the category pages you choose."
      />
      <CollectionsManager collections={collections} />
    </div>
  );
}
