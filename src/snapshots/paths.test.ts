import { describe, expect, it } from "vitest";
import {
  DATA_BRANCH_NAME,
  manifestPath,
  observedAtToSegment,
  segmentToObservedAt,
  snapshotPath,
} from "./paths";

describe("observedAtToSegment / segmentToObservedAt", () => {
  it("produces compact filesystem-safe UTC segments", () => {
    expect(observedAtToSegment("2026-08-21T01:53:42.000Z")).toBe("20260821T015342Z");
  });

  it("truncates sub-second precision deterministically (floor)", () => {
    expect(observedAtToSegment("2026-08-21T01:53:42.999Z")).toBe("20260821T015342Z");
    expect(observedAtToSegment("2026-08-21T01:53:42.000Z")).toBe(
      observedAtToSegment("2026-08-21T01:53:42.500Z"),
    );
  });

  it("round-trips through segmentToObservedAt", () => {
    const segment = observedAtToSegment("2026-01-02T03:04:05.678Z");
    expect(segmentToObservedAt(segment)).toBe("2026-01-02T03:04:05.000Z");
  });

  it("rejects invalid timestamps", () => {
    expect(() => observedAtToSegment("not-a-time")).toThrow(TypeError);
    expect(() => segmentToObservedAt("20260821")).toThrow(TypeError);
    expect(() => segmentToObservedAt("20261321T015342Z")).toThrow(TypeError);
  });
});

describe("deterministic paths", () => {
  it("places snapshots under snapshots/<source>/v<version>/<segment>.json", () => {
    expect(snapshotPath("aa", 1, "2026-08-21T01:53:42.000Z")).toBe(
      "snapshots/aa/v1/20260821T015342Z.json",
    );
    expect(snapshotPath("openrouter", 3, "2026-08-21T01:53:42.000Z")).toBe(
      "snapshots/openrouter/v3/20260821T015342Z.json",
    );
  });

  it("is stable for identical inputs", () => {
    expect(snapshotPath("cursor", 1, "2026-08-21T01:53:42.000Z")).toBe(
      snapshotPath("cursor", 1, "2026-08-21T01:53:42.999Z"),
    );
  });

  it("keeps manifests in a per-source manifests directory", () => {
    expect(manifestPath("aa")).toBe("manifests/aa.json");
  });

  it("names the dedicated data branch", () => {
    expect(DATA_BRANCH_NAME).toBe("bench-bus-data");
  });
});
