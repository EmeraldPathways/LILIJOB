import type { SearchRequest, SearchResult } from "./types";

export interface SearchProvider {
  readonly name: string;
  search(request: SearchRequest): Promise<SearchResult[]>;
}

export class ResearchProviderError extends Error {
  constructor(
    message: string,
    public readonly code: "configuration" | "rate-limit" | "timeout" | "malformed" | "provider",
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ResearchProviderError";
  }
}
