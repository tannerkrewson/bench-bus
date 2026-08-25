import type { ModelBrand } from "./types";
import { formatEffort, modelEffortOrder, preferredFamilyLabel } from "./modelMetadata";

export interface LabelLayoutAnchor {
  id: string;
  /** Full visual text, used for conservative collision/width measurement. */
  label: string;
  /** Optional structured visual parts for model labels. */
  mainLabel?: string;
  discountLabel?: string;
  /** Full canonical text exposed to assistive technology and tooltips. */
  accessibleLabel?: string;
  anchorLeft: number;
  anchorTop: number;
  color: string;
  priority?: number;
}

export interface ModelVariantMember {
  id: string;
  label: string;
  brand: ModelBrand;
  effortGroup?: string;
  effort?: string;
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

export interface LabelLayoutPoint {
  id: string;
  left: number;
  top: number;
  /** Optional collision radius, used for larger crown glyphs. */
  radius?: number;
}

export interface LabelLayoutLine {
  left1: number;
  top1: number;
  left2: number;
  top2: number;
}

export interface LabelLayoutOptions {
  /** Other plotted dots that labels must not cover. */
  obstacles?: readonly LabelLayoutPoint[];
  /** Discount/annotation lines that labels should not cover. */
  lines?: readonly LabelLayoutLine[];
  /** Dot/crown obstacles that leader lines must not cross. */
  leaderObstacles?: readonly LabelLayoutPoint[];
  /** Overrides the first side tried for a label (used while hovering it). */
  preferredSides?: ReadonlyMap<string, "left" | "right">;
}

const LABEL_HEIGHT = 20;
const LABEL_GAP = 6;
const LABEL_DOT_RADIUS = 8;
// Keep a conservative width estimate while the rendered 13px label remains
// smaller; this avoids collisions caused by font-metric differences.
const LABEL_FONT_WIDTH = 7.6;
const EFFORT_SUFFIX = /^(.*?)\s+(xhigh|extra\s+high|low|medium|high|max)$/i;

/** Return the model family and effort suffix used by Cursor's variants. */
export function modelVariantParts(label: string): { baseLabel: string; effort: string } | null {
  const match = label.trim().match(EFFORT_SUFFIX);
  if (!match?.[1] || !match[2]) return null;
  return { baseLabel: match[1].trim(), effort: formatEffort(match[2]) };
}

/** Group explicit effort groups or same-brand model families with multiple effort levels. */
export function groupModelVariants(
  members: readonly ModelVariantMember[],
): ModelVariantGroup[] {
  const groups = new Map<
    string,
    { baseLabel: string; brand: ModelBrand; members: ModelVariantMember[] }
  >();

  for (const member of members) {
    const parts = member.effort
      ? { baseLabel: member.label.replace(/\s+(?:xhigh|extra\s+high|low|medium|high|max)$/i, "").trim(), effort: formatEffort(member.effort) }
      : modelVariantParts(member.label);
    if (!parts && !member.effortGroup) continue;
    // A family key is authoritative when supplied by an adapter, but only
    // reasoning-effort members participate in a connector group.
    if (!parts) continue;
    const key = member.effortGroup
      ? `effort:${member.effortGroup}`
      : `${member.brand}:${parts.baseLabel.toLowerCase()}`;
    const group = groups.get(key) ?? {
      baseLabel: parts?.baseLabel ?? member.effortGroup!,
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
            modelEffortOrder(a.effort ?? modelVariantParts(a.label)?.effort) -
              modelEffortOrder(b.effort ?? modelVariantParts(b.label)?.effort) ||
            a.label.localeCompare(b.label),
        ),
        // One family gets one label. Prefer high effort, then the highest
        // available effort, rather than whichever point has the best score.
        representativeId: (() => {
          const preferred = preferredFamilyLabel(
            group.members.map((member) => ({
              label: member.label,
              effort: member.effort ?? modelVariantParts(member.label)?.effort,
            })),
            group.baseLabel,
          );
          return group.members.find((member) => member.label === preferred)?.id ?? sorted[0]!.id;
        })(),
      };
    });
}

