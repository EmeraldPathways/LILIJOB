import { env } from "cloudflare:workers";

export const DEFAULT_AI_MODEL = "gpt-5.6-luna";
export type OpenAIReasoningEffort = "low" | "medium" | "high";
export const DEFAULT_OPENAI_REASONING_EFFORT: OpenAIReasoningEffort = "medium";
export const DEFAULT_OPENAI_ENRICHMENT_REASONING_EFFORT: OpenAIReasoningEffort = "low";

export class AIConfigurationError extends Error {
  readonly code = "AI_NOT_CONFIGURED";

  constructor(message = "OPENAI_API_KEY is not configured for this private Site.") {
    super(message);
    this.name = "AIConfigurationError";
  }
}

export class AIProviderError extends Error {
  readonly code = "AI_PROVIDER_ERROR";
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = "AIProviderError";
    this.retryable = retryable;
  }
}

type ResponsesBody = {
  status?: unknown;
  output_text?: unknown;
  output?: unknown;
  usage?: unknown;
};

export type AIUsageContext = {
  ownerId: string;
  operationId: string;
  scope?: "assistant" | "enrichment" | "search" | "agent" | string;
  runId?: string | null;
  stepId?: string | null;
  reservationMinor?: number;
  ceilingMinor?: number;
};

export function responseText(body: ResponsesBody): string {
  if (!Array.isArray(body.output)) return "";
  const text: string[] = [];
  for (const item of body.output) {
    if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "message") continue;
    const message = item as { status?: unknown; content?: unknown };
    if (message.status !== undefined && message.status !== "completed") continue;
    if (!Array.isArray(message.content)) continue;
    for (const content of message.content) {
      if (!content || typeof content !== "object") continue;
      const block = content as { type?: unknown; text?: unknown };
      if (block.type === "output_text" && typeof block.text === "string") text.push(block.text);
    }
  }
  return text.join("\n").trim();
}

function isIncompleteResponse(body: ResponsesBody): boolean {
  if (body.status !== undefined && body.status !== "completed") return true;
  if (!Array.isArray(body.output)) return false;
  return body.output.some((item) => item && typeof item === "object"
    && (item as { type?: unknown; status?: unknown }).type === "message"
    && (item as { status?: unknown }).status !== undefined
    && (item as { status?: unknown }).status !== "completed");
}

export function configuredModel(): string {
  return env.OPENAI_MODEL?.trim() || DEFAULT_AI_MODEL;
}

export function configuredReasoningEffort(): OpenAIReasoningEffort {
  const configured = env.OPENAI_REASONING_EFFORT?.trim().toLowerCase();
  return configured === "low" || configured === "medium" || configured === "high"
    ? configured
    : DEFAULT_OPENAI_REASONING_EFFORT;
}

export function configuredEnrichmentReasoningEffort(): OpenAIReasoningEffort {
  const configured = env.OPENAI_ENRICHMENT_REASONING_EFFORT?.trim().toLowerCase();
  return configured === "low" || configured === "medium" || configured === "high"
    ? configured
    : DEFAULT_OPENAI_ENRICHMENT_REASONING_EFFORT;
}

export function isAIConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim());
}

export async function askOpenAI(input: string, options: { model?: string; reasoningEffort?: OpenAIReasoningEffort; maxOutputTokens?: number; fetchImpl?: typeof fetch; usage?: AIUsageContext } = {}): Promise<{ text: string; raw: ResponsesBody }> {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new AIConfigurationError();
  const fetchImpl = options.fetchImpl ?? fetch;
  const usageContext = options.usage ? { ...options.usage, scope: options.usage.scope ?? "assistant" } : null;
  const usage = usageContext ? await (async () => {
    const { reserveProviderUsage } = await import("../v5/usage/provider");
    return reserveProviderUsage(usageContext);
  })() : null;
  const settle = async (status: string, raw: ResponsesBody | null, error?: unknown) => {
    if (!usage || !usageContext) return;
    const { extractResponsesUsage } = await import("../v5/usage/ledger");
    const { estimateOpenAICostMinor, settleProviderUsage } = await import("../v5/usage/provider");
    const tokens = extractResponsesUsage(raw);
    await settleProviderUsage(usageContext, usage, {
      attemptId: `${usageContext.operationId}:${crypto.randomUUID()}`,
      provider: "openai-responses",
      model: options.model ?? configuredModel(),
      status,
      ...tokens,
      estimatedCostMinor: estimateOpenAICostMinor(tokens.inputTokens, tokens.outputTokens),
      measuredCostMinor: null,
      priceVersion: "configurable-estimate-v1",
      metadata: error instanceof Error ? { error: error.message } : {},
    });
  };
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model ?? configuredModel(),
        input,
        reasoning: { effort: options.reasoningEffort ?? configuredReasoningEffort() },
        max_output_tokens: options.maxOutputTokens ?? 1800,
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    await settle("failed", null, error);
    throw new AIProviderError(error instanceof Error ? error.message : "The OpenAI request failed.", true);
  }
  if (response.status === 429) {
    await settle("rate-limited", null);
    throw new AIProviderError("OpenAI rate limit reached. Try again shortly.", true);
  }
  if (!response.ok) {
    await settle("failed", null);
    throw new AIProviderError(`OpenAI returned HTTP ${response.status}.`, response.status >= 500);
  }
  const raw = await response.json() as ResponsesBody;
  if (isIncompleteResponse(raw)) {
    await settle("incomplete", raw);
    throw new AIProviderError("OpenAI returned an incomplete answer.");
  }
  const text = responseText(raw);
  if (!text) {
    await settle("empty", raw);
    throw new AIProviderError("OpenAI returned an empty answer.");
  }
  await settle("completed", raw);
  return { text, raw };
}
