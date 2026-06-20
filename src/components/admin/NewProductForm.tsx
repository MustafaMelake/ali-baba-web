"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, ImagePlus, Check } from "lucide-react";
import { z } from "zod";
import { productInputSchema, fieldErrors } from "@/lib/validators";
import { createProduct } from "@/app/admin/products/actions";
import { UploadDropzone } from "@/lib/uploadthing";
import { cn } from "@/lib/utils";

export type SelectOption = { id: string; name: string };

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Small label + field wrapper that surfaces an inline error message. */
function Field({
  label,
  htmlFor,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-stone-700">
        {label}
        {required && <span className="ml-0.5 text-primary">*</span>}
      </label>
      {children}
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

export default function NewProductForm({
  categories,
  menuPages,
}: {
  categories: SelectOption[];
  menuPages: SelectOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [menuPageId, setMenuPageId] = useState(menuPages[0]?.id ?? "");
  const [images, setImages] = useState<string[]>([]);
  const [variantName, setVariantName] = useState("");
  const [price, setPrice] = useState("");
  const [sku, setSku] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const canSubmit = categories.length > 0 && menuPages.length > 0;

  function handleNameChange(value: string) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  function removeImage(url: string) {
    setImages((prev) => prev.filter((u) => u !== url));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const candidate = {
      name,
      slug,
      description,
      categoryId,
      menuPageId,
      images,
      variant: {
        name: variantName,
        price: price === "" ? Number.NaN : Number(price),
        sku,
      },
    };

    const parsed = productInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error as z.ZodError));
      return;
    }
    setErrors({});

    startTransition(async () => {
      const result = await createProduct(parsed.data);
      if (!result.success) {
        setFormError(result.error);
        return;
      }
      router.push("/admin/products");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {formError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
        >
          {formError}
        </div>
      )}

      {!canSubmit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          You need at least one category and one menu page before adding a
          product. Seed them first.
        </div>
      )}

      {/* ── Details ─────────────────────────────────────────── */}
      <section className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
        <h2 className="font-serif text-xl font-medium text-stone-900">
          Details
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Product Name" htmlFor="name" error={errors.name} required>
              <input
                id="name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Pistachio Mille-Feuille"
                className={inputClasses}
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field
              label="Slug"
              htmlFor="slug"
              error={errors.slug}
              required
            >
              <input
                id="slug"
                value={slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(e.target.value);
                }}
                placeholder="pistachio-mille-feuille"
                className={cn(inputClasses, "font-mono text-[13px]")}
              />
              <p className="text-xs text-stone-400">
                Used in the product URL: /product/{slug || "your-slug"}
              </p>
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field
              label="Description"
              htmlFor="description"
              error={errors.description}
            >
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="A short, tempting description…"
                className={cn(inputClasses, "resize-y")}
              />
            </Field>
          </div>

          <Field
            label="Category"
            htmlFor="categoryId"
            error={errors.categoryId}
            required
          >
            <select
              id="categoryId"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={inputClasses}
            >
              {categories.length === 0 && <option value="">No categories</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Menu Page"
            htmlFor="menuPageId"
            error={errors.menuPageId}
            required
          >
            <select
              id="menuPageId"
              value={menuPageId}
              onChange={(e) => setMenuPageId(e.target.value)}
              className={inputClasses}
            >
              {menuPages.length === 0 && <option value="">No menu pages</option>}
              {menuPages.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      {/* ── Media ───────────────────────────────────────────── */}
      <section className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
        <h2 className="font-serif text-xl font-medium text-stone-900">Media</h2>
        <p className="mt-1 text-xs text-stone-400">
          Up to 4 images. The first is used as the catalogue thumbnail.
        </p>

        {images.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-3">
            {images.map((url) => (
              <div
                key={url}
                className="group relative h-24 w-24 overflow-hidden rounded-xl border border-stone-200 bg-stone-100 bg-cover bg-center"
                // Constraint: plain CSS background for UploadThing URLs (no next/image).
                style={{ backgroundImage: `url(${url})` }}
              >
                <button
                  type="button"
                  onClick={() => removeImage(url)}
                  aria-label="Remove image"
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-stone-900/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5">
          <UploadDropzone
            endpoint="productImage"
            appearance={{
              container:
                "rounded-2xl border-2 border-dashed border-stone-200 bg-stone-50/60 ut-uploading:opacity-70",
              button:
                "bg-primary text-white text-sm font-semibold after:bg-primary/80 focus-within:ring-primary",
              label: "text-stone-600 hover:text-primary",
              allowedContent: "text-stone-400",
            }}
            content={{
              uploadIcon: <ImagePlus className="h-8 w-8 text-stone-400" />,
            }}
            onClientUploadComplete={(res) => {
              setImages((prev) => [
                ...prev,
                ...res.map((file) => file.ufsUrl),
              ].slice(0, 4));
            }}
            onUploadError={(error) => {
              setFormError(error.message || "Image upload failed.");
            }}
          />
        </div>
      </section>

      {/* ── Pricing / first variant ─────────────────────────── */}
      <section className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
        <h2 className="font-serif text-xl font-medium text-stone-900">
          Initial Variant
        </h2>
        <p className="mt-1 text-xs text-stone-400">
          Every product needs at least one purchasable variant. Add more later.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field
            label="Variant Name"
            htmlFor="variantName"
            error={errors["variant.name"]}
            required
          >
            <input
              id="variantName"
              value={variantName}
              onChange={(e) => setVariantName(e.target.value)}
              placeholder="1 Piece"
              className={inputClasses}
            />
          </Field>

          <Field
            label="Price (EGP)"
            htmlFor="price"
            error={errors["variant.price"]}
            required
          >
            <input
              id="price"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="185"
              className={inputClasses}
            />
          </Field>

          <Field label="SKU (optional)" htmlFor="sku" error={errors["variant.sku"]}>
            <input
              id="sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="MILLE-001"
              className={cn(inputClasses, "font-mono text-[13px]")}
            />
          </Field>
        </div>
      </section>

      {/* ── Actions ─────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push("/admin/products")}
          disabled={isPending}
          className="rounded-full border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !canSubmit}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating…
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Create Product
            </>
          )}
        </button>
      </div>
    </form>
  );
}
