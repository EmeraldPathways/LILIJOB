import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { generateActionReminders } from "../../../../../lib/v4/dashboard";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const generated = await generateActionReminders(user.userId);
  return Response.json({ actions: generated, count: generated.length });
}
