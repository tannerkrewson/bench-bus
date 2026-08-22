import { describe, expect, it } from "vitest";
import {
  groupModelVariants,
  layoutModelLabels,
  modelVariantParts,
} from "./labelLayout";

const bounds = { left: 10, top: 10, right: 310, bottom: 210 };

describe("layoutModelLabels", () => {
  it("includes the parenthesized discount suffix in collision width", () => {
    const [base] = layoutModelLabels(
      [{ id: "base", label: "Model", anchorLeft: 120, anchorTop: 80, color: "red" }],
      bounds,
    );
    const [discounted] = layoutModelLabels(
      [{
        id: "discounted",
        label: "Model (43.1% off)",
        mainLabel: "Model",
        discountLabel: "(43.1% off)",
        accessibleLabel: "Model (43.1% off)",
        anchorLeft: 120,
        anchorTop: 80,
        color: "red",
      }],
      bounds,
    );
    expect(discounted!.width).toBeGreaterThan(base!.width);
  });

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

  it("keeps an edge label clear of its own dot", () => {
    const [label] = layoutModelLabels(
      [{ id: "edge", label: "Edge model", anchorLeft: 305, anchorTop: 100, color: "red" }],
      bounds,
    );
    expect(label!.left).toBeLessThan(305 - 7);
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

  it("omits labels that cannot fit in the plot rather than clipping them", () => {
    const labels = layoutModelLabels(
      [{ id: "long", label: "A model name that is wider than this plot", anchorLeft: 20, anchorTop: 40, color: "red" }],
      { left: 10, top: 10, right: 80, bottom: 100 },
    );
    expect(labels).toEqual([]);
  });

  it("keeps labels away from unrelated dots in dense clusters", () => {
    const labels = layoutModelLabels(
      [
        { id: "luna", label: "GPT Luna Max", anchorLeft: 150, anchorTop: 100, color: "red", priority: 1 },
        { id: "grok", label: "Grok 4.6 Low", anchorLeft: 165, anchorTop: 100, color: "blue" },
      ],
      bounds,
      { obstacles: [
        { id: "luna", left: 150, top: 100 },
        { id: "grok", left: 165, top: 100 },
      ] },
    );
    const luna = labels.find((label) => label.id === "luna");
    const grok = labels.find((label) => label.id === "grok");
    const nearestDistance = luna && grok
      ? Math.hypot(
          grok.anchorLeft - Math.min(Math.max(grok.anchorLeft, luna.left), luna.left + luna.width),
          grok.anchorTop - Math.min(Math.max(grok.anchorTop, luna.top), luna.top + luna.height),
        )
      : 0;
    expect(nearestDistance).toBeGreaterThanOrEqual(8);
    for (const label of labels) {
      expect(label.label.length * 7.6 + 8).toBeLessThanOrEqual(label.width + 1);
    }
  });

  it("keeps labels away from discount lines", () => {
    const [label] = layoutModelLabels(
      [{ id: "discounted", label: "Discounted model", anchorLeft: 150, anchorTop: 100, color: "red" }],
      bounds,
      { lines: [{ left1: 80, top1: 100, left2: 220, top2: 100 }] },
    );
    expect(label).toBeDefined();
    expect(label!.top + label!.height < 94 || label!.top > 106).toBe(true);
  });

  it("honors an opposite-side preference for a hovered label", () => {
    const [label] = layoutModelLabels(
      [{ id: "hovered", label: "Hovered model", anchorLeft: 150, anchorTop: 100, color: "red" }],
      bounds,
      { preferredSides: new Map([["hovered", "left"]]) },
    );
    expect(label!.left + label!.width).toBeLessThan(150);
  });

  it("keeps effort suffixes when variants need separate labels", () => {
    const groups = groupModelVariants([
      { id: "opus-high", label: "Opus 5 high", brand: "anthropic", x: 2, y: 60 },
      { id: "opus-other", label: "Opus 4.8 high", brand: "anthropic", x: 1, y: 61 },
    ]);
    expect(groups).toEqual([]);
    expect(modelVariantParts("Opus 5 high")?.effort).toBe("high");
  });

  it("groups same-brand effort variants but keeps model families separate", () => {
    expect(modelVariantParts("Opus 5 Extra High")).toEqual({
      baseLabel: "Opus 5",
      effort: "xhigh",
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
