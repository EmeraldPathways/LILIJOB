import { env } from "cloudflare:workers";

export const DEFAULT_AI_MODEL = "gpt-5.6-luna";
export type OpenAIReasoningEffort = "low" | "medium" | "high";
export const DEFAULT_OPENAI_REASONING_EFFORT: OpenAIReasoningEffort = "medium";

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
  output_text?: unknown;
  output?: unknown;
};

function collectText(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, output));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "annotations" || key === "type" || key === "id") continue;
      collectText(item, output);
    }
  }
  return output;
}

export function responseText(body: ResponsesBody): string {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text.trim();
  return collectText(body.output).join(" ").trim();
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

export function isAIConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim());
}

export async function askOpenAI(input: string, options: { model?: string; fetchImpl?: typeof fetch } = {}): Promise<{ text: string; raw: ResponsesBody }> {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new AIConfigurationError();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model ?? configuredModel(),
        input,
        reasoning: { effort: configuredReasoningEffort() },
        max_output_tokens: 1800,
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    throw new AIProviderError(error instanceof Error ? error.message : "The OpenAI request failed.", true);
  }
  if (response.status === 429) throw new AIProviderError("OpenAI rate limit reached. Try again shortly.", true);
  if (!response.ok) throw new AIProviderError(`OpenAI returned HTTP ${response.status}.`, response.status >= 500);
  const raw = await response.json() as ResponsesBody;
  const text = responseText(raw);
  if (!text) throw new AIProviderError("OpenAI returned an empty answer.");
  return { text, raw };
}
