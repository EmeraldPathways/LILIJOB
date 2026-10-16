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

describe("in-app notification preferences and digest", () => {
  it("interprets quiet hours in the selected IANA zone across both Dublin DST changes", async () => {
    const { isWithinQuietHours } = await import("../../lib/v4/notifications");
    expect(isWithinQuietHours(new Date("2026-03-29T00:30:00.000Z"), "Europe/Dublin", "01:00", "03:00")).toBe(false);
    expect(isWithinQuietHours(new Date("2026-03-29T01:30:00.000Z"), "Europe/Dublin", "01:00", "03:00")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-10-25T00:30:00.000Z"), "Europe/Dublin", "01:15", "02:00")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-10-25T01:30:00.000Z"), "Europe/Dublin", "01:15", "02:00")).toBe(true);
    expect(isWithinQuietHours(new Date("2026-06-01T12:00:00.000Z"), "Europe/Dublin", "22:00", "07:00")).toBe(false);
  });

  it("requires explicit consent to opt in and stores owner-scoped timezone, quiet hours and cadence", async () => {
    const { getNotificationPreferences, saveNotificationPreferences } = await import("../../lib/v4/notifications");
    await expect(saveNotificationPreferences("owner-a", {
      timezone: "America/NotAZone", digestEnabled: true, quietStart: "22:00", quietEnd: "07:00",
      cadence: { frequency: "daily", time: "09:00", weekday: 1 }, consent: true,
    })).rejects.toThrow();
    await expect(saveNotificationPreferences("owner-a", {
      timezone: "Europe/Dublin", digestEnabled: true, quietStart: "22:00", quietEnd: "07:00",
      cadence: { frequency: "daily", time: "09:00", weekday: 1 }, consent: false,
    })).rejects.toThrow();
    const saved = await saveNotificationPreferences("owner-a", {
      timezone: "Europe/Dublin", digestEnabled: true, quietStart: "22:00", quietEnd: "07:00",
      cadence: { frequency: "weekly", time: "09:30", weekday: 1 }, consent: true,
    });
    expect(saved).toMatchObject({ timezone: "Europe/Dublin", digestEnabled: true, quietStart: "22:00", quietEnd: "07:00", cadence: { frequency: "weekly", time: "09:30", weekday: 1 }, consent: true });
    expect(await getNotificationPreferences("owner-a")).toEqual(saved);
    expect(await getNotificationPreferences("owner-b")).toMatchObject({ timezone: "Europe/Dublin", digestEnabled: false, consent: false });
  });

  it("builds an in-app digest only from saved searches and their saved local results", async () => {
    const { saveNotificationPreferences, buildInternalDigest } = await import("../../lib/v4/notifications");
    const { settingsVersions } = await import("../../db/schema-v4");
    await saveNotificationPreferences("owner-a", {
      timezone: "Europe/Dublin", digestEnabled: true, quietStart: "22:00", quietEnd: "07:00",
      cadence: { frequency: "daily", time: "09:00", weekday: 1 }, consent: true,
    });
    const createdAt = "2026-10-15T08:00:00.000Z";
    const savedSearch = {
      id: "search-a", name: "Product roles", query: { text: "product", scope: "jobs" }, createdAt, updatedAt: createdAt,
      lastRunAt: "2026-10-15T08:15:00.000Z",
      lastRunResult: { totalCount: 3, results: [{ id: "job-a", kind: "job", title: "Product Lead" }], moreAvailable: false },
    };
    await state.db.insert(settingsVersions).values({ id: "settings-a", ownerId: "owner-a", namespace: "saved-searches", version: 1, settingsJson: JSON.stringify({ savedSearches: [savedSearch] }), createdBy: "owner-a", createdAt });
    await state.db.insert(settingsVersions).values({ id: "settings-b", ownerId: "owner-b", namespace: "saved-searches", version: 1, settingsJson: JSON.stringify({ savedSearches: [{ ...savedSearch, id: "foreign-search" }] }), createdBy: "owner-b", createdAt });

    const digest = await buildInternalDigest("owner-a", new Date("2026-10-15T10:00:00.000Z"));
    expect(digest).toMatchObject({ status: "preview-ready", source: "saved-search-results", timezone: "Europe/Dublin", items: [{ searchId: "search-a", name: "Product roles", resultCount: 3, lastRunAt: "2026-10-15T08:15:00.000Z" }] });
    expect(digest).not.toHaveProperty("deliveryAddress");
    const quiet = await buildInternalDigest("owner-a", new Date("2026-10-15T22:30:00.000Z"));
    expect(quiet.status).toBe("quiet-hours-active");
    const optedOut = await buildInternalDigest("owner-b", new Date("2026-10-15T10:00:00.000Z"));
    expect(optedOut).toMatchObject({ status: "opted-out", items: [] });
  });
});
