import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cursorEvalIdentityKey, validateCursorEvalCollection } from "../../schemas";
import { buildSnapshotPayload, cursorModelId, deriveIsThirdParty, deriveProvider, toCanonicalRecords } from "./normalize";
import { parseEvalTable } from "./parse";

const fixtureHtml = readFileSync(
  new URL("./fixtures/cursor-evals-trimmed.html", import.meta.url),
  "utf8",
);

describe("identity and classification heuristics", () => {
  it("derives deterministic model ids from published names", () => {
    expect(cursorModelId("Grok 4.6 Extra High")).toBe("grok-4-6-extra-high");
    expect(cursorModelId("GPT-5.6 Luna Low")).toBe("gpt-5-6-luna-low");
    expect(cursorModelId("Composer 2.5")).toBe("composer-2-5");
    expect(cursorModelId("Opus 5 Max")).toBe(cursorModelId("Opus 5 Max"));
  });

  it("classifies Cursor first-party models as not third-party", () => {
    expect(deriveIsThirdParty("Composer 2.5")).toBe(false);
  });

  it("classifies external vendor models as third-party (surcharge-eligible)", () => {
    expect(deriveIsThirdParty("Grok 4.6 Extra High")).toBe(true);
    expect(deriveIsThirdParty("Opus 5 Max")).toBe(true);
    expect(deriveIsThirdParty("GPT-5.6 Luna Low")).toBe(true);
    expect(deriveIsThirdParty("Gemini 3.7 Flash High")).toBe(true);
  });

  it("maps model families to serving providers without guessing unknowns", () => {
    expect(deriveProvider("Grok 4.6 Extra High")).toBe("xai");
    expect(deriveProvider("GPT-5.6 Luna Low")).toBe("openai");
    expect(deriveProvider("Opus 5 Max")).toBe("anthropic");
    expect(deriveProvider("Sonnet 5 High")).toBe("anthropic");
    expect(deriveProvider("Gemini 3.7 Flash High")).toBe("google");
    expect(deriveProvider("Kimi K3 Max")).toBe("moonshot");
    expect(deriveProvider("GLM 5.2 High")).toBe("zai");
    expect(deriveProvider("Composer 2.5")).toBe("cursor");
    expect(deriveProvider("Mystery Model 9")).toBe("unknown");
  });
});

describe("toCanonicalRecords", () => {
  const records = toCanonicalRecords(parseEvalTable(fixtureHtml));

  it("produces one canonical record per table row, validated by the shared schema", () => {
    expect(records).toHaveLength(56);
    expect(() => validateCursorEvalCollection(records)).not.toThrow();
  });

  it("sorts by modelId for deterministic serialization", () => {
    const ids = records.map((record) => cursorEvalIdentityKey(record));
    expect([...ids].sort((a, b) => a.localeCompare(b))).toEqual(ids);
  });

  it("keeps published aggregate cost in publishedCostUsd and never invents input/output splits", () => {
    const grok = records.find((record) => record.modelName === "Grok 4.6 Extra High");
    expect(grok?.publishedCostUsd).toBe(2.81);
    expect(grok?.inputTokens).toBeUndefined();
    expect(grok?.outputTokens).toBeUndefined();
  });

  it("preserves display-rounded scores exactly as published", () => {
    const luna = records.find((record) => record.modelName === "GPT-5.6 Luna Low");
    expect(luna?.score).toBe(37.6);
  });

  it("is deterministic for identical input", () => {
    expect(toCanonicalRecords(parseEvalTable(fixtureHtml))).toEqual(records);
  });
});

describe("buildSnapshotPayload", () => {
  const OBSERVED_AT = "2026-08-21T03:04:05Z";

  it("wraps records with observedAt and source metadata that passes the snapshot schema", () => {
    const payload = buildSnapshotPayload(parseEvalTable(fixtureHtml), OBSERVED_AT);
    expect(payload.observedAt).toBe(OBSERVED_AT);
    expect(payload.source).toEqual({ source: "cursor", pageUrl: "https://cursor.com/evals" });
    expect(payload.records).toHaveLength(56);
  });

  it("serializes deterministically for identical input and observedAt", () => {
    const rows = parseEvalTable(fixtureHtml);
    const first = JSON.stringify(buildSnapshotPayload(rows, OBSERVED_AT));
    const second = JSON.stringify(buildSnapshotPayload(parseEvalTable(fixtureHtml), OBSERVED_AT));
    expect(first).toBe(second);
  });

  it("rejects an invalid observedAt", () => {
    expect(() => buildSnapshotPayload(parseEvalTable(fixtureHtml), "not-a-timestamp")).toThrow();
  });
});
