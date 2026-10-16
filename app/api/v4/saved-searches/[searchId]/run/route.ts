import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { runSavedSearch } from "../../../../../../lib/v4/saved-searches";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ searchId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { searchId } = await context.params;
  const search = await runSavedSearch(user.userId, searchId);
  if (!search) return Response.json({ error: { code: "NOT_FOUND", message: "Saved search not found." } }, { status: 404 });
  return Response.json({ search, source: "local-dataset" }, { headers: { "cache-control": "private, no-store" } });
}
