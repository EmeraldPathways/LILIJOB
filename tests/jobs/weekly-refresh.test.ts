import { describe, expect, it, vi } from "vitest";
import { COMPANY_CATEGORIES } from "../../lib/domain/types";
import { runWeeklyRefresh } from "../../lib/jobs/weekly-refresh";
import type { WeeklyRefreshDependencies } from "../../lib/jobs/weekly-refresh";

describe("weekly refresh writer", () => {
  it("refreshes existing companies before discovering each category", async () => {
    const order: string[] = [];
    const deps: WeeklyRefreshDependencies = {
      refreshExisting: vi.fn(async () => { order.push("refresh"); return { runId: "run-refresh", total: 2, succeeded: 2, failed: 0 }; }),
      runDiscovery: vi.fn(async (_owner, category) => { order.push(category); return { runId: `run-${category}`, category, discovered: 1, queuedCompanyIds: [] }; }),
    };

    const result = await runWeeklyRefresh("owner-1", { newCompaniesPerCategory: 2, searchesPerCompany: 3, existingCompaniesPerRefresh: 4 }, deps);

    expect(order).toEqual(["refresh", ...COMPANY_CATEGORIES]);
    expect(result.status).toBe("completed");
    expect(deps.refreshExisting).toHaveBeenCalledWith("owner-1", { category: "all" }, { newCompaniesPerCategory: 2, searchesPerCompany: 3, existingCompaniesPerRefresh: 4 });
  });

  it("does no work while the schedule is paused", async () => {
    const deps: WeeklyRefreshDependencies = { refreshExisting: vi.fn(), runDiscovery: vi.fn() };
    const result = await runWeeklyRefresh("owner-1", { paused: true }, deps);
    expect(result.status).toBe("paused");
    expect(deps.refreshExisting).not.toHaveBeenCalled();
    expect(deps.runDiscovery).not.toHaveBeenCalled();
  });
});
