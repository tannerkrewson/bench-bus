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
  /** Reserved overlay regions, in the same coordinate space as the bounds. */
  excludedRegions?: readonly LabelLayoutBounds[];
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
export const LABEL_MAIN_FONT_SIZE = 13;
export const LABEL_DISCOUNT_FONT_SIZE = 10;
export const LABEL_HORIZONTAL_PADDING = 8;
const LABEL_FONT_FAMILY = '"Sora Variable", Sora, ui-sans-serif, system-ui, sans-serif';
const LABEL_FONT_WEIGHT = 400;
// Conservative SSR/jsdom fallback for the rendered 13px label. Browser
// layout uses the actual canvas metric when the real font is available.
const LABEL_FONT_WIDTH = 7.6;
const EFFORT_SUFFIX = /^(.*?)\s+(xhigh|extra\s+high|low|medium|high|max)$/i;

export type LabelTextMeasurer = (text: string, fontSize: number) => number;

/** Deterministic text metric fallback used when canvas measurement is unavailable. */
export function fallbackLabelTextWidth(text: string, fontSize: number): number {
  return text.length * LABEL_FONT_WIDTH * fontSize / LABEL_MAIN_FONT_SIZE;
}

let labelCanvasContext: CanvasRenderingContext2D | null | undefined;

function browserLabelTextWidth(text: string, fontSize: number): number {
  const fallback = fallbackLabelTextWidth(text, fontSize);
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    /jsdom/i.test(window.navigator.userAgent)
  ) return fallback;

  if (labelCanvasContext === undefined) {
    try {
      labelCanvasContext = document.createElement("canvas").getContext("2d");
    } catch {
      labelCanvasContext = null;
    }
  }
  if (!labelCanvasContext) return fallback;

  try {
    labelCanvasContext.font = `${LABEL_FONT_WEIGHT} ${fontSize}px ${LABEL_FONT_FAMILY}`;
    const measured = labelCanvasContext.measureText(text).width;
    return Number.isFinite(measured) && measured >= 0 ? measured : fallback;
  } catch {
    return fallback;
  }
}

/** Measure the visual text, keeping the smaller discount suffix typography separate. */
export function labelTextWidth(
  anchor: Pick<LabelLayoutAnchor, "label" | "mainLabel" | "discountLabel">,
  measureText: LabelTextMeasurer = browserLabelTextWidth,
): number {
  const mainLabel = anchor.mainLabel ?? anchor.label;
  const mainWidth = measureText(mainLabel, LABEL_MAIN_FONT_SIZE);
  if (!anchor.discountLabel) return mainWidth;
  return mainWidth +
    measureText(" ", LABEL_MAIN_FONT_SIZE) +
    measureText(anchor.discountLabel, LABEL_DISCOUNT_FONT_SIZE);
}

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

