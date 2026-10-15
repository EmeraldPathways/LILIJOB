import { afterEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "test-model",
  OPENAI_REASONING_EFFORT: "medium",
  OPENAI_ENRICHMENT_REASONING_EFFORT: "low",
}));

vi.mock("cloudflare:workers", () => ({ env: mockEnv }));

import { configuredEnrichmentReasoningEffort } from "../../lib/ai/client";
import { OpenAIWebSearchProvider, parseOpenAIWebSearchResponse } from "../../lib/research/openai-search-provider";
import type { SearchRequest } from "../../lib/research/types";

const request: SearchRequest = { purpose: "official-profile", query: "North Star company profile", maxResults: 5 };

describe("OpenAI web-search Responses parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps each citation title and only its annotated excerpt", () => {
    const first = "North Star is based in Dublin City and is hiring engineers.";
    const second = "North Star makes secure payment software.";
    const text = `${first} ${second}`;
    const results = parseOpenAIWebSearchResponse({
      id: "resp_ignored",
      status: "completed",
      output: [{
        id: "msg_ignored",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{
          type: "output_text",
          text,
          annotations: [
            { type: "url_citation", start_index: 0, end_index: first.length, url: "https://northstar.ie/careers", title: "North Star Careers" },
            { type: "url_citation", start_index: first.length + 1, end_index: text.length, url: "https://northstar.ie/about", title: "About North Star" },
          ],
        }],
      }],
    }, request, "2026-10-15T00:00:00.000Z");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ url: "https://northstar.ie/careers", title: "North Star Careers", snippet: first, hasFullContent: false });
    expect(results[1]).toMatchObject({ url: "https://northstar.ie/about", title: "About North Star", snippet: second, hasFullContent: false });
    expect(results[0]?.content).toBeUndefined();
    expect(results[1]?.content).toBeUndefined();
  });

  it("keeps the sentence before a trailing citation and handles newline boundaries", () => {
    const text = "North Star is based in Dublin City. [1]\nNorth Star builds payment software.";
    const marker = "[1]";
    const results = parseOpenAIWebSearchResponse({
      status: "completed",
      output: [{ type: "message", status: "completed", content: [{
        type: "output_text",
        text,
        annotations: [{
          type: "url_citation",
          start_index: text.indexOf(marker),
          end_index: text.indexOf(marker) + marker.length,
          url: "https://northstar.ie/about",
          title: "About North Star",
        }],
      }] }],
    }, request);

    expect(results[0]?.snippet).toBe("North Star is based in Dublin City.");
  });

  it("ignores root convenience text, reasoning, ids, status, and encrypted content", () => {
    expect(() => parseOpenAIWebSearchResponse({
      output_text: "Untrusted aggregate https://wrong.example/page",
      id: "https://id.example/page",
      status: "completed",
      reasoning: [{ type: "reasoning", summary: [{ text: "https://reasoning.example/page" }] }],
      encrypted_content: "https://encrypted.example/page",
      output: [
        { type: "reasoning", id: "https://reasoning-item.example/page", summary: "ignored" },
        { type: "message", status: "completed", content: [{ type: "refusal", text: "https://refusal.example/page" }] },
      ],
    }, request)).toThrow(/cited sources/i);
  });

  it("rejects incomplete Responses output", () => {
    expect(() => parseOpenAIWebSearchResponse({
      status: "incomplete",
      output: [{ type: "message", content: [{ type: "output_text", text: "Partial result", annotations: [] }] }],
    }, request)).toThrow(/incomplete/i);
  });

  it("uses low enrichment reasoning and a twenty-second request timeout", async () => {
    expect(configuredEnrichmentReasoningEffort()).toBe("low");
    const first = "North Star official company profile.";
    const fetchMock: typeof fetch = vi.fn(async () => new Response(JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{
        type: "output_text",
        text: first,
        annotations: [{ type: "url_citation", start_index: 0, end_index: first.length, url: "https://northstar.ie/", title: "North Star" }],
      }] }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await new OpenAIWebSearchProvider().search(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetchMock).mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      reasoning: { effort: "low" },
      max_tool_calls: 1,
      max_output_tokens: 1800,
    });
    expect(timeoutSpy).toHaveBeenCalledWith(20_000);
  });
});
