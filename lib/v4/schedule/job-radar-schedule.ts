import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { companies } from "../../../db/schema";
import { jobRadarSchedules } from "../../../db/schema-v4";
import { createNotificationEvent, claimScheduledTaskRun, finishScheduledTaskRun, updateScheduledTaskCheckpoint } from "../../v5/scheduler";

export type JobRadarCadence = "daily" | "weekly";
export type JobRadarScheduleInput = { companyIds: string[]; cadence: JobRadarCadence; enabled: boolean };
export type JobRadarSchedule = Omit<typeof jobRadarSchedules.$inferSelect, "companyIdsJson"> & { companyIds: string[] };
export type ScheduledCompanyOutcome = {
  status: "completed" | "partial" | "unavailable" | "blocked";
  jobsFound: number;
  contactsFound: number;
  signalsFound: number;
  error?: string;
};

const MAX_SELECTED_COMPANIES = 100;
const MAX_SCHEDULES_PER_TICK = 3;
const MAX_COMPANIES_PER_SCHEDULE_TICK = 2;
const SCHEDULE_LEASE_MS = 120_000;

function parseCompanyIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, MAX_SELECTED_COMPANIES) : [];
  } catch {
    return [];
  }
}

function hydrate(row: typeof jobRadarSchedules.$inferSelect | undefined): JobRadarSchedule | null {
  if (!row) return null;
  const { companyIdsJson, ...rest } = row;
  return { ...rest, companyIds: parseCompanyIds(companyIdsJson) };
}

function sameIds(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function cadenceDate(value: string, cadence: JobRadarCadence): string {
  const date = new Date(value);
  date.setTime(date.getTime() + (cadence === "daily" ? 1 : 7) * 86_400_000);
  return date.toISOString();
}

export async function getJobRadarSchedule(ownerId: string): Promise<JobRadarSchedule | null> {
  const [row] = await getDb().select().from(jobRadarSchedules).where(eq(jobRadarSchedules.ownerId, ownerId)).limit(1);
  return hydrate(row);
}

export async function saveJobRadarSchedule(ownerId: string, input: JobRadarScheduleInput, checkedAt = new Date().toISOString()): Promise<JobRadarSchedule> {
  if (!ownerId.trim() || !validTimestamp(checkedAt)) throw new Error("Invalid schedule owner or timestamp.");
  if (input.cadence !== "daily" && input.cadence !== "weekly") throw new Error("Schedule cadence must be daily or weekly.");
  if (typeof input.enabled !== "boolean" || !Array.isArray(input.companyIds) || input.companyIds.length > MAX_SELECTED_COMPANIES) throw new Error("Schedule scope is invalid.");
  const companyIds = [...new Set(input.companyIds.map((companyId) => companyId.trim()))];
  if (companyIds.some((companyId) => !companyId || companyId.length > 128) || (input.enabled && !companyIds.length)) throw new Error("Choose valid saved companies for an enabled schedule.");
  if (companyIds.length) {
    const ownedCompanies = await getDb().select({ id: companies.id }).from(companies).where(and(eq(companies.ownerId, ownerId), inArray(companies.id, companyIds)));
    if (ownedCompanies.length !== companyIds.length) throw new Error("One or more selected company records are unavailable to this owner.");
  }

  const db = getDb();
  const [existing] = await db.select().from(jobRadarSchedules).where(eq(jobRadarSchedules.ownerId, ownerId)).limit(1);
  const previousIds = existing ? parseCompanyIds(existing.companyIdsJson) : [];
  const scopeChanged = !sameIds(previousIds, companyIds);
  const activated = input.enabled && !existing?.enabled;
  const cadenceChanged = Boolean(existing && existing.cadence !== input.cadence);
  const reset = scopeChanged || activated || !input.enabled;
  const nextRunAt = !input.enabled ? null : !existing || reset || cadenceChanged ? checkedAt : existing.nextRunAt ?? checkedAt;
  const values: typeof jobRadarSchedules.$inferInsert = {
    id: existing?.id ?? `job_radar_schedule_${crypto.randomUUID()}`,
    ownerId,
    companyIdsJson: JSON.stringify(companyIds),
    cadence: input.cadence,
    enabled: input.enabled,
    nextRunAt,
    cursorIndex: reset ? 0 : existing.cursorIndex,
    lastRunAt: reset ? null : existing.lastRunAt,
    lastStatus: reset ? null : existing.lastStatus,
    lastResultJson: reset ? "{}" : existing.lastResultJson,
    leaseUntil: null,
    createdAt: existing?.createdAt ?? checkedAt,
    updatedAt: checkedAt,
  };
  if (existing) {
    await db.update(jobRadarSchedules).set(values).where(and(eq(jobRadarSchedules.ownerId, ownerId), eq(jobRadarSchedules.id, existing.id)));
  } else {
    await db.insert(jobRadarSchedules).values(values);
  }
  const saved = await getJobRadarSchedule(ownerId);
  if (!saved) throw new Error("Job Radar schedule was not persisted.");
  return saved;
}

type ScheduleTotals = { processedCompanies: number; jobsFound: number; contactsFound: number; signalsFound: number; errors: string[] };

function parseTotals(value: string): ScheduleTotals {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    const record = parsed as Record<string, unknown>;
    return {
      processedCompanies: typeof record.processedCompanies === "number" && Number.isFinite(record.processedCompanies) ? Math.max(0, Math.floor(record.processedCompanies)) : 0,
      jobsFound: typeof record.jobsFound === "number" && Number.isFinite(record.jobsFound) ? Math.max(0, Math.floor(record.jobsFound)) : 0,
      contactsFound: typeof record.contactsFound === "number" && Number.isFinite(record.contactsFound) ? Math.max(0, Math.floor(record.contactsFound)) : 0,
      signalsFound: typeof record.signalsFound === "number" && Number.isFinite(record.signalsFound) ? Math.max(0, Math.floor(record.signalsFound)) : 0,
      errors: Array.isArray(record.errors) ? record.errors.filter((item): item is string => typeof item === "string").slice(0, MAX_SELECTED_COMPANIES) : [],
    };
  } catch {
    return { processedCompanies: 0, jobsFound: 0, contactsFound: 0, signalsFound: 0, errors: [] };
  }
}

