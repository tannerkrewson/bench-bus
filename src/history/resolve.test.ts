import { describe, expect, it } from "vitest";
import {
  availableTimes,
  formatObservedLocal,
  formatObservedUtc,
  freshnessFromBundle,
  relativeAge,
  resolveTimeTravel,
  stalenessLabel,
} from "./resolve";
import type { BundleIndex, BundleIndexEntry } from "./types";

const T1 = "2026-08-19T03:00:00.000Z";
const T2 = "2026-08-20T03:00:00.000Z";
const T3 = "2026-08-21T03:00:00.000Z";

function entry(asOf: string, aa = true, cursor = true): BundleIndexEntry {
  return { asOf, path: `${asOf}.json`, aa, cursor };
}

/** Mismatched sampling: aa sampled daily, openrouter every 2h (different times). */
const INDEX: BundleIndex = {
  v: 1,
  entries: [entry(T1), entry(T2), entry(T3)],
};

describe("resolveTimeTravel", () => {
  it("resolves null (latest) to the newest compiled entry", () => {
    const view = resolveTimeTravel(INDEX, { selectedAsOf: null });
    expect(view.entry?.asOf).toBe(T3);
    expect(view.isLatest).toBe(true);
    expect(view.preHistory).toBe(false);
  });

  it("resolves a selected time to the newest entry at or before it", () => {
    const between = "2026-08-20T15:30:00.000Z";
    const view = resolveTimeTravel(INDEX, { selectedAsOf: between });
    expect(view.entry?.asOf).toBe(T2);
    expect(view.isLatest).toBe(false);
    expect(view.preHistory).toBe(false);
  });

  it("treats an explicit selection at the newest time as latest", () => {
    const view = resolveTimeTravel(INDEX, { selectedAsOf: T3 });
    expect(view.entry?.asOf).toBe(T3);
    expect(view.isLatest).toBe(true);
  });

  it("marks selections before the first snapshot as pre-history with no entry", () => {
    const view = resolveTimeTravel(INDEX, { selectedAsOf: "2026-08-01T00:00:00.000Z" });
    expect(view.entry).toBeNull();
    expect(view.preHistory).toBe(true);
    expect(view.isLatest).toBe(false);
  });

  it("handles an empty index: latest has no entry, explicit selections are pre-history", () => {
    const empty: BundleIndex = { v: 1, entries: [] };
    expect(resolveTimeTravel(empty, { selectedAsOf: null }).entry).toBeNull();
    const view = resolveTimeTravel(empty, { selectedAsOf: T1 });
    expect(view.preHistory).toBe(true);
  });

  it("lists all compiled times ascending for the selector", () => {
    expect(availableTimes(INDEX)).toEqual([T1, T2, T3]);
  });
});

describe("freshnessFromBundle (mismatched source sampling)", () => {
  it("preserves each source's independent observation time", () => {
    const freshness = freshnessFromBundle({
      sources: {
        aa: { available: true, observedAt: T2 }, // AA sampled daily
        openrouter: { available: true, observedAt: "2026-08-21T01:23:00.000Z" }, // OR every ~2h
        deepswe: { available: false },
        cursor: { available: true, observedAt: T1 }, // Cursor daily, different offset
      },
    });
    expect(freshness.map((f) => f.source)).toEqual(["aa", "openrouter", "deepswe", "cursor"]);
    expect(freshness[1]?.observedAt).toBe("2026-08-21T01:23:00.000Z");
    expect(freshness[3]?.observedAt).toBe(T1);
  });

  it("reports unavailable sources without fabricating an observation time", () => {
    const freshness = freshnessFromBundle({
      sources: {
        aa: { available: false },
        openrouter: { available: false },
        deepswe: { available: false },
        cursor: { available: true, observedAt: T1 },
      },
    });
    expect(freshness[0]).toEqual({ source: "aa", available: false, observedAt: undefined });
    expect(freshness[1]?.available).toBe(false);
    expect(freshness[2]?.available).toBe(false);
    expect(freshness[3]?.available).toBe(true);
  });
});

describe("staleness wording", () => {
  const now = "2026-08-21T06:23:00.000Z";

  it("describes delayed sampling as transparent staleness, not an error", () => {
    const stale: { source: "openrouter"; available: boolean; observedAt: string } = {
      source: "openrouter",
      available: true,
      observedAt: "2026-08-21T01:23:00.000Z", // 5h before now (missed cron runs)
    };
    expect(stalenessLabel(stale, now)).toBe("last sampled 5h ago");
  });

  it("describes missing sources as no data at this time", () => {
    expect(stalenessLabel({ source: "aa", available: false }, now)).toBe("no data at this time");
    expect(stalenessLabel({ source: "aa", available: true }, now)).toBe("no data at this time");
  });

  it("humanizes ages across minutes, hours, and days", () => {
    expect(relativeAge("2026-08-21T06:20:00.000Z", now)).toBe("3m ago");
    expect(relativeAge("2026-08-21T03:23:00.000Z", now)).toBe("3h ago");
    expect(relativeAge("2026-08-18T06:23:00.000Z", now)).toBe("3d ago");
    expect(relativeAge("2026-08-21T07:23:00.000Z", now)).toBe("just now"); // future-safe
  });

  it("formats observation times deterministically in UTC", () => {
    expect(formatObservedUtc("2026-08-21T01:23:00.000Z")).toBe("Aug 21, 01:23 UTC");
  });

  it("formats observation times in the user's local timezone", () => {
    const iso = "2026-08-21T01:23:00.000Z";
    expect(formatObservedLocal(iso)).toBe(
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(iso)),
    );
  });
});
