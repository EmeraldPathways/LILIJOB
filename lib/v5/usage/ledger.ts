import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { providerUsageEvents, usageBudgets, usageReservations } from "../../../db/schema-v4";

export class UsageBudgetExceededError extends Error {
  constructor(message = "The configured provider budget would be exceeded.") { super(message); this.name = "UsageBudgetExceededError"; }
}

export type BudgetReservation = {
  reservationId: string;
  ownerId: string;
  operationId: string;
  scope: string;
  periodKey: string;
  amountMinor: number;
  currency: string;
  reused: boolean;
};

export type ProviderUsageObservation = {
  attemptId: string;
  operationId: string;
  provider: string;
  model?: string | null;
  status: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cachedTokens?: number | null;
  searchUnits?: number | null;
  priceVersion?: string | null;
  estimatedCostMinor?: number | null;
  measuredCostMinor?: number | null;
  currency?: string;
  runId?: string | null;
  stepId?: string | null;
  metadata?: unknown;
  observedAt?: string;
};

function integer(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

function period(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error("Budget periodKey must use YYYY-MM format.");
  return value;
}

function amount(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new Error("Budget amount must be a non-negative integer minor-unit value.");
  return value;
}

export async function reserveBudget(ownerId: string, operationId: string, input: { scope: string; periodKey: string; amountMinor: number; ceilingMinor: number; currency?: string }): Promise<BudgetReservation> {
  if (!ownerId.trim() || !operationId.trim() || !input.scope.trim()) throw new Error("Budget owner, operation and scope are required.");
  const periodKey = period(input.periodKey);
  const reservationAmount = amount(input.amountMinor);
  const ceilingMinor = amount(input.ceilingMinor);
  if (reservationAmount > ceilingMinor) throw new UsageBudgetExceededError();
  const db = getDb();
  const [existingReservation] = await db.select().from(usageReservations).where(and(eq(usageReservations.ownerId, ownerId), eq(usageReservations.operationId, operationId))).limit(1);
  if (existingReservation) {
    return { reservationId: existingReservation.id, ownerId, operationId, scope: existingReservation.scope, periodKey: existingReservation.periodKey, amountMinor: existingReservation.amountMinor, currency: input.currency ?? "EUR", reused: true };
  }
  const budgetId = `budget_${ownerId}_${input.scope}_${periodKey}`.slice(0, 180);
  const timestamp = new Date().toISOString();
  await db.insert(usageBudgets).values({ id: budgetId, ownerId, scope: input.scope, periodKey, ceilingMinor, reservedMinor: 0, usedMinor: 0, currency: input.currency ?? "EUR", createdAt: timestamp, updatedAt: timestamp }).onConflictDoNothing();
  const reservationId = `usage_reservation_${crypto.randomUUID()}`;
  const inserted = await db.insert(usageReservations).values({ id: reservationId, ownerId, operationId, scope: input.scope, periodKey, amountMinor: reservationAmount, status: "reserved", createdAt: timestamp, updatedAt: timestamp }).onConflictDoNothing().returning({ id: usageReservations.id });
  if (!inserted.length) {
    const [raced] = await db.select().from(usageReservations).where(and(eq(usageReservations.ownerId, ownerId), eq(usageReservations.operationId, operationId))).limit(1);
    if (raced) return { reservationId: raced.id, ownerId, operationId, scope: raced.scope, periodKey: raced.periodKey, amountMinor: raced.amountMinor, currency: input.currency ?? "EUR", reused: true };
    throw new Error("Budget reservation was not persisted.");
  }
  const claimed = await db.update(usageBudgets).set({ reservedMinor: sql`${usageBudgets.reservedMinor} + ${reservationAmount}`, updatedAt: timestamp }).where(and(
    eq(usageBudgets.ownerId, ownerId), eq(usageBudgets.scope, input.scope), eq(usageBudgets.periodKey, periodKey),
    sql`${usageBudgets.reservedMinor} + ${usageBudgets.usedMinor} + ${reservationAmount} <= ${usageBudgets.ceilingMinor}`,
  )).returning({ id: usageBudgets.id });
  if (!claimed.length) {
    await db.delete(usageReservations).where(and(eq(usageReservations.ownerId, ownerId), eq(usageReservations.id, reservationId)));
    throw new UsageBudgetExceededError();
  }
  return { reservationId, ownerId, operationId, scope: input.scope, periodKey, amountMinor: reservationAmount, currency: input.currency ?? "EUR", reused: false };
}

export async function recordProviderUsage(ownerId: string, reservationId: string, observation: ProviderUsageObservation) {
  const db = getDb();
  const timestamp = observation.observedAt ?? new Date().toISOString();
  const inserted = await db.insert(providerUsageEvents).values({
    id: `usage_${crypto.randomUUID()}`, ownerId, operationId: observation.operationId, runId: observation.runId ?? null, stepId: observation.stepId ?? null,
    attemptId: observation.attemptId, provider: observation.provider, model: observation.model ?? null, status: observation.status,
    inputTokens: integer(observation.inputTokens), outputTokens: integer(observation.outputTokens), reasoningTokens: integer(observation.reasoningTokens), cachedTokens: integer(observation.cachedTokens), searchUnits: integer(observation.searchUnits), priceVersion: observation.priceVersion ?? null,
    estimatedCostMinor: integer(observation.estimatedCostMinor), measuredCostMinor: integer(observation.measuredCostMinor), currency: observation.currency ?? "EUR", metadataJson: JSON.stringify(observation.metadata ?? {}), observedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
  }).onConflictDoNothing().returning({ id: providerUsageEvents.id });
  if (!inserted.length) return { recorded: false, costMinor: integer(observation.measuredCostMinor) ?? integer(observation.estimatedCostMinor) ?? 0 };
  const [reservation] = await db.select().from(usageReservations).where(and(eq(usageReservations.ownerId, ownerId), eq(usageReservations.id, reservationId))).limit(1);
  if (!reservation) throw new Error("Usage reservation was not found.");
  const costMinor = integer(observation.measuredCostMinor) ?? integer(observation.estimatedCostMinor) ?? 0;
  await db.update(usageBudgets).set({
    reservedMinor: sql`CASE WHEN ${usageBudgets.reservedMinor} >= ${reservation.amountMinor} THEN ${usageBudgets.reservedMinor} - ${reservation.amountMinor} ELSE 0 END`,
    usedMinor: sql`${usageBudgets.usedMinor} + ${costMinor}`,
    updatedAt: timestamp,
  }).where(and(eq(usageBudgets.ownerId, ownerId), eq(usageBudgets.scope, reservation.scope), eq(usageBudgets.periodKey, reservation.periodKey)));
  await db.update(usageReservations).set({ status: "settled", updatedAt: timestamp }).where(and(eq(usageReservations.ownerId, ownerId), eq(usageReservations.id, reservationId)));
  return { recorded: true, costMinor };
}

export async function getUsageSummary(ownerId: string, range: { from?: string; to?: string } = {}) {
  const conditions = [eq(providerUsageEvents.ownerId, ownerId)];
  if (range.from) conditions.push(gte(providerUsageEvents.observedAt, range.from));
  if (range.to) conditions.push(lte(providerUsageEvents.observedAt, range.to));
  const rows = await getDb().select().from(providerUsageEvents).where(and(...conditions));
  return rows.reduce((summary, row) => ({
    events: summary.events + 1,
    inputTokens: summary.inputTokens + (row.inputTokens ?? 0),
    outputTokens: summary.outputTokens + (row.outputTokens ?? 0),
    reasoningTokens: summary.reasoningTokens + (row.reasoningTokens ?? 0),
    cachedTokens: summary.cachedTokens + (row.cachedTokens ?? 0),
    searchUnits: summary.searchUnits + (row.searchUnits ?? 0),
    estimatedCostMinor: summary.estimatedCostMinor + (row.estimatedCostMinor ?? 0),
    measuredCostMinor: summary.measuredCostMinor + (row.measuredCostMinor ?? 0),
  }), { events: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, searchUnits: 0, estimatedCostMinor: 0, measuredCostMinor: 0 });
}

export function extractResponsesUsage(raw: unknown): Pick<ProviderUsageObservation, "inputTokens" | "outputTokens" | "reasoningTokens" | "cachedTokens"> {
  const usage = raw && typeof raw === "object" && "usage" in raw ? (raw as { usage?: unknown }).usage : null;
  const record = usage && typeof usage === "object" ? usage as Record<string, unknown> : {};
  const details = record.output_tokens_details && typeof record.output_tokens_details === "object" ? record.output_tokens_details as Record<string, unknown> : {};
  return { inputTokens: integer(record.input_tokens as number), outputTokens: integer(record.output_tokens as number), reasoningTokens: integer(details.reasoning_tokens as number), cachedTokens: integer(record.input_tokens_details && typeof record.input_tokens_details === "object" ? (record.input_tokens_details as Record<string, unknown>).cached_tokens as number : null) };
}
