import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  crossCheckTableAgainstSvg,
  parseCursorEvalsPage,
  parseEvalTable,
  parseSvgPoints,
} from "./parse";
import { CursorParseError } from "./types";

const FIXTURE_PATH = new URL("./fixtures/cursor-evals-trimmed.html", import.meta.url);
const fixtureHtml = readFileSync(FIXTURE_PATH, "utf8");

describe("parseEvalTable", () => {
  it("parses every row of the representative live-page fixture", () => {
    const rows = parseEvalTable(fixtureHtml);
    expect(rows).toHaveLength(56);

    const first = rows[0];
    expect(first?.modelName).toBe("Grok 4.6 Extra High");
    expect(first?.rank).toBe(1);
    expect(first?.scorePercent).toBe(70.8);
    expect(first?.costPerTaskUsd).toBe(2.81);
    expect(first?.tokensPerTask).toBe(41_136);
    expect(first?.stepsPerTask).toBe(46);

    const last = rows[rows.length - 1];
    expect(last?.modelName).toBe("GPT-5.6 Luna Low");
    expect(last?.scorePercent).toBe(37.6);
    expect(last?.costPerTaskUsd).toBe(0.03);
    expect(last?.tokensPerTask).toBe(3_209);
    expect(last?.stepsPerTask).toBe(17);
  });

  it("keeps raw cell strings alongside parsed numbers (raw vs derived separation)", () => {
    const rows = parseEvalTable(fixtureHtml);
    expect(rows[0]?.rawCells).toEqual(["1", "Grok 4.6 Extra High", "70.8%", "$2.81", "41,136", "46"]);
  });

  it("parses deterministically (identical output across runs)", () => {
    expect(parseEvalTable(fixtureHtml)).toEqual(parseEvalTable(fixtureHtml));
  });

  it("handles thousands separators and currency formatting in display values", () => {
    const rows = parseEvalTable(fixtureHtml);
    const fable = rows.find((row) => row.modelName === "Fable 5 Max");
    expect(fable?.costPerTaskUsd).toBe(17.32);
    expect(fable?.tokensPerTask).toBe(103_525);
  });

  it("fails loudly when the table is missing entirely", () => {
    expect(() => parseEvalTable("<html><body><p>redesign</p></body></html>")).toThrow(
      CursorParseError,
    );
  });

  it("fails loudly when the header columns change", () => {
    const changed = fixtureHtml.replace(
      "<span class=\"font-normal tracking-[0.12em] uppercase\">Model</span>",
      "<span class=\"font-normal tracking-[0.12em] uppercase\">System</span>",
    );
    expect(() => parseEvalTable(changed)).toThrow(/Unexpected CursorBench table header/);
  });

  it("fails loudly when a row has the wrong cell count", () => {
    const changed = fixtureHtml.replace("<td class=\"py-v3/12 md:py-v4/12 pl-v3/12 md:pl-v4/12 type-xs md:type-sm text-theme-text-sec align-middle tabular-nums\">1</td>", "");
    expect(() => parseEvalTable(changed)).toThrow(/has 5 cells, expected 6/);
  });

  it("fails loudly when a numeric cell is empty or unparseable", () => {
    const changed = fixtureHtml.replace(">70.8<!-- -->%", "><span></span>%");
    expect(() => parseEvalTable(changed)).toThrow(CursorParseError);
  });
});

describe("parseSvgPoints", () => {
  it("parses machine-readable aria-labels from the inline chart", () => {
    const points = parseSvgPoints(fixtureHtml);
    expect(points.length).toBeGreaterThanOrEqual(5);
    const grok = points.find((point) => point.modelName === "Grok 4.6 Extra High");
    expect(grok?.scorePercent).toBe(70.8);
    expect(grok?.costPerTaskUsd).toBe(2.81);
  });

  it("fails loudly when an aria-label no longer matches the known format", () => {
    const changed = fixtureHtml.replace(
      "aria-label=\"Grok 4.6 Extra High: 70.8%, $2.81 avg cost per task\"",
      "aria-label=\"Grok 4.6 Extra High\"",
    );
    expect(() => parseSvgPoints(changed)).toThrow(/Unparseable CursorBench SVG point aria-label/);
  });
});

describe("crossCheckTableAgainstSvg", () => {
  it("accepts the fixture: table and SVG agree on shared rows", () => {
    const { rows, svgPoints } = parseCursorEvalsPage(fixtureHtml);
    expect(() => crossCheckTableAgainstSvg(rows, svgPoints)).not.toThrow();
  });

  it("fails loudly on a score disagreement between table and SVG", () => {
    const { rows, svgPoints } = parseCursorEvalsPage(fixtureHtml);
    const tampered = svgPoints.map((point) =>
      point.modelName === "Grok 4.6 Extra High" ? { ...point, scorePercent: 99.9 } : point,
    );
    expect(() => crossCheckTableAgainstSvg(rows, tampered)).toThrow(/Score mismatch/);
  });

  it("fails loudly on a cost disagreement between table and SVG", () => {
    const { rows, svgPoints } = parseCursorEvalsPage(fixtureHtml);
    const tampered = svgPoints.map((point) =>
      point.modelName === "Composer 2.5" ? { ...point, costPerTaskUsd: 0.01 } : point,
    );
    expect(() => crossCheckTableAgainstSvg(rows, tampered)).toThrow(/Cost mismatch/);
  });

  it("tolerates table rows that have no SVG point", () => {
    const rows = parseEvalTable(fixtureHtml);
    expect(() => crossCheckTableAgainstSvg(rows, [])).not.toThrow();
  });
});
