import { z } from "zod";

/**
 * Shared validation schemas — imported by BOTH the client forms (for instant
 * feedback) and the server actions (the authoritative check; never trust the
 * client). Kept in a plain module so it can be imported from "use server" files.
 */

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// An optional free-text field that may arrive as "" from an empty input.
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

// A single variant on the edit form. `id` present → an existing row to update;
// absent → a brand-new variant to create.
export const variantInputSchema = z
  .object({
    id: z.string().optional(),
    name: z
      .string()
      .trim()
      .min(1, "Variant name is required")
      .max(80, "Variant name is too long"),
    price: z
      .number({ error: "Enter a valid price" })
      .positive("Price must be greater than 0"),
    // Optional "was" price for promotions. The client maps an empty input to
    // `null`; a non-numeric input arrives as NaN and trips the type error.
    // `null`/`undefined` both mean "no discount" and skip the positivity check.
    compareAtPrice: z
      .number({ error: "Enter a valid original price" })
      .positive("Original price must be greater than 0")
      .nullish(),
    sku: optionalText(64),
  })
  // Business rule: a strike-through original price only makes sense ABOVE the
  // selling price. Attaching the issue to `compareAtPrice` surfaces it inline
  // on that exact input (path → `variants.<i>.compareAtPrice`).
  .refine((v) => v.compareAtPrice == null || v.compareAtPrice > v.price, {
    error: "Original price must be greater than the selling price.",
    path: ["compareAtPrice"],
  });

export type VariantInput = z.infer<typeof variantInputSchema>;

export const productInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(120, "Name is too long"),
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(140, "Slug is too long")
    .regex(slugRegex, "Use lowercase letters, numbers and hyphens only"),
  description: optionalText(2000),
  categoryId: z.string().min(1, "Select a category"),
  menuPageId: z.string().min(1, "Select a menu page"),
  images: z.array(z.string()).default([]),
  variants: z.array(variantInputSchema).min(1, "Add at least one variant"),
});

export type ProductInput = z.infer<typeof productInputSchema>;

// Full payload for updating a product, including its (multi-)variant list.
export const productUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(120, "Name is too long"),
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(140, "Slug is too long")
    .regex(slugRegex, "Use lowercase letters, numbers and hyphens only"),
  description: optionalText(2000),
  categoryId: z.string().min(1, "Select a category"),
  menuPageId: z.string().min(1, "Select a menu page"),
  images: z.array(z.string()).default([]),
  isAvailable: z.boolean(),
  isFeatured: z.boolean(),
  variants: z.array(variantInputSchema).min(1, "Add at least one variant"),
});

export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export const categoryUpdateSchema = z.object({
  id: z.string().min(1, "Missing category id"),
  subtitle: optionalText(160),
  image: optionalText(2048),
});

export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

/**
 * Flattens a ZodError into a `{ "path.to.field": "message" }` map. Stable across
 * Zod minor versions (reads `.issues` directly) and handles nested paths like
 * `variant.price`.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
