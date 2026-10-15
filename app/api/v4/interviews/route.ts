import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { createInterview, listInterviews } from "../../../../lib/v4/interview-repository";
import { validateInterviewSchedule } from "../../../../lib/v4/interviews";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  return Response.json({ interviews: await listInterviews(user.userId) });
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.applicationId !== "string" || !body.applicationId.trim() || typeof body.round !== "string" || !body.round.trim() || body.round.length > 120) {
    return Response.json({ error: { code: "INVALID_INTERVIEW", message: "Application and a valid round are required." } }, { status: 400 });
  }
  if ((body.scheduledAt !== undefined && body.scheduledAt !== null && typeof body.scheduledAt !== "string") || (body.timezone !== undefined && body.timezone !== null && typeof body.timezone !== "string")) {
    return Response.json({ error: { code: "INVALID_SCHEDULE", message: "Provide a valid interview timestamp and timezone." } }, { status: 400 });
  }
  const scheduleError = validateInterviewSchedule(typeof body.scheduledAt === "string" ? body.scheduledAt : undefined, typeof body.timezone === "string" ? body.timezone : undefined);
  if (scheduleError) return Response.json({ error: { code: "INVALID_SCHEDULE", message: scheduleError } }, { status: 400 });
  const interview = await createInterview(user.userId, { applicationId: body.applicationId.trim(), round: body.round, scheduledAt: typeof body.scheduledAt === "string" ? body.scheduledAt : undefined, timezone: typeof body.timezone === "string" ? body.timezone : undefined, format: typeof body.format === "string" ? body.format : undefined, location: typeof body.location === "string" ? body.location : undefined, interviewerInfo: body.interviewerInfo });
  return interview ? Response.json({ interview }, { status: 201 }) : Response.json({ error: { code: "APPLICATION_NOT_FOUND", message: "Application not found." } }, { status: 404 });
}
