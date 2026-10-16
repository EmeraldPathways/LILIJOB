import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { listApplicationTasks, generateApplicationTasks } from "../../../../lib/v5/application-tasks";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  await generateApplicationTasks(user.userId);
  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  return Response.json({ tasks: await listApplicationTasks(user.userId, { status }) }, { headers: { "cache-control": "private, no-store" } });
}
