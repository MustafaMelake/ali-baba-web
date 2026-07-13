import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// Vitest configuration — Ali Baba platform.
//
// Most specs are pure/server-action tests that need only a `node` environment;
// the Zustand store spec opts into a DOM via a per-file `// @vitest-environment
// jsdom` pragma (jsdom gives it `window.localStorage` for the persist middleware).
//
// The `@/*` alias mirrors `tsconfig.json` (`paths`) so imports resolve
// identically under test — the engine pulls `DiscountType` from
// `@/generated/prisma/enums`, and the spec imports the enum the same way.
// ─────────────────────────────────────────────────────────────────────────────
export default defineConfig({
  test: {
    environment: "node", // per-file pragmas override this (see cart-store.test.ts)
    // Run each test file in a forked child process instead of a worker thread.
    // Forks avoid the intermittent "Vitest failed to find the runner" first-touch
    // race that worker threads hit on Windows single-file runs — stronger
    // isolation for a negligible cost at this suite size.
    pool: "forks",
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
