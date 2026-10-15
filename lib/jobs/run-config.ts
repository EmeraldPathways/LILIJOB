import { DEFAULT_DISCOVERY_LIMITS } from "../domain/constants";

export type RunConfig = {
  newCompaniesPerCategory: number;
  searchesPerCompany: number;
  existingCompaniesPerRefresh: number;
  paused: boolean;
  continuationCategory?: string | null;
};

export type RunConfigSnapshot = RunConfig & {
  providerCalls: number;
  estimatedCostCents: number;
  lastSuccessfulRunAt: string | null;
};

export const DEFAULT_RUN_CONFIG: RunConfig = {
  ...DEFAULT_DISCOVERY_LIMITS,
  paused: false,
  continuationCategory: null,
};

function safeInteger(value: unknown, fallback: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(1, Math.floor(value)), maximum);
}

export function normalizeRunConfig(input: Partial<RunConfig> = {}): RunConfig {
  return {
    newCompaniesPerCategory: safeInteger(input.newCompaniesPerCategory, DEFAULT_RUN_CONFIG.newCompaniesPerCategory, DEFAULT_RUN_CONFIG.newCompaniesPerCategory),
    searchesPerCompany: safeInteger(input.searchesPerCompany, DEFAULT_RUN_CONFIG.searchesPerCompany, DEFAULT_RUN_CONFIG.searchesPerCompany),
    existingCompaniesPerRefresh: safeInteger(input.existingCompaniesPerRefresh, DEFAULT_RUN_CONFIG.existingCompaniesPerRefresh, DEFAULT_RUN_CONFIG.existingCompaniesPerRefresh),
    paused: input.paused === true,
    continuationCategory: typeof input.continuationCategory === "string" ? input.continuationCategory : null,
  };
}

export function runLimits(config: RunConfig) {
  return {
    newCompaniesPerCategory: config.newCompaniesPerCategory,
    searchesPerCompany: config.searchesPerCompany,
    existingCompaniesPerRefresh: config.existingCompaniesPerRefresh,
  };
}

export async function getRunConfig(ownerId: string): Promise<RunConfigSnapshot> {
  const [{ getDb }, { runConfigs }] = await Promise.all([import("../../db"), import("../../db/schema")]);
  const { eq } = await import("drizzle-orm");
  const [row] = await getDb().select().from(runConfigs).where(eq(runConfigs.ownerId, ownerId)).limit(1);
  if (!row) return { ...DEFAULT_RUN_CONFIG, providerCalls: 0, estimatedCostCents: 0, lastSuccessfulRunAt: null };
  return { ...normalizeRunConfig({ newCompaniesPerCategory: row.newCompaniesPerCategory, searchesPerCompany: row.searchesPerCompany, existingCompaniesPerRefresh: row.existingCompaniesPerRefresh, paused: row.paused, continuationCategory: row.continuationCategory }), providerCalls: row.providerCalls, estimatedCostCents: row.estimatedCostCents, lastSuccessfulRunAt: row.lastSuccessfulRunAt };
}

export async function saveRunConfig(ownerId: string, input: Partial<RunConfig>): Promise<RunConfigSnapshot> {
  const config = normalizeRunConfig(input);
  const [{ getDb }, { runConfigs }] = await Promise.all([import("../../db"), import("../../db/schema")]);
  const now = new Date().toISOString();
  await getDb().insert(runConfigs).values({ id: `cfg_${ownerId}`, ownerId, ...runLimits(config), paused: config.paused, continuationCategory: config.continuationCategory, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: runConfigs.ownerId, set: { ...runLimits(config), paused: config.paused, continuationCategory: config.continuationCategory, updatedAt: now } });
  return getRunConfig(ownerId);
}

export async function recordRunUsage(ownerId: string, providerCalls: number, estimatedCostCents: number, successfulAt = new Date().toISOString()): Promise<void> {
  const [{ getDb }, { runConfigs }] = await Promise.all([import("../../db"), import("../../db/schema")]);
  const { eq } = await import("drizzle-orm");
  const now = new Date().toISOString();
  const db = getDb();
  const [current] = await db.select({ providerCalls: runConfigs.providerCalls, estimatedCostCents: runConfigs.estimatedCostCents }).from(runConfigs).where(eq(runConfigs.ownerId, ownerId)).limit(1);
  await db.update(runConfigs).set({ providerCalls: (current?.providerCalls ?? 0) + providerCalls, estimatedCostCents: (current?.estimatedCostCents ?? 0) + estimatedCostCents, lastSuccessfulRunAt: successfulAt, updatedAt: now }).where(eq(runConfigs.ownerId, ownerId));
}

export async function listConfiguredOwners(): Promise<string[]> {
  const [{ getDb }, { runConfigs, companies }] = await Promise.all([import("../../db"), import("../../db/schema")]);
  const db = getDb();
  const [configRows, companyRows] = await Promise.all([
    db.select({ ownerId: runConfigs.ownerId }).from(runConfigs),
    db.select({ ownerId: companies.ownerId }).from(companies),
  ]);
  return [...new Set([...configRows, ...companyRows].map((row) => row.ownerId))];
}
