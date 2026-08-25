import { describe, expect, it } from "vitest";
import { formatCompact, formatDollarTick, formatLastUpdated, formatPercentTick, latestIsoTimestamp } from "./format";

describe("axis formatters", () => {
  it("formats percent ticks without duplicate units", () => {
    expect(formatPercentTick(0)).toBe("0%");
    expect(formatPercentTick(72.5)).toBe("72.5%");
  });

  it("formats dollar ticks across small and large values", () => {
    expect(formatDollarTick(0)).toBe("$0");
    expect(formatDollarTick(0.005)).toBe("$5.0e-3");
    expect(formatDollarTick(1200)).toBe("$1.2k");
  });
});

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

describe("formatLastUpdated", () => {
  it("formats an ISO UTC timestamp in UTC", () => {
    expect(formatLastUpdated("2026-08-23T22:30:00Z")).toBe("Aug 23, 2026, 10:30 PM UTC");
  });

  it("returns null for missing or invalid input", () => {
    expect(formatLastUpdated(null)).toBeNull();
    expect(formatLastUpdated(undefined)).toBeNull();
    expect(formatLastUpdated("not-a-date")).toBeNull();
  });
});

describe("latestIsoTimestamp", () => {
  it("picks the newest valid timestamp and ignores nulls", () => {
    expect(
      latestIsoTimestamp(["2026-08-21T00:00:00Z", null, "2026-08-23T00:00:00Z"]),
    ).toBe("2026-08-23T00:00:00Z");
  });

  it("returns null when nothing is valid", () => {
    expect(latestIsoTimestamp([])).toBeNull();
    expect(latestIsoTimestamp([null, undefined])).toBeNull();
  });
});
