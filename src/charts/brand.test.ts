import { describe, expect, it } from "vitest";
import {
  COLOR_BLIND_CONTRAST_TARGET,
  COLOR_BLIND_MODEL_GROUP_PALETTE,
  COLOR_BLIND_SURFACE_SWATCHES,
  effortGroupColor,
  inferModelBrand,
  modelBrandColor,
  modelGroupColor,
  modelGroupColors,
} from "./brand";

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("model brand colors", () => {
  it("recognizes common provider families from model names and providers", () => {
    expect(inferModelBrand("Claude Opus", "anthropic")).toBe("anthropic");
    expect(inferModelBrand("GPT-5", "openai")).toBe("openai");
    expect(inferModelBrand("Gemini 3", "google")).toBe("google");
    expect(inferModelBrand("Composer", "cursor")).toBe("cursor");
    expect(inferModelBrand("Muse Spark 1.2", "muse-spark-1-2")).toBe("meta");
  });

  it("assigns stable non-provider colors to effort groups", () => {
    expect(effortGroupColor("opus", false)).toBe(effortGroupColor("opus", false));
    expect(effortGroupColor("opus", false)).not.toBe(effortGroupColor("sonnet", false));
  });

  it("keeps general family slots stable while preferred families share reserved colors", () => {
    const familyKeys = [
      "opus-5",
      "sonnet-5",
      "grok-4-6",
      "luna",
      "sol",
      "terra",
      "fable-5",
      "composer-2-5",
      "opus-4-8",
      "deepseek-v4-flash-0731",
      "gemini-3-7-flash",
    ];
    const lightColors = familyKeys.map((key) => modelGroupColor(key, false));
    const darkColors = familyKeys.map((key) => modelGroupColor(key, true));

    expect(lightColors).toEqual([
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[1],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[8],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[2],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[3],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[6],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[4],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[9],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[7],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[1],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[0],
      COLOR_BLIND_MODEL_GROUP_PALETTE.light[10],
    ]);
    expect(darkColors).toEqual([
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[1],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[8],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[2],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[3],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[6],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[4],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[9],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[7],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[1],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[0],
      COLOR_BLIND_MODEL_GROUP_PALETTE.dark[10],
    ]);
  });

  it("keeps adjacent GPT, Sol, Gemini, and Opus families visibly distinct", () => {
    const keys = ["gpt-5-6-sol", "gpt-5-5", "gemini-3-7-flash", "opus-5"];
    expect(new Set(keys.map((key) => modelGroupColor(key, false))).size).toBe(keys.length);
    expect(new Set(keys.map((key) => modelGroupColor(key, true))).size).toBe(keys.length);
    const rgbDistance = (first: string, second: string) => {
      const channels = (color: string) => [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
      const a = channels(first);
      const b = channels(second);
      return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    };
    expect(rgbDistance(modelGroupColor("gpt-5-6-sol", false), modelGroupColor("gemini-3-7-flash", false))).toBeGreaterThan(75);
    expect(rgbDistance(modelGroupColor("gpt-5-6-sol", true), modelGroupColor("gemini-3-7-flash", true))).toBeGreaterThan(75);
    const visibleKeys = ["gpt-5-6-sol", "gemini-3-7-flash"];
    const visibleLight = modelGroupColors(visibleKeys, false);
    const visibleDark = modelGroupColors(visibleKeys, true);
    expect(rgbDistance(visibleLight.get(visibleKeys[0]!)!, visibleLight.get(visibleKeys[1]!)!)).toBeGreaterThan(75);
    expect(rgbDistance(visibleDark.get(visibleKeys[0]!)!, visibleDark.get(visibleKeys[1]!)!)).toBeGreaterThan(75);
  });

  it("chooses perceptually separated palette colors for unpreset families", () => {
    const keys = ["deepseek-v5-new-variant", "unknown-family-alpha", "unknown-family-beta"];
    const light = modelGroupColors(keys, false);
    const dark = modelGroupColors(keys, true);
    expect(light.get(keys[0]!)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.light[0]);
    expect(dark.get(keys[0]!)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.dark[0]);
    expect(new Set(light.values()).size).toBe(keys.length);
    expect(new Set(dark.values()).size).toBe(keys.length);
    expect([...light.values()].every((color) => new Set<string>(COLOR_BLIND_MODEL_GROUP_PALETTE.light).has(color))).toBe(true);
    expect([...dark.values()].every((color) => new Set<string>(COLOR_BLIND_MODEL_GROUP_PALETTE.dark).has(color))).toBe(true);
  });

  it("allocates collision-free colors for all families visible in a chart", () => {
    const keys = [
      "opus-5",
      "sonnet-5",
      "grok-4-6",
      "gpt-5-6-luna",
      "gpt-5-6-sol",
      "gpt-5-5",
      "gemini-3-7-flash",
      "deepseek-v4-flash-0731",
      "fable-5",
      "composer-2-5",
    ];
    expect(new Set([...modelGroupColors(keys, false).values()]).size).toBe(keys.length);
    expect(new Set([...modelGroupColors(keys, true).values()]).size).toBe(keys.length);
  });

  it("reserves compliant blue for all DeepSeek variants and orange for Opus variants", () => {
    expect(modelGroupColor("deepseek-v4-flash-0731", false)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.light[0]);
    expect(modelGroupColor("deepseek-v5-new-variant", false)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.light[0]);
    expect(modelGroupColor("deepseek-v5-new-variant", true)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.dark[0]);
    expect(modelGroupColor("opus-5", false)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.light[1]);
    expect(modelGroupColor("opus-6-latest", false)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.light[1]);
    expect(modelGroupColor("opus-6-latest", true)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.dark[1]);
    expect(modelGroupColor("grok-4-6", false)).toBe(COLOR_BLIND_MODEL_GROUP_PALETTE.light[2]);
  });

  it("keeps DeepSeek and GLM perceptually separated in the crowded AA set", () => {
    const keys = [
      "opus-5",
      "deepseek-v4-flash-0731",
      "deepseek-v4-pro-0813",
      "gemini-3-7-flash",
      "glm-5-3",
      "glm-5-3-flash",
      "gpt-5-6-luna",
      "gpt-5-6-sol",
      "grok-4-6",
      "kimi-k3",
      "muse-spark-1-2",
      "qwen3-8-max",
    ];
    const rgbDistance = (first: string, second: string) => {
      const channels = (color: string) => [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
      const a = channels(first);
      const b = channels(second);
      return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    };

    for (const dark of [false, true]) {
      const colors = modelGroupColors(keys, dark);
      expect(rgbDistance(
        colors.get("deepseek-v4-flash-0731")!,
        colors.get("glm-5-3-flash")!,
      )).toBeGreaterThan(75);
    }
  });

  it("keeps every currently supported model family on a distinct palette slot", () => {
    const keys = [
      "opus-5",
      "sonnet-5",
      "deepseek-v4-flash-0731",
      "deepseek-v4-flash",
      "deepseek-v4-pro-0813",
      "gemini-3-7-flash",
      "glm-5-3",
      "glm-5-3-flash",
      "gpt-5-6-luna",
      "gpt-5-6-sol",
      "grok-4-6",
      "kimi-k3",
      "muse-spark-1-2",
      "qwen3-8-max",
    ];

    expect(new Set(modelGroupColors(keys, false).values()).size).toBe(keys.length);
    expect(new Set(modelGroupColors(keys, true).values()).size).toBe(keys.length);
  });

  it("keeps every color-blind slot above the contrast target on supported surfaces", () => {
    for (const color of COLOR_BLIND_MODEL_GROUP_PALETTE.light) {
      for (const surface of COLOR_BLIND_SURFACE_SWATCHES.light) {
        expect(
          contrastRatio(color, surface.color),
          `${color} on ${surface.theme} ${surface.color}`,
        ).toBeGreaterThanOrEqual(COLOR_BLIND_CONTRAST_TARGET);
      }
    }
    for (const color of COLOR_BLIND_MODEL_GROUP_PALETTE.dark) {
      for (const surface of COLOR_BLIND_SURFACE_SWATCHES.dark) {
        expect(
          contrastRatio(color, surface.color),
          `${color} on ${surface.theme} ${surface.color}`,
        ).toBeGreaterThanOrEqual(COLOR_BLIND_CONTRAST_TARGET);
      }
    }
  });

  it("uses the compliant family palette for provider fallback colors", () => {
    expect(modelBrandColor("openai", false)).toBe(modelGroupColor("openai", false));
    expect(modelBrandColor("openai", true)).toBe(modelGroupColor("openai", true));
  });
});
