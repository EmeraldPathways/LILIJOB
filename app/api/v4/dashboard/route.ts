import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { generateActionReminders, getDashboardSummary } from "../../../../lib/v4/dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  await generateActionReminders(user.userId);
  return Response.json(await getDashboardSummary(user.userId));
}