async function defaultCompanyProcessor(ownerId: string, companyId: string): Promise<ScheduledCompanyOutcome> {
  const worker = await import("./job-radar-worker");
  return worker.runScheduledJobRadarCompany(ownerId, companyId);
}

export async function dispatchDueJobRadarSchedules(input: {
  now?: string;
  maxSchedules?: number;
  companiesPerSchedule?: number;
  ownerId?: string;
  processCompany?: (ownerId: string, companyId: string) => Promise<ScheduledCompanyOutcome>;
} = {}) {
  const runAt = input.now ?? new Date().toISOString();
  if (!validTimestamp(runAt)) throw new Error("Schedule dispatch timestamp is invalid.");
  const maxSchedules = Math.max(1, Math.min(MAX_SCHEDULES_PER_TICK, Math.floor(input.maxSchedules ?? MAX_SCHEDULES_PER_TICK)));
  const companyBudget = Math.max(1, Math.min(MAX_COMPANIES_PER_SCHEDULE_TICK, Math.floor(input.companiesPerSchedule ?? MAX_COMPANIES_PER_SCHEDULE_TICK)));
  const processor = input.processCompany ?? defaultCompanyProcessor;
  const db = getDb();
  const dueClauses = [
    eq(jobRadarSchedules.enabled, true),
    lte(jobRadarSchedules.nextRunAt, runAt),
    or(isNull(jobRadarSchedules.leaseUntil), lte(jobRadarSchedules.leaseUntil, runAt)),
  ];
  if (input.ownerId) dueClauses.push(eq(jobRadarSchedules.ownerId, input.ownerId));
  const due = await db.select().from(jobRadarSchedules).where(and(...dueClauses)).orderBy(asc(jobRadarSchedules.nextRunAt)).limit(maxSchedules);

  const result = { schedulesClaimed: 0, companiesProcessed: 0, continuations: 0, completedSchedules: 0, partialSchedules: 0, skippedSchedules: 0 };
  for (const schedule of due) {
    const scheduledNextRunAt = schedule.nextRunAt;
    if (!scheduledNextRunAt) { result.skippedSchedules += 1; continue; }
    const leaseUntil = new Date(Date.parse(runAt) + SCHEDULE_LEASE_MS).toISOString();
    const claimed = await db.update(jobRadarSchedules).set({ leaseUntil, updatedAt: runAt }).where(and(
      eq(jobRadarSchedules.id, schedule.id),
      eq(jobRadarSchedules.ownerId, schedule.ownerId),
      eq(jobRadarSchedules.enabled, true),
      eq(jobRadarSchedules.nextRunAt, scheduledNextRunAt),
      or(isNull(jobRadarSchedules.leaseUntil), lte(jobRadarSchedules.leaseUntil, runAt)),
    )).returning({ id: jobRadarSchedules.id });
    if (!claimed.length) { result.skippedSchedules += 1; continue; }
    result.schedulesClaimed += 1;

    const taskRun = await claimScheduledTaskRun({
      ownerId: schedule.ownerId,
      scheduleId: schedule.id,
      dueSlot: scheduledNextRunAt,
      scopeVersion: schedule.updatedAt,
      now: runAt,
    });
    if (!taskRun.claimed && taskRun.run.status === "completed") {
      result.skippedSchedules += 1;
      await db.update(jobRadarSchedules).set({ leaseUntil: null, updatedAt: runAt }).where(and(eq(jobRadarSchedules.ownerId, schedule.ownerId), eq(jobRadarSchedules.id, schedule.id)));
      continue;
    }

    const companyIds = parseCompanyIds(schedule.companyIdsJson);
    if (!companyIds.length) {
      await db.update(jobRadarSchedules).set({ enabled: false, nextRunAt: null, cursorIndex: 0, lastRunAt: runAt, lastStatus: "partial", lastResultJson: JSON.stringify({ errors: ["No saved companies are selected."] }), leaseUntil: null, updatedAt: runAt })
        .where(and(eq(jobRadarSchedules.ownerId, schedule.ownerId), eq(jobRadarSchedules.id, schedule.id), eq(jobRadarSchedules.leaseUntil, leaseUntil)));
      await finishScheduledTaskRun(schedule.ownerId, taskRun.run.id, { status: "partial", checkpoint: { processedCompanies: 0, errors: ["No saved companies are selected."] }, now: runAt });
      await createNotificationEvent({ ownerId: schedule.ownerId, dedupKey: `job-radar:${schedule.id}:${scheduledNextRunAt}`, type: "job-radar-run", sourceEntityId: schedule.id, sourceVersion: schedule.updatedAt, severity: "warning", payload: { status: "partial", errors: ["No saved companies are selected."] }, dueAt: runAt });
      result.partialSchedules += 1;
      continue;
    }
    let cursorIndex = Math.max(0, Math.min(companyIds.length, Math.floor(schedule.cursorIndex)));
    if (cursorIndex === companyIds.length) cursorIndex = 0;
    const totals = cursorIndex > 0 && ["running", "partial"].includes(schedule.lastStatus ?? "")
      ? parseTotals(schedule.lastResultJson)
      : { processedCompanies: 0, jobsFound: 0, contactsFound: 0, signalsFound: 0, errors: [] };
    const sliceEnd = Math.min(companyIds.length, cursorIndex + companyBudget);

    while (cursorIndex < sliceEnd) {
      const [current] = await db.select({ leaseUntil: jobRadarSchedules.leaseUntil }).from(jobRadarSchedules).where(and(
        eq(jobRadarSchedules.ownerId, schedule.ownerId), eq(jobRadarSchedules.id, schedule.id), eq(jobRadarSchedules.leaseUntil, leaseUntil), eq(jobRadarSchedules.enabled, true),
      )).limit(1);
      if (!current) break;
      const companyId = companyIds[cursorIndex];
      let companyResult: ScheduledCompanyOutcome;
      try {
        companyResult = await processor(schedule.ownerId, companyId);
      } catch (error) {
        companyResult = { status: "unavailable", jobsFound: 0, contactsFound: 0, signalsFound: 0, error: error instanceof Error ? error.message : "Company collection failed." };
      }
      totals.processedCompanies += 1;
      totals.jobsFound += Math.max(0, companyResult.jobsFound || 0);
      totals.contactsFound += Math.max(0, companyResult.contactsFound || 0);
      totals.signalsFound += Math.max(0, companyResult.signalsFound || 0);
      if (companyResult.error || companyResult.status === "blocked" || companyResult.status === "unavailable" || companyResult.status === "partial") {
        totals.errors.push(`${companyId}: ${companyResult.error ?? companyResult.status}`);
      }
      cursorIndex += 1;
      result.companiesProcessed += 1;
      const partial = totals.errors.length > 0;
      await db.update(jobRadarSchedules).set({
        cursorIndex,
        lastRunAt: runAt,
        lastStatus: partial ? "partial" : "running",
        lastResultJson: JSON.stringify(totals),
        updatedAt: runAt,
      }).where(and(eq(jobRadarSchedules.ownerId, schedule.ownerId), eq(jobRadarSchedules.id, schedule.id), eq(jobRadarSchedules.leaseUntil, leaseUntil)));
      await updateScheduledTaskCheckpoint(schedule.ownerId, taskRun.run.id, { cursorIndex, totals }, runAt);
    }

    const [current] = await db.select({ leaseUntil: jobRadarSchedules.leaseUntil }).from(jobRadarSchedules).where(and(
      eq(jobRadarSchedules.ownerId, schedule.ownerId), eq(jobRadarSchedules.id, schedule.id), eq(jobRadarSchedules.leaseUntil, leaseUntil),
    )).limit(1);
    if (!current) { result.skippedSchedules += 1; continue; }
    const isComplete = cursorIndex >= companyIds.length;
    const partial = totals.errors.length > 0;
    await db.update(jobRadarSchedules).set({
      cursorIndex: isComplete ? 0 : cursorIndex,
      lastRunAt: runAt,
      lastStatus: isComplete ? partial ? "partial" : "completed" : partial ? "partial" : "running",
      lastResultJson: JSON.stringify(totals),
      nextRunAt: isComplete ? cadenceDate(runAt, schedule.cadence as JobRadarCadence) : schedule.nextRunAt,
      leaseUntil: null,
      updatedAt: runAt,
    }).where(and(eq(jobRadarSchedules.ownerId, schedule.ownerId), eq(jobRadarSchedules.id, schedule.id), eq(jobRadarSchedules.leaseUntil, leaseUntil)));
    if (isComplete) {
      const taskStatus = partial ? "partial" : "completed";
      await finishScheduledTaskRun(schedule.ownerId, taskRun.run.id, { status: taskStatus, checkpoint: { cursorIndex, totals }, now: runAt });
      await createNotificationEvent({ ownerId: schedule.ownerId, dedupKey: `job-radar:${schedule.id}:${scheduledNextRunAt}`, type: "job-radar-run", sourceEntityId: schedule.id, sourceVersion: schedule.updatedAt, severity: partial ? "warning" : "info", payload: { status: taskStatus, ...totals }, dueAt: runAt });
    }
    if (!isComplete) result.continuations += 1;
    else if (partial) result.partialSchedules += 1;
    else result.completedSchedules += 1;
  }
  return result;
}

