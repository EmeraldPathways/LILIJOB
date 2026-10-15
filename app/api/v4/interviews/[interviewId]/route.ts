import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { getInterview, updateInterviewOutcome } from "../../../../../lib/v4/interview-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ interviewId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { interviewId } = await context.params;
  const result = await getInterview(user.userId, interviewId);
  return result ? Response.json(result) : Response.json({ error: { code: "NOT_FOUND", message: "Interview not found." } }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ interviewId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { interviewId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: { code: "INVALID_INTERVIEW_UPDATE", message: "Provide an outcome, notes or follow-up draft." } }, { status: 400 });

  const update: { outcome?: "awaiting" | "progressed" | "offer" | "rejected" | "withdrawn" | null; notes?: string | null; followUpDraft?: { text: string } | null } = {};
  if (Object.hasOwn(body, "outcome")) {
    const allowed = ["awaiting", "progressed", "offer", "rejected", "withdrawn"];
    if (body.outcome !== null && (typeof body.outcome !== "string" || !allowed.includes(body.outcome))) return Response.json({ error: { code: "INVALID_OUTCOME", message: "Use awaiting, progressed, offer, rejected or withdrawn." } }, { status: 400 });
    update.outcome = body.outcome as typeof update.outcome;
  }
  if (Object.hasOwn(body, "notes")) {
    if (body.notes !== null && (typeof body.notes !== "string" || body.notes.length > 10_000)) return Response.json({ error: { code: "INVALID_NOTES", message: "Interview notes must be text no longer than 10,000 characters." } }, { status: 400 });
    update.notes = body.notes as string | null;
  }
  if (Object.hasOwn(body, "followUpDraft")) {
    if (body.followUpDraft === null) update.followUpDraft = null;
    else if (body.followUpDraft && typeof body.followUpDraft === "object" && !Array.isArray(body.followUpDraft) && typeof (body.followUpDraft as { text?: unknown }).text === "string" && (body.followUpDraft as { text: string }).text.trim().length > 0 && (body.followUpDraft as { text: string }).text.length <= 10_000) {
      update.followUpDraft = { text: (body.followUpDraft as { text: string }).text };
    } else return Response.json({ error: { code: "INVALID_FOLLOW_UP_DRAFT", message: "Follow-up drafts must contain 1 to 10,000 characters." } }, { status: 400 });
  }
  if (Object.keys(update).length === 0) return Response.json({ error: { code: "INVALID_INTERVIEW_UPDATE", message: "Provide an outcome, notes or follow-up draft." } }, { status: 400 });
  try {
    const result = await updateInterviewOutcome(user.userId, interviewId, update);
    return result ? Response.json(result) : Response.json({ error: { code: "NOT_FOUND", message: "Interview not found." } }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Interview update is invalid.";
    return Response.json({ error: { code: "INVALID_INTERVIEW_UPDATE", message } }, { status: 400 });
  }
}
