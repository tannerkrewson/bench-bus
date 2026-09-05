import { describe, expect, it } from "vitest";
import { parseOpenRouterProviderDiscounts, parseOpenRouterProviderEndpoints } from "./discounts";

describe("parseOpenRouterProviderDiscounts", () => {
  it("reads explicit provider discounts and reconstructs the posted rate", () => {
    const html = `<script>self.__next_f.push([1,"4:{\\"provider_name\\":\\"StreamLake\\",\\"provider_slug\\":\\"streamlake/fp8\\",\\"pricing\\":{\\"prompt\\":\\"0.00000007966\\",\\"completion\\":\\"0.00000015932\\",\\"discount\\":0.431}}"])</script>`;
    expect(parseOpenRouterProviderDiscounts(html)).toEqual([
      {
        providerName: "StreamLake",
        providerSlug: "streamlake",
        listedInputPrice: 0.14,
        listedOutputPrice: 0.28,
        discountPercentage: 43.1,
      },
    ]);
  });

  it("ignores zero, invalid, and duplicate provider discounts", () => {
    const html = `<script>self.__next_f.push([1,"4:{\\"provider_name\\":\\"Provider\\",\\"provider_slug\\":\\"provider/x\\",\\"pricing\\":{\\"prompt\\":\\"0.000001\\",\\"completion\\":\\"0.000002\\",\\"discount\\":0}}\n5:{\\"provider_name\\":\\"Provider\\",\\"provider_slug\\":\\"provider/y\\",\\"pricing\\":{\\"prompt\\":\\"bad\\",\\"completion\\":\\"0.000002\\",\\"discount\\":0.5}}"])</script>`;
    expect(parseOpenRouterProviderDiscounts(html)).toEqual([]);
  });

  it("joins endpoint UUIDs to OpenRouter service tiers", () => {
    const html = `<script>self.__next_f.push([1,"4:{\\"id\\":\\"endpoint-flex\\",\\"name\\":\\"OpenAI | openai/model-20260903\\",\\"provider_name\\":\\"OpenAI\\",\\"provider_display_name\\":\\"OpenAI Flex\\",\\"provider_slug\\":\\"openai/flex\\",\\"service_tier\\":\\"flex\\",\\"pricing\\":{\\"prompt\\":\\"0.000005\\",\\"completion\\":\\"0.000025\\",\\"discount\\":0}}"])</script>`;
    expect(parseOpenRouterProviderEndpoints(html)).toEqual([{
      endpointId: "endpoint-flex",
      providerName: "OpenAI",
      providerSlug: "openai/flex",
      serviceTier: "flex",
      listedInputPrice: 5,
      listedOutputPrice: 25,
      discountFraction: 0,
    }]);
  });
});
