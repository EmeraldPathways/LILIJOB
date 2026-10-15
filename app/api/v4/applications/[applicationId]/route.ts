import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { ApplicationTransitionError, listApplicationPacks, listApplicationWithEvents, updateApplicationStage } from "../../../../../lib/v4/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ applicationId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { applicationId } = await context.params;
  const result = await listApplicationWithEvents(user.userId, applicationId);
  return result ? Response.json({ ...result, packs: await listApplicationPacks(user.userId, applicationId) }) : Response.json({ error: { code: "NOT_FOUND", message: "Application not found." } }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ applicationId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { applicationId } = await context.params;
  const body = await request.json().catch(() => null) as { stage?: unknown; note?: unknown } | null;
  if (!body || typeof body.stage !== "string") return Response.json({ error: { code: "INVALID_APPLICATION", message: "A target stage is required." } }, { status: 400 });
  try {
    const application = await updateApplicationStage(user.userId, applicationId, body.stage, typeof body.note === "string" ? body.note : undefined);
    return application ? Response.json({ application }) : Response.json({ error: { code: "NOT_FOUND", message: "Application not found." } }, { status: 404 });
  } catch (error) {
    const status = error instanceof ApplicationTransitionError ? 409 : 400;
    return Response.json({ error: { code: "APPLICATION_STAGE_INVALID", message: error instanceof Error ? error.message : "Unable to update application stage." } }, { status });
  }
}
