import { Store } from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";

export const metadata = {
  title: "Settings | Admin",
};

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

/** Local label + control wrapper for consistent field spacing. */
function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-stone-700">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-stone-400">{hint}</p>}
    </div>
  );
}

export default function AdminSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        eyebrow="Configuration"
        title="Store Settings"
        description="Manage your store’s public profile and regional defaults."
      />

      {/* Static UI only — wire up to a Server Action when persistence is ready. */}
      <form className="space-y-6">
        {/* Store profile */}
        <section className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 border-b border-stone-100 pb-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Store className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-serif text-xl font-medium text-stone-900">
                Store Profile
              </h2>
              <p className="text-xs text-stone-400">
                Shown to customers across the storefront.
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Store Name" htmlFor="storeName">
                <input
                  id="storeName"
                  name="storeName"
                  type="text"
                  defaultValue="Ali Baba"
                  className={inputClasses}
                />
              </Field>
            </div>
            <Field label="Contact Email" htmlFor="contactEmail">
              <input
                id="contactEmail"
                name="contactEmail"
                type="email"
                defaultValue="hello@alibaba.com"
                className={inputClasses}
              />
            </Field>
            <Field label="Contact Phone" htmlFor="contactPhone">
              <input
                id="contactPhone"
                name="contactPhone"
                type="tel"
                placeholder="+20 100 000 0000"
                className={inputClasses}
              />
            </Field>
          </div>
        </section>

        {/* Regional */}
        <section className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
          <h2 className="font-serif text-xl font-medium text-stone-900">
            Regional
          </h2>
          <p className="text-xs text-stone-400">
            Currency and formatting defaults.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field
              label="Currency"
              htmlFor="currency"
              hint="Used for all product and order totals."
            >
              <select
                id="currency"
                name="currency"
                defaultValue="EGP"
                className={inputClasses}
              >
                <option value="EGP">EGP — Egyptian Pound</option>
                <option value="USD">USD — US Dollar</option>
                <option value="EUR">EUR — Euro</option>
              </select>
            </Field>
            <Field label="Timezone" htmlFor="timezone">
              <select
                id="timezone"
                name="timezone"
                defaultValue="Africa/Cairo"
                className={inputClasses}
              >
                <option value="Africa/Cairo">Africa / Cairo (GMT+2)</option>
                <option value="Europe/London">Europe / London (GMT+0)</option>
                <option value="America/New_York">
                  America / New York (GMT-5)
                </option>
              </select>
            </Field>
          </div>
        </section>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="reset"
            className="rounded-full border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50"
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
          >
            Save Changes
          </button>
        </div>
      </form>
    </div>
  );
}
