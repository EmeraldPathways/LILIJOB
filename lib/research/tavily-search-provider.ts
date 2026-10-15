import { env } from "cloudflare:workers";
import { HybridSearchProvider } from "./hybrid-search-provider";
import { OpenAIWebSearchProvider } from "./openai-search-provider";
import { classifySource } from "./source-policy";
import { ResearchProviderError, type SearchProvider } from "./search-provider";
import type { SearchRequest, SearchResult } from "./types";

type TavilyResult = { url?: unknown; title?: unknown; content?: unknown; score?: unknown };

export class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily";

  async search(request: SearchRequest): Promise<SearchResult[]> {
    const apiKey = env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new ResearchProviderError("TAVILY_API_KEY is not configured.", "configuration");
    }
    let response: Response;
    try {
      response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query: request.query, search_depth: "advanced", max_results: request.maxResults ?? 5, include_answer: false }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new ResearchProviderError(error instanceof Error ? error.message : "Tavily request timed out", "timeout", true);
    }
    if (response.status === 429) throw new ResearchProviderError("Tavily rate limit reached.", "rate-limit", true);
    if (!response.ok) throw new ResearchProviderError(`Tavily request failed (${response.status}).`, "provider", response.status >= 500);

    const body = (await response.json()) as { results?: TavilyResult[] };
    if (!Array.isArray(body.results)) throw new ResearchProviderError("Tavily returned malformed results.", "malformed");
    return body.results.flatMap((item) => {
      const url = typeof item.url === "string" ? item.url : "";
      if (!url) return [];
      const title = typeof item.title === "string" ? item.title : "";
      const content = typeof item.content === "string" ? item.content : "";
      return [{ url, title, snippet: content.slice(0, 800), content, provider: this.name, retrievedAt: new Date().toISOString(), sourceType: classifySource(url, title), hasFullContent: false, status: "ok" as const }];
    });
  }
}

export function configuredSearchProvider(): SearchProvider {
  const configured = env.SEARCH_PROVIDER?.trim().toLowerCase();
  if (configured === "tavily") return new TavilySearchProvider();
  if (configured === "openai") return new OpenAIWebSearchProvider();
  // The default keeps routine enrichment on OpenAI web search and reserves
  // Tavily for explicitly bespoke questions. SEARCH_PROVIDER remains an
  // escape hatch for a single-provider deployment.
  return new HybridSearchProvider(new OpenAIWebSearchProvider(), new TavilySearchProvider());
}