function labelWidth(anchor: LabelLayoutAnchor, bounds: LabelLayoutBounds): number | null {
  const available = Math.max(1, bounds.right - bounds.left);
  // Keep enough room for the larger label font and padding. A label wider than
  // the plot can never be shown in full, so omit it instead of clipping it.
  const intrinsic = Math.ceil(labelTextWidth(anchor) + LABEL_HORIZONTAL_PADDING);
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

function overlapsRegion(label: PositionedLabel, region: LabelLayoutBounds): boolean {
  return (
    label.left < region.right + LABEL_GAP &&
    label.left + label.width + LABEL_GAP > region.left &&
    label.top < region.bottom + LABEL_GAP &&
    label.top + label.height + LABEL_GAP > region.top
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

/** Return the leader segment using the same endpoint as the SVG renderer. */
export function labelLeaderSegment(label: PositionedLabel): LabelLayoutLine {
  const endpoint = labelLeaderEndpoint(label);
  return {
    left1: label.anchorLeft,
    top1: label.anchorTop,
    left2: endpoint.left,
    top2: endpoint.top,
  };
}

/** Test a finite segment against a padded rectangle using Liang-Barsky clipping. */
function segmentIntersectsLabel(segment: LabelLayoutLine, label: PositionedLabel): boolean {
  if (![
    segment.left1,
    segment.top1,
    segment.left2,
    segment.top2,
    label.left,
    label.top,
    label.width,
    label.height,
  ].every(Number.isFinite)) return false;
  const padding = LABEL_GAP;
  const left = label.left - padding;
  const right = label.left + label.width + padding;
  const top = label.top - padding;
  const bottom = label.top + label.height + padding;
  const dx = segment.left2 - segment.left1;
  const dy = segment.top2 - segment.top1;
  let near = 0;
  let far = 1;
  const constraints: readonly [number, number][] = [
    [-dx, segment.left1 - left],
    [dx, right - segment.left1],
    [-dy, segment.top1 - top],
    [dy, bottom - segment.top1],
  ];

  for (const [coefficient, distance] of constraints) {
    if (coefficient === 0) {
      if (distance < 0) return false;
      continue;
    }
    const progress = distance / coefficient;
    if (coefficient < 0) near = Math.max(near, progress);
    else far = Math.min(far, progress);
    if (near > far) return false;
  }
  return true;
}

/** Whether a label's leader would cross another label's text box. */
export function labelLeaderCrossesLabel(label: PositionedLabel, other: PositionedLabel): boolean {
  return label.id !== other.id && segmentIntersectsLabel(labelLeaderSegment(label), other);
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
  const segment = labelLeaderSegment(label);
  return distanceToSegment(
    point,
    { left: segment.left1, top: segment.top1 },
    { left: segment.left2, top: segment.top2 },
  ) < (point.radius ?? LABEL_DOT_RADIUS);
}

/** Proper crossing only: a shared endpoint, such as a leader's own dot, does not count. */
function segmentsCross(a: LabelLayoutLine, b: LabelLayoutLine): boolean {
  const side = (line: LabelLayoutLine, left: number, top: number) =>
    (line.left2 - line.left1) * (top - line.top1) - (line.top2 - line.top1) * (left - line.left1);
  return side(a, b.left1, b.top1) * side(a, b.left2, b.top2) < 0 &&
    side(b, a.left1, a.top1) * side(b, a.left2, a.top2) < 0;
}

/**
 * Soft placement cost in pixels of leader length. Any cost at or above
 * LEADER_CONFLICT_COST means the leader runs through a dot or another label,
 * or crosses another leader, so a compact label retry is worth attempting.
 */
const LEADER_CONFLICT_COST = 400;
const LEADER_LINE_CROSSING_COST = 80;
const NON_PREFERRED_SIDE_COST = 2;
const MAX_REFINEMENT_PASSES = 4;

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
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) ||
      a.anchorTop - b.anchorTop ||
      a.anchorLeft - b.anchorLeft ||
      a.id.localeCompare(b.id),
  );
  const placed = new Map<string, { label: PositionedLabel; cost: number }>();
  const sideOffset = LABEL_DOT_RADIUS + LABEL_GAP;

  const leaderCost = (label: PositionedLabel, others: readonly PositionedLabel[]): number => {
    const leader = labelLeaderSegment(label);
    // Any label beside its dot is close enough; don't reward crowding the dot.
    let cost = Math.max(sideOffset, Math.hypot(leader.left2 - leader.left1, leader.top2 - leader.top1));
    if (options.leaderObstacles?.some((point) => leaderCrossesPoint(label, point))) cost += LEADER_CONFLICT_COST;
    for (const other of others) {
      if (labelLeaderCrossesLabel(label, other) || labelLeaderCrossesLabel(other, label)) cost += LEADER_CONFLICT_COST;
      if (segmentsCross(leader, labelLeaderSegment(other))) cost += LEADER_CONFLICT_COST;
    }
    for (const line of options.lines ?? []) {
      if (segmentsCross(leader, line)) cost += LEADER_LINE_CROSSING_COST;
    }
    return cost;
  };

  const placeAnchor = (
    anchor: LabelLayoutAnchor,
    others: readonly PositionedLabel[],
  ): { label: PositionedLabel; cost: number } | undefined => {
    let best: { label: PositionedLabel; cost: number } | undefined;
    // A discount suffix is useful context, but it should not make the model
    // name disappear entirely when the plot is crowded. Retry compactly while
    // retaining accessibleLabel/title with the complete discount text.
    const layoutAnchors = anchor.discountLabel
      ? [
          anchor,
          { ...anchor, label: anchor.mainLabel ?? anchor.label, discountLabel: undefined },
        ]
      : [anchor];
    for (const layoutAnchor of layoutAnchors) {
      const width = labelWidth(layoutAnchor, bounds);
      if (width === null) continue;
      const height = LABEL_HEIGHT;
      const minLeft = bounds.left;
      const maxLeft = Math.max(minLeft, bounds.right - width);
      const minTop = bounds.top;
      const maxTop = Math.max(minTop, bounds.bottom - height);
      // Keep labels on the open left side of the solid model line by default;
      // callers can still override this for a specific crowded label.
      const preferredSide = options.preferredSides?.get(layoutAnchor.id) ?? "left";
      const sides: ("left" | "right" | "center")[] = preferredSide === "left"
        ? ["left", "right", "center"]
        : ["right", "left", "center"];
      const rowStep = height + LABEL_GAP;
      const candidates: { left: number; top: number; side: "left" | "right" | "center" }[] = [];
      const addCandidate = (side: "left" | "right" | "center", horizontalShift: number, verticalOffset: number) => {
        const horizontalOffset = side === "left"
          ? -width - sideOffset
          : side === "right" ? sideOffset : -width / 2;
        candidates.push({
          left: clamp(layoutAnchor.anchorLeft + horizontalOffset + horizontalShift, minLeft, maxLeft),
          top: clamp(layoutAnchor.anchorTop - height / 2 + verticalOffset, minTop, maxTop),
          side,
        });
      };
      // Search outward so a nearby gap in any direction beats a far-away row
      // directly beside the dot. The vertical sweep is a last resort for
      // crowded clusters and remains bounded by the plot.
      for (const side of sides) {
        for (let row = -5; row <= 5; row += 1) {
          for (let shift = -3; shift <= 3; shift += 1) {
            if (side === "left" && shift > 0) continue;
            if (side === "right" && shift < 0) continue;
            if (side === "center" && shift !== 0) continue;
            addCandidate(side, shift * 32, row * rowStep);
          }
        }
      }
      const verticalRange = bounds.bottom - bounds.top;
      for (const side of sides) {
        for (let verticalOffset = -verticalRange; verticalOffset <= verticalRange; verticalOffset += 18) {
          addCandidate(side, 0, verticalOffset);
        }
      }

      const seen = new Set<string>();
      for (const candidate of candidates) {
        const key = `${candidate.left}:${candidate.top}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const positioned: PositionedLabel = {
          ...layoutAnchor,
          left: candidate.left,
          top: candidate.top,
          width,
          height,
        };
        if (options.excludedRegions?.some((region) => overlapsRegion(positioned, region))) continue;
        if (others.some((existing) => overlaps(positioned, existing))) continue;
        if (obstacles.some((point) => point.id !== layoutAnchor.id && coversPoint(positioned, point))) continue;
        if (coversPoint(positioned, { id: layoutAnchor.id, left: layoutAnchor.anchorLeft, top: layoutAnchor.anchorTop })) continue;
        if (options.lines?.some((line) => segmentIntersectsLabel(line, positioned))) continue;
        const cost = leaderCost(positioned, others) +
          (candidate.side === preferredSide ? 0 : NON_PREFERRED_SIDE_COST);
        if (!best || cost < best.cost) best = { label: positioned, cost };
      }
      // Prefer the full label unless every placement has a real leader
      // conflict. Labels stay visible in dense plots even then, because the
      // model name is more useful than silently omitting a crowded point.
      if (best && best.cost < LEADER_CONFLICT_COST) break;
    }
    return best;
  };

  // Greedy placement depends on order: an early label cannot see the labels
  // placed after it. Re-seat each label against all the others until stable.
  for (let pass = 0; pass < MAX_REFINEMENT_PASSES; pass += 1) {
    let changed = false;
    for (const anchor of sorted) {
      const current = placed.get(anchor.id);
      const others = [...placed.values()].filter(({ label }) => label.id !== anchor.id).map(({ label }) => label);
      const next = placeAnchor(anchor, others);
      const currentCost = current ? leaderCost(current.label, others) : Infinity;
      if (next && next.cost < currentCost - 0.5) {
        placed.set(anchor.id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return anchors.flatMap((anchor) => {
    const entry = placed.get(anchor.id);
    return entry ? [entry.label] : [];
  });
}
