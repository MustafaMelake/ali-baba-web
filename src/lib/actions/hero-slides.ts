"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Homepage hero slides — admin-managed banners (HeroSlide model).
//
// The ISR-cached homepage reads the LIVE slides itself (`getHeroSlides` in
// src/app/(shop)/page.tsx, through the pure rules in `@/lib/hero-slides`); this
// module is the ADMIN side: the /admin/hero list read plus every mutation.
//
// Every mutation gates on `ensureAdmin()` (an ADMIN-only screen — MANAGERs
// have no hero access), re-parses the shared `heroSlideSchema`, and busts the
// homepage + the admin list. Replaced/deleted images are purged from the
// UploadThing bucket best-effort AFTER the write commits — a failed purge only
// logs, it never fails the action.
//
// NOTE: this is a "use server" module — every export MUST be an async function.
// The row/result shapes below are inline `export type` DECLARATIONS (fully
// erased by TS, like faqs.ts / locations.ts); never add an `export type { X }`
// RE-EXPORT here — Turbopack miscompiles that form into a runtime reference.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
// requireAdmin stays for the throwing admin-only reads; the mutations use the
// consolidated envelope gate.
import { requireAdmin } from "@/lib/session";
import { ensureAdmin, prismaErrorCode } from "@/lib/action-utils";
import { deleteUploadedFiles } from "@/lib/uploadthing-server";
import { storeDateEnd, storeDateStart } from "@/lib/timezone";
import {
  HERO_MAX_SLIDES,
  heroSlideReorderSchema,
  heroSlideSchema,
  type HeroSlideData,
} from "@/lib/validators";

export type HeroSlideRow = {
  id: string;
  eyebrow: string | null;
  title: string | null;
  subtitle: string | null;
  ctaLabel: string;
  showPrice: boolean;
  imageDesktop: string;
  imageMobile: string | null;
  imageAlt: string;
  productId: string | null;
  linkUrl: string | null;
  order: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  /** The linked product, with its AVAILABLE variants (for the warning chip). */
  product: {
    name: string;
    isAvailable: boolean;
    variants: { id: string }[];
  } | null;
};

/** One entry in the modal's searchable product picker. */
export type HeroProductOption = {
  id: string;
  name: string;
  image: string | null;
  /** False when the product isn't LISTABLE — its slide would stay hidden. */
  isListable: boolean;
};

export type HeroSlideActionResult =
  | { success: true }
  | { success: false; error: string };

export type CreateHeroSlideResult =
  | { success: true; id: string }
  | { success: false; error: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Bust the homepage hero + refresh the admin list after a write. */
function revalidateHeroSlides() {
  revalidatePath("/"); // homepage Hero (ISR 60)
  revalidatePath("/admin/hero");
}

/** Parsed form data → the columns written. Cairo day keys become exact instants. */
function toColumns(data: HeroSlideData) {
  return {
    eyebrow: data.eyebrow,
    title: data.title,
    subtitle: data.subtitle,
    ctaLabel: data.ctaLabel,
    showPrice: data.showPrice,
    imageDesktop: data.imageDesktop,
    imageMobile: data.imageMobile,
    imageAlt: data.imageAlt,
    productId: data.productId,
    linkUrl: data.linkUrl,
    isActive: data.isActive,
    // Validated day keys, so neither resolves to null here.
    startsAt: data.startsOn ? storeDateStart(data.startsOn) : null,
    endsAt: data.endsOn ? storeDateEnd(data.endsOn) : null,
  };
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid slide.";
}

const PRODUCT_GONE = "That product no longer exists — pick another one.";
const SLIDE_GONE = "That slide no longer exists.";

// ── Fetch ────────────────────────────────────────────────────────────────────

/** Every slide (any state), ordered for the admin list. ADMIN-only. */
export async function getAdminHeroSlides(): Promise<HeroSlideRow[]> {
  await requireAdmin();
  return prisma.heroSlide.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      eyebrow: true,
      title: true,
      subtitle: true,
      ctaLabel: true,
      showPrice: true,
      imageDesktop: true,
      imageMobile: true,
      imageAlt: true,
      productId: true,
      linkUrl: true,
      order: true,
      isActive: true,
      startsAt: true,
      endsAt: true,
      product: {
        select: {
          name: true,
          isAvailable: true,
          variants: { where: { isAvailable: true }, select: { id: true }, take: 1 },
        },
      },
    },
  });
}

/**
 * The picker's catalog: every product (listable or not, so an admin can stage a
 * launch slide before the product goes live), filtered client-side. Loads the
 * whole catalog — fine at this store's size; recorded as debt in DOMAIN_MAP.
 */
