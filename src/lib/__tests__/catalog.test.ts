// ─────────────────────────────────────────────────────────────────────────────
// Branch-stock rule — src/lib/catalog.ts.
//
// One rule, two forms: the Prisma `where` helpers (DB-side) and
// `isAvailableAtBranch` (in-memory, used by placeOrder). Both must say:
//
//   available at X  ⇔  product.isAvailable && variant.isAvailable
//                       && override(X)?.isAvailable !== false
//
// with a MISSING override meaning available.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  branchOutOfStockMessage,
  isAvailableAtBranch,
  listableProductAtBranch,
  variantAvailableAtBranch,
  variantLabel,
} from "@/lib/catalog";

describe("isAvailableAtBranch — the truth table", () => {
  it.each([
    // product, variant, branch override → available?
    [true, true, undefined, true], // no override row → in stock
    [true, true, null, true],
    [true, true, true, true],
    [true, true, false, false], // switched off at this branch
    [false, true, true, false], // admin's product kill-switch wins over the branch
    [true, false, true, false], // admin's variant kill-switch wins over the branch
    [false, false, undefined, false],
  ])(
    "product=%s variant=%s branch=%s → %s",
    (productAvailable, variantAvailable, branchAvailable, expected) => {
      expect(
        isAvailableAtBranch({ productAvailable, variantAvailable, branchAvailable }),
      ).toBe(expected);
    },
  );
});

describe("Prisma where helpers", () => {
  it("variantAvailableAtBranch: globally on AND no 'off' row at that branch (none, so a missing row still matches)", () => {
    expect(variantAvailableAtBranch("branch_menouf")).toEqual({
      isAvailable: true,
      branchAvailability: { none: { branchId: "branch_menouf", isAvailable: false } },
    });
  });

  it("listableProductAtBranch: the product is on and has a variant in stock at that branch", () => {
    expect(listableProductAtBranch("branch_menouf")).toEqual({
      isAvailable: true,
      variants: {
        some: {
          isAvailable: true,
          branchAvailability: { none: { branchId: "branch_menouf", isAvailable: false } },
        },
      },
    });
  });
});

describe("customer-facing wording", () => {
  it("names the exact variant, since one size can be out while another isn't", () => {
    expect(variantLabel("Kunafa", "Small")).toBe("Kunafa (Small)");
    expect(variantLabel("Kunafa", "")).toBe("Kunafa");
  });

  it("branchOutOfStockMessage matches the agreed copy", () => {
    expect(branchOutOfStockMessage("Kunafa", "Small", "Menouf")).toBe(
      "Kunafa (Small) is currently out of stock at the Menouf branch.",
    );
  });
});
