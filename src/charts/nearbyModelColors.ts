import { COLOR_BLIND_MODEL_GROUP_PALETTE, modelGroupColor } from "./brand";
import { modelGroupKey } from "./modelMetadata";
import type { PlottablePoint, XScale } from "./types";

const { light, dark } = COLOR_BLIND_MODEL_GROUP_PALETTE;

// Convert the palette to OKLab so a distance reflects perceived contrast
// better than differences between encoded RGB channels.
function toOklab(hex: string): readonly [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

const distance = (a: readonly [number, number, number], b: readonly [number, number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lightLab = light.map(toOklab);
const darkLab = dark.map(toOklab);
const separation = lightLab.map((a, i) => lightLab.map((b, j) =>
  Math.min(distance(a, b), distance(darkLab[i]!, darkLab[j]!)),
));
const neighborhoodRadius = 0.15;
const desiredSeparation = 0.17;

/**
 * Start with the usual family colors, giving nearby families first choice of
 * slots. Prefer separating neighbors over preserving a preferred color.
 * Fractions of the plot range approximate the chart's screen geometry and
 * keep the result stable across resizes. Both themes share the same slots.
 */
export function nearbyModelColorSlots(
  points: readonly PlottablePoint[],
  scale: XScale,
): ReadonlyMap<string, number> {
  const positions = points
    .filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && (scale !== "log" || x > 0))
    .map((point) => ({
      key: point.effortGroup ?? modelGroupKey(point.label, point.id),
      x: scale === "log" ? Math.log(point.x) : point.x,
      y: point.y,
    })).sort((a, b) => a.key.localeCompare(b.key) || a.x - b.x || a.y - b.y);
  if (positions.length === 0) return new Map();
  const xs = positions.map(({ x }) => x);
  const ys = positions.map(({ y }) => y);
  const xSpan = Math.max(...xs) - Math.min(...xs) || 1;
  const ySpan = Math.max(...ys) - Math.min(...ys) || 1;
  const neighbors = new Map(positions.map(({ key }) => [key, new Map<string, number>()]));
  for (const [index, a] of positions.entries()) {
    for (let i = index + 1; i < positions.length; i += 1) {
      const b = positions[i]!;
      if (a.key === b.key) continue;
      const relativeDistance = Math.hypot(1.5 * (a.x - b.x) / xSpan, (a.y - b.y) / ySpan);
      const weight = 1 - relativeDistance / neighborhoodRadius;
      if (weight <= (neighbors.get(a.key)!.get(b.key) ?? 0)) continue;
      neighbors.get(a.key)!.set(b.key, weight);
      neighbors.get(b.key)!.set(a.key, weight);
    }
  }

  const crowding = new Map([...neighbors].map(([key, nearby]) =>
    [key, [...nearby.values()].reduce((sum, weight) => sum + weight, 0)],
  ));
  const keys = [...neighbors.keys()].sort((a, b) =>
    crowding.get(b)! - crowding.get(a)! || a.localeCompare(b),
  );
  const assignments = new Map<string, number>();
  const unused = new Set(light.map((_, index) => index));
  for (const key of keys) {
    const preferred = light.findIndex((color) => color === modelGroupColor(key, false));
    const candidates = unused.size > 0 ? [...unused] : light.map((_, index) => index);
    const cost = (slot: number) => {
      let penalty = slot === preferred ? 0 : 0.005;
      for (const [other, weight] of neighbors.get(key)!) {
        const assigned = assignments.get(other);
        if (assigned !== undefined) {
          penalty += weight * Math.max(0, desiredSeparation - separation[slot]![assigned]!);
        }
      }
      return penalty;
    };
    const chosen = candidates.reduce((best, slot) => cost(slot) < cost(best) ? slot : best);
    unused.delete(chosen);
    assignments.set(key, chosen);
  }
  return assignments;
}

export function nearbyModelColor(slots: ReadonlyMap<string, number>, groupKey: string, isDark: boolean): string | undefined {
  const slot = slots.get(groupKey.replace(/^effort:/, ""));
  return slot === undefined ? undefined : (isDark ? dark : light)[slot];
}