export async function getHeroProductOptions(): Promise<HeroProductOption[]> {
  await requireAdmin();
  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      images: true,
      isAvailable: true,
      variants: { where: { isAvailable: true }, select: { id: true }, take: 1 },
    },
  });
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    image: p.images[0] ?? null,
    isListable: p.isAvailable && p.variants.length > 0,
  }));
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createHeroSlide(input: unknown): Promise<CreateHeroSlideResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const parsed = heroSlideSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    // 3 statements: the soft cap, the next position, the insert. The cap is
    // advisory — two racing creates can land a 13th row, which is harmless
    // (the storefront's `take` is the hard bound).
    const id = await prisma.$transaction(async (tx) => {
      const count = await tx.heroSlide.count();
      if (count >= HERO_MAX_SLIDES) return null;

      // Append to the end of the list (max existing order + 1).
      const last = await tx.heroSlide.aggregate({ _max: { order: true } });
      const created = await tx.heroSlide.create({
        // `isActive` is always explicit — the column defaults to false.
        data: { ...toColumns(parsed.data), order: (last._max.order ?? 0) + 1 },
        select: { id: true },
      });
      return created.id;
    });

    if (!id) {
      return {
        success: false,
        error: `You can keep at most ${HERO_MAX_SLIDES} slides — delete an old one first.`,
      };
    }

    revalidateHeroSlides();
    return { success: true, id };
  } catch (err) {
    // P2003 — the picked product was deleted while the modal was open.
    if (prismaErrorCode(err) === "P2003") return { success: false, error: PRODUCT_GONE };
    console.error("createHeroSlide failed:", err);
    return { success: false, error: "Could not create the slide. Please try again." };
  }
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updateHeroSlide(
  id: string,
  input: unknown,
): Promise<HeroSlideActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing slide id." };

  const parsed = heroSlideSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
  const columns = toColumns(parsed.data);

  try {
    // Images captured BEFORE the write, so a replaced/cleared file can be
    // purged from the bucket once the update commits.
    const before = await prisma.heroSlide.findUnique({
      where: { id },
      select: { imageDesktop: true, imageMobile: true },
    });
    if (!before) return { success: false, error: SLIDE_GONE };

    await prisma.heroSlide.update({
      where: { id },
      data: columns,
      select: { id: true },
    });

    // Best-effort bucket hygiene (post-commit, never fails the action).
    const kept = new Set([columns.imageDesktop, columns.imageMobile]);
    await deleteUploadedFiles(
      [before.imageDesktop, before.imageMobile].filter((url) => !kept.has(url)),
    );

    revalidateHeroSlides();
    return { success: true };
  } catch (err) {
    const code = prismaErrorCode(err);
    if (code === "P2025") return { success: false, error: SLIDE_GONE };
    if (code === "P2003") return { success: false, error: PRODUCT_GONE };
    console.error("updateHeroSlide failed:", err);
    return { success: false, error: "Could not update the slide. Please try again." };
  }
}

// ── Toggle ───────────────────────────────────────────────────────────────────

export async function setHeroSlideActive(
  id: string,
  isActive: boolean,
): Promise<HeroSlideActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing slide id." };

  try {
    await prisma.heroSlide.update({
      where: { id },
      data: { isActive: Boolean(isActive) },
      select: { id: true },
    });

    revalidateHeroSlides();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") return { success: false, error: SLIDE_GONE };
    console.error("setHeroSlideActive failed:", err);
    return { success: false, error: "Could not update the slide. Please try again." };
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteHeroSlide(id: string): Promise<HeroSlideActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };
  if (!id) return { success: false, error: "Missing slide id." };

  try {
    // Images captured BEFORE the delete — nothing references them afterwards.
    const existing = await prisma.heroSlide.findUnique({
      where: { id },
      select: { imageDesktop: true, imageMobile: true },
    });
    if (!existing) return { success: false, error: SLIDE_GONE };

    await prisma.heroSlide.delete({ where: { id } });

    // Best-effort bucket hygiene (post-commit, never fails the action).
    await deleteUploadedFiles([existing.imageDesktop, existing.imageMobile]);

    revalidateHeroSlides();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") return { success: false, error: SLIDE_GONE };
    console.error("deleteHeroSlide failed:", err);
    return { success: false, error: "Could not delete the slide. Please try again." };
  }
}

// ── Reorder ──────────────────────────────────────────────────────────────────

/**
 * Persist a new ordering after a ▲/▼ move. `orderedIds` is the full id list in
 * its desired order; each row's `order` is rewritten to its index inside ONE
 * transaction (≤ HERO_MAX_SLIDES updates), so the list can never be left with
 * duplicate or gapped positions.
 */
export async function reorderHeroSlides(
  orderedIds: unknown,
): Promise<HeroSlideActionResult> {
  const denied = await ensureAdmin();
  if (denied) return { success: false, error: denied.error };

  const parsed = heroSlideReorderSchema.safeParse(orderedIds);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    await prisma.$transaction(
      parsed.data.map((id, index) =>
        prisma.heroSlide.update({
          where: { id },
          data: { order: index },
          select: { id: true },
        }),
      ),
    );

    revalidateHeroSlides();
    return { success: true };
  } catch (err) {
    if (prismaErrorCode(err) === "P2025") {
      return {
        success: false,
        error: "One of those slides no longer exists. Refresh and try again.",
      };
    }
    console.error("reorderHeroSlides failed:", err);
    return { success: false, error: "Could not save the new order. Please try again." };
  }
}
