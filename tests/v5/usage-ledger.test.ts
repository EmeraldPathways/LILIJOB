import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { v4MigrationStatements } from "../../lib/v4/migration";

const state: { db: ReturnType<typeof drizzle> } = { db: undefined as never };
vi.mock("cloudflare:workers", () => ({ env: {} }));
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
beforeEach(() => { sqlite = new DatabaseSync(":memory:"); for (const statement of v4MigrationStatements) sqlite.exec(statement); state.db = drizzle(adapter(sqlite) as never, { schema }); });
afterEach(() => sqlite.close());

describe("durable provider usage and budgets", () => {
  it("reserves once, records measured usage and exposes fixed-point totals", async () => {
    const { reserveBudget, recordProviderUsage, getUsageSummary } = await import("../../lib/v5/usage/ledger");
    const first = await reserveBudget("owner-a", "op-1", { scope: "ai", periodKey: "2026-10", amountMinor: 100, ceilingMinor: 500 });
    const repeated = await reserveBudget("owner-a", "op-1", { scope: "ai", periodKey: "2026-10", amountMinor: 100, ceilingMinor: 500 });
    expect(first.reservationId).toBe(repeated.reservationId);
    await recordProviderUsage("owner-a", first.reservationId, { attemptId: "attempt-1", operationId: "op-1", provider: "openai", model: "gpt-5.6-luna", status: "completed", inputTokens: 13, outputTokens: 5, measuredCostMinor: 7, priceVersion: "2026-10-01" });
    const summary = await getUsageSummary("owner-a", { from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T23:59:59.999Z" });
    expect(summary.inputTokens).toBe(13);
    expect(summary.outputTokens).toBe(5);
    expect(summary.measuredCostMinor).toBe(7);
    expect(summary.events).toBe(1);
  });

  it("rejects a reservation that would exceed the durable ceiling", async () => {
    const { reserveBudget } = await import("../../lib/v5/usage/ledger");
    await reserveBudget("owner-a", "op-1", { scope: "search", periodKey: "2026-10", amountMinor: 90, ceilingMinor: 100 });
    await expect(reserveBudget("owner-a", "op-2", { scope: "search", periodKey: "2026-10", amountMinor: 20, ceilingMinor: 100 })).rejects.toThrow(/budget/i);
  });

  it("uses explicit monthly period keys and configurable fixed-point estimates", async () => {
    const { budgetCeilingMinor, estimateOpenAICostMinor, usagePeriodKey } = await import("../../lib/v5/usage/provider");
    expect(usagePeriodKey(new Date("2026-10-16T00:00:00.000Z"))).toBe("2026-10");
    expect(budgetCeilingMinor("enrichment")).toBe(5_000);
    expect(estimateOpenAICostMinor(1_000, 1_000)).toBe(1);
  });
});
