import { and, eq } from "drizzle-orm";
import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { getDb } from "../../../../db";
import { usageBudgets } from "../../../../db/schema-v4";
import { getUsageSummary } from "../../../../lib/v5/usage/ledger";
import { usagePeriodKey } from "../../../../lib/v5/usage/provider";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const params = new URL(request.url).searchParams;
  const periodKey = params.get("period") ?? usagePeriodKey();
  const from = params.get("from") ?? `${periodKey}-01T00:00:00.000Z`;
  const to = params.get("to") ?? `${periodKey}-31T23:59:59.999Z`;
  const [summary, budgets] = await Promise.all([
    getUsageSummary(user.userId, { from, to }),
    getDb().select().from(usageBudgets).where(and(eq(usageBudgets.ownerId, user.userId), eq(usageBudgets.periodKey, periodKey))),
  ]);
  return Response.json({ periodKey, summary, budgets: budgets.map((budget) => ({ scope: budget.scope, ceilingMinor: budget.ceilingMinor, reservedMinor: budget.reservedMinor, usedMinor: budget.usedMinor, currency: budget.currency })) }, { headers: { "cache-control": "private, no-store" } });
}
