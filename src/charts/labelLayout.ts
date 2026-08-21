import type { ModelBrand } from "./types";

export interface LabelLayoutAnchor {
  id: string;
  label: string;
  anchorLeft: number;
  anchorTop: number;
  color: string;
  priority?: number;
}

export interface ModelVariantMember {
  id: string;
  label: string;
  brand: ModelBrand;
  x: number;
  y: number;
}

export interface ModelVariantGroup {
  key: string;
  brand: ModelBrand;
  baseLabel: string;
  members: ModelVariantMember[];
  representativeId: string;
}

export interface LabelLayoutBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PositionedLabel extends LabelLayoutAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

const LABEL_HEIGHT = 20;
const LABEL_MIN_WIDTH = 72;
const LABEL_MAX_WIDTH = 180;
const LABEL_GAP = 4;
const EFFORT_SUFFIX = /^(.*?)\s+(Extra\s+High|Low|Medium|High|Max)$/i;
const EFFORT_ORDER: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  "extra high": 3,
  max: 4,
};

/** Return the model family and effort suffix used by Cursor's variants. */
export function modelVariantParts(label: string): { baseLabel: string; effort: string } | null {
  const match = label.trim().match(EFFORT_SUFFIX);
  if (!match?.[1] || !match[2]) return null;
  return { baseLabel: match[1].trim(), effort: match[2].toLowerCase() };
}

/** Group only same-brand model families that expose multiple effort levels. */
export function groupModelVariants(
  members: readonly ModelVariantMember[],
): ModelVariantGroup[] {
  const groups = new Map<
    string,
    { baseLabel: string; brand: ModelBrand; members: ModelVariantMember[] }
  >();

  for (const member of members) {
    const parts = modelVariantParts(member.label);
    if (!parts) continue;
    const key = `${member.brand}:${parts.baseLabel.toLowerCase()}`;
    const group = groups.get(key) ?? {
      baseLabel: parts.baseLabel,
      brand: member.brand,
      members: [],
    };
    group.members.push(member);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.members.length > 1)
    .map(([key, group]) => {
      const sorted = [...group.members].sort(
        (a, b) => b.y - a.y || a.label.localeCompare(b.label),
      );
      return {
        key,
        brand: group.brand,
        baseLabel: group.baseLabel,
        members: [...group.members].sort(
          (a, b) =>
            (EFFORT_ORDER[modelVariantParts(a.label)?.effort ?? ""] ?? 99) -
              (EFFORT_ORDER[modelVariantParts(b.label)?.effort ?? ""] ?? 99) ||
            a.label.localeCompare(b.label),
        ),
        representativeId: sorted[0]!.id,
      };
    });
}

function labelWidth(label: string, bounds: LabelLayoutBounds): number {
  const available = Math.max(1, bounds.right - bounds.left);
  return Math.min(
    available,
    Math.min(LABEL_MAX_WIDTH, Math.max(LABEL_MIN_WIDTH, label.length * 5.1 + 10)),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function overlapArea(a: PositionedLabel, b: PositionedLabel): number {
  const width = Math.max(
    0,
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left),
  );
  const height = Math.max(
    0,
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top),
  );
  return width * height;
}

function overlaps(a: PositionedLabel, b: PositionedLabel): boolean {
  return (
    a.left < b.left + b.width + LABEL_GAP &&
    a.left + a.width + LABEL_GAP > b.left &&
    a.top < b.top + b.height + LABEL_GAP &&
    a.top + a.height + LABEL_GAP > b.top
  );
}

/**
 * Place point labels inside the plot bounds. Labels prefer to stay beside
 * their dot, but try several nearby sides and vertical offsets before using
 * a distant fallback. This keeps dense charts readable without needlessly
 * separating labels from their dots.
 */
export function layoutModelLabels(
  anchors: readonly LabelLayoutAnchor[],
  bounds: LabelLayoutBounds,
): PositionedLabel[] {
  const sorted = [...anchors].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.anchorTop - b.anchorTop,
  );
  const placed: PositionedLabel[] = [];
  const result = new Map<string, PositionedLabel>();

  for (const anchor of sorted) {
    const width = labelWidth(anchor.label, bounds);
    const height = LABEL_HEIGHT;
    const minLeft = bounds.left;
    const maxLeft = Math.max(minLeft, bounds.right - width);
    const minTop = bounds.top;
    const maxTop = Math.max(minTop, bounds.bottom - height);
    const candidates: { left: number; top: number }[] = [];

    // Search locally first. Dense charts may still need a distant fallback,
    // but labels should not jump across most of the plot merely to avoid a
    // nearby point. The larger offsets are deliberately tried last.
    const verticalOffsets = [
      0,
      -height - LABEL_GAP,
      height + LABEL_GAP,
      -2 * (height + LABEL_GAP),
      2 * (height + LABEL_GAP),
      -3 * (height + LABEL_GAP),
      3 * (height + LABEL_GAP),
    ];
    const maxLocalOffset = Math.max(...verticalOffsets.map((offset) => Math.abs(offset)));
    for (const horizontalOffset of [LABEL_GAP + 4, -width - LABEL_GAP - 4, -width / 2]) {
      for (const verticalOffset of verticalOffsets) {
        candidates.push({
          left: clamp(anchor.anchorLeft + horizontalOffset, minLeft, maxLeft),
          top: clamp(anchor.anchorTop - height / 2 + verticalOffset, minTop, maxTop),
        });
      }
    }

    const verticalRange = Math.max(maxLocalOffset + height, bounds.bottom - bounds.top);
    for (const horizontalOffset of [LABEL_GAP + 4, -width - LABEL_GAP - 4, -width / 2]) {
      for (
        let verticalOffset = -verticalRange;
        verticalOffset <= verticalRange;
        verticalOffset += 18
      ) {
        candidates.push({
          left: clamp(anchor.anchorLeft + horizontalOffset, minLeft, maxLeft),
          top: clamp(anchor.anchorTop - height / 2 + verticalOffset, minTop, maxTop),
        });
      }
    }

    let best: PositionedLabel | undefined;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      const positioned: PositionedLabel = { ...anchor, ...candidate, width, height };
      const overlap = placed.reduce(
        (total, existing) =>
          total + (overlaps(positioned, existing) ? 100_000 + overlapArea(positioned, existing) : 0),
        0,
      );
      const distance =
        Math.abs(candidate.left - (anchor.anchorLeft + LABEL_GAP + 4)) * 0.05 +
        Math.abs(candidate.top - (anchor.anchorTop - height / 2)) * 0.02;
      const score = overlap + distance;
      if (score < bestScore) {
        best = positioned;
        bestScore = score;
      }
    }

    const finalPosition = best ?? {
      ...anchor,
      left: clamp(anchor.anchorLeft + LABEL_GAP + 4, minLeft, maxLeft),
      top: clamp(anchor.anchorTop - height / 2, minTop, maxTop),
      width,
      height,
    };
    placed.push(finalPosition);
    result.set(anchor.id, finalPosition);
  }

  return anchors.map((anchor) => result.get(anchor.id)!).filter(Boolean);
}
