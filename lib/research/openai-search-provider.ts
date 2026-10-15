import { env } from "cloudflare:workers";
import { configuredReasoningEffort } from "../ai/client";
import { classifySource } from "./source-policy";
import { ResearchProviderError, type SearchProvider } from "./search-provider";
import type { SearchRequest, SearchResult } from "./types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function collectText(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, output));
    return output;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "annotations" || key === "type") continue;
      collectText(item, output);
    }
  }
  return output;
}

function annotationUrls(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => annotationUrls(item, output));
  } else if (isRecord(value)) {
    if (typeof value.url === "string" && /^https?:\/\//i.test(value.url)) output.push(value.url);
    Object.values(value).forEach((item) => annotationUrls(item, output));
  }
  return output;
}

export function extractCitedUrls(value: unknown): string[] {
  const text = collectText(value).join(" ");
  const inline = [...text.matchAll(/https?:\/\/[^\s)\]}>"]+/g)].map((match) => match[0].replace(/[.,;]+$/, ""));
  return [...new Set([...annotationUrls(value), ...inline])];
}

export class OpenAIWebSearchProvider implements SearchProvider {
  readonly name = "openai-web-search";

  async search(request: SearchRequest): Promise<SearchResult[]> {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ResearchProviderError("OPENAI_API_KEY is not configured for this private Site.", "configuration");
    }

    const model = env.OPENAI_MODEL || "gpt-5.6-luna";
    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          tools: [{ type: "web_search_preview" }],
          input: `Research this request using fresh web sources. Return concise factual findings with source URLs.\n\n${request.query}`,
          reasoning: { effort: configuredReasoningEffort() },
          max_output_tokens: 1400,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenAI request timed out";
      throw new ResearchProviderError(message, "timeout", true);
    }

    if (response.status === 429) {
      throw new ResearchProviderError("OpenAI rate limit reached.", "rate-limit", true);
    }
    if (!response.ok) {
      throw new ResearchProviderError(`OpenAI research request failed (${response.status}).`, "provider", response.status >= 500);
    }

    const body = (await response.json()) as unknown;
    const text = collectText(body).join(" ").trim();
    const urls = extractCitedUrls(body);
    if (!text || !urls.length) {
      throw new ResearchProviderError("OpenAI returned no usable cited sources.", "malformed");
    }

    return urls.slice(0, request.maxResults ?? 5).map((url) => ({
      url,
      title: request.query,
      snippet: text.slice(0, 1200),
      content: text,
      provider: this.name,
      retrievedAt: new Date().toISOString(),
      sourceType: classifySource(url, request.query),
      hasFullContent: true,
      status: "ok",
    }));
  }
}
