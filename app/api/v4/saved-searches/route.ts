import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { listSavedSearches, saveSavedSearch } from "../../../../lib/v4/saved-searches";

export const dynamic = "force-dynamic";

const privateHeaders = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  return Response.json({ searches: await listSavedSearches(user.userId) }, { headers: privateHeaders });
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: { code: "INVALID_SAVED_SEARCH", message: "Provide a search name and local query." } }, { status: 400 });
  try {
    const search = await saveSavedSearch(user.userId, { name: body.name, query: body.query });
    return Response.json({ search }, { status: 201, headers: privateHeaders });
  } catch (error) {
    return Response.json({ error: { code: "INVALID_SAVED_SEARCH", message: error instanceof Error ? error.message : "The saved search is invalid." } }, { status: 400 });
  }
}
