import { describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "test-model",
  OPENAI_REASONING_EFFORT: "low",
}));

vi.mock("cloudflare:workers", () => ({ env: mockEnv }));

import { askOpenAI, configuredReasoningEffort } from "../../lib/ai/client";

describe("OpenAI request cost controls", () => {
  it("uses the configured reasoning effort and sends it to Responses API", async () => {
    expect(configuredReasoningEffort()).toBe("low");

    const fetchImpl: typeof fetch = vi.fn(async () => new Response(JSON.stringify({ output_text: "Answer" }), { status: 200 }));
    await askOpenAI("test request", { fetchImpl });

    const request = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({ reasoning: { effort: "low" } });
  });

  it("falls back to medium for an unsupported value", () => {
    mockEnv.OPENAI_REASONING_EFFORT = "not-a-valid-effort";
    expect(configuredReasoningEffort()).toBe("medium");
  });
});
