// ─────────────────────────────────────────────────────────────────────────────
// Phone normalization — unit suite (normalizeEgyptMobile / phoneSearchDigits in
// src/lib/validators.ts, formatPhoneLocal / whatsappHref in src/lib/utils.ts).
//
// Every stored customer phone is canonical E.164 so the per-phone checkout
// throttle sees one customer as one phone, admin search matches however staff
// type it, and wa.me links are always dialable. The SQL twin lives in the
// 20261023000000_normalize_order_phone migration — this table is its contract.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { normalizeEgyptMobile, phoneSearchDigits } from "@/lib/validators";
import { formatPhoneLocal, whatsappHref } from "@/lib/utils";

describe("normalizeEgyptMobile", () => {
  it.each([
    ["01001234567", "+201001234567"],
    ["01101234567", "+201101234567"],
    ["01201234567", "+201201234567"],
    ["01501234567", "+201501234567"],
    ["201001234567", "+201001234567"],
    ["+201001234567", "+201001234567"],
    ["00201001234567", "+201001234567"],
    ["0100 123 4567", "+201001234567"],
    ["010-0123-4567", "+201001234567"],
    ["(010) 0123.4567", "+201001234567"],
    ["+20 100 123 4567", "+201001234567"],
    ["٠١٠٠١٢٣٤٥٦٧", "+201001234567"], // Arabic-Indic
    ["۰۱۰۰۱۲۳۴۵۶۷", "+201001234567"], // Eastern Arabic-Indic
    ["+٢٠١٠٠١٢٣٤٥٦٧", "+201001234567"],
  ])("normalizes %s → %s", (raw, e164) => {
    expect(normalizeEgyptMobile(raw)).toBe(e164);
  });

  it("is idempotent on its own output", () => {
    const once = normalizeEgyptMobile("0100 123 4567")!;
    expect(normalizeEgyptMobile(once)).toBe(once);
  });

  // Audit L-4 — real pasted strings. Copying a number out of WhatsApp or the
  // phone's contacts on an Arabic UI wraps it in invisible direction marks;
  // these used to be refused ("Enter an Egyptian mobile"), losing the order.
  it.each([
    ["‪+20 10 01234567‬", "WhatsApp chat copy: LRE … PDF embedding"],
    ["⁦+20 100 123 4567⁩", "Android contacts: LRI … PDI isolate"],
    ["‎+20 100 123 4567", "a leading LRM"],
    ["+20 100 123 4567‏", "a trailing RLM"],
    ["‏٠١٠٠١٢٣٤٥٦٧", "RLM + Arabic-Indic digits"],
    ["؜01001234567", "an Arabic Letter Mark"],
    ["+20 100 123 4567", "no-break spaces between groups"],
    ["+20 100 123 4567", "narrow no-break spaces"],
    ["0100​1234567", "a zero-width space inside"],
    ["⁠010⁠012⁠3456⁠7", "word joiners"],
    ["﻿01001234567", "a byte-order mark from a pasted file"],
    ["010–0123–4567", "en dashes"],
  ])("strips invisible / direction characters: %j (%s)", (raw) => {
    expect(normalizeEgyptMobile(raw)).toBe("+201001234567");
  });

  // "+20 010…" — the national number keeps its trunk 0 after the country code.
  it.each([
    ["+20 010 0123 4567", "+201001234567"],
    ["+20 (0) 100 123 4567", "+201001234567"],
    ["+2001201234567", "+201201234567"],
    ["0020 010 0123 4567", "+201001234567"],
    ["20 015 0123 4567", "+201501234567"],
    ["‪+20 011 0123 4567‬", "+201101234567"],
  ])("accepts the country code with the trunk 0 kept: %j → %s", (raw, e164) => {
    expect(normalizeEgyptMobile(raw)).toBe(e164);
  });

  it.each([
    "+20 0100 123 456", // trunk 0 kept but one digit short
    "+20 00100 123 4567", // two zeros is not a trunk prefix
    "+20 013 0123 4567", // 013 isn't a mobile operator
    "‪0223456789‬", // a landline stays refused, marks or not
    "0100 123 4567 ext", // letters are not separators
  ])("still refuses %j", (raw) => {
    expect(normalizeEgyptMobile(raw)).toBeNull();
  });

  it.each([
    "0223456789", // Cairo landline
    "01301234567", // not a mobile operator prefix
    "0100123456", // one digit short
    "010012345678", // one digit long
    "+441234567890", // foreign
    "1001234567", // no leading 0 / country code
    "phone",
    "",
  ])("refuses %s", (raw) => {
    expect(normalizeEgyptMobile(raw)).toBeNull();
  });
});

describe("phoneSearchDigits", () => {
  it.each([
    ["0100 123", "100123"],
    ["+20100123", "100123"],
    ["00201001234567", "1001234567"],
    ["٠١٠٠١٢", "10012"],
  ])("reduces %s to %s", (q, digits) => {
    expect(phoneSearchDigits(q)).toBe(digits);
  });

  it("ignores queries with too few digits (names, order numbers)", () => {
    expect(phoneSearchDigits("Ahmed")).toBeNull();
    expect(phoneSearchDigits("01")).toBeNull();
  });
});

describe("formatPhoneLocal / whatsappHref", () => {
  it("renders a canonical phone the way staff dial it", () => {
    expect(formatPhoneLocal("+201001234567")).toBe("010 0123 4567");
  });

  it("leaves a legacy, non-canonical value untouched and links nothing", () => {
    expect(formatPhoneLocal("0223456789")).toBe("0223456789");
    expect(whatsappHref("0223456789")).toBeNull();
  });

  it("builds a wa.me link with an optional prefilled message", () => {
    expect(whatsappHref("+201001234567")).toBe("https://wa.me/201001234567");
    expect(whatsappHref("+201001234567", "Hi — order #12")).toBe(
      "https://wa.me/201001234567?text=Hi%20%E2%80%94%20order%20%2312",
    );
  });
});
