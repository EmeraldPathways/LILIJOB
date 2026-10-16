import { and, asc, eq, lte, or, isNull } from "drizzle-orm";
import { getDb } from "../../db";
import { applications } from "../../db/schema";
import { applicationTasks } from "../../db/schema-v4";

export async function upsertApplicationTask(ownerId: string, input: { applicationId: string; type: string; reason: string; dedupKey: string; dueAt?: string | null }) {
  const db = getDb();
  const [application] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.ownerId, ownerId), eq(applications.id, input.applicationId))).limit(1);
  if (!application) return null;
  const now = new Date().toISOString();
  await db.insert(applicationTasks).values({ id: `application_task_${crypto.randomUUID()}`, ownerId, applicationId: input.applicationId, type: input.type, reason: input.reason, dueAt: input.dueAt ?? null, status: "open", snoozedUntil: null, dedupKey: input.dedupKey, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [applicationTasks.ownerId, applicationTasks.dedupKey], set: { reason: input.reason, dueAt: input.dueAt ?? null, updatedAt: now } });
  const [task] = await db.select().from(applicationTasks).where(and(eq(applicationTasks.ownerId, ownerId), eq(applicationTasks.dedupKey, input.dedupKey))).limit(1);
  return task ?? null;
}

export async function listApplicationTasks(ownerId: string, options: { status?: string; dueBefore?: string } = {}) {
  const clauses = [eq(applicationTasks.ownerId, ownerId)];
  if (options.status) clauses.push(eq(applicationTasks.status, options.status));
  if (options.dueBefore) clauses.push(or(isNull(applicationTasks.dueAt), lte(applicationTasks.dueAt, options.dueBefore))!);
  return getDb().select().from(applicationTasks).where(and(...clauses)).orderBy(asc(applicationTasks.status), asc(applicationTasks.dueAt));
}

export async function updateApplicationTask(ownerId: string, taskId: string, status: "open" | "completed" | "snoozed" | "dismissed", snoozedUntil?: string | null) {
  const changed = await getDb().update(applicationTasks).set({ status, snoozedUntil: snoozedUntil ?? null, updatedAt: new Date().toISOString() }).where(and(eq(applicationTasks.ownerId, ownerId), eq(applicationTasks.id, taskId))).returning({ id: applicationTasks.id });
  if (!changed.length) return null;
  const [task] = await getDb().select().from(applicationTasks).where(eq(applicationTasks.id, taskId)).limit(1);
  return task ?? null;
}

export async function generateApplicationTasks(ownerId: string, now = new Date()) {
  const due = await getDb().select().from(applications).where(and(eq(applications.ownerId, ownerId), lte(applications.followupDueAt, now.toISOString()), or(eq(applications.stage, "Applied"), eq(applications.stage, "Follow-up"), eq(applications.stage, "Contacted"))));
  return Promise.all(due.map((application) => upsertApplicationTask(ownerId, { applicationId: application.id, type: "follow-up", reason: `Follow up on ${application.title}.`, dedupKey: `followup:${application.id}:${application.followupDueAt}`, dueAt: application.followupDueAt })));
}
