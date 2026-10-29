import { describe, expect, it } from "vitest";
import curatedConfig from "./curated-models.json";
import { parseCuratedModelConfig } from "./curated";

describe("curated model config", () => {
  it("validates only the current V5-scored forced DeepSeek release", () => {
    const config = parseCuratedModelConfig(JSON.stringify(curatedConfig));
    expect(config.models).toHaveLength(1);
    expect(config.models[0]).toMatchObject({
      aaModelSlug: "deepseek-v4-1-flash-1017",
      openrouterId: "deepseek/deepseek-v4.1-flash-1017",
    });
  });

  it("rejects duplicate forced identities", () => {
    expect(() => parseCuratedModelConfig(JSON.stringify({
      version: 1,
      models: [
        { aaModelSlug: "same", aaModelId: "one", openrouterId: "vendor/one" },
        { aaModelSlug: "same", aaModelId: "two", openrouterId: "vendor/two" },
      ],
    }))).toThrow(/duplicate/);
  });
});
