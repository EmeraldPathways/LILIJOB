import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { updateNotificationEvent } from "../../../../../lib/v5/scheduler";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { eventId } = await context.params;
  const body = await request.json().catch(() => null) as { state?: unknown } | null;
  if (body?.state !== "open" && body?.state !== "read" && body?.state !== "dismissed") return Response.json({ error: { code: "INVALID_NOTIFICATION_STATE", message: "Use open, read or dismissed." } }, { status: 400 });
  const event = await updateNotificationEvent(user.userId, eventId, body.state);
  return event ? Response.json({ event }) : Response.json({ error: { code: "NOT_FOUND", message: "Notification event not found." } }, { status: 404 });
}
