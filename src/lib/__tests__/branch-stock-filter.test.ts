// ─────────────────────────────────────────────────────────────────────────────
// Branch stock search + tabs — src/lib/branch-stock-filter.ts.
//
// Pins what the manager sees on /admin/inventory: every search word must hit
// the product, category, size or SKU; the tab counters reflect the search but
// not the tab; and the whole-product button keeps acting on ALL variants even
// when only some are listed.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  filterBranchStock,
  parseStockFilter,
  parseStockQuery,
} from "@/lib/branch-stock-filter";

const v = (id: string, name: string, inStock: boolean, sku: string | null = null) => ({
  id,
  name,
  sku,
  inStock,
});

const CATALOG = [
  {
    name: "Kunafa",
    category: { name: "Oriental Sweets" },
    variants: [v("k-s", "Small", true, "KUN-S"), v("k-l", "Large", false, "KUN-L")],
  },
  {
    name: "Chocolate Gateau",
    category: { name: "Cakes" },
    variants: [v("c-1", "Whole", true, null)],
  },
  {
    name: "Basbousa",
    category: { name: "Oriental Sweets" },
    variants: [v("b-1", "Tray", false, "BAS-T")],
  },
];

const ids = (r: { products: { matches: { id: string }[] }[] }) =>
  r.products.flatMap((p) => p.matches.map((m) => m.id));

describe("filterBranchStock — stock tabs", () => {
  it("'all' lists every variant and counts each state", () => {
    const r = filterBranchStock(CATALOG, { query: "", stock: "all" });
    expect(ids(r)).toEqual(["k-s", "k-l", "c-1", "b-1"]);
    expect(r.counts).toEqual({ all: 4, in: 2, out: 2 });
  });

  it("'out' lists only sold-out lines and drops products with none", () => {
    const r = filterBranchStock(CATALOG, { query: "", stock: "out" });
    expect(ids(r)).toEqual(["k-l", "b-1"]);
    expect(r.products.map((p) => p.name)).toEqual(["Kunafa", "Basbousa"]);
  });

  it("'in' lists only orderable lines", () => {
    expect(ids(filterBranchStock(CATALOG, { query: "", stock: "in" }))).toEqual(["k-s", "c-1"]);
  });

  it("keeps the product's FULL variant list for the whole-product button", () => {
    const [kunafa] = filterBranchStock(CATALOG, { query: "", stock: "out" }).products;
    expect(kunafa.matches.map((m) => m.id)).toEqual(["k-l"]);
    expect(kunafa.variants.map((m) => m.id)).toEqual(["k-s", "k-l"]);
  });
});

describe("filterBranchStock — search", () => {
  it.each([
    ["product name, any case", "kunafa", ["k-s", "k-l"]],
    ["category name", "oriental", ["k-s", "k-l", "b-1"]],
    ["SKU", "bas-t", ["b-1"]],
    ["size within a product (every word must hit)", "kunafa large", ["k-l"]],
    ["words spread across product and category", "sweets small", ["k-s"]],
  ])("matches by %s", (_label, query, expected) => {
    expect(ids(filterBranchStock(CATALOG, { query, stock: "all" }))).toEqual(expected);
  });

  it("returns nothing when no word hits", () => {
    const r = filterBranchStock(CATALOG, { query: "croissant", stock: "all" });
    expect(r.products).toEqual([]);
    expect(r.counts).toEqual({ all: 0, in: 0, out: 0 });
  });

  it("counts follow the search but not the tab — each tab shows what it would list", () => {
    const r = filterBranchStock(CATALOG, { query: "oriental", stock: "in" });
    expect(ids(r)).toEqual(["k-s"]);
    expect(r.counts).toEqual({ all: 3, in: 1, out: 2 });
  });
});

describe("URL parsing", () => {
  it("parseStockFilter accepts only the real values", () => {
    expect(parseStockFilter("out")).toBe("out");
    expect(parseStockFilter("in")).toBe("in");
    expect(parseStockFilter("OUT")).toBe("all");
    expect(parseStockFilter("'; drop")).toBe("all");
    expect(parseStockFilter(undefined)).toBe("all");
  });

  it("parseStockQuery normalizes like the storefront search and caps the length", () => {
    expect(parseStockQuery("  kunafa   large ")).toBe("kunafa large");
    expect(parseStockQuery("100%_off")).toBe("100off");
    expect(parseStockQuery("x".repeat(200))).toHaveLength(64);
    expect(parseStockQuery(undefined)).toBe("");
  });
});
