import { describe, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ env: {} }));

import { HybridSearchProvider } from "../../lib/research/hybrid-search-provider";
import { configuredSearchProvider } from "../../lib/research/tavily-search-provider";
import type { SearchProvider } from "../../lib/research/search-provider";
import type { SearchRequest, SearchResult } from "../../lib/research/types";

function fakeProvider(name: string): SearchProvider & { search: ReturnType<typeof vi.fn> } {
  const result: SearchResult = {
    url: `https://${name}.example.com`,
    title: name,
    snippet: "result",
    provider: name,
    retrievedAt: "2026-10-14T00:00:00.000Z",
  };
  return { name, search: vi.fn(async () => [result]) };
}

describe("hybrid search routing", () => {
  it("uses OpenAI for automatic research and Tavily for bespoke requests", async () => {
    const openai = fakeProvider("openai");
    const tavily = fakeProvider("tavily");
    const provider = new HybridSearchProvider(openai, tavily);
    const routine: SearchRequest = { purpose: "official-profile", query: "Example official profile" };
    const bespoke: SearchRequest = { purpose: "bespoke", query: "Find unusual recent funding signals for Example" };

    await provider.search(routine);
    await provider.search(bespoke);

    expect(openai.search).toHaveBeenCalledWith(routine);
    expect(tavily.search).toHaveBeenCalledWith(bespoke);
  });

  it("defaults to hybrid routing so routine research avoids Tavily usage", () => {
    expect(configuredSearchProvider()).toBeInstanceOf(HybridSearchProvider);
  });
});
