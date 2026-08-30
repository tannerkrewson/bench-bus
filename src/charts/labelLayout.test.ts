import { describe, expect, it } from "vitest";
import {
  fallbackLabelTextWidth,
  groupModelVariants,
  LABEL_HORIZONTAL_PADDING,
  LABEL_MAIN_FONT_SIZE,
  labelLeaderCrossesLabel,
  labelLeaderSegment,
  layoutModelLabels,
  labelTextWidth,
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
    expect(discounted!.width).toBe(
      Math.ceil(labelTextWidth({
        label: "Model (43.1% off)",
        mainLabel: "Model",
        discountLabel: "(43.1% off)",
      }) + LABEL_HORIZONTAL_PADDING),
    );
  });

  it("measures discount suffixes at their smaller rendered font size", () => {
    const anchor = {
      label: "Model (43.1% off)",
      mainLabel: "Model",
      discountLabel: "(43.1% off)",
    };
    const width = labelTextWidth(anchor, (text, fontSize) => text.length * fontSize);

    expect(width).toBe(
      "Model".length * 13 + " ".length * 13 + "(43.1% off)".length * 10,
    );
    expect(width).toBeLessThan(anchor.label.length * LABEL_MAIN_FONT_SIZE);
  });

  it("keeps the model name when a discount suffix cannot fit", () => {
    const [label] = layoutModelLabels(
      [{
        id: "mimo",
        label: "MiMo-v2.5 (75% off)",
        mainLabel: "MiMo-v2.5",
        discountLabel: "(75% off)",
        accessibleLabel: "MiMo-v2.5 (75% off)",
        anchorLeft: 50,
        anchorTop: 50,
        color: "red",
      }],
      { left: 10, top: 10, right: 100, bottom: 100 },
    );

    expect(label).toMatchObject({
      label: "MiMo-v2.5",
      mainLabel: "MiMo-v2.5",
      accessibleLabel: "MiMo-v2.5 (75% off)",
    });
    expect(label?.discountLabel).toBeUndefined();
  });

  it("keeps ordinary labels safe with the conservative main-font fallback", () => {
    const anchor = {
      id: "terra",
      label: "Cursor Terra",
      anchorLeft: 305,
      anchorTop: 100,
      color: "red",
    };
    const [label] = layoutModelLabels([anchor], bounds);

    expect(label).toBeDefined();
    expect(label!.width).toBe(
      Math.ceil(fallbackLabelTextWidth(anchor.label, LABEL_MAIN_FONT_SIZE) + LABEL_HORIZONTAL_PADDING),
    );
    expect(label!.left + label!.width).toBeLessThanOrEqual(bounds.right);
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

  it("prefers the left side of a model dot by default", () => {
    const [label] = layoutModelLabels(
      [{ id: "model", label: "Model", anchorLeft: 150, anchorTop: 100, color: "red" }],
      bounds,
    );
    expect(label!.left + label!.width).toBeLessThan(150);
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

  it("keeps a dense-chart model name visible when only its leader is blocked", () => {
    const labels = layoutModelLabels(
      [
        { id: "grok", label: "Grok 4.6", anchorLeft: 150, anchorTop: 100, color: "red" },
        { id: "neighbor", label: "Neighbor", anchorLeft: 220, anchorTop: 100, color: "blue" },
      ],
      bounds,
      {
        obstacles: [
          { id: "grok", left: 150, top: 100 },
          { id: "neighbor", left: 220, top: 100 },
          { id: "leader-blocker", left: 120, top: 100 },
        ],
        leaderObstacles: [{ id: "leader-blocker", left: 120, top: 100 }],
      },
    );

    expect(labels.find((label) => label.id === "grok")).toBeDefined();
  });

  it("keeps labels clear of larger crown obstacles", () => {
    const [label] = layoutModelLabels(
      [{ id: "frontier", label: "Frontier model", anchorLeft: 150, anchorTop: 100, color: "red", priority: 1 }],
      bounds,
      { obstacles: [{ id: "crown:frontier", left: 150, top: 82, radius: 11 }] },
    );
    expect(label).toBeDefined();
    const closestLeft = Math.min(Math.max(150, label!.left), label!.left + label!.width);
    const closestTop = Math.min(Math.max(82, label!.top), label!.top + label!.height);
    expect(Math.hypot(150 - closestLeft, 82 - closestTop)).toBeGreaterThanOrEqual(11);
  });

  it("moves a label rather than routing its leader through another dot", () => {
    const [label] = layoutModelLabels(
      [{ id: "owner", label: "Owner model", anchorLeft: 100, anchorTop: 100, color: "red" }],
      bounds,
      {
        obstacles: [{ id: "other", left: 115, top: 100 }],
        leaderObstacles: [{ id: "other", left: 115, top: 100 }],
      },
    );
    expect(label).toBeDefined();
    // The default left-side candidate would terminate immediately beside the
    // unrelated dot; the collision pass must choose another safe position.
    expect(label!.left + label!.width < 107 || label!.top !== 90).toBe(true);
  });

  it("keeps leaders from crossing other model labels", () => {
    const labels = layoutModelLabels(
      [
        { id: "a", label: "A very long model", anchorLeft: 135, anchorTop: 379, priority: 1, color: "red" },
        { id: "b", label: "B very long model", anchorLeft: 202, anchorTop: 339, color: "blue" },
      ],
      { left: 0, top: 0, right: 500, bottom: 400 },
    );
    const first = labels.find((label) => label.id === "a");
    const second = labels.find((label) => label.id === "b");

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(labelLeaderSegment(first!)).toEqual(expect.objectContaining({ left1: 135, top1: 379 }));
    expect(labelLeaderCrossesLabel(first!, second!)).toBe(false);
    expect(labelLeaderCrossesLabel(second!, first!)).toBe(false);
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
