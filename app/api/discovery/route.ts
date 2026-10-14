import { userFromRequest, unauthorizedResponse } from "../../../lib/auth/require-user";
import { COMPANY_CATEGORIES, type CompanyCategory } from "../../../lib/domain/types";
import { runDiscovery } from "../../../lib/research/run-worker";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = (await request.json()) as { category?: CompanyCategory; newCompaniesPerCategory?: number };
  if (!body.category || !(COMPANY_CATEGORIES as readonly string[]).includes(body.category)) {
    return Response.json({ error: { code: "CATEGORY_REQUIRED", message: "Choose one of the four supported categories." } }, { status: 400 });
  }
  try {
    const summary = await runDiscovery(user.userId, body.category, { newCompaniesPerCategory: body.newCompaniesPerCategory });
    return Response.json({ summary }, { status: 202 });
  } catch (error) {
    return Response.json({ error: { code: "DISCOVERY_FAILED", message: error instanceof Error ? error.message : "Discovery failed." } }, { status: 502 });
  }
}
