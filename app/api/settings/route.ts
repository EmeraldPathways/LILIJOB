import { userFromRequest, unauthorizedResponse } from "../../../lib/auth/require-user";
import { getRunConfig, saveRunConfig } from "../../../lib/jobs/run-config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  try {
    return Response.json({ config: await getRunConfig(user.userId) });
  } catch (error) {
    return Response.json({ error: { code: "SETTINGS_READ_FAILED", message: error instanceof Error ? error.message : "Unable to load settings." } }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object") return Response.json({ error: { code: "INVALID_SETTINGS", message: "Settings must be a JSON object." } }, { status: 400 });
  try {
    return Response.json({ config: await saveRunConfig(user.userId, body as Record<string, unknown>) });
  } catch (error) {
    return Response.json({ error: { code: "SETTINGS_SAVE_FAILED", message: error instanceof Error ? error.message : "Unable to save settings." } }, { status: 500 });
  }
}
