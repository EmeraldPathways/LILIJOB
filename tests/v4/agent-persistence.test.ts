import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { v4MigrationStatements } from "../../lib/v4/migration";
import { createAgentStep } from "../../lib/v4/agent";

const state: { db: ReturnType<typeof drizzle> } = { db: undefined as never };
vi.mock("../../db", () => ({ getDb: () => state.db }));

function adapter(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...input: unknown[]) { values = input; return statement; },
        async all() { return { results: sqlite.prepare(sql).all(...values as never[]), success: true, meta: {} }; },
        async raw() { return sqlite.prepare(sql).all(...values as never[]).map((row) => Object.values(row)); },
        async run() { return sqlite.prepare(sql).run(...values as never[]); },
      };
      return statement;
    },
  };
}

let sqlite: DatabaseSync;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const statement of v4MigrationStatements) sqlite.exec(statement);
  state.db = drizzle(adapter(sqlite) as never, { schema });
  sqlite.prepare("INSERT INTO agent_runs (id, owner_id, request, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("run-a", "owner-a", "Search roles", "running", new Date().toISOString(), new Date().toISOString());
});

afterEach(() => sqlite.close());

describe("durable agent step persistence", () => {
  it("claims each run step once and can finalize the persisted claim", async () => {
    const dashboard = await import("../../lib/v4/dashboard");
    expect(typeof dashboard.claimAgentStep).toBe("function");
    const claimed = await dashboard.claimAgentStep("owner-a", "run-a", createAgentStep(0, "refresh_jobs", {}, {}, [], "running", 2));
    const concurrentClaim = await dashboard.claimAgentStep("owner-a", "run-a", createAgentStep(0, "refresh_jobs", {}, {}, [], "running", 2));
    expect(claimed).toBe(true);
    expect(concurrentClaim).toBe(false);

    await dashboard.appendAgentStep("owner-a", "run-a", createAgentStep(0, "refresh_jobs", {}, { jobsCreated: 1 }, [], "completed", 2));
    const persisted = await dashboard.getAgentRun("owner-a", "run-a");
    expect(persisted?.steps).toHaveLength(1);
    expect(persisted?.steps[0]).toMatchObject({ status: "completed", costCents: 2, estimatedCostCents: 2, actualCostCents: null });
  });

  it("reclaims an abandoned running step after its lease expires", async () => {
    const dashboard = await import("../../lib/v4/dashboard");
    const step = createAgentStep(0, "refresh_jobs", {}, {}, [], "running", 2);
    expect(await dashboard.claimAgentStep("owner-a", "run-a", step)).toBe(true);
    sqlite.prepare("UPDATE agent_steps SET started_at = ? WHERE owner_id = ? AND run_id = ? AND step_index = ?")
      .run(new Date(Date.now() - 61_000).toISOString(), "owner-a", "run-a", 0);
    expect(await dashboard.claimAgentStep("owner-a", "run-a", step)).toBe(true);
    const persisted = await dashboard.getAgentRun("owner-a", "run-a");
    expect(persisted?.steps).toHaveLength(1);
    expect(persisted?.steps[0]?.status).toBe("running");
  });

  it("does not claim another owner's run or an already completed step", async () => {
    const dashboard = await import("../../lib/v4/dashboard");
    expect(typeof dashboard.claimAgentStep).toBe("function");
    const step = createAgentStep(0, "search_jobs", {}, {}, [], "running", 0);
    expect(await dashboard.claimAgentStep("owner-b", "run-a", step)).toBe(false);
    expect(await dashboard.claimAgentStep("owner-a", "run-a", step)).toBe(true);
    await dashboard.appendAgentStep("owner-a", "run-a", createAgentStep(0, "search_jobs", {}, [], [], "completed", 0));
    expect(await dashboard.claimAgentStep("owner-a", "run-a", step)).toBe(false);
  });

  it("uses a conditional run update so stale workers cannot overwrite cancellation", async () => {
    const dashboard = await import("../../lib/v4/dashboard");
    const cancelled = await dashboard.updateAgentRun("owner-a", "run-a", {
      status: "cancelled",
      checkpoint: { version: 1, plan: [], nextPlanIndex: 0, attempts: {}, cancelRequested: true },
      expectedStatuses: ["running"],
    });
    expect(cancelled?.run.status).toBe("cancelled");

    const staleCompletion = await dashboard.updateAgentRun("owner-a", "run-a", {
      status: "completed",
      expectedStatuses: ["running"],
    });
    expect(staleCompletion).toBeNull();
    expect((await dashboard.getAgentRun("owner-a", "run-a"))?.run.status).toBe("cancelled");
  });
});
