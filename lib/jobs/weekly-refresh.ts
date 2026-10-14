import { COMPANY_CATEGORIES, type CompanyCategory } from "../domain/types";
import { normalizeRunConfig, runLimits, type RunConfig } from "./run-config";

export type WeeklyRefreshDependencies = {
  refreshExisting: (ownerId: string, scope: { category: "all" }, limits: ReturnType<typeof runLimits>) => Promise<unknown>;
  runDiscovery: (ownerId: string, category: CompanyCategory, limits: ReturnType<typeof runLimits>) => Promise<unknown>;
};

export type WeeklyRunSummary = {
  status: "completed" | "partial" | "paused";
  config: RunConfig;
  refreshed: unknown | null;
  discoveries: unknown[];
  errors: string[];
};

async function defaultDependencies(): Promise<WeeklyRefreshDependencies> {
  const worker = await import("../research/run-worker");
  return { refreshExisting: worker.refreshExisting, runDiscovery: worker.runDiscovery };
}

export async function runWeeklyRefresh(ownerId: string, input: Partial<RunConfig> = {}, injected?: WeeklyRefreshDependencies): Promise<WeeklyRunSummary> {
  const config = normalizeRunConfig(input);
  if (config.paused) return { status: "paused", config, refreshed: null, discoveries: [], errors: [] };

  const dependencies = injected ?? await defaultDependencies();
  const limits = runLimits(config);
  const errors: string[] = [];
  let refreshed: unknown | null = null;
  try {
    refreshed = await dependencies.refreshExisting(ownerId, { category: "all" }, limits);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Existing-company refresh failed.");
  }

  const discoveries: unknown[] = [];
  for (const category of COMPANY_CATEGORIES) {
    try {
      discoveries.push(await dependencies.runDiscovery(ownerId, category, limits));
    } catch (error) {
      errors.push(`${category}: ${error instanceof Error ? error.message : "Discovery failed."}`);
    }
  }

  return { status: errors.length ? "partial" : "completed", config, refreshed, discoveries, errors };
}
