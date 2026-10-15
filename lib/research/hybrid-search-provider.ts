import type { SearchProvider } from "./search-provider";
import type { SearchRequest, SearchResult } from "./types";

export class HybridSearchProvider implements SearchProvider {
  readonly name = "hybrid";

  constructor(
    private readonly openai: SearchProvider,
    private readonly tavily: SearchProvider,
  ) {}

  search(request: SearchRequest): Promise<SearchResult[]> {
    const provider = request.purpose === "bespoke" ? this.tavily : this.openai;
    return provider.search(request);
  }
}
