import { describe, expect, it } from "vitest";
import { inferModelBrand, modelBrandColor } from "./brand";

describe("model brand colors", () => {
  it("recognizes common provider families from model names and providers", () => {
    expect(inferModelBrand("Claude Opus", "anthropic")).toBe("anthropic");
    expect(inferModelBrand("GPT-5", "openai")).toBe("openai");
    expect(inferModelBrand("Gemini 3", "google")).toBe("google");
    expect(inferModelBrand("Composer", "cursor")).toBe("cursor");
  });

  it("keeps OpenAI readable in both themes", () => {
    expect(modelBrandColor("openai", false)).toBe("#111111");
    expect(modelBrandColor("openai", true)).toBe("#f8fafc");
  });
});
