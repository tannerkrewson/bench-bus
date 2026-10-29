import { describe, expect, it } from "vitest";
import { cursorModelReleaseId, cursorTokenRateExemption, isCursorFirstPartyModel } from "./policy";
import { deriveIsThirdParty, deriveProvider } from "./normalize";

describe("Cursor's published Token Rate policy (2026-10-29)", () => {
  it.each(["haiku-5-5", "gpt-5-6-luna", "gemini-3-8-flash", "glm-5-3-flash",
    "gemini-2-5-flash", "gemini-3-flash", "gemini-3-1-flash-lite", "gemini-3-5-flash-lite",
    "gemini-3-7-flash", "gpt-4-1-nano", "gpt-4o-mini", "gpt-5-mini",
    "gpt-5-1-codex-mini", "gpt-5-4-mini", "gpt-5-4-nano"])("exempts exact listed release %s and its effort variants", (id) => {
    for (const effort of ["", "-low", "-medium", "-high", "-extra-high", "-max"]) {
      expect(cursorTokenRateExemption(id + effort)).toBe("excluded-model");
    }
  });

  it("distinguishes a third-party exclusion from a Cursor model", () => {
    expect(deriveIsThirdParty("Haiku 5.5 High")).toBe(true);
    expect(deriveProvider("Haiku 5.5 High")).toBe("anthropic");
    expect(cursorTokenRateExemption("haiku-5-5-high")).toBe("excluded-model");
    for (const name of ["Grok 4.5", "Grok 4.6 High", "Grok 4.7 Extra High", "Composer 2.5"]) {
      expect(deriveIsThirdParty(name)).toBe(false);
      expect(isCursorFirstPartyModel(name)).toBe(true);
    }
  });

  it("does not grant exemptions to arbitrary future releases or nearby names", () => {
    for (const id of ["haiku-5-6-high", "haiku-5-5-pro-high", "gpt-6-luna-low",
      "grok-5-high", "glm-5-3-high", "gemini-4-argon-high", "unknown-model"]) {
      expect(cursorTokenRateExemption(id)).toBeNull();
    }
    expect(cursorModelReleaseId("Claude Haiku 5.5 Extra High")).toBe("haiku-5-5");
  });
});
