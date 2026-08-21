import { describe, expect, it } from "vitest";
import { effortGroupColor, inferModelBrand, modelBrandColor } from "./brand";

describe("model brand colors", () => {
  it("recognizes common provider families from model names and providers", () => {
    expect(inferModelBrand("Claude Opus", "anthropic")).toBe("anthropic");
    expect(inferModelBrand("GPT-5", "openai")).toBe("openai");
    expect(inferModelBrand("Gemini 3", "google")).toBe("google");
    expect(inferModelBrand("Composer", "cursor")).toBe("cursor");
  });

  it("assigns stable non-provider colors to effort groups", () => {
    expect(effortGroupColor("opus", false)).toBe(effortGroupColor("opus", false));
    expect(effortGroupColor("opus", false)).not.toBe(effortGroupColor("sonnet", false));
  });

  it("keeps OpenAI readable in both themes", () => {
    expect(modelBrandColor("openai", false)).toBe("#111111");
    expect(modelBrandColor("openai", true)).toBe("#f8fafc");
  });
});
