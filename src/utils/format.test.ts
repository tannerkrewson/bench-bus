import { describe, expect, it } from "vitest";
import {
  formatCompact,
  formatDollarTick,
  formatLastUpdated,
  formatPercentTick,
  formatRelativeLastUpdated,
  latestIsoTimestamp,
} from "./format";

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

describe("formatRelativeLastUpdated", () => {
  const now = Date.parse("2026-08-24T12:00:00Z");

  it("formats recent timestamps as just now, minutes, or hours", () => {
    expect(formatRelativeLastUpdated("2026-08-24T11:59:31Z", now)).toBe("Updated just now");
    expect(formatRelativeLastUpdated("2026-08-24T11:57:00Z", now)).toBe("Updated 3 minutes ago");
    expect(formatRelativeLastUpdated("2026-08-24T10:00:00Z", now)).toBe("Updated 2 hours ago");
  });

  it("uses the absolute date for old timestamps", () => {
    expect(formatRelativeLastUpdated("2026-08-23T12:00:00Z", now)).toBe("Aug 23, 2026, 12:00 PM UTC");
  });

  it("describes future timestamps without claiming they are in the past", () => {
    expect(formatRelativeLastUpdated("2026-08-24T12:00:30Z", now)).toBe("Updated in under a minute");
    expect(formatRelativeLastUpdated("2026-08-24T12:03:00Z", now)).toBe("Updated in 3 minutes");
    expect(formatRelativeLastUpdated("2026-08-25T12:00:00Z", now)).toBe("Aug 25, 2026, 12:00 PM UTC");
  });

  it("returns null for missing, invalid, or invalid-now input", () => {
    expect(formatRelativeLastUpdated(null, now)).toBeNull();
    expect(formatRelativeLastUpdated(undefined, now)).toBeNull();
    expect(formatRelativeLastUpdated("not-a-date", now)).toBeNull();
    expect(formatRelativeLastUpdated("2026-08-24T12:00:00Z", Number.NaN)).toBeNull();
  });
});
