import { describe, expect, it } from "vitest";
import { TIME_VARYING_DISCOUNT_NOTE, timeVaryingDiscountNote } from "./discountNotes";

describe("timeVaryingDiscountNote", () => {
  it("matches DeepSeek-style entries case-insensitively across id, label, and providers", () => {
    expect(timeVaryingDiscountNote({ id: "deepseek/deepseek-r1-0528" })).toBe(
      TIME_VARYING_DISCOUNT_NOTE,
    );
    expect(timeVaryingDiscountNote({ label: "DeepSeek v4 Flash 0731 max" })).toBe(
      TIME_VARYING_DISCOUNT_NOTE,
    );
    expect(timeVaryingDiscountNote({ providers: ["DeepSeek (fp8)"] })).toBe(
      TIME_VARYING_DISCOUNT_NOTE,
    );
    expect(timeVaryingDiscountNote({ id: "DEEPSEEK-V4", providers: ["Chutes"] })).toBe(
      TIME_VARYING_DISCOUNT_NOTE,
    );
    expect(timeVaryingDiscountNote({ id: "x", label: "deep", providers: ["seek"] })).toBeNull();
  });

  it("returns null for unaffected entries and empty subjects", () => {
    expect(timeVaryingDiscountNote({ id: "gpt-5.6-sol", label: "GPT-5.6 Sol", providers: ["OpenAI"] })).toBeNull();
    expect(timeVaryingDiscountNote({})).toBeNull();
    expect(timeVaryingDiscountNote(null)).toBeNull();
    expect(timeVaryingDiscountNote(undefined)).toBeNull();
  });
});
