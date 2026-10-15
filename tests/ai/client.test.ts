import { describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "test-model",
  OPENAI_REASONING_EFFORT: "medium",
  OPENAI_ENRICHMENT_REASONING_EFFORT: "low",
}));

vi.mock("cloudflare:workers", () => ({ env: mockEnv }));

import {
  askOpenAI,
  configuredEnrichmentReasoningEffort,
  configuredReasoningEffort,
  responseText,
} from "../../lib/ai/client";

function completedResponse(text: string) {
  return {
    status: "completed",
    output: [{ type: "message", status: "completed", content: [{ type: "output_text", text }] }],
  };
}

describe("OpenAI request cost controls", () => {
  it("keeps assistant reasoning medium and sends it to Responses API", async () => {
    expect(configuredReasoningEffort()).toBe("medium");

    const fetchImpl: typeof fetch = vi.fn(async () => new Response(JSON.stringify(completedResponse("Answer")), { status: 200 }));
    await askOpenAI("test request", { fetchImpl });

    const request = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({ reasoning: { effort: "medium" } });
  });

  it("keeps enrichment reasoning independently configured to low", () => {
    mockEnv.OPENAI_REASONING_EFFORT = "high";
    expect(configuredReasoningEffort()).toBe("high");
    expect(configuredEnrichmentReasoningEffort()).toBe("low");
  });

  it("falls back to separate medium and low defaults for unsupported values", () => {
    mockEnv.OPENAI_REASONING_EFFORT = "not-a-valid-effort";
    mockEnv.OPENAI_ENRICHMENT_REASONING_EFFORT = "not-a-valid-effort";
    expect(configuredReasoningEffort()).toBe("medium");
    expect(configuredEnrichmentReasoningEffort()).toBe("low");
  });

  it("extracts only message output_text and ignores metadata and reasoning", () => {
    expect(responseText({
      output_text: "root convenience text",
      output: [
        { type: "reasoning", id: "reasoning-id", summary: [{ text: "private reasoning" }], encrypted_content: "secret" },
        { type: "message", id: "message-id", status: "completed", content: [
          { type: "output_text", text: "Assistant answer", annotations: [] },
          { type: "refusal", text: "not output text" },
        ] },
      ],
    })).toBe("Assistant answer");
  });

  it("rejects incomplete Responses output instead of returning partial text", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => new Response(JSON.stringify({
      status: "incomplete",
      output: [{ type: "message", status: "incomplete", content: [{ type: "output_text", text: "Partial answer" }] }],
    }), { status: 200 }));

    await expect(askOpenAI("test request", { fetchImpl })).rejects.toThrow(/incomplete/i);
  });

  it("rejects empty output instead of returning an aggregate convenience field", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => new Response(JSON.stringify({ status: "completed", output: [], output_text: "untrusted" }), { status: 200 }));

    await expect(askOpenAI("test request", { fetchImpl })).rejects.toThrow(/empty answer/i);
  });
});
