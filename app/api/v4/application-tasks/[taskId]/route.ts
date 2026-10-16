import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { updateApplicationTask } from "../../../../../lib/v5/application-tasks";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { taskId } = await context.params;
  const body = await request.json().catch(() => null) as { status?: unknown; snoozedUntil?: unknown } | null;
  if (!["open", "completed", "snoozed", "dismissed"].includes(String(body?.status))) return Response.json({ error: { code: "INVALID_TASK_STATUS", message: "Use open, completed, snoozed or dismissed." } }, { status: 400 });
  const task = await updateApplicationTask(user.userId, taskId, body!.status as "open" | "completed" | "snoozed" | "dismissed", typeof body?.snoozedUntil === "string" ? body.snoozedUntil : null);
  return task ? Response.json({ task }) : Response.json({ error: { code: "NOT_FOUND", message: "Application task not found." } }, { status: 404 });
}
