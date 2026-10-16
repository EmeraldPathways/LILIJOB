import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { notificationEvents, scheduledTaskRuns } from "../../db/schema-v4";

const LEASE_MS = 60_000;

function timestamp(value?: string): string {
  const result = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(result))) throw new Error("Scheduler timestamp is invalid.");
  return result;
}

export async function claimScheduledTaskRun(input: {
  ownerId: string;
  scheduleId: string;
  dueSlot: string;
  scopeVersion: string;
  now?: string;
}) {
  const now = timestamp(input.now);
  const leaseUntil = new Date(Date.parse(now) + LEASE_MS).toISOString();
  const db = getDb();
  const id = `scheduled_run_${crypto.randomUUID()}`;
  try {
    const inserted = await db.insert(scheduledTaskRuns).values({
      id,
      ownerId: input.ownerId,
      scheduleId: input.scheduleId,
      dueSlot: input.dueSlot,
      scopeVersion: input.scopeVersion,
      checkpointJson: "{}",
      leaseUntil,
      status: "running",
      attempts: 1,
      error: null,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().returning({ id: scheduledTaskRuns.id });
    if (inserted.length) {
      const [run] = await db.select().from(scheduledTaskRuns).where(eq(scheduledTaskRuns.id, id)).limit(1);
      return { run: run!, claimed: true };
    }
  } catch {
    // A concurrent worker may have inserted the same owner/schedule/slot.
  }
  const [existing] = await db.select().from(scheduledTaskRuns).where(and(
    eq(scheduledTaskRuns.ownerId, input.ownerId),
    eq(scheduledTaskRuns.scheduleId, input.scheduleId),
    eq(scheduledTaskRuns.dueSlot, input.dueSlot),
  )).limit(1);
  if (!existing) throw new Error("Scheduled task run was not persisted.");
  if (existing.status === "completed") return { run: existing, claimed: false };
  const leaseExpired = !existing.leaseUntil || Date.parse(existing.leaseUntil) <= Date.parse(now);
  if (!leaseExpired) return { run: existing, claimed: false };
  const changed = await db.update(scheduledTaskRuns).set({
    scopeVersion: input.scopeVersion,
    leaseUntil,
    status: "running",
    attempts: sql`${scheduledTaskRuns.attempts} + 1`,
    error: null,
    startedAt: existing.startedAt ?? now,
    finishedAt: null,
    updatedAt: now,
  }).where(and(
    eq(scheduledTaskRuns.ownerId, input.ownerId),
    eq(scheduledTaskRuns.id, existing.id),
    or(isNull(scheduledTaskRuns.leaseUntil), lte(scheduledTaskRuns.leaseUntil, now)),
  )).returning({ id: scheduledTaskRuns.id });
  if (!changed.length) {
    const [raced] = await db.select().from(scheduledTaskRuns).where(eq(scheduledTaskRuns.id, existing.id)).limit(1);
    return { run: raced ?? existing, claimed: false };
  }
  const [run] = await db.select().from(scheduledTaskRuns).where(eq(scheduledTaskRuns.id, existing.id)).limit(1);
  return { run: run!, claimed: true };
}

export async function updateScheduledTaskCheckpoint(ownerId: string, runId: string, checkpoint: unknown, now = new Date().toISOString()) {
  const changed = await getDb().update(scheduledTaskRuns).set({ checkpointJson: JSON.stringify(checkpoint ?? {}), updatedAt: timestamp(now) }).where(and(
    eq(scheduledTaskRuns.ownerId, ownerId),
    eq(scheduledTaskRuns.id, runId),
    eq(scheduledTaskRuns.status, "running"),
  )).returning({ id: scheduledTaskRuns.id });
  return changed.length > 0;
}

export async function finishScheduledTaskRun(ownerId: string, runId: string, input: { status: "completed" | "partial" | "failed"; checkpoint?: unknown; error?: string | null; now?: string }) {
  const now = timestamp(input.now);
  const changed = await getDb().update(scheduledTaskRuns).set({
    status: input.status,
    checkpointJson: JSON.stringify(input.checkpoint ?? {}),
    error: input.error ?? null,
    leaseUntil: null,
    finishedAt: now,
    updatedAt: now,
  }).where(and(eq(scheduledTaskRuns.ownerId, ownerId), eq(scheduledTaskRuns.id, runId))).returning({ id: scheduledTaskRuns.id });
  if (!changed.length) return null;
  const [run] = await getDb().select().from(scheduledTaskRuns).where(eq(scheduledTaskRuns.id, runId)).limit(1);
  return run ?? null;
}

export async function createNotificationEvent(input: {
  ownerId: string;
  dedupKey: string;
  type: string;
  sourceEntityId?: string | null;
  sourceVersion?: string | null;
  severity?: string;
  payload?: unknown;
  dueAt?: string | null;
}) {
  if (!input.ownerId.trim() || !input.dedupKey.trim() || !input.type.trim()) throw new Error("Notification owner, deduplication key and type are required.");
  const now = new Date().toISOString();
  const id = `notification_${crypto.randomUUID()}`;
  try {
    const inserted = await getDb().insert(notificationEvents).values({
      id,
      ownerId: input.ownerId,
      dedupKey: input.dedupKey,
      type: input.type,
      sourceEntityId: input.sourceEntityId ?? null,
      sourceVersion: input.sourceVersion ?? null,
      severity: input.severity ?? "info",
      state: "open",
      payloadJson: JSON.stringify(input.payload ?? {}),
      dueAt: input.dueAt ?? null,
      readAt: null,
      dismissedAt: null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().returning({ id: notificationEvents.id });
    if (inserted.length) {
      const [event] = await getDb().select().from(notificationEvents).where(eq(notificationEvents.id, id)).limit(1);
      return { event: event!, created: true };
    }
  } catch {
    // Fetch the existing deduplicated event below.
  }
  const [existing] = await getDb().select().from(notificationEvents).where(and(eq(notificationEvents.ownerId, input.ownerId), eq(notificationEvents.dedupKey, input.dedupKey))).limit(1);
  if (!existing) throw new Error("Notification event was not persisted.");
  return { event: existing, created: false };
}

export async function listNotificationEvents(ownerId: string, options: { state?: string; limit?: number } = {}) {
  const clauses = [eq(notificationEvents.ownerId, ownerId)];
  if (options.state) clauses.push(eq(notificationEvents.state, options.state));
  return getDb().select().from(notificationEvents).where(and(...clauses)).orderBy(desc(notificationEvents.createdAt)).limit(Math.max(1, Math.min(100, Math.floor(options.limit ?? 50))));
}

export async function updateNotificationEvent(ownerId: string, eventId: string, state: "open" | "read" | "dismissed") {
  const now = new Date().toISOString();
  const changed = await getDb().update(notificationEvents).set({ state, readAt: state === "read" ? now : undefined, dismissedAt: state === "dismissed" ? now : undefined, updatedAt: now }).where(and(eq(notificationEvents.ownerId, ownerId), eq(notificationEvents.id, eventId))).returning({ id: notificationEvents.id });
  if (!changed.length) return null;
  const [event] = await getDb().select().from(notificationEvents).where(eq(notificationEvents.id, eventId)).limit(1);
  return event ?? null;
}
