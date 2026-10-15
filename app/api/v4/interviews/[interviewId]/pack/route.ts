import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { createInterviewPackForInterview, updateInterviewPractice } from "../../../../../../lib/v4/interview-repository";
import { validateInterviewSource, type PracticeQaUpdate, type PracticeSelfEvaluation } from "../../../../../../lib/v4/interviews";

export const dynamic = "force-dynamic";

function textArray(value: unknown, maximumItems: number): value is string[] {
  return Array.isArray(value) && value.length <= maximumItems && value.every((item) => typeof item === "string" && item.length <= 2_000);
}

function selfEvaluation(value: unknown): value is PracticeSelfEvaluation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evaluation = value as Record<string, unknown>;
  return [evaluation.relevance, evaluation.specificity, evaluation.impact].every((score) => score === null || (typeof score === "number" && Number.isInteger(score) && score >= 1 && score <= 5))
    && typeof evaluation.reflection === "string" && evaluation.reflection.length <= 2_000;
}

export async function POST(request: Request, context: { params: Promise<{ interviewId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { interviewId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.companyName !== "string" || !body.companyName.trim() || body.companyName.length > 200 || typeof body.roleTitle !== "string" || !body.roleTitle.trim() || body.roleTitle.length > 200) {
    return Response.json({ error: { code: "INVALID_PACK", message: "Company and role are required." } }, { status: 400 });
  }
  if ((body.jobSourceUrl !== undefined && body.jobSourceUrl !== null && typeof body.jobSourceUrl !== "string") || (body.checkedAt !== undefined && body.checkedAt !== null && typeof body.checkedAt !== "string")) {
    return Response.json({ error: { code: "INVALID_SOURCE", message: "Provide a source URL and a checked calendar date together." } }, { status: 400 });
  }
  const jobSourceUrl = typeof body.jobSourceUrl === "string" ? body.jobSourceUrl.trim() : null;
  const checkedAt = typeof body.checkedAt === "string" ? body.checkedAt.trim() : null;
  const sourceError = validateInterviewSource(jobSourceUrl, checkedAt);
  if (sourceError) return Response.json({ error: { code: "INVALID_SOURCE", message: sourceError } }, { status: 400 });
  const companyFacts = body.companyFacts === undefined ? [] : body.companyFacts;
  const requirements = body.requirements === undefined ? [] : body.requirements;
  const approvedStories = body.approvedStories === undefined ? [] : body.approvedStories;
  if (!textArray(companyFacts, 30) || !textArray(requirements, 50) || !Array.isArray(approvedStories) || approvedStories.length > 50 || approvedStories.some((story) => !story || typeof story !== "object" || typeof (story as { id?: unknown }).id !== "string" || !(story as { id: string }).id.trim())) {
    return Response.json({ error: { code: "INVALID_PACK_INPUT", message: "Facts, requirements and evidence references must be valid lists." } }, { status: 400 });
  }
  const references = (approvedStories as Array<{ id: string }>).map((story) => ({ id: story.id.trim(), statement: "", metric: null }));
  try {
    const pack = await createInterviewPackForInterview(user.userId, interviewId, {
      companyName: body.companyName.trim(),
      roleTitle: body.roleTitle.trim(),
      jobSourceUrl,
      checkedAt,
      companyFacts,
      requirements,
      approvedStories: references,
      model: typeof body.model === "string" && body.model.length <= 100 ? body.model : undefined,
    });
    return pack ? Response.json({ pack }, { status: 201 }) : Response.json({ error: { code: "NOT_FOUND", message: "Interview not found." } }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Interview pack input is invalid.";
    return Response.json({ error: { code: "INVALID_PACK", message } }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ interviewId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { interviewId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !Array.isArray(body.practiceQas) || body.practiceQas.length === 0 || body.practiceQas.length > 20) {
    return Response.json({ error: { code: "INVALID_PRACTICE", message: "Provide one or more practice responses." } }, { status: 400 });
  }
  const updates: PracticeQaUpdate[] = [];
  for (const value of body.practiceQas) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return Response.json({ error: { code: "INVALID_PRACTICE", message: "Practice responses must be structured records." } }, { status: 400 });
    const practice = value as Record<string, unknown>;
    if (typeof practice.topic !== "string" || !practice.topic.trim() || typeof practice.answerDraft !== "string" || practice.answerDraft.length > 10_000 || !selfEvaluation(practice.selfEvaluation)) {
      return Response.json({ error: { code: "INVALID_PRACTICE", message: "Each response needs a topic, answer draft and valid self-evaluation." } }, { status: 400 });
    }
    updates.push({ topic: practice.topic.trim(), answerDraft: practice.answerDraft, selfEvaluation: practice.selfEvaluation });
  }
  try {
    const pack = await updateInterviewPractice(user.userId, interviewId, updates);
    return pack ? Response.json({ pack }) : Response.json({ error: { code: "NOT_FOUND", message: "Interview or preparation pack not found." } }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Practice response is invalid.";
    return Response.json({ error: { code: "INVALID_PRACTICE", message } }, { status: 400 });
  }
}
