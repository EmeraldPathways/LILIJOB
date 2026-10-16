import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
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
  for (const file of ["0000_abnormal_zeigeist.sql", "0001_tearful_eternity.sql", "0002_majestic_warlock.sql"]) {
    sqlite.exec(readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  for (const statement of v4MigrationStatements) sqlite.exec(statement);
  sqlite.exec(readFileSync(new URL("../../drizzle/0005_v4_research_schedules.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  state.db = drizzle(adapter(sqlite) as never, { schema });
  for (const [id, owner] of [["company-a", "owner-a"], ["company-b", "owner-a"], ["company-c", "owner-a"], ["company-foreign", "owner-b"]]) {
    sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name) VALUES (?, ?, ?, ?)").run(id, owner, id, id);
  }
});

afterEach(() => sqlite.close());

function successfulProcessor(jobsFound = 0) {
  return vi.fn(async (ownerId: string, companyId: string) => {
    if (!ownerId.trim() || !companyId.trim()) throw new Error("A scheduled owner and company are required.");
    return { status: "completed" as const, jobsFound, contactsFound: 0, signalsFound: 0 };
  });
}

describe("owner-scoped Job Radar schedules", () => {
  it("stores only companies owned by the authenticated user and starts opted-in schedules due now", async () => {
    const { saveJobRadarSchedule, getJobRadarSchedule } = await import("../../lib/v4/schedule/job-radar-schedule");
    await expect(saveJobRadarSchedule("owner-a", { companyIds: ["company-a", "company-foreign"], cadence: "weekly", enabled: true }, "2026-10-15T12:00:00.000Z"))
      .rejects.toThrow(/company/i);
    expect(await getJobRadarSchedule("owner-a")).toBeNull();

    const saved = await saveJobRadarSchedule("owner-a", { companyIds: ["company-a", "company-b"], cadence: "weekly", enabled: true }, "2026-10-15T12:00:00.000Z");
    expect(saved).toMatchObject({ ownerId: "owner-a", companyIds: ["company-a", "company-b"], cadence: "weekly", enabled: true, cursorIndex: 0, nextRunAt: "2026-10-15T12:00:00.000Z" });
  });

  it("continues a bounded company slice from its durable cursor and advances cadence only when complete", async () => {
    const { saveJobRadarSchedule, getJobRadarSchedule, dispatchDueJobRadarSchedules } = await import("../../lib/v4/schedule/job-radar-schedule");
    await saveJobRadarSchedule("owner-a", { companyIds: ["company-a", "company-b", "company-c"], cadence: "weekly", enabled: true }, "2026-10-15T12:00:00.000Z");
    const processCompany = successfulProcessor(1);

    const first = await dispatchDueJobRadarSchedules({ now: "2026-10-15T12:00:00.000Z", maxSchedules: 1, companiesPerSchedule: 2, processCompany });
    expect(first).toMatchObject({ schedulesClaimed: 1, companiesProcessed: 2, continuations: 1 });
    expect(processCompany.mock.calls.map(([ownerId, companyId]) => [ownerId, companyId])).toEqual([["owner-a", "company-a"], ["owner-a", "company-b"]]);
    expect(await getJobRadarSchedule("owner-a")).toMatchObject({ cursorIndex: 2, nextRunAt: "2026-10-15T12:00:00.000Z", lastStatus: "running" });

    const second = await dispatchDueJobRadarSchedules({ now: "2026-10-15T12:05:00.000Z", maxSchedules: 1, companiesPerSchedule: 2, processCompany });
    expect(second).toMatchObject({ schedulesClaimed: 1, companiesProcessed: 1, completedSchedules: 1 });
    expect(processCompany.mock.calls.map(([, companyId]) => companyId)).toEqual(["company-a", "company-b", "company-c"]);
    expect(await getJobRadarSchedule("owner-a")).toMatchObject({ cursorIndex: 0, nextRunAt: "2026-10-22T12:05:00.000Z", lastStatus: "completed" });
  });

  it("keeps a failed company visible while advancing the cursor so one bad source cannot block later companies", async () => {
    const { saveJobRadarSchedule, getJobRadarSchedule, dispatchDueJobRadarSchedules } = await import("../../lib/v4/schedule/job-radar-schedule");
    await saveJobRadarSchedule("owner-a", { companyIds: ["company-a", "company-b"], cadence: "daily", enabled: true }, "2026-10-15T12:00:00.000Z");
    const processCompany = vi.fn(async (_ownerId: string, companyId: string) => {
      if (companyId === "company-a") return { status: "unavailable" as const, jobsFound: 0, contactsFound: 0, signalsFound: 0, error: "Careers URL unavailable." };
      return { status: "completed" as const, jobsFound: 0, contactsFound: 1, signalsFound: 0 };
    });

    const result = await dispatchDueJobRadarSchedules({ now: "2026-10-15T12:00:00.000Z", maxSchedules: 1, companiesPerSchedule: 2, processCompany });
    expect(result).toMatchObject({ companiesProcessed: 2, partialSchedules: 1 });
    expect(await getJobRadarSchedule("owner-a")).toMatchObject({ cursorIndex: 0, lastStatus: "partial" });
    expect(JSON.parse((await getJobRadarSchedule("owner-a"))!.lastResultJson)).toMatchObject({ errors: [expect.stringContaining("Careers URL unavailable.")] });
  });

  it("does not run disabled schedules and resets continuation when the selected scope changes", async () => {
    const { saveJobRadarSchedule, dispatchDueJobRadarSchedules, getJobRadarSchedule } = await import("../../lib/v4/schedule/job-radar-schedule");
    await saveJobRadarSchedule("owner-a", { companyIds: ["company-a", "company-b"], cadence: "daily", enabled: true }, "2026-10-15T12:00:00.000Z");
    const processCompany = successfulProcessor();
    await dispatchDueJobRadarSchedules({ now: "2026-10-15T12:00:00.000Z", maxSchedules: 1, companiesPerSchedule: 1, processCompany });
    await saveJobRadarSchedule("owner-a", { companyIds: ["company-c"], cadence: "daily", enabled: false }, "2026-10-15T12:10:00.000Z");
    const result = await dispatchDueJobRadarSchedules({ now: "2026-10-16T12:00:00.000Z", maxSchedules: 1, companiesPerSchedule: 1, processCompany });
    expect(result.schedulesClaimed).toBe(0);
    expect(processCompany).toHaveBeenCalledTimes(1);
    expect(await getJobRadarSchedule("owner-a")).toMatchObject({ companyIds: ["company-c"], enabled: false, cursorIndex: 0, nextRunAt: null });
  });

  it("runs now only for the signed-in owner's saved schedule", async () => {
    const { saveJobRadarSchedule, getJobRadarSchedule, runOwnerJobRadarScheduleNow } = await import("../../lib/v4/schedule/job-radar-schedule");
    await saveJobRadarSchedule("owner-a", { companyIds: ["company-a"], cadence: "weekly", enabled: true }, "2026-10-15T12:00:00.000Z");
    await saveJobRadarSchedule("owner-b", { companyIds: ["company-foreign"], cadence: "weekly", enabled: true }, "2026-10-15T12:00:00.000Z");
    const processCompany = successfulProcessor();
    const result = await runOwnerJobRadarScheduleNow("owner-a", "2026-10-16T12:00:00.000Z", processCompany);
    expect(result.companiesProcessed).toBe(1);
    expect(processCompany).toHaveBeenCalledTimes(1);
    expect(processCompany.mock.calls[0][0]).toBe("owner-a");
    expect(await getJobRadarSchedule("owner-b")).toMatchObject({ nextRunAt: "2026-10-15T12:00:00.000Z", cursorIndex: 0 });
  });
});
