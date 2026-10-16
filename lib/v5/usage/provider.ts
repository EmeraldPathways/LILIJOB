import { env } from "cloudflare:workers";
import {
  recordProviderUsage,
  reserveBudget,
  type BudgetReservation,
  type ProviderUsageObservation,
} from "./ledger";

export type UsageContext = {
  ownerId: string;
  operationId: string;
  scope: "assistant" | "enrichment" | "search" | "agent" | string;
  runId?: string | null;
  stepId?: string | null;
  reservationMinor?: number;
  ceilingMinor?: number;
};

function configuredNumber(name: string, fallback: number): number {
  const value = Number((env as unknown as Record<string, unknown>)[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function usagePeriodKey(at = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function budgetCeilingMinor(scope: UsageContext["scope"]): number {
  const key = scope.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return configuredNumber(`V5_${key}_BUDGET_MINOR`, configuredNumber("V5_PROVIDER_BUDGET_MINOR", 5_000));
}

export async function reserveProviderUsage(context: UsageContext): Promise<BudgetReservation> {
  return reserveBudget(context.ownerId, context.operationId, {
    scope: context.scope,
    periodKey: usagePeriodKey(),
    amountMinor: context.reservationMinor ?? 5,
    ceilingMinor: context.ceilingMinor ?? budgetCeilingMinor(context.scope),
    currency: "EUR",
  });
}

export async function settleProviderUsage(
  context: UsageContext,
  reservation: BudgetReservation,
  observation: Omit<ProviderUsageObservation, "operationId" | "runId" | "stepId"> & { operationId?: string; runId?: string | null; stepId?: string | null },
) {
  return recordProviderUsage(context.ownerId, reservation.reservationId, {
    ...observation,
    operationId: observation.operationId ?? context.operationId,
    runId: observation.runId ?? context.runId ?? null,
    stepId: observation.stepId ?? context.stepId ?? null,
  });
}

export function estimateOpenAICostMinor(inputTokens: number | null | undefined, outputTokens: number | null | undefined): number {
  const inputRate = configuredNumber("V5_OPENAI_INPUT_MINOR_PER_MILLION", 20);
  const outputRate = configuredNumber("V5_OPENAI_OUTPUT_MINOR_PER_MILLION", 80);
  const input = Math.max(0, Math.floor(inputTokens ?? 0));
  const output = Math.max(0, Math.floor(outputTokens ?? 0));
  return Math.max(0, Math.ceil((input * inputRate + output * outputRate) / 1_000_000));
}
