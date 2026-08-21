import { describe, expect, it } from "vitest";
import {
  groupModelVariants,
  layoutModelLabels,
  modelVariantParts,
} from "./labelLayout";

const bounds = { left: 10, top: 10, right: 310, bottom: 210 };

describe("layoutModelLabels", () => {
  it("keeps labels inside the plot bounds", () => {
    const [label] = layoutModelLabels(
      [{ id: "right", label: "A long model name", anchorLeft: 305, anchorTop: 205, color: "red" }],
      bounds,
    );

    expect(label!.left).toBeGreaterThanOrEqual(bounds.left);
    expect(label!.top).toBeGreaterThanOrEqual(bounds.top);
    expect(label!.left + label!.width).toBeLessThanOrEqual(bounds.right);
    expect(label!.top + label!.height).toBeLessThanOrEqual(bounds.bottom);
  });

  it("spreads labels with the same anchor when space is available", () => {
    const labels = layoutModelLabels(
      [
        { id: "a", label: "Alpha", anchorLeft: 150, anchorTop: 100, color: "red" },
        { id: "b", label: "Beta", anchorLeft: 150, anchorTop: 100, color: "blue" },
      ],
      bounds,
    );

    expect(labels[0]?.id).toBe("a");
    expect(labels[1]?.id).toBe("b");
    expect(labels[0]?.left === labels[1]?.left && labels[0]?.top === labels[1]?.top).toBe(false);
  });

  it("groups same-brand effort variants but keeps model families separate", () => {
    expect(modelVariantParts("Opus 5 Extra High")).toEqual({
      baseLabel: "Opus 5",
      effort: "extra high",
    });
    const groups = groupModelVariants([
      { id: "opus-high", label: "Opus 5 High", brand: "anthropic", x: 2, y: 60 },
      { id: "opus-medium", label: "Opus 5 Medium", brand: "anthropic", x: 1, y: 59 },
      { id: "opus-other", label: "Opus 4.8 High", brand: "anthropic", x: 1, y: 61 },
      { id: "sonnet-high", label: "Sonnet 5 High", brand: "anthropic", x: 1, y: 62 },
      { id: "other-opus", label: "Opus 5 High", brand: "other", x: 1, y: 63 },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.baseLabel).toBe("Opus 5");
    expect(groups[0]?.members.map((member) => member.id)).toEqual([
      "opus-medium",
      "opus-high",
    ]);
    expect(groups[0]?.representativeId).toBe("opus-high");
  });
});
