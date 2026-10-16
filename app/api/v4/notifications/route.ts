import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { listNotificationEvents } from "../../../../lib/v5/scheduler";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? undefined;
  const limit = Number(params.get("limit"));
  return Response.json({ events: await listNotificationEvents(user.userId, { state, limit: Number.isFinite(limit) ? limit : undefined }) }, { headers: { "cache-control": "private, no-store" } });
}
