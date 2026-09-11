import { describe, expect, it } from "vitest";
import curatedConfig from "./curated-models.json";
import { parseCuratedModelConfig } from "./curated";

describe("curated model config", () => {
  it("validates the committed forced DeepSeek models", () => {
    const config = parseCuratedModelConfig(JSON.stringify(curatedConfig));
    expect(config.models).toEqual(expect.arrayContaining([expect.objectContaining({
      aaModelSlug: "deepseek-v4-flash",
      openrouterId: "deepseek/deepseek-v4-flash-0731",
    }), expect.objectContaining({
      aaModelSlug: "deepseek-v4-1-flash",
      openrouterId: "deepseek/deepseek-v4.1-flash",
    })]));
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
