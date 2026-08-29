import { describe, expect, it } from "vitest";
import leaderboardFixture from "./fixtures/leaderboard-live.json";
import { collectFromLeaderboard, collectDeepSwe } from "./collect";
import { DEEPSWE_LEADERBOARD_URL, rawDeepSweLeaderboardSchema } from "./api";

const OBSERVED_AT = "2026-08-29T12:00:00.000Z";

describe("DeepSWE collector", () => {
  it("normalizes the captured leaderboard and preserves source provenance", () => {
    const raw = rawDeepSweLeaderboardSchema.parse(leaderboardFixture);
    const payload = collectFromLeaderboard(raw, OBSERVED_AT);

    expect(payload.observedAt).toBe(OBSERVED_AT);
    expect(payload.source).toMatchObject({
      source: "deepswe",
      endpointUrl: DEEPSWE_LEADERBOARD_URL,
      generatedAt: "2026-06-20T17:27:24.307Z",
      nTasksInSet: 113,
    });
    expect(payload.records.map((record) => record.model)).toEqual([
      "deepseek-v4-pro",
      "glm-5-2",
      "mimo-v2-5-pro",
      "qwen3-7-max",
    ]);
    expect(payload.records.find((record) => record.model === "glm-5-2")).toMatchObject({
      reasoningEffort: "max",
      passAt1: 0.41517857142857145,
    });
  });

  it("fetches and validates the live response through the shared retry path", async () => {
    const response = new Response(JSON.stringify(leaderboardFixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const { payload } = await collectDeepSwe({
      fetchImpl: (async (input) => {
        expect(String(input)).toBe(DEEPSWE_LEADERBOARD_URL);
        return response;
      }) as typeof fetch,
      now: () => new Date(OBSERVED_AT),
      retries: 0,
    });
    expect(payload.observedAt).toBe(OBSERVED_AT);
    expect(payload.records).toHaveLength(4);
  });
});
