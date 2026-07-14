import { requireAdminPage } from "@/lib/session";
import { getAdminLocations } from "@/lib/actions/locations";
import PageHeader from "@/components/admin/PageHeader";
import LocationManager from "@/components/admin/LocationManager";

export const metadata = {
  title: "Locations | Admin",
};

export default async function AdminLocationsPage() {
  // ADMIN-only screen — bounce a MANAGER before any data is read.
  // `getAdminLocations` re-asserts the same gate server-side (defence in depth,
  // never cosmetic).
  await requireAdminPage();

  // Every location (active + inactive), already ordered by `order` for the list.
  // The LocationRow shape carries no Decimal/Date, so it crosses to the client
  // island as-is.
  const locations = await getAdminLocations();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        eyebrow="Storefront Content"
        title="Locations Manager"
        description="Curate the storefront “Our Locations” showcase — reorder by dragging, toggle visibility, and edit the copy, imagery and SEO metadata live."
      />

      {/* Fully wired to the `locations` Server Actions (create / update / delete /
          reorder). Each write busts the homepage locations section + this list. */}
      <LocationManager locations={locations} />
    </div>
  );
}
