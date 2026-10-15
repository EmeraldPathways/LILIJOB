import { env } from "cloudflare:workers";
import { configuredEnrichmentReasoningEffort } from "../ai/client";
import { classifySource } from "./source-policy";
import { ResearchProviderError, type SearchProvider } from "./search-provider";
import type { SearchRequest, SearchResult } from "./types";

type JsonRecord = Record<string, unknown>;
const REQUEST_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Citation = { url: string; title: string; excerpt: string };

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function sentenceExcerpt(text: string, start: unknown, end: unknown): string {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return "";
  const from = start as number;
  const to = end as number;
  if (from < 0 || to <= from || to > text.length) return "";

  const anchor = text.slice(from, to).trim();
  const prefix = text.slice(0, from);
  const prefixEnd = prefix.trimEnd().length;
  const prefixText = prefix.slice(0, prefixEnd);
  const citationMarker = /^(?:\[[^\]]{1,80}\]|\(\d{1,3}\)|\d{1,3}|(?:source|citation)\s*#?\d*|https?:\/\/\S+)$/i.test(anchor);
  const endsAfterSentence = /[.!?]$/.test(prefixText) || /\n\s*$/.test(prefix);

  if (citationMarker && endsAfterSentence && prefixText) {
    let sentenceStart = 0;
    for (let index = 0; index < prefixText.length - 1; index += 1) {
      if (prefixText[index] === "\n" || (/[.!?]/.test(prefixText[index] ?? "") && /\s/.test(prefixText[index + 1] ?? ""))) {
        sentenceStart = index + 1;
      }
    }
    return prefixText.slice(sentenceStart).trim().slice(0, 600);
  }

  let excerptStart = 0;
  for (let index = 0; index < from; index += 1) {
    if (text[index] === "\n" || (/[.!?]/.test(text[index] ?? "") && /\s/.test(text[index + 1] ?? ""))) {
      excerptStart = index + 1;
    }
  }
  while (/\s/.test(text[excerptStart] ?? "") && excerptStart < from) excerptStart += 1;

  const throughCitation = text.slice(0, to);
  if (/[.!?]\s*$/.test(throughCitation)) return text.slice(excerptStart, to).trim().slice(0, 600);

  const remainder = text.slice(to);
  const nextBoundary = remainder.search(/[.!?](?:\s|$)|\n/);
  const excerptEnd = nextBoundary < 0 ? Math.min(text.length, to + 180) : to + nextBoundary + 1;
  return text.slice(excerptStart, excerptEnd).trim().slice(0, 600);
}

function responseCitations(body: unknown): Citation[] {
  if (!isRecord(body)) return [];
  if (body.status !== undefined && body.status !== "completed") {
    throw new ResearchProviderError("OpenAI returned incomplete research output.", "malformed");
  }
  if (!Array.isArray(body.output)) return [];

  const citations: Citation[] = [];
  for (const item of body.output) {
    if (!isRecord(item) || item.type !== "message") continue;
    if (item.status !== undefined && item.status !== "completed") {
      throw new ResearchProviderError("OpenAI returned an incomplete message.", "malformed");
    }
    if (!Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content) || content.type !== "output_text" || typeof content.text !== "string") continue;
      if (!Array.isArray(content.annotations)) continue;
      for (const annotation of content.annotations) {
        if (!isRecord(annotation) || annotation.type !== "url_citation" || !isHttpUrl(annotation.url)) continue;
        const title = typeof annotation.title === "string" ? annotation.title.trim() : "";
        citations.push({
          url: annotation.url,
          title,
          excerpt: sentenceExcerpt(content.text, annotation.start_index, annotation.end_index),
        });
      }
    }
  }
  return citations;
}

export function extractCitedUrls(body: unknown): string[] {
  return [...new Set(responseCitations(body).map((citation) => citation.url))];
}

export function parseOpenAIWebSearchResponse(
  body: unknown,
  request: SearchRequest,
  retrievedAt = new Date().toISOString(),
): SearchResult[] {
  const citations = responseCitations(body).filter((citation) => citation.url && citation.excerpt);
  if (!citations.length) {
    throw new ResearchProviderError("OpenAI returned no usable cited sources.", "malformed");
  }
  return citations.slice(0, request.maxResults ?? 5).map((citation) => ({
    url: citation.url,
    title: citation.title,
    snippet: citation.excerpt,
    provider: "openai-web-search",
    retrievedAt,
    sourceType: classifySource(citation.url, citation.title),
    hasFullContent: false,
    status: "ok",
  }));
}

export class OpenAIWebSearchProvider implements SearchProvider {
  readonly name = "openai-web-search";

  async search(request: SearchRequest): Promise<SearchResult[]> {
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new ResearchProviderError("OPENAI_API_KEY is not configured for this private Site.", "configuration");
    }

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: env.OPENAI_MODEL?.trim() || "gpt-5.6-luna",
          tools: [{ type: "web_search_preview" }],
          input: `Use one combined web search for this company. Return concise sentences with URL citations attached only to the page excerpts that support each sentence. Do not treat general permit or sponsorship guidance as company-specific evidence.\n\n${request.query}`,
          reasoning: { effort: configuredEnrichmentReasoningEffort() },
          max_output_tokens: 1800,
          max_tool_calls: 1,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

    let body: unknown;
    try {
      body = await response.json() as unknown;
    } catch {
      throw new ResearchProviderError("OpenAI returned malformed research output.", "malformed");
    }
    return parseOpenAIWebSearchResponse(body, request);
  }
}
