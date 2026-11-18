/**
 * Artificial Analysis evaluations the AA chart can plot instead of the
 * Intelligence Index.
 *
 * `id` is the score field AA publishes on every model record of its model
 * pages, so the AA collector reads these with the Intelligence Index and no
 * extra source is needed. The list holds the current evaluations that AA
 * scores across the whole model set; each was checked against the
 * leaderboard leader on its AA evaluation page (2026-11-18).
 *
 * `rate` scores are published as 0-1 pass rates and plotted as percentages;
 * `index` scores are published in their own points (AA-Omniscience runs from
 * -100 to 100). Add an entry here to offer another evaluation.
 */
export const AA_EVALUATIONS = [
  { id: "frontierCode20", label: "FrontierCode-AA 2.0", unit: "rate", page: "frontiercode-2-0" },
  { id: "terminalBench40", label: "Terminal-Bench 4.0", unit: "rate", page: "terminalbench-4-0" },
  { id: "terminalBenchScience", label: "Terminal-Bench-Science", unit: "rate", page: "terminal-bench-science" },
  { id: "automationBenchPartialScore", label: "AutomationBench-AA", unit: "rate", page: "automationbench-aa" },
  { id: "hleDiamond", label: "HLE-Diamond", unit: "rate", page: "hle-diamond" },
  { id: "gdpPdfAllPass", label: "GDP.pdf All-pass", unit: "rate", page: "gdp-pdf" },
  { id: "mlcrOverall", label: "MLCR-AA", unit: "rate", page: "mlcr-aa" },
  { id: "omniscience", label: "AA-Omniscience", unit: "index", page: "omniscience" },
] as const;

export type AaEvaluation = (typeof AA_EVALUATIONS)[number];
export type AaEvaluationId = AaEvaluation["id"];

export const AA_EVALUATION_IDS = AA_EVALUATIONS.map((evaluation) => evaluation.id) as [
  AaEvaluationId,
  ...AaEvaluationId[],
];

/** Scores keyed by evaluation; an evaluation AA has not run is absent. */
export type AaEvaluationScores = Partial<Record<AaEvaluationId, number>>;

export function aaEvaluationPageUrl(evaluation: AaEvaluation): string {
  return `https://artificialanalysis.ai/evaluations/${evaluation.page}`;
}
