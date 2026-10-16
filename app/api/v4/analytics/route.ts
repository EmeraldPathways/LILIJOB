import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { getApplicationAnalytics, persistDailyApplicationAnalytics } from "../../../../lib/v5/analytics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const params = new URL(request.url).searchParams;
  const filters = { from: params.get("from") ?? undefined, to: params.get("to") ?? undefined, channel: params.get("channel") ?? undefined, sector: params.get("sector") ?? undefined };
  const analytics = await getApplicationAnalytics(user.userId, filters);
  await persistDailyApplicationAnalytics(user.userId, new Date(), filters);
  return Response.json({ analytics }, { headers: { "cache-control": "private, no-store" } });
}
