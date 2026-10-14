import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { AIConfigurationError, AIProviderError, isAIConfigured } from "../../../../lib/ai/client";
import { runResearchAgent } from "../../../../lib/ai/agent";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();

  const body = await request.json().catch(() => null) as { question?: unknown; companyId?: unknown; conversationId?: unknown } | null;
  if (!body || typeof body.question !== "string" || !body.question.trim()) {
    return Response.json({ error: { code: "QUESTION_REQUIRED", message: "Ask a question about your saved Dublin research." } }, { status: 400 });
  }
  if (!isAIConfigured()) {
    return Response.json({ error: { code: "AI_NOT_CONFIGURED", message: "The assistant is ready but OPENAI_API_KEY has not been added to Site variables yet." } }, { status: 503 });
  }

  try {
    const response = await runResearchAgent({
      question: body.question.trim(),
      companyId: typeof body.companyId === "string" ? body.companyId : null,
      conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
    }, user.userId);
    return Response.json(response);
  } catch (error) {
    if (error instanceof AIConfigurationError) {
      return Response.json({ error: { code: error.code, message: "The assistant is ready but OPENAI_API_KEY has not been added to Site variables yet." } }, { status: 503 });
    }
    if (error instanceof AIProviderError) {
      return Response.json({ error: { code: error.code, message: error.message, retryable: error.retryable } }, { status: error.retryable ? 503 : 502 });
    }
    return Response.json({ error: { code: "AI_REQUEST_FAILED", message: error instanceof Error ? error.message : "The assistant could not complete the request." } }, { status: 500 });
  }
}
