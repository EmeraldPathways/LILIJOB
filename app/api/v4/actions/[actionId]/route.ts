import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { updateActionItem } from "../../../../../lib/v4/dashboard";
import { isActionItemStatus } from "../../../../../lib/v4/crm";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ actionId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { actionId } = await context.params;
  const body = await request.json().catch(() => null) as { status?: unknown } | null;
  if (!body || typeof body.status !== "string" || !isActionItemStatus(body.status)) return Response.json({ error: { code: "INVALID_ACTION", message: "Use open, completed, snoozed or dismissed." } }, { status: 400 });
  try {
    const action = await updateActionItem(user.userId, actionId, body.status);
    return action ? Response.json({ action }) : Response.json({ error: { code: "NOT_FOUND", message: "Action item not found." } }, { status: 404 });
  } catch (error) {
    return Response.json({ error: { code: "INVALID_ACTION", message: error instanceof Error ? error.message : "Invalid action status." } }, { status: 400 });
  }
}
