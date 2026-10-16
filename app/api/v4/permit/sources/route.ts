import { and, desc, eq } from 'drizzle-orm';
import { userFromRequest, unauthorizedResponse } from '../../../../../lib/auth/require-user';
import { getDb } from '../../../../../db';
import { settingsVersions } from '../../../../../db/schema-v4';
import { checkPermitSources } from '../../../../../lib/v4/permit-sources';

export const dynamic = 'force-dynamic';
const namespace = 'official-permit-source-checks';
async function latest(ownerId: string) {
  const [row] = await getDb().select().from(settingsVersions).where(and(eq(settingsVersions.ownerId, ownerId), eq(settingsVersions.namespace, namespace))).orderBy(desc(settingsVersions.version)).limit(1);
  return row;
}
export async function GET(request: Request) {
  const user = userFromRequest(request); if (!user) return unauthorizedResponse();
  const row = await latest(user.userId);
  return Response.json({ checks: row ? JSON.parse(row.settingsJson) : [], interpretation: 'Availability checks do not approve permit rules or determine personal eligibility.' }, { headers: { 'cache-control': 'private, no-store' } });
}
export async function POST(request: Request) {
  const user = userFromRequest(request); if (!user) return unauthorizedResponse();
  const previous = await latest(user.userId);
  if (previous && Date.now() - Date.parse(previous.createdAt) < 60_000) return Response.json({ checks: JSON.parse(previous.settingsJson), cached: true });
  const checks = await checkPermitSources();
  const now = new Date().toISOString();
  try {
    await getDb().insert(settingsVersions).values({ id: `permit_check_${crypto.randomUUID()}`, ownerId: user.userId, namespace, version: (previous?.version ?? 0) + 1, settingsJson: JSON.stringify(checks), createdBy: user.userId, createdAt: now });
  } catch (error) {
    const raced = await latest(user.userId);
    if (!raced || raced.version <= (previous?.version ?? 0)) throw error;
    return Response.json({ checks: JSON.parse(raced.settingsJson), cached: true });
  }
  return Response.json({ checks, requiresRuleReview: true }, { headers: { 'cache-control': 'private, no-store' } });
}