function labelWidth(label: string, bounds: LabelLayoutBounds): number | null {
  const available = Math.max(1, bounds.right - bounds.left);
  // Keep enough room for the larger label font and padding. A label wider than
  // the plot can never be shown in full, so omit it instead of clipping it.
  const intrinsic = Math.ceil(label.length * LABEL_FONT_WIDTH + 8);
  return intrinsic <= available ? intrinsic : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function overlaps(a: PositionedLabel, b: PositionedLabel): boolean {
  return (
    a.left < b.left + b.width + LABEL_GAP &&
    a.left + a.width + LABEL_GAP > b.left &&
    a.top < b.top + b.height + LABEL_GAP &&
    a.top + a.height + LABEL_GAP > b.top
  );
}

function coversPoint(label: PositionedLabel, point: LabelLayoutPoint): boolean {
  const closestLeft = clamp(point.left, label.left, label.left + label.width);
  const closestTop = clamp(point.top, label.top, label.top + label.height);
  return Math.hypot(point.left - closestLeft, point.top - closestTop) < (point.radius ?? LABEL_DOT_RADIUS);
}

function labelLeaderEndpoint(label: PositionedLabel): { left: number; top: number } {
  return {
    left: clamp(label.anchorLeft, label.left, label.left + label.width),
    top: clamp(label.anchorTop, label.top, label.top + label.height),
  };
}

function distanceToSegment(
  point: LabelLayoutPoint,
  start: { left: number; top: number },
  end: { left: number; top: number },
): number {
  const dx = end.left - start.left;
  const dy = end.top - start.top;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.left - start.left, point.top - start.top);
  const progress = clamp(
    ((point.left - start.left) * dx + (point.top - start.top) * dy) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(
    point.left - (start.left + progress * dx),
    point.top - (start.top + progress * dy),
  );
}

function leaderCrossesPoint(label: PositionedLabel, point: LabelLayoutPoint): boolean {
  if (point.id === label.id) return false;
  const endpoint = labelLeaderEndpoint(label);
  return distanceToSegment(
    point,
    { left: label.anchorLeft, top: label.anchorTop },
    endpoint,
  ) < (point.radius ?? LABEL_DOT_RADIUS);
}

function coversLine(label: PositionedLabel, line: LabelLayoutLine): boolean {
  const minX = Math.min(line.left1, line.left2);
  const maxX = Math.max(line.left1, line.left2);
  const minY = Math.min(line.top1, line.top2);
  const maxY = Math.max(line.top1, line.top2);
  const padding = LABEL_GAP;
  return maxX >= label.left - padding && minX <= label.left + label.width + padding &&
    maxY >= label.top - padding && minY <= label.top + label.height + padding;
}

/**
 * Place point labels inside the plot bounds. A candidate is accepted only if
 * it clears every already-plotted dot and every previously placed label. If a
 * full label cannot be placed without a collision, it is omitted rather than
 * rendered clipped or on top of a dot.
 */
export function layoutModelLabels(
  anchors: readonly LabelLayoutAnchor[],
  bounds: LabelLayoutBounds,
  options: LabelLayoutOptions = {},
): PositionedLabel[] {
  const obstacles = options.obstacles ?? anchors.map((anchor) => ({
    id: anchor.id,
    left: anchor.anchorLeft,
    top: anchor.anchorTop,
  }));
  const sorted = [...anchors].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.anchorTop - b.anchorTop,
  );
  const placed: PositionedLabel[] = [];
  const result = new Map<string, PositionedLabel>();
  const sideOffset = LABEL_DOT_RADIUS + LABEL_GAP;

  for (const anchor of sorted) {
    const width = labelWidth(anchor.label, bounds);
    if (width === null) continue;
    const height = LABEL_HEIGHT;
    const minLeft = bounds.left;
    const maxLeft = Math.max(minLeft, bounds.right - width);
    const minTop = bounds.top;
    const maxTop = Math.max(minTop, bounds.bottom - height);
    // Keep labels on the open left side of the solid model line by default;
    // callers can still override this for a specific crowded label.
    const preferredSide = options.preferredSides?.get(anchor.id) ?? "left";
    const sides: ("left" | "right" | "center")[] = preferredSide === "left"
      ? ["left", "right", "center"]
      : ["right", "left", "center"];
    const verticalOffsets = [
      0,
      -height - LABEL_GAP,
      height + LABEL_GAP,
      -2 * (height + LABEL_GAP),
      2 * (height + LABEL_GAP),
      -3 * (height + LABEL_GAP),
      3 * (height + LABEL_GAP),
    ];
    const candidates: { left: number; top: number; side: "left" | "right" | "center" }[] = [];
    const addCandidate = (side: "left" | "right" | "center", verticalOffset: number) => {
      const horizontalOffset = side === "left"
        ? -width - sideOffset
        : side === "right" ? sideOffset : -width / 2;
      candidates.push({
        left: clamp(anchor.anchorLeft + horizontalOffset, minLeft, maxLeft),
        top: clamp(anchor.anchorTop - height / 2 + verticalOffset, minTop, maxTop),
        side,
      });
    };
    // Local candidates keep labels near their own dot. The broader sweep is a
    // last resort for crowded clusters and remains bounded by the plot.
    for (const side of sides) {
      for (const verticalOffset of verticalOffsets) addCandidate(side, verticalOffset);
    }
    const verticalRange = Math.max(
      Math.max(...verticalOffsets.map((offset) => Math.abs(offset))) + height,
      bounds.bottom - bounds.top,
    );
    for (const side of sides) {
      for (let verticalOffset = -verticalRange; verticalOffset <= verticalRange; verticalOffset += 18) {
        addCandidate(side, verticalOffset);
      }
    }

    let best: PositionedLabel | undefined;
    let bestScore = Infinity;
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const key = `${candidate.left}:${candidate.top}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const positioned: PositionedLabel = {
        ...anchor,
        left: candidate.left,
        top: candidate.top,
        width,
        height,
      };
      if (placed.some((existing) => overlaps(positioned, existing))) continue;
      if (obstacles.some((point) => point.id !== anchor.id && coversPoint(positioned, point))) continue;
      if (coversPoint(positioned, { id: anchor.id, left: anchor.anchorLeft, top: anchor.anchorTop })) continue;
      if (options.lines?.some((line) => coversLine(positioned, line))) continue;
      if (options.leaderObstacles?.some((point) => leaderCrossesPoint(positioned, point))) continue;
      const targetLeft = preferredSide === "left"
        ? anchor.anchorLeft - width - sideOffset
        : anchor.anchorLeft + sideOffset;
      const distance =
        Math.abs(candidate.left - targetLeft) * 0.05 +
        Math.abs(candidate.top - (anchor.anchorTop - height / 2)) * 0.02;
      if (distance < bestScore) {
        best = positioned;
        bestScore = distance;
      }
    }

    // No collision-free candidate means this label is intentionally omitted.
    if (!best) continue;
    placed.push(best);
    result.set(anchor.id, best);
  }

  return anchors.map((anchor) => result.get(anchor.id)).filter(
    (label): label is PositionedLabel => label !== undefined,
  );
}
