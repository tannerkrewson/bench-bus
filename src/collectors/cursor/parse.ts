import { JSDOM } from "jsdom";
import {
  CursorParseError,
  type RawCursorEvalRow,
  type RawCursorSvgPoint,
} from "./types";

/**
 * Parser for the single benchmark table published at https://cursor.com/evals
 * (CursorBench). The page is a fully server-rendered Next.js page: the data
 * lives in (a) an SSR HTML <table> — the authoritative source — and (b) an
 * inline SVG scatter chart whose point groups carry machine-readable
 * aria-labels used here as an independent cross-check.
 *
 * This module is deliberately the ONLY place that knows the page's HTML
 * shape. If Cursor redesigns the page, fixes land here and the failure mode
 * is a loud CursorParseError, never silently dropped rows.
 */

/** Expected column labels in the table header, in order (rank column has no text label). */
const EXPECTED_HEADER_LABELS = ["Model", "Score", "Cost", "Tokens", "Steps"] as const;

/** aria-label suffix that marks an SVG scatter point ("…: 70.8%, $2.81 avg cost per task"). */
const SVG_POINT_LABEL_PATTERN =
  /^(.+?):\s*([0-9]+(?:\.[0-9]+)?)%,\s*\$([0-9]+(?:\.[0-9]+)?)\s+avg cost per task$/;

function parseDisplayNumber(cell: string, context: string): number {
  // Display values look like "70.8%", "$2.81", "41,136", "46".
  const cleaned = cell.replace(/%/g, "").replace(/^\$/, "").replace(/,/g, "").trim();
  if (cleaned.length === 0) {
    throw new CursorParseError(`Empty numeric cell (${context}); table structure may have changed`);
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    throw new CursorParseError(
      `Could not parse numeric cell "${cell}" (${context}); table structure may have changed`,
    );
  }
  return value;
}

function cellText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Locate the benchmark <table> and verify its header still has the expected columns. */
function requireEvalTable(dom: JSDOM): HTMLTableElement {
  const table = dom.window.document.querySelector("table");
  if (!table) {
    throw new CursorParseError("No <table> found on the CursorBench page; structure changed?");
  }
  const headerLabels = Array.from(table.querySelectorAll("thead th")).map((th) => cellText(th));
  // The rank column header is blank; filter it out before comparing.
  const labeled = headerLabels.filter((label) => label.length > 0);
  const matchesExpected =
    labeled.length === EXPECTED_HEADER_LABELS.length &&
    EXPECTED_HEADER_LABELS.every((expected, index) => labeled[index]?.startsWith(expected));
  if (!matchesExpected) {
    throw new CursorParseError(
      `Unexpected CursorBench table header columns: ${JSON.stringify(headerLabels)}; ` +
        `expected ${JSON.stringify(EXPECTED_HEADER_LABELS)}. The page structure changed — ` +
        `update the parser before trusting any output.`,
    );
  }
  return table;
}

/** Parse the SSR benchmark table into raw rows. Throws on any incomplete or malformed row. */
export function parseEvalTable(html: string): RawCursorEvalRow[] {
  const dom = new JSDOM(html);
  const table = requireEvalTable(dom);
  const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
  if (bodyRows.length === 0) {
    throw new CursorParseError("CursorBench table has no body rows; structure changed?");
  }

  return bodyRows.map((row, rowIndex) => {
    const cells = Array.from(row.querySelectorAll("td"));
    if (cells.length !== 6) {
      throw new CursorParseError(
        `Row ${rowIndex} has ${cells.length} cells, expected 6 (rank, model, score, cost, tokens, steps)`,
      );
    }
    const rawCells = cells.map(cellText);
    const rank = parseDisplayNumber(rawCells[0] ?? "", `row ${rowIndex} rank`);
    const modelName = rawCells[1] ?? "";
    if (modelName.length === 0) {
      throw new CursorParseError(`Row ${rowIndex} has an empty model name`);
    }
    return {
      rank,
      modelName,
      scorePercent: parseDisplayNumber(rawCells[2] ?? "", `row ${rowIndex} (${modelName}) score`),
      costPerTaskUsd: parseDisplayNumber(rawCells[3] ?? "", `row ${rowIndex} (${modelName}) cost`),
      tokensPerTask: parseDisplayNumber(rawCells[4] ?? "", `row ${rowIndex} (${modelName}) tokens`),
      stepsPerTask: parseDisplayNumber(rawCells[5] ?? "", `row ${rowIndex} (${modelName}) steps`),
      rawCells,
    };
  });
}

/** Parse the inline CursorBench SVG scatter points from their aria-labels. */
export function parseSvgPoints(html: string): RawCursorSvgPoint[] {
  const dom = new JSDOM(html);
  const groups = Array.from(
    dom.window.document.querySelectorAll("g.cursorbench-chart__point-group[aria-label]"),
  );
  const points: RawCursorSvgPoint[] = [];
  for (const group of groups) {
    const label = group.getAttribute("aria-label") ?? "";
    const match = SVG_POINT_LABEL_PATTERN.exec(label);
    if (!match) {
      throw new CursorParseError(
        `Unparseable CursorBench SVG point aria-label: "${label}". The chart markup changed — ` +
          `update the parser before trusting any output.`,
      );
    }
    points.push({
      modelName: match[1]?.trim() ?? "",
      scorePercent: Number(match[2]),
      costPerTaskUsd: Number(match[3]),
    });
  }
  return points;
}

/**
 * Cross-check every table row against the SVG chart points. The SVG is an
 * independent rendering of the same data; any disagreement means one of the
 * two parsers is wrong, so this fails loudly. Rows without an SVG point are
 * fine (the chart can render a different point set than the table lists).
 */
export function crossCheckTableAgainstSvg(
  rows: RawCursorEvalRow[],
  points: RawCursorSvgPoint[],
): void {
  const byName = new Map<string, RawCursorSvgPoint>();
  for (const point of points) {
    if (!byName.has(point.modelName)) {
      byName.set(point.modelName, point);
    }
  }
  const EPSILON = 1e-9;
  for (const row of rows) {
    const point = byName.get(row.modelName);
    if (!point) {
      continue;
    }
    if (Math.abs(point.scorePercent - row.scorePercent) > EPSILON) {
      throw new CursorParseError(
        `Score mismatch for "${row.modelName}": table says ${row.scorePercent}, ` +
          `SVG chart says ${point.scorePercent}`,
      );
    }
    if (Math.abs(point.costPerTaskUsd - row.costPerTaskUsd) > EPSILON) {
      throw new CursorParseError(
        `Cost mismatch for "${row.modelName}": table says $${row.costPerTaskUsd}, ` +
          `SVG chart says $${point.costPerTaskUsd}`,
      );
    }
  }
}

export interface ParsedCursorEvalsPage {
  rows: RawCursorEvalRow[];
  svgPoints: RawCursorSvgPoint[];
}

/** Parse and cross-check a full CursorBench page. Throws CursorParseError on any structural change. */
export function parseCursorEvalsPage(html: string): ParsedCursorEvalsPage {
  const rows = parseEvalTable(html);
  const svgPoints = parseSvgPoints(html);
  crossCheckTableAgainstSvg(rows, svgPoints);
  return { rows, svgPoints };
}
