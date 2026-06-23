"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, ImagePlus, Check, Plus, Trash2, Tag } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { productUpdateSchema, fieldErrors } from "@/lib/validators";
import { updateProduct } from "@/app/admin/products/actions";
import { UploadDropzone } from "@/lib/uploadthing";
import { cn, deriveVariantDiscount } from "@/lib/utils";

export type SelectOption = { id: string; name: string };

export type EditableProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  images: string[];
  isAvailable: boolean;
  isFeatured: boolean;
  categoryId: string;
  menuPageId: string;
  variants: {
    id: string;
    name: string;
    price: number;
    compareAtPrice: number | null;
    sku: string | null;
  }[];
};

type VariantRow = {
  key: string;
  id?: string;
  name: string;
  price: string;
  compareAtPrice: string;
  sku: string;
};

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-stone-200 px-4 py-3 text-left transition-colors hover:bg-stone-50"
    >
      <span>
        <span className="block text-sm font-medium text-stone-800">{label}</span>
        <span className="mt-0.5 block text-xs text-stone-400">{description}</span>
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-stone-200",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked && "translate-x-5",
          )}
        />
      </span>
    </button>
  );
}

let variantKeySeq = 0;
function newVariantRow(): VariantRow {
  variantKeySeq += 1;
  return { key: `new-${variantKeySeq}`, name: "", price: "", compareAtPrice: "", sku: "" };
}

