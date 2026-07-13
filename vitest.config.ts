import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// Vitest configuration — Ali Baba platform.
//
// The suite currently targets the financial core: the pure, dependency-free
// Discount Engine (`src/lib/discounts.ts`). It touches no database and no React,
// so a plain `node` environment is all it needs — no jsdom, no Prisma client, no
// setup file. That keeps the money-path tests fast and hermetic.
//
// The `@/*` alias mirrors `tsconfig.json` (`paths`) so imports resolve
// identically under test — the engine pulls `DiscountType` from
// `@/generated/prisma/enums`, and the spec imports the enum the same way.
// ─────────────────────────────────────────────────────────────────────────────
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      // Scoped to the money path so the coverage number stays meaningful today
      // (100% of the engine) rather than being diluted by the yet-untested app.
      // Broaden this list as more modules gain a spec.
      include: ["src/lib/discounts.ts"],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