/** Moves only the signed-in owner's enabled schedule due now, then processes one bounded slice. */
export async function runOwnerJobRadarScheduleNow(ownerId: string, now = new Date().toISOString(), processCompany?: (ownerId: string, companyId: string) => Promise<ScheduledCompanyOutcome>) {
  if (!ownerId.trim() || !validTimestamp(now)) throw new Error("Schedule owner or timestamp is invalid.");
  const db = getDb();
  const [schedule] = await db.select().from(jobRadarSchedules).where(eq(jobRadarSchedules.ownerId, ownerId)).limit(1);
  if (!schedule || !schedule.enabled) return { schedulesClaimed: 0, companiesProcessed: 0, continuations: 0, completedSchedules: 0, partialSchedules: 0, skippedSchedules: 0 };
  if (!parseCompanyIds(schedule.companyIdsJson).length) return { schedulesClaimed: 0, companiesProcessed: 0, continuations: 0, completedSchedules: 0, partialSchedules: 1, skippedSchedules: 0 };

  const madeDue = await db.update(jobRadarSchedules).set({ nextRunAt: now, updatedAt: now }).where(and(
    eq(jobRadarSchedules.ownerId, ownerId),
    eq(jobRadarSchedules.id, schedule.id),
    eq(jobRadarSchedules.enabled, true),
    or(isNull(jobRadarSchedules.leaseUntil), lte(jobRadarSchedules.leaseUntil, now)),
  )).returning({ id: jobRadarSchedules.id });
  if (!madeDue.length) return { schedulesClaimed: 0, companiesProcessed: 0, continuations: 0, completedSchedules: 0, partialSchedules: 0, skippedSchedules: 1 };
  return dispatchDueJobRadarSchedules({ now, ownerId, maxSchedules: 1, companiesPerSchedule: MAX_COMPANIES_PER_SCHEDULE_TICK, processCompany });
}
