import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { v4MigrationStatements } from "../../lib/v4/migration";

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
});

afterEach(() => sqlite.close());

describe("durable scheduled runs and in-app notification deduplication", () => {
  it("claims one due slot, recovers an expired lease, and completes once", async () => {
    const { claimScheduledTaskRun, finishScheduledTaskRun } = await import("../../lib/v5/scheduler");
    const first = await claimScheduledTaskRun({ ownerId: "owner-a", scheduleId: "schedule-a", dueSlot: "2026-10-16T09:00:00.000Z", scopeVersion: "v1", now: "2026-10-16T09:00:00.000Z" });
    const concurrent = await claimScheduledTaskRun({ ownerId: "owner-a", scheduleId: "schedule-a", dueSlot: "2026-10-16T09:00:00.000Z", scopeVersion: "v1", now: "2026-10-16T09:00:01.000Z" });
    expect(first.claimed).toBe(true);
    expect(concurrent.claimed).toBe(false);
    const completed = await finishScheduledTaskRun("owner-a", first.run.id, { status: "completed", checkpoint: { processed: 2 }, now: "2026-10-16T09:01:00.000Z" });
    expect(completed?.status).toBe("completed");
    const retry = await claimScheduledTaskRun({ ownerId: "owner-a", scheduleId: "schedule-a", dueSlot: "2026-10-16T09:00:00.000Z", scopeVersion: "v1", now: "2026-10-16T10:00:00.000Z" });
    expect(retry.claimed).toBe(false);
    expect(retry.run.status).toBe("completed");
  });

  it("stores one notification for a repeated event key", async () => {
    const { createNotificationEvent, listNotificationEvents, updateNotificationEvent } = await import("../../lib/v5/scheduler");
    const input = { ownerId: "owner-a", dedupKey: "job-radar:schedule-a:slot-1", type: "job-radar-run", payload: { status: "completed" } };
    const first = await createNotificationEvent(input);
    const second = await createNotificationEvent(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await listNotificationEvents("owner-a")).toHaveLength(1);
    expect((await updateNotificationEvent("owner-a", first.event.id, "read"))?.state).toBe("read");
  });
});
