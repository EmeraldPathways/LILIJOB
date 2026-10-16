import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { getNotificationPreferences, saveNotificationPreferences, type NotificationPreferencesInput } from "../../../../../lib/v4/notifications";

export const dynamic = "force-dynamic";
const privateHeaders = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  return Response.json({ preferences: await getNotificationPreferences(user.userId) }, { headers: privateHeaders });
}

export async function PUT(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as NotificationPreferencesInput | null;
  if (!body) return Response.json({ error: { code: "INVALID_NOTIFICATION_PREFERENCES", message: "Provide notification preferences as a JSON object." } }, { status: 400 });
  try {
    const preferences = await saveNotificationPreferences(user.userId, body);
    return Response.json({ preferences }, { headers: privateHeaders });
  } catch (error) {
    return Response.json({ error: { code: "INVALID_NOTIFICATION_PREFERENCES", message: error instanceof Error ? error.message : "Notification preferences are invalid." } }, { status: 400 });
  }
}
