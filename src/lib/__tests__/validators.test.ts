// ─────────────────────────────────────────────────────────────────────────────
// Shared validators — unit suite (src/lib/validators.ts).
//
// parseDeliveryFee is the ONE rule for a delivery fee, used by both admin
// surfaces that set one (the Settings fee sheet and the Branch modal), so a
// fat-fingered "3500000" can't slip in through either door. Fees are money:
// 2-dp through roundMoney, like every other amount.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { parseDeliveryFee } from "@/lib/validators";

describe("parseDeliveryFee", () => {
  it.each([
    [0, 0], // free delivery is allowed
    [35, 35],
    [42.5, 42.5],
    [10_000, 10_000],
    [12.345, 12.35], // rounded like all money
  ])("accepts %s as %s", (input, fee) => {
    expect(parseDeliveryFee(input)).toBe(fee);
  });

  it.each([-1, 10_000.01, 3_500_000, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %s",
    (input) => {
      expect(parseDeliveryFee(input)).toBeNull();
    },
  );
});
