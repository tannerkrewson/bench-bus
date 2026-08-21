import { describe, expect, it } from "vitest";
import { formatCompact } from "./format";

describe("formatCompact", () => {
  it("formats small numbers unchanged", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(42)).toBe("42");
  });

  it("formats thousands", () => {
    expect(formatCompact(1234)).toBe("1.2k");
    expect(formatCompact(999)).toBe("999");
  });

  it("formats millions and billions", () => {
    expect(formatCompact(2_500_000)).toBe("2.5M");
    expect(formatCompact(1_000_000_000)).toBe("1B");
  });
});
