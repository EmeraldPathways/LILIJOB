import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { buildInternalDigest } from "../../../../../lib/v4/notifications";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  return Response.json({ digest: await buildInternalDigest(user.userId) }, { headers: { "cache-control": "private, no-store" } });
}