export default function EditProductForm({
  product,
  categories,
  menuPages,
}: {
  product: EditableProduct;
  categories: SelectOption[];
  menuPages: SelectOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(product.name);
  const [slug, setSlug] = useState(product.slug);
  const [description, setDescription] = useState(product.description ?? "");
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [menuPageId, setMenuPageId] = useState(product.menuPageId);
  const [images, setImages] = useState<string[]>(product.images);
  const [isAvailable, setIsAvailable] = useState(product.isAvailable);
  const [isFeatured, setIsFeatured] = useState(product.isFeatured);
  const [variants, setVariants] = useState<VariantRow[]>(
    product.variants.map((v) => ({
      key: v.id,
      id: v.id,
      name: v.name,
      price: String(v.price),
      compareAtPrice: v.compareAtPrice != null ? String(v.compareAtPrice) : "",
      sku: v.sku ?? "",
    })),
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    // Keep slug in sync only while it still matches the (old) auto-slug.
    if (slug === slugify(name)) setSlug(slugify(value));
  }

  function updateVariant(key: string, patch: Partial<VariantRow>) {
    setVariants((prev) => prev.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  }

  function removeVariant(key: string) {
    setVariants((prev) => prev.filter((v) => v.key !== key));
  }

  function removeImage(url: string) {
    setImages((prev) => prev.filter((u) => u !== url));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const payload = {
      name,
      slug,
      description,
      categoryId,
      menuPageId,
      images,
      isAvailable,
      isFeatured,
      variants: variants.map((v) => ({
        ...(v.id ? { id: v.id } : {}),
        name: v.name,
        price: v.price === "" ? Number.NaN : Number(v.price),
        // Empty → null (no/ended promotion); otherwise a Float for the guard.
        compareAtPrice: v.compareAtPrice.trim() === "" ? null : Number(v.compareAtPrice),
        sku: v.sku,
      })),
    };

    const parsed = productUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error as z.ZodError));
      setFormError("Please fix the highlighted fields.");
      return;
    }
    setErrors({});

    startTransition(async () => {
      const result = await updateProduct(product.id, parsed.data);
      if (!result.success) {
        setFormError(result.error);
        toast.error(result.error);
        return;
      }

      toast.success("Product updated");
      if (result.archivedCount > 0) {
        toast.warning(
          `${result.archivedCount} variant${result.archivedCount === 1 ? "" : "s"} couldn’t be deleted (part of existing orders) and ${result.archivedCount === 1 ? "was" : "were"} hidden instead.`,
        );
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

      {/* ── Details ─────────────────────────────────────────── */}
      <section className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
        <h2 className="font-serif text-xl font-medium text-stone-900">Details</h2>
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
            <Field label="Slug" htmlFor="slug" error={errors.slug} required>
              <input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="pistachio-mille-feuille"
                className={cn(inputClasses, "font-mono text-[13px]")}
              />
              <p className="text-xs text-stone-400">
                Used in the product URL: /product/{slug || "your-slug"}
              </p>
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="description" error={errors.description}>
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

          <Field label="Category" htmlFor="categoryId" error={errors.categoryId} required>
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

          <Field label="Menu Page" htmlFor="menuPageId" error={errors.menuPageId} required>
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

      {/* ── Status ──────────────────────────────────────────── */}
      <section className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
        <h2 className="font-serif text-xl font-medium text-stone-900">Status</h2>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Toggle
            checked={isAvailable}
            onChange={setIsAvailable}
            label="Available"
            description="Visible and purchasable on the storefront."
          />
          <Toggle
            checked={isFeatured}
            onChange={setIsFeatured}
            label="Featured"
            description="Highlighted on the homepage and collections."
          />
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

        {images.length < 4 && (
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
                setImages((prev) =>
                  [...prev, ...res.map((file) => file.ufsUrl)].slice(0, 4),
                );
              }}
              onUploadError={(error) => {
                setFormError(error.message || "Image upload failed.");
              }}
            />
          </div>
        )}
      </section>

      {/* ── Variants ────────────────────────────────────────── */}
      <section className="rounded-2xl border border-stone-200/70 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-serif text-xl font-medium text-stone-900">Variants</h2>
            <p className="mt-1 text-xs text-stone-400">
              At least one. Variants tied to past orders are archived (hidden), not
              deleted, when removed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVariants((prev) => [...prev, newVariantRow()])}
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            Add variant
          </button>
        </div>

        {typeof errors.variants === "string" && (
          <p className="mt-3 text-xs font-medium text-red-600">{errors.variants}</p>
        )}

        <div className="mt-5 space-y-4">
          {variants.map((variant, index) => {
            // Live sale state derived straight from the row's own inputs — no
            // parallel state, so the badge can never drift from the numbers.
            const { isOnSale, percentOff } = deriveVariantDiscount(
              variant.price,
              variant.compareAtPrice,
            );

            return (
              <div
                key={variant.key}
                className="rounded-xl border border-stone-200/80 bg-stone-50/40 p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
                    Variant {index + 1}
                    {!variant.id && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        New
                      </span>
                    )}
                    {isOnSale && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-600 ring-1 ring-emerald-500/20">
                        <Tag className="h-3 w-3" />
                        Sale -{percentOff}%
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeVariant(variant.key)}
                    disabled={variants.length === 1}
                    aria-label={`Remove variant ${index + 1}`}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-stone-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field
                    label="Name"
                    htmlFor={`variant-name-${variant.key}`}
                    error={errors[`variants.${index}.name`]}
                    required
                  >
                    <input
                      id={`variant-name-${variant.key}`}
                      value={variant.name}
                      onChange={(e) => updateVariant(variant.key, { name: e.target.value })}
                      placeholder="1 Piece"
                      className={inputClasses}
                    />
                  </Field>

                  <Field
                    label="Price (EGP)"
                    htmlFor={`variant-price-${variant.key}`}
                    error={errors[`variants.${index}.price`]}
                    required
                  >
                    <input
                      id={`variant-price-${variant.key}`}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={variant.price}
                      onChange={(e) => updateVariant(variant.key, { price: e.target.value })}
                      placeholder="185"
                      className={cn(inputClasses, "tabular-nums")}
                    />
                  </Field>

                  <Field
                    label="Compare-At Price"
                    htmlFor={`variant-compare-${variant.key}`}
                    error={errors[`variants.${index}.compareAtPrice`]}
                  >
                    <input
                      id={`variant-compare-${variant.key}`}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={variant.compareAtPrice}
                      onChange={(e) =>
                        updateVariant(variant.key, { compareAtPrice: e.target.value })
                      }
                      placeholder="240"
                      className={cn(
                        inputClasses,
                        "tabular-nums",
                        isOnSale &&
                          "border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/20",
                      )}
                    />
                    <p className="text-xs text-stone-400">
                      Original price for a strike-through. Leave empty for none.
                    </p>
                  </Field>

                  <Field
                    label="SKU (optional)"
                    htmlFor={`variant-sku-${variant.key}`}
                    error={errors[`variants.${index}.sku`]}
                  >
                    <input
                      id={`variant-sku-${variant.key}`}
                      value={variant.sku}
                      onChange={(e) => updateVariant(variant.key, { sku: e.target.value })}
                      placeholder="MILLE-001"
                      className={cn(inputClasses, "font-mono text-[13px]")}
                    />
                  </Field>
                </div>
              </div>
            );
          })}
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
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Save Changes
            </>
          )}
        </button>
      </div>
    </form>
  );
}
