import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { refreshRuns } from "../../db/schema";

export async function getRun(ownerId: string, runId: string) {
  const db = getDb();
  const [run] = await db
    .select()
    .from(refreshRuns)
    .where(and(eq(refreshRuns.ownerId, ownerId), eq(refreshRuns.id, runId)))
    .limit(1);
  return run ?? null;
}

export async function listRuns(ownerId: string) {
  const db = getDb();
  return db
    .select()
    .from(refreshRuns)
    .where(eq(refreshRuns.ownerId, ownerId))
    .orderBy(desc(refreshRuns.createdAt));
}
