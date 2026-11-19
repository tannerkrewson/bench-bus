import { describe, expect, it } from "vitest";
import { modelGroupColor } from "./brand";
import { nearbyModelColor, nearbyModelColorSlots } from "./nearbyModelColors";
import type { PlottablePoint } from "./types";

const point = (id: string, effortGroup: string, x: number, y: number): PlottablePoint =>
  ({ id, label: id, effortGroup, x, y });

describe("nearby model colors", () => {
  it("separates nearby families that would otherwise share a color", () => {
    const a = "gemini-4-neon";
    const b = "gemini-4-carbon";
    expect(modelGroupColor(a, false)).toBe(modelGroupColor(b, false));
    const points = [point("neon-high", a, 100, 59), point("neon-low", a, 10, 30), point("carbon", b, 102, 60)];
    const slots = nearbyModelColorSlots(points, "log");
    expect(slots).toEqual(nearbyModelColorSlots([...points].reverse(), "log"));
    expect(slots.size).toBe(2);
    for (const dark of [false, true]) {
      expect(nearbyModelColor(slots, a, dark)).not.toBe(nearbyModelColor(slots, b, dark));
      expect(nearbyModelColor(slots, `effort:${a}`, dark)).toBe(nearbyModelColor(slots, a, dark));
    }
  });

  it("preserves preferred colors for separated families", () => {
    const points = [point("haiku", "haiku-5-5", 1, 20), point("sonnet", "sonnet-5-5", 1000, 60)];
    const slots = nearbyModelColorSlots(points, "log");
    for (const { effortGroup } of points) {
      expect(nearbyModelColor(slots, effortGroup!, false)).toBe(modelGroupColor(effortGroup!, false));
    }
  });
});
